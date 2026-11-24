export const meta = {
  name: 'build-cad-workspace',
  description: 'Build the CAD workspace (viewport, outliner, inspector, design session, exports) from its brief, then review it with a design lens and an engineering lens and fix',
  phases: [
    { title: 'Implement', detail: 'Opus 5.5 high builds features/cad end to end', model: 'opus' },
    { title: 'Review', detail: 'design QA with screenshots; engineering and sync correctness' },
    { title: 'Fix', detail: 'resolve confirmed findings', model: 'opus' },
  ],
}

const SHOTS = '/tmp/claude-0/-home-user-ffdraft/24192795-28e0-5484-b947-9462017ba677/scratchpad/shots/cad'

const BASE = `
You are working on "Pavé", an open-source, AI-native jewelry design suite: one calm, Notion-like workspace that takes a piece from Ideate → Spec → CAD → Render → On model → Sourcing → Production, with an assistant that can do everything a person can. Monorepo: /home/user/ffdraft (pnpm 10 workspaces, Node 22, TypeScript 7, zod 4, React 19, Vite 8, vitest 5, biome 2); internal packages export TS source directly. Must work cross-platform (macOS, Windows, Linux desktop via Electron, and the web).

## The task area: the CAD workspace
The "Design" tab of a piece — \`apps/studio/src/features/cad\` (currently a placeholder exporting \`PieceDesign({ pieceId })\`). The judged build brief is **\`docs/plans/cad-workspace.md\`** — read it completely; it is the specification (experience, structure, hard parts, verification, scope cuts, build order). Then read what it builds on:
- \`docs/ARCHITECTURE.md\`; \`packages/ui/src/styles.css\` (design tokens and principles — the visual law) and \`packages/ui/src/**\` (the component system: use it; NumberField is the scrubbable CAD input; floating layers use the \`glass\` utility).
- \`apps/studio/src/**\` — the shell: \`lib/rpc.ts\` (typed RPC client), \`lib/query.ts\` (\`useRpc\`, \`useRpcMutation\`, invalidation), \`lib/events.ts\` (SSE), \`lib/commands.ts\` (\`useRegisterCommands\` — every action must be a registered command; shortcuts are declared platform-neutrally like \`mod+z\`), \`stores/assistant.ts\`, \`pages/piece/*\` (the piece page, tabs; Design is full-bleed), \`components/*\`, \`e2e/*\` (Playwright fixtures and screenshot scripts).
- \`packages/schema/src/**\` — \`design/nodes.ts\` (node kinds + field metadata incl. widgets, groups, \`when\`, \`advanced\`, \`snap\`, labels), \`design/describe.ts\` (pure helpers: describeNode, visibleFields, variantPatch, defaultNode, squashOps, labelForOps, describeOps — the inspector, add-menu and history labels must derive from these, never from per-kind code), \`design/design.ts\` (ops, applyOps, Change), \`api/commands.ts\` (design.apply / design.history / design.revert / pieces.update …), \`api/client-tools.ts\` (\`viewport.capture\`, \`viewport.select\`, \`ui.context\`, \`ui.navigate\` — the CAD feature implements the handlers for the viewport ones; the relay that lets the assistant call them is built by another team later), \`api/events.ts\` (ServerEvent incl. \`design.changed\`), \`domain/*\`.
- \`packages/kernel/src/types.ts\` (the public geometry contract) and \`packages/kernel/src/client.ts\` / \`worker.ts\` (\`createKernelClient()\` — the kernel in a module Worker; evaluate with latest-wins cancellation; \`Part.rev\` lets you skip re-uploading unchanged geometry; \`Kernel.kinds\` / \`Kernel.formats\` say what this build supports; \`Diagnostic.fix\` carries one-click repair ops). The kernel author is finishing tests and fixes concurrently — if something in the kernel is broken or missing for you, do NOT edit \`packages/kernel\`; work against the contract, note it precisely in your report.
- \`packages/render/src/three/*\` (\`@pave/render/three\`): \`evaluationToThree\`, \`createMetalMaterial\`, \`GemMaterial\` (BVH-traced, instanced, \`setGemQuality\`), \`createEnvironment\`, \`applyResolvedScene\`, \`configureRenderer\`, \`zUpGroup\` — the single place Evaluation → three objects happens; use it, do not duplicate it. \`packages/render/demo\` shows it working.
- The server (\`apps/server\`): run it with \`pnpm --filter @pave/server dev\` (port 8787; local mode auto-signs-in and seeds a workspace with template pieces; use a throwaway data dir via \`PAVE_DATA_DIR\` under your scratch directory so runs are reproducible) and the studio with \`pnpm --filter @pave/studio dev\` (5173, proxies /api).

## Ground rules
- You own \`apps/studio/src/features/cad/**\`, plus shared studio infrastructure the brief calls for under \`apps/studio/src/lib/**\` / \`apps/studio/src/stores/**\` / \`apps/studio/src/components/**\` when — and only when — sibling features will reuse it (in particular: ONE kernel-client singleton and a \`usePieceEvaluation(pieceId, detail)\` hook that the Sourcing, Production and Render tabs will also use, the design-session store, and the viewport-capture function the assistant will call; put these outside \`features/cad\` and keep their public API small and documented by types). You may make small additive changes to \`@pave/ui\` if a genuinely reusable component is missing. Do not touch \`packages/schema\`, \`packages/kernel\`, \`packages/render\`, \`apps/server\` (a contract-fix agent is finishing work in schema + server right now: if you hit a type error originating there, re-run a little later; if it persists, work around it locally and report it).
- Do not run state-changing git commands — the lead handles version control. Never delete node_modules or pnpm-lock.yaml. Add deps with \`pnpm add --filter @pave/studio <dep>\` (three r187, @react-three/fiber 9 and drei 10 are the intended stack; drei's MeshRefractionMaterial is broken on r187 — the gem shader in @pave/render/three replaces it); if pnpm fails because another install is running, wait ~15 s and retry.
- Quality bar: production code for an open-source product — small focused modules, no duplication (no per-kind inspector forms, one place where ops are created, one place where evaluations are requested), no dead code, comments only where they explain *why*, strict TS. Accessible and keyboard-first. Every user-visible action is a registered command. Respect \`prefers-reduced-motion\`.
- Visual bar: this is the screen the founder will judge the product by — "clean CAD UI", calm like Onshape/Shapr3D/Plasticity, approachable to someone who has never used CAD. The viewport is the hero on the \`stage\` gradient; panels are quiet, hairline-separated, 13 px; floating HUDs are glass; nothing shouts.
`

