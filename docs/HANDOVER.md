# Handover: where Pavé stands and how to pick it up

_Written 24 November 2026. Read this first in any new session, then the files it points to. Keep it current: whoever finishes a piece of work updates the "State" and "In flight" sections in the same commit._

## 1. What Pavé is, in the founder's words

Pavé is an AI-native jewelry design suite. **One AI assistant carries a piece through three stages: Design, then CAD, then Render.** Each stage can be done entirely by hand, or by an **AI job** that a person watches and corrects:

- **Design**: from a brief, a photo or references, the AI proposes two to four *directions* (real parametric pieces side by side, with weight, carats, stone count, rough cost and trade-offs). The person picks one or mixes them.
- **Design to CAD** (an AI job): the AI turns the chosen direction, a brief or a photo into production-ready CAD: checks run, warnings fixed or explained, size set, weights and cost confirmed, a short report of what changed.
- **CAD to Render** (an AI job): the AI proposes shots and a look, renders with Blender, critiques each take with its own vision, re-renders what falls short, and hands over a set.
- **Monitoring**: a job panel shows the plan, live progress, cost and time; Pause, Resume, Stop and Take over (a manual edit pauses the job; Resume replans). Outputs wait for review: accept, change by hand or by chat, or re-run a step.

**Pricing** (decided 24 Nov): the free plan includes the CAD software in full, including the AI jobs with the user's own Claude key. Blender renders and Rhino (.3dm) and STEP exports are paid, with 5 of each free per calendar month (numbers in one config file). STL, 3MF, OBJ and GLB exports are always free. No checkout yet; `PAVE_PLAN=pro` in `apps/server/.env` switches plans for testing.

**AI models** (decided 24 Nov): three tiers the user picks per conversation, each pointable at any allow-listed model in Settings: **Power** = Claude Fable 5.2, **Standard** (default) = Claude Opus 5.5, **Light** = Claude Sonnet 5.5 (or Haiku 5.5). The user pastes the API key in Settings, AI (stored on the server only, never sent back to the browser); `ANTHROPIC_API_KEY` in `apps/server/.env` also works and wins.

**The founder will not test until the whole journey works** (design, then CAD, then Blender render, as monitored AI jobs). Until then, the only thing to test by hand is the CAD workspace at commit `e5d18f2`.

## 2. Where everything is

| What | Where |
|---|---|
| Repository | `github.com/tejjogani/ffdraft`, branch **`claude/busy-bardeen-o482lo`** (the only branch agents may push to) |
| Last fully verified commit (typecheck clean, every test green, fresh-clone install checked) | **`e5d18f2`**. Commits after it include "Checkpoint:" commits of unfinished, unverified work |
| Assistant build (in progress) | Local branch **`ai/assistant`** in the git worktree `/home/user/ffdraft-ai`, based on `e5d18f2`. **Not pushed** unless a remote branch for it has been agreed; if the container is gone and it was never pushed, that work is lost and must be rebuilt from the plan |
| Product and architecture | `README.md` (install, run, scripts), `docs/ARCHITECTURE.md` (packages and file map) |
| Build briefs (plans) | `docs/plans/*.md`: `assistant.md`, `cad-workspace.md`, `design-intelligence.md`, `ideate-and-freeform.md`, `publishing.md`, `reference-match.md`, `render-and-models.md`, `targeted-edits.md`, and (when written) `freeform-cad.md` |
| Research | `docs/research/01`–`12`, plus `docs/research/reports/Jewelry and diamond ERP vertical.md` and its notes in `docs/research/research_notes/` |
| Strategy | `docs/strategy/product-strategy.md`, `docs/strategy/catalog-import-and-store.md` |
| Diaex integration | `docs/integrations/diaex-partner-api.md`, `diaex-partner-api.openapi.yaml`, `diaex-agent-brief.md` (the prompt the founder pastes into the Diaex agent) |
| Agent workflows used to build all this | `docs/agents/README.md` and `docs/agents/workflows/*.js` |
| Engine test pass status | `docs/agents/engine-pass-status.md` (snapshot) |

