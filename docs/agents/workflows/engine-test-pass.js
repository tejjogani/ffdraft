export const meta = {
  name: 'engine-test-pass',
  description: 'Adversarially test the geometry engine (every template, fuzzing, stone swaps, exports, performance), plan and build stone replacement that keeps the mount, fix by owner, re-verify until clean',
  phases: [
    { title: 'Test', detail: 'six independent testers, each a different angle; plus the targeted-edits plan' },
    { title: 'Fix', detail: 'one owner per area with disjoint files; stones owner also builds stone replacement' },
    { title: 'Verify', detail: 'fresh verifiers re-run every repro and hunt regressions; loop until dry' },
  ],
}

const S = '/tmp/claude-0/-home-user-ffdraft/24192795-28e0-5484-b947-9462017ba677/scratchpad'
const CTX = `
You are working in the monorepo at /home/user/ffdraft (Pavé: open-source jewelry design software). Read docs/ARCHITECTURE.md first, then packages/kernel/src/types.ts and packages/kernel/src/core.ts, then the files of your area.
The founder's instruction for this stage: "we must test the core engine first". The engine is @pave/kernel (packages/kernel) driven by the design document in @pave/schema (packages/schema: nodes.ts, design.ts, recipes/index.ts with TEMPLATES and buildDesign, spec.ts). Jewelry spans wedding rings to hip-hop pendants to one-off sculpted pieces; millimetres, Z up.

Ground rules:
- Scratch scripts, logs and screenshots go ONLY under ${S}/engine-pass/<your key>/ (create it). Helpers you can copy: ${S}/review-freeform/lib.mts, shoot.cjs, view.html (evaluate a design in Node with tsx and render it to PNG with the pre-installed Playwright Chromium) and ${S}/kernel-view/. Look at the PNGs you make with the Read tool — judge them like a bench jeweler would.
- The machine has 4 cores and 15 GB shared with other agents. Run ONE heavy process at a time, start Node with NODE_OPTIONS=--max-old-space-size=3072, never leave a process running, and run targeted tests (vitest run <path>) rather than the whole suite repeatedly.
- Other agents are working in apps/studio and packages/canon: do not edit those. Never touch /home/user/diaex-backend. Never commit, push or change git state.
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
          owner: { type: 'string', enum: ['stones', 'pendants', 'freeform', 'core'], description: 'stones = gem/setting/halo/gemRow/ringShank/gems/**, schema nodes/describe; pendants = chain/bail/finding/group/pattern + schema recipes/spec/domain; freeform = mesh/**, vectorBody/meshBody/relief/pave, text; core = evaluate/solid/dfm/export/kernel/client/worker/protocol + packages/render + packages/production' },
          area: { type: 'string' },
          problem: { type: 'string' },
          evidence: { type: 'string', description: 'Numbers, image paths, error text.' },
          repro: { type: 'string', description: 'Path of a script under the scratchpad that reproduces it, and how to run it.' },
          fix: { type: 'string', description: 'A concrete suggested fix.' },
        },
        required: ['severity', 'owner', 'area', 'problem', 'evidence', 'repro', 'fix'],
      },
    },
  },
  required: ['summary', 'findings'],
}

const TESTERS = [
  {
    key: 'templates-fuzz',
    prompt: `Angle: every template and parameter fuzzing.
1. Build every entry of TEMPLATES at draft and production detail. For each: no throw; every metal part is a closed manifold with positive volume and the expected number of shells; no stone overlaps another stone or sits outside its seat; report weights/carats are plausible for the trade (say when a number is absurd, e.g. a pendant weighing 170 g because its body is solid); identical input gives identical output.
2. Fuzz: for every node kind in NODE_SCHEMAS, starting from a template that contains it, set each field to its minimum, maximum and a few random values (seeded, reproducible), singly and in random combinations (time-box to about 25 minutes of compute). Invariants: either a valid result or a diagnostic/error a designer can act on — never a raw JavaScript error, never an invalid solid, never a silent empty result, never a hang beyond 60 s at draft.
3. Document-level abuse through applyOps: remove a node others reference, reference cycles, setKind, move, hidden nodes, a design with 0 nodes, 300 nodes.
Known suspects to confirm or clear: schema fields 'lw' and 'graduateTo' have defaults so "unset" is never undefined; prongSpin and taper not honoured in some cases.`,
  },
  {
    key: 'settings-swap',
    prompt: `Angle: stones and settings through a bench jeweler's eye, and the stone-swap baseline.
