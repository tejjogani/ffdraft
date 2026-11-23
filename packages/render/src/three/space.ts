/**
 * The resolved scene is Z-up millimetres; three.js is Y-up. Everything built from a resolved
 * scene lives under a group rotated by −90° about X, so positions and quaternions are used
 * verbatim and units stay millimetres.
 */
import { Group, Quaternion, Vector3 } from 'three'
import type { Quat, Vec3 } from '../math'

export const Z_UP = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2)

/** A group whose children are authored in the Z-up piece frame. */
export function zUpGroup(name: string): Group {
  const g = new Group()
  g.name = name
  g.quaternion.copy(Z_UP)
  return g
}

export const toThreePoint = (p: Vec3): Vector3 => new Vector3(p[0], p[2], -p[1])
export const toThreeQuat = (q: Quat): Quaternion => Z_UP.clone().multiply(new Quaternion(q[0], q[1], q[2], q[3]))
