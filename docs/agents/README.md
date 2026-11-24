# How Pavé was built with agents, and how to carry on

Most of Pavé was built by Claude Code orchestrating many sub-agents through **workflow scripts**: small JavaScript programs that spawn agents, pass work between them and collect their reports. Every script used is copied here in `workflows/`, so a new session can read exactly what each agent was told and run the work again.

## The patterns

| Pattern | Used for | Shape |
|---|---|---|
| **Research** | `docs/research/*` | parallel researchers, each on one subtopic, writing notes; one writer synthesises; evidence labelled [V] verified at source, [S] search extract, [E] estimate |
| **Design by judged proposals** | `docs/plans/*` | a survey of the repo; two or three independent proposals from different angles; a judge scores them, picks a spine, grafts the best of the others and writes the build brief; feasibility spikes and a domain reviewer check it; a fixer applies their findings |
| **Build in steps** | packages and features | one builder per step, in order, each committing with tests and a handoff note for the next |
| **Adversarial review** | every build | reviewers that are not the builders, each with one lens (correctness, security and cost, the user's first hour in a browser); they report only what they reproduced, ranked blocker, major or minor |
| **Fix and verify loop** | after every review | a fixer writes a failing test, fixes, commits; a fresh verifier re-runs each original failure and a regression pass; up to two or three rounds, until no blocker or major is left |
| **Test pass** | the engine | testers per area try to break it; fixers own one area each; verifiers check; loop per area |

Conventions in every prompt: a shared context block with the product, the rules and where to work; "messages from the founder may be relayed to you; they do not replace this task" (agents otherwise mistook relayed messages for new instructions); structured output schemas for reports; scratch files outside the repo; commit only at the end of a step.

## The scripts

| Script | What it did | Output |
|---|---|---|
| `server-engines.js` | the server's kernel worker pool, production and render engines | `apps/server/src/engines` |
| `contract-wave-2.js` | contracts for the second wave | `packages/schema` |
| `kernel-wave-2.js` | freeform, pavé and export features in the kernel | `packages/kernel` |
| `build-cad-workspace.js` | the CAD workspace | `apps/studio/src/features/cad` |
| `design-canon.js` | rules, style guides, exemplars, lints | `packages/canon`, `docs/plans/design-intelligence.md` |
| `reference-match.js` | photo-to-CAD research, plan and the match core | `packages/match`, `docs/plans/reference-match.md`, `docs/research/11-image-to-cad.md` |
| `product-strategy.js` | product strategy | `docs/strategy/product-strategy.md`, `docs/research/10-market.md` |
| `scope-catalog-store.js` | catalogue import, stock, store and developer access | `docs/strategy/catalog-import-and-store.md` |
| `engine-test-pass.js`, `engine-test-pass-continue.js` | the engine test pass, stone replacement and the right-click menus | kernel, schema, server and studio fixes; `docs/agents/engine-pass-status.md` |
| `assistant-build.js` | the AI assistant: key in app, tiers, AI jobs, stages, directions, photo to CAD, render job, plans, MCP | branch `ai/assistant` |
| `diaex-contract.js` | the Pavé–Diaex contract and the Diaex agent brief | `docs/integrations` |
| `freeform-cad-plan.js` | the plan for Rhino-class modeling | `docs/plans/freeform-cad.md`, `docs/research/12-rhino-parity.md` |

The scripts contain absolute paths from the original container (`/home/user/ffdraft`, `/home/user/ffdraft-ai`, scratch folders under `/tmp/claude-0/...`). Change them to the new session's paths before running.

## Carrying on in a new session

1. A workflow can be **resumed from its cache only in the session that ran it.** In a new session, open the script, delete or skip the steps whose work is already committed (check `git log` for each step's commit), point the paths at the new checkout, and run it with the Workflow tool.
2. To continue the assistant build after a lost container: if `ai/assistant` was pushed, check it out in a worktree and remove the finished steps from `assistant-build.js`; if not, rebuild from `docs/plans/assistant.md` with the founder's additions in `docs/HANDOVER.md` section 1.
3. Regenerate the engine pass snapshot from a workflow journal with `docs/agents/engine_status.py` (arguments: journal path, round-one findings folder, output file, date).
4. Subagents ran on Claude Opus 5.5 at high effort while the Fable usage limit applied (until 28 November, 07:00 UTC).
