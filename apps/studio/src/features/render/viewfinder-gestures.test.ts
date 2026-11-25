/** The viewfinder's gestures: which way each one moves the camera, and by how much. */
import { poseOf, projectPoint, type ViewPose } from '@pave/render'
import { describe, expect, it } from 'vitest'
import { drag, dragModeOf, key, pinch, touchOf, wheel } from './viewfinder-gestures'

const pose: ViewPose = poseOf(
  { target: [0, 0, 5], azimuth: 30, elevation: 20, distance: 80, roll: 0, focalLength: 90 },
  10,
)
const mods = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false }

describe('pointer drags', () => {
  it('picks orbit, pan or roll from the button and modifiers', () => {
    expect(dragModeOf({ button: 0, shiftKey: false, altKey: false })).toBe('orbit')
    expect(dragModeOf({ button: 0, shiftKey: true, altKey: false })).toBe('pan')
    expect(dragModeOf({ button: 2, shiftKey: false, altKey: false })).toBe('pan')
    expect(dragModeOf({ button: 0, shiftKey: false, altKey: true })).toBe('roll')
  })

  it('orbits: right turns the front to the right, down shows it from higher', () => {
    const right = drag(pose, 'orbit', 20, 0, 400, 400)
    expect(right.azimuth).toBeLessThan(pose.azimuth)
    expect(drag(pose, 'orbit', 0, 20, 400, 400).elevation).toBeGreaterThan(pose.elevation)
    expect(right.target).toEqual(pose.target)
  })

  it('pans so the piece follows the pointer', () => {
    const moved = drag(pose, 'pan', 40, 0, 400, 400)
    const at = projectPoint(moved, 1, pose.target)!
    expect(at[0]).toBeCloseTo(0.6, 5)
    const down = drag(pose, 'pan', 0, 40, 400, 400)
    expect(projectPoint(down, 1, pose.target)![1]).toBeCloseTo(0.6, 5)
  })

  it('rolls clockwise when dragged right with alt', () => {
    expect(drag(pose, 'roll', 40, 0, 400, 400).roll).toBeGreaterThan(0)
  })
})

describe('wheel, pinch and keys', () => {
  it('comes closer on scroll up and further on scroll down', () => {
    expect(wheel(pose, -100).distance).toBeLessThan(pose.distance)
    expect(wheel(pose, 100).distance).toBeGreaterThan(pose.distance)
  })

  it('spreads to come closer and twists to roll with the fingers', () => {
    const from = touchOf([100, 100], [200, 100])
    const spread = touchOf([50, 100], [250, 100])
    expect(pinch(pose, from, spread, 400, 400).distance).toBeCloseTo(pose.distance / 2, 5)
    // The second finger moves down: a clockwise twist on screen.
    const twisted = touchOf([100, 100], [200, 200])
    expect(pinch(pose, from, twisted, 400, 400).roll).toBeCloseTo(45, 5)
  })

  it('moves the camera with the arrows, and ignores other keys', () => {
    expect(key(pose, { key: 'ArrowRight', ...mods }, 1)!.azimuth).toBe(35)
    expect(key(pose, { key: 'ArrowUp', ...mods }, 1)!.elevation).toBe(25)
    expect(key(pose, { key: 'ArrowUp', ...mods, shiftKey: true }, 1)!.elevation).toBe(21)
    expect(key(pose, { key: ']', ...mods }, 1)!.roll).toBe(1)
    expect(key(pose, { key: '=', ...mods }, 1)!.distance).toBeLessThan(80)
    const panned = key(pose, { key: 'ArrowLeft', ...mods, altKey: true }, 1)!
    expect(panned.azimuth).toBe(pose.azimuth)
    expect(panned.target).not.toEqual(pose.target)
    expect(key(pose, { key: 'a', ...mods }, 1)).toBeNull()
  })
})
