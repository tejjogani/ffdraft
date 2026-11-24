export const meta = {
  name: 'engine-pass-continue',
  description: 'Finish the engine test pass: verify the three fixed areas, build stone replacement and fix the stones area, run the performance tester, loop fix and verify until clean, then add Ask AI and Replace stone to the CAD context menus',
  phases: [
    { title: 'Verify', detail: 'fresh verifiers re-run every repro of the fixed areas' },
    { title: 'Stones', detail: 'stone replacement that keeps the mount, then the stones findings' },
    { title: 'Perf', detail: 'interactivity, memory, Worker path, cross-platform' },
    { title: 'Fix', detail: 'later rounds, one owner per area' },
    { title: 'Studio', detail: 'Ask AI section and Replace stone in every context menu' },
  ],
}

const S = '/tmp/claude-0/-home-user-ffdraft/24192795-28e0-5484-b947-9462017ba677/scratchpad'
const CTX = `
You are working in the monorepo at /home/user/ffdraft (Pavé: proprietary, AI-native jewelry design software). Read docs/ARCHITECTURE.md first, then packages/kernel/src/types.ts and packages/kernel/src/core.ts, then the files of your area.
This is the core engine test pass the founder asked for ("we must test the core engine first"). The engine is @pave/kernel (packages/kernel) driven by the design document in @pave/schema (packages/schema: nodes.ts, design.ts, recipes/index.ts with TEMPLATES and buildDesign, spec.ts). Jewelry spans wedding rings to hip-hop pendants to one-off sculpted pieces; millimetres, Z up.
Messages from the founder may be relayed to you as context while you work. The lead engineer running this workflow answers them; they do not replace or cancel this task, which is authorised.

Ground rules:
- Scratch scripts, logs and screenshots go ONLY under ${S}/engine-pass/<your key>/ (create it). Earlier testers left repro scripts under ${S}/engine-pass/<tester key>/ (templates-fuzz, settings-swap, pendants-recipes, freeform-pave, exports-dfm) and the fixers under ${S}/engine-pass/fix-<owner>/. Helpers you can copy: ${S}/review-freeform/lib.mts, shoot.cjs, view.html (evaluate a design in Node with tsx and render it to PNG with the pre-installed Playwright Chromium). Look at the PNGs you make with the Read tool and judge them like a bench jeweler would.
- The machine has 4 cores and 15 GB shared with other agents. Run ONE heavy process at a time, start Node with NODE_OPTIONS=--max-old-space-size=3072, never leave a process running, and run targeted tests (vitest run <path>) rather than the whole suite.
- Never touch /home/user/diaex-backend. Never commit, push or change git state.
- No model names, no secrets in files. Plain code over clever code; comments say why. No duplicated helpers: reuse what the package already has.
- Report honestly: what you ran, what passed, what you could not test. A claim without a command or an image behind it does not count.
`

const FINDINGS = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'What was covered, what held up, what was not tested. Plain prose, short.' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          owner: { type: 'string', enum: ['stones', 'pendants', 'freeform', 'core'] },
          area: { type: 'string' },
          problem: { type: 'string' },
          evidence: { type: 'string' },
          repro: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['severity', 'owner', 'area', 'problem', 'evidence', 'repro', 'fix'],
      },
    },
  },
  required: ['summary', 'findings'],
}

const OWNERS = {
  stones: 'packages/kernel/src/features/{gem,setting,halo,gemRow,ringShank,engraving,revolve,pipe,primitive,boolean}.ts, packages/kernel/src/gems/**, packages/kernel/src/geometry/**, packages/schema/src/design/{nodes,fields,describe,design}.ts, new packages/schema/src/design/{intents,mount}.ts, packages/schema/src/domain/** (sizes, gems), packages/schema/src/api/commands.ts (only to add design.replaceStone) and its server handler in apps/server/src/handlers',
  pendants: 'packages/kernel/src/features/{chain.ts,chain/**,bail.ts,finding.ts,finding/**,group.ts,pattern.ts}, packages/schema/src/recipes/**, packages/schema/src/design/spec.ts',
  freeform: 'packages/kernel/src/mesh/**, packages/kernel/src/builtin/**, packages/kernel/src/features/{vectorBody,meshBody,relief,pave}.ts, packages/kernel/src/text.ts, packages/kernel/src/fonts/**',
  core: 'packages/kernel/src/{evaluate,solid,dfm,export,runtime}/**, packages/kernel/src/{kernel,client,worker,workerHost,protocol,types,core,rules,index}.ts, packages/kernel/package.json, packages/render/**, workers/render/**, packages/production/**',
}
const serious = (list) => list.filter((f) => f.severity !== 'minor')
// Round-one inputs live in files (too large to inline): the testers' findings per owner and the
// fix reports of the three owners who already worked through them.
const R1 = '/tmp/claude-0/-home-user-ffdraft/24192795-28e0-5484-b947-9462017ba677/scratchpad/engine-pass/round1'
const HAS_PRIOR_FIX = { stones: false, pendants: true, freeform: true, core: true }
const listText = (list) => typeof list === 'string' ? `Read them from ${list} (a JSON array).` : `(JSON):\n${JSON.stringify(list, null, 1)}`
const reportText = (report) => report && report.file ? `It is in ${report.file}; read it.` : `\n<fix_report>\n${report}\n</fix_report>`

