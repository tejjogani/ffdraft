/**
 * Draws a shot in the browser with the same resolved scene Blender renders: the look's studio
 * as an environment, the camera, the backdrop and ground, metals and stones from the design (or
 * the shot's overrides). It is the Render tab's live preview and, without Blender, the
 * "Preview quality" take itself. One WebGL context per renderer; `dispose` releases it.
 */
import type { Evaluation } from '@pave/kernel'
import { type ResolvedCamera, type ResolvedScene, resolveScene, sceneHash } from '@pave/render'
import {
  applyResolvedScene,
  configureRenderer,
  createEnvironment,
  evaluationToThree,
  type PaveEnvironment,
  type PaveModel,
  type StageController,
} from '@pave/render/three'
import type { RenderScene } from '@pave/schema'
import {
  Color,
  type Material,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three'
import {
  AdaptiveQuality,
  type Learned,
  type Quality,
  type QualityState,
  qualityState,
  sameQuality,
} from '../../components/stage/adaptive'
import { gemQualityFor, gpuTier, qualityFor } from '../../components/stage/quality'
import { usePerformance } from '../../stores/performance'

/** Browser takes stop here: larger WebGL canvases fail on many laptops. */
export const BROWSER_MAX_SIDE = 2048

/** Gems at the viewport's best: full internal bounces on hero stones, fewer on melee. */
const GEMS = {
  hero: { bounces: 6, dispersion: true },
  melee: { bounces: 3, dispersion: false },
}

/** Frames drawn before a still is read: shaders compile and shadow maps fill on the first. */
const SETTLE_FRAMES = 3
/** What the last live preview learned about frame times, for the next one on this page. */
let learned: Learned | null = null

/**
 * A moving preview is sharpened this long after its last move (a drag that saves nothing), or
 * after three of its own frame times on a slow machine: sharpening between the moves of one drag
 * would pay for a full frame, and a new light one, at every move.
 */
const REFINE_MS = 250
const REFINE_MAX_MS = 2000

interface Built {
  model: PaveModel
  environment: PaveEnvironment
  stage: StageController
}

export class ShotRenderer {
  readonly renderer: WebGLRenderer
  readonly #scene = new Scene()
  readonly #camera = new PerspectiveCamera(30, 1, 0.1, 5000)
  #built: Built | null = null
  /** The size `draw` drew at: a moving preview draws smaller and comes back to it. */
  #size = { width: 1, height: 1 }
  /**
   * Only a live preview (the viewfinder) adapts; a browser take is always drawn at full quality.
   * Moves draw at the adaptive moving quality, timed render-to-next-frame, then sharpen.
   */
  readonly #adaptive: AdaptiveQuality | null
  readonly #policy
  #light: Quality | null = null
  #refine: ReturnType<typeof setTimeout> | undefined
  #probe = 0
  /** The last moving frame's time, render to the next frame. */
  #frameMs = 0
  #state: QualityState | null = null
  /** Real materials put aside while plain stand-ins draw a move (the lightest effects). */
  #standIns: Map<Mesh, Material> | null = null
  /** Mirrors (the acrylic ground) hidden meanwhile: each costs a second render of the scene. */
  #hidden: Object3D[] = []
  readonly #listeners = new Set<() => void>()
  readonly #unsubscribe: () => void = () => {}

  /** Throws when WebGL is unavailable; callers show the reason instead of a picture. */
  constructor(canvas?: HTMLCanvasElement, options: { live?: boolean } = {}) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      // A still is read back after the frame, so the buffer must survive it.
      preserveDrawingBuffer: true,
    })
    this.renderer.setPixelRatio(1)
    const policy = qualityFor(options.live ? gpuTier(this.renderer.getContext()) : 'high')
    this.#policy = policy
    if (!options.live) {
      this.#adaptive = null
      return
    }
    const config = (mode = usePerformance.getState().mode) => ({
      mode,
      deviceDpr: window.devicePixelRatio || 1,
      tierMaxDpr: policy.maxDpr,
    })
    this.#adaptive = new AdaptiveQuality(config())
    this.#adaptive.adopt(learned)
    this.#state = qualityState(this.#adaptive, false)
    this.#unsubscribe = usePerformance.subscribe((st) => {
      if (st.mode === this.#adaptive?.mode) return
      this.#adaptive?.configure(config(st.mode))
      this.#report()
    })
  }

  /** Device pixels per CSS pixel for a still preview (1 for a take, which sets its own size). */
  stillDpr(): number {
    return this.#adaptive?.still().dpr ?? 1
  }

  /** What the live preview draws now, for the indicator; null for a take. */
  get qualityState(): QualityState {
    return this.#state ?? TAKE_STATE
  }

  onQuality(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  #report(): void {
    if (!this.#adaptive) return
    const next = qualityState(this.#adaptive, this.#light !== null)
    const changed = !this.#state || !sameQuality(this.#state, next)
    this.#state = next
    if (changed) for (const l of this.#listeners) l()
  }

  /** The gems for the still picture: the take's own quality unless the effects are lighter. */
  #stillGems() {
    const effects = this.#adaptive?.still().effects ?? 'full'
    return effects === 'full' ? GEMS : gemQualityFor(this.#policy, effects, false)
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement
  }

  /**
   * Draws `scene` of `evaluation` at `width`×`height` CSS pixels (the shot's aspect). Rebuilds
   * the studio and the model each time: a shot changes on a release, not on every frame.
   */
  draw(evaluation: Evaluation, scene: RenderScene, width: number, height: number): ResolvedScene {
    this.#release()
    this.#endLight()
    const resolved = resolveScene(scene, evaluation)
    this.#size = { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) }
    this.renderer.setSize(this.#size.width, this.#size.height, false)
    configureRenderer(this.renderer, resolved)
    const still = this.#adaptive?.still().effects ?? 'full'
    const environment = createEnvironment(this.renderer, resolved, still === 'full' ? 256 : 128)
    const model = evaluationToThree(evaluation, resolved, {
      environment,
      gemQuality: this.#stillGems(),
    })
    this.#scene.add(model.object)
    const stage = applyResolvedScene(this.#scene, this.#camera, resolved, { model, environment })
    this.#built = { model, environment, stage }
    for (let i = 0; i < SETTLE_FRAMES; i++) this.renderer.render(this.#scene, this.#camera)
    return resolved
  }

  /**
   * Moves the camera and draws one frame, without rebuilding the studio: a viewfinder drag. The
   * full scene is drawn again (`draw`) once the move is saved, as the take will be.
   */
  setCamera(camera: ResolvedCamera): void {
    if (!this.#built) return
    this.#built.stage.setCamera(camera)
    // The shadow falls from the studio, not the camera: a camera move reuses the shadow map.
    this.#drawMoving(false)
  }

  /** Poses an animated shot at `frame` (piece, camera and light as the take will) and draws it. */
  setFrame(frame: number): void {
    if (!this.#built) return
    this.#built.stage.setFrame(frame)
    // A turntable turns the piece under the light: its shadow moves with it.
    this.#drawMoving(true)
  }

  /**
   * One frame of a move. A live preview draws it at the adaptive moving quality and times it
   * (render to the next animation frame, which waits for the GPU); a take draws at full size.
   */
  #drawMoving(shadowMoves: boolean): void {
    const adaptive = this.#adaptive
    if (!adaptive) {
      this.renderer.render(this.#scene, this.#camera)
      return
    }
    this.#applyLight(adaptive.moving())
    this.renderer.shadowMap.autoUpdate = shadowMoves
    const start = performance.now()
    this.renderer.render(this.#scene, this.#camera)
    if (!this.#probe)
      this.#probe = requestAnimationFrame(() => {
        this.#probe = 0
        if (!this.#light) return
        this.#frameMs = performance.now() - start
        if (!adaptive.observe(this.#frameMs)) return
        learned = adaptive.learned()
        this.#report()
      })
    clearTimeout(this.#refine)
    this.#refine = setTimeout(
      () => {
        if (!this.#built || !this.#light) return
        this.#endLight()
        this.renderer.render(this.#scene, this.#camera)
      },
      Math.min(REFINE_MAX_MS, Math.max(REFINE_MS, 3 * this.#frameMs)),
    )
  }

  #applyLight(q: Quality): void {
    const built = this.#built
    if (!built || !this.#adaptive) return
    const k = Math.min(1, q.dpr / this.#adaptive.still().dpr)
    if (this.#light?.dpr !== q.dpr)
      this.renderer.setSize(
        Math.max(1, Math.round(this.#size.width * k)),
        Math.max(1, Math.round(this.#size.height * k)),
        false,
      )
    if (this.#light?.effects !== q.effects) {
      const gems = gemQualityFor(this.#policy, q.effects, true)
      built.model.setGemQuality('hero', gems.hero)
      built.model.setGemQuality('melee', gems.melee)
      if (q.effects === 'minimal') this.#putStandIns()
      else this.#restoreMaterials()
    }
    const was = this.#light
    this.#light = q
    if (!was) this.#report()
  }

  /** Back to the still picture's size, gems and shadows (the caller draws). */
  #endLight(): void {
    clearTimeout(this.#refine)
    cancelAnimationFrame(this.#probe)
    this.#probe = 0
    this.renderer.shadowMap.autoUpdate = true
    if (!this.#light) return
    this.#light = null
    this.#restoreMaterials()
    this.renderer.setSize(this.#size.width, this.#size.height, false)
    const gems = this.#stillGems()
    this.#built?.model.setGemQuality('hero', gems.hero)
    this.#built?.model.setGemQuality('melee', gems.melee)
    this.#report()
  }

  /** The last frame as a PNG. */
  toBlob(): Promise<Blob> {
    return new Promise((resolve, reject) =>
      this.canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('The browser could not save the picture'))),
        'image/png',
      ),
    )
  }

  #release(): void {
    this.#restoreMaterials()
    const b = this.#built
    if (!b) return
    this.#built = null
    b.stage.dispose()
    b.model.object.removeFromParent()
    b.model.dispose()
    b.environment.dispose()
    this.#scene.environment = null
    this.#scene.background = null
  }

  /**
   * Plain materials for a move on a machine that cannot draw the real ones every frame: metal
   * keeps its colour, stones are a bright solid, mirrors are hidden. The real look returns on
   * release. Stand-ins are made per move and freed with it.
   */
  #putStandIns(): void {
    const built = this.#built
    if (!built || this.#standIns) return
    const put = new Map<Mesh, Material>()
    const byColour = new Map<string, MeshStandardMaterial>()
    const stone = new MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.15 })
    built.model.object.traverse((o) => {
      if (!(o instanceof Mesh)) return
      const original = o.material as Material & { color?: Color }
      const gem = o.userData.role === 'gem'
      const key = gem ? 'stone' : (original.color?.getHexString() ?? 'metal')
      let standIn = gem ? stone : byColour.get(key)
      if (!standIn) {
        standIn = new MeshStandardMaterial({
          color: original.color ?? new Color(0xd0d0d0),
          metalness: 1,
          roughness: 0.35,
        })
        byColour.set(key, standIn)
      }
      put.set(o, original)
      o.material = standIn
    })
    this.#scene.traverse((o) => {
      if ((o as { isReflector?: boolean }).isReflector && o.visible) {
        o.visible = false
        this.#hidden.push(o)
      }
    })
    this.#standIns = put
  }

  #restoreMaterials(): void {
    const put = this.#standIns
    if (!put) return
    this.#standIns = null
    const made = new Set<Material>()
    for (const [mesh, original] of put) {
      made.add(mesh.material as Material)
      mesh.material = original
    }
    for (const m of made) m.dispose()
    for (const o of this.#hidden) o.visible = true
    this.#hidden = []
  }

  dispose(): void {
    this.#endLight()
    this.#unsubscribe()
    this.#listeners.clear()
    this.#release()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
  }
}

/** A take's renderer has no adaptive state: it always draws the full picture. */
const TAKE_STATE: QualityState = qualityState(
  new AdaptiveQuality({ mode: 'sharp', deviceDpr: 1, tierMaxDpr: 1 }),
  false,
)

/** The size a browser take is drawn at: the shot's size, capped to what WebGL can hold. */
export function browserSize(scene: RenderScene): { width: number; height: number } {
  const { width, height } = scene.output
  const k = Math.min(1, BROWSER_MAX_SIDE / Math.max(width, height))
  return { width: Math.round(width * k), height: Math.round(height * k) }
}

/**
 * One still, drawn off screen and released: a browser take, with the fingerprint of the scene
 * it drew (the same `sceneHash` a Blender take of that scene records).
 */
export async function renderStill(
  evaluation: Evaluation,
  scene: RenderScene,
  design: { pieceId: string; version: number },
): Promise<{ blob: Blob; sceneHash: string }> {
  const r = new ShotRenderer()
  try {
    const { width, height } = browserSize(scene)
    const resolved = r.draw(evaluation, scene, width, height)
    return { blob: await r.toBlob(), sceneHash: sceneHash(resolved, design) }
  } finally {
    r.dispose()
  }
}
