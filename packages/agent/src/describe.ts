/**
 * The words a conversation shows for each tool call: a chip while it runs and after it ran.
 * Mutations read as past-tense edits ("Widened the band to 2.4 mm" is the change's own label);
 * queries are quiet one-liners that collapse together ("Looked at the piece · Checked weights").
 *
 * Keyed by every tool, so a new tool command without words fails the typecheck.
 */
import type { AgentToolInput, AgentToolName } from './tools'

export interface Chip<N extends AgentToolName> {
  /** Reads and looks: collapsed into one quiet line. */
  quiet?: true
  /** While it runs ("Building the design…" without the ellipsis). */
  running: string
  /** After it ran: a plain sentence, or one built from the call's input. */
  done: string | ((input: AgentToolInput<N>) => string)
}

type Chips = { [N in AgentToolName]: Chip<N> }

interface LooseChip {
  quiet?: true
  running: string
  done: string | ((input: unknown) => string)
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

const VIEWS_LABEL = (views: readonly unknown[]) =>
  views.map((v) => (typeof v === 'string' ? v : 'an angle')).join(', ')

export const TOOL_CHIPS = {
  'collections.list': { quiet: true, running: 'Listing collections', done: 'Listed collections' },
  'collections.create': {
    running: 'Creating a collection',
    done: (i) => `Created the collection “${i.name}”`,
  },
  'pieces.list': { quiet: true, running: 'Looking through pieces', done: 'Looked through pieces' },
  'pieces.get': { quiet: true, running: 'Reading the piece', done: 'Read the piece' },
  'pieces.create': {
    running: 'Creating the piece',
    done: (i) => (i.title ? `Created “${i.title}”` : 'Created a piece'),
  },
  'pieces.update': { running: 'Updating the piece', done: 'Updated the piece details' },
  'pieces.setSpec': {
    running: 'Writing the spec',
    done: (i) => `Wrote the spec: ${i.spec.title}`,
  },
  'pieces.buildFromSpec': {
    running: 'Building the design',
    done: 'Built the design from the spec',
  },
  'pieces.duplicate': { running: 'Duplicating the piece', done: 'Duplicated the piece' },
  'pieces.delete': { running: 'Deleting the piece', done: 'Deleted the piece' },
  'design.apply': { running: 'Editing the design', done: (i) => i.label },
  'design.history': { quiet: true, running: 'Reading the history', done: 'Read the history' },
  'design.revert': {
    running: 'Undoing',
    done: (i) => (i.runId ? 'Undid this run’s changes' : `Undid change ${i.seq}`),
  },
  'design.evaluate': {
    quiet: true,
    running: 'Checking weights and manufacturability',
    done: 'Checked weights and manufacturability',
  },
  'design.export': {
    running: 'Exporting',
    done: (i) => `Exported ${i.format.toUpperCase()}`,
  },
  'boards.list': { quiet: true, running: 'Listing boards', done: 'Listed boards' },
  'boards.get': { quiet: true, running: 'Reading the board', done: 'Read the board' },
  'boards.create': { running: 'Creating a board', done: (i) => `Created the board “${i.title}”` },
  'boards.delete': { running: 'Deleting the board', done: 'Deleted the board' },
  'references.search': {
    quiet: true,
    running: 'Searching for references',
    done: (i) => `Searched for “${i.query}”`,
  },
  'references.save': {
    running: 'Saving references',
    done: (i) => `Saved ${plural(i.items.length, 'reference')} to the board`,
  },
  'references.lineage': {
    quiet: true,
    running: 'Tracing where a reference came from',
    done: 'Traced a reference',
  },
  'references.similar': {
    quiet: true,
    running: 'Finding similar references',
    done: 'Found similar references',
  },
  'references.estimate': {
    quiet: true,
    running: 'Pricing image generation',
    done: 'Priced image generation',
  },
  'references.generate': {
    running: 'Generating images',
    done: (i) => `Generated ${plural(i.count, 'image')}`,
  },
  'references.read': {
    running: 'Reading the photo',
    done: (i) => (i.assetIds.length > 1 ? `Read ${i.assetIds.length} photos` : 'Read the photo'),
  },
  'match.fit': {
    running: 'Fitting the design to the photo',
    done: 'Fitted the design to the photo',
  },
  'freeform.analyze': {
    running: 'Analysing the image',
    done: 'Analysed the image for an outline and a relief',
  },
  'mesh3d.estimate': { quiet: true, running: 'Pricing image-to-3D', done: 'Priced image-to-3D' },
  'mesh3d.create': { running: 'Starting image-to-3D', done: 'Started image-to-3D' },
  'mesh3d.list': { quiet: true, running: 'Listing 3D jobs', done: 'Listed 3D jobs' },
  'mesh3d.get': { quiet: true, running: 'Checking the 3D job', done: 'Checked the 3D job' },
  'scenes.list': { quiet: true, running: 'Listing shots', done: 'Listed shots' },
  'scenes.create': { running: 'Saving a shot', done: 'Saved a shot' },
  'scenes.update': { running: 'Adjusting the shot', done: 'Adjusted the shot' },
  'renders.list': { quiet: true, running: 'Listing renders', done: 'Listed renders' },
  'renders.get': { quiet: true, running: 'Checking the render', done: 'Checked the render' },
  'renders.create': { running: 'Queuing a render', done: 'Queued a render' },
  'models.list': { quiet: true, running: 'Listing models', done: 'Listed models' },
  'models.estimatePortraits': {
    quiet: true,
    running: 'Pricing portraits',
    done: 'Priced portraits',
  },
  'models.generatePortraits': { running: 'Generating portraits', done: 'Generated portraits' },
  'shots.list': { quiet: true, running: 'Listing on-model images', done: 'Listed on-model images' },
  'shots.get': {
    quiet: true,
    running: 'Checking the on-model image',
    done: 'Checked the on-model image',
  },
  'shots.estimate': {
    quiet: true,
    running: 'Pricing on-model images',
    done: 'Priced on-model images',
  },
  'shots.create': {
    running: 'Generating on-model images',
    done: (i) => `Generated ${plural(i.count, 'on-model image')}`,
  },
  'production.list': {
    quiet: true,
    running: 'Listing production packages',
    done: 'Listed production packages',
  },
  'production.create': {
    running: 'Building the production package',
    done: 'Built the production package',
  },
  'viewport.capture': {
    quiet: true,
    running: 'Looking at the piece',
    done: (i) => `Looked from ${VIEWS_LABEL(i.views)}`,
  },
  'viewport.select': {
    running: 'Pointing at features',
    done: (i) =>
      i.nodeIds.length
        ? `Selected ${plural(i.nodeIds.length, 'feature')}`
        : 'Cleared the selection',
  },
  'ui.context': { quiet: true, running: 'Checking what is on screen', done: 'Checked the screen' },
  'ui.navigate': {
    running: 'Opening',
    done: (i) => (i.boardId ? 'Opened the board' : 'Opened the piece'),
  },
} satisfies Chips

/** The chip text for a call, given its validated input (or null when the input was invalid). */
export function describeCall<N extends AgentToolName>(
  name: N,
  input: AgentToolInput<N> | null,
  state: 'running' | 'done',
): { text: string; quiet: boolean } {
  // The table is checked per tool above; here one entry is read, so its input type is erased.
  const chip = (TOOL_CHIPS as unknown as Record<string, LooseChip>)[name]!
  const quiet = chip.quiet === true
  if (state === 'running') return { text: chip.running, quiet }
  const done =
    typeof chip.done === 'function' ? (input ? chip.done(input) : chip.running) : chip.done
  return { text: done, quiet }
}
