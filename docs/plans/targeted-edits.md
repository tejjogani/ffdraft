# Targeted edits: replace a stone and keep the mount; "Ask AI" on every right-click

Build brief. Extends [`cad-workspace.md`](./cad-workspace.md) and [`assistant.md`](./assistant.md); changes none of their sync, undo, approval or caching rules.

A targeted edit is one sentence a jeweler would say at the bench ("make the centre a 2 ct oval", "all the melee in sapphire", "rose gold instead") turned into ordinary ops by a **pure, deterministic function**. A person clicks it; the assistant calls the same function as a tool. The model never improvises the ops.

## 0. What the engine does today (measured)

Probe: every template with a centre stone (`solitaire`, `oval-pave`, `halo`, `three-stone`, `pendant-solitaire`, `studs`) × all 13 cuts × 0.5 / 1.5 / 4 ct, as a plain `update` of the gem's `cut` and `width`, evaluated at draft and eight cases rendered. 234 cases, about 25 s. Script and images: `scratchpad/engine-pass/targeted-edits/` (`probe.mts`, `out/probe.json`, `out/*.png`).

| Already right (the kernel derives it) | Wrong after a plain update (stored numbers go stale) |
| --- | --- |
| No `OpError`, no failed feature in 234 cases | Claw count stays: a trillion keeps 4 claws (3 V-claws plus a stray round one mid-side) |
| Claws land on points and corners; V-claws on every point | Three-stone: side stones do not move. Girdles overlap in plan in 16 of 39 cases; the kernel's `stone.overlap` fires in only one (4 ct cabochon) |
| Bezel, half bezel, rails and seat follow the outline | Cathedral rise stays 3 mm while the girdle sits 0.95 to 4.66 mm above the band: on a 0.5 ct stone the shoulders swallow the head |
| Head height tracks pavilion depth; `culet.low` never fired | Shoulder row keeps `skipCenter: 44`: stones run under the halo in 28 of 39 halo cases |
| Halo follows the outline and recounts (7 to 36 stones), same melee | Cabochon in a ring: its girdle ends up 0.3 to 0.4 mm inside the band (clearance is measured from the finger) |

Two smaller facts the builder must fix on the way: the recipe sizes claw wire as `clamp(0.15·w, 0.8, 1.4)` while `RULES.prongForStone` says `0.08·w + 0.3`; and `.default(x).optional()` fields are filled by zod, so "not set" is faked with sentinels (`gem.lw === 1`, `gemRow.graduateTo === 1.5`).

## 1. The model: follow fields

**A field that depends on the stone is either absent (it follows the stone) or present (the designer pinned it).** That is the whole definition of a hand override: *a follow field that is present in the node*. Nothing is inferred from history or from who made the edit. The inspector shows a followed value greyed with an "Auto" tag; typing a value pins it; "Reset to auto" writes `null` (merge patch deletes the key). Undo restores either state exactly.

- `design/fields.ts`: `follows(field, 'stone' | 'head')` strips the default, makes the field optional and sets `meta.follows`. `describe.ts` carries it in `FieldInfo`; `defaultNode` leaves follow fields absent.
- `design/mount.ts` (new, pure): the rules, one function each. Recipes, the resolver and the kernel's fix suggestions all call these; the recipe literals and `RULES.prongForStone` go away.
- `design/resolve.ts` (new, pure): `resolveDesign(design) → Design` fills every absent follow field from its rule, looking at the whole document. The kernel's `evaluate` resolves first and hashes the resolved node, so features stay pure and the cache stays correct. Exports, sourcing, canon lint and the inspector's displayed values read the resolved design. Ops and storage always hold the unresolved one.

