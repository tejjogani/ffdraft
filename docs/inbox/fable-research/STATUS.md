# Lane B and C research: status

_Branch `claude/fable-research`. Items B1 and C1 from the board, run as one session from `docs/agents/LAPTOP-RESEARCH-PROMPT.md`. Updated 25 November 2026._

## Summary for the founder

Not written yet. It lands here when the plans have been reviewed.

## Done

- Working copy set up on `claude/fable-research`, based on `claude/busy-bardeen-o482lo` at `cb7dcd0`.
- Core docs read: `docs/PLAN.md`, `docs/HANDOVER.md`, `docs/agents/OPERATING-MODEL.md`, `docs/agents/BOARD.md`, `docs/agents/README.md`.

- Research 17, the native file format: `docs/research/17-pave-file-format.md`. Keep the zip with a manifest as a strict profile; fix how v1 handles newer files; take the exact STEP copy out of the file; three save profiles (Working, Share, Clean copy).
- Research 21, connectors and developer access: `docs/research/21-connectors-and-developer-api.md`. One first-party connector interface and one sync engine, nothing bought; the ERP report's connector order holds, with one correction on The Edge (below).

## Requests and findings for lane A (from the research so far)

Three items in the first `.pave` version on `claude/assistant-build` (details in research 17, section 2.3, rows 9 to 11):

1. The "saved here" organisation fingerprint is a fixed value that can be copied from any file of that organisation, so a crafted file can carry a forged rights attestation.
2. `thumbUrl` survives opening a file, so a stranger's file can make the studio fetch a URL of the sender's choosing.
3. `save.ts` does not enforce `PAVE_LIMITS`, so a long-lived piece can be saved into a file that will not open.

Also: `docs/pave-file.md` says adding an entry or a field is not a breaking change, but the reader refuses unknown entries, rejects new enum values and checks names before the version. A newer file gets the wrong error instead of "update Pavé". `geometry/exact.step` inside the file hands the paid STEP export to anyone who unzips it, and open never reads it.

Corrections to earlier research:

- The Edge's "Item Data Import" only updates existing items. New items come in through "Receive Invoice, Import Invoice", whose blank template is downloadable only inside the program. The Edge connector is therefore two files; the create file needs one customer's template.
- The server uses PGlite (embedded Postgres), not SQLite. Queues are ordinary tables in both local and hosted modes.
- Etsy now lists webhook events for commercial and personal apps (`08-channels.md` flagged this as a contradiction).
- `01-cad.md` says STEP AP214; `step.ts` writes AP242.

## Now

Ten research subagents, one per topic, one file each (topic 22 was added on the founder's word, 25 Nov: "ensure our Notion like beauty software has all the CAD features of rhino too"):

| File | Topic | State |
|---|---|---|
| `docs/research/13-jewelry-cad-features.md` | Full jewelry CAD feature set | Running |
| `docs/research/14-jewelry-rendering.md` | Rendering state of the art for jewelry | Running |
| `docs/research/15-own-renderer.md` | Our own renderer (priority) | Running |
| `docs/research/16-ai-models-on-model.md` | AI human models, on-model imagery | Running |
| `docs/research/17-pave-file-format.md` | The native file format | Done; plan being written |
| `docs/research/18-low-end-machines.md` | Low-end machines | Running |
| `docs/research/19-erp-and-pos-apis.md` | ERP, POS and accounting APIs | Running |
| `docs/research/20-accounts-and-identity.md` | Accounts and identity | Running |
| `docs/research/21-connectors-and-developer-api.md` | Connectors and developer API | Done |
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

From research 17 (the file):
1. Open or closed spec? Recommended: publish the envelope now (container, manifest, thumbnail, mesh, provenance) and the design schema once freeform settles.
2. Any exact geometry inside the file? Recommended: none. The design is the truth; a display mesh rides along.
3. What history does a shared file keep by default?
4. Is learning from edits a condition of the free plan, or opt-in per organisation? `05-platform.md` decided opt-in; the free-file model assumes it. The two conflict.
5. The company's legal name and domain, for the MIME type and the macOS type identifier.

From research 21 (connectors):
6. India first (Tally) or US first (The Edge) for the second connector?
7. Can a customer on The Edge send the blank "Receive Invoice" import template?
8. Add a stock-unit record for tagged one-of-a-kind pieces? It changes the publishing plan's "variants are never stored" rule.
9. Is a small hosted webhook relay acceptable before full hosting, and who runs it?
10. Fold `channels` and `sourcing` into one connector package now, or keep them apart?
