# Brief for the Diaex agent: a partner API for Pavé

You are working in the Diaex backend repository. This brief is pasted to you by Pavé's founder, who also owns
Diaex. You cannot read Pavé's repository, so everything you need is below: the request (Part A), the contract in
full (Part B), what the plan must cover (Part C), and the OpenAPI file in full (Part D). **This brief asks you for a
plan, not for code.**

How to read references: `diaex:` paths are in your repository, read at commit `3fa756d` (23 November 2026).
Check each one yourself before you rely on it, and correct this brief in your plan where the code has moved.
Paths without `diaex:` are in Pavé's repository; they are there for the founder, and you do not need them.

---

## Part A: the request

### 1. Who is asking, and why

**Pavé** is an AI-native jewellery design suite: design, then CAD, then render. It runs on a designer's own
computer (local-first, with no public address) or hosted. When a designer builds a piece, every stone in it
becomes a **requirement**: shape, seat size in millimetres with a tolerance, quality, quantity.

Pavé wants **Diaex as its stone source**: find real stones that fit each requirement, check they are still
available, show price when the designer's company may see it, hold stones while a piece is decided, and hand the
purchase over to Diaex.

Already decided by the founder:
- A Pavé customer's designs and CAD are **never visible to Diaex staff**. Pavé sends stone specifications only.
- Diaex lists **diamonds only**: natural and lab-grown, white and fancy colour. No coloured gemstones, no melee
  parcels.
- Diaex's **Buy is not open**, and its Terms say Diaex does not process payment.
- **Prices go only to verified (KYC-approved) companies.** Signed-out callers can check availability without
  price.

This brief does not change how Diaex works. **Tej still approves the plan and reviews every pull request.**
If anything here conflicts with `diaex:AGENTS.md` or `diaex:docs/process/`, those win; say so in the plan.

---

### 2. What to do now: stage 1 of Diaex's process, and stop

Follow Diaex's process exactly (`diaex:AGENTS.md:5-13`, `diaex:docs/process/1-plan.md`).

1. **Read first:** `diaex:AGENTS.md`, `diaex:docs/process/1-plan.md`, `2-build.md`, `3-review.md`,
   `diaex:.github/pull_request_template.md`, then every file in section 3 below, and, for the screens,
   `diaex:docs/design/README.md` and `diaex:docs/design/AGENT-GUIDE.md`. Read DiaEx's own code at `~/aska-platform`
   (read-only) before asking anything, and never ask Tej what the repository already answers
   (`diaex:docs/process/1-plan.md:8-10`).
2. **Talk it through with Tej:** one question at a time, the one whose answer most changes what gets built; two or
   three ways to build each part with what each trades off, and your recommendation; a link to a real source for
   every "best practice" claim; **no invented numbers** (`diaex:docs/process/1-plan.md:11-16`). The numbers in this
   brief (limits, hold lengths, caps) are proposals for Tej, not facts: say so, or measure.
3. **Write the plan** at `docs/plans/2026-11-24-pave-partner-api.md` with the nine parts
   `diaex:docs/process/1-plan.md:20-41` asks for:
   1. Hypothesis: "If we build X, then Y happens for Z, and we will know because W."
   2. Scope: goals, non-goals, and what would make it a failure even if it technically works.
   3. Where things stand, with `file:line` (start from section 3 below).
   4. Approaches considered, and the one chosen.
   5. The design: server and data; screens (Account, Connected apps; the staff view; the OAuth consent page),
      website and app view; what signed out, signed in, verified and staff each see.
   6. **Edge cases, each with its test** (three columns: case, expected, test). Start from Part C, section 4 and the
      shared cases in the contract (Part B, section 10).
   7. Measurement: what is counted per link per day.
   8. **The PR split**, each step at most 400 counted lines (tests and SQL count) and working on its own, with a line
      estimate per step kept under 300. Start from Part C, section 5.
   9. **Decisions for Tej**, D1, D2, …, each with a proposal. Start from Part C, section 6.
4. **Open the plan as a pull request containing only the plan**, on a branch such as `plans/pave-partner-api`
   (`diaex:docs/process/1-plan.md:45`). Markdown is not counted toward the size limit
   (`diaex:scripts/pr_size.py:25`).
5. **Stop.** No code, no schema change, no test until Tej writes **approved** (`diaex:AGENTS.md:9`,
   `diaex:docs/process/1-plan.md:46`). A change of scope found later goes back to the plan first
   (`diaex:docs/process/1-plan.md:47`).

When building starts, after approval (`diaex:docs/process/2-build.md`):
- One branch and pull request per step, named `<area>/<short-name>` (`diaex:AGENTS.md:34-35`); never commit to
  `main`. **One PR does one thing**, with no drive-by refactors (`diaex:AGENTS.md:33`). A step that needs the one
  before it branches from that step's branch and says so in its PR (stacked PRs, `diaex:docs/process/2-build.md:60-62`).
- Tests first; each must fail for the reason the plan predicts (`diaex:docs/process/2-build.md:7-10`).
- Python tests only on a throwaway database, with the one chained command (`diaex:AGENTS.md:65`,
  `diaex:docs/process/2-build.md:14-27`). Your server runs on port 8001; leave 8000 alone (`diaex:AGENTS.md:63`).
- `python3 scripts/pr_size.py` at 400 or fewer (`diaex:scripts/pr_size.py:22-23`). **Tests, SQL and config count**;
  only lock files, `docs/diagrams/*.svg` and Markdown do not (`diaex:AGENTS.md:20-24`, `diaex:scripts/pr_size.py:25`).
- **Every PR description fills in the template** (`diaex:.github/pull_request_template.md:1-22`): What changed,
  **Plan step** (the plan file and the step number), Concurrency and failure assumptions, **Speed and efficiency**,
  How it was checked, Not done yet (`diaex:AGENTS.md:37-44`, `diaex:docs/process/2-build.md:45-48`). For every route
  a PR adds or changes, Speed and efficiency gives: SQL statements and pool connections per request;
  `EXPLAIN (ANALYZE, BUFFERS)` of the main queries on a real-size copy of the stones in a throwaway database; p50 and
  p95 over at least 50 requests; the reply size raw and gzipped; each with the command that produced it
  (`diaex:docs/process/3-review.md:38-41`, `diaex:docs/process/2-build.md:28-29`). **A route with no speed numbers is
  a must-fix, so the review FAILs** (`diaex:docs/process/3-review.md:93`).
- **Screens** (Connected apps, the staff view, the OAuth consent page, and any change to how a stone link opens).
  Read `diaex:docs/design/README.md`, then `diaex:docs/design/AGENT-GUIDE.md` (`diaex:AGENTS.md:127-129`). Show Tej
  the first screen before building the rest (`diaex:AGENTS.md:53`). **The old flat look stays exactly as it is until
  Tej switches a screen over** (`diaex:AGENTS.md:117-118`): no PR may change it without his written OK. New-look
  rules live under `html[data-ui="2"]` (`diaex:AGENTS.md:119-122`); data never sits on glass, stone surfaces keep
  8 px corners, and no new override CSS (`diaex:docs/design/AGENT-GUIDE.md:34-37`). Before writing, read the screen's
  rows in `docs/design/SCREENS.md` and run the map check (`diaex:docs/design/AGENT-GUIDE.md:7-11`). The guide names
  `python3 tools/check_map.py`, later `python3 scripts/ui_map.py check`; neither file is in the checkout at `3fa756d`,
  so the plan says which applies. Done means (`diaex:docs/design/AGENT-GUIDE.md:39-48`): every row id checked by eye;
  the app view (`?app=1`) at 390 and 320 px and the website at 1280 and 1440 px, each with a screenshot, `?app=0`
  afterwards, nothing scrolling sideways; signed out, signed in not verified, verified, verified on markup, and Pro
  wherever access differs; Reduce Motion on; the map updated; web tests, type check and build passing; the PR's four
  parts plus the row ids. A screen's tests run in both looks (`diaex:web/vitest.workspace.ts`, `diaex:AGENTS.md:129`).
- Every new file in the file map of `docs/ARCHITECTURE.md`, every class in `docs/TYPES.md`, every route in
  `docs/ARCHITECTURE.md` (`diaex:docs/ARCHITECTURE.md:15-17`) and classified in `tests/test_pro_routes.py`
  (`diaex:tests/test_pro_routes.py:17-19`).
- A new database test file carries the `skipif(not DB)` mark (`diaex:AGENTS.md:74-76`).
- Two streams share the repository: accounts, web and browse; and sourcing (`app/sourcing/`, the sourcing part of
  `db/schema.sql` from `diaex:db/schema.sql:1093`). Never commit the other stream's changes; shared files are
  staged part by part (`diaex:AGENTS.md:87-92`).
- Hard limits (`diaex:AGENTS.md:78-93`): DiaEx's code at `~/aska-platform` is read-only; Firestore read only;
  production never touched; no secrets in files, commits, PRs or chat; `.env` and `web/.env.local` are Tej's; request
  files use `{{NAME}}` placeholders. A partner token is a secret. **Our database: nothing is written until a form is
  finished** (`diaex:AGENTS.md:93`). So the plan says when each new row is written: a link only when the make form is
  submitted; an OAuth code only when the person presses Allow, never when the consent page is opened. Whether a usage
  count may be written on every read call (contract section 7) is decision D18.
- New dependencies need Tej's OK (`diaex:AGENTS.md:56`).
- Review by a fresh agent (`diaex:docs/process/3-review.md:3-5`): **PASS** or **FAIL** on the first line
  (`diaex:docs/process/3-review.md:74-76`). After 3 FAIL rounds on the same PR, stop and bring it to Tej
  (`diaex:docs/process/3-review.md:108-109`). The security check matters most here: "DiaEx once leaked its cost book
  by sending a raw record" (`diaex:docs/process/3-review.md:23-24`).

---

### 3. What Diaex has today, and what is new

#### 3.1 Usable as it is (signed out allowed, no price)

| What | Where |
|---|---|
| Browse search with every filter Pavé needs except height and "any lab" | `POST /api/search`, `diaex:app/main.py:1170-1179`, `diaex:app/catalog.py:60-112`, `diaex:app/browse.py:164-189` |
| Availability for up to 100 stones, signed out, `available` true or false plus `missing` | `POST /api/stones/batch`, `diaex:app/main.py:1182-1187`, `diaex:app/browse.py:340-359` |
| One stone, `on_hold` shown, 404 `stone_unavailable` when sold or gone | `GET /api/stones/{public_id}`, `diaex:app/main.py:1190-1201`, `diaex:app/browse.py:314-337` |
| Sets of 2 to 70 stones by shape, carat or mm, count, grades, type, locked, exclude | `POST /api/layouts/search`, `diaex:app/main.py:1243-1263`, `diaex:app/layouts.py:74-147,302-374` |
| Sets by positions (up to 6) | `POST /api/sets/search`, `diaex:app/main.py:1266-1277`, `diaex:app/set_positions.py:29` |
| Size of stock for a shape and carat | `GET /api/layouts/size-estimate`, `diaex:app/main.py:1280-1287` |
| Public photo proxy, widths 96 / 256 / 512 / 1024 | `diaex:app/photo_route.py:40-43,66-74`, `diaex:app/photo_resize.py:14-15` |
| All of these are on the free routes list | `diaex:tests/test_pro_routes.py:30-37` |

#### 3.2 The rules the partner API must re-use, not copy

| Rule | Where |
|---|---|
| Access levels `signed_out`, `not_approved`, `approved`, `staff`; the fields each may see | `diaex:app/browse.py:22-25,28-59` |
| Verified = KYC approved, person active, company not turned off; read on every request | `diaex:app/browse.py:1-3,94,118-139` |
| Markup companies: prices raised by a whole percent, ASKA as the supplier | `diaex:db/schema.sql:399-401`, `diaex:app/browse.py:45-64,272-282`, `diaex:app/stone_rows.py:61-64` |
| Supplier card only for verified non-markup buyers and staff | `diaex:app/browse.py:272-290` |
| Price filters dropped and reported for locked callers | `diaex:app/browse.py:153-161` |
| The one list of fields a caller may receive | `diaex:app/catalog.py:232-243` |
| Prices shown in whole dollars | `diaex:app/stone_rows.py:53-55,82-83` |
| Length is the longer side | `diaex:app/stone_rows.py:38-39,84` |
| Report links only for well-formed IGI, GIA, GCAL numbers | `diaex:app/stone_rows.py:12-13,42-50` |
| Who sees a stone: `_FEED`, `LISTED`, `AVAILABLE`, `IN_STOCK` | `diaex:app/catalog.py:375-399` |
| Memo stones shown but never picked for a set, carted or bought | `diaex:db/schema.sql:116-124`, `diaex:app/catalog.py:393-399` |
| Matching rules for pairs and layouts; carat band | `diaex:app/matching.py:20-54,234-239` |
| An mm target held on both sides for a round, only on the length for a fancy shape | `diaex:app/layouts.py:235-238` |
| Engine limits: 2,000 candidates, 2 searches at once, 2 s each | `diaex:app/pairs.py:25-29` |
| Error shape; 422 never echoes values; 429 with `Retry-After`; request ids | `diaex:app/main.py:164-182,215-232,257-262` |
| Sealed cursors bound to the access level; `limit` 1 to 100 | `diaex:app/browse.py:81-86`, `diaex:app/catalog.py:253-260` |
| Request log keeps ids and status, never bodies | `diaex:app/main.py:196-206` |
| Stone change history: `first_seen`, `price_change`, `gone`, `back` | `diaex:db/schema.sql:176-193` |
| Allocations: one held per stone by a unique index on that table alone, no end time of their own, only from a Buy, hide the stone from everyone | `diaex:db/schema.sql:1496-1511`, `diaex:docs/SOURCING.md:181-207` |
| A proposed 12-hour expiry on a buyer approval would release an allocation (*proposed, to confirm*) | `diaex:docs/SOURCING.md:176-179` |
| The Buy reads `LISTED`, not `AVAILABLE`: a held stone goes on to its hold, which answers `taken`. So a change to `AVAILABLE` alone does not stop a Buy | `diaex:app/catalog.py:385-387`, `diaex:app/sourcing/api.py:111-117` |
| Browse shows memo stones by default, tagged, and has an `availability` filter (`available`, `memo`) | `diaex:app/catalog.py:110-112,388-389` |
| Sold marks hide a stone everywhere | `diaex:db/schema.sql:1516-1535` |
| Only a Buy gives priority; an RFQ reserves nothing | `diaex:docs/SOURCING-SPEC.md:117-119,219-221` |
| Buy needs Pro, `BUY_ENABLED` and a verified company; production leaves it closed | `diaex:app/sourcing/api.py:111`, `diaex:app/launch.py:1-12` |
| Terms: Diaex does not accept orders or process payment | `diaex:web/src/routes/legal/Terms.tsx:37-41` |
| KYC states (`not_submitted`, `submitted`, `approved`, `rejected`); staff set them | `diaex:db/schema.sql:393-394`, `diaex:app/staff_routes.py:231` |
| Company audit actions are a fixed list | `diaex:db/schema.sql:448-465` |
| A fake catalogue for tests | `diaex:app/catalog.py:695-700` |
| `?stone=<id>` opens a stone only in the new look, and only ids of at most 64 characters | `diaex:web/src/stone/address.ts:1-3,13-18` |
| The built web app shows the new look by default; tests keep the flat look as their default | `diaex:web/src/lib/uiVersion.ts:49-52` |
| Id limits today: 128 in layouts, 100 in the batch route, 92 escaped characters in a cursor | `diaex:app/layouts.py:29`, `diaex:app/browse.py:342`, `diaex:app/catalog.py:254` |

#### 3.3 What does not exist

- **No partner credentials.** Sign-in is a Firebase browser token (`diaex:app/auth.py:1-14,177-194`). The only
  machine tokens are Aska's two office feed tokens, which Aska sends to Diaex as bearer tokens to read its own stones
  (`diaex:app/aska_feed.py:33-34,164-173`), and the internal Ed25519 tokens one Diaex service gives another, such as
  the voice token (`diaex:app/service_tokens.py:1-7`, `diaex:app/auth.py:142-147`).
- **No limits on search, stones, match or layouts**, and the limits that exist are per server process
  (`diaex:app/limits.py:1-12,67-73`, `diaex:app/contact_routes.py:12-13`).
- **No hold "while deciding"**; saved set plans reserve nothing (`diaex:db/schema.sql:951-962`).
- **No CORS** and none needed: Pavé calls from its server. `api.thediaex.com` is planned for machine callers
  (`diaex:docs/plans/2026-10-26-render-deploy.md:144,389`).
- **No partner API is built or planned.** The nearest note is the backlog item on describing a piece of jewellery
  to the assistant (`diaex:docs/plans/2026-11-04-ai-jewellery-composition-todo.md:1-17`).

Two things to know: (1) `AGENTS.md` says the new look is off by default (`diaex:AGENTS.md:114-116`), but the built
web app shows it when neither the browser nor the account chose (`diaex:web/src/lib/uiVersion.ts:49-52`), and the API
puts every account on it unless `NEW_LOOK` says otherwise (`diaex:app/main.py:617-624`); any new screen must still work
in both looks, and the flat look must not change. (2) Four plans the code cites
are not in `docs/plans/` in this checkout: production-v1, cart-gate (`diaex:app/launch.py:1-2`), erp-availability
(`diaex:db/schema.sql:716-717`) and stock-badge (`diaex:app/catalog.py:110`).

#### 3.4 New work, and which stream owns it

| # | New piece | Stream |
|---|---|---|
| N1 | Partner links: tokens stored hashed, shown once, scoped, revocable, audited | Accounts |
| N2 | A token turned into the same `Access` as a sign-in, read on every request | Accounts / browse |
| N3 | The `/partner/v1` router with stable shapes, absolute photo addresses, money as strings | Browse |
| N4 | Filters: height limit, "any lab", the seat window; the fit score and sort | Browse |
| N5 | Sets with the seat window on both sides for fancy shapes | Browse |
| N6 | Many requirements in one call, with one deadline | Browse |
| N7 | Five availability statuses, `etag` and `updated_at` per stone | Browse (reads sourcing tables, writes none) |
| N8 | Limits shared across servers, per link and per address; daily priced-stone count; usage counts | Accounts / browse |
| N9 | Connected apps screen; staff view of links and usage | Accounts / web |
| N10 | A stone's `url` that opens it from a browser on either look (decision D17; changing the flat look needs Tej's written OK) | Web |
| N11 | Test mode with the fixture set | Browse |
| N12 | OAuth 2.0 with PKCE, loopback redirect, consent page (v1.1) | Accounts / web |
| N13 | Holds with an end time (v1.1) | **Sourcing** for the table and for the Buy refusing a held stone; **browse** for `AVAILABLE`. Cross-stream: decision D8 |
| N14 | Watch list and events feed (v1.1); optional webhooks | Browse for stone events; sourcing events need agreement (D9) |
| N15 | Hand-off (v2) | Browse for a shortlist; sourcing for any cart or Buy |

---

## Part B: the contract

What follows is the contract Pavé and Diaex agree on, word for word as Pavé holds it
(`docs/integrations/diaex-partner-api.md`), sections 1 to 11; its decisions are in Part C, section 6. The same
contract as OpenAPI 3.1 (`docs/integrations/diaex-partner-api.openapi.yaml`) is Part D, in full; some field limits
are only there (list defaults, carat and height ranges, list caps, id patterns, the `code_verifier` length). **When the
two disagree, Part B wins on meaning and Part D wins on field limits; any difference is a bug to report.** Where your
plan changes any of it, list the change in the plan so Pavé can follow. Section numbers inside Part B are the
contract's own ("Part B, section 5.3").

### 1. Purpose and scope by phase

Pavé turns every stone in a design into a requirement row (`packages/sourcing/src/requirements.ts:67-105`). Pavé
needs Diaex to find real stones that fit each row, say whether they are still there, show price when the
designer's company may see it, hold stones while a piece is decided, and hand the purchase over to Diaex. Pavé
never takes payment: Diaex's Terms say Diaex does not accept orders or process payment
(`diaex:web/src/routes/legal/Terms.tsx:37-41`).

| Phase | What ships | Why this order |
|---|---|---|
| **v1 (now)** | Pasted partner token, "who am I", revoke. Search one requirement. Matching pairs and layouts. Many requirements in one call. Availability for up to 100 stones. Stone detail with photos and certificate. Price only for verified companies. Errors, limits, test fixtures. | Unblocks Pavé's empty Sourcing tab (`apps/studio/src/features/sourcing/index.tsx:9-28`). Almost all of it re-uses Diaex code that already answers signed-out callers (`diaex:app/main.py:1170-1287`). |
| **v1.1 (next)** | OAuth 2.0 sign-in with PKCE and a loopback redirect. Holds with an end time, one extension, release. A watch list and an events feed Pavé polls. Optional signed webhooks for hosted Pavé. | Needed once a designer chooses between stones. Holds need Tej's decision and touch both Diaex streams. |
| **v2 (later)** | Hand-off of the chosen stones to Diaex (an enquiry list now, a cart and checkout once Buy opens). A jewellery store on thediaex.com. | Buy is closed (`diaex:app/launch.py:1-12`) and the Terms say no orders (`diaex:web/src/routes/legal/Terms.tsx:38-39`). |

**Out of scope, on purpose.** Diaex lists diamonds only, natural and lab-grown, white and fancy colour
(`diaex:db/schema.sql:15`). It lists no coloured gemstones, no moissanite, no metals and no melee parcels: one row
per stone, carat to 0.01 ct (`diaex:db/schema.sql:17`), layouts of at most 70 stones (`diaex:app/layouts.py:25`).
Pavé keeps those items as a plain bill of materials. The API answers them with a clear `unsupported` reason
(section 5.3) so Pavé never sends a designer to an empty page. No "wanted" requests, no metal quotes.

---

### 2. Principles

1. **Versioned under `/partner/v1`.** Base address `https://api.thediaex.com/partner/v1` (**New**; the deploy plan
   keeps `api.thediaex.com` for machine callers, `diaex:docs/plans/2026-10-26-render-deploy.md:144`). A Diaex
   test server answers the same paths at its own address.