const fixPrompt = (owner, list, round, extra = '') => `${CTX}
You are the owner of the "${owner}" area, fix round ${round}. You may edit: ${OWNERS[owner]}. If a fix truly needs a line outside your files, make the smallest edit and list it in your report. Other owners are editing their own files at the same time.
${extra}
Fix these findings from independent testers and verifiers. For each: reproduce it first (run its repro); if it does not reproduce say so with evidence; fix the cause, not the symptom; add a regression test next to the code. Blockers and majors first; do all minors you can.
Findings ${listText(list)}

When done run the vitest files of your area, \`pnpm -s typecheck\` and biome on the files you touched. Return a report: per finding fixed / not reproduced / deferred (with why), files touched outside your list, test and typecheck results, what remains weak. Screenshots under ${S}/engine-pass/fix-${owner}-${round}/.`

const verifyPrompt = (owner, list, fixReport, round, extra = '') => `${CTX}
You are a fresh, sceptical verifier for the "${owner}" area (files: ${OWNERS[owner]}), round ${round}. Do not edit repository files; scripts go under ${S}/engine-pass/verify-${owner}-${round}/.
An owner says they fixed the findings below. Their report: ${reportText(fixReport)}

1. Re-run every finding's repro and decide: fixed, still broken, or fixed-but-regressed-something. Default to "still broken" when the evidence is unclear.
2. Hunt for regressions: run the area's tests, rebuild every template at draft and production, render the ones this area affects and look at them.
${extra}
Report only what is still wrong or newly wrong as findings (owner "${owner}" unless it clearly belongs to another area). An empty list means the area is clean.
Original findings ${listText(list)}`

const STONE_BUILD = `
FIRST build stone replacement from the plan at docs/plans/targeted-edits.md. The planner's summary of it is in ${R1}/targeted-edits-plan-summary.md, and the planner's probe scripts and images are in ${S}/engine-pass/targeted-edits/.
In order:
1. Make "absent" expressible for follow fields (gem.lw, gemRow.graduateTo, setting.prongCount, setting.prongDiameter, prongSpin, side-stone placement, ringShank.shoulderHeight, gemRow.skipCenter): no schema default that the kernel reads as "unset". Keep existing designs loading (a stored value that equals the old default must keep its meaning).
2. Write the pure rule file packages/schema/src/design/mount.ts and resolveDesign(design) that fills absent follow fields from the stone, so a plain update of gem.cut or size already gives a correct mount: claw count and spin per cut (corners on princess/emerald/cushion/asscher, V-tips on the points of pear/marquise/heart/trillion, never a claw mid-side of a trillion), wire from the stone size, cathedral rise and head height from the pavilion, the shoulder row's gap from the head's footprint, three-stone side stones at 0.5 mm from the new centre girdle. The kernel evaluates resolveDesign(design). Reuse RULES and canon numbers where they exist rather than inventing new ones; if the canon's table must move into GEM_CUTS, move it and leave canon importing it.
3. Write replaceStone(design, target, change) in packages/schema/src/design/intents.ts returning { ops, label, notes, warnings } exactly as the plan specifies (target: a gem, a row/halo/pavé field, or all stones like one; change: cut, size mm or carat, ratio, material, quality, or fit to a measured stone; sourcing link cleared with a warning; hand overrides kept with a warning; three-stone sides keep size unless sides:'proportion').
4. Add design.replaceStone to the command registry (tool: true, designer role, no confirmation) with dryRun (ops, before/after summary, weight/carat/stone-count deltas, added and resolved diagnostics) and apply (one change, attributed), and its server handler with tests.
5. A vitest suite that turns the plan's matrix green: every centre-stone template × every cut × three sizes at draft, a sample at production; undo restores the exact design; hand overrides survive; dry run equals the applied result. Render the matrix to ${S}/engine-pass/fix-stones-1/ as contact sheets and look at them.
Many of the findings below are the same stale-mount problem; the build above should close them. Then fix the rest.`

