import type { Bounds, Part } from '@pave/kernel'
import { BufferAttribute, BufferGeometry, type Mesh, Ray, Vector3 } from 'three'
import type { ViewerPick, ViewTarget } from './visibility'

const SHELL_SUFFIX = '#shell:'
/** Avoid blocking pointer input on imported scan meshes with millions of triangles. */
const MAX_PICK_TRIANGLES = 150_000

type Visible = (target: ViewTarget) => boolean

interface Sections {
  targets: ViewerPick[]
  faces: Uint32Array
  edges: Int32Array
}

interface Subset {
  part: Part
  faces: Uint32Array
}

const sectionsByPart = new WeakMap<Part, Sections | null>()

/** An evaluated metal part remains one draw call even when selected shells of it are hidden. */
export class MetalBatch {
  private readonly originalGeometry: BufferGeometry
  private sections: Sections | null | undefined
  private visibleShells: boolean[] | undefined
  private subset: Subset | null = null

  constructor(
    readonly mesh: Mesh,
    readonly part: Part,
  ) {
    this.originalGeometry = mesh.geometry
  }

  get visiblePart(): Part {
    return this.subset?.part ?? this.part
  }

  private get target(): ViewerPick {
    return { nodeId: this.part.nodeId, partId: this.part.id }
  }

  ownsShell(id: string | null | undefined): boolean {
    return isShellOf(this.part.id, id)
  }

  private findSections(): Sections | null {
    if (this.sections === undefined) {
      const cached = sectionsByPart.get(this.part)
      this.sections = cached === undefined ? splitSections(this.part) : cached
      if (cached === undefined) sectionsByPart.set(this.part, this.sections)
    }
    return this.sections
  }

  pick(face: number | undefined, multipleParts: boolean, precise: boolean): ViewerPick {
    if (face !== undefined) {
      const sections = precise ? this.findSections() : this.sections
      const index = (this.subset?.faces ?? sections?.faces)?.[face]
      if (index !== undefined && sections) return sections.targets[index]!
    }
    return multipleParts ? this.target : { nodeId: this.part.nodeId }
  }

  setVisibility(visible: Visible, needsShells: boolean): void {
    const sections = needsShells ? this.findSections() : this.sections
    if (!sections) {
      this.mesh.visible = visible(this.target)
      return
    }
    const show = sections.targets.map((target) =>
      visible({ ...target, parentPartId: this.part.id }),
    )
    if (this.visibleShells?.every((previous, i) => previous === show[i])) return
    this.visibleShells = show
    this.resetGeometry()
    this.mesh.visible = show.some(Boolean)
    if (this.mesh.visible && !show.every(Boolean)) {
      this.subset = makeSubset(this.part, sections, show)
      this.mesh.geometry = geometryOf(this.subset.part)
    }
  }

  matchingGeometry(matches: Visible): BufferGeometry | null {
    if (!this.mesh.visible) return null
    if (matches(this.target)) return this.mesh.geometry
    if (!this.sections) return null
    const selected = this.sections.targets.map(
      (target, i) => (this.visibleShells?.[i] ?? true) && matches(target),
    )
    if (!selected.some(Boolean)) return null
    if (selected.every((value, i) => value === (this.visibleShells?.[i] ?? true)))
      return this.mesh.geometry
    return geometryOf(makeSubset(this.part, this.sections, selected).part)
  }

  resetGeometry(): void {
    if (this.mesh.geometry !== this.originalGeometry) {
      this.mesh.geometry.dispose()
      this.mesh.geometry = this.originalGeometry
    }
    this.subset = null
  }
}

export function isShellOf(partId: string, id: string | null | undefined): boolean {
  return id?.startsWith(`${partId}${SHELL_SUFFIX}`) ?? false
}

export function geometryOf(part: Part): BufferGeometry {
  const { positions, normals, indices } = part.mesh
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setIndex(new BufferAttribute(indices, 1))
  return geometry
}

const snapZero = (n: number) => (Math.abs(n) < 1e-9 ? 0 : n)
const vertexKey = (pos: Float32Array, i: number) =>
  `${snapZero(pos[i]!)},${snapZero(pos[i + 1]!)},${snapZero(pos[i + 2]!)}`

