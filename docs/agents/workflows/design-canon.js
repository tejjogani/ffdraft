export const meta = {
  name: 'design-canon',
  description: 'Research jewelry design canon (proportions, styles, critique), adversarially verify the numbers, then build @pave/canon and the reference-grounded design harness brief',
  phases: [
    { title: 'Research', detail: 'five parallel researchers: bridal, hip-hop/men, styles, design process, reference-grounded AI harness' },
    { title: 'Verify', detail: 'skeptics cross-check every numeric rule' },
    { title: 'Design', detail: 'the design-intelligence brief: canon model, retrieval, harness loop, evals' },
    { title: 'Build', detail: 'implement @pave/canon', model: 'opus' },
    { title: 'Review', detail: 'jeweler lens and engineering lens' },
    { title: 'Fix', detail: 'resolve confirmed findings', model: 'opus' },
  ],
}

const SCRATCH = '/tmp/claude-0/-home-user-ffdraft/24192795-28e0-5484-b947-9462017ba677/scratchpad'

const PRODUCT = `
"Pavé" is an open-source, AI-native jewelry design suite in the monorepo at /home/user/ffdraft (TypeScript 7, zod 4, pnpm workspaces; packages export TS source directly). A piece goes Ideate -> Spec -> CAD -> Render -> On model -> Sourcing -> Production, driven by people and by a Claude-powered assistant that edits a **parametric design document** through tools. The document is a flat tree of typed nodes defined in \`packages/schema/src/design/nodes.ts\` — ringShank (profile, widths, thicknesses, cathedral/split shoulders), gem (cut, width, length:width, placement), setting (prong/basket/bezel/halfBezel/flush; prong count, wire, tips, taper, rails), halo, gemRow (pavé/channel/shared-prong along a band, coverage, graduation), pave (automatic graded pavé over any surface, "ice level"), vectorBody (text/logo/shape extruded, bevel/pillow, border), meshBody (imported or AI-generated sculpt, flat back, hollow), relief, revolve, pipe, primitive, boolean, bail, chain (cable/curb/cuban/figaro/rope/box/tennis), finding, engraving, pattern, group — all in millimetres. Before CAD, the assistant agrees a small \`PieceSpec\` (\`packages/schema/src/design/spec.ts\`) with the designer and a recipe (\`packages/schema/src/recipes/index.ts\`: \`buildDesign\`, \`TEMPLATES\`) builds the first design. Reference data: \`packages/schema/src/domain/{gems,metals,sizes}.ts\`. The geometry kernel evaluates a design into solids, stones and a report (metal weight, carats, diagnostics): \`packages/kernel/src/types.ts\`. Existing research: \`docs/research/01-cad.md\` (feature inventory, spec parameters, some rules of thumb), \`02-production.md\` (manufacturability thresholds), \`06-freeform.md\` (hip-hop pendants, pavé), \`04-ideation-models.md\` (reference search, rights tiers). The assistant's build brief is \`docs/plans/assistant.md\`.

The founder's directive for THIS workstream: **"The key is coming up with really good designs and looking at the correct references — especially baked into our system prompts and harness."** The product spans simple wedding jewelry, bridal, fine/fashion, hip-hop "iced out" custom pieces, men's and signets, and one-off sculptural work. Generic model taste is not enough: the system must carry real jewelry-design knowledge (what makes each archetype look *right*, in numbers our parameters can express), must ground every design in the right references (the user's own references, similar past pieces, and a curated set of exemplars), and must critique its own output against them.
Today is 2026-11-23.`