## 3. State by area

| Area | State | Where |
|---|---|---|
| Workspace, templates (14), library of metals, stones, cuts, ring sizes | Works | `apps/studio`, `packages/schema` |
| CAD workspace: feature list, inspector, live weight, carats and stone count, checks, undo and redo, "Add feature" with 19 part kinds | Works; under the engine test pass | `apps/studio/src/features/cad`, `packages/kernel` |
| Exports: STL, 3MF, OBJ, GLB, STEP, 3DM | Works | `packages/kernel` |
| Production package (spec sheet, drawings, stone list, cost, checks, zip) | Works from scripts; no screen | `packages/production` |
| Blender renders | Engine and server queue work and are tested; no screen yet (being built) | `workers/render` (GPL, separate program), `apps/server/src/engines/render` |
| Design canon (rules, style guides, exemplars, lints) | Works | `packages/canon` |
| Photo matching core (render-and-compare fitting to masks) | Core works; not yet tested on real photos; no segmentation model | `packages/match` |
| Stone replacement keeping the mount | Built in the engine pass (follow fields, `resolveDesign`, `design.replaceStone`); under verification | `packages/schema/src/design/{mount,intents}.ts` |
| AI assistant (key in app, tiers, AI jobs, stages, directions, photo to CAD, render job, plans, MCP for Claude Code) | Being built on `ai/assistant` | `docs/plans/assistant.md` plus the founder's additions in section 1 |
| Rhino-class modeling from scratch (curves, surfaces, solids, gumball, Notion-style slash palette, glass chrome) | Being planned | `docs/plans/freeform-cad.md` (when written), `docs/research/12-rhino-parity.md` |
| Ideas boards, brand models, on-model imagery, sourcing screen, publishing, desktop app, cost monitoring screens | Not built | their plans in `docs/plans` |
| ERP and catalogue import | Researched only; deliberately after the core product | the ERP report; `docs/strategy/catalog-import-and-store.md` |
| Diaex partner API | Contract and brief written and checked; Diaex side not started | `docs/integrations` |

## 4. In flight when this was written

Four agent workflows were running in the original session. A new session cannot attach to them; check their output in git instead.