const VERIFY = `
## Verify — for real, in a real browser
Chromium + Playwright are preinstalled (\`require('playwright')\`, \`chromium.launch()\`; NEVER run \`playwright install\`; WebGL runs in software here — launch with \`--use-angle=swiftshader\` / \`--enable-unsafe-swiftshader\` if needed — so expect low fps but correct pixels; your code must detect software GL and degrade gem quality rather than hang). Against the real server and the real kernel, drive and screenshot at 1440×900 (deviceScaleFactor 1), light AND dark: each seeded template piece in the Design tab (solitaire, halo, three-stone, eternity, signet, pendants incl. the iced ones, studs, chains — some kinds may still report diagnostics while the kernel is being finished: the workspace must show such diagnostics gracefully and still render the rest); selecting a part and a stone; scrubbing a parameter (band width, stone size) and seeing geometry update; add-feature menu; inspector for several kinds incl. the linked mm↔carat stone control and ring-size control; undo/redo; a remote change arriving (apply a change through the RPC from your script as another actor and show the viewport updating with the AI affordance); the diagnostics list with a one-click fix; export menu producing a real STL and STEP download; display modes (rendered / clay / technical); empty-design state. Look at the screenshots critically — alignment, spacing, contrast, whether the ring looks beautiful on the stage, whether a novice would know what to do — and iterate until it is genuinely good. Save final screenshots to ${SHOTS}/. Also: unit tests for the design-session store (coalescing a scrub into one labelled change, undo/redo, sync ordering, applying a remote change during local edits, conflict/409 recovery) and for the schema-driven inspector model; \`pnpm --filter @pave/studio typecheck\`, \`pnpm --filter @pave/studio build\`, \`pnpm exec vitest run apps/studio\`. Stop every dev server you started.
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
  `${BASE}\n## Your job: build the CAD workspace\nImplement \`docs/plans/cad-workspace.md\` in its build order, each milestone verified before the next. Honour its scope cuts; where the brief and the real code disagree, follow the real code and note it.\n${VERIFY}\n## Final report (≤350 words)\nWhat exists (by milestone) and how to run it; the shared APIs sibling features should use (exact paths, exports, signatures: kernel client singleton, \`usePieceEvaluation\`, design-session store, viewport capture, client-tool handlers); measured performance (first evaluation, scrub re-evaluation, frame times with a pavé piece under software GL); where the screenshots are and your honest assessment of the look; kernel problems you hit (precise repro); what from the brief is not done.`,
  { label: 'implement:cad', phase: 'Implement', model: 'opus', effort: 'high' },
)

