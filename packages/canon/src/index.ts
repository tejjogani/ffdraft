/**
 * @pave/canon: jewelry-design knowledge as data (research 09) — rules over facts, style guides
 * and exemplars — with suggestion, lint, design reads and prompt rendering.
 */

export { matchStyles } from './engine'
export { buildExemplar, EXEMPLAR_SOURCES, getExemplars } from './exemplars/index'
export { type Expr, ExprSchema, evalExpr, printExpr } from './expr'
export { CAVEATS } from './caveats'
export { FACTS, type FactKey, type Facts, factsOf, heroGem, type PairWith } from './facts'
export { type LintOptions, lintDesign } from './lint'
export { MEASURES } from './measures'
export * from './model'
export { CANON_INDEX, renderCanonForPrompt, UNIVERSAL_PRINCIPLES } from './prompt'
export { type CanonQuery, canonFor } from './query'
export { diffReads, inferArchetype, type ReadDiff, readDesign, targetsFrom } from './read'
export { FAILURE_MODES, RUBRIC, VIEW_SETS } from './rubric'
export { RULE_FAMILIES, RULES, RULES_BY_ID } from './rules/index'
export { STYLES } from './styles/index'
export {
  canonDefaults,
  RECIPE_PARAMS,
  type RecipeDefaults,
  type RecipeParam,
  type SuggestOptions,
  type Suggestion,
  suggestDesign,
  suggestParameters,
} from './suggest'
export { CANON_VERSION } from './version'
