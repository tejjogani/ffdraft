export const meta = {
  name: 'reference-match',
  description: 'Research and design how Pavé gets the best CAD or sculpt from a photo of jewelry, then build and test the deterministic matching core',
  phases: [
    { title: 'Research', detail: 'state of the art and what the codebase already has' },
    { title: 'Design', detail: 'three independent approaches, then one synthesis' },
    { title: 'Build', detail: 'the deterministic core as @pave/match with a recover-the-parameters benchmark' },
    { title: 'Review', detail: 'adversarial review, then fix' },
  ],
}

const S = '/tmp/claude-0/-home-user-ffdraft/24192795-28e0-5484-b947-9462017ba677/scratchpad'
const CTX = `
You are working in the monorepo at /home/user/ffdraft (Pavé: open-source, AI-native jewelry design software). Read docs/ARCHITECTURE.md first.
The founder asks: "how can we also ensure the best sculpt / CAD given the image of the jewelry". Jewelry spans simple wedding rings, hip-hop pieces and unique sculpted ones ("a trophy to an iced-out pendant"); it must be very accessible to a jeweler who is not a CAD user. Earlier instruction: "The key is coming with really good designs and looking at the correct references especially baked into our system prompts and harness."
What exists: a parametric kernel (packages/kernel) evaluating a design document (packages/schema: nodes.ts, spec.ts PieceSpec, recipes/index.ts TEMPLATES/buildDesign), freeform bodies (vectorBody, meshBody, relief, pave), a design canon (packages/canon, docs/research/09-design-canon.md), a render layer (packages/render: resolveScene, assessRender), server services for vision, depth, mesh3d and image generation behind providers (apps/server/src/services.ts; no API keys are available in this environment, so live model calls cannot be tested), and plans in docs/plans (assistant.md, ideate-and-freeform.md) and research in docs/research (06-freeform.md covers image-to-3D).
Ground rules: scratch files only under ${S}/match/<your key>/. 4 cores and 15 GB are shared with other agents: one heavy process at a time, NODE_OPTIONS=--max-old-space-size=3072, leave nothing running. Other agents are editing packages/kernel, packages/schema, packages/canon, apps/server and apps/studio right now: READ them, do not edit them. Never touch /home/user/diaex-backend. Never commit or push. No model names or secrets in files. Mark every claim you could not verify as unverified.
`

phase('Research')
const [sota, inventory] = await parallel([
  () => agent(`${CTX}
Research the state of the art (as of late 2026) for turning one or a few photos of a piece of jewelry into (a) an editable parametric CAD model and (b) a faithful sculpted mesh. Use web search and fetch; many hosts are blocked here, so say what you could not reach. Cover, with sources and dates:
- vision-language models estimating structured parameters and counts from product photos (stone cut, count, setting style, proportions), their known failure modes (counting many small stones, scale, symmetric parts) and how to prompt/structure for reliability (structured outputs, crops, multiple passes, self-consistency);
- analysis-by-synthesis / render-and-compare: silhouette and edge losses, differentiable vs derivative-free fitting for a handful of parameters, camera pose from a single product shot, known-size anchors for scale (finger size, stone millimetre size, a coin);
- image-to-3D generators usable through an API or open weights (quality on thin, shiny, transparent objects; topology; licences; cost), multi-view generation, and mesh clean-up to a castable solid;
- segmentation and matting of metal vs stones, specular/transparent surfaces, depth estimation on jewelry;
- CAD program synthesis / sketch-to-CAD work, and anything jewelry-specific (commercial tools that claim image-to-CAD for jewelry and what they actually output);
- how to evaluate fidelity honestly (metrics, benchmarks, human review).
Return a dense, sourced brief (markdown) with a "what this means for Pavé" list.`, { label: 'research:state-of-the-art', phase: 'Research' }),
  () => agent(`${CTX}
Inventory what Pavé already has that an image-to-CAD loop can stand on, by reading the code (do not edit): PieceSpec and recipes, which parameters each archetype exposes and their ranges (field meta), freeform.analyze and the freeform plan, the vision/depth/mesh3d/imageGen service interfaces, the canon's rules and exemplars, viewport.capture and the render scene/camera model (packages/render), assessRender, MeshData and Evaluation types in the kernel, how a design is evaluated from Node, and how assistant tools are declared. Also list what is missing. Return a precise map with file paths and type names, and the exact function signatures a matching module would call.`, { label: 'research:codebase', phase: 'Research' }),
])