const RESEARCH_RULES = `
Use WebSearch and web fetches where they work (this sandbox blocks many hosts and the search budget is shared — prioritise authoritative sources: GIA, jewelry trade education (Ganoksin/Orchid, Stuller, Rio Grande, bench-jeweler and CAD-for-jewelry tutorials, JCK/National Jeweler, MJSA), museum/auction house style guides (V&A, Met, Christie's/Sotheby's glossaries), respected jewelry-design textbooks, established custom jewelers' guides) and your own expert knowledge; mark anything you could not source as "(expert judgement)" and give a confidence (high/medium/low). Do NOT write any file in the repository; your return value IS the deliverable: dense markdown, ~1100–1600 words, with tables. Every rule must be **operational**: stated as numbers or ratios with a typical value and an acceptable range, tied to the exact schema parameter(s) it constrains (read \`packages/schema/src/design/nodes.ts\` and use its field names, e.g. \`ringShank.widthTop\`, \`setting.prongDiameter\`, \`halo.stoneWidth\`, \`pave.sizeMax\`, \`bail.opening\`), with the *reason* (why it looks or wears right) in a few words. Where taste varies, give the named variants (e.g. delicate / classic / bold) with their numbers rather than one average. Never describe designs by trademarked product names; describe the archetype generically.`

