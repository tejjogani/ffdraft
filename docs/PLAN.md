# Pavé: the master plan

_25 November 2026. One page to read before anything else about what Pavé is, what is built, what is being built and what comes next. Details live in the files it links. Live task status: `docs/agents/STATUS.md` (regenerated and pushed automatically); who does what: `docs/agents/BOARD.md`; how agents work: `docs/agents/OPERATING-MODEL.md`; history, rules and decisions: `docs/HANDOVER.md`._

## 1. The product, in the founder's words

Pavé is an AI-native jewelry design suite for the trade: a free, open CAD (as Blender is for 3D) with paid renders and CAD exports, and an assistant that can carry a piece from idea to finished images, end to end. It must look and feel premium to a business audience: Notion-like structure and type, frosted glass on floating chrome only, nothing that looks like a developer tool.

**Three stages per piece. Each can be done entirely by hand, or by an AI job that a person watches and corrects. At every stage the AI asks its questions first, then acts.**

| Stage | By hand | With the AI |
|---|---|---|
| **Design**: an image-based ideation space, never 3D | A pin board: reference search, links and images from Pinterest or Google, uploads, scanned sketch sheets, sketches drawn in the app, 3D models as view-only inspiration | Describe what you want with pins attached ("this trophy as a pendant, in the style of this pendant"): Claude understands it, enhances the prompt, applies guardrails and generates four images (Gemini, OpenAI or Higgsfield); pick one |
| **CAD** | Rhino-class modeling from scratch (planned), the parametric jewelry features, a reference image in the view to trace, a 3D model opened as CAD, exports | **Take to CAD**: size questions and an estimate (weight, carats, cost) first, then the CAD built from the picked image; edits by chat, stone replacement, "Ask AI" on any right-click; optional "Try variants" |
| **Render** | A viewfinder: frame it and Blender renders exactly that view; looks, lights, motion | The cinematographer: recognises the piece, asks what the images are for, which formats and animations, accepts reference shots, places its own cameras, checks framing, renders stills and animations, critiques and re-renders; every human change is recorded so it improves |

**The spec is the source of truth.** Every piece has one living spec, created in the Design stage and amended only explicitly through CAD (who changed which line, when, and from what to what). Code checks the built CAD against every measurable line of it (a 5 ct stone where 4 ct was agreed is always "not met"); a change that breaks a line must be resolved by fixing the design or, only when the person asked, amending the spec first. The CAD stage ends in a recorded sign-off of the spec against the design. This is the harness's main guarantee that the AI cannot hand over something that only looks like the picture.

**Projects and folders.** Each piece is a project with three clear sections (the Design board, CAD, Renders), each showing what it holds and what it has cost (AI spend per stage, renders against the allowance, paid exports), with a project total. A folder (for a client, a brand or a collection) holds many projects and shows their totals.

Files: STL is free; the native Pavé file (`.pave`) is free; Rhino (.3dm) and STEP exports are paid, with 5 free a month. Blender renders: 5 free a month on Free; Pro unlimited. AI uses the person's own Claude key (Power, Standard, Light tiers: Fable 5.2, Opus 5.5, Sonnet 5.5 or Haiku 5.5) and, for design images, an image-model key. Pricing will be revisited ("free CAD, charge for the intelligence").

Machines: runs locally on a laptop (a 2023 MacBook Air must stay smooth); later hosted on Render (like Diaex) with GPU rendering on render nodes.

## 2. What exists

| Area | State |
|---|---|
| Design engine (schema, ops with undo, the canon of design rules) | Built and tested |
| CAD kernel (OpenCascade and Manifold, 19 part kinds, checks, exports), stone replacement | Built; engine test pass and follow-up done; all suites green; 9 non-blocking majors open (in `docs/agents/BOARD.md`, A2) |
| CAD workspace, right-click "Ask AI" and "Replace stone…" | Built and reviewed |
| Production package, Blender render worker | Built; screens arrive with the assistant build |
| Photo matching core | Built; tested on synthetic photos only |
| The assistant and the three stages | Being built: see section 3 |
| Diaex partner API | Contract and Diaex agent brief written (`docs/integrations/`); Diaex side not started |
| Rhino-class modeling, durable jobs and hosting, our own renderer, brand models | Planned (section 4) |

