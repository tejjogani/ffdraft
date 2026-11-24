# Brief for the Diaex agent: a partner API for Pavé

You are working in the Diaex backend repository. This brief is pasted to you by Pavé's founder, who also owns
Diaex. You cannot read Pavé's repository, so everything you need is below. **This brief asks you for a plan,
not for code.**

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

1. **Read first:** `diaex:AGENTS.md`, `diaex:docs/process/1-plan.md`, `2-build.md`, `3-review.md`, then every file
   in section 3 below. Never ask Tej what the repository already answers (`diaex:docs/process/1-plan.md:8-10`).
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
   8. **The PR split**, each step at most 400 counted lines and working on its own. Start from Part C, section 5.
   9. **Decisions for Tej**, D1, D2, …, each with a proposal. Start from Part C, section 6.
4. **Open the plan as a pull request containing only the plan**, on a branch such as `plans/pave-partner-api`
   (`diaex:docs/process/1-plan.md:45`). Markdown is not counted toward the size limit
   (`diaex:scripts/pr_size.py:25`).
5. **Stop.** No code, no schema change, no test until Tej writes **approved** (`diaex:AGENTS.md:9`,
   `diaex:docs/process/1-plan.md:46`). A change of scope found later goes back to the plan first
   (`diaex:docs/process/1-plan.md:47`).

When building starts, after approval (`diaex:docs/process/2-build.md`):
- One branch and pull request per step, named `<area>/<short-name>` (`diaex:AGENTS.md:34-35`); never commit to
  `main`.
- Tests first; each must fail for the reason the plan predicts (`diaex:docs/process/2-build.md:7-10`).
- Python tests only on a throwaway database, with the one chained command (`diaex:AGENTS.md:65`,
  `diaex:docs/process/2-build.md:14-27`). Your server runs on port 8001; leave 8000 alone (`diaex:AGENTS.md:63`).
- `python3 scripts/pr_size.py` at 400 or fewer (`diaex:scripts/pr_size.py:22-23`).
- Every new file in the file map of `docs/ARCHITECTURE.md`, every class in `docs/TYPES.md`, every route in
  `docs/ARCHITECTURE.md` (`diaex:docs/ARCHITECTURE.md:15-17`) and classified in `tests/test_pro_routes.py`
  (`diaex:tests/test_pro_routes.py:17-19`).
- A new database test file carries the `skipif(not DB)` mark (`diaex:AGENTS.md:74-76`).
- Two streams share the repository: accounts, web and browse; and sourcing (`app/sourcing/`, the sourcing part of
  `db/schema.sql` from `diaex:db/schema.sql:1093`). Never commit the other stream's changes; shared files are
  staged part by part (`diaex:AGENTS.md:87-92`).
- Hard limits: Firestore read only, production never touched, no secrets in files, commits, PRs or chat; request
  files use `{{NAME}}` placeholders (`diaex:AGENTS.md:80-86`). A partner token is a secret.
- New dependencies need Tej's OK (`diaex:AGENTS.md:56`).
- Review by a fresh agent: **PASS** or **FAIL** on the first line (`diaex:docs/process/3-review.md:1-6`). The
  security check matters most here: "DiaEx once leaked its cost book by sending a raw record"
  (`diaex:docs/process/3-review.md:23-24`).

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
| Allocations: one held per stone by a unique index, no expiry, only from a Buy, hide the stone from everyone | `diaex:db/schema.sql:1496-1511`, `diaex:docs/SOURCING.md:181-207` |
| Sold marks hide a stone everywhere | `diaex:db/schema.sql:1516-1535` |
| Only a Buy gives priority; an RFQ reserves nothing | `diaex:docs/SOURCING-SPEC.md:117-119,219-221` |
| Buy needs Pro, `BUY_ENABLED` and a verified company; production leaves it closed | `diaex:app/sourcing/api.py:111`, `diaex:app/launch.py:1-12` |
| Terms: Diaex does not accept orders or process payment | `diaex:web/src/routes/legal/Terms.tsx:37-41` |
| KYC states | `diaex:db/schema.sql:393-394`, `diaex:app/kyc.py:1-20`, `diaex:app/staff_routes.py:231` |
| Company audit actions are a fixed list | `diaex:db/schema.sql:448-465` |
| A fake catalogue for tests | `diaex:app/catalog.py:695-700` |
| `?stone=<id>` opens a stone only in the new look | `diaex:web/src/stone/address.ts:1-3,13-18` |

#### 3.3 What does not exist

- **No partner credentials.** Sign-in is a Firebase browser token (`diaex:app/auth.py:1-14,177-194`). The only
  machine tokens are Aska's two outbound feed tokens, internal Ed25519 tokens and the voice token
  (`diaex:app/service_tokens.py:1-7`, `diaex:app/auth.py:142-147`).
- **No limits on search, stones, match or layouts**, and the limits that exist are per server process
  (`diaex:app/limits.py:1-12,67-73`).
- **No hold "while deciding"**; saved set plans reserve nothing (`diaex:db/schema.sql:951-962`).
- **No CORS** and none needed: Pavé calls from its server. `api.thediaex.com` is planned for machine callers
  (`diaex:docs/plans/2026-10-26-render-deploy.md:144,389`).
- **No partner API is built or planned.** The nearest note is the backlog item on describing a piece of jewellery
  to the assistant (`diaex:docs/plans/2026-11-04-ai-jewellery-composition-todo.md:1-17`).