const TOPICS = [
  {
    key: 'bridal',
    prompt: `**Rings — bridal and classic fine jewelry.** The proportion and construction canon for: solitaire (by centre-stone shape and size: band width and thickness vs stone size, head height / culet clearance, prong count and wire by stone size and shape, claw vs round tips, peg vs cathedral vs basket, when a 6-prong reads better than 4, V-prongs on points), hidden halo and classic halo (melee size vs centre size, gap to centre, halo count, how the halo should sit relative to the girdle, double halos), three-stone (side-to-centre size ratios by shape pairing, height stepping, trapezoid/pear/baguette sides), pavé and micro-pavé bands (stone size vs band width, how far down the shank pavé should run for comfort and resizing, French/U-cut vs bead looks), eternity and half-eternity (stone size vs band width and thickness, counts by ring size), channel and bar settings, plain wedding bands (classic widths by wearer and style, thickness for durability, comfort fit), stacking sets (how an engagement ring and band should sit flush), east-west and bezel solitaires, toi-et-moi. Include: stone-shape-specific flattering proportions (length:width ratios by shape and hand), finger-coverage guidance (stone size vs ring size), metal-colour and stone-colour pairing, durability rules by gem hardness (which stones need bezels/protective settings), and the classic *mistakes* that make CAD rings look amateur (band too thick/thin, head too tall, prongs too heavy, halo too big, pavé too far, proportions that ignore the stone).`,
  },
  {
    key: 'hiphop',
    prompt: `**Hip-hop, custom and men's jewelry.** The canon for: custom pendants (logo / letter / name / character / photo / trophy-style sculptural): overall heights by tier and how they wear, thickness and depth layering (back plate, raised border, relief levels), border width vs pendant size, where polish vs pavé goes (iced field with polished rim, two-tone, enamel fills), pavé conventions (stone sizes by pendant size, honeycomb vs rows, flooded vs accent, baguette borders and accents, minimum stone counts that read as "iced"), bail proportions (size relative to pendant and chain; iced bails; hidden vs loop) and the pendant-to-chain pairing rules (chain width and length by pendant height and weight; which chain styles suit which pendants); chains: Cuban/Miami link widths and their looks (subtle → statement), tennis chain stone sizes, rope/Franco/Figaro conventions, lengths and how they layer; championship / statement rings and men's signets (face size vs finger size, shoulder taper, face thickness, engraving depth, stone-set faces), men's wedding bands (widths, profiles, finishes), stud earrings for men (sizes), bracelets (tennis, Cuban: wrist sizing and proportions); grillz only at a high level. Include target weights and stone counts/carat totals for typical builds so a design can be sanity-checked against expectations, colour conventions (yellow/white/rose/two-tone; VVS diamond vs moissanite vs CZ looks), and the mistakes that make an iced piece look cheap (stones too big or too sparse, inconsistent rows, weak borders, bail too small, pendant too thin, chain mismatched).`,
  },
  {
    key: 'styles',
    prompt: `**Style vocabularies and how to express them in our parameters.** For each of: Art Deco, Edwardian / Belle Époque, Victorian, Art Nouveau, Retro (1940s), mid-century modern, contemporary minimal / "quiet luxury", organic / sculptural, vintage-revival / heirloom, celestial / nature motifs, bold maximalist / cocktail, and (at a respectful, high level) major cultural traditions a global tool will be asked for (e.g. South Asian bridal: polki/kundan, temple jewelry; Middle Eastern; East Asian jade/pearl traditions): the defining silhouettes, motifs, stone cuts and combinations, metals and finishes, proportions and symmetry, typical pieces, and — crucially — **how to realise the look with our node kinds and parameter values** (which cuts, which settings, band profiles, milgrain/engraving substitutes, halos, step-cut sides, bezels, pipes/vines, patterns…), plus what our current kernel cannot express yet (so the assistant can say so honestly instead of faking it). Also: a pendant/earring/bracelet canon beyond rings — solitaire pendants (stone size vs chain weight and length), station necklaces, studs (sizes by look, settings, post length), hoops, drops, tennis bracelets (stone size vs wrist), bangles; standard lengths and where they sit on the body; ear/neck/wrist ergonomic limits (weight per earring, pendant thickness comfort).`,
  },
  {
    key: 'process',
    prompt: `**How professionals design and judge jewelry — turned into a critique rubric.** (1) Design principles as practised in jewelry: focal point and hierarchy, proportion and scale relative to the body, balance and symmetry, rhythm/repetition, negative space, line and flow, unity of metal/stone/finish, the role of profile and under-gallery views, wearability (snagging, height, comfort fit, weight), durability, and manufacturability as a design constraint; how a designer moves from brief → references → thumbnails/directions → refinement; how they read a reference image (what to measure/estimate: stone shape and size relative to finger/band, setting type, prong count, band taper, profile height, motif vocabulary, finish). (2) A concrete **design-read schema**: the structured facts to extract from a reference image or a past piece so two designs can be compared (archetype, silhouette, proportions as ratios, setting vocabulary, stone inventory, metal/finish, style tags, mood, distinctive details, what is NOT visible/uncertain). (3) A **critique rubric** with 8–12 scored criteria (each with what excellent / acceptable / poor looks like, observable from named camera views: top, front, side/profile, three-quarter, through-finger), and a list of the most common failure modes of AI/CAD-generated jewelry with how to detect each from views + parameters. (4) How to present directions to a client (2–3 distinct directions, what must differ between them, how to name and justify them briefly). (5) Briefing questions that actually matter (and which to never ask because a sensible default exists), per piece type.`,
  },
  {
    key: 'harness',
    prompt: `**Reference-grounded design agents — what works (2025–2026) and how to build ours.** Research current practice and evidence for making an LLM agent produce *good, grounded design work* rather than generic output: retrieval of exemplars / few-shot design libraries (how many, how to select — by archetype/style/embedding — and how to present them: structured specs + images), reference-image grounding with vision (having the model write a structured "design read" before designing; side-by-side comparison of its render against references; the known failure modes of VLM visual critique — sycophancy, missing fine geometric errors, miscounting — and mitigations such as targeted questions, crops/zooms, annotated views, numeric checks from structured data instead of pixels, independent critic context, rubric scoring with evidence), generate-critique-revise loops (how many iterations pay off, stopping rules, avoiding regression), proposing multiple distinct directions (diversity techniques), knowledge packaging in system prompts vs retrieved "skills" (prompt-caching-friendly layouts, progressive disclosure of domain rules, keeping tool schemas stable), evaluation of creative/design agents (golden briefs, rubric-based LLM judges with calibration against human preference, pairwise comparison/Elo, regression suites, using production traces — e.g. human corrections after agent edits — as signals), and relevant published systems for text/image-to-CAD with visual feedback (CAD codegen with render-and-critique, CADCodeVerify-style loops, 3D-aware VLM critics) plus design-domain analogues (UI/graphic/fashion design agents that use reference boards). Read \`docs/plans/assistant.md\` and \`packages/schema/src/api/commands.ts\` first so recommendations fit our run loop (tools from a command registry; a client tool that captures the CAD viewport from named angles; \`design.evaluate\` for numeric facts; boards of references with rights tiers; traces of every run and edit). End with a concrete proposed **loop** (steps, which artefacts are produced at each, what goes into context when, stopping rules, cost budget) and an **eval plan**.`,
  },
]

