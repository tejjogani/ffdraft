/**
 * The reference engines a server always has: search over the keyless museum collections and the
 * safe capture of web pictures. `PAVE_SEARCH_FIXTURES=<recording.json>` swaps the network for a
 * recording (screenshots, offline demos), with a loud warning, and is refused in production.
 */
import { resolve } from 'node:path'
import type { Services } from '../services'
import { createCaptureService, recordedCaptureService } from './capture'
import { networkIO, readRecordings, recordedIO } from './io'
import { createSearchService } from './search'

export function referenceServicesFromEnv(
  env: NodeJS.ProcessEnv,
): Pick<Services, 'search' | 'capture'> {
  const fixtures = env.PAVE_SEARCH_FIXTURES?.trim()
  if (!fixtures)
    return { search: createSearchService({ io: networkIO() }), capture: createCaptureService() }
  if (env.NODE_ENV === 'production')
    throw new Error('PAVE_SEARCH_FIXTURES is for tests and demos; it is refused in production.')
  const file = resolve(fixtures)
  const recordings = readRecordings(file)
  console.warn(
    `\n  ⚠ Reference search is playing recorded answers from ${file} (PAVE_SEARCH_FIXTURES).\n    Museum results are canned; unset it to search the real collections.\n`,
  )
  return {
    search: createSearchService({ io: recordedIO(recordings) }),
    capture: recordedCaptureService(recordings),
  }
}