Two things to know: (1) `AGENTS.md` says the new look is off by default, but the API defaults `NEW_LOOK` to
`all` (`diaex:app/main.py:617-624`); any new screen must still work in both looks. (2) Four plans the code cites
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
| N10 | `?stone=` working in both looks | Web |
| N11 | Test mode with the fixture set | Browse |
| N12 | OAuth 2.0 with PKCE, loopback redirect, consent page (v1.1) | Accounts / web |
| N13 | Holds with an end time (v1.1) | **Sourcing** for the table; **browse** for `AVAILABLE`. Cross-stream: decision D8 |
| N14 | Watch list and events feed (v1.1); optional webhooks | Browse for stone events; sourcing events need agreement (D9) |
| N15 | Hand-off (v2) | Browse for a shortlist; sourcing for any cart or Buy |

---

## Part B: the contract

What follows is the contract Pavé and Diaex agree on, word for word as Pavé holds it
(`docs/integrations/diaex-partner-api.md`). Pavé also holds the same contract as OpenAPI 3.1
(`docs/integrations/diaex-partner-api.openapi.yaml`); ask the founder for that file if you want it, it says the same
thing. Where your plan changes any of it, list the change in the plan so Pavé can follow.
Section numbers inside Part B are the contract's own ("Part B, section 5.3").

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
   values. Pavé must ignore fields it does not know and treat an unknown enum value as "other". Anything else is
   `/partner/v2`, with both versions served for at least 6 months and a `Sunset` header (RFC 8594) on the old one.
3. **Strict requests.** Diaex refuses a request field it does not know with 422, as every Diaex model does today
   (`extra="forbid"`, `diaex:app/catalog.py:64`, `diaex:app/layouts.py:77`). This also keeps anything but stone
   specifications out of Diaex (section 9).
4. **Opaque string ids.** A stone's `id` is Diaex's public id, the only id callers see today
   (`diaex:db/schema.sql:91-93`, `diaex:app/browse.py:20-22`), at most 128 characters
   (`diaex:app/layouts.py:29`). Hold, event, link and webhook ids are prefixed strings (`hld_`, `evt_`, `lnk_`,
   `whk_`). Pavé never parses an id.
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
   (`diaex:app/catalog.py:253-260`): one made for another link or level is refused with 400 `bad_cursor`.
9. **Idempotency.** Every write (`POST` that changes state, `DELETE`) needs an `Idempotency-Key` header: 1 to 64
   characters of `A-Z a-z 0-9 _ -`. Diaex keeps a key for 24 hours per link. The same key with the same body
   answers the first reply again; with a different body, 422 `idempotency_key_reused`; while the first is still
   running, 409 `idempotency_in_progress`. Searches are `POST` but write nothing and need no key. **New.**
10. **One error shape** with stable codes (section 6), the shape Diaex uses today
    (`diaex:app/main.py:257-262`, `diaex:app/sourcing/api.py:88-94`).
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
- **Hosted Pavé is a confidential client** with its own `client_id`, a client secret (`client_secret_basic`) and
  exact `https` redirects registered with Diaex.
- **Steps.** (1) Pavé opens `https://console.thediaex.com/oauth/authorize?response_type=code&client_id=…&redirect_uri=…&scope=stones:read%20prices:read&state=…&code_challenge=…&code_challenge_method=S256`
  in the browser. (2) The person signs in to Diaex as today (Firebase, `diaex:app/auth.py:6-9`) and sees which
  company, which scopes and which app. (3) Diaex redirects to the loopback address with `code` and `state`. The
  code is single-use and lasts 5 minutes. (4) Pavé's server posts the code and `code_verifier` to
  `POST /partner/v1/oauth/token`.
- **Tokens.** Access token 1 hour; refresh token rotated on every use. Reusing an old refresh token revokes the
  whole link (OAuth 2.0 Security Best Current Practice, RFC 9700). A link idle for 90 days ends. Proposal,
  decision D13.
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
- Pavé deletes its copy of the token on disconnect and on any 401 `token_revoked`.

#### 3.6 What each caller sees

