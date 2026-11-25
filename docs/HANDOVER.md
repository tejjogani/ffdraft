# Handover: where Pavé stands and how to pick it up

_Written 24 November 2026. Read this first in any new session, then the files it points to. Keep it current: whoever finishes a piece of work updates the "State" and "In flight" sections in the same commit._

## 1. What Pavé is, in the founder's words

Pavé is an AI-native jewelry design suite. **One AI assistant carries a piece through three stages: Design, then CAD, then Render.** Each stage can be done entirely by hand, or by an **AI job** that a person watches and corrects:

- **Design**: from a brief, a photo or references, the AI proposes two to four *directions* (real parametric pieces side by side, with weight, carats, stone count, rough cost and trade-offs). The person picks one or mixes them.
- **Design to CAD** (an AI job): the AI turns the chosen direction, a brief or a photo into production-ready CAD: checks run, warnings fixed or explained, size set, weights and cost confirmed, a short report of what changed.
- **CAD to Render** (an AI job): the AI proposes shots and a look, renders with Blender, critiques each take with its own vision, re-renders what falls short, and hands over a set.
- **Monitoring**: a job panel shows the plan, live progress, cost and time; Pause, Resume, Stop and Take over (a manual edit pauses the job; Resume replans). Outputs wait for review: accept, change by hand or by chat, or re-run a step.

**Pricing** (decided 24 Nov; not built yet, it is step 7 of the assistant build): the free plan includes the CAD software in full, including the AI jobs with the user's own Claude key. Blender renders and Rhino (.3dm) and STEP exports are paid, with 5 of each free per calendar month (planned: numbers in one config file). STL, 3MF, OBJ and GLB exports are always free. Planned: no checkout at first, and `PAVE_PLAN=pro` in `apps/server/.env` to switch plans for testing.

**AI models** (decided 24 Nov): three tiers the user picks per conversation, each pointable at any allow-listed model in Settings: **Power** = Claude Fable 5.2, **Standard** (default) = Claude Opus 5.5, **Light** = Claude Sonnet 5.5 (or Haiku 5.5). The user pastes the API key in Settings, AI (stored on the server only, never sent back to the browser); `ANTHROPIC_API_KEY` in `apps/server/.env` also works and wins.

**The founder will not test until the whole journey works** (design, then CAD, then Blender render, as monitored AI jobs). Until then, the only thing to test by hand is the CAD workspace at commit `e5d18f2`.

**Two meanings of "Design":** today the CAD workspace lives in the studio's "Design" tab. The Design *stage* above (directions) is new; assistant build step 3 adds a Design, CAD, Render stepper and relabels the CAD tab.

## 2. Where everything is

| What | Where |
|---|---|
| Repository | `github.com/tejjogani/ffdraft`. **Its default branch `main` holds an unrelated document; Pavé is only on the `claude/...` branches.** Clone with `git clone -b claude/busy-bardeen-o482lo https://github.com/tejjogani/ffdraft.git pave` |
| Main working branch | **`claude/busy-bardeen-o482lo`**: everything merged so far. Push here, unless the founder has named another branch for the session; a new session that was assigned a different branch asks the founder before its first push |
| Commit to test by hand | **`e5d18f2`**: typecheck clean, tests green and a fresh-clone install checked. Its round-one engine fixes were not yet re-verified, and the verify rounds found open majors (`docs/agents/engine-pass-status.md`). Commits after it include "Checkpoint:" commits of unfinished, unverified work |
| Assistant build (in progress) | Remote branch **`claude/assistant-build`** (the founder agreed on 24 Nov), pushed from the local branch `ai/assistant` in the worktree `/home/user/ffdraft-ai` after every committed step; based on `e5d18f2`. Work a step had not yet committed when the container stopped is lost and is redone by rerunning that step |
| Product and architecture | `README.md` (install, run, scripts), `docs/ARCHITECTURE.md` (packages and principles; partly out of date: it predates the three-stage product, and lists packages not built yet) |
| Build briefs (plans) | `docs/plans/*.md`: `assistant.md`, `cad-workspace.md`, `design-intelligence.md`, `ideate-and-freeform.md`, `publishing.md`, `reference-match.md`, `render-and-models.md`, `targeted-edits.md`, and (when written) `freeform-cad.md` |
| Research | `docs/research/01`–`11` (`12-rhino-parity.md` when written), plus `docs/research/reports/Jewelry and diamond ERP vertical.md` and its notes in `docs/research/research_notes/` |
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
| Rhino-class modeling from scratch (curves, surfaces, solids, gumball, Notion-style slash palette, glass chrome) | Planned (eight steps); build starts when the engine pass ends | `docs/plans/freeform-cad.md`, `docs/research/12-rhino-parity.md` |
| Ideas boards, brand models, on-model imagery, sourcing screen, publishing, desktop app, cost monitoring screens | Not built | their plans in `docs/plans` |
| Durable jobs with checkpoints, local GPU for Blender, hosting on Render, render nodes | Planned only; build after the founder's first local test | `docs/plans/deploy-and-durable-jobs.md` |
| ERP and catalogue import | Researched only; deliberately after the core product | the ERP report; `docs/strategy/catalog-import-and-store.md` |
| Diaex partner API | Contract, OpenAPI file and Diaex agent brief written, checked against the Diaex code and fixed; Diaex side not started | `docs/integrations` |

