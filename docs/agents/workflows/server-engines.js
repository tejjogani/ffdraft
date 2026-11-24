export const meta = {
  name: 'server-engines',
  description: 'Wire the core engine into the server: geometry (kernel), production packages and the render queue as services, then review and fix',
  phases: [
    { title: 'Implement', detail: 'geometry, production and render services registered in compose.ts', model: 'opus' },
    { title: 'Review', detail: 'adversarial: run the real pipeline end to end and try to break it' },
    { title: 'Fix', detail: 'resolve confirmed findings', model: 'opus' },
  ],
}

const SCRATCH = '/tmp/claude-0/-home-user-ffdraft/24192795-28e0-5484-b947-9462017ba677/scratchpad'

const BASE = `
You are working on "Pavé", an open-source, AI-native jewelry design suite. Monorepo: /home/user/ffdraft (pnpm 10 workspaces, Node 22, TypeScript 7, zod 4, vitest 5, biome 2); internal packages export TS source directly and run through \`tsx\`. Must be cross-platform (macOS, Windows, Linux): node:path / import.meta.url for paths, no shell, no bash-isms in npm scripts.

Architecture in one line (docs/ARCHITECTURE.md): a design is a document; geometry is a pure function of it (\`@pave/kernel\`); one command registry (\`packages/schema/src/api/commands.ts\`) is the API for the UI, the assistant and MCP; the server (\`apps/server\`) implements a handler per command and delegates anything that needs an engine to a typed **service** resolved from a registry (\`apps/server/src/services.ts\` — read its header comment and every interface; \`apps/server/src/compose.ts\` is where a deployment's services are assembled; \`service-context.ts\`, \`runtime.ts\`, \`jobs\` helpers such as \`submitJob\`/\`stopJob\`, job recovery via \`resume\`, \`assets\`, \`usage.ts\`, \`events.ts\`). Until a service is registered its commands answer 501.

## The task: make the core engine available through the server
Implement and register, in \`apps/server/src/engines/**\` (new) wired from \`compose.ts\`:
1. **\`geometry\`** — the kernel in Node (\`createKernel()\` from \`@pave/kernel\`; read \`packages/kernel/src/types.ts\`, \`kernel.ts\`, \`client.ts\`): \`evaluate\` (→ the \`EvaluationSummary\` shape used by \`design.evaluate\`, at draft or production detail, with diagnostics), \`export\` (\`design.export\` → an asset, honouring the attestation gate the handler already applies), and \`renderInput\` (GLB via \`writeGlb\` + the render subject). Requirements: evaluations must not block the event loop for other requests — run the kernel in \`worker_threads\` (a small pool sized from CPU count; one design evaluated at a time per worker; the kernel's per-node cache makes repeat evaluations of the same piece cheap, so route a piece to the same worker when possible) with timeouts and cancellation, and recover if a worker dies; asset resolution for mesh/height-map assets goes through the org-scoped asset store; the piece's cached **facts** (metal mass, carats, stone count, metal) are refreshed after a design change in the background (debounced per piece, never blocking \`design.apply\`) and \`piece.updated\` is published; cap concurrent heavy work; record nothing in the usage ledger for local compute.
2. **\`production\`** — \`production.create\` builds a real package with \`@pave/production/node\` (read \`packages/production/src/index.ts\` and its node entry: inputs, fonts, options, the returned zip + manifest), from a production-detail evaluation and the kernel's exports, as a background job with progress (\`job.updated\`), stores the zip as an asset and the manifest on the package row, increments the revision, and survives a server restart per the job-recovery contract. Include renders of the piece in the package when finished renders exist.
3. **\`renderQueue\`** and **\`renderEngine\`** — \`renders.create\` with the Blender engine: resolve the scene with \`@pave/render\` (\`resolveScene\`), get geometry from \`geometry.renderInput\`, run \`renderWithBlender\` from \`@pave/render/node\` (read \`packages/render/src/node/index.ts\`: \`detectBlender\`, \`resolveRuntime\`, progress, cancellation; the bpy venv lives in \`workers/render/.venv\` and is present in this container), one render at a time by default (configurable), progress and cancellation, timeouts, outputs stored as assets, numeric assessment (\`assessRender\`) stored on the job in the \`critique\` shape the contract defines (one automatic adjust-and-retry pass at preview quality when \`autoTune\` is on and the assessment finds a fixable issue — keep it simple and bounded), usage metered as render seconds, restart recovery; \`renderEngine.status\` / \`configure\` report and set the Blender runtime (see the contract: owner-only, local mode, probed before saving). When Blender is unavailable the capability is false and \`engine: 'auto'\` jobs are left for the browser (the handler already does this).
\`session.get\` capabilities must reflect what is actually available.

## Ground rules
- You own \`apps/server/src/engines/**\`, the engines section of \`apps/server/src/compose.ts\`, and tests under \`apps/server/src\`. You may make small additive fixes elsewhere in \`apps/server\` when a seam is missing (say so). Do NOT modify \`packages/kernel\`, \`packages/render\`, \`packages/production\`, \`packages/schema\` or \`apps/studio\` — other agents are working in the kernel (freeform features, review fixes) and the studio right now; if an engine bug blocks you, write a minimal failing repro under ${SCRATCH}/engines/ and report it precisely instead of patching around it silently.
- Do not run state-changing git commands. Never delete node_modules or pnpm-lock.yaml. \`pnpm add --filter @pave/server <dep>\` if needed (retry after ~15 s if another install is running).
- Quality: production code, small modules, no duplication with the packages (the server orchestrates; it does not re-implement geometry, rendering or packaging), strict TS, comments only for *why*. Every external process is spawned without a shell, with timeouts, and cleaned up on cancel/shutdown.
`