| | Signed out | Linked, company not verified | Linked, verified, no `prices:read` | Linked, verified, `prices:read` |
|---|---|---|---|---|
| Stones, measurements, grades, certificate, photos | Yes | Yes | Yes | Yes |
| Availability status | Yes | Yes | Yes | Yes |
| Price | No | No | No | Yes (raised by the markup for a markup company) |
| Supplier name or contact | No | No | No | No in v1 (decision D3) |
| `access.level` | `signed_out` | `not_approved` | `approved` | `approved` |
| `access.prices_hidden_reason` | `signed_out` | `not_verified` | `scope_missing` | `null` |
| Holds, events (v1.1) | No | No (decision D7) | With the scopes | With the scopes |

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
   three are today's `Access.public()` (`diaex:app/browse.py:58-59`); `prices_hidden_reason` is **New**.
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
| `POST /holds`, `GET /holds`, `GET /holds/{id}`, `POST /holds/{id}/extend`, `DELETE /holds/{id}` | `holds:write` | v1.1 | **New** (section 5.7) |
| `POST /watches`, `GET /watches`, `DELETE /watches/{stone_id}` | `events:read` | v1.1 | **New** |
| `GET /events` | `events:read` | v1.1 | **New**, reads `stone_events` (`diaex:db/schema.sql:176-193`) and more |
| `POST /webhooks`, `GET /webhooks`, `DELETE /webhooks/{id}` | `events:read` | v1.1, optional | **New** |
| `POST /handoffs` | `handoff:write` | v2 | **New**, outline only (section 5.10) |

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
| `url` | a page on Diaex that opens this stone, signed out or in, in both of Diaex's looks | `?stone=` opens a stone only in the new look (`diaex:web/src/stone/address.ts:1-3,13-18`), which is on by default (`diaex:app/main.py:617-624`). **New**: promise this link and make it work in both looks. |
| `shape`, `shape_group` | the supplier's word, and the canonical group | `diaex:db/schema.sql:16,64-67`; groups `diaex:app/shapes.py:20-24` |
| `carat` | 2 decimals | `diaex:db/schema.sql:17` |
| `origin`, `growth` | `natural` or `lab`; `growth` is `CVD`, `HPHT` or `null` | `stone_type` CVD / HPHT / Natural, `diaex:db/schema.sql:15`. **New** split into two fields. |
| `color`, `fancy_color`, `fancy_hue`, `fancy_intensity` | white grade D to Z, or the fancy label, hue and intensity | `diaex:db/schema.sql:18-19,132-137`; hues `diaex:app/grades.py:47`. `fancy_hue` and `fancy_intensity` are **New** in replies. |
| `clarity`, `cut`, `polish`, `symmetry`, `fluorescence` | as Diaex shows them | `diaex:db/schema.sql:20-24` |
| `treatment` | `TREATED`, `UNTREATED` or `UNKNOWN` | `diaex:db/schema.sql:87-90`, `diaex:app/stone_rows.py:67-69` |
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
| `updated_at` | last change to anything in the caller's view: fields, price, availability | **New**: `source_updated_at` and `synced_at` exist (`diaex:db/schema.sql:47-48`) but are not sent (`diaex:app/catalog.py:233-243`) |

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
| `ref` | Pavé's own opaque label, 1 to 64 of `A-Z a-z 0-9 . _ : @ + -`, echoed back | **New** |
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
| `fancy_hues`, `fancy_intensities` | the ten Diaex hues (`Yellow`, `Pink`, `Blue`, `Green`, `Orange`, `Brown`, `Purple`, `Red`, `Gray`, `Violet`); with `colors`, either matches | `diaex:app/catalog.py:85-87`, `diaex:app/grades.py:47` |
| `clarities` | at most 16 | `diaex:app/catalog.py:88` |
| `certificate.required` | true drops stones with no lab | **New**: today `labs` can ask for NONE (`diaex:app/catalog.py:225-227`) but not "any lab but none" |
| `certificate.labs` | optional list | `labs` (`diaex:app/catalog.py:89`) |
| `max_price_each` | optional Money; dropped and named for callers without prices | `diaex:app/browse.py:153-161` |
| `include_memo` | `single` only: also return stones out on memo, tagged | memo stones are shown but never picked for a set or bought (`diaex:app/catalog.py:393-399`) |
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
| `parcels_not_listed` | `kind: parcel` (Diaex has one row per stone, `diaex:db/schema.sql:17`) |
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
  429; 503 `storage_unavailable`.
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
  within 0.05 ct and on the same side of a whole carat (`diaex:app/matching.py:50-54,234-239`). Only stones in
  stock, never on memo (`diaex:app/layouts.py:19`).
- **New:** every stone must also sit inside the seat window on **both** sides. Today an mm target is held on both
  sides for a round but only on the length for a fancy shape (`diaex:app/layouts.py:235-238`).
- **Response 200:** `{ ref, sets, one_supplier, complete, capped, stopped, largest_found, search_url, access }`.
  At most 3 sets, lowest total first, plus the cheapest one-supplier set, as today
  (`diaex:app/layouts.py:302-313,364-367`). Each set: `{ stones: [{ stone, fit }], total_price, total_carat,
  spread, suppliers, one_supplier, relaxed }` (`diaex:app/layouts.py:272-288`). `total_price` is `null` without
  prices. `capped` means more than 2,000 candidates were in the window (`diaex:app/pairs.py:25`); `stopped` means
  the search ran out of time (2 s per search, `diaex:app/pairs.py:28`). `largest_found` is the cheapest set of the
  largest size found when the size asked was not reached, with its `count`. `search_url` is
  `/pairs?way=build&shape=&unit=mm&size=&length=&breadth=&stones=&colors=&clarities=&type=`, the form Diaex reads
  today (`diaex:web/src/pairs/buildForm.ts:10,25-32`).
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
  "search_url": "https://console.thediaex.com/pairs?way=build&shape=emerald&unit=mm&size=5&length=7&breadth=5&stones=2&colors=F%2CG&clarities=VS1%2CVS2&type=natural",
  "access": { "level": "approved", "prices": true, "markup": false, "prices_hidden_reason": null } }
