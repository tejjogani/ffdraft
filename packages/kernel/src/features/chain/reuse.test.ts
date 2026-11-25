/**
 * A chain hung from a bail is rebuilt whenever the bail is, since it rests in the bail's hole.
 * What it is made of does not change with the bail: its links (planned by solving their
 * contacts) and its clasp (a union of swept wires). A bail slider drag on a pendant took
 * ~400 ms a step, most of it re-planning those links and re-meshing that clasp.
 */
import { applyOps, buildDesign, type Design, type Op, TEMPLATES } from '@pave/schema'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { QUALITY } from '../../core'
import { translation } from '../../geometry/vec'
import { createKernel, type LocalKernel } from '../../kernel'
import { loadRuntime } from '../../runtime/index'
import { meshArea, surfaceDefects } from '../../solid/meshing'
import { surfaceDefectsOf } from '../../solid/solid'
import { instancedSolid } from './instances'

const calls = vi.hoisted(() => ({ plans: 0, claspMeshes: 0 }))

vi.mock('./links', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./links')>()
  return {
    ...actual,
    wireChain: (...args: Parameters<typeof actual.wireChain>) => {
      calls.plans++
      return actual.wireChain(...args)
    },
  }
})
vi.mock('./clasp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./clasp')>()
  const counted =
    <A extends unknown[]>(make: (...args: A) => ReturnType<typeof actual.lobsterClasp>) =>
    (...args: A) => {
      const clasp = make(...args)
      return {
        ...clasp,
        parts: (...p: Parameters<typeof clasp.parts>) => {
          calls.claspMeshes++
          return clasp.parts(...p)
        },
      }
    }
  return {
    ...actual,
    lobsterClasp: counted(actual.lobsterClasp),
    boxClasp: counted(actual.boxClasp),
  }
})

let kernel: LocalKernel
beforeAll(() => {
  kernel = createKernel()
})
afterAll(() => kernel.dispose())

const withBail = (design: Design, width: number) =>
  applyOps(design, [{ t: 'update', id: 'bail', patch: { width } } as Op]).design

describe('a chain rebuilt because its bail changed', () => {
  it('reuses its planned links and its clasp mesh', async () => {
    const design = buildDesign(TEMPLATES.find((t) => t.id === 'pendant-solitaire')!.spec)
    await kernel.evaluate(withBail(design, 2.6))
    calls.plans = 0
    calls.claspMeshes = 0
    const step = await kernel.evaluate(withBail(design, 2.7))
    // The chain did rebuild (it rests in the bail), so the reuse is what is being tested.
    expect(step.timings.chain).toBeDefined()
    expect(calls.plans).toBe(0)
    expect(calls.claspMeshes).toBe(0)
  })

  it('weighs and meshes the chain as a fresh kernel does', async () => {
    const design = withBail(
      buildDesign(TEMPLATES.find((t) => t.id === 'pendant-solitaire')!.spec),
      2.8,
    )
    const warm = await kernel.evaluate(design)
    const fresh = createKernel()
    const cold = await fresh.evaluate(design)
    fresh.dispose()
    const chainOf = (e: typeof warm) => e.parts.find((p) => p.nodeId === 'chain')!
    expect(chainOf(warm).volumeMm3).toBe(chainOf(cold).volumeMm3)
    expect(chainOf(warm).mesh.positions).toEqual(chainOf(cold).mesh.positions)
    expect(warm.report.metalMassG).toBe(cold.report.metalMassG)
  })
})

describe('an instanced body measured from its templates', () => {
  // A cable chain's links: hundreds of rigid copies of two templates.
  const body = async () => {
    await loadRuntime()
    const { wireChain } = await vi.importActual<typeof import('./links')>('./links')
    const set = wireChain('cable', 1.2, 0.3)
    const instances = Array.from({ length: 600 }, (_, k) => ({
      template: k % set.templates.length,
      matrix: translation([k * 1.5, 0, 0]),
    }))
    return instancedSolid(set.templates, instances).solid
  }

  it('gives the area its merged mesh has, without merging the copies at full detail', async () => {
    const solid = await body()
    const merged = vi.spyOn(solid, 'triangles')
    const area = solid.area()
    expect(merged).not.toHaveBeenCalled()
    merged.mockRestore()
    expect(area / meshArea(solid.triangles(QUALITY.production)) - 1).toBeCloseTo(0, 6)
    solid.dispose()
  })

  it('finds the surface defects its merged mesh has', async () => {
    const solid = await body()
    for (const quality of [QUALITY.draft, QUALITY.production])
      expect(surfaceDefectsOf(solid, quality)).toEqual(surfaceDefects(solid.triangles(quality)))
    solid.dispose()
  })
})
