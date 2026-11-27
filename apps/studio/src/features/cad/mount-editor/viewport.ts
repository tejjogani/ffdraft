import { type MountCage, mountCageAffine, mountCageIsAffine, mountCagePoint } from '@pave/schema'
import {
  Box3,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  DirectionalLight,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  HemisphereLight,
  LineBasicMaterial,
  LineLoop,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  MOUSE,
  OrthographicCamera,
  PerspectiveCamera,
  Plane,
  Quaternion,
  Raycaster,
  Scene,
  SphereGeometry,
  TOUCH,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { XYZ } from '../mesh-edit/model'
import { type ViewName, views } from '../mesh-edit/viewport'
import { type CageHandle, cornerIds, cornerPoint, cornersFor } from './handles'
import type { PreviewBox, PreviewCages, PreviewGirdle, PreviewMesh } from './preview-model'

const colors = [0xd6b78a, 0xccd4df, 0xc9a899, 0x8fb5b3, 0xb5abce]
const edgeIds = cornerIds.flatMap((a) =>
  [1, 2, 4].filter((bit) => !(a & bit)).flatMap((bit) => [a, a | bit]),
)
const faceHandles: CageHandle[] = Array.from({ length: 6 }, (_, index) => ({ kind: 'face', index }))
const handles: CageHandle[] = [
  ...cornerIds.map((index) => ({ kind: 'corner' as const, index })),
  ...faceHandles,
  { kind: 'all' },
]
const all = handles.at(-1)!

export interface ViewportFrame {
  cage: MountCage
  cages: PreviewCages
  stone?: PreviewGirdle
  selected: CageHandle
  interactive: boolean
  fitted?: ReadonlyMap<string, readonly number[]>
}
interface HandleEvents {
  onPick(handle: CageHandle): void
  onMove(handle: CageHandle, delta: XYZ): void
  onRelease(handle: CageHandle, delta: XYZ | null): void
}

export function createMountViewport(
  canvas: HTMLCanvasElement,
  source: PreviewMesh[],
  bounds: PreviewBox,
  events: HandleEvents,
) {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  const scene = new Scene()
  const ambient = new HemisphereLight(0xe8eeff, 0x979291, 2.2)
  const key = new DirectionalLight(0xfff0dc, 2.1)
  scene.add(ambient, key)

  const origin = new Vector3(...bounds.min).lerp(new Vector3(...bounds.max), 0.5)
  const spans = bounds.max.map((end, axis) => end - bounds.min[axis]!)
  const scale = Math.max(...spans)
  const radius = Math.hypot(...spans) / (scale * 2)
  const positions = new Vector3()
  const fitPoint = new Vector3()
  const displayPoint = (point: XYZ, into: Vector3) =>
    into
      .set(...point)
      .sub(origin)
      .divideScalar(scale)
  const place = (position: XYZ, cage?: MountCage | null, fit?: Matrix4) => {
    const caged = cage ? mountCagePoint(cage, position) : position
    if (fit) fitPoint.set(...caged).applyMatrix4(fit)
    return displayPoint(fit ? fitPoint.toArray() : caged, positions)
  }
  const bodies = source.map((part, index) => {
    const vertices = new BufferAttribute(new Float32Array(part.positions.length), 3).setUsage(
      DynamicDrawUsage,
    )
    const geometry = new BufferGeometry().setAttribute('position', vertices)
    geometry.setIndex(new BufferAttribute(part.indices, 1))
    const material = new MeshStandardMaterial({
      color: colors[index % colors.length],
      roughness: 0.68,
      metalness: 0.12,
      flatShading: true,
      side: DoubleSide,
    })
    const mesh = new Mesh(geometry, material)
    mesh.frustumCulled = false
    scene.add(mesh)
    return { part, vertices, geometry, material }
  })

  const edgePoints = new BufferAttribute(new Float32Array(edgeIds.length * 3), 3).setUsage(
    DynamicDrawUsage,
  )
  const edges = new LineSegments(
    new BufferGeometry().setAttribute('position', edgePoints),
    new LineBasicMaterial({
      color: 0xd9b47c,
      transparent: true,
      opacity: 0.58,
      depthTest: false,
      depthWrite: false,
    }),
  )
  edges.frustumCulled = false
  edges.renderOrder = 1
  scene.add(edges)

  const facePoints = new BufferAttribute(new Float32Array(18), 3).setUsage(DynamicDrawUsage)
  const face = new Mesh(
    new BufferGeometry().setAttribute('position', facePoints),
    new MeshBasicMaterial({
      color: 0x77c9e2,
      side: DoubleSide,
      opacity: 0.2,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    }),
  )
  face.frustumCulled = false
  face.renderOrder = 2
  scene.add(face)

  const girdlePoints = new BufferAttribute(new Float32Array(64 * 3), 3).setUsage(DynamicDrawUsage)
  const girdle = new LineLoop(
    new BufferGeometry().setAttribute('position', girdlePoints),
    new LineBasicMaterial({ color: 0xa7e7ff, depthTest: false, depthWrite: false }),
  )
  girdle.frustumCulled = false
  girdle.renderOrder = 3
  scene.add(girdle)

  const markerSize = 0.024
  const sphere = new SphereGeometry(1, 12, 8)
  const square = new BoxGeometry(1.5, 1.5, 1.5)
  const markers = handles.map((handle) => {
    const item = new Mesh(
      handle.kind === 'corner' ? sphere : square,
      new MeshBasicMaterial({ depthTest: false, depthWrite: false }),
    )
    item.renderOrder = 4
    item.scale.setScalar(markerSize)
    item.frustumCulled = false
    scene.add(item)
    return { handle, item }
  })
  const cornerAt = cornerIds.map(() => new Vector3())
  let display: ViewportFrame | undefined
  let fresh = false
  let fittedView = false
  let currentView: ViewName = 'Perspective'
  let viewRadius = radius
  const viewCenter = new Vector3()
  const frameBounds = new Box3()
  const bodyBounds = new Box3()
  let camera: PerspectiveCamera | OrthographicCamera
  let controls: OrbitControls | undefined
  let perspective = true
  let request = 0
  const ray = new Raycaster()
  const normal = new Vector3()
  const delta = new Vector3()
  const meshCage = new Map<string, MountCage | null | undefined>()
  const displayedFit = new Map<string, readonly number[] | undefined>()
  let drag: {
    id: number
    handle: CageHandle
    plane: Plane
    start: Vector3
    delta: XYZ | null
  } | null = null
  const activePoints = new Vector3()
  const aim = new Vector3()

  function update(frame: ViewportFrame) {
    for (const { part, vertices } of bodies) {
      const cage = frame.cages.get(part.nodeId)
      const fitArray = frame.fitted?.get(part.nodeId)
      if (
        meshCage.has(part.nodeId) &&
        meshCage.get(part.nodeId) === cage &&
        displayedFit.get(part.nodeId) === fitArray
      )
        continue
      meshCage.set(part.nodeId, cage)
      displayedFit.set(part.nodeId, fitArray)
      const { positions: original } = part
      const fit = fitArray && new Matrix4().fromArray(fitArray)
      const affine =
        cage && mountCageIsAffine(cage) && new Matrix4().fromArray(mountCageAffine(cage))
      const transform = affine ? (fit ? fit.multiply(affine) : affine) : fit
      const freeform = affine ? undefined : cage
      for (let at = 0; at < original.length; at += 3) {
        const p = place([original[at]!, original[at + 1]!, original[at + 2]!], freeform, transform)
        vertices.setXYZ(at / 3, p.x, p.y, p.z)
      }
      vertices.needsUpdate = true
    }
    const fitView = frame.fitted !== undefined
    edges.visible = !fitView
    const chosen = cornersFor(frame.selected)
    for (const index of cornerIds) {
      const p = cornerPoint(frame.cage, index)
      const o = frame.cage.offsets[index]
      displayPoint([p[0] + o[0], p[1] + o[1], p[2] + o[2]], cornerAt[index]!)
    }
    edgeIds.forEach((id, index) => {
      const { x, y, z } = cornerAt[id]!
      edgePoints.setXYZ(index, x, y, z)
    })
    edgePoints.needsUpdate = true
    face.visible = frame.selected.kind === 'face' && !fitView
    if (face.visible) {
      ;[0, 1, 2, 1, 3, 2].forEach((i, index) => {
        const { x, y, z } = cornerAt[chosen[i]!]!
        facePoints.setXYZ(index, x, y, z)
      })
      facePoints.needsUpdate = true
    }
    for (const { handle, item } of markers) {
      const ids = cornersFor(handle)
      const selected =
        handle.kind === 'corner'
          ? chosen.includes(handle.index)
          : handle.kind === 'all'
            ? frame.selected.kind === 'all'
            : frame.selected.kind === 'face' && frame.selected.index === handle.index
      activePoints.set(0, 0, 0)
      for (const id of ids) activePoints.add(cornerAt[id]!)
      item.position.copy(activePoints).divideScalar(ids.length)
      item.scale.setScalar(markerSize * (selected ? 1.22 : 1))
      item.material.color.setHex(
        selected ? 0xffe3a8 : handle.kind === 'corner' ? 0xd1ac75 : 0x8ab6c8,
      )
      item.visible = !fitView && (handle !== all || selected)
    }
    girdle.visible = !!frame.stone
    if (frame.stone) {
      const {
        frame: { position, rotation, scale: stoneScale },
        width,
        length,
      } = frame.stone
      const [rx, ry, rz] = rotation.map((angle) => (angle * Math.PI) / 180) as XYZ
      const q = new Quaternion().setFromEuler(new Euler(rx, ry, rz, 'XYZ'))
      for (let i = 0; i < girdlePoints.count; i++) {
        const theta = (i * 2 * Math.PI) / girdlePoints.count
        positions.set((Math.cos(theta) * width) / 2, (Math.sin(theta) * length) / 2, 0)
        positions
          .applyQuaternion(q)
          .multiplyScalar(stoneScale)
          .add(fitPoint.set(...position))
          .sub(origin)
          .divideScalar(scale)
        girdlePoints.setXYZ(i, positions.x, positions.y, positions.z)
      }
      girdlePoints.needsUpdate = true
    }
  }

  const draw = () => {
    if (request) return
    request = requestAnimationFrame(() => {
      request = 0
      if (fresh && display) {
        update(display)
        const fitting = display.fitted !== undefined
        if (fittedView !== fitting) {
          fittedView = fitting
          if (fitting) {
            frameBounds.makeEmpty()
            for (const body of bodies)
              frameBounds.union(bodyBounds.setFromBufferAttribute(body.vertices))
            if (girdle.visible) frameBounds.union(bodyBounds.setFromBufferAttribute(girdlePoints))
            frameBounds.getCenter(viewCenter)
            viewRadius = Math.max(0.001, frameBounds.getSize(aim).length() / 2)
          } else {
            viewCenter.set(0, 0, 0)
            viewRadius = radius
          }
          setView(currentView)
        }
      }
      fresh = false
      key.position.copy(camera.position).add(aim.set(0.32, 0.18, 0.52))
      renderer.render(scene, camera)
    })
  }
  function resize() {
    if (!canvas.clientWidth || !canvas.clientHeight) return
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false)
    const aspect = canvas.clientWidth / canvas.clientHeight
    if (camera instanceof PerspectiveCamera) camera.aspect = aspect
    else {
      const extent = viewRadius * 1.2 * Math.max(1, 1 / aspect)
      camera.top = extent
      camera.bottom = -extent
      camera.right = extent * aspect
      camera.left = -extent * aspect
    }
    camera.updateProjectionMatrix()
    draw()
  }
  function setView(view: ViewName) {
    currentView = view
    controls?.dispose()
    perspective = view === 'Perspective'
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight)
    camera = perspective
      ? new PerspectiveCamera(40, aspect, 0.001, 10_000)
      : new OrthographicCamera(-1, 1, 1, -1, 0.001, 10_000)
    const top = view === 'Top' || view === 'Bottom'
    camera.up.set(0, top ? 1 : 0, top ? 0 : 1)
    const angle = Math.atan(Math.tan((40 * Math.PI) / 360) * Math.min(1, aspect))
    const distance = perspective
      ? (viewRadius * 1.2) / Math.sin(angle)
      : Math.max(5, viewRadius * 2)
    camera.position
      .set(...views[view])
      .normalize()
      .multiplyScalar(distance)
      .add(viewCenter)
    camera.lookAt(viewCenter)
    controls = new OrbitControls(camera, canvas)
    controls.enableRotate = perspective
    controls.minDistance = 0.02
    controls.maxDistance = Math.max(2_500, distance * 2)
    controls.minZoom = 0.025
    controls.maxZoom = 250
    if (!perspective) {
      controls.mouseButtons.LEFT = MOUSE.PAN
      controls.touches.ONE = TOUCH.PAN
    }
    controls.target.copy(viewCenter)
    controls.update()
    controls.addEventListener('change', draw)
    resize()
  }

  const mouse = new Vector2()
  function pointerRay(e: PointerEvent) {
    const { x, y, width, height } = canvas.getBoundingClientRect()
    mouse.set(((e.clientX - x) / width) * 2 - 1, 1 - ((e.clientY - y) / height) * 2)
    camera.updateMatrixWorld()
    ray.setFromCamera(mouse, camera)
  }
  function pick(e: PointerEvent) {
    pointerRay(e)
    const visible = markers.filter(({ item }) => item.visible)
    const hit = ray.intersectObjects(
      visible.map(({ item }) => item),
      false,
    )[0]
    return hit && visible.find(({ item }) => item === hit.object)
  }
  function down(e: PointerEvent) {
    if (e.button !== 0 || !e.isPrimary || !display?.interactive || display.fitted) return
    const hit = pick(e)
    if (!hit) return
    const plane = new Plane().setFromNormalAndCoplanarPoint(
      camera.getWorldDirection(normal),
      hit.item.position,
    )
    const start = ray.ray.intersectPlane(plane, new Vector3())
    if (!start) return
    e.preventDefault()
    e.stopImmediatePropagation()
    canvas.setPointerCapture(e.pointerId)
    canvas.style.cursor = 'grabbing'
    drag = { id: e.pointerId, handle: hit.handle, plane, start, delta: null }
    events.onPick(hit.handle)
  }
  function move(e: PointerEvent) {
    if (drag?.id !== e.pointerId) {
      if (!drag && e.pointerType === 'mouse')
        canvas.style.cursor = display?.interactive && !display.fitted && pick(e) ? 'move' : 'grab'
      return
    }
    pointerRay(e)
    if (!ray.ray.intersectPlane(drag.plane, delta)) return
    delta.sub(drag.start).multiplyScalar(scale)
    const offset = delta.toArray().map((n) => Number(n.toFixed(3))) as XYZ
    drag.delta = offset
    events.onMove(drag.handle, offset)
  }
  function end(e: PointerEvent) {
    if (drag?.id !== e.pointerId) return
    const { handle, delta } = drag
    drag = null
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
    canvas.style.cursor = 'grab'
    events.onRelease(handle, e.type === 'pointerup' ? delta : null)
  }
  canvas.addEventListener('pointerdown', down, true)
  canvas.addEventListener('pointermove', move)
  canvas.addEventListener('pointerup', end)
  canvas.addEventListener('pointercancel', end)
  canvas.addEventListener('lostpointercapture', end)
  setView('Perspective')
  const observer = new ResizeObserver(resize)
  observer.observe(canvas)

  return {
    setView,
    show(frame: ViewportFrame) {
      display = frame
      fresh = true
      draw()
    },
    dispose() {
      cancelAnimationFrame(request)
      observer.disconnect()
      controls?.dispose()
      canvas.removeEventListener('pointerdown', down, true)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', end)
      canvas.removeEventListener('pointercancel', end)
      canvas.removeEventListener('lostpointercapture', end)
      for (const { item } of markers) item.material.dispose()
      for (const part of bodies) {
        part.geometry.dispose()
        part.material.dispose()
      }
      for (const shape of [edges, face, girdle]) {
        shape.geometry.dispose()
        shape.material.dispose()
      }
      sphere.dispose()
      square.dispose()
      renderer.dispose()
    },
  }
}