The founder wants: "replace the stone shape but keep the mount (adjusting for the new shape / size)". Today the only way is a plain 'update' op on the gem node. Measure how far that gets:
1. For every template with a centre stone (solitaire, oval-pave, halo, three-stone, pendant-solitaire, studs, signet if it has one), swap the centre gem to EVERY cut in GEM_CUTS at three sizes (small, as designed, large) and to at least two length/width ratios for fancy cuts. Evaluate at draft and production and render top, front and three-quarter views.
2. Judge each: do prongs actually touch the girdle and lap over the crown (measure the gap numerically too); are prongs placed where a setter would put them (corners on princess/emerald/cushion, V-tips or claws on the points of pear/marquise/heart/trillion, not through a point); does a bezel/half-bezel follow the outline; does the halo follow the outline with even stone spacing and a gallery under it rather than a flat plate; is the seat cut to the new stone; do shoulders, cathedral arms and side stones still meet the head; does the pavilion clear the finger; do three-stone side stones stay in proportion.
3. Stone geometry itself: facet patterns for every cut (table, crown, girdle thickness, pavilion, culet), folded or inverted facets at tips of pear/marquise/heart, carat computed vs trade charts for common sizes (1 ct round ≈ 6.5 mm etc.).
4. Rows and shoulders: gemRow with each setting style (pavé, channel, shared prong, bezel), graduated sizes, coverage and skip angles.
Report a matrix (template × cut × size → ok / what breaks) in your summary and file findings with images. This matrix is the baseline the fixer must turn green.`,
  },
  {
    key: 'pendants-recipes',
    prompt: `Angle: pendants, chains, findings and the recipes that assemble them.
