# Design intelligence: the canon, the reference-grounded loop, and how we know it works

Build brief. Numbers and evidence: [`research/09-design-canon.md`](../research/09-design-canon.md). Extends [`assistant.md`](./assistant.md) without changing its durability, approval or caching rules.

## 1. What "good" means here

- A first design a working jeweler would not re-proportion: every number sits in one named variant (delicate, classic, bold) of its archetype and passes the kernel.
- Every design is traceable to what it was designed from: the designer's references, similar past pieces, curated exemplars.
- The assistant offers real choices, checks its work against the references, and says plainly what Pavé cannot build.

## 2. `@pave/canon` package

New; pure TypeScript + zod; depends only on `@pave/schema`. No I/O, kernel or model calls, so it runs in server, browser and tests. Canon data is plain values that can be printed, hashed and diffed.

```
packages/canon/src/
  index.ts        public API; CANON_VERSION (content hash)
  model.ts        zod: Rule, StyleGuide, Exemplar, DesignRead, RubricCriterion, Critique, CanonSlice
  expr.ts         Expr, evalExpr(expr, facts), printExpr(expr)
  facts.ts        factsOf(spec | design, summary?) → Facts {W, lw, ID, H, T, Ø, e, depthPct, mohs, wearClass, alloyClass, …}
  query.ts        canonFor
  suggest.ts      suggestParameters, canonDefaults
  lint.ts         lintDesign
  read.ts         readDesign, diffReads, targetsFrom
  prompt.ts       renderCanonForPrompt, CANON_INDEX, UNIVERSAL_PRINCIPLES
  rubric.ts       RUBRIC (10 criteria), FAILURE_MODES, VIEW_SETS
  rules/          ring, halo, threeStone, rows, band, signet, stones, metals, pendant, iced, bailChain, chain, earring, bracelet
  styles/         one file per style guide
  exemplars/      one file per archetype
```

```ts
type Variant = 'delicate' | 'classic' | 'bold'
/** Serialisable formula over Facts: 0.3, or clamp(0.30·W, 1.8, 2.4). No closures. */
type Expr = number | { var: keyof Facts } | { op: 'add'|'sub'|'mul'|'div'|'min'|'max'|'clamp'|'snapMelee'|'asin'|'cos'|'gt'|'lt'|'and'|'or'; args: Expr[] }
type Band = { typical: Expr; min: Expr; max: Expr }

interface Rule {
  id: string                                   // 'ring.solitaire.bandWidth'
  title: string
  applies: { kinds?: PieceKind[]; archetypes?: Archetype[]; styles?: string[]; nodeKind?: NodeKind; when?: Expr }
  paths: string[]                              // schema paths constrained: 'ringShank.widthTop'
  measure?: string                             // a derived quantity instead: 'tableDrop', 'haloOutline', 'massPerEar'
  band: Band
  variants?: Partial<Record<Variant, Band>>
  lintAt?: { below?: Expr; above?: Expr }      // when the lint threshold is wider than the band
  rationale: string                            // ≤ 160 chars; printed in the prompt
  source: { tag: 'S' | 'R' | 'K' | 'D' | 'EJ'; ref?: string }
  confidence: 'high' | 'medium' | 'low'
  severity: 'warning' | 'info' | 'default'     // default = suggestion only; canon never emits errors
  fix?: 'clampToBand' | 'setTypical'           // only for single-path rules
  expressible?: false                          // a look the schema cannot build: a caveat, never a lint
}

interface StyleGuide {
  id: string; label: string; aliases: string[]            // matched against PieceSpec.style
  reads: string[]                                          // what makes it read right, ≤ 5 lines
  vocabulary: { motifs: string[]; cuts: GemCutId[]; metals: MetalId[]; finishes: FinishId[]; settings: string[] }
  recipes: { path: string; band: Band; note?: string }[]
  overrides?: { ruleId: string; band?: Band; severity?: Rule['severity'] }[]
  do: string[]; dont: string[]
  cannotExpress: { feature: string; fallback: string }[]
  source: Rule['source']; confidence: Rule['confidence']
}

interface Exemplar {
  id: string; title: string                                // generic names, never brands
  kind: PieceKind; archetype: Archetype; styles: string[]; variant: Variant
  build: { spec: PieceSpecInput; ops?: Op[] } | { kind: PieceKind; nodes: NodeInput[] }
  read: DesignRead                                         // produced by readDesign, checked in tests
  keyParams: Record<string, number | string>               // the subset shown on the prompt card
  why: string[]                                            // ≤ 3 lines
  antiTwin?: { ops: Op[]; fault: string }                  // one out-of-band change: the critic's bad anchor
  sizeKey: { W?: number; H?: number }
}

// DesignRead: the schema in research 09 §6, as zod.
interface RubricCriterion { id: CriterionId; views: View[]; judgedBy: 'numbers' | 'vision' | 'both'
  anchors: { 5: string; 3: string; 1: string }; questions: string[] }
interface Critique {
  canonVersion: string; pieceVersion: number; round: number
  scores: { criterion: CriterionId; score: 1 | 3 | 5; evidence: { view?: View; nodeId?: string; note: string } }[]
  total: number                                            // of 50
  findings: { id: string; severity: 'blocker' | 'major' | 'minor'; criterion: CriterionId; nodeId?: string
    param?: string; observed?: number; target?: [number, number]; suggestion: string }[]
  referenceDiff: { refId: string; field: string; target: unknown; actual: unknown; relErr?: number }[]
  verdict: 'accept' | 'revise' | 'ask'; questions: string[]; visionSkipped?: true
}
```