```

#### 5.6 `POST /requirements/match`: many requirements in one call (v1)

One call per design. Diaex answers each row as `/stones/search` (first page) or `/sets/search` would, or says why
it cannot.

- **Request:** `{ requirements: [Requirement, 1 to 50], sort }`. Each `ref` once. Body at most 64 KB.
- **Response 200:** `{ results: [RowResult], access }`, in the order asked. A RowResult is
  `{ ref, kind, status, reason, candidates, total, sets, one_supplier, complete, search_url, error }`:
  - `status: "matched"`: `single` rows have `candidates` (at most `limit_per_row`, default 10, at most 50) and
    `total`; `matched_set` rows have `sets`, `one_supplier`, `complete`.
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
            "mode": "live", "last4": "Q9xA", "created_at": "2026-11-24T10:00:00Z", "expires_at": "2027-02-22T10:00:00Z" } }
// 200, no token
{ "access": { "level": "signed_out", "prices": false, "markup": false, "prices_hidden_reason": "signed_out" },
  "company": null, "link": null }
```

`kyc_status` is one of Diaex's four values (`diaex:db/schema.sql:393-394`). `POST /oauth/revoke` takes the form
`token=<the token>` (RFC 7009) and answers 200 with no body, also for a token already revoked.

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
- Only `available` stones: a memo stone is refused (`stone_on_memo`), as memo stones cannot be carted or bought
  (`diaex:app/catalog.py:393-399`).
- At most one active hold per stone, decided by a unique index, as allocations are
  (`diaex:db/schema.sql:1511`). An order's allocation also blocks a hold, and the other way round.
- While a hold is active, other callers see the stone as `on_hold`; the holder sees `available` with
  `held_by_you: true`.
- A hold ends at `expires_at` with no job needed (the database compares the time), when released, when the stone
  sells or leaves the feed, when Diaex staff release it, or when the link is revoked.

| Endpoint | Request | Response | Errors |
|---|---|---|---|
| `POST /holds` | `{ stone_ids, minutes, reference }`, `Idempotency-Key` | 200 `{ holds: [Hold] }`, one per stone, each `active` or `refused` with `reason` (`stone_held`, `stone_on_memo`, `stone_unavailable`, `hold_limit_reached`) | 401, 403 `insufficient_scope` / `company_not_verified`, 409 `idempotency_in_progress`, 422, 429 |
| `GET /holds` | `?status=active\|ended&limit&cursor` | `{ holds, next_cursor }` | 401, 403 |
| `GET /holds/{id}` | | `Hold` | 404 `not_found` |
| `POST /holds/{id}/extend` | `{ minutes }`, `Idempotency-Key` | `Hold` | 404, 409 `hold_not_extendable` |
| `DELETE /holds/{id}` | `Idempotency-Key` | `Hold` with `status: released` (also when already ended) | 404 |

A Hold: `{ id, stone_id, status, reason, reference, created_at, expires_at, ended_at, extensions_left }`.
`status` is `active`, `released`, `expired` or `refused`. `reference` is Pavé's opaque label, at most 64
characters (section 9).

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
| `DELETE /watches/{stone_id}` | `Idempotency-Key` | 204 |

Proposal: at most 2,000 watched stones per link (decision D9).

**Events feed.** `GET /events?after=<cursor>&limit=<1..100>`.

- Without `after`: an empty page and a cursor for "now". Pavé gets its starting state from availability.
- Response: `{ events: [Event], next_cursor, has_more }`. `next_cursor` is always set; Pavé stores it and passes it
  next time, even after an empty page.
- Order: by event id, increasing. Delivery: at least once; Pavé drops events whose `id` it has seen. Diaex must
  not skip an event that commits late; the plan says how (edge case in the brief).
- Kept 30 days (proposal, D9). An older cursor answers 410 `cursor_expired`; Pavé then checks availability for
  everything it watches and starts again.
- An Event: `{ id, type, created_at, stone_id, hold_id, data }`.

| Type | `data` | Source on Diaex today |
|---|---|---|
| `stone.price_changed` | `{ price, price_per_carat, was_price }`. Only to callers who see prices. | `stone_events` kind `price_change` with old and new price (`diaex:db/schema.sql:181-192`) |
| `stone.unavailable` | `{ status: "on_hold" \| "unavailable", reason: "order_hold" \| "hold" \| "sold" \| "delisted" }` | `gone` (`diaex:db/schema.sql:184`); allocations (`diaex:db/schema.sql:1501-1511`) and sold marks (`diaex:db/schema.sql:1521-1531`) write no stone event today. **New.** |
| `stone.available` | `{ status: "available" }` | `back` (`diaex:db/schema.sql:184`); hold and sold-mark endings **New** |
| `stone.memo` | `{ status: "memo" }` | **New** (the sync writes the column in place, `diaex:db/schema.sql:116-123`) |
| `stone.updated` | `{ fields: ["measurements", …] }`: grades, size, certificate or media changed | **New** |
| `hold.expiring` | `{ expires_at }`, 10 minutes before | **New** |
| `hold.expired`, `hold.released` | `{ ended_at, reason }` | **New** |

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

- `POST /webhooks` `{ url, types }` with `Idempotency-Key` → 201 `{ id, url, types, secret, created_at }`. The
  `secret` (`whsec_…`) is shown once. At most 3 per link.
- The address must be `https` and public: loopback, private and link-local addresses are refused with 422
  `webhook_url_not_public`. A local Pavé simply does not register one (Pavé turns inbound features off on a
  loopback address, `docs/plans/publishing.md:17`).