2. **Additive changes only within v1.** Diaex may add endpoints, optional request fields, response fields and enum
   values. Pavé must ignore fields it does not know and treat an unknown enum value as "other". Every fixed list
   (error codes, availability statuses, hold statuses and reasons, event types, `unsupported` reasons) is open: the
   OpenAPI file marks each with `x-extensible-enum`, and a client must not refuse a reply for a value it does not
   know. An unknown availability or hold status means **not pickable**. Anything else is `/partner/v2`, with both
   versions served for at least 6 months and a `Sunset` header (RFC 8594) on the old one.
3. **Strict requests.** Diaex refuses a request field it does not know with 422, as its search and layout models do
   today (`extra="forbid"`, `diaex:app/catalog.py:64`, `diaex:app/layouts.py:77`; not every model does: the chat body
   has no such setting, `diaex:app/main.py:248`). Every partner model sets it (**New**). This also keeps anything but stone
   specifications out of Diaex (section 9).
4. **Opaque string ids.** A stone's `id` is Diaex's public id, the only id callers see today
   (`diaex:db/schema.sql:91-93`, `diaex:app/browse.py:20-22`). The partner API takes and sends ids of **at most 64
   characters**, the most a `?stone=` link opens (`diaex:web/src/stone/address.ts:18`). Today the limits differ: the
   layout route takes 128 (`diaex:app/layouts.py:29`), the batch route 100 (`diaex:app/browse.py:342`), and a cursor
   seals at most 92 escaped characters (`diaex:app/catalog.py:254`). **New**: Diaex confirms no listed stone has a
   longer public id, or raises all of these together. An id in a path is percent-encoded, dots included, as Diaex's
   photo links do (`diaex:app/photo_route.py:41-42`). Hold, event, link and webhook ids are prefixed strings (`hld_`,
   `evt_`, `lnk_`, `whk_`). Pavé never parses an id.
5. **Times** are UTC, ISO 8601, with `Z`, to the second: `2026-11-24T18:02:11Z`.
6. **Sizes.** Millimetres as JSON numbers with at most 2 decimals, as Diaex stores them
   (`numeric(7,2)`, `diaex:db/schema.sql:29-31`). Carats as numbers with at most 2 decimals
   (`numeric(8,2)`, `diaex:db/schema.sql:17`). Percentages with at most 2 decimals (`diaex:db/schema.sql:35-40`).
   `length_mm` is always the longer side (`diaex:app/stone_rows.py:38-39,84`).
7. **Money** is `{ "amount": "6120.00", "currency": "USD" }`: a decimal string with exactly 2 decimals and an
   ISO 4217 code. Diaex v1 sends USD only and whole dollars (`.00`), because it shows whole dollars today
   (`diaex:app/stone_rows.py:53-55,82-83`). A hidden price is `null`, never a missing key.
8. **Pages.** Lists take `limit` (1 to 100) and `cursor`, and answer `next_cursor` (`null` at the end), as Diaex
   search does (`diaex:app/browse.py:81-86`). A cursor is sealed and bound to the caller's access level
   (`diaex:app/catalog.py:253-260`). **New**: a partner cursor is also bound to the link and to a hash of the request
   (the requirement and `sort`), so a cursor used with another link, level, seat or sort is refused with 400
   `bad_cursor` instead of returning the wrong page.