Functions:

```ts
canonFor(q: { kind?; archetype?; styles?: string[]; centre?: { cut; widthMm; stone }; ringSize?; heightMm?;
              variant?; budgetTokens?: number /* 1500 */; exemplars?: number /* 3 */ }): CanonSlice
// CanonSlice = { version, key, rules (bands evaluated where facts are known), styles, exemplars, caveats, failureModes, questions }
// Rules ranked by severity, confidence, specificity, cut to budget. Exemplars: exact archetype, cut family, size ±25 %, then MMR 0.7.
suggestParameters(spec: PieceSpecInput, o?: { variant?: Variant }): { values: Record<RecipeParam, number | string>; notes: { param; ruleId; why }[] }
lintDesign(design: Design, summary?: EvaluationSummary, o?: { spec?; intent?; waived?: string[] }): CanonFinding[]
// CanonFinding = kernel Diagnostic { level: 'warning' | 'info', code: `style.${ruleId}`, message, nodeId?, value?, limit?, fix? }
//                + { ruleId, param, band: [number, number], variant? }; `fix` only where one clamp resolves it
renderCanonForPrompt(slice: CanonSlice, o?: { format: 'pack' | 'index' }): string   // deterministic bytes
readDesign(design, summary?): DesignRead          // from the document, no vision
diffReads(target: DesignRead, actual: DesignRead): ReadDiff[]
targetsFrom(read: DesignRead, facts: Facts): { param: string; band: [number, number]; variant: Variant }[]
```

**v1 contents.**

- **About 150 rules:** solitaire 22; halo 10; three-stone 8; rows and eternity 14; plain and men's bands 10; signet and championship 9; bezel, east-west, toi-et-moi 6; stones and durability 8; metals, alloy modifier, unity 8; fine pendant and chain 10; iced pendant 18; bail and chain pairing 10; Cuban, tennis, rope 8; earrings 9; bracelets and bangles 5.
- **17 style guides:** Art Deco, Edwardian, Victorian, Art Nouveau, Retro, mid-century, minimal, organic, vintage-revival, celestial/nature, maximalist, iced-out, heritage signet, and South Asian-, temple-, Middle Eastern- and East Asian-inspired.
- **50 exemplars, each with an anti-twin:** solitaire 6, halo 4, three-stone 4, eternity 3, band 4, signet 4, solitaire pendant 3, name pendant 3, iced pendant 6 (micro initial, logo shield, two-level, sculpted character, cross, two-tone), medallion 2, studs 3, tennis 3, Cuban 2, custom 3 (hoops, toi-et-moi, vine ring).

**Recipes without a cycle.** `@pave/schema` gains `type RecipeDefaults = (spec: PieceSpec) => Partial<Record<RecipeParam, number | string>>` and `buildDesign(input, { defaults? })`. `RecipeParam` keys use the recipe's fixed node ids (`head.prongDiameter`, `center.elevation`, `halo.stoneWidth`, `row.skipCenter`, `ice.sizeMax`, `bail.opening`, …). A recipe calls it once (`const d = defaults?.(spec) ?? {}`) and each literal becomes `d[key] ?? builtin`; explicit spec fields still win. `@pave/canon` exports `canonDefaults: RecipeDefaults`, which `pieces.buildFromSpec`, `pieces.create` and the studio Quick start pass in. Schema never imports canon.

