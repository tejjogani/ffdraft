import { describe, expect, it } from 'vitest'
import { childEnv } from './index'

describe('the environment a Blender process gets', () => {
  it('keeps what Blender needs and never the server’s secrets', () => {
    const env = childEnv({
      PATH: '/usr/bin',
      Path: 'C:\\Windows',
      HOME: '/home/a',
      SystemRoot: 'C:\\Windows',
      LC_ALL: 'C.UTF-8',
      BLENDER_USER_SCRIPTS: '/x',
      CUDA_VISIBLE_DEVICES: '0',
      PAVE_RENDER_STDIN_WATCH: '1',
      ANTHROPIC_API_KEY: 'sk-ant-api03-FROM-DOTENV',
      OPENAI_API_KEY: 'sk-x',
      GEMINI_API_KEY: 'g',
      BETTER_AUTH_SECRET: 's',
      PAVE_DATA_DIR: '/data',
      DATABASE_URL: 'postgres://u:p@h/db',
    })
    expect(Object.keys(env).sort()).toEqual(
      [
        'BLENDER_USER_SCRIPTS',
        'CUDA_VISIBLE_DEVICES',
        'HOME',
        'LC_ALL',
        'PATH',
        'PAVE_RENDER_STDIN_WATCH',
        'Path',
        'SystemRoot',
      ].sort(),
    )
    expect(JSON.stringify(env)).not.toContain('sk-ant')
  })
})
