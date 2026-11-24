import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  BOOT_TIMEOUT,
  authPost,
  type Client,
  client,
  signUp,
  type TestServer,
  testServer,
} from './test/harness'

const PNG_1PX = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
)

async function upload(c: Client, bytes: Uint8Array, name: string) {
  const form = new FormData()
  form.set('file', new File([bytes], name))
  return c.request('/api/assets', { method: 'POST', body: form })
}

let server: TestServer
let ada: Client
let ben: Client

beforeAll(async () => {
  server = await testServer({ auth: 'accounts' })
  ada = await signUp(server, 'Ada Lovelace', 'ada@example.com')
  ben = await signUp(server, 'Ben Franklin', 'ben@example.com')
}, BOOT_TIMEOUT)
afterAll(() => server.dispose())

/** Invites `email` into Ada's org with `role`, accepts as `who`, and makes it their active org. */
async function join(who: Client, email: string, role: 'viewer' | 'designer' | 'admin') {
  const adaOrg = (await ada.call('session.get', {})).activeOrgId
  await ada.call('org.invite', { email, role })
  const owner = await ada.call('org.members', {})
  const ctx = await server.runtime.context({ userId: owner[0]!.user.id, orgId: adaOrg })
  const invitation = (await ctx.repo.invitations.many()).find(
    (i) => i.email === email && i.status === 'pending',
  )!
  await authPost(who, '/organization/accept-invitation', { invitationId: invitation.id })
  await authPost(who, '/organization/set-active', { organizationId: adaOrg })
  return adaOrg
}

describe('authentication', () => {
  it('rejects requests without a session', async () => {
    const anon = client(server)
    expect((await anon.fail('pieces.list', {})).status).toBe(401)
    expect((await anon.request('/api/assets/as_x')).status).toBe(401)
  })

  it('gives every new account its own organisation', async () => {
    const a = await ada.call('session.get', {})
    const b = await ben.call('session.get', {})
    expect(a.orgs).toHaveLength(1)
    expect(a.orgs[0]).toMatchObject({ name: 'Ada’s studio', role: 'owner' })
    expect(b.activeOrgId).not.toBe(a.activeOrgId)
  })
})

describe('tenancy isolation', () => {
  it('keeps one org’s pieces, boards and assets out of another’s reach', async () => {
    const collection = await ada.call('collections.create', { name: 'Private' })
    const piece = await ada.call('pieces.create', {
      templateId: 'solitaire',
      collectionId: collection.id,
    })
    const board = await ada.call('boards.create', { title: 'Secret board', pieceId: piece.id })
    const res = await upload(ada, PNG_1PX, 'secret.png')
    expect(res.status).toBe(201)
    const asset = (await res.json()) as { id: string }

    expect((await ben.call('pieces.list', {})).map((p) => p.id)).not.toContain(piece.id)
    expect(await ben.call('boards.list', {})).toEqual([])
    expect(await ben.call('collections.list', {})).toEqual([])

    const denied = [
      await ben.fail('pieces.get', { id: piece.id }),
      await ben.fail('pieces.update', { id: piece.id, title: 'mine now' }),
      await ben.fail('pieces.delete', { id: piece.id }),
      await ben.fail('pieces.duplicate', { id: piece.id }),
      await ben.fail('design.apply', {
        pieceId: piece.id,
        label: 'x',
        ops: [{ t: 'setKind', kind: 'pendant' }],
      }),
      await ben.fail('design.history', { pieceId: piece.id }),
      await ben.fail('renders.create', { pieceId: piece.id, scene: {} }),
      await ben.fail('boards.get', { id: board.id }),
      await ben.fail('boards.delete', { id: board.id }),
      await ben.fail('references.save', { boardId: board.id, items: [{ note: 'hi' }] }),
      await ben.fail('collections.update', { id: collection.id, name: 'x' }),
      await ben.fail('pieces.attest', { id: piece.id, rights: 'own' }),
      await ben.fail('design.revert', { pieceId: piece.id, runId: 'run_x' }),
      await ben.fail('scenes.create', { pieceId: piece.id, title: 'x', scene: {} }),
      await ben.fail('mesh3d.list', { pieceId: piece.id }),
      await ben.fail('freeform.analyze', { assetId: asset.id }),
      await ben.fail('threads.send', {
        text: 'x',
        clientId: 'w',
        clientMessageId: 'm',
        context: { pieceId: piece.id },
      }),
    ]
    expect(denied.map((d) => d.status)).toEqual(denied.map(() => 404))

    // Ids from another org cannot be smuggled into one's own rows either.
    const own = await ben.call('pieces.create', {})
    const ownBoard = await ben.call('boards.create', { title: 'Mine' })
    expect((await ben.fail('pieces.create', { collectionId: collection.id })).status).toBe(404)
    expect((await ben.fail('pieces.update', { id: own.id, coverAssetId: asset.id })).status).toBe(
      404,
    )
    expect((await ben.fail('boards.create', { title: 'x', pieceId: piece.id })).status).toBe(404)
    expect(
      (await ben.fail('pieces.create', { origin: { kind: 'image', sourceAssetIds: [asset.id] } }))
        .status,
    ).toBe(404)
    expect(
      (await ben.fail('references.save', { boardId: ownBoard.id, items: [{ assetId: asset.id }] }))
        .status,
    ).toBe(404)

    expect((await ben.request(`/api/assets/${asset.id}`)).status).toBe(404)
    expect((await ben.request(`/api/assets/${asset.id}?w=64`)).status).toBe(404)
    expect((await ada.request(`/api/assets/${asset.id}`)).status).toBe(200)

    // Removing someone else's references is a silent no-op, not a cross-org delete.
    const [ref] = await ada.call('references.save', {
      boardId: board.id,
      items: [{ note: 'keep me' }],
    })
    await ben.call('references.remove', { ids: [ref!.id] })
    expect((await ada.call('boards.get', { id: board.id })).references.map((r) => r.id)).toContain(
      ref!.id,
    )

    expect((await ada.call('pieces.get', { id: piece.id })).title).toBe('Classic solitaire')
  })

  it('scopes live events to the org', async () => {
    const adaOrg = (await ada.call('session.get', {})).activeOrgId
    const benOrg = (await ben.call('session.get', {})).activeOrgId
    const seen: string[] = []
    const off = server.runtime.events.subscribe(benOrg, (e) => seen.push(e.type))
    const piece = await ada.call('pieces.create', {})
    await ada.call('pieces.update', { id: piece.id, title: 'Quiet' })
    off()
    expect(adaOrg).not.toBe(benOrg)
    expect(seen).toEqual([])
  })
})

