/**
 * The two live streams, as they cross the wire.
 *
 *  - `ServerEvent`: org-scoped change notifications on `GET /api/events` (server-sent events
 *    named by `type`). Some are targeted at one user or one studio window.
 *  - `RunEvent`: one assistant run as it happens, on the run's own stream. `seq` numbers each
 *    run's events from 1 so a client can resume and drop duplicates.
 */
import { z } from 'zod'
import { CLIENT_TOOL_NAMES } from './client-tools'
import {
  JOB_KINDS,
  JOB_STATUS,
  MessageSchema,
  RUN_STATUS,
  RunSchema,
  StoredChangeSchema,
  TokensSchema,
} from './entities'

const id = z.string()

export const ServerEventSchema = z.discriminatedUnion('type', [
  /** A change was committed; `version` is the piece's new version (= `change.seq`). */
  z.object({
    type: z.literal('design.changed'),
    pieceId: id,
    version: z.number().int(),
    change: StoredChangeSchema,
  }),
  /** Anything else about a piece changed: title, stage, spec, cover, facts, origin. */
  z.object({ type: z.literal('piece.updated'), pieceId: id }),
  /** A board or its references changed. */
  z.object({ type: z.literal('board.updated'), boardId: id }),
  /** A saved shot was created, adjusted or deleted (`pieceId` null for a house shot). */
  z.object({ type: z.literal('scene.updated'), sceneId: id, pieceId: id.nullable() }),
  /** A long-running job moved; carries enough to update a progress ring without refetching. */
  z.object({
    type: z.literal('job.updated'),
    kind: z.enum(JOB_KINDS),
    id,
    pieceId: id,
    status: z.enum(JOB_STATUS),
    progress: z.number().min(0).max(1),
  }),
  /** An assistant run changed status. Sent to the run's user only. */
  z.object({
    type: z.literal('run.updated'),
    runId: id,
    threadId: id.nullable(),
    status: z.enum(RUN_STATUS),
  }),
  /**
   * The server asks a studio window to run a client tool. Sent to the originating window when
   * it is connected, else to every window of the user; the first `client.respond` wins.
   */
  z.object({
    type: z.literal('client.request'),
    requestId: id,
    runId: id.nullable(),
    tool: z.enum(CLIENT_TOOL_NAMES),
    input: z.unknown(),
  }),
])
export type ServerEvent = z.infer<typeof ServerEventSchema>
export type ServerEventType = ServerEvent['type']
export const SERVER_EVENT_TYPES = ServerEventSchema.options.map(
  (o) => o.shape.type.value,
) as ServerEventType[]

/** Who a targeted server event is for: one user, preferably one of their windows. */
export interface EventAudience {
  userId: string
  clientId?: string
}

const run = { runId: id, seq: z.number().int().min(1) }

export const RunEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('run.started'), ...run, run: RunSchema }),
  /** Streamed assistant text, for content block `index` of the message being written. */
  z.object({ type: z.literal('text.delta'), ...run, index: z.number().int(), text: z.string() }),
  /** Summarised thinking, shown collapsed. */
  z.object({ type: z.literal('thinking.delta'), ...run, index: z.number().int(), text: z.string() }),
  /** A message was stored (assistant turn, tool results, or appended context). */
  z.object({ type: z.literal('message.completed'), ...run, message: MessageSchema }),
  z.object({
    type: z.literal('tool.started'),
    ...run,
    toolCallId: id,
    name: z.string(),
    input: z.unknown(),
  }),
  /** A `confirm` tool is waiting for a person: answer with `runs.decide`. */
  z.object({
    type: z.literal('tool.awaiting'),
    ...run,
    toolCallId: id,
    name: z.string(),
    input: z.unknown(),
    /** One plain sentence describing what will happen. */
    summary: z.string(),
    /** Only when the service can say what it will cost. */
    estimate: z.object({ usd: z.number(), seconds: z.number().nullable() }).nullable(),
  }),
  z.object({
    type: z.literal('tool.finished'),
    ...run,
    toolCallId: id,
    name: z.string(),
    isError: z.boolean(),
    /** Design changes and assets the call produced, for chips and Undo. */
    changeIds: z.array(id),
    assetIds: z.array(id),
  }),
  z.object({ type: z.literal('usage'), ...run, tokens: TokensSchema, costUsd: z.number() }),
  z.object({ type: z.literal('run.finished'), ...run, run: RunSchema }),
])
export type RunEvent = z.infer<typeof RunEventSchema>
export type RunEventType = RunEvent['type']
