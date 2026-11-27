/**
 * The 3D viewport as one imperative object: a WebGL renderer drawing on demand (zero frames
 * while nothing moves), camera-controls for orbit/pan/zoom, and the piece built by
 * `evaluationToThree` — the only place an Evaluation becomes three.js objects. On top of that
 * it owns what is specific to editing: display modes, selection and hover outlines, view-only
 * hiding, x-ray, ghosts of features that failed to rebuild, picking and capture.
 *
 * Kept outside React so capture, picking and the render loop act on the renderer directly; the
 * <Stage/> component only mounts it and forwards state.
 */
import type { Bounds, EvaluatedCurve, Evaluation, Part } from '@pave/kernel'
import {
  boundsCenter,
  boundsRadius,
  CAMERA_PRESETS,
  type CameraPreset,
  cameraBasis,
  framePoints,
  resolveScene,
  subjectOf,
  type Vec3,
  viewTangents,
} from '@pave/render'
import {
  configureRenderer,
  createEnvironment,
  evaluationToThree,
  type PaveEnvironment,
  type PaveModel,
  toThreePoint,
  zUpGroup,
} from '@pave/render/three'
import {
  type CurvePlane,
  type ImagePlaneView,
  pointOnCurvePlane,
  RenderSceneSchema,
} from '@pave/schema'
import CameraControls from 'camera-controls'
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  EdgesGeometry,
  type Group,
  InstancedMesh,
  type LineBasicMaterial,
  LineSegments,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  Scene,
  Sphere,
  Spherical,
  Timer,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
} from 'three'
import { acceleratedRaycast, computeBoundsTree } from 'three-mesh-bvh'
import { VIEW_ANGLES } from '../../lib/image-planes'
import { usePerformance } from '../../stores/performance'
import {
  AdaptiveQuality,
  type Learned,
  type PerformanceMode,
  type Quality,
  type QualityState,
  qualityState,
  sameQuality,
} from './adaptive'
import { pickConstructionCurve } from './construction-pick'
import { displayEvaluation, initialModelView } from './display-evaluation'
import { viewportScene } from './environment'
import { ImagePlaneLayer, type ImagePlaneSpec } from './image-planes'
import {
  contactShadowTexture,
  createModeMaterials,
  type ModeMaterials,
  type OutlineMaterial,
  readPalette,
} from './materials'
import { isShellOf, MetalBatch } from './metal-shells'
import { type GpuTier, gemQualityFor, gpuTier, type QualityPolicy, qualityFor } from './quality'
import { StoneBatch } from './stone-batch'
import {
  createViewVisibility,
  type ViewerPick,
  type ViewTarget,
  type ViewVisibilityState,
} from './visibility'

export type { ViewerPick } from './visibility'

CameraControls.install({
  THREE: { Vector2, Vector3, Vector4, Quaternion, Matrix4, Spherical, Box3, Sphere, Raycaster },
})
// Picking through BVHs: instant even on thousands of pavé stones.
Mesh.prototype.raycast = acceleratedRaycast
;(BufferGeometry.prototype as unknown as { computeBoundsTree: unknown }).computeBoundsTree =
  computeBoundsTree

export type DisplayMode = 'rendered' | 'clay' | 'technical'

export interface ViewerState extends ViewVisibilityState {
  display: DisplayMode
  selection: readonly string[]
  stone: string | null
  part?: string | null
  hover: ViewerPick | null
  xray: boolean
  /** Nodes an assistant just edited, tinted once in the AI colour (cleared by the caller). */
  aiTint?: readonly string[]
}

/**
 * What the last viewer of this page learned about the machine's frame times, so the next piece
 * opened starts at the right level instead of learning it again on its first orbit.
 */
let learned: Learned | null = null

/** Evaluations closer together than this are a scrub: drawn light, refined when it stops. */
const SCRUB_GAP_MS = 600
/** How long after the last scrubbed evaluation the picture is refined. */
const SCRUB_SETTLE_MS = 250

export interface CaptureOptions {
  /** Show this evaluation first (the caller waited for it), so the pictures match its version. */
  evaluation?: Evaluation
  views: readonly (CameraPreset | { azimuth: number; elevation: number })[]
  mode: DisplayMode
  size: number
  focusNodeIds?: readonly string[]
  /** CSS background behind the piece (the stage gradient), drawn under the render. */
  background?: (ctx: CanvasRenderingContext2D, size: number) => void
  /** Labels drawn next to these nodes (node id → text), e.g. their names. */
  labels?: Readonly<Record<string, string>>
}

/** CSS pixels the floating toolbars and the facts strip cover at the top and bottom of the view. */
export const HUD_BAND_PX = 56

const FOCAL_MM = 70
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

interface Built {
  model: PaveModel
  /** Every metal mesh and stone batch of the model with its original material. */
  metals: Map<Mesh, MetalBatch>
  /** A whole-node pick would also affect other pieces with this owner. */
  exactMetalNodes: Set<string>
  gems: Map<InstancedMesh, StoneBatch>
  originals: Map<Mesh, Material>
  visibility?: (target: ViewTarget) => boolean
}

/** Metal geometry kept across evaluations by `Part.rev`, with its picking BVH and GPU buffers. */
interface CachedGeometry {
  geometry: BufferGeometry
  /** The evaluation that last used it; entries no evaluation uses any more are disposed. */
  used: number
}

