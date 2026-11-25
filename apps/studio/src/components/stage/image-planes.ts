/**
 * The viewport's image planes as three.js objects: one textured quad per placed reference, in a
 * scene of their own that the viewer draws first, so the piece always draws over the pictures
 * (they are a backdrop to model over, never in front of the work). Being a separate scene also
 * keeps them out of every capture, which renders the piece's scene alone: a reference picture
 * never reaches a cover, a capture sent to the assistant, a render or an export.
 */

import { zUpGroup } from '@pave/render/three'
import type { ImagePlaneView } from '@pave/schema'
import {
  BufferGeometry,
  Float32BufferAttribute,
  FrontSide,
  LineBasicMaterial,
  LineLoop,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type PerspectiveCamera,
  Plane,
  PlaneGeometry,
  type Ray,
  Raycaster,
  Scene,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  type Vector2,
  Vector3,
} from 'three'
import { type Bounds, planeDepth, VIEW_AXES } from '../../lib/image-planes'

export interface ImagePlaneSpec {
  id: string
  url: string
  view: ImagePlaneView
  center: [number, number]
  width: number
  /** The picture's height / width. */
  aspect: number
  opacity: number
  selected: boolean
}

interface Placed {
  mesh: Mesh<PlaneGeometry, MeshBasicMaterial>
  frame: LineLoop
  url: string
  texture: Texture | null
}

const basisOf = (view: ImagePlaneView) => {
  const { right, up, normal } = VIEW_AXES[view]
  return new Matrix4().makeBasis(new Vector3(...right), new Vector3(...up), new Vector3(...normal))
}

export class ImagePlaneLayer {
  readonly scene = new Scene()
  private readonly group = zUpGroup('image-planes')
  private readonly placed = new Map<string, Placed>()
  private readonly loader = new TextureLoader()
  private readonly frameMaterial = new LineBasicMaterial({ color: '#2b6ce6' })
  private readonly frameGeometry = new BufferGeometry()
  private specs: ImagePlaneSpec[] = []
  private bounds: Bounds | null = null
  private disposed = false

  constructor(private readonly onChange: () => void) {
    this.scene.add(this.group)
    // A unit square's outline, scaled with its picture.
    this.frameGeometry.setAttribute(
      'position',
      new Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3),
    )
  }

  get isEmpty(): boolean {
    return this.placed.size === 0
  }

  setSelectColor(color: string): void {
    this.frameMaterial.color.set(color)
  }

  /** The piece's bounds: each view's pictures lie through the middle of the piece. */
  setBounds(bounds: Bounds | null): void {
    this.bounds = bounds
    this.layout()
  }

  set(specs: readonly ImagePlaneSpec[]): void {
    this.specs = [...specs]
    const wanted = new Set(specs.map((s) => s.id))
    for (const [id, p] of this.placed) if (!wanted.has(id)) this.remove(id, p)
    for (const spec of specs) {
      let p = this.placed.get(spec.id)
      if (p && p.url !== spec.url) {
        this.remove(spec.id, p)
        p = undefined
      }
      if (!p) p = this.add(spec)
      p.mesh.material.opacity = spec.opacity
      p.frame.visible = spec.selected
    }
    this.layout()
  }

  private add(spec: ImagePlaneSpec): Placed {
    const material = new MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      side: FrontSide,
      toneMapped: false,
      // Until the picture loads, a faint card shows where it will be.
      color: '#ffffff',
      opacity: spec.opacity,
    })
    const mesh = new Mesh(new PlaneGeometry(1, 1), material)
    mesh.userData.planeId = spec.id
    const frame = new LineLoop(this.frameGeometry, this.frameMaterial)
    frame.visible = false
    this.group.add(mesh, frame)
    const placed: Placed = { mesh, frame, url: spec.url, texture: null }
    this.placed.set(spec.id, placed)
    this.loader.load(spec.url, (texture) => {
      // The plane may have been removed (or the viewer disposed) while the picture loaded.
      if (this.disposed || this.placed.get(spec.id) !== placed) {
        texture.dispose()
        return
      }
      texture.colorSpace = SRGBColorSpace
      placed.texture = texture
      material.map = texture
      material.needsUpdate = true
      this.onChange()
    })
    return placed
  }

  private remove(id: string, p: Placed): void {
    this.group.remove(p.mesh, p.frame)
    p.mesh.geometry.dispose()
    p.mesh.material.dispose()
    p.texture?.dispose()
    this.placed.delete(id)
  }

  /** Positions every picture in its view, at the piece's middle along the view's depth. */
  private layout(): void {
    for (const spec of this.specs) {
      const p = this.placed.get(spec.id)
      if (!p) continue
      const { right, up, depth } = VIEW_AXES[spec.view]
      const [u, v] = spec.center
      const pos = new Vector3(
        right[0] * u + up[0] * v,
        right[1] * u + up[1] * v,
        right[2] * u + up[2] * v,
      )
      pos.setComponent(depth, planeDepth(spec.view, this.bounds))
      const rotation = basisOf(spec.view)
      for (const obj of [p.mesh, p.frame]) {
        obj.position.copy(pos)
        obj.quaternion.setFromRotationMatrix(rotation)
        obj.scale.set(spec.width, spec.width * spec.aspect, 1)
      }
    }
    this.onChange()
  }

  private readonly raycaster = new Raycaster()

  /** The picture under a point (normalised device coordinates), front-most first. */
  pick(ndc: Vector2, camera: PerspectiveCamera): string | null {
    this.raycaster.setFromCamera(ndc, camera)
    const meshes = [...this.placed.values()].map((p) => p.mesh)
    const hit = this.raycaster.intersectObjects(meshes, false)[0]
    return hit ? (hit.object.userData.planeId as string) : null
  }

  /**
   * Where a screen point falls on a view's picture plane, in that view's 2D mm (also outside
   * the picture), or null when the camera looks along the plane.
   */
  pointOn(view: ImagePlaneView, ndc: Vector2, camera: PerspectiveCamera): [number, number] | null {
    this.raycaster.setFromCamera(ndc, camera)
    this.group.updateMatrixWorld()
    // Into the piece's Z-up space, where the view's axes are defined.
    const ray: Ray = this.raycaster.ray
      .clone()
      .applyMatrix4(this.group.matrixWorld.clone().invert())
    const { right, up, normal } = VIEW_AXES[view]
    const n = new Vector3(...normal)
    const plane = new Plane(
      n,
      -planeDepth(view, this.bounds) * n.getComponent(VIEW_AXES[view].depth),
    )
    const hit = ray.intersectPlane(plane, new Vector3())
    if (!hit) return null
    return [hit.dot(new Vector3(...right)), hit.dot(new Vector3(...up))]
  }

  dispose(): void {
    this.disposed = true
    for (const [id, p] of this.placed) this.remove(id, p)
    this.frameGeometry.dispose()
    this.frameMaterial.dispose()
  }
}
