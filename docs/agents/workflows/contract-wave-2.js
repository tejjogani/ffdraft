export const meta = {
  name: 'contract-wave-2',
  description: 'Apply the planned contract additions (schema + server) for the assistant, CAD workspace, ideate/freeform and render/models features, then review and fix',
  phases: [
    { title: 'Implement', detail: 'schema, events, client tools, server handlers and migrations', model: 'opus' },
    { title: 'Review', detail: 'three lenses: coherence with the plans, server correctness and tenancy, API design' },
    { title: 'Fix', detail: 'resolve confirmed findings', model: 'opus' },
  ],
}

const BASE = `
You are working on "Pavé", an open-source, AI-native jewelry design suite. Monorepo: /home/user/ffdraft (pnpm 10 workspaces, Node 22, TypeScript 7, zod 4, vitest 5, biome 2); internal packages export TS source directly, no build step. Must be cross-platform (macOS, Windows, Linux, web).

Three ideas hold the product together (docs/ARCHITECTURE.md): a design is a document and geometry is a pure function of it; ops are the only way a design changes (attributed, invertible — the trace); and ONE command registry (\`packages/schema/src/api/commands.ts\`) is the API for the UI, the assistant's tools and the MCP server. The server (\`apps/server\`, complete and tested: Hono, Better Auth organisations, Drizzle on Postgres/PGlite with SQL migrations in \`apps/server/drizzle\`, org-scoped repositories, a typed handler per command, engine **services** resolved from a registry in \`src/services.ts\`, \`runtime.invoke\` for in-process agent calls, assets, usage ledger, traces, SSE events) implements that registry.

Four judged build briefs in \`docs/plans/\` — \`assistant.md\`, \`cad-workspace.md\`, \`ideate-and-freeform.md\`, \`render-and-models.md\` — each have a section **"3. Contract changes"** (and reasoning in their other sections). Feature teams will build those four areas IN PARALLEL next; before they start, the shared contract must be extended ONCE, coherently, so nobody edits the registry concurrently.
`