phase('Research')
const research = await parallel(
  TOPICS.map((t) => () =>
    agent(`You are a domain researcher for this product.\n${PRODUCT}\n\n## Your research question\n${t.prompt}\n\n${RESEARCH_RULES}`, {
      label: `research:${t.key}`,
      phase: 'Research',
    }),
  ),
)
const reports = TOPICS.map((t, i) => ({ key: t.key, text: research[i] })).filter((r) => r.text)
log(`${reports.length}/${TOPICS.length} research reports returned`)

const VERDICTS = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    corrections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          rule: { type: 'string' },
          verdict: { type: 'string', enum: ['wrong', 'too-narrow', 'too-wide', 'unsafe-to-manufacture', 'schema-mismatch', 'missing'] },
          correction: { type: 'string' },
          basis: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['rule', 'verdict', 'correction', 'basis', 'confidence'],
      },
    },
  },
  required: ['summary', 'corrections'],
}

phase('Verify')
const NUMERIC = reports.filter((r) => ['bridal', 'hiphop', 'styles'].includes(r.key))
const checks = await parallel(
  NUMERIC.flatMap((r) =>
    [
      'a master bench jeweler and setter who has cast and set thousands of pieces: would this be made this way, would it survive wear, are the numbers what the trade actually uses?',
      'a jewelry CAD lead checking against the product: does every rule map to a real parameter in packages/schema/src/design/nodes.ts within its declared min/max, does it agree with docs/research/01-cad.md, 02-production.md and 06-freeform.md (flag contradictions with the manufacturability minimums there), and is anything important for this category missing?',
    ].map((lens, i) => () =>
      agent(
        `${PRODUCT}\n\n## Your job: try to refute the numeric rules below\nA researcher produced this canon for the "${r.key}" category. It will be baked into an AI design assistant's prompts and used to lint designs, so a wrong number will be reproduced in every design. Review it as ${lens}\nCheck every stated number, ratio and range independently (use web sources where reachable and your own expertise; compute sanity checks — e.g. does the stated band width leave metal either side of the stated pavé stone size plus the minimum wall; does the stated prong wire scale sensibly from a 4 mm to a 10 mm stone; does a stated pendant thickness give a castable wall after pavé seats). Report ONLY rules that are wrong, too narrow, too wide, unsafe, mismatched to the schema, or important omissions — each with the corrected statement and your basis. If a rule is fine, do not mention it.\n\n${r.text}`,
        { label: `verify:${r.key}:${i ? 'cad' : 'bench'}`, phase: 'Verify', schema: VERDICTS },
      ).then((v) => ({ key: r.key, v })),
    ),
  ),
)
const corrections = checks.filter(Boolean).flatMap((c) => ((c.v && c.v.corrections) || []).map((x) => ({ category: c.key, ...x })))
log(`${corrections.length} corrections from verification`)

const researchText = reports.map((r) => `## Research: ${r.key}\n\n${r.text}`).join('\n\n---\n\n')
const correctionText = corrections.length
  ? corrections.map((c, i) => `${i + 1}. [${c.category}] (${c.verdict}, ${c.confidence}) ${c.rule}\n   → ${c.correction}\n   Basis: ${c.basis}`).join('\n')
  : '(none)'

