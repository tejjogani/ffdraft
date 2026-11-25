/**
 * Framing a shot: custom camera fields, every change undoable (the assistant's included),
 * the camera lock, house shots reused on other pieces, and takes that render exactly the scene
 * asked for and say which scene that was.
 */
import { customCameraPatch, poseOf, resolveScene, subjectOf } from '@pave/render'
import { RenderSceneSchema } from '@pave/schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { solitaireRing } from '../../../packages/render/fixtures'
import { putAsset } from './assets/assets'
import type { Ctx } from './context'
import { BOOT_TIMEOUT, type Client, client, type TestServer, testServer } from './test/harness'

let server: TestServer
let api: Client
let ctx: Ctx
let agent: Ctx
beforeAll(async () => {
  server = await testServer()
  api = client(server)
  ctx = await server.runtime.context(server.runtime.local!)
  agent = { ...ctx, actor: { type: 'agent', runId: 'run_t', toolCallId: 'toolu_cam' } }
}, BOOT_TIMEOUT)
afterAll(() => server.dispose())

const ring = solitaireRing()
const framed = () => {
  const r = resolveScene(RenderSceneSchema.parse({ camera: { preset: 'hero' } }), ring).camera
  const s = subjectOf(ring)
  const center = [0, 1, 2].map((i) => (s.bounds.min[i]! + s.bounds.max[i]!) / 2) as [
    number,
    number,
    number,
  ]
  return customCameraPatch({ ...poseOf(r, 12), roll: 8 }, { center, radius: 12 }, 'hero')
}

async function newShot() {
  const piece = await api.call('pieces.create', { templateId: 'solitaire' })
  const shot = await api.call('scenes.create', { pieceId: piece.id, title: 'Hero', scene: {} })
  return { piece, shot }
}

const refused = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (e) {
    // Over HTTP the error is in the body; in process it is the AppError itself.
    const err = e as { code?: string; message: string; error?: { code: string; message: string } }
    return { code: err.error?.code ?? err.code!, message: err.error?.message ?? err.message }
  }
  throw new Error('expected a refusal')
}

describe('custom camera fields', () => {
  it('stores position, target, lens, roll and where it was framed, and checks their ranges', async () => {
    const { shot } = await newShot()
    const patch = framed()
    const updated = await api.call('scenes.update', { id: shot.id, patch })
    expect(updated.scene.camera).toMatchObject({
      preset: 'custom',
      position: patch.camera.position,
      target: patch.camera.target,
      roll: 8,
      basePreset: 'hero',
      focalLength: 90,
    })
    expect(updated.scene.camera.framedOn?.radius).toBe(12)
    const bad = await refused(
      api.call('scenes.update', { id: shot.id, patch: { camera: { roll: 270 } } }),
    )
    expect(bad.code).toBe('bad_request')
  })
})

describe('undo', () => {
  it('undoes one change, keeps later changes to other settings, and redoes', async () => {
    const { shot } = await newShot()
    const moved = await api.call('scenes.update', { id: shot.id, patch: framed() })
    await api.call('scenes.update', { id: shot.id, patch: { environment: { intensity: 1.4 } } })
    const history = await api.call('scenes.history', { id: shot.id })
    expect(history.map((c) => c.seq)).toEqual([2, 1])
    const cameraChange = history[1]!
    expect(cameraChange.after.camera).toEqual(moved.scene.camera)

    // Undo the camera move only: the brighter light stays.
    const undone = await api.call('scenes.revert', { id: shot.id, changeId: cameraChange.id })
    expect(undone.scene.scene.camera.preset).toBe('hero')
    expect(undone.scene.scene.camera.position).toBeUndefined()
    expect(undone.scene.scene.environment.intensity).toBe(1.4)
    expect(undone.change.reverts).toBe(cameraChange.id)
    expect(
      await refused(api.call('scenes.revert', { id: shot.id, changeId: cameraChange.id })),
    ).toMatchObject({ code: 'conflict' })

    // Undo with no id takes the newest edit still in effect: the light.
    const light = await api.call('scenes.revert', { id: shot.id })
    expect(light.scene.scene.environment.intensity).toBe(1)
    // Undoing an undo is a redo.
    const redo = await api.call('scenes.revert', { id: shot.id, changeId: light.change.id })
    expect(redo.scene.scene.environment.intensity).toBe(1.4)
  })

  it('refuses to undo a change whose settings a later change moved again', async () => {
    const { shot } = await newShot()
    const first = await api.call('scenes.update', {
      id: shot.id,
      patch: { camera: { focalLength: 100 } },
    })
    await api.call('scenes.update', { id: shot.id, patch: { camera: { focalLength: 120 } } })
    const [, change] = await api.call('scenes.history', { id: shot.id })
    expect(change!.after.camera.focalLength).toBe(first.scene.camera.focalLength)
    const e = await refused(api.call('scenes.revert', { id: shot.id, changeId: change!.id }))
    expect(e.code).toBe('conflict')
    expect(e.message).toMatch(/later change/)
  })

  it('makes the assistant’s camera move one change a person can undo', async () => {
    const { shot } = await newShot()
    // "Move the camera a bit lower": one scenes.update with a new position, as a tool call.
    const lower = framed()
    await server.runtime.invoke('scenes.update', { id: shot.id, patch: lower }, agent)
    const [change] = await api.call('scenes.history', { id: shot.id })
    expect(change!.actor).toMatchObject({ type: 'agent', toolCallId: 'toolu_cam' })
    const back = await api.call('scenes.revert', { id: shot.id })
    expect(back.scene.scene.camera.preset).toBe('hero')
    expect(back.change.actor.type).toBe('user')
  })

  it('records nothing when only the title or order changes', async () => {
    const { shot } = await newShot()
    await api.call('scenes.update', { id: shot.id, title: 'Hero, left' })
    expect(await api.call('scenes.history', { id: shot.id })).toEqual([])
    expect(await refused(api.call('scenes.revert', { id: shot.id }))).toMatchObject({
      code: 'conflict',
    })
  })
})

