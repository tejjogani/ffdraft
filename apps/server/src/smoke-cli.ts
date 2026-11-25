/**
 * `pnpm agent:smoke`: the assistant's live smoke test, for a person with a Claude API key.
 *
 *   pnpm agent:smoke                       the four journeys on the default tier (Standard)
 *   pnpm agent:smoke --tier=light          …on another tier
 *   pnpm agent:smoke --only=design,edit    …only some journeys (design, photo, edit, render)
 *   pnpm agent:smoke --tiers               also a quick request check on each tier's model
 *
 * Reads ANTHROPIC_API_KEY from the environment or apps/server/.env (a key saved in Settings, AI
 * lives sealed in Pavé's database and is not read here). Refuses to run without one, and exits
 * non-zero when anything fails. It spends real money and prints what it spent; it never prints
 * the key. The journeys and their checks are in ./assistant/smoke.ts.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { MODELS, resolveTiers } from '@pave/agent'
import { checkKey } from '@pave/agent/anthropic'
import { checkTier } from '@pave/agent/tier-check'
import { ASSISTANT_TIERS, type AssistantTier } from '@pave/schema'
import { JOURNEYS, type JourneyName, type RunReport, runSmoke } from './assistant/smoke'

const USAGE = `Usage: pnpm agent:smoke [--tier=power|standard|light] [--only=design,photo,edit,render] [--tiers]`

const envFile = join(import.meta.dirname, '..', '.env')
// Values already set in the terminal win over the file, as when the server starts.
if (existsSync(envFile)) process.loadEnvFile(envFile)

const args = process.argv.slice(2)
const option = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
const unknown = args.filter((a) => !/^--(tier|only)=/.test(a) && a !== '--tiers')
if (unknown.length || args.includes('--help')) {
  console.log(USAGE)
  process.exit(unknown.length ? 2 : 0)
}

const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
if (!apiKey) {
  console.log(
    [
      'No Claude API key: the smoke test needs one, and spends a few dollars of it.',
      '',
      'Create a key on the API keys page of the Claude Console (https://platform.claude.com/settings/keys),',
      'then either put it in apps/server/.env:',
      '',
      '  ANTHROPIC_API_KEY=sk-ant-…',
      '',
      'or set it for one run in the terminal. A key saved in Settings, AI stays sealed in Pavé’s',
      'database and is not read by this test.',
    ].join('\n'),
  )
  process.exit(1)
}

const resolved = resolveTiers(null, process.env)
for (const w of resolved.warnings) console.log(`warning: ${w}`)
const tierArg = option('tier')
if (tierArg && !(ASSISTANT_TIERS as readonly string[]).includes(tierArg)) {
  console.log(`--tier must be power, standard or light.\n${USAGE}`)
  process.exit(2)
}
const tier = (tierArg as AssistantTier | undefined) ?? resolved.defaultTier.tier
const model = resolved.tiers[tier].model
const onlyArg = option('only')
const only = onlyArg
  ? new Set(onlyArg.split(',').map((x) => x.trim()) as JourneyName[])
  : new Set(JOURNEYS)
const bad = [...only].filter((x) => !(JOURNEYS as readonly string[]).includes(x))
if (bad.length) {
  console.log(`Unknown journey: ${bad.join(', ')}.\n${USAGE}`)
  process.exit(2)
}
if (process.env.PAVE_ASSISTANT)
  console.log(
    'Note: PAVE_ASSISTANT is set (test script mode); the smoke test ignores it and uses Claude.',
  )

console.log('Checking the key with the Models API (free)…')
const check = await checkKey({ apiKey })
if (!check.ok) {
  console.log(`FAIL ${check.message}`)
  process.exit(1)
}
console.log(
  `The key works. It can use: ${check.models.map((m) => MODELS[m].label).join(', ') || 'none of the tier models'}.`,
)
if (!check.models.includes(model)) {
  console.log(
    `FAIL this key cannot use ${MODELS[model].label}, the ${tier} tier's model. Try another --tier, or point the tier at another model (PAVE_ASSISTANT_MODEL_${tier.toUpperCase()}).`,
  )
  process.exit(1)
}

const usd = (x: number) => `$${x.toFixed(x < 1 ? 3 : 2)}`
const thousands = (x: number) => x.toLocaleString('en-US')
let failed = false

if (args.includes('--tiers')) {
  console.log('\nQuick request check on each tier’s model:')
  for (const t of ASSISTANT_TIERS) {
    const m = resolved.tiers[t].model
    if (!check.models.includes(m)) {
      console.log(`FAIL ${t.padEnd(8)} ${MODELS[m].label}: this key cannot use it`)
      failed = true
      continue
    }
    const r = await checkTier(apiKey, m)
    failed ||= !r.ok
    console.log(
      `${r.ok ? 'ok  ' : 'FAIL'} ${t.padEnd(8)} ${MODELS[m].label.padEnd(18)} ${usd(r.costUsd)}  ${r.notes.join('; ')}`,
    )
  }
}

console.log(
  `\nThe journeys, on the ${tier} tier (${MODELS[model].label}). Each run can take several minutes.`,
)
const report = await runSmoke({
  env: process.env,
  tier,
  only,
  log: (line) => console.log(line),
})

const line = (r: RunReport) => {
  const t = r.tokens
  return [
    `${r.failures.length ? 'FAIL' : 'ok  '} ${r.title}`,
    `     ${r.status}, ${r.modelCalls} model call${r.modelCalls === 1 ? '' : 's'}, ${usd(r.costUsd)}; tokens: ${thousands(t.input)} in, ${thousands(t.output)} out, ${thousands(t.cacheRead)} read from the cache, ${thousands(t.cacheWrite)} written to it`,
    ...r.failures.map((f) => `     FAIL ${f}`),
    ...r.notes.map((n) => `     ${n}`),
  ].join('\n')
}
console.log('\nResults')
for (const r of report.runs) console.log(line(r))
for (const s of report.skipped) console.log(`skip ${s}`)
console.log(`\nSpent about ${usd(report.costUsd)} on the journeys.`)
failed ||= !report.ok
console.log(failed ? 'Something failed: see the FAIL lines above.' : 'Everything passed.')
process.exit(failed ? 1 : 0)
