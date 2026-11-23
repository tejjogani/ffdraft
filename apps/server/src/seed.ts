/**
 * The welcome workspace: a few collections of template pieces and a moodboard, so a first run
 * opens onto something to explore rather than an empty screen. Built through the same commands
 * a person would use, attributed to the system.
 */
import type { CommandInput, CommandName } from '@pave/schema'
import { eq } from 'drizzle-orm'
import type { Ctx } from './context'
import * as t from './db/schema'
import { insertReferences } from './handlers/ideate'
import type { Runtime } from './runtime'

const COLLECTIONS = [
  { name: 'Bridal', icon: '💍', templates: ['solitaire', 'oval-pave', 'halo', 'three-stone'] },
  { name: 'Iced', icon: '❄️', templates: ['iced-trophy', 'iced-initial', 'cuban', 'tennis'] },
  { name: 'Bands', icon: '◯', templates: ['wedding-band', 'eternity', 'signet'] },
] as const

const NOTES = [
  {
    title: 'Start here',
    note: 'Collect references on a board, agree a spec, then build the CAD from it.',
  },
  {
    title: 'Bridal brief',
    note: 'Soft cushion and oval shapes, fine shanks, warm platinum and yellow gold.',
  },
  {
    title: 'Iced direction',
    note: 'Full pavé, high polish borders, heavy Cuban links. Lab diamonds or moissanite.',
  },
]

const SWATCHES = [
  { title: '18k yellow gold', palette: ['#E6C068', '#C9A13B', '#F3DFA2'] },
  { title: 'Platinum', palette: ['#E5E4E2', '#C7C9CC', '#F4F4F2'] },
  { title: 'Rose gold', palette: ['#E8B4A0', '#C98B73', '#F4D3C4'] },
  { title: 'Emerald and diamond', palette: ['#1F7A5A', '#50C878', '#F8FBFF'] },
]

/** Creates the welcome workspace in `ctx`'s org and marks the org as seeded. */
export async function seedWelcome(runtime: Runtime, ctx: Ctx): Promise<void> {
  const run = <N extends CommandName>(name: N, input: CommandInput<N>) =>
    runtime.invoke(name, input, ctx)

  for (const c of COLLECTIONS) {
    const collection = await run('collections.create', { name: c.name, icon: c.icon })
    for (const templateId of c.templates)
      await run('pieces.create', { templateId, collectionId: collection.id })
  }

  const board = await run('boards.create', {
    title: 'Welcome moodboard',
    description: 'Notes and swatches to get you started. Search for references to add images.',
  })
  await run('references.save', { boardId: board.id, items: NOTES })
  await insertReferences(
    ctx,
    board.id,
    SWATCHES.map((s) => ({ type: 'swatch', title: s.title, palette: s.palette, rights: 'own' })),
  )

  await ctx.repo.settings.insertIfAbsent({})
  await ctx.repo.settings.update(eq(t.orgSettings.orgId, ctx.orgId), {
    welcomeSeededAt: new Date(),
  })
}

/** Seeds an org the first time it is opened, if it has no pieces and was never seeded. */
export async function seedIfEmpty(runtime: Runtime, ctx: Ctx): Promise<boolean> {
  const settings = await ctx.repo.settings.first()
  if (settings?.welcomeSeededAt || (await ctx.repo.pieces.count()) > 0) return false
  await seedWelcome(runtime, ctx)
  return true
}