const STONE_VERIFY = `3. Attack stone replacement (docs/plans/targeted-edits.md, design.replaceStone, intents.ts, mount.ts): every centre-stone template × every cut × sizes from 0.3 ct to 5 ct × ratios; one stone inside a row; hand-overridden claws; a linked sourced stone; undo; dry run equals the applied result; old designs saved before this change still load and look the same. Render and judge like a setter: claws on the girdle and lapping the crown, V-tips on points, bezel and halo following the outline, seat cut, culet clear of the finger, shoulders meeting the head.`

const PERF = `Angle: interactivity, memory, the Worker path and cross-platform risk. Do not edit repository files; scripts under ${S}/engine-pass/perf-worker/.
1. Incremental evaluation correctness: for each template, change one parameter at a time through the kernel (as a slider drag would) and compare the incremental result with a fresh kernel evaluating the same design — parts, stones, report and diagnostics must be identical. Include add/remove/move/setKind and undo (inverse ops).
2. Timing: first evaluation and warm single-parameter edits at draft for every template; a slider drag should stay under ~100 ms where only a cheap node depends on it. Name the slow nodes and why.
3. Memory: 300 edits on one design and cycling through all templates in one kernel — WASM and JS heap must plateau. Find leaks.
4. Worker client (client.ts / worker.ts / protocol.ts): run it in real Chromium through a plain Vite build (see packages/kernel/src/testing/browser and export/testing): transfers only changed parts, cancels superseded evaluations, survives a worker crash, reports errors.
5. Cross-platform: Node-only APIs in browser paths, path separators, case-sensitive imports, reliance on shell tools, font loading, WASM locating — anything that would break on Windows or in the browser.
6. Determinism across fresh processes at both detail levels.
7. Reported by the CAD workspace team, confirm and measure: production-detail evaluation of the iced-trophy template took over 10 minutes in Node; diagnostics emitted one per stone with internal ids; importing @pave/kernel pulls in the in-process kernel (and rhino3dm's ws) where only the Worker client is wanted — a separate ./client export would avoid it; the Worker client gives no signal when the worker crashes.
Owners for findings: stones (gem/setting/halo/gemRow/ringShank/gems), pendants (chain/bail/finding/group/pattern/recipes), freeform (mesh, vectorBody, meshBody, relief, pavé, text), core (evaluate, solid, dfm, export, runtime, kernel/client/worker/protocol, render, production).`

phase('Perf')
const perfP = agent(`${CTX}\nYou are an adversarial tester; your key is "perf-worker". Every finding needs a repro script and evidence.\n\n${PERF}`, {
  label: 'test:perf-worker',
  phase: 'Perf',
  schema: FINDINGS,
  model: 'opus',
  effort: 'high',
})

const MAX_ROUNDS = 3
async function ownerLoop(owner) {
  const history = []
  let list = `${R1}/${owner}-findings.json`
  let fixReport = HAS_PRIOR_FIX[owner] ? { file: `${R1}/${owner}-fix-report.md` } : null
  const isStones = owner === 'stones'
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    if (!fixReport) {
      fixReport = await agent(fixPrompt(owner, list, round, isStones && round === 1 ? STONE_BUILD : ''), {
        label: `fix:${owner}:${round}`,
        phase: isStones && round === 1 ? 'Stones' : 'Fix',
        model: 'opus',
        effort: 'high',
      })
      if (!fixReport) {
        history.push({ round, error: 'fix agent returned nothing' })
        break
      }
    }
    const v = await agent(verifyPrompt(owner, list, fixReport, round, isStones ? STONE_VERIFY : ''), {
      label: `verify:${owner}:${round}`,
      phase: 'Verify',
      schema: FINDINGS,
      model: 'opus',
      effort: 'high',
    })
    history.push({ round, fixReport, verify: v && v.summary, open: v ? v.findings.length : null })
    if (!v) break
    let open = v.findings.filter((f) => f.owner === owner)
    if (round === 1) {
      // The performance tester's findings join each owner's list once, after the first verify.
      const perf = await perfP
      if (perf) open = open.concat(perf.findings.filter((f) => f.owner === owner).map((f) => ({ ...f, from: 'test:perf-worker' })))
    }
    // Findings a verifier filed against another area are kept and returned, not silently dropped.
    history.push({ round, misrouted: v.findings.filter((f) => f.owner !== owner) })
    list = open
    fixReport = null
    log(`${owner}: round ${round} leaves ${list.length} open (${serious(list).length} blocker/major)`)
    if (!serious(list).length) break
  }
  return { owner, open: list, history }
}

