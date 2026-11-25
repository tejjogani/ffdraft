# Board: who is doing what

_Written by lane A only (see `docs/agents/OPERATING-MODEL.md`). Other lanes write requests in their own status file. Updated 25 November 2026._

## Integration state

- Integration branch: `claude/busy-bardeen-o482lo`. Latest commit the founder can test by hand: `e5d18f2` (CAD without AI). Latest AI preview (unreviewed): the head of `claude/assistant-build`.
- **Integration ready for lane B: not yet.** Lane A sets this to "yes, at <commit>" once A3 is merged. Until then lane B does research only (B1).

## Items

| Id | Owner | State | Branch | Depends on | Done means |
|---|---|---|---|---|---|
| A1 | A | In progress: step 16 of 16 (Claude in the loop), then four reviews and fixes | `claude/assistant-build` | — | No blocker or major left after review; verified by fresh agents |
| A2 | A | Done at `f8542ef`: all suites green; 9 majors still open (pavé on 3D hosts and its draft speed, script İ, name-pendant bail stems, recipe and canon defaults, canon halo measure, a mesh copy check, the replace-stone dialog outliving its tab), carried into A4 | `claude/busy-bardeen-o482lo` | — | All suites green; majors fixed or explained; verified |
| A3 | A | Waiting | `claude/busy-bardeen-o482lo` | A1, A2 | Assistant and engine merged; right-click "Ask AI" connected to the assistant; type check, every suite, studio build and a fresh-clone install pass; the founder gets one commit and what to try |
| A4 | A | Waiting | `claude/busy-bardeen-o482lo` | A3 | Problems from the founder's own test (including `pnpm agent:smoke` with his key) fixed |
| A5 | A | Later | new lane-A branch | A4 | Durable jobs, step 1 of `docs/plans/deploy-and-durable-jobs.md` |
| A6 | A | Queued after A4 | new lane-A branch | A3 | Design images by AI: an image-model provider (key in Settings, AI, like the Claude key), a Design-stage job that generates realistic images of the piece; the person picks one; the CAD job first asks for sizes (ring size, stone sizes, metal) and shows an estimate (weight, carats, rough cost) before building from the image; then the render job. Works today without an image model when the person brings their own picture |
| B1 | B | Ready to start (with C1, in one laptop session: `docs/agents/LAPTOP-RESEARCH-PROMPT.md`) | `claude/fable-research` | — | The research files and plans listed in `docs/agents/FABLE-RESEARCH-PROMPT.md`, each reviewed adversarially, with a summary in `docs/inbox/fable-research/STATUS.md` |
| B2 | B | Waiting for "integration ready" | `claude/freeform-cad` | A3 | `docs/plans/freeform-cad.md` steps 1–8 (plus any accepted additions from B1), each built, reviewed and fixed, marked ready to merge one step at a time |
| C1 | B (same laptop session as B1) or a separate lane C | Ready to start (research only) | `claude/integrations-research` | — | Accounts, API connectivity and ERP side: `docs/research/19-erp-and-pos-apis.md`, `20-accounts-and-identity.md`, `docs/plans/integrations-hub.md`, `accounts-and-developer-api.md`, each reviewed adversarially, with a summary in `docs/inbox/integrations/STATUS.md`. Prompt: `docs/agents/SESSION-C-INTEGRATIONS-PROMPT.md` |
| — | unassigned | Later | — | — | Brand models and on-model shots (needs an image-model key; plan from B1); our own jewelry renderer (plan from B1); the Diaex sourcing screen (after Diaex v1); publishing; cost and usage screens; the desktop app; ERP-shaped steps from the ERP report; the founder's father's files when they arrive (lane A) |
