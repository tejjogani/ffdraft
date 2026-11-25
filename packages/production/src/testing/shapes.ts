/** Analytic test meshes with exact normals: boxes, spheres, tori. Test only. */
import type { MeshData } from '@pave/kernel/types'

/** Axis-aligned box, hard edges (vertices split per face), outward winding. */
export function box(min: [number, number, number], max: [number, number, number]): MeshData {
  const [x0, y0, z0] = min
  const [x1, y1, z1] = max
  const faces: [number[][], number[]][] = [
    [
      [
        [x0, y0, z0],
        [x0, y0, z1],
        [x0, y1, z1],
        [x0, y1, z0],
      ],
      [-1, 0, 0],
    ],
    [
      [
        [x1, y0, z0],
        [x1, y1, z0],
        [x1, y1, z1],
        [x1, y0, z1],
      ],
      [1, 0, 0],
    ],
    [
      [
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y0, z1],
        [x0, y0, z1],
      ],
      [0, -1, 0],
    ],
    [
      [
        [x0, y1, z0],
        [x0, y1, z1],
        [x1, y1, z1],
        [x1, y1, z0],
      ],
      [0, 1, 0],
    ],
    [
      [
        [x0, y0, z0],
        [x0, y1, z0],
        [x1, y1, z0],
        [x1, y0, z0],
      ],
      [0, 0, -1],
    ],
    [
      [
        [x0, y0, z1],
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y1, z1],
      ],
      [0, 0, 1],
    ],
  ]
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  for (const [quad, n] of faces) {
    const base = positions.length / 3
    for (const p of quad) {
      positions.push(...p)
      normals.push(...n)
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    indices: Uint32Array.from(indices),
  }
}

/** Smooth parametric surface over a (u, v) grid, wrapped in u and optionally in v. */
function grid(
  nu: number,
  nv: number,
  wrapV: boolean,
  at: (u: number, v: number) => { p: [number, number, number]; n: [number, number, number] },
): MeshData {
  const rows = wrapV ? nv : nv + 1
  const positions = new Float32Array(nu * rows * 3)
  const normals = new Float32Array(nu * rows * 3)
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < nu; i++) {
      const { p, n } = at(i / nu, j / nv)
      positions.set(p, (j * nu + i) * 3)
      normals.set(n, (j * nu + i) * 3)
    }
  const indices: number[] = []
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const a = j * nu + i
      const b = j * nu + ((i + 1) % nu)
      const c = ((j + 1) % rows) * nu + ((i + 1) % nu)
      const d = ((j + 1) % rows) * nu + i
      indices.push(a, c, b, a, d, c)
    }
  return { positions, normals, indices: Uint32Array.from(indices) }
}

/** Torus around the Y axis (a plain band), major radius R, tube radius r. */
export function torus(R: number, r: number, nu = 128, nv = 48): MeshData {
  return grid(nu, nv, true, (u, v) => {
    const a = u * 2 * Math.PI
    const b = v * 2 * Math.PI
    const n: [number, number, number] = [
      Math.cos(b) * Math.sin(a),
      -Math.sin(b),
      Math.cos(b) * Math.cos(a),
    ]
    return {
      p: [
        (R + r * Math.cos(b)) * Math.sin(a),
        -r * Math.sin(b),
        (R + r * Math.cos(b)) * Math.cos(a),
      ],
      n,
    }
  })
}

/** UV sphere (poles as degenerate rings; fine for drawing tests). */
export function sphere(
  r: number,
  c: [number, number, number] = [0, 0, 0],
  nu = 96,
  nv = 48,
): MeshData {
  return grid(nu, nv, false, (u, v) => {
    const a = u * 2 * Math.PI
    const b = v * Math.PI
    const n: [number, number, number] = [
      Math.sin(b) * Math.cos(a),
      Math.sin(b) * Math.sin(a),
      Math.cos(b),
    ]
    return { p: [c[0] + r * n[0], c[1] + r * n[1], c[2] + r * n[2]], n }
  })
}

/** Solid cone on z = 0 with its apex up: a spike stud. Closed, outward-wound. */
export function cone(r: number, h: number, n = 96): MeshData {
  // Vertices: base centre 0, apex 1, then the rim; normals are only used for display.
  const positions = [0, 0, 0, 0, 0, h]
  const normals = [0, 0, -1, 0, 0, 1]
  const indices: number[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI
    positions.push(r * Math.cos(a), r * Math.sin(a), 0)
    const k = Math.hypot(h, r)
    normals.push((h / k) * Math.cos(a), (h / k) * Math.sin(a), r / k)
    const p = 2 + i
    const q = 2 + ((i + 1) % n)
    indices.push(0, q, p, 1, p, q)
  }
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    indices: Uint32Array.from(indices),
  }
}