1. **Engine test pass** (rounds 2 and 3, then the studio's "Replace stone…" and "Ask AI" right-click menus). Edits land in the main checkout and are saved as "Checkpoint:" commits on the branch. Done when a commit titled like "Engine test pass, round two…" or "…complete" appears without "Checkpoint". Latest open findings: `docs/agents/engine-pass-status.md`.
2. **Assistant build** on `ai/assistant`: eight build steps (1 core and adapter; 2 loop, approvals, key in app; 3 dock, AI jobs and the stage stepper; 4 view capture and photo to CAD; 5 directions and the design-to-CAD job; 6 Render tab and the render job; 7 plans and allowances; 8 MCP, `pnpm agent:smoke` and README), then three adversarial reviews (Claude API correctness; security, privacy and cost; the founder's first hour in a browser) and up to two fix rounds. Steps 1 and 2 were committed (`9416abf`, `797956b`). When it ends: merge `ai/assistant` into the branch, connect the engine pass's "Ask AI" menu items to `openAssistant(...)` from the dock's store, add `design.replaceStone` to the assistant's chip labels (`describe.ts`), run typecheck and tests, push, and give the founder one commit plus what to try.
3. **Diaex contract**: the three files in `docs/integrations` after two independent checks and a fix pass.
4. **Rhino-class modeling plan**: `docs/plans/freeform-cad.md` and `docs/research/12-rhino-parity.md`, after kernel feasibility spikes and a jeweler-CAD review. Build only after the assistant is merged (both change the CAD workspace).

If a workflow died part-way, rerun its script from `docs/agents/workflows` with the finished steps removed (see `docs/agents/README.md`). A workflow can only be resumed from its cache inside the session that ran it.

## 5. Next, in order

1. Finish and merge the assistant; finish the engine pass; give the founder one verified commit to install, with the design-to-CAD-to-render tour and a one-time `pnpm agent:smoke` against his key.
2. Build Rhino-class modeling from the plan, step by step.
3. Process the founder's father's files when they arrive (3DM, STL/STEP, photos, rate card): analyse them in a scratch folder, run import and photo-matching probes, and **never commit his files**; commit only measurements and findings.
4. Then, in an order to agree: ideas boards with image concepts (needs an image-model key), cost and usage monitoring screens, publishing, the desktop app, the sourcing screen with the Diaex partner API, and the ERP-shaped steps in the ERP report (each gated on evidence from the step before).

## 6. Decisions log

| Date | Decision |
|---|---|
| 24 Nov | Pavé is proprietary (UNLICENSED); `workers/render` is a separate GPL-3.0-or-later program because it imports Blender's bpy |
| 24 Nov | Core product first; ERP work later. "Never build an ERP" narrows to "never build the books"; migration becomes an import engine we run for our own customers (ERP report) |
| 24 Nov | Product = Design, then CAD, then Render, each by hand or as a monitored AI job; the founder tests only when that journey works |
| 24 Nov | Tiers Power / Standard / Light (Fable 5.2 / Opus 5.5 / Sonnet 5.5, changeable); key entered in the app; default Standard |
| 24 Nov | Free plan includes all CAD; renders and Rhino/STEP exports paid with 5 free a month each; STL and other mesh formats always free |
| 24 Nov | With only a Claude key, design directions are real parametric pieces, not generated concept images; image concepts need a separate image model later |
| 24 Nov | Rhino-class modeling from scratch is wanted, with a clean Notion-meets-modern look and glass on chrome only |
| earlier | Pavé customers' designs and CAD are never visible to Diaex staff; Diaex lists diamonds only; Diaex Buy is closed and takes no payment |

## 7. Rules every session must keep

- **`/home/user/diaex-backend` is read-only from Pavé's sessions**: never modify it, never run anything that writes there, never print secrets from it. Changes to Diaex go through the Diaex agent with `docs/integrations/diaex-agent-brief.md`, under Diaex's own AGENTS.md process.
- **Secrets** never in files, commits, PRs or chat. Production is never touched. The user's email and personal details are private.
- **Push only to `claude/busy-bardeen-o482lo`.** No pull request unless the founder asks. Commit messages end with the attribution lines the session's system reminder gives. No model identifiers in commit messages or code comments.
- **The founder's father's files** (3DM, STL, photos, sheets) stay out of the repo.
- **Engine first**: geometry correctness is tested before anything is built on top.
- **Verify before claiming**: say what was run and what passed; label unverified work; outside facts that could not be opened at source are marked as search extracts.
- Agents run on a 4-core machine: run targeted tests; kernel tests need `NODE_OPTIONS=--max-old-space-size=4096`.

## 8. How to check the repo is healthy

```bash
pnpm install --frozen-lockfile && pnpm -s typecheck
```

```bash
NODE_OPTIONS=--max-old-space-size=4096 pnpm vitest run packages/kernel
```

```bash
pnpm vitest run packages/schema packages/production packages/render packages/match apps/server
```

```bash
node scripts/install.mjs --check
```

## 9. Open questions for the founder

- Who is the copyright holder named in `LICENSE` (a legal entity)?
- Strategy questions still open in `docs/strategy/product-strategy.md` (narrow to centre-stone families or the full range; the never-build list).
- Catalogue questions in `docs/strategy/catalog-import-and-store.md` section 6 (trade or consumer, price visibility, who sells and ships).
- The Diaex decisions listed at the end of `docs/integrations/diaex-agent-brief.md`.
- Whether to add an image-model key (for example Google's Gemini image model) for concept images in the Design stage.
- The free allowance numbers (5 renders, 5 Rhino/STEP exports a month) and the Pro price.