## 4. In flight when this was written

Agent workflows were running in the original session. A new session cannot attach to them; check their output in git instead. **They may still be running**: before changing code, a new session asks the founder whether the original session is still working. A workflow is likely dead if its branch has had no new commit for several hours and the founder confirms the original session has stopped.

1. **Engine test pass** (rounds 2 and 3, then the studio's "Replace stone…" and "Ask AI" right-click menus). Edits land in the main checkout and are saved as "Checkpoint:" commits on the branch. Done when a commit titled like "Engine test pass, round two…" or "…complete" appears without "Checkpoint". Latest open findings: `docs/agents/engine-pass-status.md`.
2. **Assistant build** on `ai/assistant`: eight build steps (1 core and adapter; 2 loop, approvals, key in app; 3 dock, AI jobs and the stage stepper; 4 view capture and photo to CAD; 5 directions and the design-to-CAD job; 6 Render tab and the render job; 7 plans and allowances; 8 MCP, `pnpm agent:smoke` and README), then three adversarial reviews (Claude API correctness; security, privacy and cost; the founder's first hour in a browser) and up to two fix rounds. Steps 1 and 2 were committed (`9416abf`, `797956b`, on `claude/assistant-build`); step 3 was running. The founder's additions (tiers, key in the app, AI jobs and stages, directions, the render job, plans) are in section 1 and in `docs/agents/workflows/assistant-build.js`; they override `docs/plans/assistant.md` where they differ. When it ends: merge `claude/assistant-build` into the main branch, connect the engine pass's "Ask AI" menu items to `openAssistant(...)` (in the dock's store on the assistant branch), add `design.replaceStone` to the assistant's chip labels (`packages/agent/src/describe.ts` on the assistant branch), run typecheck and tests, push, and give the founder one commit plus what to try.
3. **Diaex contract**: finished in the original session. The three files in `docs/integrations` passed two independent checks (one against the Diaex code and rules, one for contract quality and security) and a fix pass; they are committed under a commit titled for the Diaex contract.
4. **Rhino-class modeling plan**: `docs/plans/freeform-cad.md` and `docs/research/12-rhino-parity.md`, after kernel feasibility spikes and a jeweler-CAD review. Build only after the assistant is merged (both change the CAD workspace).

If a workflow died part-way, rerun its script from `docs/agents/workflows` with the finished steps removed (see `docs/agents/README.md`). A workflow can only be resumed from its cache inside the session that ran it.

## 5. Next, in order

0. **Deep research and plan, queued behind the assistant build** (the founder chose build first; run it when the build ends, or on Fable 5.2 after Sat 28 Nov 07:00 UTC, when the weekly limit resets): the full jewelry CAD feature set beyond `docs/research/12-rhino-parity.md` (MatrixGold, RhinoGold, 3Design, JewelCAD); KeyShot-class jewelry rendering (spectral dispersion, caustics, measured metal IOR, HDRI studios) and a jewelry-specialised renderer of our own, with renderer spikes on real gems (no GPL code in-process); brand AI models (face, hand, full body) for on-model shots, with CAD-fidelity checks, NSFW and consent safety, building on `docs/plans/render-and-models.md`; a native Pavé file format (free inside Pavé, where traces are captured; Rhino and STEP exports stay paid, STL stays free); rendering on low-end machines such as a 2023 MacBook Air.

1. Finish and merge the assistant; finish the engine pass; give the founder one verified commit to install, with the design-to-CAD-to-render tour and a one-time `pnpm agent:smoke` against his key.
2. Build Rhino-class modeling from the plan, step by step.
3. Process the founder's father's files when they arrive (3DM, STL/STEP, photos, rate card): analyse them in a scratch folder, run import and photo-matching probes, and **never commit his files**; commit only measurements and findings.
4. Then, in an order to agree: ideas boards with image concepts (needs an image-model key), cost and usage monitoring screens, publishing, the desktop app, the sourcing screen with the Diaex partner API, and the ERP-shaped steps in the ERP report (each gated on evidence from the step before).

## 5b. Working with a second session (the founder's laptop, Fable 5.2)

The founder can run a second Claude Code session on his own laptop with another account. It does deep research and writes plans, never product code, using `docs/agents/FABLE-RESEARCH-PROMPT.md`.

- It pushes only to the branch **`claude/fable-research`**, and changes only `docs/research/`, `docs/plans/` and `docs/inbox/fable-research/`.
- It keeps `docs/inbox/fable-research/STATUS.md` current: done (with paths), now, next, questions.
- The build session watches that branch (a polling loop, plus a scheduled check every two hours that survives container restarts). When it moves, the build session merges those paths into `claude/busy-bardeen-o482lo`, reads STATUS.md, and folds the plans into the build queue. Plans from the laptop never overwrite existing plans; changes arrive as new files (for example `freeform-cad-additions.md`).

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
- **Push only to `claude/busy-bardeen-o482lo` (merged work) and `claude/assistant-build` (the assistant build).** A session assigned another branch asks the founder before its first push. Never push to `main`. No pull request unless the founder asks. Commit messages end with the attribution lines the session's system reminder gives. No model identifiers in commit messages or code comments.
- **The founder's father's files** (3DM, STL, photos, sheets) stay out of the repo.
- **Engine first**: geometry correctness is tested before anything is built on top.
- **Verify before claiming**: say what was run and what passed; label unverified work; outside facts that could not be opened at source are marked as search extracts.
- Agents run on a 4-core machine: run targeted tests; kernel tests need `NODE_OPTIONS=--max-old-space-size=4096`.

## 8. How to check the repo is healthy

```bash
pnpm install --frozen-lockfile && pnpm -s typecheck && pnpm -s build
```

```bash
NODE_OPTIONS=--max-old-space-size=4096 pnpm vitest run packages/kernel
```

```bash
pnpm vitest run packages/schema packages/production packages/render packages/match apps/server
```

```bash
pnpm vitest run packages/canon packages/sourcing apps/studio
```

```bash
node scripts/install.mjs --check
```

Run one block at a time on a small machine. The kernel suite takes several minutes; for a quick health check run only `packages/kernel/src/features/features.test.ts` and the schema tests. `install.mjs --check` reports the studio as not built until `pnpm build` or the installer has run.

## 9. Open questions for the founder

- Who is the copyright holder named in `LICENSE` (a legal entity)?
- Strategy questions still open in `docs/strategy/product-strategy.md` (narrow to centre-stone families or the full range; the never-build list).
- Catalogue questions in `docs/strategy/catalog-import-and-store.md` section 6 (trade or consumer, price visibility, who sells and ships).
- The Diaex decisions listed at the end of `docs/integrations/diaex-agent-brief.md`.
- Whether to add an image-model key (for example Google's Gemini image model) for concept images in the Design stage.
- The free allowance numbers (5 renders, 5 Rhino/STEP exports a month) and the Pro price.
