/**
 * The named outlines of `vectorBody` as path data, y up, about two units tall (they are scaled
 * to the body's height). Written as paths so they go through the same parser as user artwork;
 * with y up, an arc's sweep flag 1 turns counter-clockwise.
 */
import type { NodeOf } from '@pave/schema'

export type ShapeName = Extract<NodeOf<'vectorBody'>['source'], { type: 'shape' }>['shape']

/** Regular polygon path, one vertex straight up. */
function polygon(n: number, r: number, inner?: number): string {
  const points: string[] = []
  const count = inner === undefined ? n : 2 * n
  for (let i = 0; i < count; i++) {
    const a = Math.PI / 2 + (i * 2 * Math.PI) / count
    const radius = inner !== undefined && i % 2 === 1 ? inner : r
    points.push(`${(radius * Math.cos(a)).toFixed(5)} ${(radius * Math.sin(a)).toFixed(5)}`)
  }
  return `M ${points.join(' L ')} Z`
}

export const SHAPES: Record<ShapeName, string> = {
  circle: 'M 1 0 A 1 1 0 1 1 -1 0 A 1 1 0 1 1 1 0 Z',
  oval: 'M 0.75 0 A 0.75 1 0 1 1 -0.75 0 A 0.75 1 0 1 1 0.75 0 Z',
  // Lobes on top, point at the bottom; the cleft is a soft cusp rather than a knife edge.
  heart:
    'M 0 -1 C -0.38 -0.6 -1 -0.18 -1 0.36 C -1 0.8 -0.64 1.02 -0.33 1.02 C -0.12 1.02 0 0.88 0 0.7 ' +
    'C 0 0.88 0.12 1.02 0.33 1.02 C 0.64 1.02 1 0.8 1 0.36 C 1 -0.18 0.38 -0.6 0 -1 Z',
  // Classic five-point star, inner radius at the golden-ratio proportion of a pentagram.
  star: polygon(5, 1, 0.382),
  // Latin cross: the crossbar a third of the way down.
  cross: 'M -0.17 1 L 0.17 1 L 0.17 0.5 L 0.6 0.5 L 0.6 0.16 L 0.17 0.16 L 0.17 -1 L -0.17 -1 L -0.17 0.16 L -0.6 0.16 L -0.6 0.5 L -0.17 0.5 Z',
  // Heater shield.
  shield: 'M -0.8 1 L 0.8 1 L 0.8 0.25 C 0.8 -0.42 0.36 -0.78 0 -1 C -0.36 -0.78 -0.8 -0.42 -0.8 0.25 Z',
  hexagon: polygon(6, 1),
  teardrop: 'M 0 1 C 0.16 0.66 0.68 0.08 0.68 -0.32 A 0.68 0.68 0 1 0 -0.68 -0.32 C -0.68 0.08 -0.16 0.66 0 1 Z',
  // Military-style tag: a tall rounded rectangle.
  tag:
    'M -0.42 1 L 0.42 1 A 0.2 0.2 0 0 0 0.62 0.8 L 0.62 -0.8 A 0.2 0.2 0 0 0 0.42 -1 ' +
    'L -0.42 -1 A 0.2 0.2 0 0 0 -0.62 -0.8 L -0.62 0.8 A 0.2 0.2 0 0 0 -0.42 1 Z',
}
