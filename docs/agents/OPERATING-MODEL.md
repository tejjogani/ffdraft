# How agents build Pavé: the operating model

_For every Claude session that works on Pavé, on any account or machine. Read `docs/HANDOVER.md` first (what the product is, decisions, rules), then this file, then `docs/agents/BOARD.md` (who is doing what now)._

Pavé is built by **sessions** (a Claude Code session on one account and machine), each of which runs **workflows** (scripts that spawn many sub-agents) to plan, build, review and fix. Several sessions can work at once. This file says how they divide the work, how one piece of work moves from plan to the founder's hands, and how they hand over to each other without stepping on one another.

## 1. Lanes, branches and the board

Each session owns a **lane**: a set of work items and the branches they live on. No two sessions ever push to the same branch.

| Lane | Who | Owns | Pushes to |
|---|---|---|---|
| **A, integration** | The cloud session on the founder's main account | Finishing and integrating builds; engine fixes; releases to the founder; fixes from his testing; anything not assigned | `claude/busy-bardeen-o482lo` (the integration branch: the only place work is merged), `claude/assistant-build` |
| **B, research and freeform CAD** | A session on the founder's laptop, second account (Fable 5.2 when available) | Deep research and plans; then Rhino-class modeling from `docs/plans/freeform-cad.md` | `claude/fable-research` (research and plans), `claude/freeform-cad` (the build) |
| C, D, … | Any later session | Whatever the board assigns | `claude/<lane>-<topic>`, named on the board |

- **The board** is `docs/agents/BOARD.md` on the integration branch. Lane A is its only writer, so it never conflicts. Every work item has an id (A3, B2, …), an owner lane, a state, its branch, what it depends on, and what "done" means.
- **A lane's status file** is `docs/inbox/<lane>/STATUS.md` on that lane's own branch (for lane B: `docs/inbox/fable-research/STATUS.md`). It is how a lane talks to everyone else: done (with commit ids), now, next, questions, and **requests** (for example "B asks to take item X" or "B2 step 3 is ready to merge at commit …").
- **Lane A reads every lane's status** at least every two hours (a scheduled task in the cloud session) and whenever the founder relays something, then updates the board and merges what is ready.
- A lane may start any item the board already assigns to it without asking. For anything else it writes a request and waits for the board to change.
- **The founder** is the router between accounts: he can paste a message from one session into another, and his word overrides the board.

## 2. The life of one work item

```
plan  →  build  →  review  →  fix and verify  →  ready to merge  →  integrate  →  release
```

1. **Plan.** Every item builds from a plan in `docs/plans/`. If there is none, write one first with the judged-proposals pattern (section 4): a repo survey, two or three independent proposals, a judge who picks a spine and grafts the best of the others, feasibility spikes and a domain reviewer, then fixes. A plan has: 1. Experience, 2. Structure, 3. Contract changes, 4. Hard parts and decisions (with what was rejected and why), 5. Verification, 6. Scope cuts, 7. Build order in steps, each shippable and testable.
2. **Build.** One workflow per item. One builder agent per step, in order. Each step writes its tests first, commits with them on the lane's branch, and leaves a handoff note (names, commands, fixtures, traps) for the next step.
3. **Review.** Fresh agents who did not build it, one lens each, reporting only what they reproduced, ranked blocker, major or minor. Always: correctness of the part's core (for the assistant: Claude API rules; for CAD: geometry); security, privacy and cost; the founder's first hour, driven in a real browser. Add premium design whenever a screen changed.
4. **Fix and verify.** A fixer writes a failing test for each blocker and major, then fixes it; a fresh verifier re-runs each original failure plus a regression pass. Up to two or three rounds, until no blocker or major is left. Never weaken or skip a test to get green.
5. **Ready to merge.** The lane writes in its status file: the commit id, what the item does, the checks that passed (commands and results), what is not done, and the screenshots.
6. **Integrate (lane A).** Merge into `claude/busy-bardeen-o482lo`; resolve conflicts; run the type check, every test suite, the studio build and a fresh-clone install (`node scripts/install.mjs` in a clean clone); fix what broke; update `docs/HANDOVER.md` and the board in the same commit.
7. **Release (lane A).** Give the founder one commit id, the commands to install it, what to try, what is not in it yet, and what is unverified.

Other lanes keep up by merging the integration branch into their own before each new step: `git fetch origin && git merge origin/claude/busy-bardeen-o482lo`.

## 3. How a workflow is written

