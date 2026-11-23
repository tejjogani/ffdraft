/**
 * @pave/render/three — three.js (r187, WebGLRenderer) backend for the CAD viewport and the
 * render studio. Kept apart from the core entry so the core stays DOM-free.
 */
export {
  buildRigScene,
  createEnvironment,
  environmentRotation,
  type PaveEnvironment,
  sparkleUniforms,
} from './environment'
export { type EvaluationToThreeOptions, evaluationToThree, PaveModel } from './evaluation'
export {
  createSurfaceGemMaterial,
  GEM_QUALITY,
  GemMaterial,
  type GemQuality,
  MAX_SPARKLES,
  type SparkleUniforms,
} from './gem'
export { createMetalMaterial, createMetalMaterialFrom } from './metal'
export { toThreePoint, toThreeQuat, Z_UP, zUpGroup } from './space'
export {
  type ApplyOptions,
  applyResolvedScene,
  configureRenderer,
  type StageController,
} from './stage'