- Each delivery is the same Event object, signed the Standard Webhooks way, as Pavé's own webhooks are
  (`docs/plans/publishing.md:112`): headers `webhook-id`, `webhook-timestamp`, `webhook-signature: v1,<base64
  HMAC-SHA256 of "{id}.{timestamp}.{body}">`. Pavé refuses a timestamp more than 5 minutes off.
- Diaex retries with growing waits for 24 hours, then turns the webhook off after 3 days of failures. The feed
  stays the record: a missed webhook is never lost.
- `GET /webhooks` lists them without secrets; `DELETE /webhooks/{id}` removes one.

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
problem's field and reason and never the value sent (`diaex:app/main.py:223-232`). Pavé decides by `code`, never by
`message`.

| HTTP | Code | Retry? | When |
|---|---|---|---|
| 400 | `bad_cursor` | no | a cursor that cannot be read, or one made for another link or level |
| 401 | `unauthenticated` | no | malformed or unknown token |
| 401 | `token_expired` | no | refresh (OAuth) or make a new token |
| 401 | `token_revoked` | no | the link was revoked; Pavé deletes the token |
| 403 | `insufficient_scope` | no | the token lacks the scope |
| 403 | `company_not_verified` | no | a hold by a company that is not verified |
| 403 | `access_removed` | no | the person was removed from the company (`diaex:app/browse.py:119-121`) |
| 404 | `stone_unavailable` | no | stone sold, delisted or never existed (`diaex:app/main.py:1199`); locked ids, with `missing` |
| 404 | `not_found` | no | hold, webhook or watch not found |
| 409 | `stone_on_memo` | no | a locked stone or hold on a memo stone, with `stones` (`diaex:app/main.py:1211,1260`) |
| 409 | `locked_unfit` | no | locked stones cannot make one set, with `differences` (`diaex:app/main.py:1262`) |
| 409 | `hold_not_extendable` | no | no extension left, or the hold has ended |
| 409 | `idempotency_in_progress` | yes | the same key is still running |
| 410 | `cursor_expired` | no | an events cursor older than the feed keeps |
| 413 | `body_too_large` | no | over 32 KB (64 KB for `/requirements/match`) |
| 422 | `invalid_request` | no | the body or query is wrong; `detail` lists the fields (`diaex:app/main.py:228-232`) |
| 422 | `requirement_unsupported` | no | `/stones/search` or `/sets/search` with a row Diaex cannot serve, with `reason` (section 5.3) |
| 422 | `idempotency_key_reused` | no | the same key with a different body |
| 422 | `webhook_url_not_public` | no | a webhook address that is not public `https` |
| 429 | `rate_limited` | yes | with `Retry-After` (`diaex:app/main.py:215-220`) |
| 429 | `daily_quota_exceeded` | yes | the daily priced-stone limit (section 7), with `Retry-After` to midnight UTC |
| 500 | `internal` | yes | |
| 503 | `storage_unavailable` | yes | the database is down (`diaex:app/main.py:586-587` answers this with `retryable: false` today; the partner API answers `true`) |

Retry rule for Pavé: only `retryable: true`, with growing waits, at most 3 tries, obeying `Retry-After`.

---

### 7. Rate limits and abuse

**Today.** Diaex's limits are counted in each server process's memory, so two servers allow twice the limit
(`diaex:app/limits.py:1-12`). Only shares, exports, the supplier list and the contact form have limits
(`diaex:app/limits.py:67-73`); search, stones, match and layouts have none. Per-address limits wait on a proxy
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
| Per company, priced stones | 5,000 different priced stones a day across all its links; past it, 429 `daily_quota_exceeded` |
| Hosted Pavé app token (`client_credentials`) | its own bucket, set per client |

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
| `kind: single / matchedSet / parcel` | `single` / `matched_set` / `parcel` | (`requirements.ts:71-72`) |
| `quantity` | `quantity` | |
| `material: diamond` | `gem: diamond` | |
| `material: diamond-lab` | `gem: diamond`, `origin: lab` | `lab` = `stone_types` CVD and HPHT (`packages/sourcing/src/diaex.ts:20-24`) |
| `material: diamond-yellow` / `diamond-pink` | `gem: diamond`, `fancy_hues: ["Yellow"]` / `["Pink"]` | as the deep links do (`packages/sourcing/src/diaex.ts:11-14,31`) |
| `material: diamond-black` | `gem: diamond`, `fancy_hues: ["Black"]` | answered `colour_not_listed` today (`diaex:app/grades.py:47`) |
| any other material | `gem: <material id>` | answered `material_not_listed` |
| `origin` | `origin` | (`requirements.ts:64-65`) |
| `cut` | `shape` | Pavé's cut words are Diaex shape words except `cabochon` (`diaex:app/shapes.py:20-24`), answered `cut_not_listed` |
| `seat.length`, `seat.width` | `seat.length_mm`, `seat.width_mm` | rounded to 2 decimals; for a round, length = width (`requirements.ts:86-88`); length is the longer side |
| `seat.tolMinus`, `seat.tolPlus` | `seat.tol_minus_mm`, `seat.tol_plus_mm` | prong −0.10/+0.15, bezel ±0.05, channel ±0.05, else ±0.03 (`requirements.ts:48-56`) |
| (none today) | `seat.max_height_mm` | **New** on Pavé's side, from the setting's depth |
| `seat.adjustable` | not sent | Pavé uses it to decide whether to refit the seat |
| `caratEach` | `carat` (optional) | not sent by default: the seat decides fit |
| `quality.colors` | `colors` | for a white diamond |
| `quality.clarities` | `clarities` | |
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
daily counts (section 7), and the stone ids it holds or watches. Pavé tells its users this in the Connect screen.