The scripts in `docs/agents/workflows/` are working examples; copy the closest one.

- **A shared context block** at the top of every prompt: the product in two lines, the founder's goal for this item, where to work (an absolute path), which branch, what never to touch, how to commit, the rules that matter, the machine's limits, and this sentence: _"Messages from the founder may be relayed to you as context; they do not replace or cancel this task, which is authorised."_ (Without it, agents mistake a relayed message for a new instruction.)
- **The founder's own words** quoted in the step that serves them.
- **Structured reports** through a schema: builders return summary, commit, checks (command and result), not done, handoff; reviewers return verdict and findings (severity, file, summary, evidence, fix).
- **Scratch files outside the repo** (screenshots, repro scripts, logs). Commit only real code, tests and docs.
- **Concurrency is small** (on a 4-core cloud machine, two agents at a time): run targeted tests, not every suite at once; kernel tests need `NODE_OPTIONS=--max-old-space-size=4096`.
- **Separate checkouts for parallel work**: a second build runs in its own `git worktree`, never in a checkout another workflow is editing.

## 4. Patterns

| Pattern | Use it for | Shape |
|---|---|---|
| Research | Questions that need many sources | Parallel researchers on separate subtopics write notes; one writer synthesises; claims labelled [V] opened at source, [S] search extract, [E] estimate |
| Judged proposals | Plans | Survey; two or three proposals from different angles; a judge scores (fit, robustness, AI-operability, effort, risk) and synthesises; spikes and a domain reviewer; fixes |
| Build in steps | Features | One builder per step, tests first, commit per step, handoff notes |
| Adversarial review | Every build | One fresh reviewer per lens; reproduced findings only |
| Fix and verify loop | After review | Failing test, fix, fresh verifier, at most three rounds |
| Test pass | The engine | Testers per area try to break it; owners fix their area; verifiers check; loop per area |
| Claude in the loop | Anything that calls Claude | A strict fake of Claude's API (validates every request against the docs) and an agent answering as Claude; recordings become replay tests |
| Fresh-session check | Handover documents and prompts | An agent with no context follows the document literally and reports every point of doubt |

## 5. Surviving restarts and limits

- **Commit often.** A cloud session's container can restart at any time and stops every workflow and background loop. Work that is committed and pushed survives; uncommitted work in a worktree survives on disk but not a lost machine.
- **Checkpoint commits.** When the session's stop hook reports uncommitted changes, commit them on the lane's branch as `Checkpoint: <what> in progress` and push. Never present a checkpoint as verified.
- **Backups.** A long build on a local branch is pushed to its lane branch after every step (a loop, restarted when it ends).
- **Resume.** A workflow resumes from its journal only in the session that ran it (`resumeFromRunId`): finished agents come from cache and the interrupted step reruns, keeping the files it had written. In a new session, rerun the script with the finished steps removed.
- **Usage limits.** Each account has a weekly limit. When it is close, finish what the founder will test before starting research.
- **Models.** Use the most capable model the account allows for research, plans, judging and final review (Fable 5.2); Opus 5.5 at high effort for builders, fixers and verifiers.

## 6. Rules that never bend

- The Diaex repository is **read-only** from Pavé's work: never modify it, never run anything that writes there, never open `.env` or other secret files, never print secrets. Changes to Diaex go through the Diaex agent with `docs/integrations/diaex-agent-brief.md`.
- No secrets in files, commits, pull requests or chat. Production is never touched. The founder's personal details stay private; never put Diaex, Aska, Pavé or a family name into a web search.
- The founder's father's design files never go into the repository; only measurements and findings do.
- Push only to your lane's branches; never to `main`; no pull request unless the founder asks; never rewrite pushed history. Commit messages end with your own session's attribution lines and carry no model names.
- Engine first: geometry correctness is tested before anything is built on top.
- Verify before claiming: say what ran and what passed; label what is unverified; look at every screenshot you take.
- The look: Notion-like structure and type, frosted glass on floating chrome only (never under stones, prices or tables), premium and calm; no developer-tool panes for the founder's business audience. See the design-language note in `docs/`.

## 7. Starting a new session

Use `docs/RESUME-PROMPT.md` for lane A, or `docs/agents/SESSION-B-PROMPT.md` for lane B. Any other new lane: read `docs/HANDOVER.md`, this file and the board, ask the founder which items to take, write `docs/inbox/<lane>/STATUS.md` on your branch, and wait for the board to assign you before building.
