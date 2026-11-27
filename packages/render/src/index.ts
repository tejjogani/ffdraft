/**
 * @pave/render core — isomorphic, no DOM or three.js. The material library, the look
 * catalogue, the scene resolver and the numeric render critique. Renderer backends live in
 * `@pave/render/three` (viewport) and `@pave/render/node` (Blender worker).
 */
export { circularBandLayout } from '@pave/kernel/circular-band'
export { ease, loops, RACK_FOCUS_FSTOP, resolveAnimation, sampleTrack } from './animation'
export {
  type AdjustablePath,
  applyAdjustments,
  assessRender,
  CHECKS,
  type RenderIssue,
  type RenderMetrics,
  type SceneAdjustment,
} from './assess'
export {
  CAMERA_PRESETS,
  type CameraPreset,
  cameraBasis,
  cameraPose,
  framePoints,
  MAX_ELEVATION,
  MIN_DISTANCE_SHARE,
  orbitOf,
  placeCustom,
  rolledBasis,
  SENSOR_WIDTH_MM,
  viewTangents,
} from './camera'
export {
  ASPECTS,
  type AspectKey,
  aspectOf,
  cinemaQuestions,
  MOTION_CHOICES,
  type MotionChoice,
  motionChoice,
  motionOf,
  outputSize,
  type PieceFeatures,
  PURPOSES,
  pieceFeatures,
  placeShot,
  type ShotFraming,
  type ShotRecipe,
  shotFraming,
  shotVocabulary,
} from './cinema'
export { hexToRgb, kelvinToRgb, luminance, type Rgb, srgbToLinear } from './color'
export {
  type CustomCamera,
  canonicalJson,
  customCameraPatch,
  describePose,
  dollyBy,
  type Framing,
  type FramingVerdict,
  orbitBy,
  panBy,
  poseFromLookAt,
  poseOf,
  predictFraming,
  projectPoint,
  resetCameraPatch,
  rollBy,
  sceneHash,
  type ViewPose,
} from './framing'
export { renderEvaluation, unassignedRhinoBody, withImportedBodyDefaults } from './import-preview'
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
export {
  type ChangeKind,
  cameraMoves,
  kindsOf,
  redoTarget,
  shotChangeRefusal,
  undoTarget,
} from './shot-history'
export { boundsCenter, boundsRadius, type SceneSubject, subjectOf } from './subject'
export {
  BROWSER_TAKE_SECONDS,
  DEFAULT_SHOTS,
  draftOf,
  estimateTakeSeconds,
  LOOK_CHOICES,
  lookLabel,
  machineTime,
  QUALITY_LABELS,
  type RenderRate,
  rateFrom,
  type ShotPreset,
  SIZE_PRESETS,
  TYPICAL_RATE,
  takePasses,
  takeWork,
} from './takes'
export * from './types'
