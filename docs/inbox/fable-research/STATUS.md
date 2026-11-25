# Lane B and C research: status

_Branch `claude/fable-research`. Items B1 and C1 from the board, run as one session from `docs/agents/LAPTOP-RESEARCH-PROMPT.md`. Updated 25 November 2026._

## Summary for the founder

Not written yet. It lands here when the plans have been reviewed.

## Done

- Working copy set up on `claude/fable-research`, based on `claude/busy-bardeen-o482lo` at `cb7dcd0`.
- Core docs read: `docs/PLAN.md`, `docs/HANDOVER.md`, `docs/agents/OPERATING-MODEL.md`, `docs/agents/BOARD.md`, `docs/agents/README.md`.

## Now

Ten research subagents, one per topic, one file each (topic 22 was added on the founder's word, 25 Nov: "ensure our Notion like beauty software has all the CAD features of rhino too"):

| File | Topic | State |
|---|---|---|
| `docs/research/13-jewelry-cad-features.md` | Full jewelry CAD feature set | Running |
| `docs/research/14-jewelry-rendering.md` | Rendering state of the art for jewelry | Running |
| `docs/research/15-own-renderer.md` | Our own renderer (priority) | Running |
| `docs/research/16-ai-models-on-model.md` | AI human models, on-model imagery | Running |
| `docs/research/17-pave-file-format.md` | The native file format | Running |
| `docs/research/18-low-end-machines.md` | Low-end machines | Running |
| `docs/research/19-erp-and-pos-apis.md` | ERP, POS and accounting APIs | Running |
| `docs/research/20-accounts-and-identity.md` | Accounts and identity | Running |
| `docs/research/21-connectors-and-developer-api.md` | Connectors and developer API | Running |
| `docs/research/22-rhino-full-parity.md` | Every Rhino 8 CAD capability against the plan and the product | Running |

## Next

1. Six plans: `jewelry-renderer.md`, `brand-models-v2.md`, `pave-file-format.md`, `freeform-cad-additions.md` (from topics 13 and 22: the steps to full Rhino parity), `integrations-hub.md`, `accounts-and-developer-api.md` (all in `docs/plans/`).
2. One adversarial review per plan by a fresh subagent, then fixes.
3. The summary at the top of this file.

## A second job from the founder: a bug-sweep team (not on this branch)

The founder also asked (25 Nov) for an agent team to look for bugs, obvious misses and missing tests, fix them in a separate working tree, and raise pull requests. He chose the integration branch as the target. This is product code, so it is kept off this docs-only branch:

| Branch | Area | State |
|---|---|---|
| `claude/bugsweep-server` | `apps/server` | Running |
| `claude/bugsweep-studio` | `apps/studio`, `packages/ui` | Running |
| `claude/bugsweep-packages` | production, render, match, canon, sourcing, installers | Running |
| `claude/bugsweep-kernel` | `packages/kernel`, `packages/schema` | Queued (starts when the renderer spike frees the machine) |

Each branch is based on `claude/busy-bardeen-o482lo` at `cb7dcd0` and becomes one pull request into it. The nine open majors lane A carries into A4 are left alone. **Request to lane A:** these are extra `claude/bugsweep-*` branches outside the board; the founder asked for them directly.

## Notes on how this session runs

- This session runs in a cloud workspace linked to the founder's laptop, not on macOS itself. Renderer spikes run on Linux CPU (2 cores). Apple M2 and Metal timings are therefore taken from sources or estimated, and labelled so. A real M2 run is still to do.
- Pushing from this workspace is not authorised yet. Commits are local until the founder authorises the repository for the session, or pushes a bundle from the laptop.

## Things in the repo that look out of date

- `docs/agents/BOARD.md` gives C1 its own branch (`claude/integrations-research`) and status file (`docs/inbox/integrations/STATUS.md`). The newer laptop prompt puts B1 and C1 in one session on `claude/fable-research` with this status file. This session follows the laptop prompt.
- `docs/HANDOVER.md` section 1 still describes the Design stage as parametric directions in its first bullet, and as an image pin board further down (25 Nov). `docs/PLAN.md` matches the pin board. This session treats the pin board as current.
- `docs/HANDOVER.md` section 2 lists research `01`–`11` and says `freeform-cad.md` and `12-rhino-parity.md` are "when written". Both exist.

## Questions for the founder

None yet.
