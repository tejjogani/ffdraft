/** The bounded auto-tune: which draft is rendered and which measured fixes are applied. */
import type { RenderIssue } from '@pave/render'
import { draftOf } from '@pave/render'
import type { BlenderRenderResult } from '@pave/render/node'
import { RenderSceneSchema } from '@pave/schema'
import { describe, expect, it, vi } from 'vitest'
import { autoFixes, renderTake } from './take'

const blender = vi.hoisted(() => ({ calls: 0 }))
vi.mock('@pave/render/node', () => ({
  renderWithBlender: async (): Promise<BlenderRenderResult> => {
    blender.calls++
    return {
      files: { image: 'pass.png', mask: 'mask.png' },
      metrics: {} as BlenderRenderResult['metrics'],
      device: 'CPU',
      seconds: 1,
    }
  },
}))

const scene = (output: object, extra: object = {}) => RenderSceneSchema.parse({ output, ...extra })

const issue = (
  code: RenderIssue['code'],
  severity: RenderIssue['severity'],
  adjust: RenderIssue['adjust'],
): RenderIssue => ({ code, severity, message: code, value: 0, limit: 0, adjust })

describe('draftOf', () => {
  it('is a small preview still of the same aspect ratio', () => {
    const draft = draftOf(
      scene({ quality: 'final', width: 4000, height: 2000 }, { animation: { type: 'turntable' } }),
    )
    expect(draft.output).toEqual({ quality: 'preview', width: 512, height: 256 })
    expect(draft.animation).toBeUndefined()
    // Never below the schema's 256 px, even for a long panorama.
    expect(draftOf(scene({ width: 4000, height: 1000 })).output).toMatchObject({
      width: 1024,
      height: 256,
    })
  })

  it('equals the request when that already is a small preview still', () => {
    const small = scene({ quality: 'preview', width: 384, height: 256 })
    expect(JSON.stringify(draftOf(small))).toBe(JSON.stringify(small))
  })
})

describe('autoFixes', () => {
  it('takes one framing or exposure fix per path, the most severe issue first', () => {
    const fixes = autoFixes([
      issue('framing.small', 'warning', [{ path: 'camera.focalLength', value: 120 }]),
      issue('framing.cropped', 'error', [{ path: 'camera.focalLength', value: 70 }]),
      issue('exposure.dark', 'warning', [{ path: 'environment.intensity', value: 1.4 }]),
      issue('noise.high', 'warning', [{ path: 'output.quality', value: 'standard' }]),
      issue('noise.fireflies', 'warning', [{ path: 'sparkle', value: 0.2 }]),
    ])
    expect(fixes).toEqual([
      { path: 'camera.focalLength', value: 70 },
      { path: 'environment.intensity', value: 1.4 },
    ])
    expect(autoFixes([])).toEqual([])
  })
})

describe('renderTake', () => {
  const subject = {
    bounds: { min: [-10, -10, 0], max: [10, 10, 20] },
    parts: [],
    stones: [],
  } as Parameters<typeof renderTake>[0]['subject']

  it('starts no further pass, and stores nothing more, once canceled between passes', async () => {
    blender.calls = 0
    const controller = new AbortController()
    const stored: string[] = []
    const take = renderTake({
      scene: scene({ quality: 'standard', width: 1024, height: 1024 }),
      autoTune: true,
      glb: new Uint8Array(),
      subject,
      design: { pieceId: 'pc_1', version: 1 },
      workDir: 'unused',
      runtime: {},
      signal: controller.signal,
      timeoutMs: () => 60_000,
      onProgress: () => {},
      // The cancel lands just as the draft's process exits.
      onPass: async () => controller.abort(new DOMException('canceled', 'AbortError')),
      store: async (path, role) => {
        stored.push(`${role}:${path}`)
        return 'asset'
      },
    })
    await expect(take).rejects.toThrow(/canceled/)
    expect(blender.calls).toBe(1)
    expect(stored).toEqual([])
  })
})
