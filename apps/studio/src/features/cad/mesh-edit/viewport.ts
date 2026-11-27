import {
  BufferAttribute,
  BufferGeometry,
  DirectionalLight,
  DoubleSide,
  DynamicDrawUsage,
  HemisphereLight,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  MOUSE,
  OrthographicCamera,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  TOUCH,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { MeshBVH } from 'three-mesh-bvh'
import type { ComponentKind, MeshComponent, VertexPositions, ViewportMesh, XYZ } from './model'
import { pickMeshComponent } from './pick'

export const views = {
  Perspective: [1, -1, 0.8],
  Front: [0, -1, 0],
  Back: [0, 1, 0],
  Right: [1, 0, 0],
  Left: [-1, 0, 0],
  Top: [0, 0, 1],
  Bottom: [0, 0, -1],
} satisfies Record<string, XYZ>
export type ViewName = keyof typeof views

interface EditDisplay {
  kind: ComponentKind
  selected: MeshComponent | null
  preview: VertexPositions
  canPick: boolean
}

function makeHighlight(color: number) {
  const positions = new BufferAttribute(new Float32Array(9), 3).setUsage(DynamicDrawUsage)
  const geometry = new BufferGeometry().setAttribute('position', positions)
  const point = new Points(geometry, new PointsMaterial({ color, size: 8, sizeAttenuation: false }))
  const edge = new Line(geometry, new LineBasicMaterial({ color }))
  const face = new Mesh(geometry, new MeshBasicMaterial({ color, side: DoubleSide }))
  for (const object of [point, edge, face]) {
    object.frustumCulled = false
    object.visible = false
    object.renderOrder = 2
  }
  return {
    objects: [point, edge, face] as const,
    show(component: MeshComponent | null, vertices: Float32Array) {
      point.visible = component?.kind === 'Vertex'
      edge.visible = component?.kind === 'Edge'
      face.visible = component?.kind === 'Face'
      if (!component) return
      component.ids.forEach((id, i) => {
        positions.setXYZ(i, vertices[3 * id]!, vertices[3 * id + 1]!, vertices[3 * id + 2]!)
      })
      geometry.setDrawRange(0, component.ids.length)
      positions.needsUpdate = true
    },
    dispose() {
      geometry.dispose()
      point.material.dispose()
      edge.material.dispose()
      face.material.dispose()
    },
  }
}

export function createMeshViewport(
  canvas: HTMLCanvasElement,
  source: ViewportMesh,
  onPick: (component: MeshComponent | null) => void,
) {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

  const positions = source.displayPositions.slice()
  const vertices = new BufferAttribute(positions, 3).setUsage(DynamicDrawUsage)
  const pickingGeometry = new BufferGeometry()
  pickingGeometry.setAttribute('position', new BufferAttribute(source.displayPositions, 3))
  const bvh = MeshBVH.deserialize(source.tree, pickingGeometry)
  const geometry = new BufferGeometry().setAttribute('position', vertices)
  geometry.setIndex(pickingGeometry.index)

  const surface = new MeshStandardMaterial({
    flatShading: true,
    side: DoubleSide,
    color: 0x8294a5,
    roughness: 0.82,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
  })
  const triangulation = new MeshBasicMaterial({
    color: 0x202838,
    side: DoubleSide,
    wireframe: true,
    transparent: true,
    opacity: 0.41,
    depthWrite: false,
  })
  const body = new Mesh(geometry, surface)
  const wire = new Mesh(geometry, triangulation)
  body.frustumCulled = false
  wire.frustumCulled = false
  const ambient = new HemisphereLight(0xe1eeff, 0xaca6a1, 2)
  const key = new DirectionalLight(0xfff5e5, 2.1)
  const selected = makeHighlight(0xffb957)
  const hovered = makeHighlight(0xffe4b7)
  for (const object of hovered.objects) object.renderOrder = 1
  const scene = new Scene().add(body, wire, ambient, key, ...hovered.objects, ...selected.objects)
  const radius = Math.hypot(...source.size) / (2 * source.scale)
  let camera: PerspectiveCamera | OrthographicCamera
  let controls: OrbitControls | undefined
  let orbit = true
  let frame = 0
  let pointer: { id: number; x: number; y: number; dragged: boolean } | null = null
  let display: EditDisplay = { kind: 'Vertex', selected: null, preview: {}, canPick: true }

  const draw = () => {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      key.position.copy(camera.position).add(new Vector3(0.4, 0.2, 0.7))
      renderer.render(scene, camera)
    })
  }

  function resize() {
    const { width, height } = canvas.getBoundingClientRect()
    if (width < 1 || height < 1) return
    const aspect = width / height
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false)
    if (camera instanceof PerspectiveCamera) camera.aspect = aspect
    else {
      const extent = radius * 1.18 * Math.max(1, 1 / aspect)
      camera.top = extent
      camera.bottom = -extent
      camera.right = extent * aspect
      camera.left = -extent * aspect
    }
    camera.updateProjectionMatrix()
    draw()
  }

  function setView(name: ViewName) {
    controls?.dispose()
    orbit = name === 'Perspective'
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight)
    camera = orbit
      ? new PerspectiveCamera(38, aspect, 0.0001, 500)
      : new OrthographicCamera(-1, 1, 1, -1, 0.0001, 500)
    camera.up.set(
      0,
      name === 'Top' || name === 'Bottom' ? 1 : 0,
      name === 'Top' || name === 'Bottom' ? 0 : 1,
    )
    const angle = Math.atan(Math.tan((38 * Math.PI) / 360) * Math.min(1, aspect))
    const distance = orbit ? (1.18 * radius) / Math.sin(angle) : 3
    camera.position
      .set(...views[name])
      .normalize()
      .multiplyScalar(distance)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()
    controls = new OrbitControls(camera, canvas)
    controls.enableRotate = orbit
    controls.minDistance = 0.004
    controls.maxDistance = 200
    controls.minZoom = 0.025
    controls.maxZoom = 250
    if (!orbit) {
      controls.mouseButtons.LEFT = MOUSE.PAN
      controls.touches.ONE = TOUCH.PAN
    }
    controls.addEventListener('change', clearHover)
    hovered.show(null, positions)
    resize()
  }

  const atPointer = (e: PointerEvent) => {
    if (!display.canPick) return null
    const rect = canvas.getBoundingClientRect()
    camera.updateMatrixWorld()
    return pickMeshComponent(
      bvh,
      camera,
      display.kind,
      e.clientX - rect.x,
      e.clientY - rect.y,
      rect.width,
      rect.height,
    )
  }
  const pointerDown = (e: PointerEvent) => {
    if (pointer && pointer.id !== e.pointerId) {
      pointer.dragged = true
      return
    }
    if (e.button !== 0 || !e.isPrimary) return
    pointer = { id: e.pointerId, x: e.clientX, y: e.clientY, dragged: false }
    hovered.show(null, positions)
    draw()
  }
  const clearHover = () => {
    hovered.show(null, positions)
    draw()
  }
  const pointerMove = (e: PointerEvent) => {
    if (pointer?.id === e.pointerId) {
      if (Math.hypot(e.clientX - pointer.x, e.clientY - pointer.y) > 4) pointer.dragged = true
      return
    }
    if (e.pointerType !== 'touch') {
      hovered.show(atPointer(e), positions)
      draw()
    }
  }
  const pointerUp = (e: PointerEvent) => {
    if (pointer?.id !== e.pointerId) return
    const click = !pointer.dragged && Math.hypot(e.clientX - pointer.x, e.clientY - pointer.y) <= 4
    pointer = null
    if (click && display.canPick) onPick(atPointer(e))
  }
  const cancel = () => {
    pointer = null
    clearHover()
  }

  canvas.addEventListener('pointerdown', pointerDown)
  canvas.addEventListener('pointermove', pointerMove)
  canvas.addEventListener('pointerup', pointerUp)
  canvas.addEventListener('pointerleave', clearHover)
  canvas.addEventListener('pointercancel', cancel)
  setView('Perspective')
  const observer = new ResizeObserver(resize)
  observer.observe(canvas)

  return {
    setView,
    show(next: EditDisplay) {
      for (const key of Object.keys(display.preview)) {
        const start = 3 * Number(key)
        positions.set(source.displayPositions.subarray(start, start + 3), start)
        vertices.addUpdateRange(start, 3)
      }
      for (const [key, value] of Object.entries(next.preview)) {
        const start = 3 * Number(key)
        for (let axis = 0; axis < 3; axis++)
          positions[start + axis] = (value[axis]! - source.origin[axis]!) / source.scale
        vertices.addUpdateRange(start, 3)
      }
      if (vertices.updateRanges.length) vertices.needsUpdate = true
      display = next
      hovered.show(null, positions)
      selected.show(display.selected, positions)
      draw()
    },
    dispose() {
      cancelAnimationFrame(frame)
      observer.disconnect()
      controls?.dispose()
      canvas.removeEventListener('pointerdown', pointerDown)
      canvas.removeEventListener('pointermove', pointerMove)
      canvas.removeEventListener('pointerup', pointerUp)
      canvas.removeEventListener('pointerleave', clearHover)
      canvas.removeEventListener('pointercancel', cancel)
      selected.dispose()
      hovered.dispose()
      geometry.dispose()
      pickingGeometry.dispose()
      surface.dispose()
      triangulation.dispose()
      renderer.dispose()
    },
  }
}
