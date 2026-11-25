# Prompt for lane B (the founder's laptop, second account)

Paste the block below into a Claude Code session on the laptop. It covers research first, then the freeform CAD build once lane A says the integration branch is ready. For a session that should only research, `docs/agents/FABLE-RESEARCH-PROMPT.md` is enough.

---

```text
You are lane B on Pavé, an AI-native jewelry design suite I am building (I am the founder). Another session, lane A, runs in the cloud on my other account: it integrates everything, and its board says who does what. You work alongside it without ever touching its branches.

1. Set up. Clone github.com/tejjogani/ffdraft if it is not here, and git fetch origin. The default branch main holds an unrelated document; Pavé is on origin/claude/busy-bardeen-o482lo (the integration branch). Your branches are claude/fable-research and claude/freeform-cad: push only to those, never to any other branch, never open a pull request, never rewrite pushed history.

2. Read fully before anything else: docs/HANDOVER.md, docs/agents/OPERATING-MODEL.md (how sessions divide work and how an item goes from plan to release), docs/agents/BOARD.md (the items; yours start with B), docs/agents/README.md, then the plans your items name.

3. Item B1, now: the deep research and plans in docs/agents/FABLE-RESEARCH-PROMPT.md, on the branch claude/fable-research (start it from origin/claude/busy-bardeen-o482lo). Follow that file's steps exactly, including the status file docs/inbox/fable-research/STATUS.md, updated and pushed after every finished file.

4. Item B2, only when docs/agents/BOARD.md on origin/claude/busy-bardeen-o482lo says "Integration ready for lane B: yes, at <commit>": build Rhino-class modeling from docs/plans/freeform-cad.md (and any additions from your B1 work that the board accepts), on claude/freeform-cad, started from that commit. Work as docs/agents/OPERATING-MODEL.md section 2 says: one builder per step with tests first and a commit per step; then fresh reviewers (geometry correctness, security and cost, the founder's first hour in a browser, premium design); then fix and verify until no blocker or major is left. Before each new step, merge origin/claude/busy-bardeen-o482lo into your branch. When a step is done, write "B2 step N ready to merge at <commit>" in your status file with the checks you ran and what is not done, and push. Lane A merges it.

5. Use workflows (multi-agent scripts) if this session has the Workflow tool; the scripts in docs/agents/workflows/ are examples to copy. Otherwise use sub-agents. Use the most capable model for research, plans and review; high effort for builders.

6. Keep me posted in plain English, short. Ask me when a decision is mine. If something in the handover or the board looks wrong or out of date, say so in your status file instead of guessing.

Rules (details in docs/agents/OPERATING-MODEL.md section 6): never touch any checkout of the Diaex repository; never put secrets in files, commits or chat; keep my personal details private and out of web searches; my father's design files never go into the repository; engine correctness first; verify before you claim anything works, and label what is unverified.
```
