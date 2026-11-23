/**
 * Client tools: operations only a studio window can perform — look through its viewport, read
 * or change what is on screen. They share the command registry's shape and are offered to the
 * assistant and MCP alongside the `tool` commands, but they run in the studio: the server asks a
 * window of the calling user (`client.request` event, the originating `clientId` first) and the
 * window answers with the `client.respond` command.
 */
import { z } from 'zod'
import { type CommandDef, EvaluationSummarySchema } from './commands'
import { RenderSceneSchema } from './entities'

const def = <I extends z.ZodType, O extends z.ZodType>(d: CommandDef<I, O>) => d

const id = z.string()

/** Named camera framings, shared with renders (`RenderScene.camera.preset` without `custom`). */
export const CameraPresetSchema = RenderSceneSchema.shape.camera
  .unwrap()
  .shape.preset.unwrap()
  .exclude(['custom'])
export type CameraPreset = z.infer<typeof CameraPresetSchema>

/** A view: a named framing, or an orbit angle (degrees; azimuth 0 = front, elevation 90 = top). */
export const ViewSchema = z.union([
  CameraPresetSchema,
  z.object({ azimuth: z.number().min(-360).max(360), elevation: z.number().min(-90).max(90) }),
])
export type View = z.infer<typeof ViewSchema>

/** The tabs of a piece page, as `ui.navigate` and `ui.context` name them. */
export const PIECE_TABS = [
  'overview',
  'design',
  'render',
  'on-model',
  'sourcing',
  'production',
  'history',
] as const

export const clientTools = {
  'viewport.capture': def({
    description:
      'Look at a piece: images of its current CAD from up to six angles, plus the facts of the design. Use after edits to check your work visually. `clay` (default) shows form; `rendered` shows metal and stones; `technical` is a hidden-line drawing. `focusNodeIds` frames and highlights those features; `annotate` labels them. Without an open window the server answers with `technical` views.',
    kind: 'query',
    // The images are stored as assets, which needs write access.
    role: 'designer',
    tool: true,
    input: z.object({
      pieceId: id,
      views: z.array(ViewSchema).min(1).max(6),
      mode: z.enum(['rendered', 'clay', 'technical']).default('clay'),
      size: z.union([z.literal(512), z.literal(768), z.literal(1024)]).default(768),
      focusNodeIds: z.array(id).max(50).optional(),
      annotate: z.boolean().optional(),
    }),
    output: z.object({
      /** The design version the images show. */
      version: z.number().int(),
      /** `studio` = a window's live viewport; `server` = the headless hidden-line fallback. */
      source: z.enum(['studio', 'server']),
      images: z.array(z.object({ view: ViewSchema, assetId: id })),
      summary: EvaluationSummarySchema,
    }),
  }),
  'viewport.select': def({
    description:
      'Select features of a piece in the open Design view, to point the designer at them ("this prong", "these stones").',
    kind: 'mutation',
    role: 'viewer',
    tool: true,
    input: z.object({ pieceId: id, nodeIds: z.array(id).max(200) }),
    output: z.object({ ok: z.literal(true) }),
  }),
  'ui.context': def({
    description:
      'What the designer is looking at right now: the page, piece and tab, board, render shot and selected features. Use it to resolve "this" and "here".',
    kind: 'query',
    tool: true,
    input: z.object({}),
    output: z.object({
      /** The studio route, e.g. `/pieces/pc_1/design`. */
      route: z.string(),
      pieceId: id.nullable(),
      tab: z.enum(PIECE_TABS).nullable(),
      boardId: id.nullable(),
      sceneId: id.nullable(),
      selection: z.array(id),
      /** The design version the window shows, when a piece is open. */
      version: z.number().int().nullable(),
    }),
  }),
  'ui.navigate': def({
    description:
      'Open a piece (optionally on a tab and with features selected) or a board in the designer’s window. Use it to show the result of your work; do not navigate away while the designer is editing unless asked.',
    kind: 'mutation',
    role: 'viewer',
    tool: true,
    input: z.object({
      pieceId: id.optional(),
      tab: z.enum(PIECE_TABS).optional(),
      boardId: id.optional(),
      selectNodeIds: z.array(id).max(200).optional(),
    }),
    output: z.object({ ok: z.literal(true) }),
  }),
} as const

export type ClientToolName = keyof typeof clientTools
export type ClientToolInput<N extends ClientToolName> = z.input<(typeof clientTools)[N]['input']>
export type ClientToolParsedInput<N extends ClientToolName> = z.output<(typeof clientTools)[N]['input']>
export type ClientToolOutput<N extends ClientToolName> = z.output<(typeof clientTools)[N]['output']>
export const CLIENT_TOOL_NAMES = Object.keys(clientTools) as [ClientToolName, ...ClientToolName[]]