phase('Design')
const brief = await agent(
  `${PRODUCT}\n\n## Your job: write the design-intelligence brief and the research record\nYou are the lead for making Pavé's assistant a genuinely good jewelry designer. Five researchers produced the canon and harness research below; skeptics then checked the numbers and produced corrections (apply them: where a correction conflicts with the research, prefer the correction when its confidence is high or it is a manufacturability issue; otherwise widen the range and note the disagreement).\n\nRead the repository first: \`packages/schema/src/**\` (nodes, spec, recipes/TEMPLATES, domain data, api/commands.ts, api/client-tools.ts if present), \`packages/kernel/src/types.ts\`, \`docs/plans/assistant.md\` (the assistant's run loop, prompt-as-composable-skills design, tools, traces), \`docs/plans/cad-workspace.md\`, \`docs/plans/ideate-and-freeform.md\`, \`docs/ARCHITECTURE.md\`.\n\nWrite exactly two files (the only files you may create or modify):\n\n**1. \`/home/user/ffdraft/docs/research/09-design-canon.md\`** — the consolidated, corrected canon as a reference document in the house style of the other docs/research files (tight, tables, sources and "(expert judgement)" marks kept; ~2,500–3,500 words): rings/bridal; pendants, chains and hip-hop; earrings/bracelets; men's and signets; style vocabularies; design principles, design-read schema and critique rubric; reference-grounded agent practice; ending with "Decisions for Pavé".\n\n**2. \`/home/user/ffdraft/docs/plans/design-intelligence.md\`** — the build brief (≤ ~1900 words) with these sections:\n1. **What "good" means here** — the product promise in a few lines.\n2. **\`@pave/canon\` package** (new, pure TS + zod, no I/O, usable in server and browser): the exact data model — \`Rule\` (id, applies-to predicate over archetype/kind/style, the schema path(s) it constrains, typical value and range possibly as a function of other parameters such as centre-stone width or ring size, variants delicate/classic/bold, rationale, source, confidence, severity), \`StyleGuide\` (id, vocabulary, parameter recipes, do/don't, what the kernel cannot express), \`Exemplar\` (an annotated, buildable design: a \`PieceSpecInput\` and/or node inputs that pass \`buildDesign\`/\`validateDesign\`, with style tags, a design read, and a short rationale of why it is good), \`DesignRead\` schema, \`Critique\` rubric schema; the functions — \`canonFor(query)\` (retrieve the relevant slice by piece kind / archetype / style tags / stone and size, sized for a prompt budget), \`suggestParameters(spec)\` (canon-derived defaults a recipe or the assistant can apply), \`lintDesign(design, evaluationSummary?)\` → aesthetic/proportion findings in the kernel \`Diagnostic\` shape with one-click \`fix\` ops where unambiguous, \`renderCanonForPrompt(slice)\` → compact text for the system prompt; target contents for v1 (how many rules / style guides / exemplars, covering which archetypes — be ambitious but concrete: list them). Say how recipes in \`packages/schema/src/recipes\` should consume \`suggestParameters\` without a dependency cycle.\n3. **The reference-grounded loop in the assistant harness** — the concrete steps the run loop enforces for design work (gather references: user attachments + board references respecting rights tiers + similar past pieces + canon exemplars → write a structured design read → propose 2–3 distinct directions with rationale and let the designer choose or blend → spec → build → evaluate numbers + lint → capture named views → critique against references and rubric with targeted questions → revise, with stopping rules and budget), exactly what is injected into context at each step and how prompt caching stays effective, which parts are prompt instructions vs enforced by code (gates), and the UI affordances (reference chips shown as "designing from these", a directions card, a critique card with before/after).\n4. **Contract additions** — any commands/entities/client tools needed (e.g. a design-read record on a piece, directions, critique results stored in traces), kept minimal and consistent with the registry.\n5. **Evaluation** — a golden-brief suite (list ~24 briefs across the product's range), the judge rubric, pairwise comparisons, numeric gates (lint-clean, manufacturable), how to run it without API keys (scripted model) and with them, and how production traces (human corrections after agent edits) feed back.\n6. **Build order** — independently verifiable milestones.\n\nThen reply with: the exact file/module layout and data model for \`@pave/canon\` (section 2 verbatim), followed by a ≤150-word summary of the harness loop.\n\n# Research\n${researchText}\n\n# Verification corrections\n${correctionText}`,
  { label: 'design:brief', phase: 'Design' },
)