const TASK = `
## Your job: extend the contract for all four briefs — schema + server — and nothing else
Read all four briefs fully first, then \`packages/schema/src/**\` and \`apps/server/src/**\` (incl. tests and \`drizzle/\`).

### Decisions already made by the lead (they override the briefs where they differ)
1. **Client-executed tools** live in a second registry \`packages/schema/src/api/client-tools.ts\` (same \`def\` shape as commands; exported \`clientTools\`, name/input/output type helpers): \`viewport.capture\`, \`viewport.select\`, \`ui.context\`, \`ui.navigate\`. The assistant brief's \`view.capture\` IS \`viewport.capture\` (use the CAD brief's richer input/output; add \`source: 'studio' | 'server'\` to the output). \`client.respond\` (the relay by which the studio answers a client-tool request) is an ordinary command in the main registry.
2. **Events** move to the schema: \`packages/schema/src/api/events.ts\` with \`ServerEventSchema\` (moved from \`apps/server/src/events.ts\`, extended per the briefs: \`run.updated\`, targeted \`client.request\`, \`board.updated\`, \`job.updated\` with kind/status/progress incl. kind \`mesh3d\`) and \`RunEventSchema\` (the assistant stream protocol with per-run \`seq\`).
3. \`design.revert\` takes \`{ pieceId, seq?, runId? }\` (exactly one of seq/runId; reverting a run is ONE change); \`StoredChange.reverts\`; \`design.apply\` accepts \`reverts?\`.
4. **Deferred — do NOT add now** (they need geometry-kernel work that is scheduled separately): \`Pave.region\` type \`mask\`, \`Relief.outline: 'custom'\` + \`outlinePath\`, and the \`PieceSpec.body\` additions \`outlinePath\` / \`heightMapAssetId\` / \`paveMaskAssetId\`. Also do not touch \`packages/kernel\` (its type additions are being made by the kernel author).
5. \`RenderSceneSchema\` was refined very recently by the render-engine agent, who may still be finishing: treat its current shape as authoritative, re-read \`entities.ts\` immediately before editing it, and make only the additive changes the render brief asks for (field meta, the \`'*'\` override key documented, new sibling schemas). \`SceneAdjustment\`/\`RenderIssue\` types currently live in \`packages/render/src/assess.ts\` (owned by that agent): define the zod schemas in the schema package to match them exactly, but leave \`packages/render\` untouched — report that it should import them later.
6. Field metadata additions (CAD brief): extend \`FieldMeta\` in \`design/fields.ts\` and tag \`nodes.ts\` as specified; add \`design/describe.ts\` with the pure helpers the brief lists (\`describeNode\`, \`visibleFields\`, \`variantPatch\`, \`defaultNode\`, \`squashOps\`, \`labelForOps\`, \`describeOps\`) with thorough unit tests — these are what make the inspector, add-menu, history labels and assistant chips derive from one place. Keep them small, pure and well-typed.

### Schema work
Apply every command, entity, capability and field change in the four briefs' §3 (subject to the decisions above). Keep the registry coherent: consistent naming (\`noun.verb\`), descriptions written for the assistant as much as for people (say when to use the command), \`tool\` / \`confirm\` / \`role\` set deliberately (anything that spends money or is destructive is \`confirm\`; attestation commands are never tools), inputs that are top-level objects, no two commands that do the same thing. Where two briefs ask for overlapping things, unify them and say so in your report. Update \`packages/schema/src/index.ts\` exports and extend the schema tests.

### Server work
The handler table must stay complete (\`{ [N in CommandName]: … }\`):
- **Implement fully** everything that is plain state: new columns/tables and a NEW drizzle migration (never edit an applied migration; \`pnpm --filter @pave/server db:generate\`), revert-by-run, \`reverts\`, \`coverAuto\`, piece \`origin\` + \`pieces.attest\` (user actors only) and the 409 gate on mesh generation / production / export when attestation is missing, reference additions (\`pieceId\`, \`canvas\`, lineage inputs, \`capturedAt\`, \`licenseUrl\`), \`references.lineage\` / \`references.arrange\`, saved scenes CRUD, render job fields + \`renders.update\` / \`delete\` / \`complete\` (browser jobs: same user, first write wins) + \`stale\` computation, brand model/shot fields + \`shots.get\` / \`cancel\` / \`delete\`, mesh-job rows + \`mesh3d.get\` / \`cancel\`, thread ownership filter, message \`seq\`, step/run/feedback columns, \`traces.beginStep\` / \`completeStep\` (unique on run + toolCallId) and atomic \`addUsage\`, \`budget_exceeded\` error code, \`EventBus.publish\` with an optional user/client target and \`/api/events?client=<id>\` presence, \`ServiceContext.invoke\` and \`jobSettled\`.
- **Wire through services** everything that needs an engine a feature team will build, extending \`src/services.ts\` with carefully typed interfaces whose default implementation is NotConfigured (→ 501) or, where a brief demands graceful fallback, documented as such for the team to implement: \`assistant\` (\`threads.send\`, \`runs.decide\`, \`runs.cancel\`, \`client.respond\`), \`mesh3d\` (estimate/submit/cancel), \`freeform\` (\`freeform.analyze\`), \`vision\`, \`embedding\` (\`references.similar\`), \`depth\`, reference capture, render engine probing/configuration (\`renders.engine\`, \`renders.configureEngine\`), on-model estimate/export, and \`GeometryService.renderInput\`. Capabilities in \`session.get\` must reflect which services are configured.
- Tests for every new state-bearing handler (happy path, tenancy isolation, role/actor rules, 409/501 cases), and the whole existing suite still green.

### Constraints
- You own \`packages/schema/**\` and \`apps/server/**\` for this task. Do not touch other packages (the studio and other packages are being written concurrently and consume the schema: keep changes additive where possible; where you must change an existing shape, list it in your report so consumers can be updated).
- Do not run state-changing git commands. Never delete node_modules or pnpm-lock.yaml. Add deps only if unavoidable (\`pnpm add --filter <pkg> <dep>\`; retry after ~15 s if another install is running).
- No feature implementation beyond what is listed: no assistant loop, no providers, no UI. No dead code or speculative fields: every addition must trace to a brief.
- Verify: \`pnpm --filter @pave/schema typecheck\`, \`pnpm --filter @pave/server typecheck\`, \`pnpm exec vitest run packages/schema apps/server\`, and boot the server once against a fresh data dir to prove the migrations apply (\`PAVE_DATA_DIR\` to a temp dir; stop it afterwards).
`

const REPORT = `
## Final report (≤350 words)
The contract as it now stands for each of the four areas (new/changed commands, entities, events, client tools); every service interface with its exact name and signature and which commands route to it; where you unified or deviated from a brief and why; breaking changes to existing shapes; what you deliberately left for feature teams; test results.`

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
const report = await agent(`${BASE}\n${TASK}\n${REPORT}`, {
  label: 'implement:contract',
  phase: 'Implement',
  model: 'opus',
  effort: 'high',
})

