# Diaex partner API: the contract between Pavé and Diaex

**Status:** proposal, 24 November 2026. Nothing here is built on either side. Diaex builds it only after Tej
approves Diaex's own plan (`diaex:AGENTS.md:5-13`). The machine-readable copy is
[`diaex-partner-api.openapi.yaml`](diaex-partner-api.openapi.yaml); the two must say the same thing. **When they
disagree, this file wins on meaning (what a field or status means, who sees what, what happens when) and the OpenAPI
file wins on field limits (lengths, counts, ranges, patterns, defaults).** Any difference is a bug: report it, and fix
both. The brief for the Diaex agent is [`diaex-agent-brief.md`](diaex-agent-brief.md); it carries this contract and
the OpenAPI file in full.

**How to read the references.** `diaex:` paths are in the Diaex backend at commit `3fa756d` (23 November 2026),
read only. Other paths are in Pavé. Every statement about what Diaex or Pavé has today carries a `file:line`.
Everything else is **New** work.

**Words.**
- **Verified company:** a Diaex company whose KYC is approved, with the person active and the company not turned off
  (`diaex:app/browse.py:94`).
- **Link:** one Pavé organisation connected to one Diaex company through one Diaex person, by a pasted token or by
  OAuth. **New.**
- **Requirement:** one row of stones a design needs: shape, seat size in millimetres, quality, quantity
  (`packages/sourcing/src/requirements.ts:18-37`).

---

## 1. Purpose and scope by phase

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

## 2. Principles

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

## 3. Authentication and linking

### 3.1 What is being linked

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

### 3.2 Three ways to call

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

### 3.3 Scopes

| Scope | Allows | Phase |
|---|---|---|
| `stones:read` | `/me`, stone search, sets, match, availability, stone detail | v1 |
| `prices:read` | Price fields, only if the company is verified. Without it, a verified company's answers have no price. | v1 |
| `holds:write` | Place, extend, list and release holds | v1.1 |
| `events:read` | Watch list, events feed, webhooks | v1.1 |
| `handoff:write` | Hand chosen stones over to Diaex | v2 |

A call outside the token's scopes answers 403 `insufficient_scope`. Pro never unlocks anything here, as it never
unlocks prices on Diaex (`diaex:app/pro.py:39-45`).

### 3.4 OAuth 2.0 with PKCE (v1.1)

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

### 3.5 Lifetime and revocation

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

### 3.6 What each caller sees

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

## 4. Price visibility rules

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

## 5. Endpoints

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

### 5.1 The objects every endpoint shares

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

### 5.2 Availability status