const BUILD_COMMON = `${PRODUCT}\n\nRead first: \`docs/plans/design-intelligence.md\` (the build brief — section 2 defines your package) and \`docs/research/09-design-canon.md\` (the corrected canon: every rule, style guide and exemplar you encode must come from it; cite its section in a short comment or a \`source\` field), then \`packages/schema/src/**\` and \`packages/kernel/src/types.ts\`.\n\nGround rules: you own \`packages/canon/**\` only (package \`@pave/canon\`, \`"exports": {".": "./src/index.ts"}\`, depends on \`@pave/schema\` and on \`@pave/kernel\` for *types only*). Other agents are working concurrently elsewhere; do not touch other packages, do not run state-changing git commands, never delete node_modules or pnpm-lock.yaml; add deps with \`pnpm add --filter @pave/canon <dep>\` (retry after ~15 s if another install is running). Pure, isomorphic TypeScript (no Node-only APIs), strict types, no duplication with \`@pave/schema\` (import ids, ranges and helpers; never re-declare them), no dead code, comments only where they explain why. Deterministic.`

phase('Build')
const buildReport = await agent(
  `${BUILD_COMMON}\n\n## Your job: implement \`@pave/canon\`\nBuild the package exactly as the brief specifies: the typed data model; the full v1 contents (rules, style guides, exemplars) encoded from the research doc — this content is the product, so be thorough and precise, and write every rationale the way a master jeweler would explain it to an apprentice in one sentence; \`canonFor\`, \`suggestParameters\`, \`lintDesign\`, \`renderCanonForPrompt\`.\n\nAcceptance (write these as tests under \`packages/canon/src/**/*.test.ts\`):\n- every rule's constrained path exists in the node schema and its range lies within the schema's declared min/max (derive this from the zod/JSON Schema, do not hand-maintain);\n- every exemplar builds with \`buildDesign\`/\`designFrom\`, passes \`validateDesign\`, and is **lint-clean against the canon itself**; exemplars cover every archetype and style guide the brief lists;\n- \`suggestParameters\` applied to each template spec in \`TEMPLATES\` yields designs that are lint-clean, and deliberately bad designs (e.g. 3 mm melee halo on a 5 mm centre, 6 mm band under a 4 mm stone, 1.2 mm bail opening on an 8 mm chain, paper-thin iced pendant) each trigger the expected finding with a sensible \`fix\`;\n- \`canonFor\` returns a focused slice (the right rules, 2–4 exemplars, the style guide) for at least a dozen varied queries and stays within its size budget; \`renderCanonForPrompt\` output is stable (snapshot) and compact;\n- no rule contradicts a manufacturability minimum in docs/research/02-production.md.\nIf the geometry kernel is usable when you get there (\`createKernel()\` from \`@pave/kernel\`; it is still being completed), also evaluate every exemplar and render them to PNG with the throwaway viewer under ${SCRATCH}/kernel-view (if it exists) to LOOK at them — an exemplar that does not look like a good piece is a bug in the canon; save images to ${SCRATCH}/shots/canon/. If the kernel is not usable yet, say so.\n\`pnpm --filter @pave/canon typecheck\` and \`pnpm exec vitest run packages/canon\` must pass.\n\n## Final report (≤300 words)\nCounts (rules / style guides / exemplars by category), the public API, how recipes should consume it, anything in the brief you did not implement, whether exemplars were visually checked, known gaps.`,
  { label: 'build:canon', phase: 'Build', model: 'opus', effort: 'high' },
)

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

