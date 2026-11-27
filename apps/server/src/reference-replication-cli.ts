/** Opt-in reference replication benchmark. Live requests require --live and an explicit API key. */
import { resolve } from 'node:path'
import { resolveTiers } from '@pave/agent'
import { runReferenceReplication } from './assistant/reference-replication'

const args = process.argv.slice(2)
const usage = 'Usage: pnpm agent:reference-replication --out=<directory> [--blender] [--live]'
const out = args.find((arg) => arg.startsWith('--out='))?.slice('--out='.length)
if (args.includes('--help')) {
  console.log(usage)
  process.exit(0)
}
if (
  !out ||
  args.some((arg) => !['--live', '--blender'].includes(arg) && !arg.startsWith('--out='))
) {
  console.error(usage)
  process.exit(2)
}
const mode = args.includes('--live') ? 'live' : 'scripted'
const report = await runReferenceReplication({
  mode,
  blender: args.includes('--blender'),
  tier: resolveTiers(null, process.env).defaultTier.tier,
  out: resolve(out),
  env: process.env,
  log: console.log,
})
const reason = report.vision.reason ?? report.cad.reason ?? report.blender.reason
const result = `${mode} reference replication: ${report.status}${reason ? ` (${reason})` : ''}`
// The server and fake transport are closed and the report is saved before exiting the CLI.
process.stdout.write(`${result}\nReport: ${resolve(out, 'report.json')}\n`, () => {
  process.exit(report.status === 'failed' ? 1 : 0)
})
