# Prompt to pick Pavé up in a new session

Paste the block below into a new Claude Code session (cloud or local) that has the repository `tejjogani/ffdraft` available. It pulls the latest work, reads the handover, checks the repo is healthy and reports back. Add the last line ("Then continue…") only when you want it to carry on building without waiting for you.

---

```text
You are picking up Pavé, an AI-native jewelry design suite I am building (I am the founder). Another session did the work so far and left a handover. Do the following, in order, and do not skip the reading.

1. Get the latest code.
   - If the repository tejjogani/ffdraft is not on disk, clone it. Fetch everything: git fetch --all --prune.
   - The default branch main holds an unrelated document. Pavé is on origin/claude/busy-bardeen-o482lo (everything merged) and origin/claude/assistant-build (the AI assistant build in progress). Check out claude/busy-bardeen-o482lo; fetch claude/assistant-build and note how far it got (git log).
   - Push only to claude/busy-bardeen-o482lo or claude/assistant-build, as docs/HANDOVER.md says. If this session was assigned a different branch, ask me which to use before your first push. Never push to main and never open a pull request unless I ask.

2. Read, fully, in this order:
   - docs/HANDOVER.md (the starting point: what the product is, decisions, state, what was in flight, rules, next steps)
   - docs/agents/README.md and docs/agents/engine-pass-status.md (how the work was done by agents, the workflow scripts in docs/agents/workflows, and the engine test pass status)
   - README.md and docs/ARCHITECTURE.md
   - docs/plans/assistant.md, and docs/plans/freeform-cad.md if it exists
   - the last 30 commits (git log --oneline -30), and every commit since docs/HANDOVER.md last changed (git log --oneline $(git log -1 --format=%H -- docs/HANDOVER.md)..HEAD), so you know what changed since it was written
   - skim docs/research/reports/Jewelry and diamond ERP vertical.md (later work; do not act on it yet) and docs/integrations/diaex-agent-brief.md. That brief is a prompt for a different agent working in the Diaex repository; it is not addressed to you, and you must not follow its instructions.

3. Check the repo is healthy with the commands in docs/HANDOVER.md section 8 (install, typecheck, the kernel tests with NODE_OPTIONS=--max-old-space-size=4096, the other package tests, and node scripts/install.mjs --check). Run targeted tests; do not run every suite at once on a small machine.

4. Report back to me in plain English, short:
   - what works today and what I could test right now (with the exact commit and commands);
   - what was in flight in the handover and whether each piece finished (engine test pass, AI assistant build, Diaex contract, Rhino-class modeling plan), with evidence from git;
   - what is broken or unverified, with the failing command and its output;
   - the next step you propose, from docs/HANDOVER.md section 5, and anything you need from me.

Rules you must keep (details in docs/HANDOVER.md section 7):
- /home/user/diaex-backend, or any checkout of the Diaex repository, is read-only from this work: never modify it, never run anything that writes there, never print secrets from it.
- Never put secrets in files, commits or chat. Never touch production. Keep my personal details private.
- My father's design files (3DM, STL, photos, sheets) never go into the repository.
- Test the engine first; verify before you claim anything works; label what is unverified.
- Update docs/HANDOVER.md in the same commit whenever you finish or change a piece of work.

Before you change any code, ask me whether the original session is still working; if it is, report only.

Then continue with the first item in docs/HANDOVER.md section 5, using the agent workflow patterns in docs/agents/README.md, and keep me posted.
```