| Follow field | Rule in `mount.ts` | Reads |
| --- | --- | --- |
| `gem.lw` | the cut's default ratio | own cut |
| `setting.prongCount` | `GEM_CUTS[cut].prongs.typical` (new column; the canon's `PRONGS_BY_CUT` moves here); round of 7.4 mm or more takes 6 | held gem |
| `setting.prongDiameter` | `clamp(0.15 · width, 0.8, 1.4)`, 0.05 steps | held gem |
| `gem.placement.angle` with new `placement.side: 'left' \| 'right'` | pack outward from the stones at the top of the band, girdles 0.5 mm apart (the recipe's formula, generalised to five-stone); no `side` means 0 | other `ringTop` gems on the same band |
| `ringShank.shoulderHeight` | girdle height of the head above the band top, minus 0.3, clamped 0.5 to 8 | `ringTop` gems on this band |
| `gemRow.skipCenter` | the arc that clears head, claws and halo plus 0.4 mm each side; 0 when the band has no head | gems, settings, halos on the host |

Why a resolver and not only kernel features: the band and the row do not reference the stone (the stone references the band), and side stones must not depend on the centre (deleting the centre must not cascade to them). A whole-document pass has no such limit.

Recipes write a follow field only when the spec pins it (`StoneSpec.prongs`). A default from the recipe hook that equals the rule (within the field's step) is dropped so it keeps following; one that differs is a deliberate style choice and stays pinned. `unpinAtRule(design)` does the same for fixtures and exemplars built before this change.

Kernel fixes that ride along: `stoneDims` moves to `@pave/schema` (the resolver needs measured dimensions too) and the kernel imports it; a test holds the kernel's `culetDepth` to the schema's pavilion depth within 0.02 mm for every cut; a flat-backed stone on a band sits on the band's surface, not 1.2 mm above the finger.

## 2. "Keep the mount": the rule table

"Kernel" means a plain `update` of the gem already gives this, today. "Follow" means the same once section 1 lands. "Intent" means `replaceStone` writes it. The intent column is short on purpose.

| Dependent | What keeping the mount means | Who | Does not change |
| --- | --- | --- | --- |
| Claws (`prong`, `basket`) | Count follows the cut; claws sit on points and corners first, the rest spread by girth; a V-claw on every sharp point whatever the tip style | Kernel (placement, V-claws); Follow (count, wire) | style, tip, taper, spin |
| Basket rails | Follow the outline at the same fractional depths | Kernel | rail count |
| Bezel, half bezel | Wall follows the outline, creased at cut corners; half-bezel arcs stay on the two ends along the band; bearing ledge follows width | Kernel | wall thickness |
| Flush | Seat cutter follows the stone | Kernel | host body |
| Head height | Girdle = finger + clearance + pavilion depth, so the culet always clears the finger | Kernel | `elevation` (the clearance the designer chose) |
| Halo | Follows the new outline at the same gap; stone count recomputed with the outline's symmetry; metal ring follows | Kernel | melee size, rows, gap, drop |
| Band | Stays attached: claws and bezels run down into it wherever the stone now is | Kernel | size, widths, thickness, profile, base |
| Cathedral shoulders | Arms rise to just under the new girdle | Follow | everything else on the band |
| Split shank | Strands still frame the head | Kernel | `splitGap` |
| Three-stone side stones | **Position follows, size stays.** They move so each sits 0.5 mm from the new centre girdle, symmetric. Their cut, size and material stay fixed | Follow (angle) | cut, width, material, heads |
| Shoulder row (`gemRow`) | Stops clear of the new head or halo; the count changes as a result and the note says so | Follow (`skipCenter`) | stone size, cut, coverage, setting |
| Seat | Cut at production from the stone's true size (measured when linked) | Kernel | |
| Engraving | Nothing | | text, position, depth |
| Mirror pair, post, bail | The source changes once; copies, the post under the culet and the bail on the head follow | Kernel | |

Why side stones stay fixed: they are separate lines on the stone list, usually a matched pair already chosen or bought. One edit to one stone must not silently change what the client pays for the others. When the new centre leaves the side stones outside 0.45 to 0.75 of its width, the intent warns and carries ready ops ("Resize side stones to 4.6 mm to keep the proportion"); `change.sides: 'proportion'` applies them in the same change.

**Never changed by this intent:** ring size and every band dimension; metal, finish and plating anywhere; setting style and tip; any other stone; names, transforms, visibility, order; any pinned follow field. A pinned value that now disagrees with its rule (4 claws pinned, new stone is a trillion) is kept and reported as a warning with a "Reset to auto" suggestion.

## 3. The intent

```ts
// packages/schema/src/design/intents.ts: pure, no kernel, no I/O
type StoneTarget = { nodeId: string; instance?: number; scope?: 'one' | 'all' | 'alike' }
type StoneChange = {
  cut?: GemCutId
  widthMm?: number          // at most one of widthMm and carat
  carat?: number
  lw?: number
  stone?: GemMaterialId     // material is colour
  quality?: StoneQuality
  fit?: StoneSourcing       // a real stone with `measured`: fit the mount to it
  sides?: 'keep' | 'proportion'
}
type IntentWarning = { code: string; message: string; nodeId?: string; suggestion?: { label: string; ops: Op[] } }
function replaceStone(design: Design, target: StoneTarget, change: StoneChange):
  { ops: Op[]; label: string; notes: string[]; warnings: IntentWarning[] }
```

| Target | Means | Size handling |
| --- | --- | --- |
| a `gem` node | that stone | carat or mm; mm stored to 0.01 |
| a `gemRow`, `halo` or `pave` node (no `instance`) | every stone of the field | snapped to stock melee; a graduated row keeps its graduation (`graduateTo` scaled, snapped); pavé sets `sizeMax` and scales `sizeMin` |
| `instance` set | one stone inside a field: section 6 | |
| `scope: 'alike'` | every node whose cut, material and size (to 0.01 mm) equal the target's: both side stones, both studs, every row of the same melee | per node, as above |

What is kept when nothing is said:

- Cut changes, no size given: a single stone keeps its **carat** (that is how it is bought and talked about); a field keeps its **mm** (melee is calibrated by diameter). The note says which: "Kept 1.50 ct: 7.37 mm round is now 9.20 × 6.57 mm oval".
- Cut changes, no `lw` given: `lw` is reset to follow the new cut. A given `lw` outside the cut's range is clamped with a warning.
- Material changes only: mm stays, so the mount does not move; the note gives the new weight ("6.50 mm sapphire weighs 1.14 ct").

The function: resolve the target nodes; normalise the change per node; write the stone fields (`cut`, `width` or the field's size, `lw`, `stone`, `quality`, `sourcing`); apply the sourcing rule (section 4); add side-stone ops under `sides: 'proportion'`; then diff `resolveDesign` before and after to write the notes ("Claws 4 → 3", "Shoulder row stops 6° earlier", "Halo recounts on evaluation"). It writes **only stone fields**. It returns `ops: []` when nothing would change, and throws `IntentError` for a node that does not exist or carries no stones. Applying the same change twice is a no-op.

Undo, history and traces come free: the result is ordinary ops through `applyOps`, which returns the exact inverse.

## 4. Sourcing

| Case | Rule |
| --- | --- |
| Linked stone (`sourcing` set), then cut, size, ratio or material changes | The link is **cleared** in the same change (`sourcing: null`) and warning `sourcing.unlinked` names provider, SKU, price and URL. It must be cleared, not flagged: the kernel sizes the stone from `sourcing.measured` before the nominal fields, so a kept link would hide the edit. Undo restores the link. |
| Linked stone, only `quality` changes | Link kept; warning `sourcing.grade` (a bought stone has one grade). |
| "Fit the mount to this stone" (`change.fit`, from a Sourcing candidate) | The same intent: sets `sourcing` with `measured`, and sets the nominal `cut`, `width`, `lw` to match, so the inspector, the stone list and a later unlink all agree. The kernel already cuts the seat to measured size; follow fields move the rest. |
| Requirements | Nothing to do: `StoneRequirement.ref` contains node ids, cut and width, so candidates for the old stone no longer match by construction. |

## 5. The command

`design.replaceStone`: mutation, `tool: true`, no confirmation (reversible, spends nothing), designer role.

| | |
| --- | --- |
| Input | `{ pieceId, target: StoneTarget, change: StoneChange, dryRun: boolean = false, changeId?: string }` |
| Output | `{ applied: boolean, version, change?: StoredChange, ops, notes, warnings, before: EvaluationSummary, after: EvaluationSummary, delta: { metalMassG, caratTotal, stoneCount }, diagnostics: { added: Diagnostic[], resolved: Diagnostic[] } }` |

- **Preview** (`dryRun: true`): the server runs the intent on the current design, evaluates both designs at draft and writes nothing. `version` is the version it looked at.
- **Apply**: the same call without `dryRun`. The intent is recomputed on the design as it is now (it is deterministic, so there is no stale plan to replay) and committed through the `design.apply` path: one change, the intent's label, the same human-edit overlap gate, `changeId = chg_<toolCallId>` for agent calls. `StoredChange` gains `intent?: { name, input }` so History shows "Replaced centre stone" as one entry and traces record what was asked, not only which fields moved.
- **Studio**: calls the pure function in the browser. The Replace stone popover previews through the session gesture (`begin` / `preview` / `commit`), so scrubbing the size is live and commits as one change; the HUD shows the weight and carat delta from the live evaluation. The server command serves the assistant, MCP and surfaces without a design session (render page, piece card).
- Tool description, written for the assistant: "Replace or resize a stone (or every stone of a row, halo or pavé field) and let the mount follow. Use this, never hand-written ops, for any change of cut, size, carat, colour or quality. `dryRun` first when the designer asked what it would cost or weigh."
- After an apply, renders of the older version are stale: the change chip offers "Re-render 3 shots" (`renders.create` on the scenes that have renders). Not automatic, because it spends render time.

Sibling intents to add on the same pattern (named, not designed here): `design.changeMetal` (everywhere or per part), `design.resizeRing`, `design.recolourStones` (replaceStone with only `stone`, scope all), `design.changeSetting` (claws to bezel and back), `design.scalePiece` (bigger or smaller, pendants and charms), `design.duplicateFeature` and `design.mirrorFeature`.

## 6. One stone inside a row, halo or pavé field

A field's stones are instances, not nodes. `StoneInstance.id` is `${nodeId}:${index}`, and the index moves whenever the layout changes. So a pick always carries three things:

`{ nodeId, instance, point }` where `point` is the stone's girdle centre in world mm at the version picked.

`findInstance(evaluation, pick)` (kernel, next to the stone report): the instance at `index` if its centre is within half its width of `point`; else the nearest stone of that node within one width; else `pick.stale` ("that stone moved, point at it again").

| Where it travels | Change |
| --- | --- |
| Workspace selection | already holds `stone: 'nodeId:index'`; add the point |
| `threads.send.context` | `pick?: { nodeId, instance?, point? }` beside `selection` |
| `ui.context` output | `pick`, plus `stone: { cut, stone, widthMm, carat, role, setting, count }` so the assistant need not evaluate to know what "this" is |
| `viewport.select` input | `stoneId?: string`, to point at one stone |
| Context chip | "Stone 14 of 37 · Shoulder stones · 1.3 mm round diamond" |

What "replace this one stone" means there:

| Change asked | Answer |
| --- | --- |
| Material or quality | Supported as an **accent**: `accents?: { at: vec3, stone, quality? }[]` (up to 200) on `gemRow`, `halo`, `pave`. `at` is the stone's centre in the host's space when chosen; at evaluation each accent goes to the nearest stone within one width (one shared helper), else an `accent.lost` info diagnostic with a remove fix. Anchored by position, so a re-layout keeps the ruby where it was put. Lots split by material on their own. |
| Cut or size | Not possible: seats, beads and spacing are shared. The intent returns no ops and warning `instance.fixed` with suggestions: "Change all 37 stones in this row", and for a single-stone look "Add a separate stone here". |
| `scope: 'alike'` from an instance | The whole field, and other fields of the same melee; said in the note. |

## 7. "Ask AI" everywhere

One shared menu section, `AskAiSection`, rendered last in **every** context menu: viewport (stone, part, empty space), feature-tree row, inspector field, render, reference, piece card, sidebar. It takes a `subject` and nothing else.

```ts
type Subject =
  | { type: 'stone'; pieceId; nodeId; instance?; point? }
  | { type: 'part'; pieceId; nodeId }            // any non-stone node; tree rows use stone or part by kind
  | { type: 'piece'; pieceId }                   // empty viewport space, piece card
  | { type: 'render'; pieceId; renderId; sceneId }
  | { type: 'reference'; boardId; referenceId }
quickIntents(subject, design?) → { id, label, run }[]   // pure, in features/assistant/quick-intents.ts
```

| Subject | Quick intents (deterministic, no model) | Then |
| --- | --- | --- |
| Stone | Replace stone… · Change colour… · Bigger / Smaller (next stock step) · All stones like this… · Find a real stone | Ask AI about this stone… |
| Part | Change metal… · Change setting… (heads) · Make it bigger / smaller… | Ask AI about this part… |
| Piece | Change metal everywhere… · Resize ring… · Recolour stones… | Ask AI about this piece… |
| Render | Change stone colour and re-render · Change metal and re-render | Ask AI about this render… |
| Reference | Make a piece like this | Ask AI about this… |

- **Quick intents** open a small popover at the click (cut, size in ct or mm, stone) with a live preview and Apply; "Bigger / Smaller" applies at once and shows the undo chip. Each is also a registered command, so the command palette lists it for the current selection.
- **"Ask AI about this…"** opens the assistant composer as a popover anchored at the click, with the clicked thing already attached as a context chip. Enter sends `threads.send` with `context.pick` or `selection` and hands the conversation to the dock, so streaming and approvals stay in one place. Esc closes and returns focus to what was clicked. Under 900 px the dock sheet opens directly with the chip.
- **Viewport.** Right-drag pans, so the menu opens only when the right button goes down and up within the click slop the left-click pick already uses; touch uses the long press the workspace plan specifies.
- **Keyboard.** `Shift+F10` or the Menu key opens the same menu for the focused tree row, or for the selection when the viewport has focus; arrows and Enter work as in every menu; `mod+j` opens the assistant with the selection chip attached. No new single-key or Alt shortcuts.
- **Assistant unavailable** (no key, offline, budget reached): quick intents still work, because they are the pure function and `design.apply`. The "Ask AI about this…" row stays in place, disabled, with the reason as its second line and a link to the set-up panel. Viewer role: the quick intents are disabled like every other edit; asking a question stays enabled.

**The same request typed into the general assistant.** "This stone" resolves in order:

1. `context.pick` on the message (a stone chip, or a stone picked in the viewport).
2. `context.selection`, when it is one stone-bearing node (a gem is that stone; a row is the whole row).
3. The piece has exactly one centre stone and the words fit ("the stone", "the centre"): use it and say which.
4. Otherwise the assistant points: `viewport.select` on its best guess and asks "This one?" with quick replies naming the candidates ("The left side stone", "All three"). A click on a stone in the viewport attaches the pick chip to the composer, so the designer can answer by pointing.

The assistant then calls `design_replaceStone`; a prompt line and the tool description forbid hand-written ops for stone changes. The reply is built from `notes`, `warnings` and `delta`.

## 8. Test matrix (all green before this ships)

Pure tests live beside the code (`intents.test.ts`, `resolve.test.ts`); kernel tests in `packages/kernel/src/features/replace-stone.test.ts`. Run them by path.

| Suite | Cases | Asserts |
| --- | --- | --- |
| Centre stone, draft | 6 templates × 13 cuts × 0.5 / 1.5 / 4 ct = 234 | ops apply; no failed or blocked feature; no new error diagnostic; no stone collision and no girdles overlapping in plan (centre against sides, halo, row); claw count equals the rule and every outline point has a V-claw; culet clearance at or above `RULES.culetClearance`; girdle at or above the band surface (cabochon); halo has at least 6 stones of unchanged size; cathedral peak within 0.5 mm under the girdle |
| Invariants | the same 234 | band node deep-equal before and after; every metal, finish and plating equal; every other stone equal; node order equal |
| Undo | the same 234 | `applyOps(after, inverse)` deep-equals the original document; the same change twice gives `ops: []`; A to B to A returns the original resolved design |
| Plain update | the same 234, as a bare `update` of `cut` and `width` | same geometric asserts: proves the mount follows without the intent |
| Production | 6 templates × round, princess, pear, emerald at 1.5 ct | one watertight part per metal; seats cut; slow lane, run locally |
| Rows and fields | eternity and shoulder row × round, princess, baguette × three stock sizes; halo melee; iced-trophy `sizeMax`; a graduated row | count recomputed; sizes are stock melee; graduation ratio kept; `stone.wide` and `culet.low` appear exactly when the band is too small |
| Scope | `alike` on three-stone sides and on studs; `all` on a row | exactly the expected nodes are patched |
| Hand overrides | each follow field: pin, replace, check; reset, replace, check | pinned value unchanged and a warning with a reset suggestion when it breaks its rule; reset value follows |
| Sides | three-stone, centre 0.5 to 4 ct | default keeps side size and re-seats them; `proportion` resizes both, snapped |
| Sourcing | linked stone | cut change clears the link and warns; undo restores it; quality-only keeps it; `fit` sets measured and nominal, seat follows |
| Instance | accent on row, halo, pavé; then change the layout | the accent stays on the stone nearest its point; size change of one instance returns no ops and the warning; a stale pick errors |
| Command | server harness | `dryRun` writes nothing and returns the same ops as apply; one history entry with label and `intent`; `design.revert` restores; agent actor recorded |
| Menus | studio | every `ContextMenu` in the app renders `AskAiSection` (a test enumerates them); keyboard path; assistant-off state; viewer role |
| Eyes | contact sheet per template, 13 cuts at 1.5 ct, four views | judged as a bench jeweler would: claws where a setter would put them, nothing floating, shoulders meeting the head; images under the scratchpad, not the repo |

## 9. Build order and scope

1. **Follow fields**: `follows`, `mount.ts`, `resolve.ts`, `GEM_CUTS.prongs`, recipes on the rules, kernel resolves first, the three kernel fixes, sentinels removed. Proof: the "Plain update" suite, which is red today.
2. **Intent**: `intents.ts` and its pure suites.
3. **Command**: `design.replaceStone`, `StoredChange.intent`, chip label, prompt line. Proof: the Command suite.
4. **Studio**: Replace stone popover, `AskAiSection` in every menu, viewport menu, pick in selection and `threads.send`.
5. **Accents** for one stone in a field.
6. **Sibling intents**, one PR each.

Cut for now: per-instance cut or size inside a field; painted pavé regions; style variants as rule sets (a "bold" style still pins its numbers); widening the band for an oversized stone (the kernel warns, the designer decides); price deltas in the preview (needs sourcing match); the same edit across many pieces at once.