export class Viewer {
  readonly renderer: WebGLRenderer
  readonly scene = new Scene()
  readonly camera = new PerspectiveCamera(30, 1, 0.1, 5000)
  readonly controls: CameraControls
  readonly tier: GpuTier
  private readonly policy: QualityPolicy
  /** Frame times decide how sharp a moving picture is (see ./adaptive). */
  private readonly adaptive: AdaptiveQuality
  /** The quality last applied to the renderer and the gems. */
  private applied: Quality | null = null
  private scrubbing = false
  /** Clay stand-ins for metals and stones are on (a very slow machine, while moving). */
  private standIn = false
  private scrubTimer: ReturnType<typeof setTimeout> | undefined
  private lastEvaluationAt = -Infinity
  /** The frame was requested by the previous one (a continuous move), so its interval is a frame time. */
  private chained = false
  private lastTick = 0
  private stillProbe = 0
  private readonly qualityListeners = new Set<() => void>()
  private qualitySnapshot: QualityState
  private readonly unsubscribePerformance: () => void
  private materials: ModeMaterials
  private readonly overlay: Group = zUpGroup('cad-overlay')
  private readonly decor: Group = zUpGroup('cad-decor')
  private readonly shadow: Mesh
  private built: Built | null = null
  private inputEvaluation: Evaluation | null = null
  private evaluation: Evaluation | null = null
  private environment: PaveEnvironment | null = null
  private envRadius = 0
  private envSize = 0
  private lastGood = new Map<string, Part[]>()
  private readonly geometries = new Map<string, CachedGeometry>()
  private generation = 0
  private state: ViewerState = {
    display: 'rendered',
    selection: [],
    stone: null,
    hover: null,
    hidden: [],
    xray: false,
  }
  private isVisible = createViewVisibility(this.state)
  private beforeIsolation: {
    position: Vector3
    target: Vector3
    near: number
    far: number
    fitDistance: number | null
  } | null = null
  private readonly timer = new Timer()
  private frame = 0
  private moving = false
  private restTimer: ReturnType<typeof setTimeout> | undefined
  private width = 1
  private height = 1
  private framedOnce = false
  private fitDistance: number | null = null
  private readonly zoomOrbit = new Spherical()
  private disposed = false
  /** Milliseconds the last frames took to submit (CPU side), for the performance readout. */
  readonly frameTimes: number[] = []
  private readonly renderListeners = new Set<() => void>()
  /** Nodes the default framing is about (e.g. a pendant without its chain); empty = everything. */
  private frameFocus: readonly string[] = []
  private constructionFrame: readonly EvaluatedCurve[] = []
  private shadowAllowed = false
  /** Reference pictures to model over; drawn before the piece and never captured. */
  private readonly planes: ImagePlaneLayer

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly themeRoot: Element,
  ) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    })
    this.renderer.setClearColor(0x000000, 0)
    this.tier = gpuTier(this.renderer.getContext())
    this.policy = qualityFor(this.tier)
    this.adaptive = new AdaptiveQuality(this.adaptiveConfig(usePerformance.getState().mode))
    this.adaptive.adopt(learned)
    this.qualitySnapshot = qualityState(this.adaptive, false)
    this.unsubscribePerformance = usePerformance.subscribe((s) => {
      if (s.mode === this.adaptive.mode) return
      this.adaptive.configure(this.adaptiveConfig(s.mode))
      this.applyQuality()
      this.invalidate()
    })
    this.materials = createModeMaterials(readPalette(themeRoot))
    this.planes = new ImagePlaneLayer(this.invalidate)
    this.planes.setSelectColor(readPalette(themeRoot).select)
    this.controls = new CameraControls(this.camera, canvas)
    this.controls.dollyToCursor = true
    this.controls.smoothTime = 0.12
    this.controls.draggingSmoothTime = 0.06
    this.controls.minDistance = 1
    this.controls.maxDistance = 2000
    // camera-controls only moves the camera inside `update()`, which runs in `tick`: every
    // input that starts a move must schedule a frame, or nothing is drawn until something else
    // happens to redraw.
    this.controls.addEventListener('update', this.invalidate)
    this.controls.addEventListener('control', this.invalidate)
    this.controls.addEventListener('controlstart', this.startMoving)
    this.controls.addEventListener('transitionstart', this.startMoving)
    this.controls.addEventListener('rest', this.stopMoving)
    const shadowMaterial = new MeshBasicMaterial({
      map: contactShadowTexture(),
      transparent: true,
      depthWrite: false,
      opacity: 0.5,
    })
    this.shadow = new Mesh(new PlaneGeometry(1, 1), shadowMaterial)
    this.shadow.renderOrder = -1
    this.decor.add(this.shadow)
    this.scene.add(this.decor, this.overlay)
    canvas.addEventListener('webglcontextlost', this.onContextLost)
    canvas.addEventListener('webglcontextrestored', this.onContextRestored)
  }

  // ── Render loop ──────────────────────────────────────────────────────────────────────────

  /** Requests one frame; repeated calls before it draws are free. */
  readonly invalidate = (): void => {
    if (this.frame || this.disposed) return
    this.frame = requestAnimationFrame(this.tick)
  }

  private readonly tick = (): void => {
    this.frame = 0
    const now = performance.now()
    // Only the interval between two frames of one continuous move says what a frame costs; a
    // frame after a pause in the drag would read as a very slow one.
    if (this.chained && this.isLight() && this.adaptive.observe(now - this.lastTick)) {
      learned = this.adaptive.learned()
      this.applyQuality()
    }
    this.chained = false
    this.lastTick = now
    this.timer.update()
    const moving = this.controls.update(this.timer.getDelta())
    this.draw()
    if (moving) {
      this.invalidate()
      this.chained = true
    }
  }

  private draw(): void {
    const start = performance.now()
    if (this.planes.isEmpty) this.renderer.render(this.scene, this.camera)
    else {
      // Pictures first, then the piece over them with a fresh depth buffer: the piece is never
      // hidden behind a reference, whatever the angle.
      this.renderer.render(this.planes.scene, this.camera)
      this.renderer.autoClear = false
      this.renderer.clearDepth()
      this.renderer.render(this.scene, this.camera)
      this.renderer.autoClear = true
    }
    this.frameTimes.push(performance.now() - start)
    if (this.frameTimes.length > 60) this.frameTimes.shift()
    // A still frame is timed to the next animation frame, which waits for the GPU to finish it.
    // One callback per still frame, and none at all while nothing is drawn.
    if (!this.isLight() && !this.stillProbe)
      this.stillProbe = requestAnimationFrame(() => {
        this.stillProbe = 0
        if (this.disposed) return
        this.adaptive.observeStill(performance.now() - start)
        learned = this.adaptive.learned()
      })
    for (const l of this.renderListeners) l()
  }

  /** Calls `listener` after every drawn frame (to pin HTML to the model); returns the unsubscribe. */
  onRender(listener: () => void): () => void {
    this.renderListeners.add(listener)
    return () => this.renderListeners.delete(listener)
  }

  /** Where a model point (Z-up mm) appears, in CSS pixels from the canvas's top-left. */
  project(point: Vec3): { x: number; y: number; visible: boolean; inFront: boolean } {
    const p = toThreePoint(point).project(this.camera)
    const inFront = p.z > -1 && p.z < 1
    return {
      x: ((p.x + 1) / 2) * this.width,
      y: ((1 - p.y) / 2) * this.height,
      visible: inFront && Math.abs(p.x) <= 1.05 && Math.abs(p.y) <= 1.05,
      inFront,
    }
  }

  /** Only the CAD viewport gives the camera construction curves to frame. */
  setConstructionFrame(curves: readonly EvaluatedCurve[]): void {
    const first = curves[0]
    const wasEmpty = this.constructionFrame.length === 0
    this.constructionFrame = curves
    if (first && wasEmpty && !this.framedOnce) {
      const points = curves.flatMap((c) => c.points)
      if (first.plane) this.viewConstructionPlane(first.plane, points)
      else if (points.length) this.look(40, 25, points, 0.64, false)
    }
  }

  /** Looks squarely onto the named plane through the model origin. */
  viewConstructionPlane(plane: CurvePlane, points: Vec3[] = []): void {
    const azimuth = plane === 'right' ? 90 : 0
    const elevation = plane === 'top' ? 90 : 0
    const scene = points.length ? points : this.pointsFor()
    this.look(
      azimuth,
      elevation,
      scene.length
        ? scene
        : [
            [-12, -12, -12],
            [12, 12, 12],
          ],
      0.64,
      false,
    )
  }

  /** Converts canvas pixels into millimetres on a construction plane through the origin. */
  pointOnConstructionPlane(
    plane: CurvePlane,
    x: number,
    y: number,
    offset = 0,
  ): [number, number] | null {
    const normal =
      plane === 'front'
        ? new Vector3(0, 0, 1)
        : plane === 'right'
          ? new Vector3(1, 0, 0)
          : new Vector3(0, 1, 0)
    this.raycaster.setFromCamera(this.ndc(x, y), this.camera)
    const hit = this.raycaster.ray.intersectPlane(
      new Plane(normal, plane === 'front' ? offset : -offset),
      new Vector3(),
    )
    return hit ? pointOnCurvePlane(plane, [hit.x, -hit.z, hit.y]) : null
  }

  /** The screen rectangle (CSS pixels) the nodes' bounds cover, or null when none is in front. */
  screenBounds(
    nodeIds: readonly string[],
  ): { x0: number; y0: number; x1: number; y1: number } | null {
    const pts = this.nodePoints(nodeIds)
      .map((p) => this.project(p))
      .filter((p) => p.visible)
    if (!pts.length) return null
    return {
      x0: Math.min(...pts.map((p) => p.x)),
      y0: Math.min(...pts.map((p) => p.y)),
      x1: Math.max(...pts.map((p) => p.x)),
      y1: Math.max(...pts.map((p) => p.y)),
    }
  }

  /** Which nodes the default views and "fit" frame; the rest may extend outside (a long chain). */
  setFrameFocus(nodeIds: readonly string[]): void {
    this.frameFocus = nodeIds
  }

  private readonly startMoving = (): void => {
    clearTimeout(this.restTimer)
    this.invalidate()
    if (this.moving) return
    this.moving = true
    this.applyQuality()
  }

  private readonly stopMoving = (): void => {
    clearTimeout(this.restTimer)
    // Refine once the camera has settled for a moment.
    this.restTimer = setTimeout(() => {
      this.moving = false
      this.applyQuality()
      this.invalidate()
    }, 150)
  }

  /** Whether the picture is drawn light now: the camera moves or a slider scrubs. */
  private isLight(): boolean {
    return this.moving || this.scrubbing
  }

  private adaptiveConfig(mode: PerformanceMode) {
    return { mode, deviceDpr: window.devicePixelRatio || 1, tierMaxDpr: this.policy.maxDpr }
  }

  private quality(): Quality {
    return this.isLight() ? this.adaptive.moving() : this.adaptive.still()
  }

  /**
   * Applies the pixel ratio and effects for the current state. A new pixel ratio reallocates
   * the drawing buffer, so it is only set when it changed; the frame that follows draws at it.
   */
  private applyQuality(): void {
    const q = this.quality()
    if (!this.applied || this.applied.dpr !== q.dpr) {
      this.renderer.setPixelRatio(q.dpr)
      this.renderer.setSize(this.width, this.height, false)
    }
    this.applied = q
    this.applyGemQuality()
    const standIn = this.wantsStandIn()
    if (standIn !== this.standIn) {
      this.standIn = standIn
      this.applyMaterials()
    }
    const next = qualityState(this.adaptive, this.isLight())
    const changed = !sameQuality(this.qualitySnapshot, next)
    this.qualitySnapshot = next
    if (changed) for (const l of this.qualityListeners) l()
  }

  /** What the viewport draws now; stable between changes (for useSyncExternalStore). */
  get qualityState(): QualityState {
    return this.qualitySnapshot
  }

  /** Calls `listener` when the drawn quality changes; returns the unsubscribe. */
  onQuality(listener: () => void): () => void {
    this.qualityListeners.add(listener)
    return () => this.qualityListeners.delete(listener)
  }

  private applyGemQuality(effects = this.quality().effects, light = this.isLight()): void {
    const model = this.built?.model
    if (!model || !this.evaluation) return
    const melee = this.evaluation.stones.filter((s) => s.role === 'melee' || s.role === 'accent')
    const set = gemQualityFor(this.policy, effects, light)
    model.setGemQuality('hero', set.hero)
    model.setGemQuality(
      'melee',
      melee.length > this.policy.meleeBudget
        ? gemQualityFor(this.policy, effects, true).melee
        : set.melee,
    )
  }

  setSize(width: number, height: number): void {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    // The window may have moved to a screen of another density.
    this.adaptive.configure(this.adaptiveConfig(this.adaptive.mode))
    // A forced resize: the canvas's CSS size changed even when the pixel ratio did not.
    this.applied = null
    this.applyQuality()
    this.camera.aspect = this.width / this.height
    this.applyInset()
    this.updateFov(this.camera.aspect)
    this.updateSafeFraction()
    for (const m of [this.materials.silhouette, this.materials.selected, this.materials.hovered])
      m.setResolution(this.width, this.height)
    this.invalidate()
  }

  private updateFov(aspect: number): void {
    const [, ty] = viewTangents(FOCAL_MM, aspect)
    this.camera.fov = (2 * Math.atan(ty) * 180) / Math.PI
    this.camera.updateProjectionMatrix()
  }

  /** Re-reads colours after a theme change. */
  refreshTheme(): void {
    this.materials.dispose()
    this.materials = createModeMaterials(readPalette(this.themeRoot))
    this.planes.setSelectColor(readPalette(this.themeRoot).select)
    this.setSize(this.width, this.height)
    this.applyLook()
  }

  // ── Content ──────────────────────────────────────────────────────────────────────────────

  setEvaluation(input: Evaluation): void {
    if (input === this.inputEvaluation) return
    this.inputEvaluation = input
    const evaluation = displayEvaluation(input)
    const failed = new Set(
      evaluation.diagnostics.filter((d) => d.code === 'feature.failed').map((d) => d.nodeId),
    )
    // Remember each node's last geometry that built, to ghost it while the node is failing;
    // forget nodes that are gone (deleted) so their geometry is not kept alive.
    const byNode = new Map<string, Part[]>()
    for (const part of evaluation.parts)
      byNode.set(part.nodeId, [...(byNode.get(part.nodeId) ?? []), part])
    for (const nodeId of this.lastGood.keys())
      if (!failed.has(nodeId) && !byNode.has(nodeId)) this.lastGood.delete(nodeId)
    for (const [nodeId, parts] of byNode) this.lastGood.set(nodeId, parts)

    // A burst of evaluations is a slider being scrubbed: draw it light like a moving camera,
    // and refine once the burst stops. A single edit draws at full quality straight away.
    // On a machine where a full frame is slow, every edit is drawn light first, so the change
    // shows at once and sharpens a moment later.
    const now = performance.now()
    if (
      this.evaluation &&
      (now - this.lastEvaluationAt < SCRUB_GAP_MS || this.adaptive.stillIsSlow())
    )
      this.scrub()
    this.lastEvaluationAt = now

    this.evaluation = evaluation
    this.planes.setBounds(evaluation.report.bounds)
    const resolved = viewportScene(
      resolveScene(
        RenderSceneSchema.parse({
          look: 'studio-soft',
          includeUnassignedRhino: true,
          importedBodyLook: 'source',
          output: { width: 1024, height: 1024 },
        }),
        evaluation,
      ),
    )
    configureRenderer(this.renderer, resolved)
    this.renderer.shadowMap.enabled = false
    const radius = resolved.subject.radius
    // The studio reflection is rebuilt only when the piece's size changes a lot, or the still
    // picture's effects ask for another resolution (a slow machine gets the smaller one).
    const envSize = this.tier === 'software' || this.adaptive.still().effects !== 'full' ? 128 : 256
    if (
      !this.environment ||
      envSize !== this.envSize ||
      Math.abs(radius - this.envRadius) / this.envRadius > 0.3
    ) {
      this.environment?.dispose()
      this.environment = createEnvironment(this.renderer, resolved, envSize)
      this.envRadius = radius
      this.envSize = envSize
      this.scene.environment = this.environment.texture
    }

    const previous = this.built
    const model = evaluationToThree(evaluation, resolved, {
      environment: this.environment,
      gemQuality: this.policy.rest,
    })
    const metals = new Map<Mesh, MetalBatch>()
    const gems = new Map<InstancedMesh, StoneBatch>()
    const originals = new Map<Mesh, Material>()
    const stoneTargets = new Map(
      evaluation.stones.map(({ id, nodeId }) => [id, { nodeId, stoneId: id }]),
    )
    const parts = new Map(evaluation.parts.map((part) => [part.id, part]))
    const exactMetalNodes = new Set(evaluation.stones.map((stone) => stone.nodeId))
    const metalNodes = new Set<string>()
    for (const { nodeId } of parts.values()) {
      if (metalNodes.has(nodeId)) exactMetalNodes.add(nodeId)
      metalNodes.add(nodeId)
    }
    const referenceIds = new Set(input.referenceParts?.map((p) => p.id))
    const generation = ++this.generation
    model.object.traverse((o) => {
      if (o instanceof InstancedMesh) {
        const targets = (o.userData.stoneIds as string[]).map((id) => stoneTargets.get(id)!)
        gems.set(o, new StoneBatch(o, targets))
        originals.set(o, o.material as Material)
      } else if (o instanceof Mesh) {
        const part = parts.get(o.name)!
        o.userData.reference = referenceIds.has(o.name)
        o.userData.hasSourceAppearance = Boolean(part.sourceAppearance)
        originals.set(o, o.material as Material)
        this.reuseGeometry(o, part.rev, generation)
        metals.set(o, new MetalBatch(o, part))
      }
    })
    this.built = { model, metals, exactMetalNodes, gems, originals }
    this.scene.add(model.object)
    if (previous) this.release(previous)
    for (const [rev, entry] of this.geometries)
      if (entry.used !== generation) {
        entry.geometry.dispose()
        this.geometries.delete(rev)
      }

    this.schedulePickIndex()
    this.placeShadow(evaluation.report.bounds, evaluation.report.ringInnerDiameter !== undefined)
    this.applyGemQuality()
    this.applyLook()
    const preset = !this.framedOnce && initialModelView(input)
    if (preset) {
      this.framedOnce = true
      const { azimuth, elevation, fill } = CAMERA_PRESETS[preset]
      this.look(azimuth, elevation, this.pointsFor(undefined, false), fill, false)
    }
  }

  private scrub(): void {
    clearTimeout(this.scrubTimer)
    this.scrubTimer = setTimeout(() => {
      this.scrubbing = false
      this.applyQuality()
      this.invalidate()
    }, SCRUB_SETTLE_MS)
    if (this.scrubbing) return
    this.scrubbing = true
    this.applyQuality()
  }

  /**
   * Swaps a freshly built part geometry for the one already on the GPU when the part's `rev`
   * is unchanged, so a scrub re-uploads (and re-indexes for picking) only what it changed. The
   * new geometry has not been drawn yet, so dropping it costs nothing.
   */
  private reuseGeometry(mesh: Mesh, rev: string | undefined, generation: number): void {
    if (!rev) return
    const key = `${JSON.stringify(mesh.name)}:${rev}`
    const cached = this.geometries.get(key)
    if (cached) {
      mesh.geometry.dispose()
      mesh.geometry = cached.geometry
      cached.used = generation
    } else this.geometries.set(key, { geometry: mesh.geometry, used: generation })
  }

  /**
   * Disposes a replaced model's materials and the geometries the cache no longer holds.
   * (`PaveModel.dispose` would also dispose the geometries the new model reuses.)
   */
  private release(b: Built): void {
    b.model.object.removeFromParent()
    for (const batch of b.metals.values()) batch.resetGeometry()
    const kept = new Set([...this.geometries.values()].map((e) => e.geometry))
    const done = new Set<object>()
    b.model.object.traverse((o) => {
      if (!(o instanceof Mesh)) return
      if (!kept.has(o.geometry) && !done.has(o.geometry)) o.geometry.dispose()
      const material = b.originals.get(o) ?? (o.material as Material)
      if (!done.has(material)) material.dispose()
      if (o instanceof InstancedMesh) o.dispose()
      done.add(o.geometry).add(material)
    })
  }

  private indexTimer: ReturnType<typeof setTimeout> | undefined

  /**
   * Builds picking BVHs for new geometry once the viewport is idle, so the first hover after
   * an edit does not stall on a large part (unchanged parts keep theirs, see `reuseGeometry`).
   */
  private schedulePickIndex(): void {
    clearTimeout(this.indexTimer)
    this.indexTimer = setTimeout(() => {
      const b = this.built
      if (!b || this.moving) return
      const run = () => {
        if (this.built === b)
          for (const t of [...b.metals.keys(), ...b.gems.keys()]) indexForPicking(t)
      }
      if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 2000 })
      else run()
    }, 400)
  }

  /** A ring stands on the stage, so it gets a contact shadow; pendants and earrings hang. */
  private placeShadow(b: Bounds, standing: boolean): void {
    const sx = (b.max[0] - b.min[0]) * 1.5 + 2
    const sy = (b.max[1] - b.min[1]) * 1.5 + 2
    this.shadowAllowed = standing && Number.isFinite(sx) && Number.isFinite(sy)
    if (!this.shadowAllowed) return
    this.shadow.scale.set(Math.max(sx, sy * 0.6), Math.max(sy, sx * 0.6), 1)
    this.shadow.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, b.min[2] - 0.05)
  }

  setState(next: Partial<ViewerState>): void {
    const previous = this.state.isolated
    this.applyState(next)
    const isolated = this.state.isolated
    if (sameIsolation(previous, isolated)) return
    if (isolated?.length) {
      this.beforeIsolation ??= {
        position: this.controls.getPosition(new Vector3(), false),
        target: this.controls.getTarget(new Vector3(), false),
        near: this.camera.near,
        far: this.camera.far,
        fitDistance: this.fitDistance,
      }
      this.frameAll()
    } else if (this.beforeIsolation) {
      const { position, target, near, far, fitDistance } = this.beforeIsolation
      this.beforeIsolation = null
      this.fitDistance = fitDistance
      this.camera.near = near
      this.camera.far = far
      this.camera.updateProjectionMatrix()
      void this.controls.setLookAt(
        position.x,
        position.y,
        position.z,
        target.x,
        target.y,
        target.z,
        !reducedMotion(),
      )
    }
  }

  /** Applies state without recording camera history, including during capture. */
  private applyState(next: Partial<ViewerState>): void {
    const prior = this.state
    this.state = { ...prior, ...next }
    if (
      this.state.hidden !== prior.hidden ||
      this.state.hiddenStones !== prior.hiddenStones ||
      this.state.hiddenParts !== prior.hiddenParts ||
      this.state.isolated !== prior.isolated
    )
      this.isVisible = createViewVisibility(this.state)
    this.applyLook()
  }

  /** Assigns materials, visibility and overlays for the current mode and selection. */
  private applyLook(): void {
    const b = this.built
    this.clearOverlay()
    if (!b || !this.evaluation) {
      this.invalidate()
      return
    }
    const { display, xray, selection, hover, stone, part } = this.state
    const m = this.materials

    this.standIn = this.wantsStandIn()
    this.applyMaterials()
    if (b.visibility !== this.isVisible) {
      const { hiddenParts = [], isolated = [] } = this.state
      const exactParts = [...hiddenParts, ...isolated.map((target) => target.partId), part]
      for (const batch of b.metals.values())
        batch.setVisibility(
          this.isVisible,
          exactParts.some((id) => batch.ownsShell(id)),
        )
      for (const batch of b.gems.values()) batch.setVisibility(this.isVisible)
      b.visibility = this.isVisible
    }
    this.shadow.visible =
      this.shadowAllowed &&
      display !== 'technical' &&
      !xray &&
      !this.state.isolated?.length &&
      [...b.metals.keys()].some((mesh) => mesh.visible && !mesh.userData.reference)
    if (display === 'technical') this.addTechnical(b)
    else if (xray) this.addEdges(m.xrayEdges)
    this.addGhosts()

    const selected = new Set(selection)
    const isSelected = (target: ViewerPick) =>
      selected.has(target.nodeId) &&
      (stone == null || target.stoneId === stone) &&
      (part == null || target.partId === part)
    const aiTint = new Set(this.state.aiTint ?? [])
    if (aiTint.size)
      this.outline(
        b,
        (target) => aiTint.has(target.nodeId) && !selected.has(target.nodeId),
        null,
        m.aiTint,
      )
    this.outline(b, isSelected, m.selected, m.tint)
    if (hover)
      this.outline(
        b,
        (target) =>
          !isSelected(target) &&
          target.nodeId === hover.nodeId &&
          (hover.stoneId === undefined || target.stoneId === hover.stoneId) &&
          (hover.partId === undefined || target.partId === hover.partId),
        m.hovered,
        null,
      )
    this.invalidate()
  }

  /** The rendered look is too heavy to move on this machine: clay while it moves (see ./adaptive). */
  private wantsStandIn(): boolean {
    const { display, xray } = this.state
    return display === 'rendered' && !xray && this.isLight() && this.quality().effects === 'minimal'
  }

  /** Metal and stone materials for the display mode, x-ray and stand-ins; overlays untouched. */
  private applyMaterials(): void {
    const b = this.built
    if (!b) return
    const { display, xray } = this.state
    const m = this.materials
    const clay = display === 'clay' || this.standIn
    for (const mesh of b.metals.keys())
      mesh.material =
        xray && display !== 'technical'
          ? m.xray
          : display === 'technical'
            ? m.paper
            : clay || (mesh.userData.reference && !mesh.userData.hasSourceAppearance)
              ? m.clayMetal
              : b.originals.get(mesh)!
    for (const gems of b.gems.keys())
      gems.material = clay
        ? m.clayStone
        : display === 'technical'
          ? m.paper
          : b.originals.get(gems)!
  }

  private clearOverlay(): void {
    for (const child of [...this.overlay.children]) {
      child.removeFromParent()
      // Overlays share the model's geometry and the mode materials; only built lines and ghosts
      // own theirs. Instanced overlays own their instance-matrix buffer.
      if (child.userData.ownsGeometry) (child as Mesh).geometry.dispose()
      if (child instanceof InstancedMesh) child.dispose()
    }
  }

  /** Outlines (and tints) the visible geometry of each matching target. */
  private outline(
    b: Built,
    match: (target: ViewerPick) => boolean,
    material: OutlineMaterial | null,
    tint: MeshBasicMaterial | null,
  ): void {
    for (const batch of b.metals.values()) {
      const geometry = batch.matchingGeometry(match)
      if (!geometry) continue
      const ink = material ? new Mesh(geometry, material) : null
      const color = tint ? new Mesh(geometry, tint) : null
      const owner = ink ?? color
      if (owner && geometry !== batch.mesh.geometry) owner.userData.ownsGeometry = true
      if (ink) this.overlay.add(ink)
      if (color) this.overlay.add(color)
    }
    for (const [mesh, { targets }] of b.gems) {
      const picked: number[] = []
      targets.forEach((target, i) => {
        if (match(target)) picked.push(i)
      })
      if (!picked.length) continue
      const batch = material ? new InstancedMesh(mesh.geometry, material, picked.length) : null
      const tinted = tint ? new InstancedMesh(mesh.geometry, tint, picked.length) : null
      const matrix = new Matrix4()
      picked.forEach((i, k) => {
        mesh.getMatrixAt(i, matrix)
        batch?.setMatrixAt(k, matrix)
        tinted?.setMatrixAt(k, matrix)
      })
      if (batch) this.overlay.add(batch)
      if (tinted) this.overlay.add(tinted)
    }
  }

  /** Technical drawing: ink silhouettes around everything, crease edges on metal and hero stones. */
  private addTechnical(b: Built): void {
    const m = this.materials
    this.outline(b, () => true, m.silhouette, null)
    const gems = [...b.gems.keys()].filter((mesh) => mesh.visible)
    const stones = gems.reduce((n, g) => n + g.count, 0)
    this.addEdges(m.edges, stones <= MAX_EDGED_STONES ? gems.flatMap(stoneEdges) : [])
  }

  /** The visible parts' feature edges (and `extra` segments) as one line overlay. */
  private addEdges(material: LineBasicMaterial, extra: Float32Array[] = []): void {
    const chunks = this.evaluation!.parts.filter((p) =>
      this.isVisible({ nodeId: p.nodeId, partId: p.id }),
    ).map((p) => p.edges)
    chunks.push(...extra)
    const total = chunks.reduce((n, c) => n + c.length, 0)
    if (!total) return
    const positions = new Float32Array(total)
    let offset = 0
    for (const c of chunks) {
      positions.set(c, offset)
      offset += c.length
    }
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(positions, 3))
    const lines = new LineSegments(g, material)
    lines.userData.ownsGeometry = true
    this.overlay.add(lines)
  }

  private addGhosts(): void {
    const failed = new Set(
      this.evaluation!.diagnostics.filter((d) => d.code === 'feature.failed').map((d) => d.nodeId!),
    )
    for (const nodeId of failed)
      for (const part of this.lastGood.get(nodeId) ?? []) {
        if (!this.isVisible({ nodeId, partId: part.id })) continue
        if (this.state.hiddenParts?.some((id) => isShellOf(part.id, id))) continue
        const g = new BufferGeometry()
        g.setAttribute('position', new BufferAttribute(part.mesh.positions, 3))
        g.setAttribute('normal', new BufferAttribute(part.mesh.normals, 3))
        g.setIndex(new BufferAttribute(part.mesh.indices, 1))
        const ghost = new Mesh(g, this.materials.ghost)
        ghost.userData.ownsGeometry = true
        this.overlay.add(ghost)
      }
  }

  // ── Camera ───────────────────────────────────────────────────────────────────────────────

  private visibleMetalParts(): Part[] {
    const parts: Part[] = []
    for (const batch of this.built?.metals.values() ?? [])
      if (batch.mesh.visible) parts.push(batch.visiblePart)
    return parts
  }

  private pointsFor(nodeIds?: readonly string[], includeConstruction = true): Vec3[] {
    const e = this.evaluation
    if (!nodeIds?.length && this.frameFocus.length) {
      const focused = this.nodePoints(this.frameFocus, includeConstruction)
      if (focused.length) return focused
    }
    if (!nodeIds?.length) {
      const construction = includeConstruction
        ? this.constructionFrame
            .filter((curve) => this.isVisible(curve))
            .flatMap((curve) => curve.points)
        : []
      if (!e) return construction
      const parts = this.visibleMetalParts()
      const stones = e.stones.filter((s) => this.isVisible({ nodeId: s.nodeId, stoneId: s.id }))
      if (!parts.length && !stones.length) return construction
      const subject = subjectOf({ ...e, parts, stones })
      return [...(subject.silhouette ?? corners(e.report.bounds)), ...construction]
    }
    const pts = this.nodePoints(nodeIds, includeConstruction)
    return pts.length ? pts : this.pointsFor(undefined, includeConstruction)
  }

  private nodePoints(nodeIds: readonly string[], includeConstruction = true): Vec3[] {
    const e = this.evaluation
    const ids = new Set(nodeIds)
    const pts: Vec3[] = includeConstruction
      ? this.constructionFrame
          .filter((curve) => ids.has(curve.nodeId) && this.isVisible(curve))
          .flatMap((curve) => curve.points)
      : []
    for (const part of this.visibleMetalParts())
      if (ids.has(part.nodeId)) pts.push(...corners(part.bounds))
    for (const s of e?.stones ?? [])
      if (ids.has(s.nodeId) && this.isVisible({ nodeId: s.nodeId, stoneId: s.id })) {
        const r = s.dims.width * 0.6
        const c: Vec3 = [s.matrix[12]!, s.matrix[13]!, s.matrix[14]!]
        pts.push(
          ...corners({ min: [c[0] - r, c[1] - r, c[2] - r], max: [c[0] + r, c[1] + r, c[2] + r] }),
        )
      }
    return pts
  }

  /** Points the camera from an orbit angle (degrees, Z-up: azimuth 0 = front) at `pts`. */
  private look(
    azimuth: number,
    elevation: number,
    pts: Vec3[],
    fill: number,
    animate: boolean,
  ): void {
    if (!pts.length) return
    // Framed into the part no panel covers: its aspect, with the fill rescaled because
    // `viewTangents` puts the sensor on that part's larger side, not on the canvas's.
    const [, tyCanvas] = viewTangents(FOCAL_MM, this.camera.aspect)
    const [, tyFree] = viewTangents(FOCAL_MM, this.freeAspect)
    const { target, distance } = framePoints(
      pts,
      azimuth,
      elevation,
      FOCAL_MM,
      this.freeAspect,
      (fill * this.safeFraction * tyCanvas) / tyFree,
    )
    const { back } = cameraBasis(azimuth, elevation)
    const pos = toThreePoint([
      target[0] + back[0] * distance,
      target[1] + back[1] * distance,
      target[2] + back[2] * distance,
    ])
    const t = toThreePoint(target)
    this.fitDistance = distance
    this.camera.near = Math.max(0.05, distance * 0.02)
    this.camera.far = distance * 50
    this.camera.updateProjectionMatrix()
    void this.controls.setLookAt(pos.x, pos.y, pos.z, t.x, t.y, t.z, animate && !reducedMotion())
    this.invalidate()
  }

  /**
   * The share of the view's height the piece may fill: the floating toolbars and the facts
   * strip cover a band at the top and bottom, and nothing should be framed underneath them.
   * Captures have no HUD and use the whole picture.
   */
  private safeFraction = 1

  private updateSafeFraction(): void {
    this.safeFraction = Math.max(0.5, (this.height - 2 * HUD_BAND_PX) / this.height)
  }

  /**
   * Pixels at the right of the view that a docked panel covers (the Replace stone dialog on a
   * narrow window). The picture is shifted so the orbit centre sits in the middle of the rest,
   * and framing fits the rest; picking and `project` follow, since they use the same camera.
   */
  private insetRight = 0
  /** Whether setting the inset re-framed the piece, so clearing it frames it back. */
  private insetFramed = false

  private applyInset(): void {
    if (this.insetRight > 0)
      this.camera.setViewOffset(
        this.width,
        this.height,
        this.insetRight / 2,
        0,
        this.width,
        this.height,
      )
    else this.camera.clearViewOffset()
  }

  /** The aspect framing fits into: the part of the view no panel covers. */
  private get freeAspect(): number {
    return (this.camera.aspect * (this.width - this.insetRight)) / this.width
  }

  /**
   * Keeps the piece clear of a panel docked over the right of the view: when part of it would
   * sit under the panel, it is framed again (from the same direction) in the part left free;
   * when the panel goes, a piece framed that way gets its usual fill back.
   */
  setInsetRight(px: number): void {
    const next = Math.round(Math.max(0, Math.min(px, this.width * 0.6)))
    if (next === this.insetRight) return
    this.insetRight = next
    this.applyInset()
    if (next > 0 && this.evaluation && !this.fitsFree()) {
      this.insetFramed = true
      this.frameAll()
    } else if (next === 0 && this.insetFramed) {
      this.insetFramed = false
      this.frameAll()
    }
    this.invalidate()
  }

  /** Whether the whole piece is on screen left of the inset (and inside the HUD bands). */
  private fitsFree(): boolean {
    const pts = this.pointsFor().map((p) => this.project(p))
    return pts.every(
      (p) =>
        p.visible &&
        p.x >= 0 &&
        p.x <= this.width - this.insetRight &&
        p.y >= HUD_BAND_PX &&
        p.y <= this.height - HUD_BAND_PX,
    )
  }

  /** Frames the whole piece (or the given nodes) from the current direction. */
  frameAll(animate = true, nodeIds?: readonly string[]): void {
    const pts = this.pointsFor(nodeIds)
    const { azimuth, elevation } = this.orbitAngles()
    this.look(azimuth, elevation, pts, nodeIds?.length ? 0.5 : 0.66, animate)
  }

  /**
   * Frames a point (a diagnostic's location) with enough of its surroundings to recognise
   * where it is: at least `radius` mm around it, or the whole of `nodeId` when that is larger.
   */
  frameAt(at: Vec3, nodeId?: string, radius = 4): void {
    const { azimuth, elevation } = this.orbitAngles()
    const around = corners({
      min: at.map((v) => v - radius) as Vec3,
      max: at.map((v) => v + radius) as Vec3,
    })
    const node = nodeId ? this.nodePoints([nodeId]) : []
    this.look(azimuth, elevation, [...around, ...node], 0.75, true)
  }

  view(preset: CameraPreset, animate = true): void {
    const p = CAMERA_PRESETS[preset]
    this.look(p.azimuth, p.elevation, this.pointsFor(), p.fill, animate)
  }

  /**
   * The camera as a render shot stores it ("Render this view"): Z-up position and target in
   * mm, this view's lens, and the piece's bounds centre and radius it is framed against.
   */
  shotCamera(): {
    position: Vec3
    target: Vec3
    focalLength: number
    framedOn: { center: Vec3; radius: number } | null
  } {
    const toZUp = (v: Vector3): Vec3 => [v.x, -v.z, v.y]
    const bounds = this.evaluation?.report.bounds
    return {
      position: toZUp(this.controls.getPosition(new Vector3())),
      target: toZUp(this.controls.getTarget(new Vector3())),
      focalLength: FOCAL_MM,
      framedOn: bounds ? { center: boundsCenter(bounds), radius: boundsRadius(bounds) } : null,
    }
  }

  /** The camera's current orbit angles in the Z-up convention of `cameraBasis`. */
  private orbitAngles(): { azimuth: number; elevation: number } {
    const pos = this.controls.getPosition(new Vector3())
    const target = this.controls.getTarget(new Vector3())
    const d = pos.sub(target).normalize()
    // three (x, y, z) = Z-up (x, z, -y): back = (sin a cos e, -cos a cos e, sin e) in Z-up.
    const zx = d.x
    const zy = -d.z
    const zz = d.y
    return {
      azimuth: (Math.atan2(zx, -zy) * 180) / Math.PI,
      elevation: (Math.asin(Math.max(-1, Math.min(1, zz))) * 180) / Math.PI,
    }
  }

  orbit(dAzimuthDeg: number, dElevationDeg: number): void {
    const k = Math.PI / 180
    void this.controls.rotate(dAzimuthDeg * k, dElevationDeg * k, !reducedMotion())
    this.invalidate()
  }

  zoom(factor: number, at?: readonly [x: number, y: number]): void {
    if (!(factor > 0) || !Number.isFinite(factor) || factor === 1) return
    const from = this.controls.getSpherical(this.zoomOrbit).radius
    const to = Math.max(
      this.controls.minDistance,
      Math.min(this.controls.maxDistance, from / factor),
    )
    if (at) {
      // Keep the point under the pointer on the orbit plane while dollying, as with the mouse wheel.
      const ndc = this.ndc(...at)
      const ray = new Vector3(ndc.x, ndc.y, 0)
        .unproject(this.camera)
        .sub(this.camera.position)
        .applyQuaternion(this.camera.quaternion.clone().invert())
      const scale = (from - to) / -ray.z
      void this.controls.truck(ray.x * scale, -ray.y * scale, !reducedMotion())
    }
    this.setZoomDistance(to, true)
  }

  setZoomDistance(distance: number, animate = false): void {
    void this.controls.dollyTo(distance, animate && !reducedMotion())
    this.invalidate()
  }

  /** Camera magnification relative to the last fitted view. */
  get zoomPercent(): number | null {
    return this.fitDistance === null
      ? null
      : Math.max(1, Math.round((this.fitDistance / this.controls.distance) * 100))
  }

  /** Looks straight at an image plane's view (front, top or right), framing the piece. */
  alignView(view: ImagePlaneView, animate = true): void {
    const { azimuth, elevation } = VIEW_ANGLES[view]
    this.look(azimuth, elevation, this.pointsFor(), 0.66, animate)
  }

  // ── Image planes ─────────────────────────────────────────────────────────────────────────

  setImagePlanes(specs: readonly ImagePlaneSpec[]): void {
    this.planes.set(specs)
  }

  private ndc(x: number, y: number): Vector2 {
    return new Vector2((x / this.width) * 2 - 1, -(y / this.height) * 2 + 1)
  }

  /** The image plane under a point in CSS pixels, or null. */
  pickPlane(x: number, y: number): string | null {
    return this.planes.pick(this.ndc(x, y), this.camera)
  }

  /** Where a point in CSS pixels falls on a view's picture plane, in that view's mm. */
  pointOnPlane(view: ImagePlaneView, x: number, y: number): [number, number] | null {
    return this.planes.pointOn(view, this.ndc(x, y), this.camera)
  }

  // ── Picking ──────────────────────────────────────────────────────────────────────────────

  private readonly raycaster = new Raycaster()

  /** What is under a point given in CSS pixels relative to the canvas. */
  pick(x: number, y: number, precise = true): ViewerPick | null {
    const b = this.built
    this.camera.updateMatrixWorld()
    this.raycaster.setFromCamera(this.ndc(x, y), this.camera)
    const depth = this.camera.getWorldDirection(new Vector3()).dot(this.raycaster.ray.direction)
    this.raycaster.near = this.camera.near / depth
    this.raycaster.far = this.camera.far / depth
    this.raycaster.firstHitOnly = true
    const targets = b ? [...b.gems.keys(), ...b.metals.keys()].filter((mesh) => mesh.visible) : []
    for (const target of targets) {
      target.updateWorldMatrix(true, false)
      indexForPicking(target)
    }
    const hit = this.raycaster.intersectObjects(targets, false)[0]
    if (!hit || !b)
      return pickConstructionCurve(
        { x, y },
        this.constructionFrame,
        (point) => this.project(point),
        this.isVisible,
      )
    if (hit.object instanceof InstancedMesh && hit.instanceId !== undefined)
      return b.gems.get(hit.object)?.targets[hit.instanceId] ?? null
    const metal = b.metals.get(hit.object as Mesh)
    if (!metal) return null
    return metal.pick(hit.faceIndex ?? undefined, b.exactMetalNodes.has(metal.part.nodeId), precise)
  }

  /** Whether the camera is being moved (picking pauses meanwhile). */
  get isMoving(): boolean {
    return this.moving
  }

  // ── Capture ──────────────────────────────────────────────────────────────────────────────

  /**
   * Renders views of the piece at `size`×`size` into PNGs, in the live canvas (so tone mapping
   * and materials match the viewport) and within one task, then restores the viewport.
   */
  async capture(opts: CaptureOptions): Promise<Blob[]> {
    const saved = {
      evaluation: this.inputEvaluation,
      state: this.state,
      position: this.controls.getPosition(new Vector3()),
      target: this.controls.getTarget(new Vector3()),
      near: this.camera.near,
      far: this.camera.far,
      fitDistance: this.fitDistance,
      width: this.width,
      height: this.height,
      insetRight: this.insetRight,
    }
    if (opts.evaluation) this.setEvaluation(opts.evaluation)
    const canvases: HTMLCanvasElement[] = []
    try {
      this.renderer.setPixelRatio(1)
      this.renderer.setSize(opts.size, opts.size, false)
      // A picture has no panel over it: centred and framed on the whole square.
      this.insetRight = 0
      this.camera.clearViewOffset()
      this.camera.aspect = 1
      this.updateFov(1)
      for (const m of [this.materials.silhouette, this.materials.selected, this.materials.hovered])
        m.setResolution(opts.size, opts.size)
      this.safeFraction = 1
      // A picture of the piece shows all of it: hiding in the view is a working aid only, and the
      // glow on parts the assistant just edited is a cue for the person, not part of the piece.
      const captureState: Partial<ViewerState> = {
        display: opts.mode,
        selection: opts.focusNodeIds ?? [],
        stone: null,
        part: null,
        hover: null,
        hidden: [],
        hiddenStones: [],
        hiddenParts: [],
        isolated: [],
        xray: false,
        aiTint: [],
      }
      // A picture is never light: full effects and the real materials, whatever is moving.
      this.moving = false
      this.scrubbing = false
      this.applyState(captureState)
      this.applyGemQuality('full', false)
      const pts = this.pointsFor(opts.focusNodeIds)
      for (const view of opts.views) {
        const angle = typeof view === 'string' ? CAMERA_PRESETS[view] : { ...view, fill: 0.66 }
        this.look(angle.azimuth, angle.elevation, pts, 'fill' in angle ? angle.fill : 0.66, false)
        this.controls.update(0)
        this.renderer.render(this.scene, this.camera)
        const out = document.createElement('canvas')
        out.width = out.height = opts.size
        const ctx = out.getContext('2d')!
        opts.background?.(ctx, opts.size)
        ctx.drawImage(this.canvas, 0, 0, opts.size, opts.size)
        if (opts.labels) this.drawLabels(ctx, opts.labels, opts.size)
        canvases.push(out)
      }
    } finally {
      // Back to what the viewport showed, including a newer evaluation that reached it meanwhile.
      if (saved.evaluation && saved.evaluation !== this.inputEvaluation)
        this.setEvaluation(saved.evaluation)
      this.camera.near = saved.near
      this.camera.far = saved.far
      this.fitDistance = saved.fitDistance
      this.insetRight = saved.insetRight
      // setSize puts back the pixel ratio the current quality asks for.
      this.setSize(saved.width, saved.height)
      void this.controls.setLookAt(
        saved.position.x,
        saved.position.y,
        saved.position.z,
        saved.target.x,
        saved.target.y,
        saved.target.z,
        false,
      )
      this.applyState({
        ...saved.state,
        hiddenStones: saved.state.hiddenStones,
        hiddenParts: saved.state.hiddenParts,
        isolated: saved.state.isolated,
        part: saved.state.part,
      })
    }
    return Promise.all(
      canvases.map(
        (c) =>
          new Promise<Blob>((resolve, reject) =>
            c.toBlob((b) => (b ? resolve(b) : reject(new Error('Capture failed'))), 'image/png'),
          ),
      ),
    )
  }

  /** Names written beside each node's centre on a captured picture, in pills that stay inside it. */
  private drawLabels(
    ctx: CanvasRenderingContext2D,
    labels: Readonly<Record<string, string>>,
    size: number,
  ): void {
    const scale = size / 768
    ctx.font = `${Math.round(13 * scale)}px Inter, system-ui, sans-serif`
    ctx.textBaseline = 'middle'
    const pad = 6 * scale
    const h = 22 * scale
    for (const [nodeId, text] of Object.entries(labels)) {
      const pts = this.nodePoints([nodeId])
      if (!pts.length) continue
      const c = pts.reduce<Vec3>(
        (a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length, a[2] + p[2] / pts.length],
        [0, 0, 0],
      )
      const p = toThreePoint(c).project(this.camera)
      if (p.z < -1 || p.z > 1) continue
      const w = ctx.measureText(text).width + pad * 2
      const x = Math.min(size - w - 4, Math.max(4, ((p.x + 1) / 2) * size - w / 2))
      const y = Math.min(size - h - 4, Math.max(4, ((1 - p.y) / 2) * size - h / 2))
      ctx.fillStyle = 'rgba(255,255,255,0.92)'
      ctx.strokeStyle = 'rgba(0,0,0,0.18)'
      ctx.beginPath()
      ctx.roundRect(x, y, w, h, 6 * scale)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = '#1c1b1a'
      ctx.fillText(text, x + pad, y + h / 2)
    }
  }

  /** Mean milliseconds per frame over `n` synchronous renders, waiting for the GPU (benchmarks). */
  benchmark(n: number): number {
    const gl = this.renderer.getContext()
    const pixel = new Uint8Array(4)
    const start = performance.now()
    for (let i = 0; i < n; i++) {
      this.renderer.render(this.scene, this.camera)
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
    }
    return (performance.now() - start) / n
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────────────────

  private readonly onContextLost = (e: Event): void => {
    e.preventDefault()
    cancelAnimationFrame(this.frame)
    this.frame = 0
  }

  private readonly onContextRestored = (): void => {
    const evaluation = this.inputEvaluation
    this.inputEvaluation = null
    this.evaluation = null
    this.environment = null
    // GPU buffers did not survive the loss: nothing cached may be reused.
    for (const { geometry } of this.geometries.values()) geometry.dispose()
    this.geometries.clear()
    if (evaluation) this.setEvaluation(evaluation)
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.frame)
    clearTimeout(this.restTimer)
    clearTimeout(this.indexTimer)
    clearTimeout(this.scrubTimer)
    cancelAnimationFrame(this.stillProbe)
    this.unsubscribePerformance()
    this.qualityListeners.clear()
    this.clearOverlay()
    if (this.built) this.release(this.built)
    for (const { geometry } of this.geometries.values()) geometry.dispose()
    this.geometries.clear()
    this.lastGood.clear()
    this.environment?.dispose()
    this.planes.dispose()
    this.materials.dispose()
    this.shadow.geometry.dispose()
    const shadowMaterial = this.shadow.material as MeshBasicMaterial
    shadowMaterial.map?.dispose()
    shadowMaterial.dispose()
    this.controls.dispose()
    this.timer.dispose()
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost)
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored)
    this.renderer.dispose()
    // Browsers cap live WebGL contexts (~16): free this one now rather than at GC, unless the
    // canvas stays on the page for the next viewer (StrictMode's remount reuses it).
    if (!this.canvas.isConnected) this.renderer.forceContextLoss()
  }
}

