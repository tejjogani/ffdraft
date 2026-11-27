import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'

it('invalidates old Rhino casting totals without changing saved geometry or unrelated totals', async () => {
  const db = new PGlite()
  try {
    await db.exec('CREATE TABLE piece (id int, design jsonb, facts jsonb)')
    const source = (rhino: boolean) => ({
      kind: 'ring',
      nodes: {
        body: {
          kind: 'meshBody',
          source: { type: 'asset', assetId: 'original', ...(rhino && { rhinoLayer: 'parts' }) },
        },
      },
    })
    const stale = { metalMassG: 42 }
    for (const id of [1, 2])
      await db.query('INSERT INTO piece VALUES($1,$2,$3)', [id, source(id === 1), stale])
    await db.exec(
      await readFile(new URL('../drizzle/0020_rhino_role_facts.sql', import.meta.url), 'utf8'),
    )
    expect((await db.query('SELECT * FROM piece ORDER BY id')).rows).toEqual([
      { id: 1, design: source(true), facts: null },
      { id: 2, design: source(false), facts: stale },
    ])
  } finally {
    await db.close()
  }
})
