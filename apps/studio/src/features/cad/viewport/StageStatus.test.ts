/**
 * The viewport's status overlay, read from the element tree it returns (it uses no hooks, and
 * the studio has no DOM test setup).
 */
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { StageStatus } from './StageStatus'

type Props = { children?: ReactNode; message?: string; onRetry?: () => void; src?: string }

function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<Props>(node)) return []
  return [node, ...elements(node.props.children)]
}
const text = (node: ReactNode): string =>
  Array.isArray(node)
    ? node.map(text).join('')
    : isValidElement<Props>(node)
      ? `${node.props.message ?? ''}${text(node.props.children)}`
      : typeof node === 'string'
        ? node
        : ''

const base = { coverAssetId: null, hasEvaluation: false, onRetry: () => {} }

describe('the viewport status', () => {
  it('shows the cover and a spinner while the first evaluation runs', () => {
    const el = StageStatus({ ...base, status: 'loading', coverAssetId: 'as_1' })
    expect(text(el)).toContain('Preparing the workbench')
    expect(elements(el).some((e) => e.props.src === '/api/assets/as_1?w=480')).toBe(true)
  })

  it('gets out of the way once there is a model to show', () => {
    expect(StageStatus({ ...base, status: 'ready', hasEvaluation: true })).toBeNull()
    expect(StageStatus({ ...base, status: 'evaluating', hasEvaluation: true })).toBeNull()
  })

  it('says the 3D view is unavailable, with the engine’s reason, and that editing still works', () => {
    const el = StageStatus({ ...base, status: 'unavailable', error: 'WebAssembly is disabled' })
    expect(text(el)).toContain('The 3D view isn’t available here')
    expect(text(el)).toContain('WebAssembly is disabled')
    expect(text(el)).toContain('keep editing by numbers')
  })

  it('says so, with the reason and a retry, when the first evaluation fails', () => {
    // It used to keep saying "Preparing the workbench…" for good.
    let retried = 0
    const el = StageStatus({
      ...base,
      status: 'error',
      failure: 'The geometry engine stopped responding',
      onRetry: () => retried++,
    })
    expect(text(el)).not.toContain('Preparing the workbench')
    expect(text(el)).toContain('The geometry engine stopped responding')
    const retry = elements(el).find((e) => typeof e.props.onRetry === 'function')
    retry?.props.onRetry?.()
    expect(retried).toBe(1)
  })
})
