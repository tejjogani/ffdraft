/**
 * Seeded randomness. Every stochastic step in the kernel (surface sampling, layout seeds) draws
 * from here so identical input always gives identical geometry — never `Math.random`.
 */

/** mulberry32: a tiny, fast 32-bit generator with good statistical quality for geometry. */
export function seededRandom(seed: number): () => number {
  let state = (Math.imul(seed | 0, 0x9e3779b1) ^ 0x6d2b79f5) >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