// Stones first: it is the longest chain (build, fix, verify), and only two agents run at a time.
const loops = await parallel(['stones', 'core', 'pendants', 'freeform'].map((o) => () => ownerLoop(o)))
const results = loops.filter(Boolean)
const stones = results.find((r) => r.owner === 'stones')
const perf = await perfP

phase('Studio')
let studio = null
const stoneBuilt = stones && stones.history.some((h) => typeof h.fixReport === 'string' && /replaceStone/.test(h.fixReport))
if (stoneBuilt) {
  const build = await agent(`${CTX}
Build the studio half of docs/plans/targeted-edits.md (sections on "Ask AI" and addressing a stone). design.replaceStone now exists in the command registry (read packages/schema/src/api/commands.ts and packages/schema/src/design/intents.ts).
You may edit apps/studio/** and packages/ui/** only. Read docs/plans/cad-workspace.md and the existing CAD feature (apps/studio/src/features/cad), the command system (apps/studio/src/lib/commands.ts) and the menu component (packages/ui/src/components/menu.tsx) first.
1. One shared AskAiSection used by every context menu in the CAD workspace (feature-tree row, viewport right-click on a part or a stone) and offered for reuse elsewhere: quick intents for the thing clicked (Replace stone…, Change metal…, Make it bigger / smaller), then "Ask AI about this…". The assistant is not built yet: "Ask AI about this…" stays visible but disabled with a short reason, and the quick intents work without it.
2. Replace stone…: a small calm dialog (cut picker with outline icons, size in mm or carats, ratio for fancy cuts, material) that calls design.replaceStone with dryRun to show the before/after weight, carats, stone count and any new checks, and applies on confirm as one undoable change. Right-click on a stone in a row or halo addresses that field ("all stones in this row"), per the plan.
3. Right-click must not fight right-drag to pan in the viewport: a menu opens only on a click without movement.
4. Keyboard: the context menu opens with Shift+F10 / the Menu key on the selection; everything reachable without a mouse.
5. Tests for the pure parts, then run the real server and studio and check in Chromium at 1440 and 1280 wide, light and dark: right-click the centre stone of the Cushion halo, Replace stone with a pear, look at the result. Screenshots to ${S}/shots/ask-ai/ and look at them. Match the existing look (calm, Notion-like, frosted menus).
Run vitest for apps/studio, \`pnpm -s typecheck\` and \`pnpm build\`. Stop every server you start. Return a report with what works, screenshots, and what is left.`, { label: 'studio:ask-ai', phase: 'Studio', model: 'opus', effort: 'high' })
  const review = build && (await agent(`${CTX}
Review the new "Ask AI" context-menu section and Replace stone dialog in apps/studio (builder's report below) as a sceptical product designer and engineer. Do not edit files; scripts under ${S}/shots/ask-ai-review/. Run the real server and studio, drive it with Playwright at 1440, 1280 and 1024 wide in light and dark, right-click stones, parts and tree rows, replace stones on several templates, undo, use the keyboard only. Check it matches the calm Notion-like look, nothing overlaps, the dry-run numbers match what applying gives, and right-drag pan still works. Stop every server you start.
<builder_report>
${build}
</builder_report>`, { label: 'review:ask-ai', phase: 'Studio', schema: FINDINGS, model: 'opus', effort: 'high' }))
  let fix = null
  if (review && review.findings.length) {
    fix = await agent(`${CTX}
You own the "Ask AI" section and Replace stone dialog in apps/studio (and packages/ui). Fix these review findings, re-check in Chromium, run vitest for apps/studio, \`pnpm -s typecheck\` and \`pnpm build\`. Stop every server you start. Return per finding fixed / deferred with why.
Findings (JSON):
${JSON.stringify(review.findings, null, 1)}`, { label: 'fix:ask-ai', phase: 'Studio', model: 'opus', effort: 'high' })
  }
  studio = { build, review: review && review.summary, findings: review ? review.findings : [], fix }
} else log('Stone replacement was not built, so the studio step was skipped')

return {
  perf: perf && { summary: perf.summary, count: perf.findings.length },
  owners: results.map((r) => ({ owner: r.owner, open: r.open, history: r.history })),
  studio,
}
