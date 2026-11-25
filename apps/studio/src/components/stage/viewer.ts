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
import type { Bounds, Evaluation, Part } from '@pave/kernel'
import {
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
import { RenderSceneSchema } from '@pave/schema'
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
import { viewportScene } from './environment'
import {
  contactShadowTexture,
  createModeMaterials,
  type ModeMaterials,
  type OutlineMaterial,
  readPalette,
} from './materials'
import { type GpuTier, gpuTier, type QualityPolicy, qualityFor } from './quality'

CameraControls.install({
  THREE: { Vector2, Vector3, Vector4, Quaternion, Matrix4, Spherical, Box3, Sphere, Raycaster },
})
// Picking through BVHs: instant even on thousands of pavé stones.
Mesh.prototype.raycast = acceleratedRaycast
;(BufferGeometry.prototype as unknown as { computeBoundsTree: unknown }).computeBoundsTree =
  computeBoundsTree

export type DisplayMode = 'rendered' | 'clay' | 'technical'

export interface ViewerPick {
  nodeId: string
  stoneId?: string
}

export interface ViewerState {
  display: DisplayMode
  selection: readonly string[]
  stone: string | null
  hover: ViewerPick | null
  hidden: readonly string[]
  xray: boolean
}

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
  metals: Mesh[]
  gems: InstancedMesh[]
  originals: Map<Mesh, Material>
  /** Instance matrices as evaluated, to restore after hiding. */
  matrices: Map<InstancedMesh, Float32Array>
}

/** Metal geometry kept across evaluations by `Part.rev`, with its picking BVH and GPU buffers. */
interface CachedGeometry {
  geometry: BufferGeometry
  /** The evaluation that last used it; entries no evaluation uses any more are disposed. */
  used: number
}

const stoneNode = (stoneId: string) => stoneId.slice(0, stoneId.lastIndexOf(':'))