phase('Review')
const LENSES = [
  {
    key: 'jeweler',
    text: 'You are a master jeweler and design director. Read every rule, style guide and exemplar as content: is each number right and each rationale true; do the variants (delicate / classic / bold) actually produce those looks; are the exemplars genuinely good, distinct designs a client would pay for, and faithful to their style tags; what important knowledge for this product\'s range (wedding → hip-hop → sculptural) is missing or thin; would following this canon ever produce something unwearable, uncastable or ugly? Evaluate exemplars with the kernel and look at them if the kernel is usable (viewer under ' + SCRATCH + '/kernel-view if present). Compare against docs/research/09-design-canon.md and flag anything encoded differently from the research without reason.',
  },
  {
    key: 'engineering',
    text: 'You are a staff engineer. Run the tests and typecheck; read the code for: correctness of rule evaluation (functions of other parameters, units, variant handling, predicates), lint fixes that would produce invalid designs (apply every fix op through applyOps and re-lint), retrieval quality and prompt-budget behaviour of canonFor / renderCanonForPrompt (try 20 varied queries incl. unusual ones: "men\'s onyx signet", "iced-out trophy pendant on a Cuban", "Art Deco emerald three-stone", "minimal east-west oval bezel", "pearl drop earrings"), duplication with @pave/schema, purity/isomorphism, type design (can a contributor add a rule or exemplar safely — do the tests catch a bad one?), dependency cycles with packages/schema recipes, and determinism.',
  },
]
const reviews = (
  await parallel(
    LENSES.map((l) => () =>
      agent(
        `${BUILD_COMMON}\n\n## Your job: adversarial review of \`@pave/canon\` (lens: ${l.key})\nThe package was just implemented. Builder's report:\n\n${buildReport || '(none)'}\n\nDo not trust the report. You are READ-ONLY on the repository (scratch files only under ${SCRATCH}/review-canon-${l.key}/).\n\n${l.text}\n\nReport only real, evidenced problems with a concrete fix each. severity: blocker = would make the assistant produce wrong/unsafe designs or the package unusable; major = wrong content or behaviour, important gap; minor = worth fixing. If it is genuinely good, return few findings.`,
        { label: `review:${l.key}`, phase: 'Review', schema: FINDINGS },
      ),
    ),
  )
).filter(Boolean)
const findings = reviews.flatMap((r) => r.findings || [])
log(`${findings.length} review findings`)

let fix = 'No findings.'
if (findings.length) {
  phase('Fix')
  fix = await agent(
    `${BUILD_COMMON}\n\n## Your job: fix review findings in \`@pave/canon\`\nTwo reviewers (a master-jeweler lens and an engineering lens) found the problems below. For each: verify it first (if it is wrong, say so and explain rather than changing code); fix the root cause; add or extend a test; keep content faithful to docs/research/09-design-canon.md (if the research itself is wrong, correct the canon data, add a note in a \`source\`/comment, and list it in your report). Blockers and majors must be resolved; fix minors unless disproportionate. Finish with typecheck and tests green.\n\n${findings
      .map((f, i) => `${i + 1}. [${f.severity}] ${f.area}${f.file ? ` (${f.file})` : ''}: ${f.problem}\n   Evidence: ${f.evidence}\n   Suggested fix: ${f.fix}`)
      .join('\n')}\n\n## Final report (≤250 words)\nPer finding: fixed / rejected (why) / deferred (why); final counts; the public API as it now stands.`,
    { label: 'fix:canon', phase: 'Fix', model: 'opus', effort: 'high' },
  )
}

return { brief, corrections: corrections.length, buildReport, reviewSummaries: reviews.map((r) => r.summary), findings, fix }