/** Above this many stones, technical mode outlines stones without drawing their facets. */
const MAX_EDGED_STONES = 600
const unitEdges = new WeakMap<BufferGeometry, Float32Array>()

/** Facet edges of every visible stone of a batch, in model space. */
function stoneEdges(gems: InstancedMesh): Float32Array[] {
  let unit = unitEdges.get(gems.geometry)
  if (!unit) {
    // Low enough to catch the table, girdle and crown mains of a brilliant (crown facets meet
    // the table at ~15°), so a technical drawing shows the cut, not a partial outline.
    const edges = new EdgesGeometry(gems.geometry, 8)
    unit = edges.getAttribute('position').array as Float32Array
    edges.dispose()
    unitEdges.set(gems.geometry, unit)
  }
  const m = new Matrix4()
  const v = new Vector3()
  const out: Float32Array[] = []
  for (let i = 0; i < gems.count; i++) {
    gems.getMatrixAt(i, m)
    const placed = new Float32Array(unit.length)
    for (let k = 0; k < unit.length; k += 3) v.fromArray(unit, k).applyMatrix4(m).toArray(placed, k)
    out.push(placed)
  }
  return out
}

function sameIsolation(
  before: readonly ViewerPick[] = [],
  after: readonly ViewerPick[] = [],
): boolean {
  return (
    before === after ||
    (before.length === after.length &&
      before.every((a) =>
        after.some(
          (b) => a.nodeId === b.nodeId && a.stoneId === b.stoneId && a.partId === b.partId,
        ),
      ))
  )
}

function indexForPicking(mesh: Mesh): void {
  if (!mesh.geometry.boundsTree)
    // Indirection keeps face indices aligned with the evaluated triangles for shell picking.
    mesh.geometry.computeBoundsTree({ indirect: true })
}

function corners(b: Bounds): Vec3[] {
  return [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [
    i & 1 ? b.max[0] : b.min[0],
    i & 2 ? b.max[1] : b.min[1],
    i & 4 ? b.max[2] : b.min[2],
  ])
}