const LENSES = [
  {
    key: 'plans',
    text: 'Coherence with the four build briefs. Go through each brief\'s §3 line by line and check the change exists with the right shape (subject to the lead\'s decisions); then read each brief\'s Structure / Hard-parts / Build-order sections and ask: can that team build everything it describes against this contract without editing the registry again? Flag anything missing, mis-shaped, or contradicting between briefs (naming, duplicated commands, overlapping entities).',
  },
  {
    key: 'server',
    text: 'Server correctness. Run the tests and typecheck; read the new handlers, repositories, migration and event/trace changes for: tenancy holes (any query not org-scoped, any id accepted without an org check), role/actor rules (attestation by users only, admin-only settings, browser render completion by the same user), atomicity and idempotency (revert-by-run as one change, completeStep uniqueness, concurrent design.apply), migration safety on an existing database (boot the server against a data dir created from the PREVIOUS migration state if you can reconstruct it via git stash-free means such as running the old migration file set in a temp copy; otherwise reason carefully), SSE targeting leaks across users/orgs, and regressions to existing behaviour.',
  },
  {
    key: 'api',
    text: 'API and type design. Is the registry still one coherent language (noun.verb, no synonyms, no two ways to do one thing)? Are tool/confirm/role flags right for an AI agent holding these tools (anything that spends money or destroys data must be confirm; nothing security-sensitive exposed as a tool)? Are descriptions good enough for a model to choose correctly? Are zod schemas tight (bounds on arrays/strings, discriminated unions instead of optional soup), JSON-Schema-convertible (z.toJSONSchema on every tool input must succeed — actually run it for all tool commands and client tools), and are the describe.ts helpers correct, pure and well tested (try to break squashOps/labelForOps/visibleFields with edge cases)? Any speculative or dead additions that no brief asks for?',
  },
]

phase('Review')
const reviews = (
  await parallel(
    LENSES.map((l) => () =>
      agent(
        `${BASE}\n## Your job: adversarial review of the contract extension (lens: ${l.key})\nAn agent has just extended the shared contract. Its brief was:\n${TASK}\n\nIts report:\n\n${report || '(no report returned)'}\n\nDo not trust the report; read the code (\`packages/schema/**\`, \`apps/server/**\`, the four briefs in \`docs/plans/\`) and run things. You are READ-ONLY on the repository (scratch files only under /tmp/claude-0/-home-user-ffdraft/24192795-28e0-5484-b947-9462017ba677/scratchpad/review-contract-${l.key}/).\n\nYour lens: ${l.text}\n\nReport only real, evidenced problems, each with a concrete fix. severity: blocker = a feature team cannot build / data leak / data loss; major = wrong or missing contract piece, incorrect behaviour; minor = worth fixing. No style nitpicks. If it is genuinely good, return few findings.`,
        { label: `review:${l.key}`, phase: 'Review', schema: FINDINGS },
      ),
    ),
  )
).filter(Boolean)

const findings = reviews.flatMap((r) => r.findings || [])
log(`${findings.length} findings (${findings.filter((f) => f.severity === 'blocker').length} blockers, ${findings.filter((f) => f.severity === 'major').length} major)`)

let fix = 'No findings.'
if (findings.length) {
  phase('Fix')
  fix = await agent(
    `${BASE}\n${TASK}\n\n## Your job now: fix review findings\nThe contract extension above has been implemented and then reviewed by three independent reviewers. Their findings follow (possibly overlapping — merge duplicates). For each: verify it against the code first (if it is wrong, say so and explain instead of changing code); fix the root cause cleanly; add or extend a test; keep everything additive for consumers where possible. Blockers and majors must be resolved; fix minors unless disproportionate. Finish with \`pnpm --filter @pave/schema typecheck\`, \`pnpm --filter @pave/server typecheck\` and \`pnpm exec vitest run packages/schema apps/server\` green.\n\n${findings
      .map((f, i) => `${i + 1}. [${f.severity}] ${f.area}${f.file ? ` (${f.file})` : ''}: ${f.problem}\n   Evidence: ${f.evidence}\n   Suggested fix: ${f.fix}`)
      .join('\n')}\n\n## Final report (≤350 words)\nPer finding: fixed / rejected (why) / deferred (why). Then the final contract summary for feature teams: service interfaces (names + signatures + routed commands), client tools, events, and any breaking changes to existing shapes.`,
    { label: 'fix:contract', phase: 'Fix', model: 'opus', effort: 'high' },
  )
}

return { report, reviewSummaries: reviews.map((r) => r.summary), findings, fix }