| Status | Means | Can Pavé pick it? | Diaex today |
|---|---|---|---|
| `available` | listed, in stock with its supplier, nobody holds it | Yes | `IN_STOCK` (`diaex:app/catalog.py:393-399`) |
| `memo` | listed but out on memo with someone else | Show it, but it starts no set and cannot be held or bought | `diaex:db/schema.sql:116-124` |
| `on_hold` | an order on Diaex holds it (v1.1: or another company's hold); it may come back | No, wait for an event | held allocation (`diaex:app/catalog.py:383`, `diaex:db/schema.sql:1501-1511`); the stone page already says "on hold" to everyone (`diaex:app/browse.py:318-319,333`) |
| `unavailable` | sold, or its supplier no longer lists it. `reason` is `sold` or `delisted` | No | open sold mark (`diaex:app/catalog.py:382`, `diaex:db/schema.sql:1521-1531`); not in the feed (`diaex:app/catalog.py:378`) |
| `unknown` | no stone has this id (availability endpoint only) | No | `missing` (`diaex:app/browse.py:357-359`) |

### 5.3 `unsupported` reasons

A row Diaex cannot serve answers `status: "unsupported"` with one `reason`, and no `search_url`:

| Reason | When |
|---|---|
| `parcels_not_listed` | `kind: parcel`: melee, or more than 70 matching stones (Diaex has one row per stone, `diaex:db/schema.sql:17`; section 8 says when Pavé sends a parcel) |
| `material_not_listed` | `gem` is not `diamond` |
| `cut_not_listed` | a shape Diaex does not know, such as `cabochon` (`diaex:app/layouts.py:41-46`) |
| `colour_not_listed` | a fancy hue Diaex does not list, such as `Black` (`diaex:app/grades.py:47`) |
| `set_too_large` | `matched_set` with more than 70 stones (`diaex:app/layouts.py:25`) |

### 5.4 `POST /stones/search`: search one requirement (v1)

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

### 5.5 `POST /sets/search`: matching pairs and layouts (v1)

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

### 5.6 `POST /requirements/match`: many requirements in one call (v1)

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

### 5.7 `POST /stones/availability`: is it still there? (v1)

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

### 5.8 `GET /stones/{id}`: stone detail (v1)

- **Request:** the stone id in the path, percent-encoded (principle 4).
- **Response 200:** `{ stone, access }` with an `ETag` header equal to `stone.etag`. With `If-None-Match` equal to
  the current tag: 304 and no body.
- A stone that is `on_hold` still answers 200 with that status, as its page does today
  (`diaex:app/browse.py:318-319`). A sold or delisted stone answers 404 `stone_unavailable`
  (`diaex:app/main.py:1198-1199`); use availability to tell sold from delisted.
- **Errors:** 401, 403, 404 `stone_unavailable`, 429, 503.
- **Maps to:** `GET /api/stones/{public_id}` (`diaex:app/browse.py:314-337`), without the supplier card,
  `market` and `ready_pair`.

### 5.9 `GET /me` and `POST /oauth/revoke` (v1)

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

### 5.10 Holds (v1.1)

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

### 5.11 Watch list and events feed (v1.1)

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

### 5.12 Hand-off to Diaex (v2, outline only)

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

### 5.13 A jewellery store on thediaex.com (v2 note)

A store would show finished pieces made in Pavé, with each piece's stone rows resolved by Diaex's own code against
live stock and Diaex's price rule, so price and supplier rules cannot drift
(`docs/strategy/catalog-import-and-store.md:250`). It needs a store identity, an address and a price rule first
(`docs/strategy/catalog-import-and-store.md:144-157`), and Diaex's Terms say trade-only and no payment today
(`docs/strategy/catalog-import-and-store.md:157`). A piece should promise a specification and a "from" price,
because a named stone can sell between a page view and an order (`docs/strategy/catalog-import-and-store.md:168`).
Pictures and CAD stay on Pavé. Nothing in v1 or v1.1 depends on it.

---

## 6. Errors

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

## 7. Rate limits and abuse

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

## 8. From Pavé's requirement to the request

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

## 9. Privacy and data rules

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

## 10. Acceptance tests both sides share

**The contract test suite** is one list of cases, each a request and the parts of the reply that must hold. Diaex
runs it in its own test suite against a test server loaded with the fixture set; Pavé runs it against a mock built
from the OpenAPI file and, before each release, against Diaex's test server. **v1 is done when every v1 case
passes against a Diaex test server.**

### 10.1 Fixture set

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

### 10.2 v1 cases

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

### 10.3 v1.1 cases

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

## 11. Test mode

- A `dxp_test_` token answers from the fixture set only, never live stones, and its holds never hide a live
  stone. Proposal (decision D12): offered in production so Pavé's developers can test against the real address;
  the alternative is the Diaex test server only.
- The Diaex test server is a local Diaex with a throwaway database loaded with the fixture set, as Diaex runs every
  test (`diaex:AGENTS.md:65`). Diaex already has a fake catalogue for tests (`diaex:app/catalog.py:695-700`).

---

## 12. Open questions

These are the decisions in the Diaex brief, numbered the same way.

| # | Question | Proposal |
|---|---|---|
| D1 | Who may link, and does a token act as a person or as the company? | Owner or admin; acts as the person who made it; one link per Pavé organisation in v1 |
| D2 | Do prices through Pavé follow Diaex's rule exactly, markup included? | Yes, the same code; plus the `prices:read` scope |
| D3 | Does the supplier's name or contact go through the partner API? | No in v1; the stone's Diaex page shows it. Tej has said supplier and location matter on stone cards for buyers not on markup (`diaex:docs/design/AGENT-GUIDE.md:57`) |
| D4 | Do lab-grown and natural stones follow the same rules? | Yes, everywhere |
| D5 | May signed-out callers use the partner API? | Yes, no price, limits per address |
| D6 | Rate limits and the daily priced-stone limit | Section 7's numbers to start; every priced reply counts; 5,000 a day allows a full copy in about 6 days |
| D7 | What a hold does, how long, how many, who | Hides from other buyers, 30–120 min, one extension, 10 per company, verified only, a cool-down of N hours before the same company holds the same stone again, ended when access is lost |
| D8 | Which stream owns holds, the availability rule change and the Buy's refusal; how one holder per stone is enforced | Sourcing owns the table and the Buy change; browse changes `AVAILABLE`; a row lock on the stone, or holds as a kind of allocation |
| D9 | Events: which stream, how long kept, watch list size | Browse; 30 days; 2,000 stones |
| D10 | Hand-off before and after Buy opens; must a Pavé cart need Pro? | Shortlist link now; cart and checkout once Buy opens; same Pro rule as Diaex |
| D11 | How long Pavé may keep a Diaex price | Section 4, rule 7 |
| D12 | Test tokens in production; retention periods | Yes; section 9 |
| D13 | Token lifetimes | Pasted 90 days default, 1 year at most; OAuth access 1 hour, refresh rotated with a 30-second grace window, 90 days idle |
| D14 | May any Pavé on any computer connect to live Diaex (public client)? | Yes, through PKCE and the consent of an owner or admin, on a page that says a local app is asking and shows the port; the public client may ask for `prices:read` but not `holds:write` without a fresh Diaex sign-in |
| D15 | Aska's two companies against one Pavé organisation | One link in v1; several later |
| D16 | Base address `api.thediaex.com/partner/v1` | Yes. This changes the deploy plan's D3, which keeps `api.thediaex.com` for webhooks only (`diaex:docs/plans/2026-10-26-render-deploy.md:389`) |
| D17 | How a stone's `url` opens in Diaex's old look | Promise the new look only, with a link that adds `ui=2` (that browser then keeps the choice); changing the flat look needs Tej's written OK |
| D18 | Writing a usage count on every read call, given "nothing is written until a form is finished" (`diaex:AGENTS.md:93`) | Allowed for counts only, in a shared counter (one row per link per day, not a row per call), written only for calls that were answered |
