export const meta = {
  name: 'kernel-wave-2',
  description: 'Build the freeform/pavé and assembly/export halves of the geometry kernel on the stable core, each adversarially reviewed and fixed',
  phases: [
    { title: 'Implement', detail: 'one Opus 5.5 high agent per work package', model: 'opus' },
    { title: 'Review', detail: 'adversarial review: run it, break it, look at the geometry' },
    { title: 'Fix', detail: 'address confirmed findings and re-verify', model: 'opus' },
  ],
}

const SHOTS = '/tmp/claude-0/-home-user-ffdraft/24192795-28e0-5484-b947-9462017ba677/scratchpad'

const COMMON = `
You are working on the **geometry kernel** (\`packages/kernel\`, package \`@pave/kernel\`) of "Pavé", an open-source, AI-native jewelry CAD suite. The kernel is a pure function: a parametric design document in → solids, stones and facts out. Monorepo: /home/user/ffdraft (pnpm 10 workspaces, Node 22, TypeScript 7, zod 4, vitest 5, biome 2); internal packages export TS source directly, no build step. Must run in Node AND in a browser Worker (Vite), on macOS, Windows and Linux: resolve assets via import.meta.url, no native deps, no cwd-relative or POSIX-built paths, no Node-only APIs in code that runs in the Worker.

## Read first
- \`packages/kernel/src/core.ts\` — the internal builder contract (read the whole header: FeatureOutput with bodies / stones / cuts / additions / frames / data / consumes; the Solid abstraction — exact OpenCascade B-rep or Manifold mesh; ownership and disposal rules; purity rules for caching; draft vs production detail; how to register a feature in \`src/features/index.ts\` and an exporter in \`src/export/index.ts\`). Study \`src/features/primitive.ts\` and any other feature already present as examples, and the helpers in \`src/solid/*\`, \`src/geometry/*\`, \`src/evaluate/*\`, \`src/gems/*\`, \`src/text.ts\` (some of these are still landing — the core author is concurrently writing the parametric features: ringShank, gem, setting, halo, gemRow, revolve, pipe, primitive, boolean, bail, engraving; check what exists before writing a helper, and reuse rather than duplicate).
- \`packages/kernel/src/types.ts\` — the public contract (Evaluation, Part, StoneInstance, Report, Diagnostic, Kernel.export / ExportResult).
- \`packages/schema/src/design/nodes.ts\` — the node kinds you implement, with every parameter, range, default and description, and the space conventions (mm, right-handed, Z up; a ring is centred on the origin with the finger along Y and the head at +Z; flat pieces stand in the XZ plane and face −Y). \`packages/schema/src/domain/*\` (gems incl. MELEE_SIZES_MM / snapToMelee / gemCarat, metals), \`packages/schema/src/recipes/index.ts\` (TEMPLATES / buildDesign — acceptance fixtures).
- Research: \`docs/research/06-freeform.md\`, \`docs/research/01-cad.md\`, \`docs/research/02-production.md\` (the sections relevant to your package).

## Ground rules
- Several agents are writing in \`packages/kernel\` at the same time. Only create/modify the files your package owns (listed below). The two shared registries (\`src/features/index.ts\`, \`src/export/index.ts\`) may be edited ONLY by adding your own import + registration lines: re-read the file immediately before each edit and change nothing else. If you need something from the core that does not exist, first look again (it may have landed), then add it in your own files in a way the core could adopt, and say so in your report. Do not touch other packages except where stated.
- Do not run state-changing git commands (no add/commit/stash/checkout/reset). Never delete node_modules or pnpm-lock.yaml. Add deps with \`pnpm add --filter @pave/kernel <dep>\` (pure JS/WASM only); if pnpm fails because another install is in progress, wait ~15 s and retry.
- Typecheck with \`pnpm --filter @pave/kernel typecheck\` and test with \`pnpm exec vitest run packages/kernel/src/<your paths>\`. Because others are mid-edit, errors may appear in files you do not own: do not fix those, note them, and make sure your own files are clean.
- **Look at your geometry.** Numbers do not catch a bail floating beside a pendant. There may already be a throwaway viewer at ${SHOTS}/kernel-view (three.js + the preinstalled Playwright Chromium: \`require('playwright')\`, \`chromium.launch()\`; never run \`playwright install\`); reuse it if it exists, otherwise write your own under ${SHOTS}/ (outside the repo). Render evaluations (metals shaded, gems flat-shaded and translucent, feature edges) from front / side / top / three-quarter, inspect them as a jeweler would, and fix what is wrong.
- Quality bar: production code for an open-source product — small focused modules, one helper per concept, no duplication, no dead code, comments only where they explain *why* (cite the research section or rule of thumb behind non-obvious numbers), strict TS with narrow wrappers at WASM boundaries, deterministic output for identical input (seeded, no Math.random / Date).
`