/** Welds positional seams for connectivity only. The shaded normals and geometry are untouched. */
function splitSections(part: Part): Sections | null {
  const { positions, indices } = part.mesh
  const faces = indices.length / 3
  if (faces < 2 || faces > MAX_PICK_TRIANGLES) return null
  const vertexCount = positions.length / 3
  const welded = new Uint32Array(vertexCount)
  const coordinates = new Map<string, number>()
  for (let i = 0; i < vertexCount; i++) {
    const key = vertexKey(positions, i * 3)
    const vertex = coordinates.get(key) ?? coordinates.size
    coordinates.set(key, vertex)
    welded[i] = vertex
  }
  const stride = coordinates.size
  const edgeKey = (a: number, b: number) => Math.min(a, b) * stride + Math.max(a, b)
  const parents = Uint32Array.from({ length: faces }, (_, i) => i)
  const root = (i: number): number => {
    while (parents[i] !== i) {
      parents[i] = parents[parents[i]!]!
      i = parents[i]!
    }
    return i
  }
  // The first triangle using each undirected edge, plus its incidence count saturated at three.
  const edgeUses = new Map<number, number>()
  for (let face = 0; face < faces; face++) {
    const a = welded[indices[face * 3]!]!
    const b = welded[indices[face * 3 + 1]!]!
    const c = welded[indices[face * 3 + 2]!]!
    if (a === b || b === c || c === a) continue
    for (const key of [edgeKey(a, b), edgeKey(b, c), edgeKey(c, a)]) {
      const uses = edgeUses.get(key)
      if (uses === undefined) edgeUses.set(key, face * 4 + 1)
      else {
        parents[root(face)] = root(Math.floor(uses / 4))
        if (uses % 4 < 3) edgeUses.set(key, uses + 1)
      }
    }
  }
  const components = new Map<number, number[]>()
  for (let face = 0; face < faces; face++) {
    const owner = root(face)
    const group = components.get(owner)
    if (group) group.push(face)
    else components.set(owner, [face])
  }
  if (components.size === 1) return null

  // An inward closed boundary can be a cavity of a surrounding piece, rather than loose metal.
  const open = new Set<number>()
  for (const uses of edgeUses.values()) if (uses % 4 !== 2) open.add(root(Math.floor(uses / 4)))
  mergeCavities(part, components, open)
  if (components.size === 1) return null

  const owners = new Uint32Array(faces)
  const targets: ViewerPick[] = []
  for (const component of components.values()) {
    for (const face of component) owners[face] = targets.length
    targets.push({ nodeId: part.nodeId, partId: `${part.id}${SHELL_SUFFIX}${targets.length}` })
  }
  const edges = new Int32Array(part.edges.length / 6).fill(-1)
  for (let i = 0; i < edges.length; i++) {
    const a = coordinates.get(vertexKey(part.edges, i * 6))
    const b = coordinates.get(vertexKey(part.edges, i * 6 + 3))
    if (a === undefined || b === undefined) continue
    const uses = edgeUses.get(edgeKey(a, b))
    if (uses !== undefined) edges[i] = owners[Math.floor(uses / 4)]!
  }
  return { targets, faces: owners, edges }
}

function mergeCavities(part: Part, components: Map<number, number[]>, open: Set<number>): void {
  const { positions, indices } = part.mesh
  const a = new Vector3()
  const b = new Vector3()
  const c = new Vector3()
  const cross = new Vector3()
  function triangle(face: number): void {
    a.fromArray(positions, indices[face * 3]! * 3)
    b.fromArray(positions, indices[face * 3 + 1]! * 3)
    c.fromArray(positions, indices[face * 3 + 2]! * 3)
  }
  const closed = [...components]
    .filter(([id]) => !open.has(id))
    .map(([id, faces]) => {
      const sample = new Vector3().fromArray(positions, indices[faces[0]! * 3]! * 3)
      const min = new Vector3(Infinity, Infinity, Infinity)
      const max = new Vector3(-Infinity, -Infinity, -Infinity)
      let signedVolume = 0
      for (const face of faces) {
        triangle(face)
        min.min(a).min(b).min(c)
        max.max(a).max(b).max(c)
        signedVolume += a.sub(sample).dot(cross.crossVectors(b.sub(sample), c.sub(sample)))
      }
      return { id, faces, faceCount: faces.length, sample, min, max, signedVolume }
    })
  const exterior = closed.filter((component) => component.signedVolume > 0)
  const ray = new Ray(new Vector3(), new Vector3(1, 0.417, 0.723).normalize())
  const hit = new Vector3()
  for (const cavity of closed) {
    if (cavity.signedVolume >= 0) continue
    const containing = exterior
      .filter(
        ({ min, max }) =>
          cavity.min.x > min.x &&
          cavity.min.y > min.y &&
          cavity.min.z > min.z &&
          cavity.max.x < max.x &&
          cavity.max.y < max.y &&
          cavity.max.z < max.z,
      )
      .sort((first, second) => first.signedVolume - second.signedVolume)
    ray.origin.copy(cavity.sample)
    for (const shell of containing) {
      let crossings = 0
      for (let i = 0; i < shell.faceCount; i++) {
        triangle(shell.faces[i]!)
        if (ray.intersectTriangle(a, b, c, false, hit)) crossings++
      }
      if (crossings % 2 === 0) continue
      for (const face of cavity.faces) shell.faces.push(face)
      components.delete(cavity.id)
      break
    }
  }
}

function makeSubset(part: Part, sections: Sections, show: readonly boolean[]): Subset {
  const source = part.mesh
  const remap = new Int32Array(source.positions.length / 3).fill(-1)
  const vertices: number[] = []
  const indices: number[] = []
  const faces: number[] = []
  for (let i = 0; i < sections.faces.length; i++) {
    const shell = sections.faces[i]!
    if (!show[shell]) continue
    faces.push(shell)
    for (let k = 0; k < 3; k++) {
      const vertex = source.indices[i * 3 + k]!
      if (remap[vertex] === -1) {
        remap[vertex] = vertices.length
        vertices.push(vertex)
      }
      indices.push(remap[vertex]!)
    }
  }
  const positions = new Float32Array(vertices.length * 3)
  const normals = new Float32Array(positions.length)
  const bounds: Bounds = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  }
  for (const [i, vertex] of vertices.entries()) {
    for (let axis = 0; axis < 3; axis++) {
      const value = source.positions[vertex * 3 + axis]!
      positions[i * 3 + axis] = value
      normals[i * 3 + axis] = source.normals[vertex * 3 + axis]!
      bounds.min[axis] = Math.min(bounds.min[axis]!, value)
      bounds.max[axis] = Math.max(bounds.max[axis]!, value)
    }
  }
  const edges: number[] = []
  for (let i = 0; i < sections.edges.length; i++)
    if (show[sections.edges[i]!]) for (let k = 0; k < 6; k++) edges.push(part.edges[i * 6 + k]!)
  return {
    part: {
      ...part,
      bounds,
      mesh: { positions, normals, indices: Uint32Array.from(indices) },
      edges: Float32Array.from(edges),
    },
    faces: Uint32Array.from(faces),
  }
}
