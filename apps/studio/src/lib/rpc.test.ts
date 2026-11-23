import { COMMAND_NAMES, commands } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { QUERY_NAMES } from './rpc'

describe('rpc client', () => {
  it('lists exactly the registry’s query commands', () => {
    const queries = COMMAND_NAMES.filter((n) => commands[n].kind === 'query')
    expect([...QUERY_NAMES].sort()).toEqual(queries.sort())
  })
})