phase('Design')
const LENSES = [
  { key: 'parametric-first', brief: 'Read the photo into a PieceSpec with confidences, build from the recipe, then render-and-compare from the estimated camera and fit the continuous parameters; the sculpt path is the fallback for what no archetype explains.' },
  { key: 'sculpt-first', brief: 'Generate a mesh from the photo(s) first, then recognise stones, settings, bails and chains in it and replace them with parametric features, keeping only the truly freeform motif as a cleaned sculpted body.' },
  { key: 'designer-in-the-loop', brief: 'Optimise for a jeweler with one phone photo and no CAD skill: what is the least we must ask (a size anchor, a second angle), how to show confidence and differences side by side, and how the designer corrects the read in seconds; fidelity comes from fast correction, not from a perfect first guess.' },
]
const proposals = (await parallel(LENSES.map(l => () =>
  agent(`${CTX}
Propose how Pavé should get the best CAD or sculpt from an image of jewelry, from this angle: ${l.key} — ${l.brief}
Inputs you have:
<state_of_the_art>
${sota}
</state_of_the_art>
<codebase>
${inventory}
</codebase>
Write a concrete proposal (under 900 words): the pipeline step by step with what is deterministic code and what is a model call, how it decides parametric vs sculpt per part, how scale is established, how fidelity is measured and improved in a loop, how it fails safely and tells the designer what it is unsure about, what can be tested without any model (using renders of our own designs as ground truth), cost per image, and its three biggest risks.`, { label: `design:${l.key}`, phase: 'Design' })
    .then(p => p && { key: l.key, proposal: p })))).filter(Boolean)

const design = await agent(`${CTX}
You are the lead. Three independent proposals follow, plus the research. Judge them (score each on fidelity, reliability, accessibility, testability without models, cost), then write ONE design that takes the strongest spine and grafts the best ideas of the others.
<proposals>
${JSON.stringify(proposals, null, 1)}
</proposals>
<state_of_the_art>
${sota}
</state_of_the_art>
<codebase>
${inventory}
</codebase>
Write two files (plain language, lead with the answer, tables where they help):
1. docs/research/11-image-to-cad.md — the research brief with sources and dates, unverified claims marked.
2. docs/plans/reference-match.md — the build brief (under ~300 lines): the loop from photo(s) to a matched design; the read (structured, per-part, with confidence and crops; grounded in the canon); parametric vs sculpt decision per part and the hybrid (parametric stones and settings on a sculpted body); scale anchors; camera estimation; the comparison (silhouette, edges, stone positions and count, per-part scores) and the fitter (which parameters are free, bounds from field meta, when to stop); the designer's view (side-by-side overlay, difference heat, what the system is unsure of, one-tap corrections); the commands and assistant tools to add later (names, inputs, outputs — do not edit packages/schema now); the model providers and their fixtures; cost and metering; and the EVALUATION: a standing benchmark that renders our own templates with random parameters and cameras, then measures how well the loop recovers them, plus a small set of real photos for human review.
Then specify precisely the deterministic core to build now as a new package packages/match (@pave/match) that depends only on @pave/schema and @pave/kernel types and runs in Node and the browser: module list, function signatures, data types, the benchmark and its pass thresholds.
Return the two file paths, the scores, and the full specification of packages/match as text.`, { label: 'design:synthesis', phase: 'Design' })

