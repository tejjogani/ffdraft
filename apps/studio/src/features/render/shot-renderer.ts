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
import { PerspectiveCamera, Scene, WebGLRenderer } from 'three'

/** Browser takes stop here: larger WebGL canvases fail on many laptops. */
export const BROWSER_MAX_SIDE = 2048

/** Gems at the viewport's best: full internal bounces on hero stones, fewer on melee. */
const GEMS = {
  hero: { bounces: 6, dispersion: true },
  melee: { bounces: 3, dispersion: false },
}

/** Frames drawn before a still is read: shaders compile and shadow maps fill on the first. */
const SETTLE_FRAMES = 3

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

  /** Throws when WebGL is unavailable; callers show the reason instead of a picture. */
  constructor(canvas?: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      // A still is read back after the frame, so the buffer must survive it.
      preserveDrawingBuffer: true,
    })
    this.renderer.setPixelRatio(1)
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
    const resolved = resolveScene(scene, evaluation)
    this.renderer.setSize(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)), false)
    configureRenderer(this.renderer, resolved)
    const environment = createEnvironment(this.renderer, resolved, 256)
    const model = evaluationToThree(evaluation, resolved, { environment, gemQuality: GEMS })
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
    this.renderer.render(this.#scene, this.#camera)
  }

  /** Poses an animated shot at `frame` (piece, camera and light as the take will) and draws it. */
  setFrame(frame: number): void {
    if (!this.#built) return
    this.#built.stage.setFrame(frame)
    this.renderer.render(this.#scene, this.#camera)
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

  dispose(): void {
    this.#release()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
  }
}

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