describe('roles', () => {
  it('lets a viewer read but not change anything', async () => {
    const viewer = await signUp(server, 'Vera Viewer', 'vera@example.com')
    const orgId = await join(viewer, 'vera@example.com', 'viewer')
    const session = await viewer.call('session.get', {})
    expect(session.activeOrgId).toBe(orgId)
    expect(session.orgs.find((o) => o.id === orgId)?.role).toBe('viewer')

    const [piece] = await viewer.call('pieces.list', {})
    expect(piece).toBeDefined()
    expect((await viewer.call('pieces.get', { id: piece!.id })).id).toBe(piece!.id)

    const refused = [
      await viewer.fail('pieces.create', {}),
      await viewer.fail('pieces.update', { id: piece!.id, title: 'nope' }),
      await viewer.fail('design.apply', {
        pieceId: piece!.id,
        label: 'x',
        ops: [{ t: 'setKind', kind: 'ring' }],
      }),
      await viewer.fail('collections.create', { name: 'nope' }),
      await viewer.fail('usage.summary', {}),
    ]
    expect(refused.map((r) => [r.status, r.error.code])).toEqual(
      refused.map(() => [403, 'forbidden']),
    )
    expect((await upload(viewer, PNG_1PX, 'x.png')).status).toBe(403)
  })

  it('lets a designer edit but not administer', async () => {
    const designer = await signUp(server, 'Dee Signer', 'dee@example.com')
    await join(designer, 'dee@example.com', 'designer')
    const piece = await designer.call('pieces.create', { templateId: 'eternity' })
    await designer.call('design.apply', {
      pieceId: piece.id,
      label: 'Kind',
      ops: [{ t: 'setKind', kind: 'ring' }],
    })
    expect((await upload(designer, PNG_1PX, 'ok.png')).status).toBe(201)

    expect((await designer.fail('org.settings.update', { allowEvalUse: true })).status).toBe(403)
    expect((await designer.fail('org.invite', { email: 'x@example.com' })).status).toBe(403)
    expect(
      (await designer.fail('org.setRole', { userId: piece.createdBy, role: 'viewer' })).status,
    ).toBe(403)
    expect((await designer.fail('usage.summary', {})).status).toBe(403)
    expect(await designer.call('org.settings.get', {})).toHaveProperty('traceRetentionDays')
  })

  it('lets an admin manage roles but not ownership', async () => {
    const admin = await signUp(server, 'Al Admin', 'al@example.com')
    await join(admin, 'al@example.com', 'admin')
    const members = await admin.call('org.members', {})
    const dee = members.find((m) => m.user.email === 'dee@example.com')!
    const owner = members.find((m) => m.role === 'owner')!
    await admin.call('org.setRole', { userId: dee.user.id, role: 'viewer' })
    expect((await admin.call('org.members', {})).find((m) => m.user.id === dee.user.id)?.role).toBe(
      'viewer',
    )
    expect((await admin.fail('org.setRole', { userId: dee.user.id, role: 'owner' })).status).toBe(
      403,
    )
    expect(
      (await admin.fail('org.setRole', { userId: owner.user.id, role: 'viewer' })).status,
    ).toBe(403)
    expect(
      (await admin.fail('org.invite', { email: 'boss@example.com', role: 'owner' })).status,
    ).toBe(403)
    await admin.call('usage.summary', {})
  })
})