const LENSES = [
  {
    key: 'design',
    text: `You are the product's design director and a first-time CAD user at once. Run the app (server + studio) against a fresh data dir and USE the CAD workspace through Playwright at 1440×900 in light and dark and at a small laptop size (1280×720): open several templates, select, scrub, add a feature, undo, export, try the empty state, try keyboard-only operation, try a narrow window. Take your own screenshots into ${SHOTS}/review-design/ and study them. Judge against the brief's Experience section, the design tokens/principles in packages/ui/src/styles.css, and the founder's bar ("clean, almost Notion-looking, genuine taste; fluid; frosted menus; clean CAD UI"; radically approachable to non-CAD users). Report concrete visual and interaction defects: misalignment, cramped or wasteful spacing, inconsistent radii/line weights/type sizes, poor contrast in either theme, unclear affordances, jargon labels, confusing empty/loading/error states, janky motion, viewport framing or lighting that makes the jewelry look bad, HUDs obscuring the piece, anything that would make a designer wince or a novice stall. For each: where (screenshot + element), why it is wrong, the precise fix (token/spacing/copy).`,
  },
  {
    key: 'engineering',
    text: `You are a staff engineer reviewing correctness and performance. Run typecheck, tests and build. Read the code for: the design-session store (optimistic ops, coalescing, undo/redo semantics incl. redo invalidation, sequential sync, idempotent changeIds, handling of 409 and of remote changes interleaved with local unsynced ops — construct the nasty interleavings as tests or scripts and see what happens; data loss or divergence between client and server is a blocker); kernel client lifecycle (latest-wins, no leaked workers/geometries/materials/textures — check three.js disposal on unmount and on part replacement; memory growth over 200 scrubs); render-loop discipline (no continuous rendering when idle, no React re-render per frame, instanced stones, quality degradation on software GL); schema-driven inspector (does every node kind and every field meta — when/advanced/snap/widgets/refs — render and edit correctly with NO per-kind code; try every kind via the add menu); selection/hover on instanced stones; export correctness (files actually open: re-parse the STL; STEP header); client-tool handlers (viewport.capture returns real images of the right views at the right version); command registration (every action reachable from the palette, shortcuts platform-neutral, no ad-hoc key listeners); duplication with @pave/render/three or @pave/ui; cross-platform issues; accessibility basics. Use scratch files only under ${SHOTS}/review-eng/.`,
  },
]

phase('Review')
const reviews = (
  await parallel(
    LENSES.map((l) => () =>
      agent(
        `${BASE}\n## Your job: adversarial review of the CAD workspace (lens: ${l.key})\nAn agent has just built the CAD workspace from the brief. Its report:\n\n${report || '(no report returned)'}\n\nDo not trust the report. You are READ-ONLY on the repository.\n\n${l.text}\n\nReport only real, evidenced problems, each with a concrete fix. severity: blocker = data loss / crash / unusable / embarrassing visual defect on the main path; major = clearly wrong behaviour, missing brief requirement on the main path, notable visual defect; minor = polish worth doing. No personal-taste nitpicks without a principle behind them. If it is genuinely good, say so and return few findings.`,
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
    `${BASE}\n## Your job: fix review findings in the CAD workspace\nThe workspace was built from \`docs/plans/cad-workspace.md\` and reviewed by a design director and a staff engineer. Their findings follow (merge duplicates). For each: reproduce it first (if you cannot, say so and explain rather than changing code); fix the root cause cleanly; add or extend a test for behavioural bugs; re-screenshot for visual ones and compare before/after yourself. Blockers and majors must be resolved; fix minors unless disproportionate.\n${VERIFY}\n## Findings\n${findings
      .map((f, i) => `${i + 1}. [${f.severity}] ${f.area}${f.file ? ` (${f.file})` : ''}: ${f.problem}\n   Evidence: ${f.evidence}\n   Suggested fix: ${f.fix}`)
      .join('\n')}\n\n## Final report (≤300 words)\nPer finding: fixed / not reproduced / deferred (why). Then the final shared APIs for sibling features (paths, exports, signatures), where the final screenshots are, and remaining gaps.`,
    { label: 'fix:cad', phase: 'Fix', model: 'opus', effort: 'high' },
  )
}

return { report, reviewSummaries: reviews.map((r) => r.summary), findings, fix }