1. Every chain style at fine, medium and heavy gauges, straight and draped: links interlock without intersecting, recognisable at a glance in a render, link count and mass plausible, triangle counts within budget.
2. Bails (every style) on every pendant template and with every chain: the chain passes through the opening without clashing; the bail is attached to the body, at a sensible position (top of the piece, balanced so it hangs straight — check the centre of mass is under the bail). Known: pendant-solitaire and iced-trophy still report bail.small and chain.clash; name-pendant's bail sits inside the "A".
3. Findings: earring posts, butterflies, clasps, jump rings — sizes against trade norms.
4. Recipes: buildDesign(PieceSpec) across every archetype with ordinary AND odd specs (huge stone on a thin band, tiny pendant, 100 mm hip-hop piece, name with 12 letters, studs with fancy cuts). Each must build, be wearable-plausible (weights: flag any pendant body that is solid when the trade would hollow it; the iced trophy weighs ~171 g in 18k), and produce no diagnostics that the recipe itself could have avoided. A template that ships with warnings is a finding.
5. Ring sizes and domain data: round-trips between systems, metal densities, melee stock sizes.
6. Reported by the design-canon team (packages/canon): four templates break the canon's own rules — oval-pave (1.3 mm pavé on a 1.8 mm band), eternity (2.0 mm walled pavé on a 2.6 mm band), iced-trophy and iced-initial (fill stones of 1.8 and 1.6 mm). Confirm with lintDesign from @pave/canon and file them. Canon also defines RecipeDefaults for recipes to call (see its report in packages/canon/src/suggest.ts); check whether recipes should adopt it without creating an import cycle.`,
  },
  {
    key: 'freeform-pave',
    prompt: `Angle: independent re-verification of freeform bodies and pavé (another agent just fixed 13 findings; trust nothing).
1. vectorBody: every named shape, block and script text (including characters the font lacks, kerning pairs, 1 and 14 letters), every edge style × border; closed, genus as expected, draft volume ≈ production volume when nothing is cut.
2. meshBody: every built-in at several heights, smoothing levels, flat back, hollow (wall thickness, drain holes, time), imported broken meshes (holes, flipped faces, self-intersections, debris; STL/OBJ/PLY/GLB/3MF).
3. relief: every outline, images of 1 px to 2000 px, extreme contrast, transparent PNG.
4. pavé: on flat, domed, bordered, thin, two-sided and sculpted hosts, at ice levels 0.1–1.0 and stone sizes 0.8–3 mm: stones never overlap, stay inside the region and margin, are stock sizes, rows read as professional pavé in a render (even rows following the outline, no bald patches, no clusters, beads between stones), seats do not break through at production, performance at 2k / 8k / 30k stones.
5. The founder's test case: a trophy turned into an iced-out pendant (template iced-trophy and a meshBody trophy at 40–60 mm). Is it fully iced where it should be, hollowed, and of a sane weight?`,
  },
  {
    key: 'exports-dfm',
    prompt: `Angle: what leaves the building — exports and manufacturability checks.
1. For every template export STL, 3MF, OBJ, GLB, STEP and 3DM at production detail and READ THEM BACK with an independent reader where one exists (parse STL/OBJ/3MF/GLB yourself or with a library already in the repo; reopen STEP with the OpenCascade already in the repo; read 3DM with rhino3dm). Check units are millimetres, one watertight shell per cast part, volumes match the evaluation report within 0.5 %, layers/names/metals are right, stones are reference-only where the format says so, file sizes are sane (STEP was 20 MB for a halo ring; 38 halo bodies were left uncut in STEP), exports are deterministic.
2. Manufacturability (dfm/**): build designs that are deliberately wrong — wall too thin, prong too thin, stone too close to an edge, floating metal, stone buried, chain too fine, bail too small, unsupported span — and confirm each check fires once, names the node, and offers a fix where it claims to. Then confirm good designs are quiet (no false positives on templates). Confirm checks are not re-run on a fully cached evaluation (a known cost: ~1.4 s each on iced-initial).
3. Production package (packages/production): build it for three templates; open the PDF/SVG drawings and check dimensions against the model, BOM stone counts and weights against the evaluation report.
4. packages/render: a render cancelled before Blender starts must not start Blender; a Blender that ignores SIGTERM must be killed; child processes must die with the parent. Repros exist under ${S}/engines/.`,
  },
  {
    key: 'perf-worker',
    prompt: `Angle: interactivity, memory, the Worker path and cross-platform risk.
1. Incremental evaluation correctness: for each template, change one parameter at a time through the kernel (as a slider drag would) and compare the incremental result with a fresh kernel evaluating the same design — parts, stones, report and diagnostics must be identical. Include add/remove/move/setKind and undo (inverse ops).
2. Timing: first evaluation and warm single-parameter edits at draft for every template; a slider drag should stay under ~100 ms where only a cheap node depends on it. Name the slow nodes and why.
3. Memory: 300 edits on one design and cycling through all templates in one kernel — WASM and JS heap must plateau (objects freed). Find leaks.
4. Worker client (client.ts / worker.ts / protocol.ts): run it in real Chromium through a plain Vite build (see packages/kernel/src/testing/browser and export/testing): transfers only changed parts, cancels superseded evaluations, survives a worker crash, reports errors.
5. Cross-platform: Node-only APIs in browser paths, path separators, case-sensitive imports, reliance on shell tools, font loading, WASM locating — anything that would break on Windows or in the browser.
6. Determinism across fresh processes at both detail levels.
7. Reported by the CAD workspace team, confirm and measure: production-detail evaluation of the iced-trophy template did not finish within 10 minutes in Node; diagnostics are emitted one per stone and expose internal ids ("Stone halo:0 has less than 0.4 mm…"); importing the @pave/kernel entry pulls in the in-process kernel (and rhino3dm's ws) where only the Worker client is wanted — a separate ./client export would avoid it; the Worker client gives no signal when the worker crashes; the studio rebuilds every part instead of reusing Part.rev.`,
  },
]

const OWNERS = {
  stones: {
    model: undefined,
    files: 'packages/kernel/src/features/{gem,setting,halo,gemRow,ringShank,engraving,revolve,pipe,primitive,boolean}.ts, packages/kernel/src/gems/**, packages/kernel/src/geometry/**, packages/schema/src/design/{nodes,fields,describe,design}.ts, a new packages/schema/src/design/intents.ts, packages/schema/src/api/commands.ts (only to add the new command), and the matching new handler in apps/server/src/handlers',
  },
  pendants: {
    model: 'opus',
    files: 'packages/kernel/src/features/{chain.ts,chain/**,bail.ts,finding.ts,finding/**,group.ts,pattern.ts}, packages/schema/src/recipes/**, packages/schema/src/design/spec.ts, packages/schema/src/domain/**',
  },
  freeform: {
    model: 'opus',
    files: 'packages/kernel/src/mesh/**, packages/kernel/src/builtin/**, packages/kernel/src/features/{vectorBody,meshBody,relief,pave}.ts, packages/kernel/src/text.ts, packages/kernel/src/fonts/**',
  },
  core: {
    model: 'opus',
    files: 'packages/kernel/src/{evaluate,solid,dfm,export,runtime}/**, packages/kernel/src/{kernel,client,worker,workerHost,protocol,types,core,rules,index}.ts, packages/render/**, workers/render/**, packages/production/**',
  },
}
const OWNER_KEYS = Object.keys(OWNERS)