const PACKAGES = [
  {
    key: 'freeform',
    owns: '`src/features/{vectorBody,meshBody,relief,pave}.ts`, `src/mesh/**`, bundled built-in models under `src/builtin/**`, and their tests',
    shots: `${SHOTS}/shots/kernel-freeform/`,
    task: `## Your package: freeform bodies and automatic pavé — "anything can become jewelry"
The founder's test case is *a photo of a trophy becomes an iced-out pendant*. Your features are what make that possible for someone who has never used CAD.

1. **\`src/mesh/**\`** — the mesh toolbox on Manifold (\`manifold-3d\`, incl. its CrossSection 2D offsets) plus a BVH where needed: parse STL (binary + ASCII), OBJ, PLY, GLB and 3MF bytes into indexed triangles; weld; orient; repair to a watertight manifold (and when an input cannot be made manifold by welding/filling, fall back to a robust re-surfacing — e.g. a winding-number or ray-parity signed-distance field into \`Manifold.levelSet\` — and say so with an \`info\` diagnostic; if even that fails, throw an actionable error); simplify to a detail ratio; smooth; scale-to-height; plane cut (flat back); shell/hollow to a wall thickness with a drain hole per the production research; surface sampling utilities with normals, a geodesic-enough neighbourhood structure, boundary-distance and local-thickness/curvature estimates. Keep each concern in its own module with tests on synthetic meshes.
2. **\`meshBody\`** — source \`asset\` (bytes via \`ctx\` asset resolver; format sniffed from content) or \`builtin\`. Built-ins are generated procedurally and must look *good*, not like placeholders: a classic two-handled trophy cup on a stepped base is mandatory; add the others listed in the schema only if you can make them genuinely convincing — otherwise change the schema's built-in list (\`packages/schema/src/design/nodes.ts\`, MeshBody.source builtin names, and the icedPendant recipe if needed) to the set you ship, keeping \`pnpm exec vitest run packages/schema\` green. Honour height, flatBack, hollow, smooth, detail.
3. **\`vectorBody\`** — text (via the core's \`src/text.ts\` font registry if present; if it has not landed yet, coordinate by reading the file again later — do not write a second font loader), SVG path data (full path grammar incl. arcs, relative commands, multiple subpaths with holes, even-odd/non-zero), and the named shapes, scaled so the outline's overall height equals \`height\`; standing in the XZ plane facing −Y with \`thickness\` along Y. Edge treatments: flat, chamfer, round, and **pillow** (the whole face inflated into a soft dome using the distance to the outline — the puffy look of name plates and hip-hop letters). \`border\` adds a raised polished rim framing an inner field (the frame for a pavé field) and must publish the inner field as the region pavé should cover (via \`data\`), so "border + pavé" gives a polished edge with an iced centre. Script fonts and multi-glyph text must come out as ONE connected, castable body (union overlapping glyphs; warn if glyphs are disconnected).
4. **\`relief\`** — a coin / medallion / signet face: outline (round, oval, cushion, rect, shield), base thickness, rim, and a height field from an image asset (decode PNG/JPEG without the DOM so it works in Node and the Worker; luminance → height, smoothed, \`invert\`), or an elegant built-in pattern when no asset is given. Watertight, with clean walls.
5. **\`pave\`** — the differentiator: automatically "ice out" a region of ANY body. Implement the algorithm from \`docs/research/06-freeform.md\` §5 and its Decisions: region selection (\`all\`, or \`facing\` a direction within a max angle; and the inner field published by a bordered vectorBody when present); packing of round stones on the surface with sizes graded from \`sizeMax\` down to \`sizeMin\`, snapped to stock melee sizes (\`MELEE_SIZES_MM\`), honouring \`gap\`, \`margin\` from region boundaries and sharp edges, curvature caps (stone ≤ R/3 convex, ≤ R/5 concave) and a local-thickness cap so seats never break through; \`coverage\` ("ice level") scales how much of the region is filled, largest stones first; deterministic from \`seed\`; honeycomb-like regularity on flat fields (people notice messy rows), graceful adaptation on curved ones; each stone oriented along the smoothed surface normal with its girdle just below the surface. Output stones (role melee, setting pave), seat \`cuts\` (only applied at production detail, batched), and bead \`additions\` when \`beads\` is on (shared beads between neighbours, \`afterCuts\`). Must stay fast: layout for ~2,000 stones in roughly a second or two on this machine at draft, 5,000 without falling over; report your measurements. Emit warnings (not failures) when the requested size range cannot fit the region.

## Acceptance
- The \`name-pendant\`, \`iced-initial\` and \`iced-trophy\` templates evaluate at draft and production with your nodes building (other agents' kinds — bail, chain — may still be \`feature.unsupported\`; that is fine).
- Automated checks: every body you produce is a closed manifold with positive volume across parameter ranges (min / default / max + a seeded fuzz); pavé stones never overlap (pairwise centre distance ≥ sum of radii + gap − ε), stay inside the region and the margin, are all stock sizes within [sizeMin, sizeMax]; production volume < draft volume when seats are cut; identical input → identical output.
- Screenshots of: the three templates, a script name, a bordered block letter with an iced field, the trophy at ice levels 0.3 / 0.6 / 1.0, a relief medallion, an imported non-manifold mesh after repair — saved to the shots directory.`,
  },
  {
    key: 'assembly',
    owns: '`src/features/{chain,finding,pattern,group}.ts`, `src/export/{stl,obj,threemf,step,rhino3dm}.ts`, `src/dfm/**`, and their tests',
    shots: `${SHOTS}/shots/kernel-assembly/`,
    task: `## Your package: assembly features, file exports and kernel-level manufacturability checks

1. **\`chain\`** — every style in the schema, each recognisable at a glance and proportioned from \`linkWidth\` / \`wire\`: cable (alternating oval links), curb and **Cuban / Miami** (twisted, flattened, tightly nested links — the hip-hop staple; get the diamond-cut flat faces and the nesting right), figaro (3 short + 1 long), rope (two-strand twist of links), box, and **tennis** (a line of set stones in four-prong or basket links, using the node's cut/stone; emit the stones so they are counted in the report). Link count follows from \`length\`; layouts: \`straight\`, and \`drape\` — a necklace hanging in the XZ plane as a smooth closed drape whose low point passes through the bail's \`opening\` frame when \`through\` is set (read the bail feature's published frames/data; if the bail feature has not landed yet, code against the frame name documented in core.ts and re-check before you finish). Hundreds of links must stay cheap: build one link once and instance transformed copies; return the chain as few bodies as the core allows (see how \`Solid.transformed\` and composing meshes work) and keep draft triangle counts low. Links must interlock without intersecting.
2. **\`finding\`** — earring post (with the friction notch) placed on the back-centre of its host, butterfly back, jump ring, a simplified but recognisable lobster clasp. **\`pattern\`** — polar / linear / mirror copies of the sources' bodies *and* stones (mirrored copies must keep outward-facing triangles and correct stone orientation); the sources themselves stay. **\`group\`** — organisational; applies its transform to its children as a unit, following whatever the core's consumes/transform rules require.
3. **Exports** (\`Kernel.export\` → \`ExportResult\` with bytes, mime, extension and honest \`notes\`), registered in \`src/export/index.ts\`:
   - **STL** (binary): what a caster prints. Production detail; parts of the same metal fused into watertight, manifold shells; stones excluded by default (or included as separate reference geometry when asked); honour \`only\`.
   - **3MF** (zip via \`fflate\`): one object per part with names and base-material colours; units millimetre.
   - **OBJ** (+ groups per part).
   - **STEP** (AP214/AP242 via replicad/OpenCascade): every *exact* body as a named solid in one assembly, coloured by metal; mesh bodies cannot be exact — omit them and say so in \`notes\`; stones optionally as planar-faced solids (see \`docs/research/01-cad.md\`).
   - **3DM** via \`rhino3dm\` (WASM, loaded lazily the same cross-platform way the core loads its other WASM): layers per metal and for stones, named mesh objects with user strings (node id, alloy, finish, carat…), feature curves where cheap, document units mm; \`notes\` must state plainly that 3DM carries meshes and curves and that STEP is the exact B-rep route (research §5).
   - GLB already exists (\`src/export/glb.ts\`, owned by another agent) — make sure the \`glb\` format is wired, do not rewrite it.
   Round-trip tests for each format (parse back what you wrote: triangle counts, manifoldness, names, units, bounding boxes; read the .3dm back with rhino3dm; check the STEP header and entity counts and re-import it with OpenCascade to compare volumes).
4. **\`src/dfm/**\`** — manufacturability diagnostics that need the kernel's exact solids, cutters and frames (the core exposes them through the \`Scene\` — see \`evaluate/evaluate.ts\`), using the thresholds in \`docs/research/02-production.md\` and \`01-cad.md\` as a typed, overridable profile: seat cutters or engraving breaking through a wall; stones intersecting metal they should not, or each other; unsupported/disconnected metal (a body that is not fused to the rest of its casting group); bail opening smaller than the chain passing through it (+1.5 mm rule); prong/bead/bezel/wire sizes below minimum from node parameters; watertightness and triangle-count/envelope limits of the fused production bodies. NOTE: generic mesh wall-thickness analysis lives in \`@pave/production\` (another agent) — do not duplicate it here. Wire the checks into production-detail evaluation the way the core expects diagnostics to be reported.

## Acceptance
- The \`cuban\`, \`tennis\`, \`studs\`, \`pendant-solitaire\`, \`name-pendant\` and \`iced-trophy\` templates evaluate with your kinds building (kinds owned by others may still be \`feature.unsupported\` while they land).
- Every export format round-trips for a solitaire ring and for a design containing a mesh body.
- Screenshots of each chain style (straight close-up and draped through a bail), the studs pair, a polar pattern, saved to the shots directory; and open your own exported GLB/STL back into the viewer to confirm they look identical to the evaluation.`,
  },
]

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