9. **Idempotency.** Every write (`POST` that changes state, `DELETE`) needs an `Idempotency-Key` header: 1 to 64
   characters of `A-Z a-z 0-9 _ -`. Without it: 422 `idempotency_key_missing`. A key is kept 24 hours and belongs to
   one link, one method and one path. The same key on the same method and path with the same body answers the first
   reply again, **exactly as it was** (a replayed `POST /holds` still says `active` after the hold has ended; Pavé
   reads `GET /holds/{id}` for the status now). The same key with a different body, method or path: 422
   `idempotency_key_reused`. While the first is still running: 409 `idempotency_in_progress`. Exempt by name:
   `POST /oauth/token` and `POST /oauth/revoke` (OAuth's own rules; revoking twice is harmless, RFC 7009). Searches
   are `POST` but write nothing and need no key. **New.**
10. **One error shape** with stable codes (section 6), based on the shape Diaex uses today
    (`diaex:app/main.py:257-262`, `diaex:app/sourcing/api.py:88-94`), with two deliberate changes (**New**): a 422's
    `detail` moves inside `error` (today it sits beside it, `diaex:app/main.py:230-232`), and the partner API leaves
    out today's `session_id` (`diaex:app/main.py:260`), which belongs to the chat.
11. **429 with `Retry-After`** in whole seconds, as today (`diaex:app/main.py:215-220`).
12. **Request ids.** Every reply carries `x-request-id: req_<32 hex>` (`diaex:app/main.py:169,182`). Pavé may send
    `X-Client-Request-Id` (1 to 64 of `A-Z a-z 0-9 _ -`, `diaex:app/main.py:60,172-176`); Diaex logs it next to its
    own.
13. **Server to server.** Pavé calls Diaex from its own server, on the designer's computer or hosted. The Diaex
    token never reaches a browser (`packages/sourcing/src/provider.ts:32-37`). So the partner API needs no CORS;
    Diaex has none today (`diaex:docs/plans/2026-10-26-render-deploy.md:389`). Photo addresses are plain public
    image links a browser can load (`diaex:app/photo_route.py:66-69`).
14. **Gzip** for replies of 500 bytes or more, as today (`diaex:app/main.py:159-161`).

---

### 3. Authentication and linking

#### 3.1 What is being linked

A **Pavé organisation** (`org_…`) is linked to a **Diaex company** through **one Diaex person** in it. In Pavé's
local mode that organisation is one person's studio on their own computer, with no fixed address
(`apps/server/src/auth/workspace.ts:41-64`, `apps/server/src/config.ts:57-65`). On Diaex a person belongs to one
company (`diaex:db/schema.sql:482-494`), and what a caller may see is worked out from that person and company on
every request, never cached (`diaex:app/browse.py:1-3,118-139`). The link keeps that rule: a token acts as the
person who made it, so a lost KYC, a removed person or a turned-off company changes the answer on the very next
request.

Proposal (decision D1): only a company's owner or admin may create a link; one link per Pavé organisation in v1.
Aska is two Diaex companies against one Pavé organisation (`docs/strategy/catalog-import-and-store.md:248`);
v1 lets Pavé hold one link, and choosing between two is later work.

#### 3.2 Three ways to call

| Caller | How | What it gets | Phase |
|---|---|---|---|
| **No token** | No `Authorization` header | Search, sets, match, availability, stone detail. No price, no supplier. Access level `signed_out`. Limits per address. | v1. Diaex answers signed-out callers today (`diaex:app/auth.py:190-194`, `diaex:app/browse.py:132-135`). |
| **Pasted partner token** | A Diaex owner or admin makes a token on Diaex (Account, Connected apps), names it, copies it once, and pastes it into Pavé's settings. Sent as `Authorization: Bearer dxp_live_…`. | Everything its scopes allow, at the company's access level. | v1. **New**: Diaex has no partner tokens today (`diaex:app/auth.py:1-14`). |
| **OAuth 2.0** | "Connect Diaex" in Pavé (section 3.4). | The same token rows as a pasted token, made by consent instead of copying. | v1.1. **New.** |

Tokens look like `dxp_live_<43 base64url characters>` (live) or `dxp_test_<…>` (test fixtures only, section 11).
Diaex stores only a SHA-256 hash and the last 4 characters, shows the token once, and lets the company list and
revoke it. Every create and revoke is written to Diaex's company audit log, whose actions are a fixed list today
(`diaex:db/schema.sql:448-465`), so two new actions are needed: `partner_link_created`, `partner_link_revoked`.
**New.**

#### 3.3 Scopes

| Scope | Allows | Phase |
|---|---|---|
| `stones:read` | `/me`, stone search, sets, match, availability, stone detail | v1 |
| `prices:read` | Price fields, only if the company is verified. Without it, a verified company's answers have no price. | v1 |
| `holds:write` | Place, extend, list and release holds | v1.1 |
| `events:read` | Watch list, events feed, webhooks | v1.1 |
| `handoff:write` | Hand chosen stones over to Diaex | v2 |

A call outside the token's scopes answers 403 `insufficient_scope`. Pro never unlocks anything here, as it never
unlocks prices on Diaex (`diaex:app/pro.py:39-45`).

#### 3.4 OAuth 2.0 with PKCE (v1.1)

Diaex is the authorization server. Pavé is the client. The flow is the authorization code grant with PKCE
(RFC 7636, `S256` only), as RFC 8252 says native apps must use.

- **Pavé on a designer's computer is a public client** (`client_id: pave-local`, no secret). Its redirect is a
  loopback address: `http://127.0.0.1:{any port}/oauth/diaex/callback`. Diaex must accept any port on the
  loopback IP literal (RFC 8252 sections 7.3 and 8.3) and refuse `localhost` and every other host. Pavé's local
  server already listens on 127.0.0.1 (`apps/server/src/config.ts:57-58`), so it receives the redirect itself.
- **Anyone can claim to be `pave-local`**, because a public client has no secret. So the consent page says plainly
  that **an app on this computer** is asking, shows the loopback port, the company and the scopes, and lets the person
  untick `prices:read` (and, in v1.1, `holds:write`). Only an owner or admin may press Allow (decision D1); any other
  member sees why and cannot. Whether the public client may ask for `holds:write` at all, or needs a fresh Diaex
  sign-in first, is decision D14. **New.**
- **Pavé's duties on the callback:** check that `state` is the one it sent and refuse the callback otherwise; handle
  `error=access_denied` (the person said no) by showing "Not connected" and storing nothing.
- **Installs that can use neither way** (for example a Pavé server reached across a studio's own network, which is
  not 127.0.0.1 on the person's computer and not a registered hosted client) connect with a pasted token. The OAuth
  device flow (RFC 8628) may come later.
- **Hosted Pavé is a confidential client** with its own `client_id`, a client secret (`client_secret_basic`) and
  exact `https` redirects registered with Diaex.
- **Steps.** (1) Pavé opens `https://console.thediaex.com/oauth/authorize?response_type=code&client_id=…&redirect_uri=…&scope=stones:read%20prices:read&state=…&code_challenge=…&code_challenge_method=S256`
  in the browser. (2) The person signs in to Diaex as today (Firebase, `diaex:app/auth.py:6-9`) and sees which
  company, which scopes and which app. (3) Diaex redirects to the loopback address with `code` and `state`. The
  code is single-use and lasts 5 minutes. (4) Pavé's server posts the code and `code_verifier` to
  `POST /partner/v1/oauth/token`.
- **Tokens.** Access token 1 hour; refresh token rotated on every use. Reusing an old refresh token revokes the
  whole link (OAuth 2.0 Security Best Current Practice, RFC 9700), **except inside a short grace window**: for 30
  seconds after a refresh (a number for Tej, D13), the previous refresh token answers the same new pair again instead
  of ending the link, so two refreshes at the same moment do not disconnect the designer. **Pavé allows only one
  refresh at a time per link** (a lock per link, across all its server processes when hosted). A link idle for 90
  days ends. Proposal, decision D13.
- **Server to server for hosted Pavé.** Hosted Pavé's server keeps each organisation's refresh token and calls
  Diaex directly. It may also use `grant_type=client_credentials` for an app token with `stones:read` only, at
  the `signed_out` level: no company, no price. That gives hosted Pavé its own limit bucket for unlinked
  organisations. There is no server-to-server way to prices without a person's consent.
- **The token endpoint's errors** use the OAuth shape, `{ "error": "invalid_grant", "error_description": "…" }`
  (RFC 6749 section 5.2), because OAuth libraries expect it. Every other endpoint uses Diaex's shape (section 6).
- **Discovery** (optional): `GET https://api.thediaex.com/.well-known/oauth-authorization-server` (RFC 8414).

#### 3.5 Lifetime and revocation

- Pasted token: lasts until revoked, or until its expiry if the maker chose one. Proposal: an expiry of 90 days
  by default, at most 1 year (decision D13).
- **Revoke from Diaex:** Account, Connected apps, Revoke. **Revoke from Pavé:** `POST /partner/v1/oauth/revoke`
  (RFC 7009), which v1 already serves for pasted tokens. Either way it takes effect on the next request, because
  Diaex checks the token's row on every request. The next call answers 401 `token_revoked`.
- On revoke, Diaex releases the link's holds, drops its watch list and turns off its webhooks (v1.1).
- **When the link loses access without a revoke** (the company loses KYC or is turned off, or the person is removed:
  403 `access_removed`), the link can no longer call `DELETE /holds/{id}`. Proposal (D7): Diaex ends the link's active
  holds with reason `access_lost` the first time it sees the change (on the link's next call, or in the hold sweep,
  section 5.10), so a hold never outlives the access that placed it.
- Pavé deletes its copy of the token on disconnect and on any 401 `token_revoked`.

#### 3.6 What each caller sees

| | Signed out | Linked, company not verified | Linked, verified, no `prices:read` | Linked, verified, `prices:read` |
|---|---|---|---|---|
| Stones, measurements, grades, certificate, photos | Yes | Yes | Yes | Yes |
| Availability status | Yes | Yes | Yes | Yes |
| Price | No | No | No | Yes (raised by the markup for a markup company) |
| Supplier name or contact | No | No | No | No in v1 (decision D3) |
| `access.level` | `signed_out` | `not_approved` | `approved` | `approved` |
| `access.prices` | `false` | `false` | `false` | `true` (`false` once the daily quota is used, section 7) |
| `access.prices_hidden_reason` | `signed_out` | `not_verified` | `scope_missing` | `null` (`quota_exceeded` once the daily quota is used) |
| Holds, events (v1.1) | No | No (decision D7) | With the scopes | With the scopes |

Today `prices` follows the level alone (`diaex:app/browse.py:41-43`), so an `approved` caller always has it.
**New**: through the partner API it is also `false` without `prices:read`, and once the company's daily quota is used.

Diaex staff are never a partner caller: staff is a Firebase claim (`diaex:app/auth.py:172,186`) and a partner
token cannot carry it.

---

### 4. Price visibility rules

These are Diaex's rules today. The partner API must not add a second copy of them; it calls the same code.

1. Prices go only to verified companies, worked out on every request (`diaex:app/browse.py:89-98,132-139`).
2. A **markup company** sees every price raised by its whole percent, 1 to 500 (`diaex:db/schema.sql:399-401`,
   `diaex:app/browse.py:45-64`), and ASKA as the supplier (`diaex:app/browse.py:272-282`). Through the partner API
   the raised price is the price, and `access.markup` is `true`.
3. A caller without prices may still sort by price, an order and never a number (`diaex:app/browse.py:2-3`).
   A price limit in the request (`max_price_each`) is dropped for them and named in `dropped`
   (`diaex:app/browse.py:153-161`).
4. Every reply that carries a stone carries `access`: `{ level, prices, markup, prices_hidden_reason }`. The first
   three are today's `Access.public()` (`diaex:app/browse.py:58-59`); `prices_hidden_reason` is **New**, one of
   `signed_out`, `not_verified`, `scope_missing`, `quota_exceeded` or `null`.
5. The supplier's name and contact are not sent through the partner API in v1, even to a verified company. Diaex
   shows them to verified non-markup buyers on its own pages (`diaex:app/browse.py:272-290`), and every stone's
   `url` opens that page. Sets say only how many suppliers and whether it is one supplier
   (`diaex:app/layouts.py:284-288`). Decision D3.
6. Market position (`peer_bands`, `market`) is Pro and verified only on Diaex (`diaex:app/browse.py:185-188`) and
   is not part of the partner API.
7. **How long Pavé may keep a price** (decision D11). Pavé writes a linked stone's price into the design and the
   cost sheet (`packages/schema/src/design/nodes.ts:63`, `packages/production/src/cost.ts:202-223`). Proposal:
   Pavé keeps it with its `seen_at` time, shows it as "Diaex price on 24 Nov 2026", refreshes it when the design is
   opened, keeps it inside the Pavé organisation that saw it, and never publishes it (no store page, feed or
   public link). After a revoke Pavé stops refreshing and marks saved prices as stale.
8. **Price in events and webhooks is decided when it is sent, not when the event is written.** Diaex stores events
   without prices and fills in price and markup from the caller's access **at the moment Pavé reads the feed, and at
   each webhook delivery attempt**, as every other answer is worked out on every request
   (`diaex:app/browse.py:1-3`). A company that lost KYC between the two gets no price; a markup set in between is
   applied. A `stone.price_changed` event goes only to a caller who sees prices at that moment; others never get it.
   The one exception is a company whose prices are hidden only because its daily quota is used: it still gets the
   event, with all three prices `null`, so it knows to check again. Every price sent this way counts toward the daily
   quota (section 7).

---

### 5. Endpoints

Every endpoint below is in the OpenAPI file with the same names. "Maps to" says which Diaex code it re-uses.

| Method and path | Scope | Phase | Maps to |
|---|---|---|---|
| `GET /me` | none or `stones:read` | v1 | **New**; access from `diaex:app/browse.py:118-139` |
| `POST /stones/search` | none or `stones:read` | v1 | `POST /api/search` (`diaex:app/main.py:1170-1179`, `diaex:app/browse.py:164-189`) |
| `POST /sets/search` | none or `stones:read` | v1 | `POST /api/layouts/search` (`diaex:app/main.py:1243-1263`, `diaex:app/layouts.py:302-374`) |
| `POST /requirements/match` | none or `stones:read` | v1 | **New**, composes the two above |
| `POST /stones/availability` | none or `stones:read` | v1 | `POST /api/stones/batch` (`diaex:app/main.py:1182-1187`, `diaex:app/browse.py:340-359`) |
| `GET /stones/{id}` | none or `stones:read` | v1 | `GET /api/stones/{public_id}` (`diaex:app/main.py:1190-1201`, `diaex:app/browse.py:314-337`) |
| `POST /oauth/revoke` | the token itself | v1 | **New** |
| `POST /oauth/token` | client | v1.1 | **New** |
| `POST /holds`, `GET /holds`, `GET /holds/{id}`, `POST /holds/{id}/extend`, `DELETE /holds/{id}` | `holds:write` | v1.1 | **New** (section 5.10) |
| `POST /watches`, `GET /watches`, `DELETE /watches/{stone_id}` | `events:read` | v1.1 | **New** |
| `GET /events` | `events:read` | v1.1 | **New**, reads `stone_events` (`diaex:db/schema.sql:176-193`) and more |
| `POST /webhooks`, `GET /webhooks`, `DELETE /webhooks/{id}`, `POST /webhooks/{id}/rotate-secret` | `events:read` | v1.1, optional | **New** |
| `POST /handoffs` | `handoff:write` | v2 | **New**, outline only (section 5.12) |

All paths are under `/partner/v1`. "none or `stones:read`" means a signed-out call works, and a token must have
`stones:read`.

#### 5.1 The objects every endpoint shares

**Stone.** One stone as this caller may see it. Built from Diaex's one list of fields a caller may receive,
`STONE_FIELDS` (`diaex:app/catalog.py:232-243`), through the same per-level filter (`diaex:app/browse.py:142-150`).

```json
{
  "id": "T-OV-01",
  "url": "https://console.thediaex.com/browse?stone=T-OV-01",
  "shape": "oval brilliant",
  "shape_group": "oval",
  "carat": 1.21,
  "origin": "natural",
  "growth": null,
  "color": "F",
  "fancy_color": null,
  "fancy_hue": null,
  "fancy_intensity": null,
  "clarity": "VS1",
  "cut": "EX",
  "polish": "EX",
  "symmetry": "EX",
  "fluorescence": "NONE",
  "treatment": "UNTREATED",
  "measurements": { "length_mm": 8.04, "width_mm": 5.97, "height_mm": 3.71, "ratio": 1.35 },
  "profile": {
    "table_pct": 58.0, "depth_pct": 62.1, "crown_angle": 34.5, "crown_height_pct": 14.0,
    "pavilion_angle": 40.8, "pavilion_depth_pct": 43.0, "girdle_thin": "MED", "girdle_thick": "STK", "culet": "NON"
  },
  "certificate": { "lab": "GIA", "report_no": "2141438171", "report_url": "https://www.gia.edu/report-check?reportno=2141438171" },
  "media": {
    "image_url": "https://api.thediaex.com/api/stones/T-OV-01/photo?v=3f2a9c1d0b7e6a5f4c3b2a19&w=512",
    "video_url": null
  },
  "location": { "country": "US", "city": "New York" },
  "availability": "available",
  "price": { "amount": "6120.00", "currency": "USD" },
  "price_per_carat": { "amount": "5058.00", "currency": "USD" },
  "has_pair": false,
  "etag": "W/\"b41c09e2\"",
  "updated_at": "2026-11-23T18:02:11Z"
}
```

| Field | Rule | Diaex today |
|---|---|---|
| `id` | the public id | `diaex:db/schema.sql:91-93` |
| `url` | a page on Diaex that opens this stone, signed out or in | `?stone=` opens a stone only in the new look (`diaex:web/src/stone/address.ts:1-3,13-18`). The built site shows the new look by default (`diaex:web/src/lib/uiVersion.ts:49-52`), unless the browser or the account chose the old one (`diaex:web/src/lib/uiVersion.ts:9-14`). How a browser on the old look opens this link is decision D17: either the old look learns `?stone=`, which changes the flat look and needs Tej's written OK (`diaex:AGENTS.md:117-118`), or the link adds `ui=2`, which that browser then keeps (`diaex:web/src/lib/uiVersion.ts:10,28-38`). The example above shows the link before D17. |
| `shape`, `shape_group` | the supplier's word, and the canonical group | `diaex:db/schema.sql:16,64-67`; groups `diaex:app/shapes.py:20-24` |
| `carat` | 2 decimals | `diaex:db/schema.sql:17` |
| `origin`, `growth` | `natural`, `lab`, or `null` when Diaex has no stone type; `growth` is `CVD`, `HPHT` or `null` | `stone_type` CVD / HPHT / Natural, and it may be empty (`diaex:db/schema.sql:15`). **New** split into two fields. A requirement with `origin: natural` or `lab` never returns a stone whose `origin` is `null`. |
| `color`, `fancy_color`, `fancy_hue`, `fancy_intensity` | white grade D to Z, or the fancy label, hue and intensity | `diaex:db/schema.sql:18-19,132-137`; hues `diaex:app/grades.py:47`. `fancy_hue` and `fancy_intensity` are **New** in replies. |
| `clarity`, `cut`, `polish`, `symmetry`, `fluorescence` | as Diaex shows them | `diaex:db/schema.sql:20-24` |
| `treatment` | `TREATED`, `UNTREATED` or `UNKNOWN` | Diaex sends `null` when unknown today (`diaex:db/schema.sql:87-90`, `diaex:app/stone_rows.py:67-71`). **New**: the partner API maps `null` to `UNKNOWN`. |
| `measurements` | mm, 2 decimals; length is the longer side; any may be `null` | `diaex:db/schema.sql:29-32`, `diaex:app/stone_rows.py:84` |
| `profile` | cut profile; `null` fields when the feed has none | `diaex:db/schema.sql:33-43` |
| `certificate` | `report_no` and `report_url` only when the number fits the lab's format | `diaex:app/stone_rows.py:12-13,42-50` |
| `media.image_url` | absolute, public, cacheable; widths 96, 256, 512 or 1024 through `w` | today a relative path, `diaex:app/photo_route.py:40-43`; widths `diaex:app/photo_resize.py:14-15`. **New**: absolute. |
| `media.video_url` | as the supplier gives it | `diaex:app/catalog.py:237` |
| `location` | ISO 3166 alpha-2 and the stock city | `diaex:db/schema.sql:109-115` |
| `availability` | see 5.2 | |
| `price`, `price_per_carat` | Money or `null` (section 4) | `diaex:db/schema.sql:27-28` |
| `has_pair` | a hint, never a promise | `diaex:db/schema.sql:94-97` |
| `etag` | weak tag over the stone **as this caller sees it** (so a price change never shows to a caller who cannot see prices) | **New** |
| `updated_at` | last change to anything in the caller's view: fields, availability, and price only for a caller who sees prices | **New**: Diaex keeps two change times per stone, one that leaves price out and one that counts it, and serves the one that matches the caller. `source_updated_at` and `synced_at` exist (`diaex:db/schema.sql:47-48`) but are not sent (`diaex:app/catalog.py:233-243`) |

Never sent: Diaex's internal ids, the supplier id and the supplier's own reference (`diaex:db/schema.sql:10-14`,
`diaex:db/schema.sql:103-108`), and the raw treatment text (`diaex:db/schema.sql:87`).

**Access.** `{ "level": "approved", "prices": true, "markup": false, "prices_hidden_reason": null }` (section 3.6).

**Fit.** How a stone fits a seat. **New**. Worked out by Diaex so both sides agree (section 10 tests it):

- `d_length_mm = stone.length_mm − seat.length_mm`, `d_width_mm = stone.width_mm − seat.width_mm`, to 2 decimals.
- For each side, its error `e` is `d / tol_plus_mm` when `d > 0`, `−d / tol_minus_mm` when `d < 0`, and `0`
  when `d = 0`. A side with a tolerance of `0` and `d ≠ 0` has an error of infinity.
- `in_window` is true when both errors are at most 1, and, if `seat.max_height_mm` was sent, `height_mm` is at
  most that.
- `score = 1 − max(e_length, e_width)`, kept between 0 and 1, rounded half up to 2 decimals, worked out in
  decimals, not floats. 1 means the stone drops into the seat as drawn (`packages/sourcing/src/provider.ts:27-28`).
- `d_height_mm` is `height_mm − max_height_mm` when a height limit was sent, else `null`.

```json
{ "d_length_mm": 0.01, "d_width_mm": -0.01, "d_height_mm": null, "in_window": true, "score": 0.9 }
```

**Requirement.** One row. **New**, made of filters Diaex already has plus four new ones.

```json
{
  "ref": "r_7f3a19",
  "kind": "single",
  "quantity": 1,
  "gem": "diamond",
  "origin": "natural",
  "shape": "round",
  "seat": { "length_mm": 6.45, "width_mm": 6.45, "tol_minus_mm": 0.10, "tol_plus_mm": 0.15, "max_height_mm": null },
  "carat": null,
  "colors": ["E", "F", "G"],
  "fancy_hues": null,
  "fancy_intensities": null,
  "clarities": ["VS1", "VS2"],
  "certificate": { "required": true, "labs": ["GIA", "IGI"] },
  "max_price_each": null,
  "include_memo": false,
  "same_supplier": false,
  "exclude": []
}
```

| Field | Rule | Diaex today |
|---|---|---|
| `ref` | Pavé's own opaque label, 1 to 64 of `A-Z a-z 0-9 _ -`, echoed back. Pavé sends `r_` and 6 to 12 hex characters (section 8); the narrow pattern refuses a raw design reference by mistake | **New** |
| `kind` | `single`, `matched_set` or `parcel` | **New** |
| `quantity` | 1 for `single`; 2 to 70 for `matched_set`; any for `parcel` | layouts take 2 to 70 (`diaex:app/layouts.py:80`) |
| `gem` | `diamond`; anything else is answered `unsupported` | `diaex:db/schema.sql:15` |
| `origin` | `natural`, `lab` or `any` | `stone_types` filter (`diaex:app/catalog.py:94`); a set never mixes them (`diaex:app/layouts.py:75-76`) |
| `shape` | a Diaex shape word; a shape Diaex does not know (such as `cabochon`) is `unsupported` | `diaex:app/shapes.py:20-24`, `diaex:app/layouts.py:41-46` |
| `seat.length_mm`, `seat.width_mm` | 0.3 to 40, 2 decimals, length ≥ width | length and width filters (`diaex:app/catalog.py:74-77`) |
| `seat.tol_minus_mm`, `seat.tol_plus_mm` | 0 to 2, 2 decimals: how much smaller and larger a stone may be | **New** window rule |
| `seat.max_height_mm` | optional, the deepest stone the seat takes | **New** filter (none today, `diaex:app/catalog.py:74-83`) |
| `carat` | optional `{min, max}`, 2 decimals | `min_carat`, `max_carat` (`diaex:app/catalog.py:67-68`) |
| `colors` | white grades, at most 23 | `diaex:app/catalog.py:84` |
| `fancy_hues`, `fancy_intensities` | the ten Diaex hues (`Yellow`, `Pink`, `Blue`, `Green`, `Orange`, `Brown`, `Purple`, `Red`, `Gray`, `Violet`); with `colors`, either matches, so Pavé never sends `colors` with `fancy_hues` (section 8) | `diaex:app/catalog.py:85-87`, `diaex:app/grades.py:47` |
| `clarities` | at most 16 | `diaex:app/catalog.py:88` |
| `certificate.required` | true drops stones with no lab | **New**: today `labs` can ask for NONE (`diaex:app/catalog.py:225-227`) but not "any lab but none" |
| `certificate.labs` | optional list | `labs` (`diaex:app/catalog.py:89`) |
| `max_price_each` | optional Money; dropped and named for callers without prices | `diaex:app/browse.py:153-161` |
| `include_memo` | `single` only: also return stones out on memo, tagged | memo stones are shown but never picked for a set or bought (`diaex:app/catalog.py:393-399`). Browse already shows memo stones by default (`diaex:app/catalog.py:388-389`) and has an `availability` filter this can use (`diaex:app/catalog.py:110-112`) |
| `same_supplier` | `matched_set` only | `diaex:app/layouts.py:84` |
| `exclude` | stone ids never returned, at most 70 | `diaex:app/layouts.py:86` |

#### 5.2 Availability status

| Status | Means | Can Pavé pick it? | Diaex today |
|---|---|---|---|
| `available` | listed, in stock with its supplier, nobody holds it | Yes | `IN_STOCK` (`diaex:app/catalog.py:393-399`) |
| `memo` | listed but out on memo with someone else | Show it, but it starts no set and cannot be held or bought | `diaex:db/schema.sql:116-124` |
| `on_hold` | an order on Diaex holds it (v1.1: or another company's hold); it may come back | No, wait for an event | held allocation (`diaex:app/catalog.py:383`, `diaex:db/schema.sql:1501-1511`); the stone page already says "on hold" to everyone (`diaex:app/browse.py:318-319,333`) |
| `unavailable` | sold, or its supplier no longer lists it. `reason` is `sold` or `delisted` | No | open sold mark (`diaex:app/catalog.py:382`, `diaex:db/schema.sql:1521-1531`); not in the feed (`diaex:app/catalog.py:378`) |
| `unknown` | no stone has this id (availability endpoint only) | No | `missing` (`diaex:app/browse.py:357-359`) |

#### 5.3 `unsupported` reasons

A row Diaex cannot serve answers `status: "unsupported"` with one `reason`, and no `search_url`:

| Reason | When |
|---|---|
| `parcels_not_listed` | `kind: parcel`: melee, or more than 70 matching stones (Diaex has one row per stone, `diaex:db/schema.sql:17`; section 8 says when Pavé sends a parcel) |
| `material_not_listed` | `gem` is not `diamond` |
| `cut_not_listed` | a shape Diaex does not know, such as `cabochon` (`diaex:app/layouts.py:41-46`) |
| `colour_not_listed` | a fancy hue Diaex does not list, such as `Black` (`diaex:app/grades.py:47`) |
| `set_too_large` | `matched_set` with more than 70 stones (`diaex:app/layouts.py:25`) |

#### 5.4 `POST /stones/search`: search one requirement (v1)

Finds single stones that fit one seat, best fit first, a page at a time. Returns only stones inside the window.

- **Request:** `{ requirement, sort, limit, cursor }`. `requirement.kind` must be `single`. `sort` is `fit`
  (default: score high to low, then price per carat low to high, then id), `price_asc` or `ppc_asc`. `limit` 1 to
  100, default 24.
- **Response 200:** `{ ref, candidates: [{ stone, fit }], total, next_cursor, dropped, search_url, access }`.
  `total` comes on the first page only, as today (`diaex:app/catalog.py:192-199`). `search_url` is the same search
  on Diaex's Browse page (`/browse?f=<filters as JSON>`, the keys Diaex's web app reads,
  `diaex:web/src/browse/filterState.ts:9-48`).
- **Errors:** 400 `bad_cursor`; 401; 403 `insufficient_scope`; 413 `body_too_large` (over 32 KB); 422
  `invalid_request` (also when `kind` is not `single`); 422 `requirement_unsupported` with `reason` (section 5.3);
  429; 500 `cursor_unavailable`; 503 `storage_unavailable`.
- **Maps to:** `browse.search` and `Filters` (`diaex:app/browse.py:164-189`, `diaex:app/catalog.py:60-112`).
  **New:** the window built from the tolerances, `max_height_mm`, `certificate.required`, the `fit` sort and block.

```json
// POST /partner/v1/stones/search
{ "requirement": { "ref": "r_7f3a19", "kind": "single", "quantity": 1, "gem": "diamond", "origin": "natural",
    "shape": "round", "seat": { "length_mm": 6.45, "width_mm": 6.45, "tol_minus_mm": 0.10, "tol_plus_mm": 0.15 },
    "colors": ["G"], "clarities": ["VS1", "VS2"], "certificate": { "required": true } },
  "sort": "fit", "limit": 24 }
// 200, signed out
{ "ref": "r_7f3a19",
  "candidates": [
    { "stone": { "id": "T-RD-01", "carat": 1.0, "price": null, "availability": "available", "...": "..." },
      "fit": { "d_length_mm": 0.01, "d_width_mm": -0.01, "d_height_mm": null, "in_window": true, "score": 0.9 } },
    { "stone": { "id": "T-RD-02", "carat": 1.01, "price": null, "availability": "available", "...": "..." },
      "fit": { "d_length_mm": 0.02, "d_width_mm": 0.0, "d_height_mm": null, "in_window": true, "score": 0.87 } } ],
  "total": 2, "next_cursor": null, "dropped": [],
  "search_url": "https://console.thediaex.com/browse?f=%7B%22shapes%22%3A%5B%22round%22%5D%2C%22...%22%7D",
  "access": { "level": "signed_out", "prices": false, "markup": false, "prices_hidden_reason": "signed_out" } }
```

#### 5.5 `POST /sets/search`: matching pairs and layouts (v1)

Finds sets of 2 to 70 stones that match each other and each fit the seat.

- **Request:** `{ requirement, locked, loosen }`. `requirement.kind` must be `matched_set`; `quantity` is the set
  size. `locked`: stone ids every set must hold, at most `quantity`. `loosen`: optional wider limits for
  `length_mm`, `width_mm`, `table_pct`, `depth_pct`, `crown_height_pct`, each between the set's limit and the
  loosest Diaex allows (`diaex:app/layouts.py:62-71,117-127`).
- **Matching rules are Diaex's**, unchanged: the spread of length and breadth across the set at most 0.03 mm for
  a round and 0.05 mm for a fancy shape; table, depth and crown limits (`diaex:app/matching.py:20-33`); every stone
  on the same side of a whole carat, and, around a chosen (locked) stone or a carat target, within the 0.05 ct band
  of `carat_band` (`diaex:app/matching.py:50-54,234-239`). With an mm target there is no other carat limit between
  stones: around a 2.05, a 2.00 and a 2.10 may share a set (`diaex:app/matching.py:50-52`). Only stones in stock,
  never on memo (`diaex:app/layouts.py:19`).
- **New:** every stone must also sit inside the seat window on **both** sides. Today an mm target is held on both
  sides for a round but only on the length for a fancy shape (`diaex:app/layouts.py:235-238`).
- **Response 200:** `{ ref, sets, one_supplier, complete, capped, stopped, largest_found, search_url, access }`.
  At most 3 sets, lowest total first, plus the cheapest one-supplier set, as today
  (`diaex:app/layouts.py:302-313,364-367`). Each set: `{ stones: [{ stone, fit }], total_price, total_carat,
  spread, suppliers, one_supplier, relaxed }` (`diaex:app/layouts.py:272-288`). `total_price` is `null` without
  prices. `capped` means more than 2,000 candidates were in the window (`diaex:app/pairs.py:25`); `stopped` means
  the search ran out of time (2 s per search, `diaex:app/pairs.py:28`). `largest_found` is the cheapest set of the
  largest size found when the size asked was not reached, with its `count`. `search_url` is
  `/pairs?way=build&shape=&unit=mm&size=&stones=&colors=&clarities=&type=`, the Build a set form Diaex reads today
  (`diaex:web/src/pairs/buildForm.ts:10,25-32`). `size` is the seat's diameter for a round and its **length** for a
  fancy shape, the one side the engine holds an mm target on (`diaex:web/src/pairs/buildForm.ts:49`,
  `diaex:app/layouts.py:235-238`). The form's `length` and `breadth` are not the seat: they are how far the stones in
  a set may differ, 0.03 to 0.10 mm for a round and 0.05 to 0.20 mm for a fancy shape
  (`diaex:web/src/pairs/buildForm.ts:11-12,41-48`). Diaex adds them only when `loosen` sent wider side limits.
- **Errors:** 404 `stone_unavailable` (a locked id no available stone has, with `missing`); 409 `stone_on_memo`
  (with `stones`); 409 `locked_unfit` (with `differences`) (`diaex:app/main.py:1255-1263`); 413 over 32 KB
  (`diaex:app/layouts.py:26-28`); 422 `invalid_request` (also when `kind` is not `matched_set`); 422
  `requirement_unsupported` with `reason`; 429; 503.
- **Maps to:** `layouts.search` (`diaex:app/layouts.py:74-147,302-374`).

```json
// POST /partner/v1/sets/search, verified company
{ "requirement": { "ref": "r_e2b001", "kind": "matched_set", "quantity": 2, "gem": "diamond", "origin": "natural",
    "shape": "emerald", "seat": { "length_mm": 7.0, "width_mm": 5.0, "tol_minus_mm": 0.05, "tol_plus_mm": 0.05 },
    "colors": ["F", "G"], "clarities": ["VS1", "VS2"] }, "locked": [] }
// 200
{ "ref": "r_e2b001",
  "sets": [ { "stones": [
        { "stone": { "id": "T-EM-01", "...": "..." }, "fit": { "d_length_mm": 0.0, "d_width_mm": 0.0, "d_height_mm": null, "in_window": true, "score": 1.0 } },
        { "stone": { "id": "T-EM-02", "...": "..." }, "fit": { "d_length_mm": 0.03, "d_width_mm": 0.02, "d_height_mm": null, "in_window": true, "score": 0.4 } } ],
      "total_price": { "amount": "7850.00", "currency": "USD" }, "total_carat": 2.03,
      "spread": { "length_mm": 0.03, "width_mm": 0.02, "table_pct": 0.5, "depth_pct": 0.4, "crown_height_pct": 0.3 },
      "suppliers": 1, "one_supplier": true, "relaxed": false } ],
  "one_supplier": { "...": "the same set" },
  "complete": true, "capped": false, "stopped": false, "largest_found": null,
  "search_url": "https://console.thediaex.com/pairs?way=build&shape=emerald&unit=mm&size=7&stones=2&colors=F%2CG&clarities=VS1%2CVS2&type=natural",
  "access": { "level": "approved", "prices": true, "markup": false, "prices_hidden_reason": null } }
```

#### 5.6 `POST /requirements/match`: many requirements in one call (v1)

One call per design. Diaex answers each row as `/stones/search` (first page) or `/sets/search` would, or says why
it cannot.

- **Request:** `{ requirements: [Requirement, 1 to 50], sort, limit_per_row }`. Each `ref` once. Body at most 64 KB.
- **Response 200:** `{ results: [RowResult], access }`, in the order asked. A RowResult is
  `{ ref, kind, status, reason, candidates, total, sets, one_supplier, complete, capped, stopped, largest_found,
  search_url, error }`:
  - `status: "matched"`: `single` rows have `candidates` (at most `limit_per_row`, default 10, at most 50) and
    `total`; `matched_set` rows have `sets`, `one_supplier`, `complete`, `capped`, `stopped` and `largest_found`, as
    `/sets/search` gives them, so Pavé can tell a set search that was cut short.
  - `status: "none"`: a row Diaex can serve, with nothing in stock that fits now. `search_url` still opens it.
  - `status: "unsupported"`: with `reason` (section 5.3).
  - `status: "error"`: this row did not finish; `error` is `{ code: "row_timeout", retryable: true }`. Diaex
    answers the whole call within 10 s (proposal); rows left over come back like this.
- **Errors:** 401, 403, 413, 422 (a bad row fails the whole call, with the row's place in `detail`), 429, 503.
- **Maps to:** **New**. Single rows run the search query; set rows share Diaex's engine slots (2 at once per
  server, `diaex:app/pairs.py:29`). The backlog note on describing a whole piece of jewellery to the assistant asks
  for the same thing (`diaex:docs/plans/2026-11-04-ai-jewellery-composition-todo.md:1-17`).

```json
// POST /partner/v1/requirements/match
{ "requirements": [
    { "ref": "r_c01", "kind": "single", "quantity": 1, "gem": "diamond", "origin": "natural", "shape": "oval",
      "seat": { "length_mm": 8.0, "width_mm": 6.0, "tol_minus_mm": 0.10, "tol_plus_mm": 0.15 },
      "colors": ["E", "F", "G"], "clarities": ["VS1", "VS2"], "certificate": { "required": true } },
    { "ref": "r_h01", "kind": "parcel", "quantity": 22, "gem": "diamond", "origin": "natural", "shape": "round",
      "seat": { "length_mm": 1.3, "width_mm": 1.3, "tol_minus_mm": 0.03, "tol_plus_mm": 0.03 } },
    { "ref": "r_s01", "kind": "single", "quantity": 1, "gem": "sapphire", "origin": "any", "shape": "oval",
      "seat": { "length_mm": 5.0, "width_mm": 4.0, "tol_minus_mm": 0.10, "tol_plus_mm": 0.15 } } ],
  "sort": "fit", "limit_per_row": 10 }
// 200
{ "results": [
    { "ref": "r_c01", "kind": "single", "status": "matched", "total": 1,
      "candidates": [ { "stone": { "id": "T-OV-01", "...": "..." },
                        "fit": { "d_length_mm": 0.04, "d_width_mm": -0.03, "d_height_mm": null, "in_window": true, "score": 0.7 } } ],
      "search_url": "https://console.thediaex.com/browse?f=..." },
    { "ref": "r_h01", "kind": "parcel", "status": "unsupported", "reason": "parcels_not_listed" },
    { "ref": "r_s01", "kind": "single", "status": "unsupported", "reason": "material_not_listed" } ],
  "access": { "level": "approved", "prices": true, "markup": false, "prices_hidden_reason": null } }
```

#### 5.7 `POST /stones/availability`: is it still there? (v1)

- **Request:** `{ ids: [1 to 100 stone ids] }`. Repeats are answered once (`diaex:app/browse.py:354`).
- **Response 200:** `{ items: [{ id, status, reason, held_by_you, price, price_per_carat, etag, updated_at }],
  access }`, in the order asked. An `unknown` id has `etag` and `updated_at` `null`. `held_by_you` is `false` in v1.
- **Prices count toward the daily quota** (section 7), like every reply that carries a price. When the quota is
  used, availability still answers every status, with prices `null` and `prices_hidden_reason: quota_exceeded`.
- **Errors:** 401, 403, 422, 429, 503.
- **Maps to:** `POST /api/stones/batch`, which already answers signed out with `available` and no price
  (`diaex:app/browse.py:340-359`). **New:** the five statuses (today it is one true or false), `etag`, `updated_at`.

```json
// POST /partner/v1/stones/availability
{ "ids": ["T-RD-01", "T-RD-03", "T-RD-04", "T-RD-05", "NOPE-1"] }
// 200, signed out
{ "items": [
    { "id": "T-RD-01", "status": "available", "reason": null, "held_by_you": false, "price": null, "price_per_carat": null, "etag": "W/\"91ad\"", "updated_at": "2026-11-23T18:02:11Z" },
    { "id": "T-RD-03", "status": "memo", "reason": null, "held_by_you": false, "price": null, "price_per_carat": null, "etag": "W/\"0c2e\"", "updated_at": "2026-11-22T09:10:00Z" },
    { "id": "T-RD-04", "status": "on_hold", "reason": null, "held_by_you": false, "price": null, "price_per_carat": null, "etag": "W/\"77b0\"", "updated_at": "2026-11-23T11:00:00Z" },
    { "id": "T-RD-05", "status": "unavailable", "reason": "sold", "held_by_you": false, "price": null, "price_per_carat": null, "etag": "W/\"5d13\"", "updated_at": "2026-11-23T12:30:00Z" },
    { "id": "NOPE-1", "status": "unknown", "reason": null, "held_by_you": false, "price": null, "price_per_carat": null, "etag": null, "updated_at": null } ],
  "access": { "level": "signed_out", "prices": false, "markup": false, "prices_hidden_reason": "signed_out" } }
```

#### 5.8 `GET /stones/{id}`: stone detail (v1)

- **Request:** the stone id in the path, percent-encoded (principle 4).
- **Response 200:** `{ stone, access }` with an `ETag` header equal to `stone.etag`. With `If-None-Match` equal to
  the current tag: 304 and no body.
- A stone that is `on_hold` still answers 200 with that status, as its page does today
  (`diaex:app/browse.py:318-319`). A sold or delisted stone answers 404 `stone_unavailable`
  (`diaex:app/main.py:1198-1199`); use availability to tell sold from delisted.
- **Errors:** 401, 403, 404 `stone_unavailable`, 429, 503.
- **Maps to:** `GET /api/stones/{public_id}` (`diaex:app/browse.py:314-337`), without the supplier card,
  `market` and `ready_pair`.

#### 5.9 `GET /me` and `POST /oauth/revoke` (v1)

`GET /me` says who is calling. Pavé calls it right after a token is pasted, and on Settings.

```json
// 200, linked
{ "access": { "level": "approved", "prices": true, "markup": false, "prices_hidden_reason": null },
  "company": { "id": "org_5b1d…", "name": "Example Diamonds LLC", "verified": true, "kyc_status": "approved" },
  "link": { "id": "lnk_01J…", "kind": "token", "name": "Pavé studio", "scopes": ["stones:read", "prices:read"],
            "mode": "live", "last4": "Q9xA", "created_at": "2026-11-24T10:00:00Z", "expires_at": "2027-02-22T10:00:00Z" },
  "features": [] }
// 200, no token
{ "access": { "level": "signed_out", "prices": false, "markup": false, "prices_hidden_reason": "signed_out" },
  "company": null, "link": null, "features": [] }
```

`kyc_status` is one of Diaex's four values (`diaex:db/schema.sql:393-394`). `features` lists the optional parts
switched on for this server: `holds`, `events`, `webhooks` (an open list, empty in v1). Pavé shows Hold and live
updates only when they are listed, instead of finding out from a 404. **New.**

`POST /oauth/revoke` takes the form `token=<the token>` (RFC 7009) and answers 200 with no body, also for a token
already revoked. It takes no `Idempotency-Key` (principle 9). Errors: 400 `invalid_request` in the OAuth shape (a
missing `token`, RFC 7009 section 2.2.1), 429, 503.

#### 5.10 Holds (v1.1)

A hold keeps a stone for this company while a piece is decided. **It is Diaex's own priority, not a promise from
the supplier.** The supplier may sell the stone at any time; Diaex does not contact the supplier when a hold is
placed. Diaex already keeps those two facts apart (`diaex:db/schema.sql:1496-1500`).

What Diaex has today: holds exist only as allocations, which only a Buy creates, with no end time, and which hide
the stone from everyone (`diaex:db/schema.sql:1501-1511`, `diaex:docs/SOURCING.md:181-207`). Diaex's spec says
only a Buy gives priority (`diaex:docs/SOURCING-SPEC.md:219-221`). So partner holds are **New** and need Tej's
decision (D7, D8).

Rules (proposal, D7):
- Only a verified company, with `holds:write`.
- 1 to 10 stones per call; at most 10 active holds per company.
- 30 to 120 minutes, default 60; one extension of 30 to 120 minutes.
- **A cool-down:** once a company's hold on a stone ends, for any reason, that company cannot hold the same stone
  again for N hours (refused `hold_cooldown`; N is a number for Tej, D7). Without it a company could release and hold
  again at once and block a stone for ever.
- Only `available` stones: a memo stone is refused (`stone_on_memo`), as memo stones cannot be carted or bought
  (`diaex:app/catalog.py:393-399`).
- **One holder per stone, across partner holds and orders, decided in the database** (`diaex:AGENTS.md:107-108`).
  An order's allocation blocks a hold, and an active hold blocks a Buy, which then refuses that stone as `taken`, as it
  does for a stone another order holds (`diaex:app/sourcing/api.py:113-116`). Today one unique index keeps one held
  allocation per stone (`diaex:db/schema.sql:1511`), but an index covers one table only, so it cannot by itself stop a
  partner hold and an order on the same stone. How is decided under D7 and D8; the two ways are: (a) take a row lock
  on the stone's `stones` row, always before any other lock, before writing either kind of hold; or (b) make partner
  holds a new kind of allocation, so one index covers both.
- **"Active" depends on the time, which an index cannot see** (Postgres refuses `now()` in an index's condition). So
  a hold counts as active only while `expires_at` has not passed, checked whenever the stone is read; and something
  must end past-due holds so their place frees up: a scheduled sweep, or a release done in the same transaction that
  next touches the stone. The plan picks one.
- While a hold is active, other callers see the stone as `on_hold`; the holder sees `available` with
  `held_by_you: true`.
- A hold ends when it expires, when the company releases it, when the stone sells or leaves the feed, when Diaex
  staff release it, when the link is revoked, or when the link loses access (section 3.5). Each ending has its own
  `reason` (below).
- **Time-based events need a writer.** `hold.expiring`, `hold.ended` for an expiry, and `stone.available` for other
  watchers when a hold ends, all happen at a time, not on a request. Either the sweep writes them (Diaex already runs
  Temporal for sourcing, `diaex:AGENTS.md:71-73`), or the feed builds them when read from holds whose times have
  passed, with ids that stay the same on every read. The plan picks one; the edge case is in the brief.

| Endpoint | Request | Response | Errors |
|---|---|---|---|
| `POST /holds` | `{ stone_ids, minutes, reference }`, `Idempotency-Key` | 200 `{ holds: [Hold] }`, one per stone, each `active` or `refused` with `reason` (`stone_held`, `stone_on_memo`, `stone_unavailable`, `hold_limit_reached`, `hold_cooldown`) | 401, 403 `insufficient_scope` / `company_not_verified`, 409 `idempotency_in_progress`, 422 (also `idempotency_key_missing`, `idempotency_key_reused`), 429, 503 |
| `GET /holds` | `?status=active\|ended&limit&cursor` | `{ holds, next_cursor }` | 400, 401, 403, 429, 503 |
| `GET /holds/{id}` | | `Hold` | 401, 403, 404 `not_found`, 429, 503 |
| `POST /holds/{id}/extend` | `{ minutes }`, `Idempotency-Key` | `Hold` | 401, 403, 404, 409 `hold_not_extendable` / `idempotency_in_progress`, 422, 429, 503 |
| `DELETE /holds/{id}` | `Idempotency-Key` | `Hold`: `ended` with `released_by_you` if it was active; **unchanged** if it had already ended | 401, 403, 404, 409, 422, 429, 503 |

A Hold: `{ id, stone_id, status, reason, reference, created_at, expires_at, ended_at, extensions_left }`.
`status` is `active`, `ended` or `refused`. `reason` is `null` while active; for `refused`, one of the refusal
reasons above; for `ended`, one of `released_by_you`, `expired`, `stone_sold`, `stone_delisted`, `released_by_staff`,
`link_revoked`, `access_lost`. The `hold.ended` event carries the same reason. `reference` is Pavé's opaque label,
at most 64 characters (section 9).

```json
// POST /partner/v1/holds            Idempotency-Key: 6f1c2b9e-hold-1
{ "stone_ids": ["T-OV-01", "T-RD-03"], "minutes": 60, "reference": "pv_8d21" }
// 200
{ "holds": [
    { "id": "hld_01JD…", "stone_id": "T-OV-01", "status": "active", "reason": null, "reference": "pv_8d21",
      "created_at": "2026-11-24T15:00:00Z", "expires_at": "2026-11-24T16:00:00Z", "ended_at": null, "extensions_left": 1 },
    { "id": null, "stone_id": "T-RD-03", "status": "refused", "reason": "stone_on_memo", "reference": "pv_8d21",
      "created_at": null, "expires_at": null, "ended_at": null, "extensions_left": 0 } ] }
```

#### 5.11 Watch list and events feed (v1.1)

Pavé on a designer's computer has no public address (`apps/server/src/config.ts:57-65`), so Diaex can never call
it. **Pavé asks; Diaex never has to call.** Webhooks are an extra for hosted Pavé only.

**Watch list.** Diaex sends events only for stones the link watches. Pavé adds the stones linked into designs.
A hold watches its stone by itself.

| Endpoint | Request | Response |
|---|---|---|
| `POST /watches` | `{ stone_ids: [1 to 100] }`, `Idempotency-Key` | `{ watching: [ids], refused: [{ id, reason: "unknown" \| "watch_limit_reached" }] }` |
| `GET /watches` | `?limit&cursor` | `{ stone_ids, next_cursor }` |
| `DELETE /watches/{stone_id}` | `Idempotency-Key` | 204, also when the stone was not watched |

Proposal: at most 2,000 watched stones per link (decision D9). Watches, the events feed and webhooks need a verified
company, as holds do (section 3.6): an unverified company is answered 403 `company_not_verified`.

**Events feed.** `GET /events?after=<cursor>&limit=<1..100>`.

- Without `after`: an empty page and a cursor for "now".
- **Starting order, so no change is missed.** (1) `GET /events` with no `after`, and store the cursor. (2) Add
  watches. (3) Check availability for the watched stones. (4) Poll from the stored cursor. A change made between steps
  1 and 3 then shows in both places, which is harmless; checking availability first could miss it. After a 410, Pavé
  starts again from step 1.
- Response: `{ events: [Event], next_cursor, has_more }`. `next_cursor` is always set; Pavé stores it and passes it
  next time, even after an empty page.
- Order: by event id, increasing. Delivery: at least once; Pavé drops events whose `id` it has seen. Diaex must
  not skip an event that commits late; the plan says how (edge case in the brief).
- Kept 30 days (proposal, D9). An older cursor answers 410 `cursor_expired`; Pavé then checks availability for
  everything it watches and starts again.
- An Event: `{ id, type, created_at, stone_id, hold_id, data }`.

| Type | `data` | Source on Diaex today |
|---|---|---|
| `stone.price_changed` | `{ price, price_per_carat, was_price }`, filled in from the caller's access when read or delivered (section 4, rule 8). Only to callers who see prices then; with the daily quota used, sent with the prices `null`. | `stone_events` kind `price_change` with old and new price (`diaex:db/schema.sql:181-192`) |
| `stone.unavailable` | `{ status: "on_hold" \| "unavailable", reason: "order_hold" \| "hold" \| "sold" \| "delisted" }` | `gone` (`diaex:db/schema.sql:184`); allocations (`diaex:db/schema.sql:1501-1511`) and sold marks (`diaex:db/schema.sql:1521-1531`) write no stone event today. **New.** |
| `stone.available` | `{ status: "available" }` | `back` (`diaex:db/schema.sql:184`); hold and sold-mark endings **New** |
| `stone.memo` | `{ status: "memo" }` | **New** (the sync writes the column in place, `diaex:db/schema.sql:116-123`) |
| `stone.updated` | `{ fields: ["measurements", …] }`: grades, size, certificate or media changed | **New** |
| `hold.expiring` | `{ expires_at }`, 10 minutes before | **New** (needs a writer, section 5.10) |
| `hold.ended` | `{ ended_at, reason }`, the Hold's ended reasons | **New** |

```json
// GET /partner/v1/events?after=ev_c_9f2a&limit=100
{ "events": [
    { "id": "evt_000184", "type": "stone.price_changed", "created_at": "2026-11-24T15:20:04Z", "stone_id": "T-OV-01",
      "hold_id": null, "data": { "price": { "amount": "5990.00", "currency": "USD" },
      "price_per_carat": { "amount": "4950.00", "currency": "USD" }, "was_price": { "amount": "6120.00", "currency": "USD" } } },
    { "id": "evt_000185", "type": "hold.expiring", "created_at": "2026-11-24T15:50:00Z", "stone_id": "T-OV-01",
      "hold_id": "hld_01JD…", "data": { "expires_at": "2026-11-24T16:00:00Z" } } ],
  "next_cursor": "ev_c_a07b", "has_more": false }
```

**Webhooks (optional, hosted Pavé only).**

- `POST /webhooks` `{ url, types }` with `Idempotency-Key` → 201 `{ id, url, types, status, disabled_at, secret,
  created_at }`. The `secret` (`whsec_…`) is shown once. At most 3 per link; a fourth is 409 `webhook_limit_reached`.
- The address must be `https` and public: loopback, private and link-local addresses are refused with 422
  `webhook_url_not_public`. A local Pavé simply does not register one (Pavé turns inbound features off on a
  loopback address, `docs/plans/publishing.md:17`).
- **The check is repeated at every delivery**, because a name that was public when registered can later point
  inside Diaex's network (DNS rebinding, server-side request forgery). At every attempt Diaex resolves the name,
  refuses any loopback, private, link-local or cloud metadata address (such as 169.254.169.254), connects to the
  address it checked, follows no redirects, waits at most 5 seconds and reads at most 64 KB of the answer (numbers
  for the plan). **New.**
- Each delivery is the same Event object, signed the Standard Webhooks way, as Pavé's own webhooks are
  (`docs/plans/publishing.md:112`): headers `webhook-id`, `webhook-timestamp`, `webhook-signature: v1,<base64
  HMAC-SHA256 of "{id}.{timestamp}.{body}">`. The HMAC key is the base64-decoded part of the secret after `whsec_`.
  `webhook-id` equals the event's `id`, so Pavé drops an id it has already seen, whether it came by the feed or by a
  webhook. Pavé refuses a timestamp more than 5 minutes off.
- Price is filled in at each delivery attempt from the access at that moment (section 4, rule 8).
- **Retries are per event:** growing waits for up to 24 hours, then that event is dropped from delivery. **Turning
  off is per webhook:** after 3 days in which every delivery failed, the webhook's `status` becomes `disabled` with
  `disabled_at`; Pavé registers it again. The feed stays the record: a missed webhook is never lost.
- `GET /webhooks` lists them without secrets, with `status` (`active` or `disabled`) and `disabled_at`;
  `DELETE /webhooks/{id}` removes one. `POST /webhooks/{id}/rotate-secret` (with `Idempotency-Key`) returns a new
  secret; for the next 24 hours each delivery carries two signatures, old and new, separated by a space, as Standard
  Webhooks allows, so Pavé can switch without missing one.

#### 5.12 Hand-off to Diaex (v2, outline only)

Not in the OpenAPI file; shapes will be agreed when Tej decides D10.

- `POST /handoffs` with `Idempotency-Key`: `{ reference, items: [{ stone_id, price_seen, ref }], sets: [{ ref,
  stone_ids }] }`.
- **While Buy is closed** (`diaex:app/launch.py:1-12`): Diaex makes a shortlist for the linked person
  (shortlists exist, `diaex:app/main.py:1559-1658`) and returns its `url`. The designer opens it on Diaex and
  contacts suppliers there, as verified buyers do today (`diaex:web/src/routes/legal/Terms.tsx:32-36`).
- **Once Buy opens:** Diaex fills the person's cart (sets go in whole, `diaex:app/main.py:1356-1397`) and returns a
  `checkout_url`. The buyer presses Buy on Diaex, which needs Pro, the launch switch and a verified company
  (`diaex:app/sourcing/api.py:111`). Pavé never sees payment.
- Each item answers `added`, `unavailable`, `on_memo` or `price_changed` with the price now, as Buy reports
  `taken`, `price_changed` and `no_price` today (`diaex:app/sourcing/api.py:113-116`).
- Order status comes back as `order.*` events in the feed.

#### 5.13 A jewellery store on thediaex.com (v2 note)

A store would show finished pieces made in Pavé, with each piece's stone rows resolved by Diaex's own code against
live stock and Diaex's price rule, so price and supplier rules cannot drift
(`docs/strategy/catalog-import-and-store.md:250`). It needs a store identity, an address and a price rule first
(`docs/strategy/catalog-import-and-store.md:144-157`), and Diaex's Terms say trade-only and no payment today
(`docs/strategy/catalog-import-and-store.md:157`). A piece should promise a specification and a "from" price,
because a named stone can sell between a page view and an order (`docs/strategy/catalog-import-and-store.md:168`).
Pictures and CAD stay on Pavé. Nothing in v1 or v1.1 depends on it.

---

### 6. Errors

```json
{ "error": { "code": "stone_unavailable", "message": "This stone is no longer available.", "retryable": false },
  "request_id": "req_5f0c3a9e8b7d4c2a1f0e9d8c7b6a5f4e" }
```

`error` may carry extra fields named below (`missing`, `stones`, `differences`, `detail`). A 422 lists each
problem's field and reason and never the value sent (`diaex:app/main.py:223-232`); its `detail` is inside `error`,
which differs from today on purpose (principle 10). Pavé decides by `code`, never by `message`. The list of codes is
open (principle 2).

| HTTP | Code | Retry? | When |
|---|---|---|---|
| 400 | `bad_cursor` | no | a cursor that cannot be read, or one made for another link, level or request (principle 8) |
| 401 | `unauthenticated` | no | malformed or unknown token |
| 401 | `token_expired` | no | refresh (OAuth) or make a new token |
| 401 | `token_revoked` | no | the link was revoked; Pavé deletes the token |
| 403 | `insufficient_scope` | no | the token lacks the scope |
| 403 | `company_not_verified` | no | holds, watches, events or webhooks by a company that is not verified |
| 403 | `access_removed` | no | the person was removed from the company (`diaex:app/browse.py:119-121`) |
| 404 | `stone_unavailable` | no | stone sold, delisted or never existed (`diaex:app/main.py:1199`); locked ids, with `missing` |
| 404 | `not_found` | no | hold or webhook not found (removing a watch always answers 204) |
| 409 | `stone_on_memo` | no | a locked stone or hold on a memo stone, with `stones` (`diaex:app/main.py:1211,1260`) |
| 409 | `locked_unfit` | no | locked stones cannot make one set, with `differences` (`diaex:app/main.py:1262`) |
| 409 | `hold_not_extendable` | no | no extension left, or the hold has ended |
| 409 | `idempotency_in_progress` | yes | the same key is still running |
| 409 | `webhook_limit_reached` | no | a fourth webhook on one link |
| 410 | `cursor_expired` | no | an events cursor older than the feed keeps |
| 413 | `body_too_large` | no | over 32 KB (64 KB for `/requirements/match`) |
| 422 | `invalid_request` | no | the body or query is wrong; `detail` lists the fields (`diaex:app/main.py:228-232`) |
| 422 | `requirement_unsupported` | no | `/stones/search` or `/sets/search` with a row Diaex cannot serve, with `reason` (section 5.3) |
| 422 | `idempotency_key_missing` | no | a write without an `Idempotency-Key` header |
| 422 | `idempotency_key_reused` | no | the same key with a different body, method or path |
| 422 | `webhook_url_not_public` | no | a webhook address that is not public `https` |
| 429 | `rate_limited` | yes | with `Retry-After` (`diaex:app/main.py:215-220`) |
| 500 | `internal` | yes | |
| 500 | `cursor_unavailable` | no | a cursor for the next page could not be made (today: a stone id too long to seal, `diaex:app/catalog.py:254,257-258`); should not happen once ids are capped at 64 characters |
| 503 | `storage_unavailable` | yes | the database is down (`diaex:app/main.py:586-587` answers this with `retryable: false` today; the partner API answers `true`) |

Retry rule for Pavé: only `retryable: true`, with growing waits, at most 3 tries, obeying `Retry-After`. A used daily
quota is not an error: replies go on without prices (section 7). The OAuth endpoints use the OAuth error shape
instead (section 3.4).

---

### 7. Rate limits and abuse

**Today.** Diaex's limits are counted in each server process's memory, so two servers allow twice the limit
(`diaex:app/limits.py:1-12`). Only shares, exports and the supplier list (`diaex:app/limits.py:67-73`) and the
contact form (`diaex:app/contact_routes.py:12-13`) have limits; search, stones, match and layouts have none. Per-address limits wait on a proxy
setting (`diaex:app/limits.py:60-64`).

**The risk.** A verified company with a token could copy Diaex's whole priced catalogue (about 27,000 stones,
`diaex:docs/DIAEX-REFERENCE.md:53-55`) in a few hundred calls. Diaex once leaked its cost book by sending a raw
record (`diaex:docs/process/3-review.md:23-24`), so the price gate must hold here too.

**Proposal (numbers are starting points for Tej to set, decision D6):**

| Bucket | Limit |
|---|---|
| Signed out, per address | 30 requests a minute |
| Per link, all endpoints | 120 requests a minute |
| Per link, `/requirements/match` | 20 calls a minute (each at most 50 rows) |
| Per link, `/stones/availability` | 60 calls a minute (each at most 100 ids) |
| Per company, priced stones | 5,000 different priced stones a day (UTC) across all its links; past it, replies go on **without prices** (`prices_hidden_reason: quota_exceeded`), never a 429, so availability checks keep working |
| Hosted Pavé app token (`client_credentials`) | its own bucket, set per client |

- **What counts toward the priced-stone quota: every reply or delivery that carries a price.** That is search,
  sets, match, availability, stone detail, events and webhooks. A stone counts once a day however often it is sent,
  so Pavé re-checking its own designs' stones costs little. Without this, availability alone (100 ids a call, 60 calls
  a minute) could return 6,000 priced stones a minute, and stone ids are free to collect signed out.
- **The quota is the real limit, not the per-minute buckets.** One match call of 50 set rows of 10 stones can carry
  500 priced stones, so 10 such calls use up a day. And at 5,000 a day a company could still copy every priced stone
  (about 27,000, `diaex:docs/DIAEX-REFERENCE.md:53-55`) in about 6 days. Tej sets the number knowing that (D6).
- Limits are shared across all Diaex servers (**New**: today they are per process).
- Diaex may send `RateLimit-Policy` and `RateLimit` headers (IETF draft) as information; Pavé relies only on 429
  and `Retry-After`.
- Diaex counts, per link per day: calls per endpoint, rows, stones returned, priced stones returned, 429s. It
  shows these to staff (section 9) and can revoke a link that looks like scraping.
- Pavé spreads its own calls: one match call per design change, availability in batches of 100, events every
  60 seconds while the app is open and every 15 minutes in the background.

---

### 8. From Pavé's requirement to the request

Pavé's `StoneRequirement` is in `packages/sourcing/src/requirements.ts:18-37`.

| Pavé field | Request field | Rule |
|---|---|---|
| `ref` | `ref` | Pavé sends a short hash (`r_` + 6 to 12 hex) and keeps the map. Node ids never leave Pavé. |
| `nodeIds`, `role`, `setting`, `overagePct` | not sent | design detail; the setting is already in the tolerances |
| `kind: single / matchedSet / parcel` | `single` / `matched_set` / `parcel`, with one change | Pavé makes any lot of more than 8 stones a `parcel`, melee or not (`requirements.ts:71-72`), but Diaex sets take up to 70 (`diaex:app/layouts.py:25,80`). So a Pavé `parcel` whose `role` is not `melee` and which has at most 70 stones is sent as `matched_set` (an eternity band of 20 stones of 3.0 mm, for example). Only melee, or more than 70 stones, is sent as `parcel`. Pavé tests this mapping. |
| `quantity` | `quantity` | |
| `material: diamond` | `gem: diamond` | |
| `material: diamond-lab` | `gem: diamond`, `origin: lab` | `lab` = `stone_types` CVD and HPHT (`packages/sourcing/src/diaex.ts:20-24`) |
| `material: diamond-yellow` / `diamond-pink` | `gem: diamond`, `fancy_hues: ["Yellow"]` / `["Pink"]`, and **no `colors`** | as the deep links do (`packages/sourcing/src/diaex.ts:11-14,31`). Pavé fills white grades in by default for every diamond row (`requirements.ts:58-62,74-75`); sent with `fancy_hues`, either would match (`diaex:app/catalog.py:85`) and a yellow seat could return white stones |
| `material: diamond-black` | `gem: diamond`, `fancy_hues: ["Black"]` | answered `colour_not_listed` today (`diaex:app/grades.py:47`) |
| any other material | `gem: <material id>` | answered `material_not_listed` |
| `origin` | `origin` | (`requirements.ts:64-65`) |
| `cut` | `shape` | Pavé's cut words are Diaex shape words except `cabochon` (`diaex:app/shapes.py:20-24`), answered `cut_not_listed` |
| `seat.length`, `seat.width` | `seat.length_mm`, `seat.width_mm` | rounded to 2 decimals; for a round, length = width (`requirements.ts:86-88`); length is the longer side |
| `seat.tolMinus`, `seat.tolPlus` | `seat.tol_minus_mm`, `seat.tol_plus_mm` | prong −0.10/+0.15, bezel ±0.05, channel ±0.05, else ±0.03 (`requirements.ts:48-56`) |
| (none today) | `seat.max_height_mm` | **New** on Pavé's side, from the setting's depth |
| `seat.adjustable` | not sent | Pavé uses it to decide whether to refit the seat |
| `caratEach` | `carat` (optional) | not sent by default: the seat decides fit |
| `quality.colors` | `colors` | for a white diamond only |
| `quality.clarities` | `clarities` | Pavé's parcel default `VS` (`requirements.ts:61`) is not a Diaex grade: it is sent as `VS1`, `VS2` |
| `quality.certified` | `certificate.required` | (`requirements.ts:99`) |

**Back from Diaex** into the design's sourcing link (`packages/schema/src/design/nodes.ts:58-78`):
`stone.id` → `sku`; `stone.url` → `url`; `stone.price.amount` → `priceUsd` (only when `currency` is `USD` and price
is not `null`); `measurements.length_mm`, `width_mm`, `height_mm` → `measured.length`, `width`, `depth` (Pavé checks
they sit within 0.3 to 40 mm); `certificate.report_no` → `certificate`; `provider: "diaex"`. Pavé also keeps
`etag`, `updated_at` and its own `seen_at`, which the link has no field for today (**New** on Pavé's side). The
kernel then sizes the seat from the measured stone (`packages/kernel/src/features/gem.ts:37-42`) and warns when the size is unusable (`packages/kernel/src/features/gem.ts:209-215`).

---

### 9. Privacy and data rules

**What Pavé sends:** requirement rows (shape, millimetres, carats, grades, origin, quantity), opaque `ref` and
`reference` labels, stone ids, and, for holds, how long. **Never:** CAD, meshes, renders, photographs or sketches
of a design, piece names, customer names, the jewellery's price, or Pavé user emails. Strict request models
(principle 3) refuse anything else.

**Designs never reach Diaex staff,** because they never reach Diaex (`docs/strategy/catalog-import-and-store.md:295`).
What Diaex staff can see about a link: the company, the person who made it, its name, scopes, dates, last use,
daily counts (section 7), the stone ids it holds or watches, and, in request logs, the paths it called, which hold
stone ids for `GET /stones/{id}` and `DELETE /watches/{stone_id}`. Pavé tells its users this in the Connect screen.

**Diaex's logging.** Partner routes log one line per request with method, path, status, time, link id and company
id, as Diaex does today (`diaex:app/main.py:196-206`), and never a request body, a token or a requirement. A 422
never repeats a value (`diaex:app/main.py:223-232`). A token is never in a log, an error or a reply after it is
first shown, as with Diaex's service tokens (`diaex:app/service_tokens.py:5-7`).

**Retention on Diaex (proposal, D12).** Requirements: not stored after the reply. Daily counts: 13 months.
Holds: as history, like released allocations (`diaex:db/schema.sql:1496-1500`). Watches: until removed or the link
ends. Events: 30 days. Idempotency keys: 24 hours. Request logs, which hold the stone ids in partner paths: as long
as the host keeps logs (14 days on the plan Diaex intends for production, `diaex:docs/plans/2026-10-26-render-deploy.md:387`),
or Diaex hashes the ids in partner paths before logging (the plan says which). A revoked link's row stays for the
audit log.

**On Pavé.** The token is stored sealed per organisation, admin-only, last 4 characters shown, never sent to the
browser, the same way Pavé stores its assistant key (`ffdraft-ai:apps/server/src/assistant/keys.ts:1-104`, on the
assistant branch). In local mode the key that seals it comes from the `auth-secret` file in the same data folder
as the database (`apps/server/src/auth/workspace.ts:70-81`), so a copy of that folder opens the token. Local Pavé
therefore keeps the token in the operating system's keychain where it can, and otherwise warns that a backup of the
data folder includes the Diaex token. Pavé keeps stone snapshots only for stones linked into designs, with
`seen_at`, and never mirrors the catalogue (`docs/research/07-sourcing.md:246-257`). Prices follow section 4, rule 7.

---

### 10. Acceptance tests both sides share

**The contract test suite** is one list of cases, each a request and the parts of the reply that must hold. Diaex
runs it in its own test suite against a test server loaded with the fixture set; Pavé runs it against a mock built
from the OpenAPI file and, before each release, against Diaex's test server. **v1 is done when every v1 case
passes against a Diaex test server.**

#### 10.1 Fixture set

Every stone is listed by its feed, `visible`, with a real stock id. Natural unless said; colour and clarity as
shown; all have photos; all GIA unless said, with report numbers made of digits so `report_url` is set
(`diaex:app/stone_rows.py:12-13`). Cut profile for the rounds: table 57.0, depth 61.4, crown 15.0 unless said.

| id | Shape | ct | L × W × H mm | Colour, clarity | Lab | State | Price USD (ppc) |
|---|---|---|---|---|---|---|---|
| `T-RD-01` | round | 1.00 | 6.46 × 6.44 × 3.96 | G VS1 | GIA | available | 5200 (5200) |
| `T-RD-02` | round | 1.01 | 6.47 × 6.45 × 3.97; table 57.5, depth 61.6, crown 15.2 | G VS2 | GIA | available | 5050 (5000) |
| `T-RD-03` | round | 1.00 | 6.45 × 6.44 × 3.95 | G VS1 | GIA | memo | 4900 (4900) |
| `T-RD-04` | round | 1.00 | 6.45 × 6.45 × 3.95 | G VS1 | GIA | held by an order (allocation `held`) | 4800 (4800) |
| `T-RD-05` | round | 1.00 | 6.46 × 6.45 × 3.96 | G VS1 | GIA | open sold mark | 4700 (4700) |
| `T-RD-06` | round | 1.00 | 6.45 × 6.43 × 3.95 | G VS1 | none | available | 3000 (3000) |
| `T-RD-07` | round | 1.10 | 6.70 × 6.68 × 4.10 | G VS1 | GIA | available | 6000 (5455) |
| `T-RD-08` | round, CVD | 1.00 | 6.45 × 6.44 × 3.95 | G VS1 | IGI `LG600112233` | available | 900 (900) |
| `T-OV-01` | oval | 1.21 | 8.04 × 5.97 × 3.71 | F VS1 | GIA | available | 6120 (5058) |
| `T-OV-02` | oval, CVD | 1.20 | 8.02 × 5.99 × 3.70 | F VS1 | IGI `LG600445566` | available | 1450 (1208) |
| `T-PR-01` | pear | 1.02 | 7.00 × 5.00 × 3.10 | Fancy Intense Yellow, VS2 | GIA | available | 4400 (4314) |
| `T-EM-01` | emerald | 1.01 | 7.00 × 5.00 × 3.40; table 64.0, depth 68.0, crown 11.0 | F VS1 | GIA | available | 3900 (3861) |
| `T-EM-02` | emerald | 1.02 | 7.03 × 5.02 × 3.42; table 64.5, depth 68.4, crown 11.3 | F VS1 | GIA | available | 3950 (3873) |

`T-EM-01` and `T-EM-02` come from one supplier; every other stone from its own supplier.

**Callers:** `signed_out`; `verified` (approved, scopes `stones:read prices:read holds:write events:read`);
`verified_no_price` (approved, `stones:read` only); `unverified` (KYC `submitted`); `markup` (approved, markup 10%);
`verified_b` (a second approved company); `no_stones_scope` (approved, `prices:read` only); `revoked` (a revoked
token); `test_mode` (a `dxp_test_` token). The test server can set the rate limit and the daily priced-stone quota
low (3) for the cases that need it.

#### 10.2 v1 cases

| # | Case | Expected |
|---|---|---|
| C1 | `signed_out` `/stones/search`, round, seat 6.45 × 6.45, −0.10/+0.15, natural, G, VS1–VS2, certificate required | `T-RD-01` (score 0.90) then `T-RD-02` (0.87); `total` 2; every `price` `null`; `access.level` `signed_out`, `prices_hidden_reason` `signed_out` |
| C2 | C1 as `verified` | same order; `T-RD-01.price` `{"amount":"5200.00","currency":"USD"}`; `prices_hidden_reason` `null` |
| C3 | C1 as `markup` | `T-RD-01.price.amount` `"5720.00"` (Diaex's rounding, `diaex:app/stone_rows.py:61-64`); `access.markup` `true` |
| C4 | C1 as `unverified` and as `verified_no_price` | prices `null`; `access.prices` `false` for both; reasons `not_verified` and `scope_missing` |
| C5 | C1 with `certificate.required: false` | adds `T-RD-06` |
| C6 | C1 with `include_memo: true` | adds `T-RD-03` with `availability: "memo"` |
| C7 | C1 with `origin: any` | adds `T-RD-08` (`origin: lab`, `growth: CVD`) |
| C8 | Never returned in C1–C7 | `T-RD-04` (held), `T-RD-05` (sold), `T-RD-07` (outside the window) |
| C9 | `/stones/search` oval, seat 8.00 × 6.00, −0.10/+0.15, `origin: lab` | only `T-OV-02` |
| C10 | `/stones/search` pear, seat 7.00 × 5.00, ±0.05, `fancy_hues: ["Yellow"]` | only `T-PR-01`, `fancy_hue: "Yellow"` |
| C11 | `/stones/search` with `max_price_each` as `signed_out` | `dropped: ["max_price_each"]`; results as without it |
| C12 | `/sets/search` round, 2 stones, otherwise C1's requirement (certificate required) | one set `[T-RD-01, T-RD-02]`; never `T-RD-03` or `T-RD-04`; `total_price` `null` signed out, `"10250.00"` verified |
| C13 | `/sets/search` emerald, 2 stones, seat 7.00 × 5.00, ±0.05 | set `[T-EM-01, T-EM-02]`, `one_supplier: true`, `suppliers: 1` |
| C14 | `/sets/search` with `locked: ["T-RD-03"]` | 409 `stone_on_memo`, `stones: ["T-RD-03"]` |
| C15 | `/sets/search` with `locked: ["NOPE-1"]` | 404 `stone_unavailable`, `missing: ["NOPE-1"]` |
| C16 | `/requirements/match` with a parcel row, a `sapphire` row, a `cabochon` row, a `Black` row and C1's row | statuses `unsupported` (`parcels_not_listed`, `material_not_listed`, `cut_not_listed`, `colour_not_listed`) and `matched` for C1's row, in the order asked |
| C17 | `/requirements/match` with 51 rows, or two rows with the same `ref` | 422 `invalid_request` |
| C18 | `/stones/search` with `gem: sapphire` | 422 `requirement_unsupported`, `reason: material_not_listed` |
| C19 | `/stones/availability` `[T-RD-01, T-RD-03, T-RD-04, T-RD-05, NOPE-1, T-RD-01]` | 5 items: `available`, `memo`, `on_hold`, `unavailable`/`sold`, `unknown` |
| C20 | `GET /stones/T-OV-01` twice, then with `If-None-Match` | same `etag` both times; 304 the third time |
| C21 | change `T-OV-01`'s price in the test database, then `GET` | new `etag` for `verified`, later `updated_at`; for `signed_out` neither the `etag` nor `updated_at` changes |
| C22 | `GET /stones/T-OV-01` | `media.image_url` absolute `https`, loads with no header; `certificate.report_url` is GIA's; sizes have 2 decimals |
| C23 | `GET /stones/T-RD-04` and `/stones/T-RD-05` | 200 with `availability: on_hold`; 404 `stone_unavailable` |
| C24 | `GET /me` as each caller | levels and reasons as section 3.6; `link.last4` set; no token value |
| C25 | `revoked` calls `/stones/search` | 401 `token_revoked` |
| C26 | `no_stones_scope` calls `/stones/search` | 403 `insufficient_scope` |
| C27 | a body with an unknown field (`"design": {}`) | 422 `invalid_request`; the reply does not contain the value sent |
| C28 | a cursor from `verified` used by `signed_out`; a cursor used with a different seat or sort | 400 `bad_cursor` both times |
| C29 | every reply | `x-request-id` header; every error has `error.code`, `error.message`, `error.retryable`, `request_id` |
| C30 | go past a limit (the test server sets the limit to 3) | 429 `rate_limited` with whole-second `Retry-After` |
| C31 | `test_mode` token (only if D12 offers test tokens in production) | answers only fixture stones, never live ones |
| C32 | `POST /oauth/revoke` with `verified`'s token, then call | 200, then 401 `token_revoked` |
| C33 | quota set to 3: `verified` checks availability of 4 different priced stones, then of the first 3 again | first reply: no prices, `prices_hidden_reason: quota_exceeded`, every status still set; a reply carrying only stones already counted today keeps its prices; never a 429 |
| C34 | quota set to 3: `verified` reads 3 stones by `GET /stones/{id}`, then searches | the search reply has no prices, `quota_exceeded`; the stones' details count toward the quota like any other reply |

#### 10.3 v1.1 cases

| # | Case | Expected |
|---|---|---|
| H1 | `verified` holds `T-OV-01` for 60 minutes | `active`, `expires_at` 60 minutes from now (±5 s), `extensions_left: 1` |
| H2 | then `verified_b` searches and checks availability | no `T-OV-01` in search; availability `on_hold` |
| H3 | then `verified` checks availability | `available`, `held_by_you: true` |
| H4 | `verified_b` holds `T-OV-01` | `refused`, `stone_held` |
| H5 | `verified` holds `T-RD-03` | `refused`, `stone_on_memo` |
| H6 | extend once, then again | first `extensions_left: 0`; second 409 `hold_not_extendable` |
| H7 | release | `ended`, `reason: released_by_you`; `T-OV-01` `available` again for `verified_b` |
| H8 | expiry (the test server can move a hold's end into the past) | `ended`, `reason: expired`; stone `available`; another company can hold it at once |
| H9 | same `Idempotency-Key` and body twice; then a different body; then no key | same reply; then 422 `idempotency_key_reused`; then 422 `idempotency_key_missing` |
| H10 | `unverified` places a hold | 403 `company_not_verified` |
| H11 | an 11th active hold | `refused`, `hold_limit_reached` |
| H12 | `verified_no_price` calls `POST /holds` | 403 `insufficient_scope` |
| H13 | `verified` releases `T-OV-01` and holds it again at once | `refused`, `hold_cooldown`; `verified_b` can hold it |
| H14 | `verified` holds `T-OV-01`, then its company loses KYC | the next call has no price; the hold is `ended`, `reason: access_lost`; the stone is `available` to `verified_b` |
| H15 | `DELETE` on a hold that already expired | 200, the hold unchanged (`ended`, `expired`) |
| H16 | a Buy on Diaex for a stone `verified` holds | the Buy leaves it out as `taken` |
| E1 | `GET /events` with no `after` | empty, with a cursor |
| E2 | `verified` and `verified_no_price` watch `T-OV-01`; change its price; both poll; `unverified` polls | `verified` gets one `stone.price_changed` with the new `price`; `verified_no_price` gets none; `unverified` gets 403 `company_not_verified` |
| E2b | `markup` watches `T-OV-01`; its price changes; then the markup changes; then `markup` polls | the event's price is the price with the markup as it is when read |
| E3 | poll again with the last cursor | no repeat |
| E4 | a sold mark on a watched stone | `stone.unavailable`, `reason: sold` |
| E5 | a hold 10 minutes from its end, with no other request in that time | `hold.expiring` is in the feed; after the end, `hold.ended` with `reason: expired` |
| E6 | a cursor older than the feed keeps | 410 `cursor_expired` |
| E7 | revoke a link with holds and watches | holds `ended`, `reason: link_revoked`; next call 401 `token_revoked` |
| E8 | quota set to 3 and used; a watched stone's price changes; `verified` polls | `stone.price_changed` comes with `price`, `price_per_carat` and `was_price` all `null`, so Pavé knows to check again the next UTC day |
| O1 | two refreshes with the same refresh token within the grace window | both get the same new pair; the link stays |
| O2 | the same old refresh token after the grace window | the link is revoked |
| O3 | a member who is not owner or admin presses Allow on the consent page | refused; no code is made |
| W1 | register `http://127.0.0.1/hook` | 422 `webhook_url_not_public` |
| W2 | a delivery's signature | checks with the base64-decoded secret, Standard Webhooks method; `webhook-id` equals the event `id` |
| W3 | register a name that resolves to a public address, then point it at 127.0.0.1 or 10.0.0.1 | no delivery is made to it |
| W4 | a fourth webhook on one link | 409 `webhook_limit_reached` |
| W5 | rotate the secret | the next deliveries carry two signatures, one per secret |

---

### 11. Test mode

- A `dxp_test_` token answers from the fixture set only, never live stones, and its holds never hide a live
  stone. Proposal (decision D12): offered in production so Pavé's developers can test against the real address;
  the alternative is the Diaex test server only.
- The Diaex test server is a local Diaex with a throwaway database loaded with the fixture set, as Diaex runs every
  test (`diaex:AGENTS.md:65`). Diaex already has a fake catalogue for tests (`diaex:app/catalog.py:695-700`).

---

## Part C: for the plan

### 4. Edge cases the plan must cover

Each needs a row in the plan's table with its test. These are on top of the shared cases (Part B, section 10).

| Case | Expected |
|---|---|
| A person's company loses KYC between two calls with the same token | The second call has no price (`prices_hidden_reason: not_verified`) |
| The person who made the link is removed from the company | 403 `access_removed` on the next call |
| The company is turned off, or markup is set after the link was made | Next call follows the new state |
| A token revoked while a call is running | That call finishes; the next is 401 `token_revoked` |
| A staff person tries to make a partner token | Refused: staff is not a partner caller |
| A member (not owner or admin) tries to make a link | Refused (if D1 is accepted) |
| Signed out, signed in, signed in as another company: the same stone | Each sees only its level's fields; one company's holds and watches are invisible to the other |
| Pavé's request carries an unknown field, or a huge body | 422 without echoing it; 413 past the limit |
| 50 set rows in one match call while the 2 engine slots are busy | One 10 s deadline; rows left over are `row_timeout`; slots released |
| The client disconnects mid-match | `CancelledError` re-raised after cleanup; slots and connections released (`diaex:AGENTS.md:95-110`) |
| Two companies hold the same stone at the same moment | The database decides (by D8's choice: a row lock on the stone, or holds as a kind of allocation under one unique index); one `active`, one `refused: stone_held` |
| A Buy and a partner hold race for one stone | One wins, decided in the database, rows locked in a fixed order; a lost Buy leaves the stone out as `taken`; a lost hold is `refused: stone_held` |
| A hold passes its end with no request in between | Other callers see the stone `available` from that moment; the hold's place frees for the next holder; `hold.expiring` and `hold.ended` reach the feed (written by a sweep, or built at read time with ids that never change) |
| The same company holds a stone again right after its hold ended | `refused: hold_cooldown` until the cool-down passes; another company can hold it |
| The holding company loses KYC, is turned off, or the person is removed | The link's holds end with `access_lost` at the next call or sweep; the stone is free for others |
| A link is made, or the consent page is opened and closed | A link row only when the make form is submitted; an OAuth code only on Allow; nothing written on a page view (`diaex:AGENTS.md:93`) |
| Two refreshes with the same refresh token at the same moment | Inside the grace window both get the same new pair; after it, reuse ends the link |
| A webhook address that later resolves to a private or metadata address | No delivery; checked at every attempt, no redirects followed |
| A price change on a watched stone, read after the company's markup changed or KYC was lost | The event's price follows the access when read or delivered: the new markup; no price, or 403, once not verified |
| A company reaches its priced-stone quota through availability or events alone | Replies go on without prices, `quota_exceeded`; every priced reply counted once per stone per day |
| A hold extended exactly as it expires; released twice; the same idempotency key sent twice at once | Database time decides; release is idempotent; the second key waits or gets 409 `idempotency_in_progress` |
| An event written by a transaction that commits after a later one | Never skipped by a reader that has already passed its id (say how: for example, read only up to the oldest transaction still running, or a short delay) |
| An events cursor older than 30 days | 410 `cursor_expired` |
| A connector stone hidden by the 48-hour stale sweep (`diaex:db/schema.sql:716-718`) | Availability `unavailable`, `reason: delisted`; a `stone.unavailable` event for watchers |
| A price change seen by a signed-out caller | Its `etag` and `updated_at` do not change |
| Seat window for a fancy pair | Both length and breadth inside the window; the web builder answers exactly as before when no window is sent |
| Photo of a held stone, of a sold stone | Held: loads (`LISTED`); sold: 404 (`diaex:app/photo_route.py:66-74`) |
| Limits on two servers | One shared count; a refused request is not counted (`diaex:app/limits.py:9-12`) |
| A cabochon, a black diamond, a parcel, a sapphire | `unsupported` with the reasons in Part B, section 5.3 |
| The shared journey: paste a token in Pavé, search, open the stone's `url` on Diaex | Diaex opens the same stone, signed out and signed in, website and app view; from a browser on the old look as D17 decides |

### 5. Proposed PR split

Each step is one branch and one pull request, at most 400 counted lines. **Tests, SQL and config count; only lock
files, the SVG diagrams and Markdown do not** (`diaex:scripts/pr_size.py:25`). The line counts below are not
measured: the plan estimates each step's lines and keeps every estimate under 300, to leave room, and splits a step
again before building if it will not fit. A step that needs the one before it is stacked on that step's branch.
"Tests" names the shared cases (Part B, section 10) each step makes pass, plus its own. Every route step carries speed
numbers in its PR (section 2). Every screen step follows the Screens rules in section 2: its `SCREENS.md` rows and the
map check are in its Tests.

| # | Branch | Stream | What | Tests |
|---|---|---|---|---|
| 0 | `plans/pave-partner-api` | both (plan only) | This plan | none |
| **v1** | | | | |
| 1 | `accounts/partner-links-schema` | Accounts | `partner_links` table (hash, last 4, name, scopes, mode, person, company, expiry, revoked, last used); two audit actions; make, hash and check a token | token stored only hashed; revoked and expired refused; audit rows written |
| 2 | `accounts/partner-links-routes` | Accounts | Owner or admin makes, lists and revokes links through the account routes (Firebase sign-in); the row is written only when the make form is submitted | signed out 401; member refused; another company's link not found; staff refused |
| 3 | `accounts/connected-apps-screen` | Web | Account, Connected apps: make (shown once), list, revoke; first screen shown to Tej first | screen tests in both looks; its `SCREENS.md` rows and the map check; screenshots at the four widths |
| 4 | `browse/partner-fixtures` | Browse | Test only: the 13-stone fixture set with its allocation and sold mark, and the caller helpers (Part B, section 10.1) | the fixtures load on a throwaway database; each caller resolves to its level |
| 5 | `browse/partner-auth-me` | Browse | `/partner/v1` router; token to `Access` (with `prices` false without `prices:read`); scopes; error codes; `GET /me` with `features`; route docs and free-routes list | C24, C25, C26, C29; removed person 403 |
| 6 | `browse/partner-revoke` | Browse | `POST /oauth/revoke` for pasted tokens | C32 |
| 7 | `browse/partner-stone-detail` | Browse | The partner Stone (absolute photo, money strings, origin and growth, fancy hue, `UNKNOWN` treatment, 64-character ids); `GET /stones/{id}` with ETag and 304 | C20, C22, C23 |
| 8 | `browse/partner-availability` | Browse | Five statuses; `POST /stones/availability` | C19 |
| 9 | `browse/stone-freshness` | Browse | Two change times per stone, one without price and one with it, set by the sync; read with allocation and sold-mark times (read only) | C21 |
| 10 | `browse/filters-height-and-lab` | Browse | `max_height_mm`; "any lab"; the seat window from tolerances; web search unchanged | C5; existing search tests |
| 11 | `browse/partner-fit-sort` | Browse | The fit score in decimals, the `fit` sort, and its own sealed cursor bound to link, level and request (today's cursors follow the `SORTS` columns, `diaex:app/catalog.py:202-206`) | fit unit tests; C28 |
| 12 | `browse/partner-stones-search` | Browse | `POST /stones/search` over steps 10 and 11; `requirement_unsupported`; `search_url` | C1 to C11, C18, C27 |
| 13 | `browse/layouts-seat-window` | Browse | Optional per-stone window on both sides in the layout engine; builder unchanged without it | existing layout tests; new window tests |
| 14 | `browse/partner-sets-search` | Browse | `POST /sets/search` over `layouts.search`; `search_url` with `size` as the seat length | C12 to C15 |
| 15 | `browse/partner-match` | Browse | `POST /requirements/match`: 50 rows, reasons, one deadline, shared engine slots, cancellation; set rows with `capped`, `stopped`, `largest_found` | C16, C17; timeout; cancel |
| 16 | `browse/partner-limits` | Accounts / browse | Limits shared across servers (a Postgres counter, or a dependency if Tej agrees); per address once `FORWARDED_ALLOW_IPS` is set (`diaex:app/limits.py:60-64`) | C30 |
| 17 | `browse/partner-price-quota` | Accounts / browse | The daily priced-stone quota across every reply that carries a price; `quota_exceeded`; usage counts as D18 decides | C33, C34 |
| 18 | `accounts/partner-admin-view` | Accounts / web | Staff list of links and usage, and revoke, under `/api/admin` | staff only; counts; its `SCREENS.md` rows and the map check |
| 19 | `web/stone-link-old-look` | Web | Only if D17 chooses to change the flat look, with Tej's written OK: `?stone=` opens a stone in the old look too. Otherwise no step: the `url` adds `ui=2` in step 7 | website and app view, both looks; its `SCREENS.md` rows and the map check |
| 20 | `browse/partner-test-mode` | Browse | `dxp_test_` tokens answer only the fixture set (only if D12) | C31 |
| **v1.1** | | | | |
| 21 | `accounts/partner-oauth-token` | Accounts | Clients (`pave-local` public; hosted confidential); codes (5 min, single use, S256); token endpoint with refresh rotation, the grace window, and `client_credentials` | wrong verifier; code reused; O1, O2; any loopback port; `localhost` refused |
| 22 | `accounts/partner-oauth-consent` | Web | Consent page at `console.thediaex.com/oauth/authorize`: says a local app is asking, shows the port, scopes can be unticked, only owner or admin can Allow; a code is written only on Allow | O3; screen tests in both looks; its `SCREENS.md` rows and the map check; the journey from Pavé |
| 23 | `sourcing/partner-holds` | **Sourcing** | `partner_holds` (or a new kind of allocation, D8); one holder per stone across holds and orders, decided in the database; active only before `expires_at`; caps; cool-down | H1, H4 to H6, H10, H11, H13 (data layer) |
| 24 | `sourcing/buy-refuses-partner-holds` | **Sourcing** | The Buy treats a stone under another company's active partner hold as `taken`. Cross-stream: D8 | H16, "A Buy and a partner hold race for one stone" |
| 25 | `browse/available-excludes-holds` | Browse | `AVAILABLE` and `IN_STOCK` leave out other companies' active holds; the hidden-ids cache keys on them (`diaex:app/catalog.py:400-402`) | H2, H3; existing hidden and sold tests |
| 26 | `browse/partner-holds-routes` | Browse | `/holds` routes; the idempotency store (24 hours, per link, method and path) | H1 to H15 |
| 27 | `<D8's stream>/partner-hold-sweep` | as D8 decides | Ending past-due holds so their place frees, `access_lost` endings, and the writer for time-based events (a sweep, or read-time events with fixed ids) | H8, H14, E5 |
| 28 | `browse/partner-watches` | Browse | Watch list table and routes; cap; verified only | watch limit; revoke drops watches |
| 29 | `browse/partner-events` | Browse (D9) | Events from stone events, allocations, sold marks and holds for watched stones; prices filled in when read; order without skipping late commits; 30 days; 410 | E1 to E8 |
| 30 | `browse/partner-webhooks` | Browse | Optional: register, check the address at every delivery, Standard Webhooks signing, retries per event, turning off per webhook, secret rotation | W1 to W5 |
| **v2** | | | | |
| 31 | `browse/partner-handoff-shortlist` | Browse | `POST /handoffs` makes a shortlist for the linked person and returns its link | after D10 |
| 32 | `sourcing/partner-handoff-cart` | Sourcing | Cart and checkout link, once Buy opens | after D10 and Buy |

### 6. Decisions only Tej can make

Put each in the plan as D1, D2, … with your proposal. The proposals below are Pavé's; change them if the code
says otherwise.

| # | Decision | Pavé's proposal | Other ways |
|---|---|---|---|
| D1 | **Who may link**, and does a token act as a person or as the company? | Owner or admin makes it; it acts as that person, so the access read stays the same; one link per Pavé organisation | Any member; a company-level key with no person |
| D2 | **Pricing visibility** through Pavé | Exactly Diaex's rule, by the same code: verified only, markup applied, plus a `prices:read` scope the company can leave off | No prices through partners at all; indicative price bands for unverified companies |
| D3 | **Supplier name and contact** through the API | Not sent; the stone's Diaex page shows them. Tej has said supplier and location matter on stone cards for members not on markup (`diaex:docs/design/AGENT-GUIDE.md:57`); weigh that here | Name only for verified non-markup buyers |
| D4 | **Lab-grown and natural**: same rules? | Same price, hold and limit rules | Different hold lengths or caps for lab-grown |
| D5 | **Signed-out partner calls** | Allowed, no price, limits per address | Token required for everything |
| D6 | **Rate limits** and the daily priced-stone cap | Part B, section 7: 30 a minute signed out; 120 a minute per link; 20 match calls a minute; 5,000 priced stones a day per company, counting every reply or delivery that carries a price, with no prices (not a 429) once used. At 5,000 a day a company could copy all ~27,000 priced stones in about 6 days | Measure first and set later; per-plan limits; a lower quota |
| D7 | **Holds**: what one does, how long, how many, who | Hides the stone from other buyers like an order's hold; 30 to 120 minutes, default 60; one extension; 10 active per company; verified companies only; a cool-down of N hours before the same company holds the same stone again (N for Tej); ended when the link loses access; Diaex's priority, never the supplier's promise | A "watch" that reserves nothing; a tag only; Pro only |
| D8 | **Which stream owns holds**, the availability change and the Buy's refusal; **how one holder per stone is enforced** | Sourcing owns the table and the Buy change; browse changes `AVAILABLE`. Enforce with a row lock on the `stones` row, taken first, before writing either kind of hold | Holds as a new kind of allocation, so one unique index covers both; all in browse; all in sourcing |
| D9 | **Events**: owner, retention, watch-list size | Browse; 30 days; 2,000 stones per link | Sourcing owns hold and order events |
| D10 | **The order hand-off** | While Buy is closed: a shortlist link, which fits the Terms. Once Buy opens: a cart and checkout link; a Pavé cart follows the same Pro rule as any cart | Nothing until Buy opens; a set plan instead of a shortlist |
| D11 | **How long Pavé may keep a Diaex price** in saved designs and cost sheets | With its date, inside the Pavé organisation, refreshed on open, never published; stale after a revoke | A fixed expiry, such as 7 days |
| D12 | **Test tokens in production**; retention of counts (13 months) and events (30 days) | Yes to test tokens; those periods | Test server only |
| D13 | **Token lifetimes** | Pasted: 90 days by default, 1 year at most. OAuth: access 1 hour, refresh rotated with a 30-second grace window for the previous token, 90 days idle | No expiry for pasted tokens; no grace window |
| D14 | **May any Pavé on any computer connect** to live Diaex | Yes, as a public client through PKCE and the consent of an owner or admin, on a page that says a local app is asking and shows the port; the public client may ask for `prices:read` but not `holds:write` without a fresh Diaex sign-in | Registered installs only; no cap on the public client's scopes |
| D15 | **Aska's two companies** against one Pavé organisation | One link in v1 | Several links per organisation |
| D16 | **The address** | `https://api.thediaex.com/partner/v1`. This changes the deploy plan's D3, which adds `api.thediaex.com` "for webhooks only" (`diaex:docs/plans/2026-10-26-render-deploy.md:389`) | Under `console.thediaex.com/api` |
| D17 | **How a stone's `url` opens in the old look.** `?stone=` works only in the new look (`diaex:web/src/stone/address.ts:1-3,13-18`), and the flat look "stays exactly as it is until Tej switches a screen over" (`diaex:AGENTS.md:117-118`) | Promise the new look only: the `url` adds `ui=2`, which the built site's default already shows (`diaex:web/src/lib/uiVersion.ts:49-52`); note that the browser then keeps that choice (`diaex:web/src/lib/uiVersion.ts:10,28-38`). No change to the flat look | Change the flat look so `?stone=` opens there too (step 19), with Tej's written OK |
| D18 | **Usage counts on every read call**, given "nothing is written until a form is finished" (`diaex:AGENTS.md:93`) | Allowed for counts only, in a shared counter (one row per link per day, not a row per call), written only for calls that were answered | Counts in logs only; no counts until measured |

### 7. What "done" means for v1

- Steps 1 to 18 are merged by Tej, each with its own passing review, plus step 19 if D17 chose it and step 20 if
  D12 chose it.
- **The shared v1 cases C1 to C34 (Part B, section 10) pass against a Diaex test server**: a local Diaex on port
  8001 with a throwaway database loaded with the fixture set. C31 is included only if D12 offers test tokens in
  production. The last PR shows the command and its output.
- Every partner route is in `docs/ARCHITECTURE.md` and classified in `tests/test_pro_routes.py`; `docs/TYPES.md`
  is current; the docs tests pass.
- A token made on the development site works from Pavé against the development API. Production is not touched
  unless Tej says so.
- Any change your plan made to the contract is listed, so Pavé's side can match it.

---

## Part D: the OpenAPI file

The machine-readable contract, word for word as Pavé holds it (`docs/integrations/diaex-partner-api.openapi.yaml`),
OpenAPI 3.1, v1 and v1.1. Part B wins on meaning; this file wins on field limits. It parses and passes an OpenAPI 3.1
validator as written.

```yaml
openapi: 3.1.0
info:
  title: Diaex partner API
  version: 1.1.0-draft
  summary: Stone search, sets, availability, holds and events for partner apps such as Pavé.
  description: |
    Proposal of 24 November 2026; nothing is built. The prose contract is diaex-partner-api.md in the same
    folder, and the two must say the same thing. When they disagree, the prose wins on meaning and this file wins
    on field limits (lengths, counts, ranges, patterns, defaults); any difference is a bug to report and fix in
    both. This file covers v1 and v1.1. Every operation carries `x-phase` (v1 or v1.1). The v2 hand-off is
    described in the prose contract only.

    Rules that apply everywhere:
    - Times are UTC ISO 8601 with Z, to the second.
    - Millimetres, carats and percentages have at most 2 decimals. `length_mm` is the longer side.
    - Money is a decimal string with exactly 2 decimals and an ISO 4217 currency. A hidden price is null.
    - Requests with an unknown field are refused with 422. Clients must ignore unknown response fields and treat
      unknown enum values as "other".
    - Fixed lists that may grow are written as `x-extensible-enum`, not `enum`: a client must not refuse a reply
      for a value it does not know. An unknown availability or hold status means not pickable.
    - Every write takes an `Idempotency-Key` header, kept 24 hours per link, method and path. A replay answers the
      first reply exactly as it was. Exempt: /oauth/token and /oauth/revoke. Searches write nothing and take none.
    - Every reply or delivery that carries a price counts toward the company's daily priced-stone quota. Once it
      is used, replies go on without prices (prices_hidden_reason quota_exceeded), never a 429.
    - Stone ids are at most 64 characters and are percent-encoded in paths, dots included.
    - Every reply carries `x-request-id`. Errors use one shape (`Error`), except the OAuth token endpoint.
    - A call with no `Authorization` header is signed out: no price, limits per address.
servers:
  - url: https://api.thediaex.com/partner/v1
    description: Live (proposed address)
  - url: http://localhost:8001/partner/v1
    description: Diaex test server with the fixture set (port 8001 is Diaex's work server)

tags:
  - name: account
  - name: stones
  - name: sets
  - name: holds
  - name: events
  - name: oauth

security:
  - {}
  - partnerToken: [stones:read]
  - oauth: [stones:read]

paths:
  /me:
    get:
      tags: [account]
      operationId: getMe
      x-phase: v1
      summary: Who is calling, at which access level, with which scopes
      parameters:
        - $ref: '#/components/parameters/ClientRequestId'
      responses:
        '200':
          description: The caller. Signed out gives level signed_out and null company and link.
          headers:
            x-request-id: { $ref: '#/components/headers/RequestId' }
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Me' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '429': { $ref: '#/components/responses/TooManyRequests' }
        '503': { $ref: '#/components/responses/Unavailable' }

  /stones/search:
    post:
      tags: [stones]
      operationId: searchStones
      x-phase: v1
      summary: Single stones that fit one seat, best fit first, a page at a time
      description: |
        Returns only stones inside the seat window (see `Fit`). Maps to Diaex's POST /api/search.
        `requirement.kind` must be `single`.
      parameters:
        - $ref: '#/components/parameters/ClientRequestId'
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/StonesSearchRequest' }
      responses:
        '200':
          description: One page of candidates
          headers:
            x-request-id: { $ref: '#/components/headers/RequestId' }
          content:
            application/json:
              schema: { $ref: '#/components/schemas/StonesSearchResponse' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '413': { $ref: '#/components/responses/TooLarge' }
        '422': { $ref: '#/components/responses/Invalid' }
        '429': { $ref: '#/components/responses/TooManyRequests' }
        '500': { $ref: '#/components/responses/ServerError' }
        '503': { $ref: '#/components/responses/Unavailable' }

  /sets/search:
    post:
      tags: [sets]
      operationId: searchSets
      x-phase: v1
      summary: Matching pairs and layouts of 2 to 70 stones that each fit the seat
      description: |
        Maps to Diaex's POST /api/layouts/search. Diaex's matching rules apply unchanged. New: every stone must sit
        inside the seat window on both sides. `requirement.kind` must be `matched_set`. Body at most 32 KB.
      parameters:
        - $ref: '#/components/parameters/ClientRequestId'
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/SetsSearchRequest' }
      responses:
        '200':
          description: Up to 3 sets, lowest total first, plus the cheapest one-supplier set
          headers:
            x-request-id: { $ref: '#/components/headers/RequestId' }
          content:
            application/json:
              schema: { $ref: '#/components/schemas/SetsSearchResponse' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '404': { $ref: '#/components/responses/NotFound' }
        '409': { $ref: '#/components/responses/Conflict' }
        '413': { $ref: '#/components/responses/TooLarge' }
        '422': { $ref: '#/components/responses/Invalid' }
        '429': { $ref: '#/components/responses/TooManyRequests' }
        '503': { $ref: '#/components/responses/Unavailable' }

  /requirements/match:
    post:
      tags: [stones, sets]
      operationId: matchRequirements
      x-phase: v1
      summary: Many requirements in one call, each answered as stones, sets, none, unsupported or error
      description: |
        Rows are answered in the order asked. Each `ref` once. Body at most 64 KB. Diaex answers within 10 s;
        rows not finished come back with status `error` and code `row_timeout`. A bad row fails the whole call
        with 422.
      parameters:
        - $ref: '#/components/parameters/ClientRequestId'
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/MatchRequest' }
      responses:
        '200':
          description: One result per row
          headers:
            x-request-id: { $ref: '#/components/headers/RequestId' }
          content:
            application/json:
              schema: { $ref: '#/components/schemas/MatchResponse' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '413': { $ref: '#/components/responses/TooLarge' }
        '422': { $ref: '#/components/responses/Invalid' }
        '429': { $ref: '#/components/responses/TooManyRequests' }
        '503': { $ref: '#/components/responses/Unavailable' }

  /stones/availability:
    post:
      tags: [stones]
      operationId: checkAvailability
      x-phase: v1
      summary: Status, price when allowed, and version tag for up to 100 stones
      description: Maps to Diaex's POST /api/stones/batch. Repeated ids are answered once, in the order first asked.
      parameters:
        - $ref: '#/components/parameters/ClientRequestId'
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/AvailabilityRequest' }
      responses:
        '200':
          description: One item per distinct id
          headers:
            x-request-id: { $ref: '#/components/headers/RequestId' }
          content:
            application/json:
              schema: { $ref: '#/components/schemas/AvailabilityResponse' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '422': { $ref: '#/components/responses/Invalid' }
        '429': { $ref: '#/components/responses/TooManyRequests' }
        '503': { $ref: '#/components/responses/Unavailable' }

  /stones/{id}:
    get:
      tags: [stones]
      operationId: getStone
      x-phase: v1
      summary: One stone with media, certificate and measurements
      description: |
        Maps to Diaex's GET /api/stones/{public_id}, without the supplier card, market and ready pair. A stone held
        by an order answers 200 with availability on_hold. A sold or delisted stone answers 404 stone_unavailable.
      parameters:
        - $ref: '#/components/parameters/StoneId'
        - name: If-None-Match
          in: header
          required: false
          schema: { type: string }
          description: The stone's last `etag`; 304 when it is still current.
        - $ref: '#/components/parameters/ClientRequestId'
      responses:
        '200':
          description: The stone as this caller may see it
          headers:
            x-request-id: { $ref: '#/components/headers/RequestId' }
            ETag: { $ref: '#/components/headers/ETag' }
          content:
            application/json:
              schema: { $ref: '#/components/schemas/StoneResponse' }
        '304':
          description: Not changed since the given tag
          headers:
            x-request-id: { $ref: '#/components/headers/RequestId' }
            ETag: { $ref: '#/components/headers/ETag' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '404': { $ref: '#/components/responses/NotFound' }
        '429': { $ref: '#/components/responses/TooManyRequests' }
        '503': { $ref: '#/components/responses/Unavailable' }

  /oauth/revoke:
    post:
      tags: [oauth]
      operationId: revokeToken
      x-phase: v1
      summary: Revoke a token (RFC 7009); works for pasted tokens in v1
      security:
        - {}
      requestBody:
        required: true
        content:
          application/x-www-form-urlencoded:
            schema:
              type: object
              additionalProperties: false
              required: [token]
              properties:
                token: { type: string }
                token_type_hint: { type: string, enum: [access_token, refresh_token] }
      responses:
        '200':
          description: Revoked, or already revoked or unknown. No body. Takes no Idempotency-Key.
          headers:
            x-request-id: { $ref: '#/components/headers/RequestId' }
        '400':
          description: OAuth error (invalid_request, a missing token; RFC 7009 section 2.2.1)
          content:
            application/json:
              schema: { $ref: '#/components/schemas/OAuthError' }
        '429': { $ref: '#/components/responses/TooManyRequests' }
        '503': { $ref: '#/components/responses/Unavailable' }

  /oauth/token:
    post:
      tags: [oauth]
      operationId: getToken
      x-phase: v1.1
      summary: Exchange a code (PKCE S256), refresh a token, or get an app token (client_credentials)
      description: |
        Public client `pave-local` sends `client_id` and `code_verifier`, no secret; its redirect is
        http://127.0.0.1:{any port}/oauth/diaex/callback. Confidential clients (hosted Pavé) authenticate with
        client_secret_basic. `client_credentials` gives an app token with stones:read at the signed_out level only.
        Refresh tokens are rotated on every use; reusing an old one revokes the whole link, except within a
        30-second grace window after a refresh (a proposal), when the previous refresh token answers the same new
        pair. Clients refresh one at a time per link. Takes no Idempotency-Key. Errors use the OAuth shape (RFC 6749
        section 5.2).
      security:
        - {}
        - clientBasic: []
      requestBody:
        required: true
        content:
          application/x-www-form-urlencoded:
            schema: { $ref: '#/components/schemas/TokenRequest' }
      responses:
        '200':
          description: Tokens
          headers:
            x-request-id: { $ref: '#/components/headers/RequestId' }
          content:
            application/json:
              schema: { $ref: '#/components/schemas/TokenResponse' }
        '400':
          description: OAuth error
          content:
            application/json:
              schema: { $ref: '#/components/schemas/OAuthError' }
        '401':
          description: OAuth error (invalid_client)
          content:
            application/json:
              schema: { $ref: '#/components/schemas/OAuthError' }
        '429': { $ref: '#/components/responses/TooManyRequests' }
        '503': { $ref: '#/components/responses/Unavailable' }

  /holds:
    post:
      tags: [holds]
      operationId: createHolds
      x-phase: v1.1
      summary: Hold 1 to 10 stones for 30 to 120 minutes
      description: |
        Diaex's own priority, not a supplier promise. Verified companies only. Each stone is answered on its own:
        active, or refused with a reason. At most 10 active holds per company and one holder per stone across
        partner holds and orders, decided in the database. A company cannot hold a stone again during a cool-down
        after its last hold on it ended (hold_cooldown).
      security:
        - partnerToken: [holds:write]
        - oauth: [holds:write]
      parameters:
        - $ref: '#/components/parameters/IdempotencyKey'
        - $ref: '#/components/parameters/ClientRequestId'
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/HoldsCreateRequest' }
      responses:
        '200':
          description: One hold result per stone
          headers:
            x-request-id: { $ref: '#/components/headers/RequestId' }
          content:
            application/json:
              schema: { $ref: '#/components/schemas/HoldsCreateResponse' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '409': { $ref: '#/components/responses/Conflict' }
        '422': { $ref: '#/components/responses/Invalid' }
        '429': { $ref: '#/components/responses/TooManyRequests' }
        '503': { $ref: '#/components/responses/Unavailable' }
    get:
      tags: [holds]
      operationId: listHolds
      x-phase: v1.1
      summary: This link's holds
      security:
        - partnerToken: [holds:write]
        - oauth: [holds:write]
      parameters:
        - name: status
          in: query
          schema: { type: string, enum: [active, ended], default: active }
        - $ref: '#/components/parameters/Limit'
        - $ref: '#/components/parameters/Cursor'
        - $ref: '#/components/parameters/ClientRequestId'
      responses:
        '200':
          description: A page of holds
          headers:
            x-request-id: { $ref: '#/components/headers/RequestId' }
          content:
            application/json:
              schema: { $ref: '#/components/schemas/HoldList' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '429': { $ref: '#/components/responses/TooManyRequests' }
        '503': { $ref: '#/components/responses/Unavailable' }

  /holds/{hold_id}:
    parameters:
      - $ref: '#/components/parameters/HoldId'
    get:
      tags: [holds]
      operationId: getHold
      x-phase: v1.1
      summary: One hold
      security:
        - partnerToken: [holds:write]
        - oauth: [holds:write]
      responses:
        '200':
          description: The hold
          headers:
            x-request-id: { $ref: '#/components/headers/RequestId' }
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Hold' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '404': { $ref: '#/components/responses/NotFound' }
        '429': { $ref: '#/components/responses/TooManyRequests' }
        '503': { $ref: '#/components/responses/Unavailable' }
    delete:
      tags: [holds]
      operationId: releaseHold
      x-phase: v1.1
      summary: Release a hold; an active hold ends with reason released_by_you, an ended hold is answered unchanged
      security:
        - partnerToken: [holds:write]
        - oauth: [holds:write]
      parameters:
        - $ref: '#/components/parameters/IdempotencyKey'
      responses:
        '200':
          description: The hold, ended now or already ended
          headers:
            x-request-id: { $ref: '#/components/headers/RequestId' }
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Hold' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '404': { $ref: '#/components/responses/NotFound' }
        '409': { $ref: '#/components/responses/Conflict' }
        '422': { $ref: '#/components/responses/Invalid' }
        '429': { $ref: '#/components/responses/TooManyRequests' }
        '503': { $ref: '#/components/responses/Unavailable' }

  /holds/{hold_id}/extend:
    parameters:
      - $ref: '#/components/parameters/HoldId'
    post:
      tags: [holds]
      operationId: extendHold
      x-phase: v1.1
      summary: Extend an active hold once, by 30 to 120 minutes
      security:
        - partnerToken: [holds:write]
        - oauth: [holds:write]
      parameters:
        - $ref: '#/components/parameters/IdempotencyKey'
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/HoldExtendRequest' }
      responses:
        '200':
          description: The extended hold
          headers:
            x-request-id: { $ref: '#/components/headers/RequestId' }
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Hold' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '404': { $ref: '#/components/responses/NotFound' }
        '409': { $ref: '#/components/responses/Conflict' }
        '422': { $ref: '#/components/responses/Invalid' }
        '429': { $ref: '#/components/responses/TooManyRequests' }
        '503': { $ref: '#/components/responses/Unavailable' }

  /watches:
    post:
      tags: [events]
      operationId: addWatches
      x-phase: v1.1
      summary: Watch stones so their changes come through the events feed (verified companies only)
      security:
        - partnerToken: [events:read]
        - oauth: [events:read]
      parameters:
        - $ref: '#/components/parameters/IdempotencyKey'
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/WatchesRequest' }
      responses:
        '200':
          description: Which ids are now watched, and which were refused
          headers:
            x-request-id: { $ref: '#/components/headers/RequestId' }
          content:
            application/json:
              schema: { $ref: '#/components/schemas/WatchesResponse' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '409': { $ref: '#/components/responses/Conflict' }
        '422': { $ref: '#/components/responses/Invalid' }
        '429': { $ref: '#/components/responses/TooManyRequests' }
        '503': { $ref: '#/components/responses/Unavailable' }
    get:
      tags: [events]
      operationId: listWatches
      x-phase: v1.1
      summary: The stones this link watches
      security:
        - partnerToken: [events:read]
        - oauth: [events:read]
      parameters:
        - $ref: '#/components/parameters/Limit'
        - $ref: '#/components/parameters/Cursor'
      responses:
        '200':
          description: A page of watched stone ids
          headers:
            x-request-id: { $ref: '#/components/headers/RequestId' }
          content:
            application/json:
              schema: { $ref: '#/components/schemas/WatchList' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '429': { $ref: '#/components/responses/TooManyRequests' }
        '503': { $ref: '#/components/responses/Unavailable' }

  /watches/{stone_id}:
    delete:
      tags: [events]
      operationId: removeWatch
      x-phase: v1.1
      summary: Stop watching a stone
      security:
        - partnerToken: [events:read]
        - oauth: [events:read]
      parameters:
        - name: stone_id
          in: path
          required: true
          schema: { $ref: '#/components/schemas/StoneId' }
        - $ref: '#/components/parameters/IdempotencyKey'
      responses:
        '204':
          description: No longer watched (also when it was not watched)
          headers:
            x-request-id: { $ref: '#/components/headers/RequestId' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '409': { $ref: '#/components/responses/Conflict' }
        '422': { $ref: '#/components/responses/Invalid' }
        '429': { $ref: '#/components/responses/TooManyRequests' }
        '503': { $ref: '#/components/responses/Unavailable' }

  /events:
    get:
      tags: [events]
      operationId: listEvents
      x-phase: v1.1
      summary: Changes to watched stones and this link's holds, polled by cursor
      description: |
        Without `after`: an empty page and a cursor for now. Start in this order: get that cursor and store it, add
        watches, check availability, then poll from the stored cursor. Order by event id, increasing; at least once,
        so drop ids already seen. Always store `next_cursor`. Events are kept 30 days; an older cursor answers 410.
        Prices in events are filled in from the caller's access when read, never when written.
      security:
        - partnerToken: [events:read]
        - oauth: [events:read]
      parameters:
        - name: after
          in: query
          required: false
          schema: { type: string, maxLength: 512 }
        - $ref: '#/components/parameters/Limit'
        - $ref: '#/components/parameters/ClientRequestId'
      responses:
        '200':
          description: A page of events
          headers:
            x-request-id: { $ref: '#/components/headers/RequestId' }
          content:
            application/json:
              schema: { $ref: '#/components/schemas/EventsPage' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '410': { $ref: '#/components/responses/Gone' }
        '429': { $ref: '#/components/responses/TooManyRequests' }
        '503': { $ref: '#/components/responses/Unavailable' }

  /webhooks:
    post:
      tags: [events]
      operationId: createWebhook
      x-phase: v1.1
      summary: Optional, hosted Pavé only. Register a public https address for signed event deliveries
      description: |
        At most 3 per link (409 webhook_limit_reached). The address is checked when registered and again at every
        delivery: Diaex resolves the name each time, refuses loopback, private, link-local and metadata addresses,
        connects to the address it checked, follows no redirects, and uses a short timeout and a capped read.
      security:
        - partnerToken: [events:read]
        - oauth: [events:read]
      parameters:
        - $ref: '#/components/parameters/IdempotencyKey'
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/WebhookCreateRequest' }
      responses:
        '201':
          description: Registered. The secret is shown only here.
          headers:
            x-request-id: { $ref: '#/components/headers/RequestId' }
          content:
            application/json:
              schema: { $ref: '#/components/schemas/WebhookCreated' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '409': { $ref: '#/components/responses/Conflict' }
        '422': { $ref: '#/components/responses/Invalid' }
        '429': { $ref: '#/components/responses/TooManyRequests' }
        '503': { $ref: '#/components/responses/Unavailable' }
    get:
      tags: [events]
      operationId: listWebhooks
      x-phase: v1.1
      summary: This link's webhooks, without secrets
      security:
        - partnerToken: [events:read]
        - oauth: [events:read]
      responses:
        '200':
          description: The webhooks
          headers:
            x-request-id: { $ref: '#/components/headers/RequestId' }
          content:
            application/json:
              schema: { $ref: '#/components/schemas/WebhookList' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '429': { $ref: '#/components/responses/TooManyRequests' }
        '503': { $ref: '#/components/responses/Unavailable' }

  /webhooks/{webhook_id}:
    delete:
      tags: [events]
      operationId: deleteWebhook
      x-phase: v1.1
      summary: Remove a webhook
      security:
        - partnerToken: [events:read]
        - oauth: [events:read]
      parameters:
        - $ref: '#/components/parameters/WebhookId'
        - $ref: '#/components/parameters/IdempotencyKey'
      responses:
        '204':
          description: Removed
          headers:
            x-request-id: { $ref: '#/components/headers/RequestId' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '404': { $ref: '#/components/responses/NotFound' }
        '409': { $ref: '#/components/responses/Conflict' }
        '422': { $ref: '#/components/responses/Invalid' }
        '429': { $ref: '#/components/responses/TooManyRequests' }
        '503': { $ref: '#/components/responses/Unavailable' }

  /webhooks/{webhook_id}/rotate-secret:
    post:
      tags: [events]
      operationId: rotateWebhookSecret
      x-phase: v1.1
      summary: Get a new secret; for 24 hours each delivery carries two signatures, old and new
      security:
        - partnerToken: [events:read]
        - oauth: [events:read]
      parameters:
        - $ref: '#/components/parameters/WebhookId'
        - $ref: '#/components/parameters/IdempotencyKey'
      responses:
        '200':
          description: The webhook with its new secret, shown only here
          headers:
            x-request-id: { $ref: '#/components/headers/RequestId' }
          content:
            application/json:
              schema: { $ref: '#/components/schemas/WebhookCreated' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '404': { $ref: '#/components/responses/NotFound' }
        '409': { $ref: '#/components/responses/Conflict' }
        '422': { $ref: '#/components/responses/Invalid' }
        '429': { $ref: '#/components/responses/TooManyRequests' }
        '503': { $ref: '#/components/responses/Unavailable' }

webhooks:
  event:
    post:
      x-phase: v1.1
      summary: One event, delivered to a registered address (Standard Webhooks signing)
      description: |
        The body is the same Event the feed returns, with price filled in from the access at this delivery attempt.
        `webhook-id` equals the event's `id`; drop ids already seen by feed or webhook. Verify `webhook-signature`
        (v1, base64 HMAC-SHA256 of "{webhook-id}.{webhook-timestamp}.{body}"; the key is the base64-decoded part of
        the secret after `whsec_`). During a secret change it holds two signatures separated by a space; accept
        either. Refuse a timestamp more than 5 minutes off. Each event is retried for up to 24 hours; a webhook whose
        every delivery fails for 3 days is turned off (status disabled). The feed stays the record.
      parameters:
        - { name: webhook-id, in: header, required: true, schema: { type: string } }
        - { name: webhook-timestamp, in: header, required: true, schema: { type: string, pattern: '^[0-9]+$' } }
        - { name: webhook-signature, in: header, required: true, schema: { type: string } }
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/Event' }
      responses:
        '2XX':
          description: Received

components:
  securitySchemes:
    partnerToken:
      type: http
      scheme: bearer
      description: |
        A pasted partner token, dxp_live_… or dxp_test_… (test fixtures only). Acts as the Diaex person who made
        it, in their company; the access level is read on every request. Scopes: stones:read, prices:read,
        holds:write, events:read (handoff:write in v2).
    oauth:
      type: oauth2
      description: Authorization code with PKCE (S256 only); loopback redirect for Pavé on a designer's computer.
      flows:
        authorizationCode:
          authorizationUrl: https://console.thediaex.com/oauth/authorize
          tokenUrl: https://api.thediaex.com/partner/v1/oauth/token
          refreshUrl: https://api.thediaex.com/partner/v1/oauth/token
          scopes:
            stones:read: Search, sets, match, availability, stone detail, me
            prices:read: Prices, only for a verified company
            holds:write: Place, extend, list and release holds
            events:read: Watch list, events feed, webhooks
        clientCredentials:
          tokenUrl: https://api.thediaex.com/partner/v1/oauth/token
          scopes:
            stones:read: App token at the signed_out level, for hosted Pavé
    clientBasic:
      type: http
      scheme: basic
      description: Confidential clients (hosted Pavé) at the token endpoint.

  headers:
    RequestId:
      description: Diaex's id for this request, req_ and 32 hex characters.
      schema: { type: string, pattern: '^req_[0-9a-f]{32}$' }
    RetryAfter:
      description: Whole seconds to wait.
      schema: { type: integer, minimum: 1 }
    ETag:
      description: Weak tag over the stone as this caller sees it.
      schema: { type: string }

  parameters:
    ClientRequestId:
      name: X-Client-Request-Id
      in: header
      required: false
      schema: { type: string, pattern: '^[A-Za-z0-9_-]{1,64}$' }
    IdempotencyKey:
      name: Idempotency-Key
      in: header
      required: true
      description: |
        Kept 24 hours per link, method and path. The same key and body answers the first reply again, exactly as it
        was. A different body, method or path is 422 idempotency_key_reused; a missing key is 422
        idempotency_key_missing.
      schema: { type: string, pattern: '^[A-Za-z0-9_-]{1,64}$' }
    StoneId:
      name: id
      in: path
      required: true
      description: Percent-encoded, dots included.
      schema: { $ref: '#/components/schemas/StoneId' }
    WebhookId:
      name: webhook_id
      in: path
      required: true
      schema: { type: string, pattern: '^whk_[A-Za-z0-9]{1,60}$' }
    HoldId:
      name: hold_id
      in: path
      required: true
      schema: { type: string, pattern: '^hld_[A-Za-z0-9]{1,60}$' }
    Limit:
      name: limit
      in: query
      required: false
      schema: { type: integer, minimum: 1, maximum: 100, default: 100 }
    Cursor:
      name: cursor
      in: query
      required: false
      schema: { type: string, maxLength: 512 }

  responses:
    BadRequest:
      description: bad_cursor
      headers:
        x-request-id: { $ref: '#/components/headers/RequestId' }
      content:
        application/json:
          schema: { $ref: '#/components/schemas/Error' }
    Unauthorized:
      description: unauthenticated, token_expired or token_revoked
      headers:
        x-request-id: { $ref: '#/components/headers/RequestId' }
      content:
        application/json:
          schema: { $ref: '#/components/schemas/Error' }
    Forbidden:
      description: insufficient_scope, company_not_verified (holds, watches, events, webhooks) or access_removed
      headers:
        x-request-id: { $ref: '#/components/headers/RequestId' }
      content:
        application/json:
          schema: { $ref: '#/components/schemas/Error' }
    NotFound:
      description: stone_unavailable (with `missing` for locked ids) or not_found (a hold or webhook)
      headers:
        x-request-id: { $ref: '#/components/headers/RequestId' }
      content:
        application/json:
          schema: { $ref: '#/components/schemas/Error' }
    Conflict:
      description: stone_on_memo (with `stones`), locked_unfit (with `differences`), hold_not_extendable, idempotency_in_progress or webhook_limit_reached
      headers:
        x-request-id: { $ref: '#/components/headers/RequestId' }
      content:
        application/json:
          schema: { $ref: '#/components/schemas/Error' }
    Gone:
      description: cursor_expired
      headers:
        x-request-id: { $ref: '#/components/headers/RequestId' }
      content:
        application/json:
          schema: { $ref: '#/components/schemas/Error' }
    TooLarge:
      description: body_too_large (over 32 KB; 64 KB for /requirements/match)
      headers:
        x-request-id: { $ref: '#/components/headers/RequestId' }
      content:
        application/json:
          schema: { $ref: '#/components/schemas/Error' }
    Invalid:
      description: invalid_request (with `detail` inside `error`), requirement_unsupported (with `reason`), idempotency_key_missing, idempotency_key_reused or webhook_url_not_public
      headers:
        x-request-id: { $ref: '#/components/headers/RequestId' }
      content:
        application/json:
          schema: { $ref: '#/components/schemas/Error' }
    TooManyRequests:
      description: rate_limited. A used daily priced-stone quota is not a 429; replies go on without prices.
      headers:
        x-request-id: { $ref: '#/components/headers/RequestId' }
        Retry-After: { $ref: '#/components/headers/RetryAfter' }
      content:
        application/json:
          schema: { $ref: '#/components/schemas/Error' }
    ServerError:
      description: internal (retryable), or cursor_unavailable (not retryable; a cursor for the next page could not be made)
      headers:
        x-request-id: { $ref: '#/components/headers/RequestId' }
      content:
        application/json:
          schema: { $ref: '#/components/schemas/Error' }
    Unavailable:
      description: storage_unavailable (retryable)
      headers:
        x-request-id: { $ref: '#/components/headers/RequestId' }
      content:
        application/json:
          schema: { $ref: '#/components/schemas/Error' }

  schemas:
    StoneId:
      type: string
      minLength: 1
      maxLength: 64
      description: |
        Diaex's public id. Opaque. At most 64 characters, the most a ?stone= link opens; Diaex confirms no listed
        stone has a longer id.

    Ref:
      type: string
      pattern: '^[A-Za-z0-9_-]{1,64}$'
      description: |
        The partner's own opaque label, echoed back. Never design content. Pavé sends r_ and 6 to 12 hex characters.

    Mm:
      type: number
      description: Millimetres, at most 2 decimals.

    Money:
      type: object
      additionalProperties: false
      required: [amount, currency]
      properties:
        amount: { type: string, pattern: '^[0-9]+\.[0-9]{2}$', examples: ['6120.00'] }
        currency: { type: string, pattern: '^[A-Z]{3}$', examples: [USD] }

    NullableMoney:
      oneOf:
        - $ref: '#/components/schemas/Money'
        - type: 'null'

    Access:
      type: object
      required: [level, prices, markup, prices_hidden_reason]
      properties:
        level: { type: string, enum: [signed_out, not_approved, approved] }
        prices: { type: boolean, description: 'False without prices:read, and once the daily quota is used.' }
        markup: { type: boolean, description: Prices are raised by the company's markup. }
        prices_hidden_reason:
          type: [string, 'null']
          x-extensible-enum: [signed_out, not_verified, scope_missing, quota_exceeded, null]

    Error:
      type: object
      required: [error, request_id]
      properties:
        error:
          type: object
          required: [code, message, retryable]
          properties:
            code:
              type: string
              x-extensible-enum:
                - bad_cursor
                - unauthenticated
                - token_expired
                - token_revoked
                - insufficient_scope
                - company_not_verified
                - access_removed
                - stone_unavailable
                - not_found
                - stone_on_memo
                - locked_unfit
                - hold_not_extendable
                - idempotency_in_progress
                - webhook_limit_reached
                - cursor_expired
                - body_too_large
                - invalid_request
                - requirement_unsupported
                - idempotency_key_missing
                - idempotency_key_reused
                - webhook_url_not_public
                - rate_limited
                - internal
                - cursor_unavailable
                - storage_unavailable
            message: { type: string, description: For people; decide by code. }
            retryable: { type: boolean }
            missing: { type: array, items: { $ref: '#/components/schemas/StoneId' } }
            stones: { type: array, items: { $ref: '#/components/schemas/StoneId' } }
            differences: { type: array, items: { type: object } }
            reason: { $ref: '#/components/schemas/UnsupportedReason' }
            detail:
              type: array
              description: Each field and why. Never the value sent. Inside `error`, unlike Diaex's 422 today.
              items:
                type: object
                properties:
                  loc: { type: array, items: { type: [string, integer] } }
                  msg: { type: string }
                  type: { type: string }
        request_id: { type: string }

    OAuthError:
      type: object
      required: [error]
      properties:
        error:
          type: string
          enum: [invalid_request, invalid_client, invalid_grant, unauthorized_client, unsupported_grant_type, invalid_scope]
        error_description: { type: string }

    UnsupportedReason:
      type: string
      x-extensible-enum: [parcels_not_listed, material_not_listed, cut_not_listed, colour_not_listed, set_too_large]

    AvailabilityStatus:
      type: string
      description: An unknown value means not pickable.
      x-extensible-enum: [available, memo, on_hold, unavailable, unknown]

    Measurements:
      type: object
      required: [length_mm, width_mm, height_mm, ratio]
      properties:
        length_mm: { type: [number, 'null'], description: The longer side. }
        width_mm: { type: [number, 'null'] }
        height_mm: { type: [number, 'null'] }
        ratio: { type: [number, 'null'] }

    Profile:
      type: object
      properties:
        table_pct: { type: [number, 'null'] }
        depth_pct: { type: [number, 'null'] }
        crown_angle: { type: [number, 'null'] }
        crown_height_pct: { type: [number, 'null'] }
        pavilion_angle: { type: [number, 'null'] }
        pavilion_depth_pct: { type: [number, 'null'] }
        girdle_thin: { type: [string, 'null'] }
        girdle_thick: { type: [string, 'null'] }
        culet: { type: [string, 'null'] }

    Certificate:
      type: object
      required: [lab, report_no, report_url]
      properties:
        lab: { type: [string, 'null'] }
        report_no: { type: [string, 'null'], description: Only when the number fits the lab's format. }
        report_url: { type: [string, 'null'], format: uri }

    Media:
      type: object
      required: [image_url, video_url]
      properties:
        image_url:
          type: [string, 'null']
          format: uri
          description: Absolute, public, cacheable. Width through w = 96, 256, 512 or 1024.
        video_url: { type: [string, 'null'], format: uri }

    Location:
      type: object
      required: [country, city]
      properties:
        country: { type: [string, 'null'], pattern: '^[A-Z]{2}$' }
        city: { type: [string, 'null'] }

    Stone:
      type: object
      required: [id, url, shape, shape_group, carat, origin, measurements, certificate, media, availability, price, price_per_carat, etag, updated_at]
      properties:
        id: { $ref: '#/components/schemas/StoneId' }
        url: { type: string, format: uri, description: 'Diaex page that opens this stone, signed out or in. How it opens in the old look is decision D17.' }
        shape: { type: [string, 'null'], description: The supplier's word. }
        shape_group: { type: [string, 'null'] }
        carat: { type: [number, 'null'] }
        origin: { type: [string, 'null'], enum: [natural, lab, null], description: Null when Diaex has no stone type. }
        growth: { type: [string, 'null'], enum: [CVD, HPHT, null] }
        color: { type: [string, 'null'] }
        fancy_color: { type: [string, 'null'] }
        fancy_hue: { type: [string, 'null'] }
        fancy_intensity: { type: [string, 'null'] }
        clarity: { type: [string, 'null'] }
        cut: { type: [string, 'null'] }
        polish: { type: [string, 'null'] }
        symmetry: { type: [string, 'null'] }
        fluorescence: { type: [string, 'null'] }
        treatment: { type: string, enum: [TREATED, UNTREATED, UNKNOWN], description: 'New mapping: Diaex''s null today is UNKNOWN.' }
        measurements: { $ref: '#/components/schemas/Measurements' }
        profile: { $ref: '#/components/schemas/Profile' }
        certificate: { $ref: '#/components/schemas/Certificate' }
        media: { $ref: '#/components/schemas/Media' }
        location: { $ref: '#/components/schemas/Location' }
        availability: { type: string, x-extensible-enum: [available, memo, on_hold], description: An unknown value means not pickable. }
        price: { $ref: '#/components/schemas/NullableMoney' }
        price_per_carat: { $ref: '#/components/schemas/NullableMoney' }
        has_pair: { type: [boolean, 'null'], description: A hint, never a promise. }
        etag: { type: string }
        updated_at: { type: string, format: date-time, description: 'Last change in this caller''s view; a price change moves it only for callers who see prices.' }

    Fit:
      type: object
      required: [d_length_mm, d_width_mm, d_height_mm, in_window, score]
      description: |
        d = stone minus seat, per side. Error e = d / tol_plus when d > 0, -d / tol_minus when d < 0, 0 when d = 0.
        in_window = both errors at most 1 (and height at most max_height_mm when sent).
        score = 1 - max(e_length, e_width), kept in 0..1, rounded half up to 2 decimals, in decimals.
      properties:
        d_length_mm: { type: number }
        d_width_mm: { type: number }
        d_height_mm: { type: [number, 'null'] }
        in_window: { type: boolean }
        score: { type: number, minimum: 0, maximum: 1 }

    Seat:
      type: object
      additionalProperties: false
      required: [length_mm, width_mm, tol_minus_mm, tol_plus_mm]
      properties:
        length_mm: { type: number, minimum: 0.3, maximum: 40, description: At least width_mm. }
        width_mm: { type: number, minimum: 0.3, maximum: 40 }
        tol_minus_mm: { type: number, minimum: 0, maximum: 2 }
        tol_plus_mm: { type: number, minimum: 0, maximum: 2 }
        max_height_mm: { type: [number, 'null'], minimum: 0.1, maximum: 40 }

    CaratRange:
      type: object
      additionalProperties: false
      properties:
        min: { type: number, exclusiveMinimum: 0, maximum: 30 }
        max: { type: number, exclusiveMinimum: 0, maximum: 30 }

    CertificateRule:
      type: object
      additionalProperties: false
      properties:
        required: { type: boolean, default: false, description: True drops stones with no lab. }
        labs:
          type: [array, 'null']
          maxItems: 16
          items: { type: string, maxLength: 16 }

    Requirement:
      type: object
      additionalProperties: false
      required: [ref, kind, quantity, gem, origin, shape, seat]
      properties:
        ref: { $ref: '#/components/schemas/Ref' }
        kind: { type: string, enum: [single, matched_set, parcel] }
        quantity: { type: integer, minimum: 1, description: '1 for single; 2 to 70 for matched_set; any for parcel.' }
        gem: { type: string, minLength: 1, maxLength: 32, description: 'diamond; anything else is answered unsupported.' }
        origin: { type: string, enum: [natural, lab, any] }
        shape: { type: string, minLength: 1, maxLength: 64 }
        seat: { $ref: '#/components/schemas/Seat' }
        carat:
          oneOf:
            - $ref: '#/components/schemas/CaratRange'
            - type: 'null'
        colors: { type: [array, 'null'], maxItems: 23, items: { type: string, maxLength: 12 } }
        fancy_hues: { type: [array, 'null'], maxItems: 10, items: { type: string, maxLength: 16 } }
        fancy_intensities: { type: [array, 'null'], maxItems: 10, items: { type: string, maxLength: 32 } }
        clarities: { type: [array, 'null'], maxItems: 16, items: { type: string, maxLength: 8 } }
        certificate: { $ref: '#/components/schemas/CertificateRule' }
        max_price_each:
          oneOf:
            - $ref: '#/components/schemas/Money'
            - type: 'null'
        include_memo: { type: boolean, default: false, description: single only. }
        same_supplier: { type: boolean, default: false, description: matched_set only. }
        exclude:
          type: array
          maxItems: 70
          uniqueItems: true
          items: { $ref: '#/components/schemas/StoneId' }

    Candidate:
      type: object
      required: [stone, fit]
      properties:
        stone: { $ref: '#/components/schemas/Stone' }
        fit: { $ref: '#/components/schemas/Fit' }

    Spread:
      type: object
      properties:
        length_mm: { type: number }
        width_mm: { type: number }
        table_pct: { type: number }
        depth_pct: { type: number }
        crown_height_pct: { type: number }

    StoneSet:
      type: object
      required: [stones, total_price, total_carat, spread, suppliers, one_supplier, relaxed]
      properties:
        stones: { type: array, items: { $ref: '#/components/schemas/Candidate' } }
        total_price: { $ref: '#/components/schemas/NullableMoney' }
        total_carat: { type: number }
        spread: { $ref: '#/components/schemas/Spread' }
        suppliers: { type: integer, minimum: 0 }
        one_supplier: { type: boolean }
        relaxed: { type: boolean, description: Found one grade apart. }

    LargestSet:
      allOf:
        - $ref: '#/components/schemas/StoneSet'
        - type: object
          required: [count]
          properties:
            count: { type: integer, minimum: 2 }

    Loosen:
      type: object
      additionalProperties: false
      properties:
        length_mm: { type: number, exclusiveMinimum: 0 }
        width_mm: { type: number, exclusiveMinimum: 0 }
        table_pct: { type: number, exclusiveMinimum: 0 }
        depth_pct: { type: number, exclusiveMinimum: 0 }
        crown_height_pct: { type: number, exclusiveMinimum: 0 }

    StonesSearchRequest:
      type: object
      additionalProperties: false
      required: [requirement]
      properties:
        requirement: { $ref: '#/components/schemas/Requirement' }
        sort: { type: string, enum: [fit, price_asc, ppc_asc], default: fit }
        limit: { type: integer, minimum: 1, maximum: 100, default: 24 }
        cursor: { type: [string, 'null'], maxLength: 512 }

    StonesSearchResponse:
      type: object
      required: [ref, candidates, total, next_cursor, dropped, search_url, access]
      properties:
        ref: { $ref: '#/components/schemas/Ref' }
        candidates: { type: array, items: { $ref: '#/components/schemas/Candidate' } }
        total: { type: [integer, 'null'], description: First page only. }
        next_cursor: { type: [string, 'null'] }
        dropped: { type: array, items: { type: string, enum: [max_price_each] } }
        search_url: { type: string, format: uri }
        access: { $ref: '#/components/schemas/Access' }

    SetsSearchRequest:
      type: object
      additionalProperties: false
      required: [requirement]
      properties:
        requirement: { $ref: '#/components/schemas/Requirement' }
        locked:
          type: array
          maxItems: 70
          uniqueItems: true
          items: { $ref: '#/components/schemas/StoneId' }
        loosen:
          oneOf:
            - $ref: '#/components/schemas/Loosen'
            - type: 'null'

    SetsSearchResponse:
      type: object
      required: [ref, sets, one_supplier, complete, capped, stopped, largest_found, search_url, access]
      properties:
        ref: { $ref: '#/components/schemas/Ref' }
        sets: { type: array, maxItems: 3, items: { $ref: '#/components/schemas/StoneSet' } }
        one_supplier:
          oneOf:
            - $ref: '#/components/schemas/StoneSet'
            - type: 'null'
        complete: { type: boolean }
        capped: { type: boolean, description: More than 2,000 candidates were in the window. }
        stopped: { type: boolean, description: The search ran out of time. }
        largest_found:
          oneOf:
            - $ref: '#/components/schemas/LargestSet'
            - type: 'null'
        search_url: { type: string, format: uri }
        access: { $ref: '#/components/schemas/Access' }

    MatchRequest:
      type: object
      additionalProperties: false
      required: [requirements]
      properties:
        requirements:
          type: array
          minItems: 1
          maxItems: 50
          items: { $ref: '#/components/schemas/Requirement' }
          description: Each ref once.
        sort: { type: string, enum: [fit, price_asc, ppc_asc], default: fit }
        limit_per_row: { type: integer, minimum: 1, maximum: 50, default: 10 }

    RowResult:
      type: object
      required: [ref, kind, status]
      properties:
        ref: { $ref: '#/components/schemas/Ref' }
        kind: { type: string, enum: [single, matched_set, parcel] }
        status: { type: string, x-extensible-enum: [matched, none, unsupported, error] }
        reason:
          oneOf:
            - $ref: '#/components/schemas/UnsupportedReason'
            - type: 'null'
        candidates: { type: array, items: { $ref: '#/components/schemas/Candidate' } }
        total: { type: [integer, 'null'] }
        sets: { type: array, items: { $ref: '#/components/schemas/StoneSet' } }
        one_supplier:
          oneOf:
            - $ref: '#/components/schemas/StoneSet'
            - type: 'null'
        complete: { type: boolean }
        capped: { type: boolean, description: matched_set rows only. More than 2,000 candidates were in the window. }
        stopped: { type: boolean, description: matched_set rows only. The set search ran out of time. }
        largest_found:
          description: matched_set rows only.
          oneOf:
            - $ref: '#/components/schemas/LargestSet'
            - type: 'null'
        search_url: { type: [string, 'null'], format: uri }
        error:
          type: [object, 'null']
          properties:
            code: { type: string, enum: [row_timeout] }
            retryable: { type: boolean }

    MatchResponse:
      type: object
      required: [results, access]
      properties:
        results: { type: array, items: { $ref: '#/components/schemas/RowResult' } }
        access: { $ref: '#/components/schemas/Access' }

    AvailabilityRequest:
      type: object
      additionalProperties: false
      required: [ids]
      properties:
        ids:
          type: array
          minItems: 1
          maxItems: 100
          items: { $ref: '#/components/schemas/StoneId' }

    AvailabilityItem:
      type: object
      required: [id, status, reason, held_by_you, price, price_per_carat, etag, updated_at]
      properties:
        id: { $ref: '#/components/schemas/StoneId' }
        status: { $ref: '#/components/schemas/AvailabilityStatus' }
        reason: { type: [string, 'null'], x-extensible-enum: [sold, delisted, null] }
        held_by_you: { type: boolean, description: Always false in v1. }
        price: { $ref: '#/components/schemas/NullableMoney' }
        price_per_carat: { $ref: '#/components/schemas/NullableMoney' }
        etag: { type: [string, 'null'] }
        updated_at: { type: [string, 'null'], format: date-time }

    AvailabilityResponse:
      type: object
      required: [items, access]
      properties:
        items: { type: array, items: { $ref: '#/components/schemas/AvailabilityItem' } }
        access: { $ref: '#/components/schemas/Access' }

    StoneResponse:
      type: object
      required: [stone, access]
      properties:
        stone: { $ref: '#/components/schemas/Stone' }
        access: { $ref: '#/components/schemas/Access' }

    Company:
      type: object
      required: [id, name, verified, kyc_status]
      properties:
        id: { type: string }
        name: { type: string }
        verified: { type: boolean }
        kyc_status: { type: string, enum: [not_submitted, submitted, approved, rejected] }

    Link:
      type: object
      required: [id, kind, name, scopes, mode, last4, created_at, expires_at]
      properties:
        id: { type: string, pattern: '^lnk_' }
        kind: { type: string, enum: [token, oauth] }
        name: { type: string }
        scopes:
          type: array
          items: { type: string, enum: ['stones:read', 'prices:read', 'holds:write', 'events:read', 'handoff:write'] }
        mode: { type: string, enum: [live, test] }
        last4: { type: string, minLength: 4, maxLength: 4 }
        created_at: { type: string, format: date-time }
        expires_at: { type: [string, 'null'], format: date-time }

    Me:
      type: object
      required: [access, company, link, features]
      properties:
        access: { $ref: '#/components/schemas/Access' }
        features:
          type: array
          description: Optional parts switched on for this server. Empty in v1.
          items: { type: string, x-extensible-enum: [holds, events, webhooks] }
        company:
          oneOf:
            - $ref: '#/components/schemas/Company'
            - type: 'null'
        link:
          oneOf:
            - $ref: '#/components/schemas/Link'
            - type: 'null'

    TokenRequest:
      type: object
      required: [grant_type]
      properties:
        grant_type: { type: string, enum: [authorization_code, refresh_token, client_credentials] }
        code: { type: string }
        redirect_uri: { type: string }
        client_id: { type: string }
        code_verifier: { type: string, minLength: 43, maxLength: 128 }
        refresh_token: { type: string }
        scope: { type: string }

    TokenResponse:
      type: object
      required: [access_token, token_type, expires_in, scope]
      properties:
        access_token: { type: string }
        token_type: { type: string, enum: [Bearer] }
        expires_in: { type: integer, examples: [3600] }
        refresh_token: { type: string, description: Not sent for client_credentials. }
        scope: { type: string }

    Hold:
      type: object
      required: [id, stone_id, status, reason, reference, created_at, expires_at, ended_at, extensions_left]
      properties:
        id: { type: [string, 'null'], description: Null when refused. }
        stone_id: { $ref: '#/components/schemas/StoneId' }
        status: { type: string, x-extensible-enum: [active, ended, refused], description: An unknown value means not held. }
        reason:
          type: [string, 'null']
          description: |
            Null while active. Refused: stone_held, stone_on_memo, stone_unavailable, hold_limit_reached,
            hold_cooldown. Ended: released_by_you, expired, stone_sold, stone_delisted, released_by_staff,
            link_revoked, access_lost.
          x-extensible-enum:
            - stone_held
            - stone_on_memo
            - stone_unavailable
            - hold_limit_reached
            - hold_cooldown
            - released_by_you
            - expired
            - stone_sold
            - stone_delisted
            - released_by_staff
            - link_revoked
            - access_lost
            - null
        reference:
          oneOf:
            - $ref: '#/components/schemas/Ref'
            - type: 'null'
        created_at: { type: [string, 'null'], format: date-time }
        expires_at: { type: [string, 'null'], format: date-time }
        ended_at: { type: [string, 'null'], format: date-time }
        extensions_left: { type: integer, minimum: 0 }

    HoldsCreateRequest:
      type: object
      additionalProperties: false
      required: [stone_ids]
      properties:
        stone_ids:
          type: array
          minItems: 1
          maxItems: 10
          uniqueItems: true
          items: { $ref: '#/components/schemas/StoneId' }
        minutes: { type: integer, minimum: 30, maximum: 120, default: 60 }
        reference:
          oneOf:
            - $ref: '#/components/schemas/Ref'
            - type: 'null'

    HoldsCreateResponse:
      type: object
      required: [holds]
      properties:
        holds: { type: array, items: { $ref: '#/components/schemas/Hold' } }

    HoldExtendRequest:
      type: object
      additionalProperties: false
      required: [minutes]
      properties:
        minutes: { type: integer, minimum: 30, maximum: 120 }

    HoldList:
      type: object
      required: [holds, next_cursor]
      properties:
        holds: { type: array, items: { $ref: '#/components/schemas/Hold' } }
        next_cursor: { type: [string, 'null'] }

    WatchesRequest:
      type: object
      additionalProperties: false
      required: [stone_ids]
      properties:
        stone_ids:
          type: array
          minItems: 1
          maxItems: 100
          uniqueItems: true
          items: { $ref: '#/components/schemas/StoneId' }

    WatchesResponse:
      type: object
      required: [watching, refused]
      properties:
        watching: { type: array, items: { $ref: '#/components/schemas/StoneId' } }
        refused:
          type: array
          items:
            type: object
            required: [id, reason]
            properties:
              id: { $ref: '#/components/schemas/StoneId' }
              reason: { type: string, enum: [unknown, watch_limit_reached] }

    WatchList:
      type: object
      required: [stone_ids, next_cursor]
      properties:
        stone_ids: { type: array, items: { $ref: '#/components/schemas/StoneId' } }
        next_cursor: { type: [string, 'null'] }

    EventType:
      type: string
      x-extensible-enum:
        - stone.price_changed
        - stone.unavailable
        - stone.available
        - stone.memo
        - stone.updated
        - hold.expiring
        - hold.ended

    Event:
      type: object
      required: [id, type, created_at, stone_id, hold_id, data]
      properties:
        id: { type: string, pattern: '^evt_' }
        type: { $ref: '#/components/schemas/EventType' }
        created_at: { type: string, format: date-time }
        stone_id:
          oneOf:
            - $ref: '#/components/schemas/StoneId'
            - type: 'null'
        hold_id: { type: [string, 'null'] }
        data:
          type: object
          description: |
            stone.price_changed: {price, price_per_carat, was_price}, filled in from the caller's access when read
            or delivered, and only to callers who see prices at that moment; with the daily quota used, sent with all
            three null.
            stone.unavailable: {status: on_hold | unavailable, reason: order_hold | hold | sold | delisted}.
            stone.available: {status: available}. stone.memo: {status: memo}.
            stone.updated: {fields: [...]}. hold.expiring: {expires_at}. hold.ended: {ended_at, reason}, with the
            Hold's ended reasons.

    EventsPage:
      type: object
      required: [events, next_cursor, has_more]
      properties:
        events: { type: array, items: { $ref: '#/components/schemas/Event' } }
        next_cursor: { type: string, description: Always set; store it and pass it next time. }
        has_more: { type: boolean }

    WebhookCreateRequest:
      type: object
      additionalProperties: false
      required: [url, types]
      properties:
        url: { type: string, format: uri, pattern: '^https://', maxLength: 2048 }
        types:
          type: array
          minItems: 1
          uniqueItems: true
          items: { $ref: '#/components/schemas/EventType' }

    Webhook:
      type: object
      required: [id, url, types, status, disabled_at, created_at]
      properties:
        id: { type: string, pattern: '^whk_' }
        url: { type: string, format: uri }
        types: { type: array, items: { $ref: '#/components/schemas/EventType' } }
        status: { type: string, x-extensible-enum: [active, disabled], description: Disabled after 3 days in which every delivery failed. }
        disabled_at: { type: [string, 'null'], format: date-time }
        created_at: { type: string, format: date-time }

    WebhookCreated:
      allOf:
        - $ref: '#/components/schemas/Webhook'
        - type: object
          required: [secret]
          properties:
            secret: { type: string, pattern: '^whsec_', description: Shown once. }

    WebhookList:
      type: object
      required: [webhooks]
      properties:
        webhooks: { type: array, items: { $ref: '#/components/schemas/Webhook' } }
```
