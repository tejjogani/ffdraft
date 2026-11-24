/**
 * The part of @pave/agent a studio window needs: chip words, the run-event reducer, AI job
 * recipes and the run caps. Kept apart from `.` so the browser bundle never carries the prompt,
 * the canon or the tool schemas.
 */
export { type Chip, describeCall, TOOL_CHIPS } from './describe'
export * from './events'
export { MAX_TURNS, RUN_CAP_USD } from './gate'
export * from './jobs'