const REPORT = `\n## Final report (≤300 words)\nWhat exists; what each feature/format supports and any schema parameter not honoured; measured performance; where the screenshots are and your honest assessment of the geometry; anything you added outside your files or changed in the schema; known gaps.`

const results = await pipeline(
  PACKAGES,
  (p) =>
    agent(`${COMMON}\n## You own\n${p.owns}. Screenshots go to ${p.shots}\n\n${p.task}${REPORT}`, {
      label: `implement:${p.key}`,
      phase: 'Implement',
      model: 'opus',
      effort: 'high',
    }),
  (report, p) =>
    agent(
      `${COMMON}\n## Your job: adversarial review of the "${p.key}" package\nAnother agent just implemented this package (it owns ${p.owns}). Its brief was:\n\n${p.task}\n\nIts own report:\n\n${report || '(no report returned)'}\n\nDo not trust the report. You are READ-ONLY on the repository (you may write scratch files only under ${SHOTS}/review-${p.key}/). Establish the truth yourself:\n1. Run the package's tests and the typecheck; read the code for correctness, numerical robustness, ownership/disposal mistakes against the core contract, purity violations that would poison the cache, duplication of helpers that already exist in the core, cross-platform problems (paths, Node-only APIs in Worker code), non-determinism, and performance cliffs.\n2. Try to break it with adversarial inputs through the public kernel API: parameter extremes and combinations the schema allows, degenerate geometry, very large counts, weird-but-valid SVG paths / malformed meshes (for freeform), every chain style at extreme widths and lengths / exports of awkward designs (for assembly).\n3. LOOK at the output: render evaluations to PNG (reuse the viewer under ${SHOTS}/kernel-view if present) and judge them as a jeweler and a caster would — is it recognisably the right object, proportioned plausibly, connected where it must be, free of intersections and floating parts, would it cast? Also check the acceptance criteria one by one.\nReport only real, evidenced problems (each with how you observed it and a concrete fix); severity blocker = wrong geometry / crash / data loss / unusable performance, major = clearly wrong behaviour or acceptance criterion unmet, minor = quality issue worth fixing. No style nitpicks. If it is genuinely good, say so and return few findings.`,
      { label: `review:${p.key}`, phase: 'Review', schema: FINDINGS },
    ).then((review) => ({ report, review })),
  (prev, p) => {
    const findings = (prev && prev.review && prev.review.findings) || []
    if (!findings.length) return { ...prev, fix: 'No findings to fix.' }
    return agent(
      `${COMMON}\n## You own\n${p.owns}. Screenshots go to ${p.shots}\n\n## Your job: fix review findings in the "${p.key}" package\nThe package was implemented against this brief:\n\n${p.task}\n\nAn adversarial reviewer found the problems below. For each: reproduce it first (if you cannot reproduce it, say so and explain rather than changing code), fix the root cause in the simplest way that keeps the code clean (no special-case patches where a general fix exists), add or extend a test that would have caught it, and re-render screenshots for anything visual. Blockers and majors must be resolved; fix minors unless a fix would be disproportionate (then say why). Finish with the full package tests and typecheck passing for your files.\n\n${findings
        .map((f, i) => `${i + 1}. [${f.severity}] ${f.area}${f.file ? ` (${f.file})` : ''}: ${f.problem}\n   Evidence: ${f.evidence}\n   Suggested fix: ${f.fix}`)
        .join('\n')}\n\n## Final report (≤250 words)\nPer finding: fixed / not reproduced / deferred (why). Then the current state of the package and any remaining gaps.`,
      { label: `fix:${p.key}`, phase: 'Fix', model: 'opus', effort: 'high' },
    ).then((fix) => ({ ...prev, fix }))
  },
)

return PACKAGES.map((p, i) => ({
  key: p.key,
  report: results[i] && results[i].report,
  reviewSummary: results[i] && results[i].review && results[i].review.summary,
  findings: results[i] && results[i].review && results[i].review.findings,
  fix: results[i] && results[i].fix,
}))
