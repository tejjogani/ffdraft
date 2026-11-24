import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { meshVolume } from '../../solid/meshing'
import { weldWithin } from '../weld'
import { parseMesh, sniffMeshFormat } from './index'

// A 2 mm cube, outward winding: volume 8.
const V = [
  [0, 0, 0], [2, 0, 0], [2, 2, 0], [0, 2, 0],
  [0, 0, 2], [2, 0, 2], [2, 2, 2], [0, 2, 2],
] // biome-ignore format: vertex table
const QUADS = [
  [0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4],
  [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7],
] // biome-ignore format: face table
const TRIS = QUADS.flatMap(([a, b, c, d]) => [
  [a!, b!, c!],
  [a!, c!, d!],
])

function binaryStl(): Uint8Array {
  const out = new Uint8Array(84 + 50 * TRIS.length)
  const view = new DataView(out.buffer)
  view.setUint32(80, TRIS.length, true)
  for (const [i, t] of TRIS.entries())
    for (const [k, v] of t.entries())
      for (const [c, x] of V[v]!.entries())
        view.setFloat32(84 + i * 50 + 12 + k * 12 + c * 4, x, true)
  return out
}

const asciiStl = () =>
  strToU8(
    `solid cube\n${TRIS.map((t) => `facet normal 0 0 0\nouter loop\n${t.map((v) => `vertex ${V[v]!.join(' ')}`).join('\n')}\nendloop\nendfacet`).join('\n')}\nendsolid cube\n`,
  )

// Quads, v/vt/vn tokens and negative (relative) indices.
const obj = () =>
  strToU8(
    `# cube\no cube\n${V.map((v) => `v ${v.join(' ')}`).join('\n')}\nvt 0 0\n${QUADS.map((q) => `f ${q.map((i) => `${i - 8}/1`).join(' ')}`).join('\n')}\n`,
  )

function ply(binary: boolean): Uint8Array {
  const header = `ply\nformat ${binary ? 'binary_little_endian' : 'ascii'} 1.0\ncomment test\nelement vertex 8\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nelement face 6\nproperty list uchar int vertex_indices\nend_header\n`
  if (!binary)
    return strToU8(
      `${header}${V.map((v) => `${v.join(' ')} 255`).join('\n')}\n${QUADS.map((q) => `4 ${q.join(' ')}`).join('\n')}\n`,
    )
  const body = new DataView(new ArrayBuffer(8 * 13 + 6 * 17))
  for (const [i, v] of V.entries()) {
    for (const [c, x] of v.entries()) body.setFloat32(i * 13 + c * 4, x, true)
    body.setUint8(i * 13 + 12, 255)
  }
  for (const [i, q] of QUADS.entries()) {
    body.setUint8(104 + i * 17, 4)
    for (const [k, v] of q.entries()) body.setInt32(104 + i * 17 + 1 + k * 4, v, true)
  }
  const h = strToU8(header)
  const out = new Uint8Array(h.length + body.byteLength)
  out.set(h)
  out.set(new Uint8Array(body.buffer), h.length)
  return out
}

/** glTF is Y-up: write the cube rotated into Y-up so the parser's conversion restores it. */
function glb(): Uint8Array {
  const positions = new Float32Array(V.flatMap(([x, y, z]) => [x!, z!, -y!]))
  const indices = new Uint16Array(TRIS.flat())
  const bin = new Uint8Array(positions.byteLength + indices.byteLength + 2)
  bin.set(new Uint8Array(positions.buffer), 0)
  bin.set(new Uint8Array(indices.buffer), positions.byteLength)
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, translation: [1, 1, 1] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
      { buffer: 0, byteOffset: positions.byteLength, byteLength: indices.byteLength },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 8, type: 'VEC3' },
      { bufferView: 1, componentType: 5123, count: indices.length, type: 'SCALAR' },
    ],
  }
  let text = JSON.stringify(json)
  while (text.length % 4) text += ' '
  const j = strToU8(text)
  const out = new Uint8Array(12 + 8 + j.length + 8 + bin.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, out.length, true)
  view.setUint32(12, j.length, true)
  view.setUint32(16, 0x4e4f534a, true)
  out.set(j, 20)
  view.setUint32(20 + j.length, bin.length, true)
  view.setUint32(24 + j.length, 0x004e4942, true)
  out.set(bin, 28 + j.length)
  return out
}

/** A component referencing the mesh object, placed by a build item transform. */
function threemf(): Uint8Array {
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <resources>
  <object id="1" type="model"><mesh>
   <vertices>${V.map(([x, y, z]) => `<vertex x="${x}" y="${y}" z="${z}"/>`).join('')}</vertices>
   <triangles>${TRIS.map(([a, b, c]) => `<triangle v1="${a}" v2="${b}" v3="${c}"/>`).join('')}</triangles>
  </mesh></object>
  <object id="2" type="model"><components><component objectid="1" transform="1 0 0 0 1 0 0 0 1 5 0 0"/></components></object>
 </resources>
 <build><item objectid="2" transform="1 0 0 0 1 0 0 0 1 0 0 1"/></build>
</model>`
  return zipSync({ '[Content_Types].xml': strToU8('<Types/>'), '3D/3dmodel.model': strToU8(model) })
}

describe('mesh import', () => {
  const cases: [string, () => Uint8Array][] = [
    ['stl', binaryStl],
    ['stl', asciiStl],
    ['obj', obj],
    ['ply', () => ply(false)],
    ['ply', () => ply(true)],
    ['glb', glb],
    ['3mf', threemf],
  ]
  for (const [format, make] of cases)
    it(`reads ${format} (${make.name || 'variant'}) into a closed cube`, () => {
      const bytes = make()
      expect(sniffMeshFormat(bytes)).toBe(format)
      const { mesh } = parseMesh(bytes)
      const welded = weldWithin(mesh, 1e-6)
      expect(welded.positions.length / 3).toBe(8)
      expect(welded.indices.length / 3).toBe(12)
      expect(meshVolume(welded)).toBeCloseTo(8, 5)
    })

  it('applies node and build transforms', () => {
    const g = parseMesh(glb()).mesh
    expect(Math.min(...Array.from(g.positions).filter((_, i) => i % 3 === 0))).toBeCloseTo(1, 6)
    const t = parseMesh(threemf()).mesh
    expect(Math.min(...Array.from(t.positions).filter((_, i) => i % 3 === 0))).toBeCloseTo(5, 6)
    expect(Math.min(...Array.from(t.positions).filter((_, i) => i % 3 === 2))).toBeCloseTo(1, 6)
  })

  it('rejects what it cannot read with an actionable message', () => {
    expect(() => parseMesh(strToU8('hello'))).toThrow(/STL, OBJ, PLY, GLB or 3MF/)
    expect(() => parseMesh(strToU8('{"asset":{"version":"2.0"}}'))).toThrow(/\.glb/)
    expect(() => parseMesh(strToU8('v 0 0 0\nf 1 2 3\n'))).toThrow(/vertex 2/)
  })
})