phase('Test')
const planP = agent(`${CTX}
You are the planner for "targeted edits" — the founder's words:
- "think about something like replacing the stone shape too but keeping the mount (adjusting for new shape / size), how can we do that / assistant tool for that"
- "Even things like changing stone color from CAD and getting renders, or being able to ask the assistant in the CAD view to do those things is also huge. AI driven CAD editing for jewelry"
- "any right click should have ask AI option - e.g. I click the stone / ask AI and then replace this stone. Or I use general AI and ask to replace"

Read: docs/ARCHITECTURE.md, docs/plans/assistant.md, docs/plans/cad-workspace.md, packages/schema/src/design/{nodes,describe,design}.ts, packages/schema/src/api/{commands,client-tools}.ts, packages/kernel/src/features/{gem,setting,halo,gemRow}.ts, packages/sourcing/src, and how the CAD workspace in apps/studio/src/features/cad handles selection, the inspector and context menus (read only).

Write docs/plans/targeted-edits.md (a build brief, under ~250 lines, plain language, tables where they help). It must settle:
1. Stone replacement as ONE deterministic intent, not model improvisation: a pure function in @pave/schema (packages/schema/src/design/intents.ts), e.g. replaceStone(design, target, change) → { ops, notes, warnings }, where target is a gem node, a stone row/halo/pavé field, or "all stones like this one", and change is any of cut, size (mm) or carat, length/width ratio, material/colour, quality. It returns ordinary ops, so undo, history and traces come free. Decide exactly what "keep the mount" means for each dependent node kind and write it as a rule table: setting (prong count and placement per cut, V-tips/claws on points, bezel/half-bezel follow the outline, basket rails), halo (follows the new outline, stone count recomputed, same melee size), shoulders and cathedral arms (stay attached; head height tracks pavilion depth so the culet clears the finger), three-stone side stones (keep their proportion or stay fixed — say which and why), gemRow/pavé (resizing all vs one), the seat, engraving, and what must NOT change (band size, metal, finish, anything the designer has overridden by hand — define how a hand override is recognised). What is derived by the kernel from the gem automatically vs what the intent must patch explicitly — prefer making the kernel derive it, so a plain update of gem.cut already gives a correct mount, and keep the intent thin. State which is which per rule.
2. Sourcing consequences: a linked/bought stone no longer matches — the intent clears or flags the link; and the reverse case, fitting the mount to a real stone's measured dimensions, is the same intent.
3. The command: design.replaceStone (tool: true, no confirmation, designer role) with input/output schemas, how it previews (dry run returning the ops, a before/after weight and carat delta, new diagnostics) and applies; plus sibling intents worth having now with one line each (change metal everywhere or per part, resize ring, recolour stones, mirror/duplicate) — only name them, do not design them.
4. Addressing one stone inside a row, halo or pavé field (an instance index, not a node): what the selection and threads.send context must carry (node id + instance + pick point), and what "replace this one stone" means there.
5. "Ask AI" everywhere: one shared context-menu section used by every right-click menu and the viewport (stone, part, feature-tree row, render, reference, piece card): quick intents for the thing clicked (Replace stone…, Change metal…, Make it bigger/smaller…), then a free-text "Ask AI about this" that opens the assistant composer anchored at the click with the clicked thing as a context chip. How the same request made in the general assistant resolves "this stone" (selection context, or it asks by pointing with viewport.select). Keyboard access and what the menu shows when the assistant is unavailable (the deterministic intents still work).
6. A test matrix the builder must turn green: every centre-stone template × every cut × three sizes; rows; undo restores the exact design; hand overrides survive.
Do not edit code. Return the path of the plan and a 10-line summary of the rules.`, { label: 'plan:targeted-edits', phase: 'Test' })

const tested = await parallel(TESTERS.map(t => () =>
  agent(`${CTX}\nYou are an adversarial tester. Your key is "${t.key}". Do not edit repository files; write scripts under ${S}/engine-pass/${t.key}/. Try to break the engine; every finding needs a repro script and evidence.\n\n${t.prompt}`,
    { label: `test:${t.key}`, phase: 'Test', schema: FINDINGS })
    .then(r => r && { key: t.key, ...r })))
const plan = await planP