**Diaex's logging.** Partner routes log one line per request with method, path, status, time, link id and company
id, as Diaex does today (`diaex:app/main.py:196-206`), and never a request body, a token or a requirement. A 422
never repeats a value (`diaex:app/main.py:223-232`). A token is never in a log, an error or a reply after it is
first shown, as with Diaex's service tokens (`diaex:app/service_tokens.py:5-7`).

**Retention on Diaex (proposal, D12).** Requirements: not stored after the reply. Daily counts: 13 months.
Holds: as history, like released allocations (`diaex:db/schema.sql:1496-1500`). Watches: until removed or the link
ends. Events: 30 days. Idempotency keys: 24 hours. A revoked link's row stays for the audit log.

**On Pavé.** The token is stored sealed per organisation, admin-only, last 4 characters shown, never sent to the
browser, the same way Pavé stores its assistant key (`ffdraft-ai:apps/server/src/assistant/keys.ts:1-104`, on the
assistant branch). Pavé keeps stone snapshots only for stones linked into designs, with `seen_at`, and never
mirrors the catalogue (`docs/research/07-sourcing.md:246-257`). Prices follow section 4, rule 7.

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
`verified_b` (a second approved company); `revoked` (a revoked token); `test_mode` (a `dxp_test_` token).

#### 10.2 v1 cases

