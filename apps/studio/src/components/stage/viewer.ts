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
  Clock,
  EdgesGeometry,
  type Group,
  InstancedMesh,
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
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
} from 'three'
import { acceleratedRaycast, computeBoundsTree } from 'three-mesh-bvh'
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
}

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
  private state: ViewerState = {
    display: 'rendered',
    selection: [],
    stone: null,
    hover: null,
    hidden: [],
    xray: false,
  }
  private readonly clock = new Clock()
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
    this.controls.addEventListener('update', this.invalidate)
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
    const moving = this.controls.update(this.clock.getDelta())
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

  /** Which nodes the default views and "fit" frame; the rest may extend outside (a long chain). */
  setFrameFocus(nodeIds: readonly string[]): void {
    this.frameFocus = nodeIds
  }

  private readonly startMoving = (): void => {
    clearTimeout(this.restTimer)
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
    this.updateFov(this.camera.aspect)
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
    // Remember each node's last geometry that built, to ghost it while the node is failing.
    for (const part of evaluation.parts)
      if (!failed.has(part.nodeId)) this.lastGood.delete(part.nodeId)
    const byNode = new Map<string, Part[]>()
    for (const part of evaluation.parts)
      byNode.set(part.nodeId, [...(byNode.get(part.nodeId) ?? []), part])
    for (const [nodeId, parts] of byNode) this.lastGood.set(nodeId, parts)

    this.evaluation = evaluation
    const resolved = resolveScene(
      RenderSceneSchema.parse({ look: 'studio-soft', output: { width: 1024, height: 1024 } }),
      evaluation,
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
    model.object.traverse((o) => {
      if (o instanceof InstancedMesh) {
        gems.push(o)
        matrices.set(o, (o.instanceMatrix.array as Float32Array).slice())
        originals.set(o, o.material as Material)
      } else if (o instanceof Mesh) {
        metals.push(o)
        originals.set(o, o.material as Material)
      }
    })
    this.built = { model, metals, gems, originals, matrices }
    this.scene.add(model.object)
    previous?.model.dispose()

    this.placeShadow(evaluation.report.bounds, evaluation.report.ringInnerDiameter !== undefined)
    this.applyGemQuality()
    this.applyLook()
    if (!this.framedOnce && evaluation.parts.length + evaluation.stones.length > 0) {
      this.framedOnce = true
      this.view(this.defaultView(), false)
    }
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
      // Overlays share the model's geometry and the mode materials; only built lines and ghosts own theirs.
      if (child.userData.ownsGeometry) (child as Mesh).geometry.dispose()
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
    const chunks = this.evaluation!.parts.filter((p) => !hidden.has(p.nodeId)).map((p) => p.edges)
    const stones = b.gems.reduce((n, g) => n + g.count, 0)
    if (stones <= MAX_EDGED_STONES) for (const gems of b.gems) chunks.push(...stoneEdges(gems))
    const total = chunks.reduce((n, c) => n + c.length, 0)
    if (total) {
      const positions = new Float32Array(total)
      let offset = 0
      for (const c of chunks) {
        positions.set(c, offset)
        offset += c.length
      }
      const g = new BufferGeometry()
      g.setAttribute('position', new BufferAttribute(positions, 3))
      const lines = new LineSegments(g, m.edges)
      lines.userData.ownsGeometry = true
      this.overlay.add(lines)
    }
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
    const { target, distance } = framePoints(
      pts,
      azimuth,
      elevation,
      FOCAL_MM,
      this.camera.aspect,
      fill,
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

  /** Frames a point (a diagnostic's location) closely. */
  frameAt(at: Vec3, radius = 2): void {
    const { azimuth, elevation } = this.orbitAngles()
    this.look(
      azimuth,
      elevation,
      corners({ min: at.map((v) => v - radius) as Vec3, max: at.map((v) => v + radius) as Vec3 }),
      0.4,
      true,
    )
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
  }

  zoom(factor: number): void {
    void this.controls.zoom(factor, !reducedMotion())
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
    for (const t of targets)
      if (!t.geometry.boundsTree)
        (t.geometry as unknown as { computeBoundsTree(): void }).computeBoundsTree()
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
    if (opts.evaluation) this.setEvaluation(opts.evaluation)
    const saved = {
      state: this.state,
      position: this.controls.getPosition(new Vector3()),
      target: this.controls.getTarget(new Vector3()),
      width: this.width,
      height: this.height,
      dpr: this.renderer.getPixelRatio(),
    }
    const canvases: HTMLCanvasElement[] = []
    try {
      this.renderer.setPixelRatio(1)
      this.renderer.setSize(opts.size, opts.size, false)
      this.camera.aspect = 1
      this.updateFov(1)
      for (const m of [this.materials.silhouette, this.materials.selected, this.materials.hovered])
        m.setResolution(opts.size, opts.size)
      this.state = {
        ...this.state,
        display: opts.mode,
        selection: opts.focusNodeIds ?? [],
        stone: null,
        hover: null,
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
        canvases.push(out)
      }
    } finally {
      this.state = saved.state
      this.renderer.setPixelRatio(saved.dpr)
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
    if (evaluation) this.setEvaluation(evaluation)
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.frame)
    clearTimeout(this.restTimer)
    this.clearOverlay()
    this.built?.model.dispose()
    this.environment?.dispose()
    this.materials.dispose()
    this.controls.dispose()
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost)
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored)
    this.renderer.dispose()
  }
}

/** Above this many stones, technical mode outlines stones without drawing their facets. */
const MAX_EDGED_STONES = 600
const unitEdges = new WeakMap<BufferGeometry, Float32Array>()

/** Facet edges of every visible stone of a batch, in model space (hidden stones have zero scale). */
function stoneEdges(gems: InstancedMesh): Float32Array[] {
  let unit = unitEdges.get(gems.geometry)
  if (!unit) {
    const edges = new EdgesGeometry(gems.geometry, 20)
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

function corners(b: Bounds): Vec3[] {
  return [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [
    i & 1 ? b.max[0] : b.min[0],
    i & 2 ? b.max[1] : b.min[1],
    i & 4 ? b.max[2] : b.min[2],
  ])
}