phase('Build')
const build = await agent(`${CTX}
Build the deterministic matching core as a NEW package packages/match (@pave/match), following this specification and docs/plans/reference-match.md:
<specification>
${design}
</specification>
Follow the conventions of the other packages (look at packages/sourcing or packages/production for package.json, tsconfig, exports of TypeScript source, vitest tests beside the code, biome). You may add the package to the workspace; do not edit any other package (if you need something from the kernel or schema that is not exported, work around it and list it in your report).
It must contain, at minimum, in pure TypeScript on typed arrays (no DOM, no native modules):
- a small software rasteriser for kernel output (parts and instanced stones → silhouette mask, part-id map and depth) under a pinhole camera;
- the camera model, and pose estimation that fits a camera to a target silhouette given an approximate design;
- image comparison: IoU, symmetric edge (chamfer) distance, per-part scores, stone count and position agreement;
- a bounded derivative-free fitter over a declared list of free parameters (node id + field path + bounds read from the schema's field meta), which applies candidates as ordinary ops and evaluates through a kernel passed in;
- the interface for the model-backed "read" step with a fixture implementation, so the whole loop runs without any model;
- the benchmark: for a set of templates, sample random parameters and a random camera (seeded), render the target mask with the rasteriser from the TRUE design, add realistic corruption (blur, a few pixels of mask noise, small crop offsets), start from the template defaults and a perturbed camera, run the loop, and report parameter error (mm and %), IoU before/after and time. A CLI script prints the table. Record the numbers you actually get; do not tune the benchmark to flatter the result.
Tests first, each failing for the right reason before the code. Keep evaluations cheap (draft detail, small images) — the machine is shared. Save a few overlay PNGs (target vs fitted) under ${S}/match/build/ and look at them.
Return a report: what exists, the benchmark table, test and typecheck results, what is weak, what you needed from other packages.`, { label: 'build:match', phase: 'Build', model: 'opus', effort: 'high' })

phase('Review')
const FINDINGS = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    findings: { type: 'array', items: { type: 'object', properties: {
      severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
      area: { type: 'string' }, file: { type: 'string' }, problem: { type: 'string' },
      evidence: { type: 'string' }, fix: { type: 'string' },
    }, required: ['severity', 'area', 'problem', 'evidence', 'fix'] } },
  },
  required: ['summary', 'findings'],
}
const review = await agent(`${CTX}
Adversarially review the new package packages/match against docs/plans/reference-match.md. The builder's report:
${build}
Do not edit repository files; scripts under ${S}/match/review/. Check, by running things:
- the rasteriser against ground truth (project known shapes analytically; compare with a real render of the same design if one is cheap to make);
- that the benchmark is honest: targets are made from the true design and never leak the true parameters to the fitter; corruption is realistic; seeds are fixed; reported numbers reproduce;
- recovery on cases the builder did not pick: other templates, larger perturbations, a camera 40° off, symmetric ambiguities (a round solitaire looks the same at every spin), parameters that barely change the silhouette (say so rather than pretend to recover them);
- failure behaviour: empty mask, target of a different archetype, a fit that gets worse, time and evaluation budgets respected;
- code quality: no duplication of kernel/schema helpers, pure functions, typed arrays freed, runs in the browser (no Node-only APIs), tests meaningful.
Return findings, most severe first.`, { label: 'review:match', phase: 'Review', schema: FINDINGS })

let fix = null
if (review && review.findings.length) {
  fix = await agent(`${CTX}
You own packages/match. This fix is part of work the founder asked for earlier in this session ("how can we also ensure the best sculpt / CAD given the image of the jewelry") and it is authorised: the lead engineer running this workflow has already answered the founder's later, unrelated messages (the README and installer are done and are not your task). Do the task below in full. An independent reviewer found the problems below. Reproduce each, fix the cause, add a regression test, re-run the benchmark and report the new table honestly (if a parameter cannot be recovered from a silhouette, the benchmark should say "not observable" rather than hide it). Run the package's tests, \`pnpm -s typecheck\` and biome on your files.
Findings (JSON):
${JSON.stringify(review.findings, null, 1)}
Return: per finding fixed / not reproduced / deferred with why, the benchmark table, and test results.`, { label: 'fix:match', phase: 'Review', model: 'opus', effort: 'high' })
}
return { design, build, reviewSummary: review && review.summary, findings: review ? review.findings : [], fix }
