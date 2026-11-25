# Prompt for lane C: accounts, API connectivity and the ERP side (research only)

Paste the block below into a new Claude Code session on the founder's laptop (any account; it can run alongside lane B in a separate clone). It researches and plans; it writes no product code. It pushes only to **`claude/integrations-research`**, and the cloud session (lane A) merges its documents.

---

```text
You are lane C on Pavé, an AI-native jewelry design suite I am building (I am the founder). Your job is research and planning for accounts, API connectivity and the ERP side. You write no product code. Other sessions are building on other branches; never touch their branches.

1. Set up your own working copy. Never work in a folder another session uses, and never touch another session's branch.
   - The repository is https://github.com/tejjogani/ffdraft (private; use my GitHub login on this laptop: check with `gh auth status`, or use SSH).
   - If there is no copy on this laptop yet:
       git clone https://github.com/tejjogani/ffdraft.git ~/pave-lane-c
       cd ~/pave-lane-c
     If I already have a copy here, add a separate working tree from inside it instead:
       git fetch origin
       git worktree add ~/pave-lane-c -B claude/integrations-research origin/claude/busy-bardeen-o482lo
       cd ~/pave-lane-c
   - Run `git fetch origin`. The default branch `main` holds an unrelated document. Pavé lives on these branches:
       claude/busy-bardeen-o482lo   the integration branch (everything merged); read only for you
       claude/assistant-build       the AI assistant being built by the cloud session; read only for you
       claude/integrations-research yours: the only branch you push to
   - Switch to your branch: if origin/claude/integrations-research already exists, `git checkout -B claude/integrations-research origin/claude/integrations-research`; otherwise `git checkout -B claude/integrations-research origin/claude/busy-bardeen-o482lo`.
   - Check that `git status` says "On branch claude/integrations-research". Push with `git push -u origin claude/integrations-research`. If a push is rejected, `git pull --rebase origin claude/integrations-research` and push again. Never push to any other branch, never force-push, never open a pull request, never rewrite pushed history.
   - Before starting each new file, take in what other sessions have merged: `git fetch origin && git merge origin/claude/busy-bardeen-o482lo` (in docs, keep both sides of a conflict).
   - Change only these paths: docs/research/, docs/plans/ and docs/inbox/integrations/. You do not need to install or run the app for this research; if you do, only in your own folder.
   - Commit messages are plain English and end with your own session's attribution lines; no model names.

2. Read fully first: docs/PLAN.md, docs/HANDOVER.md, docs/agents/OPERATING-MODEL.md, docs/agents/BOARD.md (your item is C1), then the earlier work you build on:
   - docs/research/reports/Jewelry and diamond ERP vertical.md and its notes in docs/research/research_notes/ (their facts were search extracts only; you can open sources, so verify or correct them)
   - docs/strategy/catalog-import-and-store.md, docs/strategy/product-strategy.md, docs/research/10-market.md section 3, docs/research/08-channels.md, docs/plans/publishing.md
   - docs/integrations/diaex-partner-api.md (the contract with Diaex, our stone marketplace)
   - in the code: apps/server/src (auth: PAVE_AUTH local and accounts, organisations and roles) and, on origin/claude/assistant-build, how API keys for AI providers are stored.

3. Keep a status file, docs/inbox/integrations/STATUS.md: done (with paths), now, next, questions for me. Commit and push it after every finished file.

4. Research, opening sources yourself. Label every claim [V] verified at the source with its link, [S] search result only, or [E] your estimate. Never put Diaex, Aska, Pavé, Heera or any family name into a search query.
   A. Accounts and identity: local accounts today versus hosted later; organisations, roles and invitations; sign-in with Google, Microsoft and Apple; linking a Pavé organisation to a Diaex company (the contract's OAuth with PKCE); API keys and scopes for developers; audit logs; what changes when a local install later connects to hosted Pavé.
   B. ERP, point-of-sale and accounting connectivity, system by system: The Edge, Jewel360, Ornate and the other Indian jewellery packages, Tally Prime (XML over HTTP, ODBC), PIRO, Valigara, Shopify and Shopify POS, Lightspeed, QuickBooks Online, Xero, Zoho Books, SAP Business One, Dynamics 365 Business Central, NetSuite, Odoo. For each: is there an API (REST, SOAP, GraphQL, ODBC) or only file import and export; how it authenticates; which objects it exposes (items and SKUs, stock, customers, orders, memos and consignment, repairs, metal accounts); webhooks; rate limits; sandbox or developer access and its cost; import file formats with their column specs; partner or app-store requirements; terms that restrict building a connector.
   C. Connector architecture for Pavé: a connector SDK shape; a sync engine (one owner per field, idempotent inbound events, an outbox, webhooks to trigger and polling to decide, conflict rules, overselling protection for one-of-a-kind pieces); credential storage; local-first limits (no public address, so polling; an on-site agent for desktop ERPs behind a firewall); testing with fakes and recorded fixtures. Order the first connectors by the ERP report's sequence: item-master and job-package export (CSV and JSON, Tally XML, The Edge's import columns) before any live two-way sync.
   D. Developer access to Pavé: a public API, webhooks, and file feeds (SFTP or similar) for catalogue data and images per piece, with keys, scopes, rate limits and a docs portal.
   E. How Diaex fits: the partner API contract for stone sourcing, and reading a supplier's stock from an ERP through a read-only bridge. Describe it generically; do not name the founder's or his family's businesses or systems in anything you search.

5. Write, one file at a time, committing and pushing each:
   - docs/research/19-erp-and-pos-apis.md (the system-by-system findings, with a comparison table)
   - docs/research/20-accounts-and-identity.md
   - docs/plans/integrations-hub.md and docs/plans/accounts-and-developer-api.md, in the repo's plan style (1. Experience, 2. Structure, 3. Contract changes, 4. Hard parts and decisions with what was rejected and why, 5. Verification, 6. Scope cuts, 7. Build order in testable steps)
   - When done, have a fresh agent review each plan adversarially (feasibility, security of credentials and tokens, terms of service, cost), fix what it finds, and put a short summary for me at the top of STATUS.md.

Rules: never touch any checkout of the Diaex repository; never put secrets in files, commits or chat; keep my personal details private and out of web searches; plain English, short sentences. If something in the repo looks out of date, say so in your status file instead of guessing.
```
