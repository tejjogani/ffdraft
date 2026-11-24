/** The bounded auto-tune: which draft is rendered and which measured fixes are applied. */
import type { RenderIssue } from '@pave/render'
import { RenderSceneSchema } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { autoFixes, draftOf } from './take'

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