| # | Case | Expected |
|---|---|---|
| C1 | `signed_out` `/stones/search`, round, seat 6.45 × 6.45, −0.10/+0.15, natural, G, VS1–VS2, certificate required | `T-RD-01` (score 0.90) then `T-RD-02` (0.87); `total` 2; every `price` `null`; `access.level` `signed_out`, `prices_hidden_reason` `signed_out` |
| C2 | C1 as `verified` | same order; `T-RD-01.price` `{"amount":"5200.00","currency":"USD"}`; `prices_hidden_reason` `null` |
| C3 | C1 as `markup` | `T-RD-01.price.amount` `"5720.00"` (Diaex's rounding, `diaex:app/stone_rows.py:61-64`); `access.markup` `true` |
| C4 | C1 as `unverified` and as `verified_no_price` | prices `null`; reasons `not_verified` and `scope_missing` |
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
| C21 | change `T-OV-01`'s price in the test database, then `GET` | new `etag` for `verified`, later `updated_at`; for `signed_out` the `etag` does not change |
| C22 | `GET /stones/T-OV-01` | `media.image_url` absolute `https`, loads with no header; `certificate.report_url` is GIA's; sizes have 2 decimals |
| C23 | `GET /stones/T-RD-04` and `/stones/T-RD-05` | 200 with `availability: on_hold`; 404 `stone_unavailable` |
| C24 | `GET /me` as each caller | levels and reasons as section 3.6; `link.last4` set; no token value |
| C25 | `revoked` calls `/stones/search` | 401 `token_revoked` |
| C26 | `verified_no_price` calls a `holds:write` route | 403 `insufficient_scope` |
| C27 | a body with an unknown field (`"design": {}`) | 422 `invalid_request`; the reply does not contain the value sent |
| C28 | a cursor from `verified` used by `signed_out` | 400 `bad_cursor` |
| C29 | every reply | `x-request-id` header; every error has `error.code`, `error.message`, `error.retryable`, `request_id` |
| C30 | go past a limit (the test server sets the limit to 3) | 429 `rate_limited` with whole-second `Retry-After` |
| C31 | `test_mode` token | answers only fixture stones, never live ones |
| C32 | `POST /oauth/revoke` with `verified`'s token, then call | 200, then 401 `token_revoked` |

#### 10.3 v1.1 cases

| # | Case | Expected |
|---|---|---|
| H1 | `verified` holds `T-OV-01` for 60 minutes | `active`, `expires_at` 60 minutes from now (±5 s), `extensions_left: 1` |
| H2 | then `verified_b` searches and checks availability | no `T-OV-01` in search; availability `on_hold` |
| H3 | then `verified` checks availability | `available`, `held_by_you: true` |
| H4 | `verified_b` holds `T-OV-01` | `refused`, `stone_held` |
| H5 | `verified` holds `T-RD-03` | `refused`, `stone_on_memo` |
| H6 | extend once, then again | first `extensions_left: 0`; second 409 `hold_not_extendable` |
| H7 | release | `released`; `T-OV-01` `available` again for `verified_b` |
| H8 | expiry (the test server can move a hold's end into the past) | `expired`; stone `available` |
| H9 | same `Idempotency-Key` and body twice; then a different body | same reply; then 422 `idempotency_key_reused` |
| H10 | `unverified` places a hold | 403 `company_not_verified` |
| H11 | an 11th active hold | `refused`, `hold_limit_reached` |
| E1 | `GET /events` with no `after` | empty, with a cursor |
| E2 | watch `T-OV-01`, change its price, poll | one `stone.price_changed` with `price` for `verified`; nothing for `signed_out`-level links |
| E3 | poll again with the last cursor | no repeat |
| E4 | a sold mark on a watched stone | `stone.unavailable`, `reason: sold` |
| E5 | a hold 10 minutes from its end | `hold.expiring` |
| E6 | a cursor older than the feed keeps | 410 `cursor_expired` |
| E7 | revoke a link with holds and watches | holds `released`; next call 401 `token_revoked` |
| W1 | register `http://127.0.0.1/hook` | 422 `webhook_url_not_public` |
| W2 | a delivery's signature | checks with the secret, Standard Webhooks method |

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
| Two companies hold the same stone at the same moment | The database decides (unique index); one `active`, one `refused: stone_held` |
| A Buy and a partner hold race for one stone | One wins, decided in the database, rows locked in a fixed order |
| A hold extended exactly as it expires; released twice; the same idempotency key sent twice at once | Database time decides; release is idempotent; the second key waits or gets 409 `idempotency_in_progress` |
| An event written by a transaction that commits after a later one | Never skipped by a reader that has already passed its id (say how: for example, read only up to the oldest transaction still running, or a short delay) |
| An events cursor older than 30 days | 410 `cursor_expired` |
| A connector stone hidden by the 48-hour stale sweep (`diaex:db/schema.sql:716-718`) | Availability `unavailable`, `reason: delisted`; a `stone.unavailable` event for watchers |
| A price change seen by a signed-out caller | Its `etag` and `updated_at` do not change |
| Seat window for a fancy pair | Both length and breadth inside the window; the web builder answers exactly as before when no window is sent |
| Photo of a held stone, of a sold stone | Held: loads (`LISTED`); sold: 404 (`diaex:app/photo_route.py:66-74`) |
| Limits on two servers | One shared count; a refused request is not counted (`diaex:app/limits.py:9-12`) |
| A cabochon, a black diamond, a parcel, a sapphire | `unsupported` with the reasons in Part B, section 5.3 |
| The shared journey: paste a token in Pavé, search, open the stone's `url` on Diaex | Diaex opens the same stone, signed out and signed in, in both looks, website and app view |

### 5. Proposed PR split

Each step is one branch and one pull request, at most 400 counted lines (Markdown not counted). The line counts are
not measured yet; split a step again if `scripts/pr_size.py` says more. "Tests" names the shared cases (Part B,
section 10) each step makes pass, plus its own.

| # | Branch | Stream | What | Tests |
|---|---|---|---|---|
| 0 | `plans/pave-partner-api` | both (plan only) | This plan | none |
| **v1** | | | | |
| 1 | `accounts/partner-links-schema` | Accounts | `partner_links` table (hash, last 4, name, scopes, mode, person, company, expiry, revoked, last used); two audit actions; make, hash and check a token | token stored only hashed; revoked and expired refused; audit rows written |
| 2 | `accounts/partner-links-routes` | Accounts | Owner or admin makes, lists and revokes links through the account routes (Firebase sign-in) | signed out 401; member refused; another company's link not found; staff refused |
| 3 | `accounts/connected-apps-screen` | Web | Account, Connected apps: make (shown once), list, revoke; both looks, website and app view | screen tests in both looks; screenshots |
| 4 | `browse/partner-auth-me` | Browse | `/partner/v1` router; token to `Access`; scopes; error codes; `GET /me`; `POST /oauth/revoke`; docs and free-routes list | C24, C25, C26, C29, C32; removed person 403 |
| 5 | `browse/partner-stone-shape` | Browse | The partner Stone (absolute photo, money strings, origin and growth, fancy hue); `GET /stones/{id}` with ETag and 304; five statuses; `POST /stones/availability`; the fixture set in tests | C19, C20, C22, C23 |
| 6 | `browse/stone-freshness` | Browse | `updated_at`: a change time the sync sets only when a caller-visible field changes, read with allocation and sold-mark times (read only) | C21 |
| 7 | `browse/filters-height-and-lab` | Browse | `max_height_mm`; "any lab"; the seat window from tolerances; web search unchanged | C5; existing search tests |
| 8 | `browse/partner-stones-search` | Browse | `POST /stones/search`; fit score and sort; `requirement_unsupported`; `search_url` | C1 to C11, C18, C27, C28 |
| 9 | `browse/layouts-seat-window` | Browse | Optional per-stone window on both sides in the layout engine; builder unchanged without it | existing layout tests; new window tests |
| 10 | `browse/partner-sets-search` | Browse | `POST /sets/search` over `layouts.search` | C12 to C15 |
| 11 | `browse/partner-match` | Browse | `POST /requirements/match`: 50 rows, reasons, one deadline, shared engine slots, cancellation | C16, C17; timeout; cancel |
| 12 | `browse/partner-limits` | Accounts / browse | Limits shared across servers (a Postgres counter, or a dependency if Tej agrees); per address once `FORWARDED_ALLOW_IPS` is set (`diaex:app/limits.py:60-64`); daily priced-stone count; usage counts | C30; quota |
| 13 | `accounts/partner-admin-view` | Accounts / web | Staff list of links and usage, and revoke, under `/api/admin` | staff only; counts |
| 14 | `web/stone-link-both-looks` | Web | `?stone=` opens a stone in the old look too | website and app view, both looks |
| 15 | `browse/partner-test-mode` | Browse | `dxp_test_` tokens answer only the fixture set (if D12) | C31 |
| **v1.1** | | | | |
| 16 | `accounts/partner-oauth-token` | Accounts | Clients (`pave-local` public; hosted confidential); codes (5 min, single use, S256); token endpoint with refresh rotation and `client_credentials` | wrong verifier; code reused; refresh reused ends the link; any loopback port; `localhost` refused |
| 17 | `accounts/partner-oauth-consent` | Web | Consent page at `console.thediaex.com/oauth/authorize`, both looks | screen tests; the journey from Pavé |
| 18 | `sourcing/partner-holds` | **Sourcing** | `partner_holds` table in the sourcing part of the schema; one active per stone, also against held allocations; end by database time; caps | H1, H4 to H6, H8, H10, H11 (data layer) |
| 19 | `browse/available-excludes-holds` | Browse | `AVAILABLE` and `IN_STOCK` leave out other companies' active holds; the hidden-ids cache keys on them (`diaex:app/catalog.py:400`) | H2, H3; existing hidden and sold tests |
| 20 | `browse/partner-holds-routes` | Browse | `/holds` routes; the idempotency store (24 hours) | H1 to H11 |
| 21 | `browse/partner-watches` | Browse | Watch list table and routes; cap | watch limit; revoke drops watches |
| 22 | `browse/partner-events` | Browse (D9) | Events from stone events, allocations, sold marks and holds for watched stones; order without skipping late commits; 30 days; 410 | E1 to E7 |
| 23 | `browse/partner-webhooks` | Browse | Optional: register, refuse non-public addresses, Standard Webhooks signing, retries | W1, W2 |
| **v2** | | | | |
| 24 | `browse/partner-handoff-shortlist` | Browse | `POST /handoffs` makes a shortlist for the linked person and returns its link | after D10 |
| 25 | `sourcing/partner-handoff-cart` | Sourcing | Cart and checkout link, once Buy opens | after D10 and Buy |

### 6. Decisions only Tej can make

Put each in the plan as D1, D2, … with your proposal. The proposals below are Pavé's; change them if the code
says otherwise.

| # | Decision | Pavé's proposal | Other ways |
|---|---|---|---|
| D1 | **Who may link**, and does a token act as a person or as the company? | Owner or admin makes it; it acts as that person, so the access read stays the same; one link per Pavé organisation | Any member; a company-level key with no person |
| D2 | **Pricing visibility** through Pavé | Exactly Diaex's rule, by the same code: verified only, markup applied, plus a `prices:read` scope the company can leave off | No prices through partners at all; indicative price bands for unverified companies |
| D3 | **Supplier name and contact** through the API | Not sent; the stone's Diaex page shows them | Name only for verified non-markup buyers |
| D4 | **Lab-grown and natural**: same rules? | Same price, hold and limit rules | Different hold lengths or caps for lab-grown |
| D5 | **Signed-out partner calls** | Allowed, no price, limits per address | Token required for everything |
| D6 | **Rate limits** and the daily priced-stone cap | Part B, section 7: 30 a minute signed out; 120 a minute per link; 20 match calls a minute; 5,000 priced stones a day per company | Measure first and set later; per-plan limits |
| D7 | **Holds**: what one does, how long, how many, who | Hides the stone from other buyers like an order's hold; 30 to 120 minutes, default 60; one extension; 10 active per company; verified companies only; Diaex's priority, never the supplier's promise | A "watch" that reserves nothing; a tag only; Pro only |
| D8 | **Which stream owns holds** and the availability change | Sourcing owns the table; browse changes `AVAILABLE` | All in browse; all in sourcing |
| D9 | **Events**: owner, retention, watch-list size | Browse; 30 days; 2,000 stones per link | Sourcing owns hold and order events |
| D10 | **The order hand-off** | While Buy is closed: a shortlist link, which fits the Terms. Once Buy opens: a cart and checkout link; a Pavé cart follows the same Pro rule as any cart | Nothing until Buy opens; a set plan instead of a shortlist |
| D11 | **How long Pavé may keep a Diaex price** in saved designs and cost sheets | With its date, inside the Pavé organisation, refreshed on open, never published; stale after a revoke | A fixed expiry, such as 7 days |
| D12 | **Test tokens in production**; retention of counts (13 months) and events (30 days) | Yes to test tokens; those periods | Test server only |
| D13 | **Token lifetimes** | Pasted: 90 days by default, 1 year at most. OAuth: access 1 hour, refresh rotated, 90 days idle | No expiry for pasted tokens |
| D14 | **May any Pavé on any computer connect** to live Diaex | Yes, as a public client through PKCE and the person's consent | Registered installs only |
| D15 | **Aska's two companies** against one Pavé organisation | One link in v1 | Several links per organisation |
| D16 | **The address** | `https://api.thediaex.com/partner/v1` | Under `console.thediaex.com/api` |

### 7. What "done" means for v1

- Steps 1 to 15 are merged by Tej, each with its own passing review.
- **The shared contract cases C1 to C32 (Part B, section 10) pass against a Diaex test server**: a local Diaex on
  port 8001 with a throwaway database loaded with the fixture set. The last PR shows the command and its output.
- Every partner route is in `docs/ARCHITECTURE.md` and classified in `tests/test_pro_routes.py`; `docs/TYPES.md`
  is current; the docs tests pass.
- A token made on the development site works from Pavé against the development API. Production is not touched
  unless Tej says so.
- Any change your plan made to the contract is listed, so Pavé's side can match it.