## 3. The current build (lane A): the assistant, on `claude/assistant-build`

| Step | What | State |
|---|---|---|
| 1–7 | Core and Claude adapter; run loop, approvals and key in the app; chat, stages and AI jobs; seeing the design and photo to CAD; (old) 3D directions; Render stage and render job; plans and allowances | Done |
| 8–12 | Viewfinder and exact renders; reference window; AI cinematographer and animations; one flow (floating chat and reference windows, questions at every stage, shot references); the `.pave` file | Done |
| 13–15 | Premium design pass; light machines; live-key check (`pnpm agent:smoke`) and setup instructions | Done |
| 16 | A strict fake of Claude's API and Claude-in-the-loop recordings of the whole journey, as replay tests | Running |
| 17 | Projects with Design, CAD and Renders sections and their costs, inside folders; the Design stage as an image-based pin board; Take to CAD with size questions and an estimate; Start CAD linked or not; open a 3D model as CAD; directions move to CAD as variants | Next |
| 18 | AI image generations (Gemini, OpenAI, Higgsfield) with prompt enhancement and guardrails; a live check with the founder's OpenAI key | Next |
| Review | Four fresh reviewers: Claude API correctness, security and cost, the founder's first hour in a browser, premium design; then up to two fix rounds | After 18 |
| A3 | Merge with the engine work into `claude/busy-bardeen-o482lo`; connect "Ask AI" to the assistant; full checks and a fresh-clone install; one commit for the founder to install and try | After review |

Exact live state of every agent: `docs/agents/STATUS.md`.

## 4. What comes next

| Id | Owner | What | Plan |
|---|---|---|---|
| A4 | A | Fix what the founder's first local test finds (with `pnpm agent:smoke` on his key), plus the 9 open engine majors | — |
| A5 | A | Durable jobs with checkpoints, local GPU for Blender | `docs/plans/deploy-and-durable-jobs.md` steps 1–2 |
| A6 | A | Polish of the design board and image generation from the founder's feedback | — |
| B1 | B | Deep research and plans: the full jewelry CAD feature set, KeyShot-class rendering and **our own renderer for machines without Blender** (priority), AI human models with safety, the `.pave` format, low-end machines | `docs/agents/FABLE-RESEARCH-PROMPT.md` |
| B2 | B | Rhino-class modeling from scratch, eight steps | `docs/plans/freeform-cad.md` |
| Later | — | Hosting on Render and render nodes; brand models and on-model shots; our own renderer (from B1); Diaex sourcing screen (after Diaex v1); publishing; cost and usage screens; desktop app; ERP-shaped steps; the founder's father's files | `docs/plans/*`, `docs/research/reports/` |

## 5. Plans and research

- Plans: `assistant.md`, `cad-workspace.md`, `design-intelligence.md`, `ideate-and-freeform.md`, `targeted-edits.md`, `reference-match.md`, `render-and-models.md`, `freeform-cad.md`, `deploy-and-durable-jobs.md`, `publishing.md` (all in `docs/plans/`). Where the founder's later decisions differ, `docs/HANDOVER.md` section 1 and this file win.
- Research: `docs/research/01`–`12`, the ERP report in `docs/research/reports/`, strategy in `docs/strategy/`, the Diaex contract in `docs/integrations/`.

## 6. Questions open for the founder

The free allowance numbers and Pro price; which image provider is the default; the copyright holder for `LICENSE`; the Diaex decisions D1–D18 in `docs/integrations/diaex-agent-brief.md`; the catalogue and strategy questions in `docs/strategy/`.
