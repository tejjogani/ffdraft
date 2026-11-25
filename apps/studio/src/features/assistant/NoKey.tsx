/**
 * The dock without a key: one calm panel with the short key form (owners and admins) and where
 * to get a key. Connecting Claude Code over MCP is planned, not built, so the panel says so
 * rather than offering it.
 */
import { AiMark } from '@pave/ui'
import { Link } from '@tanstack/react-router'
import { KeyForm, useIsAdmin } from './KeyForm'

const CONSOLE_KEYS_URL = 'https://platform.claude.com/settings/keys'

export function NoKey() {
  const admin = useIsAdmin()
  return (
    <div className="flex h-full flex-col justify-center gap-5 overflow-y-auto px-6 py-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <AiMark className="size-5" />
        <p className="font-serif text-[22px] leading-7">Connect Claude</p>
        <p className="text-sm text-fg-muted">
          The assistant runs on Claude with your organisation’s API key. It is kept on this server,
          never shown again, and never sent to the browser.
        </p>
      </div>
      <KeyForm compact />
      {admin && (
        <p className="text-xs leading-5 text-fg-subtle">
          Create a key on the{' '}
          <a href={CONSOLE_KEYS_URL} target="_blank" rel="noreferrer" className="underline">
            API keys page of the Claude Console
          </a>
          , then paste it here. Tiers, prices and this month’s spend are in{' '}
          <Link to="/settings/ai" className="underline">
            Settings, AI
          </Link>
          .
        </p>
      )}
      <p className="border-t border-line pt-4 text-xs leading-5 text-fg-subtle">
        Connecting Claude Code to Pavé (over MCP, with no key here) is planned. For now the
        assistant needs an API key.
      </p>
    </div>
  )
}