**Done means:** every exemplar and `TEMPLATES` entry built with `canonDefaults` is lint-clean and evaluates with zero kernel warnings (tested from the kernel side, so canon needs no kernel dependency); each anti-twin trips exactly its fault; prompt text is snapshot-tested.

## 3. The reference-grounded loop in the harness

A new skill, `prompt/skills/design.ts`, states the loop; `gate.ts` enforces its order for the agent only.

| # | Step | Enforced by code | Enters context |
|---|---|---|---|
| 0 | **Gather** ≤ 6 references: attachments, board references, 2 similar accepted past pieces (canon exemplars join in step 1) | Rights filter: `open`, `licensed`, `own` send pixels; `viewOnly` sends title, note, tags, palette | Labelled 768 px images in the user turn, never removed |
| 1 | **Design read** per reference (ratios, views seen, not visible) plus a synthesis: `pieces.setIntent` | Agent `pieces.buildFromSpec`, or `design.apply` on an empty design, fails `intent_required` without one | One appended `role:'system'` message: canon pack, 3 exemplar cards with thumbnails, targets table; re-sent only when `slice.key` changes |
| 2 | **Directions:** `pieces.proposeDirections`, 2–3 options; the turn ends | Server builds, evaluates and lints each; rejects pairs differing on fewer than 2 axes, changed fixed constraints, shared anchors | Facts and findings per direction |
| 3 | **Choose or blend:** `pieces.chooseDirection` | Agent may call it only after a later user message; a skip needs a reason code | — |
| 4 | **Spec and build:** `pieces.setSpec`, `pieces.buildFromSpec` (existing approval) | `canonDefaults` applied | Evaluation plus `style.*` findings, after every apply |
| 5 | **Numbers:** fix or waive each finding | `design.critique` fails `not_clean` on kernel errors or unwaived `style.*` warnings; a waiver cites a reference or the designer | Diagnostics only |
| 6 | **Look and critique:** `design.critique` | Handler captures `VIEW_SETS` in clay plus one view per reference angle, scores the number-judged criteria, makes one stateless critic call | `Critique` JSON and captures |
| 7 | **Revise:** one `design.apply` per round, labelled with finding ids | Cap 2 rounds (3 for `custom`). A new kernel error or lower total reverts the round and stops. Stop with no blocker or major left, a gain under 2 of 50, or human-edit overlap | Delta and verdict |
| 8 | **Report** | — | What matches each reference, what was left and why |

**Critic.** One request, no tools, a different model from the designer (`claude-opus-5-5`, effort set explicitly), answering by structured output (these models reject forced tool choice). It sees references, captures, the intent, targeted neutral questions and exemplar/anti-twin anchors, never the designer's reasoning, and never counts or measures. Without a critic service the handler returns the number-judged half with `visionSkipped`.

**Caching.** The tool list gains the new tools once. The core prompt gains the design skill, `UNIVERSAL_PRINCIPLES` and `CANON_INDEX`; its bytes depend only on `CANON_VERSION`, which joins `prompt_hash`. Everything per piece is appended after a user turn; nothing earlier is edited. After compaction `Piece.intent` is re-injected from the database. The critic caches its own prefix: prompt and anchors, then references and intent, then captures.

**Left to the prompt:** what to read in a reference, taste, which questions to ask, when a skip is honest. **Budget** (estimate): critique phase ≤ 6 model turns and ≤ $0.60, inside the existing 40-turn, $3 cap.

**UI.**

- *Reference chips*, headed "Designing from these": thumbnail, role, source (yours, past piece, Pavé exemplar); `viewOnly` shows a lock, "described, not shown". Removing one is a human `pieces.setIntent`. With none: "Designing from the canon only".
- *Design-read card*: ratios as sentences, a "couldn't see" list, editable.
- *Directions card*: 2–3 columns of identical clay views with an on-hand silhouette, a 2–4 word name, one sentence, grams · carats · height, one trade-off; Choose, Blend…, None of these.
- *Critique card*: a ten-criterion score strip; each finding has Show me, a before/after slider on the same view and Undo; Keep going / Good enough.

## 4. Contract additions