export class Viewer {
  readonly renderer: WebGLRenderer
  readonly scene = new Scene()
  readonly camera = new PerspectiveCamera(30, 1, 0.1, 5000)
  readonly controls: CameraControls
  readonly tier: GpuTier
  private readonly policy: QualityPolicy
  private materials: ModeMaterials
  private readonly overlay: Group = zUpGroup('cad-overlay')
  private readonly decor: Group = zUpGroup('cad-decor')
  private readonly shadow: Mesh
  private built: Built | null = null
  private evaluation: Evaluation | null = null
  private environment: PaveEnvironment | null = null
  private envRadius = 0
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
  private readonly timer = new Timer()
  private frame = 0
  private moving = false
  private restTimer: ReturnType<typeof setTimeout> | undefined
  private width = 1
  private height = 1
  private framedOnce = false
  private disposed = false
  /** Milliseconds the last frames took to submit (CPU side), for the performance readout. */
  readonly frameTimes: number[] = []
  private readonly renderListeners = new Set<() => void>()
  /** Nodes the default framing is about (e.g. a pendant without its chain); empty = everything. */
  private frameFocus: readonly string[] = []
  private shadowAllowed = false

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
    this.materials = createModeMaterials(readPalette(themeRoot))
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
    this.timer.update()
    const moving = this.controls.update(this.timer.getDelta())
    this.draw()
    if (moving) this.invalidate()
  }

  private draw(): void {
    const start = performance.now()
    this.renderer.render(this.scene, this.camera)
    this.frameTimes.push(performance.now() - start)
    if (this.frameTimes.length > 60) this.frameTimes.shift()
    for (const l of this.renderListeners) l()
  }

  /** Calls `listener` after every drawn frame (to pin HTML to the model); returns the unsubscribe. */
  onRender(listener: () => void): () => void {
    this.renderListeners.add(listener)
    return () => this.renderListeners.delete(listener)
  }

  /** Where a model point (Z-up mm) appears, in CSS pixels from the canvas's top-left. */
  project(point: Vec3): { x: number; y: number; visible: boolean } {
    const p = toThreePoint(point).project(this.camera)
    return {
      x: ((p.x + 1) / 2) * this.width,
      y: ((1 - p.y) / 2) * this.height,
      visible: p.z > -1 && p.z < 1 && Math.abs(p.x) <= 1.05 && Math.abs(p.y) <= 1.05,
    }
  }

  /** The screen rectangle (CSS pixels) the nodes' bounds cover, or null when none is in front. */
  screenBounds(
    nodeIds: readonly string[],
  ): { x0: number; y0: number; x1: number; y1: number } | null {
    if (!this.evaluation) return null
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
    this.applyGemQuality()
  }

  private readonly stopMoving = (): void => {
    clearTimeout(this.restTimer)
    // Refine the gems once the camera has settled for a moment.
    this.restTimer = setTimeout(() => {
      this.moving = false
      this.applyGemQuality()
      this.invalidate()
    }, 150)
  }

  private applyGemQuality(): void {
    const model = this.built?.model
    if (!model || !this.evaluation) return
    const melee = this.evaluation.stones.filter((s) => s.role === 'melee' || s.role === 'accent')
    const set = this.moving ? this.policy.moving : this.policy.rest
    model.setGemQuality('hero', set.hero)
    model.setGemQuality(
      'melee',
      melee.length > this.policy.meleeBudget ? this.policy.moving.melee : set.melee,
    )
  }

  setSize(width: number, height: number): void {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    const dpr = Math.min(window.devicePixelRatio || 1, this.policy.maxDpr)
    this.renderer.setPixelRatio(dpr)
    this.renderer.setSize(this.width, this.height, false)
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
    this.setSize(this.width, this.height)
    this.applyLook()
  }

  // ── Content ──────────────────────────────────────────────────────────────────────────────

  setEvaluation(evaluation: Evaluation): void {
    if (evaluation === this.evaluation) return
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

    this.evaluation = evaluation
    const resolved = viewportScene(
      resolveScene(
        RenderSceneSchema.parse({ look: 'studio-soft', output: { width: 1024, height: 1024 } }),
        evaluation,
      ),
    )
    configureRenderer(this.renderer, resolved)
    this.renderer.shadowMap.enabled = false
    const radius = resolved.subject.radius
    if (!this.environment || Math.abs(radius - this.envRadius) / this.envRadius > 0.3) {
      this.environment?.dispose()
      this.environment = createEnvironment(
        this.renderer,
        resolved,
        this.tier === 'software' ? 128 : 256,
      )
      this.envRadius = radius
      this.scene.environment = this.environment.texture
    }

    const previous = this.built
    const model = evaluationToThree(evaluation, resolved, {
      environment: this.environment,
      gemQuality: this.policy.rest,
    })
    const metals: Mesh[] = []
    const gems: InstancedMesh[] = []
    const originals = new Map<Mesh, Material>()
    const matrices = new Map<InstancedMesh, Float32Array>()
    const revs = new Map(evaluation.parts.map((p) => [p.id, p.rev]))
    const generation = ++this.generation
    model.object.traverse((o) => {
      if (o instanceof InstancedMesh) {
        gems.push(o)
        matrices.set(o, (o.instanceMatrix.array as Float32Array).slice())
        originals.set(o, o.material as Material)
      } else if (o instanceof Mesh) {
        metals.push(o)
        originals.set(o, o.material as Material)
        this.reuseGeometry(o, revs.get(o.name), generation)
      }
    })
    this.built = { model, metals, gems, originals, matrices }
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
    if (!this.framedOnce && evaluation.parts.length + evaluation.stones.length > 0) {
      this.framedOnce = true
      this.view(this.defaultView(), false)
    }
  }

  /**
   * Swaps a freshly built part geometry for the one already on the GPU when the part's `rev`
   * is unchanged, so a scrub re-uploads (and re-indexes for picking) only what it changed. The
   * new geometry has not been drawn yet, so dropping it costs nothing.
   */
  private reuseGeometry(mesh: Mesh, rev: string | undefined, generation: number): void {
    if (!rev) return
    const cached = this.geometries.get(rev)
    if (cached) {
      mesh.geometry.dispose()
      mesh.geometry = cached.geometry
      cached.used = generation
    } else this.geometries.set(rev, { geometry: mesh.geometry, used: generation })
  }

  /**
   * Disposes a replaced model's materials and the geometries the cache no longer holds.
   * (`PaveModel.dispose` would also dispose the geometries the new model reuses.)
   */
  private release(b: Built): void {
    b.model.object.removeFromParent()
    const kept = new Set([...this.geometries.values()].map((e) => e.geometry))
    const done = new Set<object>()
    b.model.object.traverse((o) => {
      if (!(o instanceof Mesh)) return
      if (!kept.has(o.geometry) && !done.has(o.geometry)) o.geometry.dispose()
      const material = b.originals.get(o) ?? (o.material as Material)
      if (!done.has(material)) {
        material.dispose()
        // A gem shader's BVH lives in data textures that `Material.dispose` does not free;
        // without this every evaluation leaks them (a software GPU runs out mid-scrub).
        bvhOf(material)?.dispose()
      }
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
        if (this.built === b) for (const t of [...b.metals, ...b.gems]) indexForPicking(t)
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
    this.state = { ...this.state, ...next }
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
    const { display, xray, hidden, selection, hover, stone } = this.state
    const m = this.materials
    const hiddenSet = new Set(hidden)

    for (const mesh of b.metals) {
      const nodeId = mesh.userData.nodeId as string
      mesh.visible = !hiddenSet.has(nodeId)
      mesh.material =
        xray && display !== 'technical'
          ? m.xray
          : display === 'clay'
            ? m.clayMetal
            : display === 'technical'
              ? m.paper
              : b.originals.get(mesh)!
    }
    const zero = new Matrix4().makeScale(0, 0, 0).elements
    for (const gems of b.gems) {
      gems.material =
        display === 'clay'
          ? m.clayStone
          : display === 'technical'
            ? m.paper
            : b.originals.get(gems)!
      const ids = gems.userData.stoneIds as string[]
      const original = b.matrices.get(gems)!
      const arr = gems.instanceMatrix.array as Float32Array
      arr.set(original)
      ids.forEach((id, i) => {
        if (hiddenSet.has(stoneNode(id))) arr.set(zero, i * 16)
      })
      gems.instanceMatrix.needsUpdate = true
    }
    this.shadow.visible = this.shadowAllowed && display !== 'technical' && !xray
    if (display === 'technical') this.addTechnical(b)
    else if (xray) this.addEdges(m.xrayEdges)
    this.addGhosts()

    const selected = new Set(selection)
    this.outline(b, (id) => selected.has(id), stone, m.selected, true)
    if (hover && !selected.has(hover.nodeId))
      this.outline(b, (id) => id === hover.nodeId, hover.stoneId ?? null, m.hovered, false)
    this.invalidate()
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

  /** Outlines (and tints) the parts and stones of the nodes `match` accepts. */
  private outline(
    b: Built,
    match: (nodeId: string) => boolean,
    stone: string | null,
    material: OutlineMaterial,
    tint: boolean,
  ): void {
    const hidden = new Set(this.state.hidden)
    for (const mesh of b.metals) {
      const id = mesh.userData.nodeId as string
      if (!match(id) || hidden.has(id)) continue
      this.overlay.add(new Mesh(mesh.geometry, material))
      if (tint) this.overlay.add(new Mesh(mesh.geometry, this.materials.tint))
    }
    for (const gems of b.gems) {
      const ids = gems.userData.stoneIds as string[]
      const picked = ids
        .map((id, i) => [id, i] as const)
        .filter(([id]) =>
          stone ? id === stone : match(stoneNode(id)) && !hidden.has(stoneNode(id)),
        )
      if (!picked.length) continue
      const batch = new InstancedMesh(gems.geometry, material, picked.length)
      const tinted = tint
        ? new InstancedMesh(gems.geometry, this.materials.tint, picked.length)
        : null
      const mat = new Matrix4()
      picked.forEach(([, i], k) => {
        gems.getMatrixAt(i, mat)
        batch.setMatrixAt(k, mat)
        tinted?.setMatrixAt(k, mat)
      })
      this.overlay.add(batch)
      if (tinted) this.overlay.add(tinted)
    }
  }

  /** Technical drawing: ink silhouettes around everything, crease edges on metal and hero stones. */
  private addTechnical(b: Built): void {
    const hidden = new Set(this.state.hidden)
    const m = this.materials
    for (const mesh of b.metals) {
      if (hidden.has(mesh.userData.nodeId)) continue
      this.overlay.add(new Mesh(mesh.geometry, m.silhouette))
    }
    for (const gems of b.gems) {
      const outline = new InstancedMesh(gems.geometry, m.silhouette, gems.count)
      outline.instanceMatrix.copy(gems.instanceMatrix)
      this.overlay.add(outline)
    }
    const stones = b.gems.reduce((n, g) => n + g.count, 0)
    this.addEdges(m.edges, stones <= MAX_EDGED_STONES ? b.gems.flatMap(stoneEdges) : [])
  }

  /** The visible parts' feature edges (and `extra` segments) as one line overlay. */
  private addEdges(material: LineBasicMaterial, extra: Float32Array[] = []): void {
    const hidden = new Set(this.state.hidden)
    const chunks = this.evaluation!.parts.filter((p) => !hidden.has(p.nodeId)).map((p) => p.edges)
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

  private pointsFor(nodeIds?: readonly string[]): Vec3[] {
    const e = this.evaluation
    if (!e) return []
    if (!nodeIds?.length && this.frameFocus.length) {
      const focused = this.nodePoints(this.frameFocus)
      if (focused.length) return focused
    }
    if (!nodeIds?.length) {
      const subject = subjectOf(e)
      return subject.silhouette ?? corners(e.report.bounds)
    }
    const pts = this.nodePoints(nodeIds)
    return pts.length ? pts : this.pointsFor()
  }

  private nodePoints(nodeIds: readonly string[]): Vec3[] {
    const e = this.evaluation!
    const ids = new Set(nodeIds)
    const pts: Vec3[] = []
    for (const p of e.parts) if (ids.has(p.nodeId)) pts.push(...corners(p.bounds))
    for (const s of e.stones)
      if (ids.has(s.nodeId)) {
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

  private defaultView(): CameraPreset {
    return this.evaluation && this.evaluation.report.ringInnerDiameter !== undefined
      ? 'hero'
      : 'front'
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

  zoom(factor: number): void {
    void this.controls.zoom(factor, !reducedMotion())
    this.invalidate()
  }

  // ── Picking ──────────────────────────────────────────────────────────────────────────────

  private readonly raycaster = new Raycaster()

  /** What is under a point given in CSS pixels relative to the canvas. */
  pick(x: number, y: number): ViewerPick | null {
    const b = this.built
    if (!b) return null
    this.raycaster.setFromCamera(
      new Vector2((x / this.width) * 2 - 1, -(y / this.height) * 2 + 1),
      this.camera,
    )
    const targets = [...b.gems, ...b.metals.filter((m) => m.visible)]
    for (const t of targets) indexForPicking(t)
    const hit = this.raycaster.intersectObjects(targets, false)[0]
    if (!hit) return null
    if (hit.object instanceof InstancedMesh && hit.instanceId !== undefined) {
      const stoneId = (hit.object.userData.stoneIds as string[])[hit.instanceId]!
      if (this.state.hidden.includes(stoneNode(stoneId))) return null
      return { nodeId: stoneNode(stoneId), stoneId }
    }
    return { nodeId: hit.object.userData.nodeId as string }
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
      evaluation: this.evaluation,
      state: this.state,
      position: this.controls.getPosition(new Vector3()),
      target: this.controls.getTarget(new Vector3()),
      near: this.camera.near,
      far: this.camera.far,
      width: this.width,
      height: this.height,
      dpr: this.renderer.getPixelRatio(),
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
      // A picture of the piece shows all of it: hiding in the view is a working aid only.
      this.state = {
        ...this.state,
        display: opts.mode,
        selection: opts.focusNodeIds ?? [],
        stone: null,
        hover: null,
        hidden: [],
        xray: false,
      }
      this.applyLook()
      this.moving = false
      this.applyGemQuality()
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
      if (saved.evaluation && saved.evaluation !== this.evaluation)
        this.setEvaluation(saved.evaluation)
      this.state = saved.state
      this.camera.near = saved.near
      this.camera.far = saved.far
      this.renderer.setPixelRatio(saved.dpr)
      this.insetRight = saved.insetRight
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
      this.applyLook()
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
    const evaluation = this.evaluation
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
    this.clearOverlay()
    if (this.built) this.release(this.built)
    for (const { geometry } of this.geometries.values()) geometry.dispose()
    this.geometries.clear()
    this.lastGood.clear()
    this.environment?.dispose()
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

/** Facet edges of every visible stone of a batch, in model space (hidden stones have zero scale). */
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
    if (m.determinant() === 0) continue
    const placed = new Float32Array(unit.length)
    for (let k = 0; k < unit.length; k += 3) v.fromArray(unit, k).applyMatrix4(m).toArray(placed, k)
    out.push(placed)
  }
  return out
}

function bvhOf(material: Material): { dispose(): void } | undefined {
  const uniform = (material as { uniforms?: { bvh?: { value?: { dispose?: () => void } } } })
    .uniforms?.bvh?.value
  return typeof uniform?.dispose === 'function' ? (uniform as { dispose(): void }) : undefined
}

function indexForPicking(mesh: Mesh): void {
  if (!mesh.geometry.boundsTree)
    (mesh.geometry as unknown as { computeBoundsTree(): void }).computeBoundsTree()
}

function corners(b: Bounds): Vec3[] {
  return [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [
    i & 1 ? b.max[0] : b.min[0],
    i & 2 ? b.max[1] : b.min[1],
    i & 4 ? b.max[2] : b.min[2],
  ])
}
