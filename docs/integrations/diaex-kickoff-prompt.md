# Kickoff prompt for the Diaex agent

Paste the block below into a Claude Code session working in the Diaex backend repository, and attach (or paste after it) the full brief, `docs/integrations/diaex-agent-brief.md`. The brief is self-contained: the Diaex agent cannot read Pavé's repository.

```text
I'm Tej. Attached is a brief from Pavé, my jewelry design app, asking Diaex for a partner API so Pavé can source real stones from Diaex. Read the whole brief before doing anything (Parts A to D: the request, the full contract, what the plan must cover, and the OpenAPI file).

First, pull the latest main of this repository. The brief's diaex: references were read at commit 3fa756d; check each one you rely on and correct the brief in your plan where the code has moved.

Then do stage 1 of our process exactly as AGENTS.md and docs/process/1-plan.md describe: write the plan at docs/plans/<today's date>-pave-partner-api.md, covering what Part C asks for: the hypothesis, every edge case with the test that proves it, the PR split under our size limit (each PR with its branch name, its stream and its tests), and decisions D1, D2 and so on, each with your proposal. Scope the plan to v1 first; list v1.1 and v2 as later steps. Write no code until I reply "approved".

After I approve, build v1 in the order of the plan: one branch and one PR per step, tests first, following docs/process/2-build.md, each PR reviewed by a fresh agent under docs/process/3-review.md before I look at it. Keep to every hard limit in AGENTS.md (Firestore read-only, production untouched, no secrets in files or chat, nothing written until a form is finished, the two work streams kept apart, tests on a throwaway database).

Done for v1 means the shared contract tests in the brief pass against a Diaex test server. Ask me whenever a decision is mine.
```
