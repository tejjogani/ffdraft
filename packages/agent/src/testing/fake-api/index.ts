/**
 * The fake Claude API, for tests and for recording journeys with Claude in the loop. Test-only:
 * nothing in the app imports it. See ./server for what it does and ./rules for every rule it
 * enforces, each with the document it comes from.
 */
export { type BindingResult, checkBinding, prefixHash, signThinking } from './binding'
export { PromptCache, segmentsOf } from './cache'
export { conformError } from './conform'
export {
  align,
  describeMessages,
  type RecordedExchange,
  Recorder,
  type Recording,
  recordedMessages,
  remap,
  stripImages,
} from './recording'
export type { FakeReply, Fault, RefusalCategory, ReplyBlock } from './reply'
export {
  betasOf,
  imageSize,
  keyOf,
  RULES,
  type RuleInfo,
  type Violation,
  validateMessages,
} from './rules'
export {
  DEFAULT_FAKE_KEY,
  type Exchange,
  type FakeApi,
  type FakeApiOptions,
  type ReplySource,
  type SourceRequest,
  startFakeApi,
} from './server'
export {
  agentSource,
  type ReplayReport,
  type ReplaySource,
  replaySource,
  type ScriptedReply,
  type ScriptedSource,
  scriptedSource,
} from './sources'
export { canRead, FAKE_MODELS, type FakeModel, MODEL_SPECS } from './spec'