const VERIFY = `
## Verify — end to end, for real
Tests (\`apps/server/src/**/*.test.ts\`, in-memory database; hooks that boot a server use the existing \`BOOT_TIMEOUT\`): \`design.evaluate\` on several template pieces returns plausible numbers (e.g. a US 6 solitaire with a 1 ct round); facts appear on the piece after \`design.apply\` and change when the band is widened; \`design.export\` returns real STL/STEP/3DM/GLB assets that parse; \`production.create\` yields a zip whose manifest hashes match and whose PDF opens (page count > 0); the worker pool recovers from a killed worker and from a timeout; tenancy (org B cannot evaluate/export org A's piece); a Blender render at preview quality, small resolution, of the solitaire actually produces a PNG asset (skip the test automatically when bpy is not installed — it IS installed here, so run it and look at the image yourself: is it a ring on a studio background?), cancellation mid-render kills the process, and restart recovery resumes or fails the job cleanly. Then boot the real server on a fresh \`PAVE_DATA_DIR\` under ${SCRATCH}/engines/, and drive the RPC with curl/a script through the full chain for the seeded halo piece: evaluate → export STL → create production package → render → fetch the assets; save the outputs under ${SCRATCH}/shots/engines/. \`pnpm --filter @pave/server typecheck\`, \`pnpm exec vitest run apps/server --hookTimeout=120000\`. Stop every server and process you started.
`

const FINDINGS = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          area: { type: 'string' },
          file: { type: 'string' },
          problem: { type: 'string' },
          evidence: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['severity', 'area', 'problem', 'evidence', 'fix'],
      },
    },
  },
  required: ['summary', 'findings'],
}

phase('Implement')
const report = await agent(
  `${BASE}\n${VERIFY}\n## Final report (≤300 words)\nWhat exists and how it is wired; measured timings (evaluate cold/warm through the RPC, export per format, package build, a preview render); concurrency and failure behaviour; engine bugs found in the packages (with repro paths); gaps.`,
  { label: 'implement:engines', phase: 'Implement', model: 'opus', effort: 'high' },
)

phase('Review')
const review = await agent(
  `${BASE}\n## Your job: adversarial review of the server engine integration\nAn agent has just implemented the three engine services described above. Its report:\n\n${report || '(no report returned)'}\n\nDo not trust the report. You are READ-ONLY on the repository (scratch only under ${SCRATCH}/review-engines/). Run the tests and typecheck, then boot the real server on a fresh data dir and attack the pipeline: every seeded template through evaluate / export (all six formats) / production.create / renders.create; concurrent requests (20 evaluations of different pieces at once while a render and a package build run — does the server stay responsive, do results belong to the right piece?); rapid \`design.apply\` bursts (are facts eventually consistent, never stale-overwriting newer ones?); cancellation and timeouts; killing a worker thread and the Blender process mid-job; restarting the server mid-job (recovery); a design that fails to evaluate (bad reference, feature.failed) — is the error surfaced cleanly, never a hung request or a crashed pool; huge designs (iced trophy with chain) — memory and time; tenancy and role checks on every new path; asset leaks (temp dirs, orphan blobs) and zombie processes after shutdown; Windows-hostile code (paths, signals such as SIGTERM-only kills, shell usage). Open the produced STL/STEP/PDF/PNG and confirm they are what they claim. Report only real, evidenced problems with a concrete fix each (blocker = wrong results / crash / hang / data leak; major = clearly wrong behaviour; minor = worth fixing). If it is genuinely good, return few findings.`,
  { label: 'review:engines', phase: 'Review', schema: FINDINGS },
)

const findings = (review && review.findings) || []
log(`${findings.length} findings`)

let fix = 'No findings.'
if (findings.length) {
  phase('Fix')
  fix = await agent(
    `${BASE}\n## Your job: fix review findings in the server engine integration\nFor each finding below: reproduce it first (if you cannot, say so and explain); fix the root cause cleanly; add or extend a test. Blockers and majors must be resolved; fix minors unless disproportionate. If a finding is really a bug in \`packages/kernel\`, \`packages/render\` or \`packages/production\`, do not patch those packages: make the server robust to it, and report the package bug with a minimal repro path.\n${VERIFY}\n## Findings\n${findings
      .map((f, i) => `${i + 1}. [${f.severity}] ${f.area}${f.file ? ` (${f.file})` : ''}: ${f.problem}\n   Evidence: ${f.evidence}\n   Suggested fix: ${f.fix}`)
      .join('\n')}\n\n## Final report (≤250 words)\nPer finding: fixed / not reproduced / deferred (why); package bugs to hand to their owners (with repro paths); final timings.`,
    { label: 'fix:engines', phase: 'Fix', model: 'opus', effort: 'high' },
  )
}

return { report, reviewSummary: review && review.summary, findings, fix }