describe('locking the camera', () => {
  it('keeps a locked camera still for people and the assistant until a person unlocks it', async () => {
    const { piece, shot } = await newShot()
    await api.call('scenes.update', { id: shot.id, patch: framed() })
    await api.call('scenes.update', { id: shot.id, patch: { camera: { locked: true } } })

    const person = await refused(
      api.call('scenes.update', { id: shot.id, patch: { camera: { focalLength: 120 } } }),
    )
    expect(person).toMatchObject({ code: 'conflict' })
    expect(person.message).toMatch(/locked/)

    const byAgent = await refused(
      server.runtime.invoke(
        'scenes.update',
        { id: shot.id, patch: { camera: { roll: 0 } } },
        agent,
      ),
    )
    expect(byAgent.code).toBe('conflict')
    const unlockByAgent = await refused(
      server.runtime.invoke(
        'scenes.update',
        { id: shot.id, patch: { camera: { locked: false } } },
        agent,
      ),
    )
    expect(unlockByAgent.code).toBe('forbidden')

    // The assistant may still change what is not framing.
    const lit = await server.runtime.invoke(
      'scenes.update',
      { id: shot.id, patch: { look: 'black-acrylic' } },
      agent,
    )
    expect(lit.scene.look).toBe('black-acrylic')

    // …and cannot re-frame it by rendering the shot with another camera.
    const render = await refused(
      server.runtime.invoke(
        'renders.create',
        {
          pieceId: piece.id,
          sceneId: shot.id,
          scene: { ...lit.scene, camera: { ...lit.scene.camera, focalLength: 50 } },
          engine: 'browser',
        },
        agent,
      ),
    )
    expect(render.code).toBe('conflict')

    // An undo that would move the locked camera is refused too.
    const history = await api.call('scenes.history', { id: shot.id })
    const move = history.find(
      (c) => c.after.camera.preset === 'custom' && !c.before.camera.position,
    )
    expect(
      await refused(api.call('scenes.revert', { id: shot.id, changeId: move!.id })),
    ).toMatchObject({ code: 'conflict' })

    // A person unlocks and moves it in one change.
    const free = await api.call('scenes.update', {
      id: shot.id,
      patch: { camera: { locked: false, focalLength: 120 } },
    })
    expect(free.scene.camera).toMatchObject({ locked: false, focalLength: 120 })
  })
})

describe('house shots', () => {
  it('saves a framed shot for the organisation and reuses it on another piece', async () => {
    const { shot } = await newShot()
    const mine = await api.call('scenes.update', { id: shot.id, patch: framed() })
    const house = await api.call('scenes.create', {
      pieceId: null,
      title: 'Low left hero',
      scene: mine.scene,
    })
    const houses = await api.call('scenes.list', { pieceId: null })
    expect(houses.map((h) => h.id)).toContain(house.id)

    const other = await api.call('pieces.create', { templateId: 'halo' })
    const reused = await api.call('scenes.create', {
      pieceId: other.id,
      title: house.title,
      scene: house.scene,
    })
    expect(reused.scene.camera).toEqual(mine.scene.camera)
    const take = await api.call('renders.create', {
      pieceId: other.id,
      sceneId: reused.id,
      engine: 'browser',
    })
    expect(take.sceneId).toBe(reused.id)
  })
})

describe('exact takes', () => {
  it('renders exactly the scene asked for unless told otherwise, and records its scene hash', async () => {
    const { piece, shot } = await newShot()
    const take = await api.call('renders.create', {
      pieceId: piece.id,
      sceneId: shot.id,
      engine: 'browser',
    })
    expect(take.autoTune).toBe(false)
    expect(take.sceneHash).toBeNull()
    const asset = await putAsset(ctx, {
      bytes: new TextEncoder().encode('x'),
      name: 'take.png',
      mime: 'image/png',
    })
    const done = await api.call('renders.complete', {
      id: take.id,
      assetIds: [asset.id],
      sceneHash: 'abc123',
    })
    expect(done.sceneHash).toBe('abc123')
  })
})
