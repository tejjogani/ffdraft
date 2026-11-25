# Board: who is doing what

_Written by lane A only (see `docs/agents/OPERATING-MODEL.md`). Other lanes write requests in their own status file. Updated 25 November 2026._

## Integration state

- Integration branch: `claude/busy-bardeen-o482lo`. Latest commit the founder can test by hand: `e5d18f2` (CAD without AI). Latest AI preview (unreviewed): the head of `claude/assistant-build`.
- **Integration ready for lane B: yes, at `075cafd`** (the engine and the whole assistant build merged; type check, build and suites pass). Lane B may start B2 (Rhino-class modeling) from the head of `claude/busy-bardeen-o482lo`. Note: lane A is changing the CAD screen's shell at the same time (a focused full-window editor, a floating back button, a floating reference window, "Start from scratch"); B2 should keep its work inside the CAD feature folders and the kernel, and merge the integration branch before each step.

## Items

| Id | Owner | State | Branch | Depends on | Done means |
|---|---|---|---|---|---|
| A1 | A | Done: 18 steps, four reviews, two fix rounds; no blocker or major left, 5 minors (head `f57efe2` on `claude/assistant-build`) | `claude/assistant-build` | — | No blocker or major left after review; verified by fresh agents |
| A2 | A | Done at `f8542ef`: all suites green; 9 majors still open (pavé on 3D hosts and its draft speed, script İ, name-pendant bail stems, recipe and canon defaults, canon halo measure, a mesh copy check, the replace-stone dialog outliving its tab), carried into A4 | `claude/busy-bardeen-o482lo` | — | All suites green; majors fixed or explained; verified |
| A3 | A | In progress: merged and pushed (`075cafd`): Ask AI opens the assistant on what was right-clicked; type check, build and every suite outside the kernel pass. A fresh verifier is now installing from a clean clone and walking the whole journey in a browser; fixes follow | `claude/busy-bardeen-o482lo` | A1, A2 | Assistant and engine merged; right-click "Ask AI" connected to the assistant; type check, every suite, studio build and a fresh-clone install pass; the founder gets one commit and what to try |
| A7 | A | In progress (the founder's priority, 25 Nov) | local `spec/truth`, merged into the main branch when verified | A3 | The spec is the source of truth: created in Design, amended only explicitly (who, when, from what to what) through CAD; a strict check in code of the built CAD against every measurable spec line (a 5 ct stone against a 4 ct spec is always "not met"); drift caught from any source; CAD ends in a recorded sign-off; a stronger system prompt; amendments, checks and sign-offs stored as traces. Plan: `docs/plans/spec-truth.md` |
| A4 | A | Waiting | `claude/busy-bardeen-o482lo` | A3 | Problems from the founder's own test (including `pnpm agent:smoke` with his key) fixed |
| A5 | A | Later | new lane-A branch | A4 | Durable jobs, step 1 of `docs/plans/deploy-and-durable-jobs.md` |
| A6 | A | Queued after A4 | new lane-A branch | A3 | Design images by AI: an image-model provider (key in Settings, AI, like the Claude key), a Design-stage job that generates realistic images of the piece; the person picks one; the CAD job first asks for sizes (ring size, stone sizes, metal) and shows an estimate (weight, carats, rough cost) before building from the image; then the render job. Works today without an image model when the person brings their own picture |
| B1 | B | Done and merged (`5a05e0d`): research 13 to 22, six reviewed plans, the renderer spike; status and the founder's decisions in `docs/inbox/fable-research/STATUS.md` | `claude/fable-research` | — | — |
| B2 | B | Waiting for "integration ready" | `claude/freeform-cad` | A3 | `docs/plans/freeform-cad.md` steps 1–8 (plus any accepted additions from B1), each built, reviewed and fixed, marked ready to merge one step at a time |
| C1 | B | Done and merged with B1 (research 19 to 21; plans `integrations-hub.md`, `accounts-and-developer-api.md`) | `claude/fable-research` | — | — |
| B3 | B | Done and merged (`5a05e0d`): bug sweep, pull requests 1 to 5 (Mac and Windows build, server, packages, kernel, studio); findings in `docs/inbox/fable-research/BUGSWEEP.md` | `claude/bugsweep-*` | — | — |
| A9 | A | Queued, from the founder's decisions of 25 Nov in the research status file | — | A3 | Remove the Higgsfield image provider (no Higgsfield, no AI video); the Cycles bounce fix (renderer plan step 1); `.pave` first-version fixes, with no exact geometry in the file (file plan steps 1 to 4); the OpenCascade licence notice (freeform additions step 10); trace learning stated up front as part of using the software; the sourcing screen on the Diaex partner API, moved up beside freeform CAD |
| A10 | A | Queued | — | A8 | Home: a conversation started from Home continues in Home's main area, not in a small side panel |
| — | unassigned | Later | — | — | Brand models and on-model shots (needs an image-model key; plan from B1); our own jewelry renderer (plan from B1); the Diaex sourcing screen (after Diaex v1); publishing; cost and usage screens; the desktop app; ERP-shaped steps from the ERP report; the founder's father's files when they arrive (lane A) |