- **`Piece.intent: DesignIntent | null`**: `{ canonVersion, references: [{ source, id, role, rights, read | null }], synthesis: DesignRead, targets, directions: { proposedAtSeq, options: Direction[], chosen } | null, waivers: [{ ruleId, reason }], openQuestions }`. Separate from `PieceSpec` because it precedes the spec.
- **`Direction`**: `{ id, name, rationale, axes, anchor, spec, facts: { massG, carat, heightMm }, tradeOff, captureAssetIds }`.
- **Commands** (all `tool`): `canon.get` (query); `pieces.setIntent`; `pieces.proposeDirections`; `pieces.chooseDirection`; `pieces.similar { archetype?, styles?, text?, limit ≤ 5 }` → summaries with their `readDesign`; `design.critique { pieceId, round, focusNodeIds? }` → `Critique`, metered `llm`, stored as the step output in the trace. One model call, not a sub-agent.
- **`EvaluationSummary.diagnostics[]`** gains optional `value`, `limit`, `param`, `band`, `fix`; `design.evaluate` merges `lintDesign` findings; the kernel adds `measures: { nodeId, key, value }[]` (table and girdle Z, iced area, silhouette area).
- **`Run.canonVersion`**; **`Feedback.correction?: { param, agentValue, humanValue, ruleId? }`**; `Services.critic`.
- No new client tool: `design.critique` reuses the `viewport.capture` bridge, with `{azimuth, elevation}` views for back and under.

## 5. Evaluation

**Golden briefs (24)**, each with hard facts, target bands and two expert-built gold designs; eight carry reference images, two of them `viewOnly` only:

1 classic 1 ct solitaire, low; 2 dainty 0.3 ct oval on a thin band; 3 3 ct oval with a hidden halo (inexpressible); 4 cushion halo with pavé shoulders, from photos; 5 emerald three-stone with tapered baguettes (stand-in); 6 Art Deco sapphire-halo from a museum image; 7 east-west bezel emerald; 8 toi-et-moi; 9 full eternity, 2 mm; 10 flush-fit band for brief 1; 11 6 mm men's brushed band; 12 seal-engraved oval signet from an SVG; 13 flush-set gypsy signet; 14 bezel solitaire pendant; 15 script name pendant; 16 iced 32 mm initial on tennis; 17 70 mm two-tone logo on a 10 mm Cuban; 18 flooded character pendant from a photo; 19 iced cross on Figaro; 20 Cuban chain and bracelet; 21 3 mm tennis bracelet; 22 2 ct men's studs and huggies; 23 Art Nouveau vine ring with opal; 24 polki-inspired jhumkas.

| Layer | What | Bar |
|---|---|---|
| L0 code | Valid, zero kernel errors, lots, size and metal match the brief | ≥ 95 %, pass³ over 3 trials |
| L1 lint | Targets in band or waived with cause | ≥ 90 % |
| L2 pairwise judge | Rubric of research 09 §6; new vs previous `canonVersion`/`prompt_hash` and vs gold; same views, both orders, ties, Bradley–Terry | no worse than 45:55 |
| L3 human | Three jewelers, pairwise, monthly; a judge is trusted on a criterion at ≥ 80 % agreement | calibration |
| Harness | Step order, injection, append-only requests, critic cap, revert on regression | 100 % |

- **Without keys** (`pnpm canon:eval`, in CI): `scriptedModel` transcripts per brief against `testServer()` and the kernel prove the harness layer and L0–L1; a canon-only baseline builds each gold spec with `canonDefaults`.
- **With keys** (`--live`): L0–L2 with cost, after ablating exemplars (0/1/3/5), critic (none, in-context, independent), design read (on/off) and rounds (0–3).
- **Production traces** (where the organisation allows evaluation use): `corrected` feedback carries the parameter delta. A median correction above 10 % on a parameter (≥ 20 samples per archetype) opens a canon review; corrected runs become regression briefs; exported, uncorrected pieces become that organisation's exemplars.

## 6. Build order

1. **Canon core:** model, `Expr`, facts, ring rules, `lintDesign`, `suggestParameters`, the recipe `defaults` hook. Proof: templates build warning-free.
2. **Full v1 contents:** rules, styles, exemplars, anti-twins. Proof: exemplar and snapshot tests, token budgets.
3. **Contract:** intent, directions, summary fields, `style.*` in `design.evaluate`, HUD notes with Fix it. Proof: schema and server tests.
4. **Gates and injection:** design skill, `canon.get`, `pieces.similar`. Proof: scripted loop tests.
5. **Critique:** `design.critique`, critic service, critique card. Proof: scripted run, Playwright shots.
6. **Directions and reference chips.** Proof: Playwright shots, keyboard pass.
7. **Evaluation:** keyless suite in CI, live suite, ablations, trace aggregation.