let open = tested.filter(Boolean).flatMap(r => r.findings.map(f => ({ ...f, from: r.key })))
const rounds = [{ round: 0, summaries: tested.filter(Boolean).map(r => ({ key: r.key, summary: r.summary })), count: open.length }]
log(`Test round found ${open.length} findings (${open.filter(f => f.severity !== 'minor').length} blocker/major)`)

const fixPrompt = (owner, list, round) => `${CTX}
You are the owner of the "${owner}" area. You may edit: ${OWNERS[owner].files}. If a fix truly needs a line outside your files, make the smallest edit and list it in your report.
${owner === 'stones' && round === 1 ? `
FIRST build stone replacement from the plan at docs/plans/targeted-edits.md (planner's summary: ${plan}). That means: make the kernel derive the mount from the stone wherever the plan says so (so changing gem.cut or size alone already yields a correct setting, halo and seat), write the pure intent in packages/schema/src/design/intents.ts with tests, add the design.replaceStone command to the registry and its server handler (dry run + apply), and turn the plan's test matrix green as a vitest suite (every centre-stone template × every cut × three sizes at draft, a sample at production; undo restores the exact design; hand overrides survive). Render the matrix to ${S}/engine-pass/fix-stones/ and look at it.` : ''}
Then fix these findings from independent testers. For each: reproduce it first (run its repro); if it does not reproduce say so with evidence; fix the cause, not the symptom; add a regression test next to the code. Blockers and majors first; do all minors you can.
Findings (JSON):
${JSON.stringify(list, null, 1)}

When done run: the vitest files of your area, \`pnpm -s typecheck\`, and biome on your files. Return a report: per finding fixed / not reproduced / deferred (with why), files touched outside your list, test and typecheck results, and what remains weak. Screenshots under ${S}/engine-pass/fix-${owner}/.`

const verifyPrompt = (owner, list, fixReport, round) => `${CTX}
You are a fresh, sceptical verifier for the "${owner}" area (files: ${OWNERS[owner].files}), round ${round}. Do not edit repository files; scripts go under ${S}/engine-pass/verify-${owner}-${round}/.
An owner says they fixed the findings below. Their report:
${fixReport}

1. Re-run every finding's repro and decide: fixed, still broken, or fixed-but-regressed-something. Default to "still broken" when the evidence is unclear.
2. Hunt for regressions the fixes introduced: run the area's tests, rebuild every template at draft and production, render the ones this area affects and look at them.
${owner === 'stones' ? `3. Attack stone replacement (docs/plans/targeted-edits.md, design.replaceStone and the pure intent): every centre-stone template × every cut × sizes from 0.3 ct to 5 ct × ratios; one stone inside a row; hand-overridden prongs; a linked sourced stone; undo; the dry run equals the applied result. Render and judge like a setter: prongs on the girdle, V-tips on points, bezel and halo following the outline, seat cut, culet clear of the finger.` : ''}
Report only what is still wrong or newly wrong as findings (owner "${owner}" unless it clearly belongs elsewhere). An empty list means the area is clean.
Original findings (JSON):
${JSON.stringify(list, null, 1)}`

const MAX_ROUNDS = 3
for (let round = 1; round <= MAX_ROUNDS; round++) {
  const byOwner = OWNER_KEYS.map(o => ({ owner: o, list: open.filter(f => f.owner === o) }))
    .filter(g => g.list.length > 0 || (round === 1 && g.owner === 'stones'))
  if (!byOwner.length) break
  const results = await pipeline(
    byOwner,
    g => agent(fixPrompt(g.owner, g.list, round), { label: `fix:${g.owner}:${round}`, phase: 'Fix', model: OWNERS[g.owner].model, effort: 'high' }),
    (fixReport, g) => agent(verifyPrompt(g.owner, g.list, fixReport, round), { label: `verify:${g.owner}:${round}`, phase: 'Verify', schema: FINDINGS })
      .then(v => v && { owner: g.owner, fixReport, ...v }),
  )
  const ok = results.filter(Boolean)
  open = ok.flatMap(r => r.findings.map(f => ({ ...f, from: `verify:${r.owner}:${round}` })))
  rounds.push({ round, fixes: ok.map(r => ({ owner: r.owner, report: r.fixReport })), verify: ok.map(r => ({ owner: r.owner, summary: r.summary })), count: open.length, dropped: results.length - ok.length })
  log(`Round ${round}: ${open.length} findings still open (${open.filter(f => f.severity !== 'minor').length} blocker/major)`)
  if (!open.some(f => f.severity !== 'minor')) break
}
if (open.length) log(`Stopped with ${open.length} findings open; they are returned, not dropped`)
return { plan, rounds, open }
