/**
 * @pave/render core — isomorphic, no DOM or three.js. The material library, the look
 * catalogue, the scene resolver and the numeric render critique. Renderer backends live in
 * `@pave/render/three` (viewport) and `@pave/render/node` (Blender worker).
 */
export { ease, RACK_FOCUS_FSTOP, sampleTrack } from './animation'
export {
  type AdjustablePath,
  applyAdjustments,
  assessRender,
  CHECKS,
  type RenderIssue,
  type RenderMetrics,
  type SceneAdjustment,
} from './assess'
export { CAMERA_PRESETS, type CameraPreset, cameraBasis, cameraPose, framePoints, SENSOR_WIDTH_MM, viewTangents } from './camera'
export { hexToRgb, kelvinToRgb, luminance, type Rgb, srgbToLinear } from './color'
export {
  type Background,
  DEFAULT_GROUNDS,
  type GroundKind,
  type GroundSpec,
  LOOK_IDS,
  LOOKS,
  type Look,
  type LookId,
  type RigPanel,
  type RigSparkle,
  type ViewTransform,
} from './looks'
export * from './materials'
export type { Quat, Vec3 } from './math'
export { resolveScene } from './resolve'
export { boundsRadius, type SceneSubject, subjectOf } from './subject'
export * from './types'
