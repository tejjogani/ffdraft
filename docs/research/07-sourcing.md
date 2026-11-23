# 07 — Sourcing: connecting Pavé to Diaex

Status: research + plan, 2026-11-23. Diaex facts were read from `/home/user/diaex-backend` at commit `3fa756d` (paths below are relative to that repo). Nothing in Diaex was changed. Pavé's monorepo is being scaffolded as this is written; the types below reuse the ids already in `packages/schema/src/domain/gems.ts` and `metals.ts` (`GemCutId`, `GemMaterialId`, `GemDims`, `MELEE_SIZES_MM`, `MetalId`, `metalMassG`). Other Pavé paths are proposals.

**Summary.** Diaex today is a diamond-only B2B marketplace API with search, pair and layout matching, a per-person cart and a "Buy and Source" order flow, all behind Firebase sign-in. It has no partner API, API keys, webhooks, melee parcels, coloured stones, "wanted" requests or metals. Pavé can ship P0 with no Diaex work (deep links into Diaex Browse with prefilled filters), then use a thin `/partner/v1` layer that mostly wraps code Diaex already has.

## 1. What exists in Diaex today

| Area | Fact | Where |
|---|---|---|
| Stack | Python 3.12, FastAPI, psycopg 3 / Postgres, Temporal (sourcing workflows), Firebase Auth, Render; React/Vite web at `console.thediaex.com` | `pyproject.toml`, `docs/PRODUCTION.md:23,113` |
| Auth | Only `Authorization: Bearer <Firebase ID token>`; signed-out allowed on browse routes. No API keys, OAuth or partner concept | `app/auth.py:120-139,177-194` |
| Tenancy | `users` (firebase_uid, org_role) → `orgs` (kind, buys/sells, `kyc_status`, `markup_percent`, `pro`) | `db/schema.sql:386-398,482-494` |
| Access levels | `signed_out`, `not_approved`, `approved`, `staff`; prices and supplier names only for `approved`/`staff`; markup orgs see raised prices and ASKA as supplier | `app/browse.py:22-59,94,272-282` |
| Service tokens | Ed25519 short-lived JWTs between Diaex's own services; one static bearer per Aska stock feed | `app/service_tokens.py:29-52`, `app/aska_feed.py:28-36` |
| Inventory | One table `stones`, one row per individual diamond. Written by a Firestore sync and by supplier stock connectors | `db/schema.sql:9-137`, `app/sync.py`, `app/stock_connectors.py` |
| Ids | Callers only ever see `public_id`; `stones.id`, `supplier_id`, `ref_stock_id` are never or conditionally sent | `db/schema.sql:91-93`, `knowledge/diaex-invariants.md` |
| Search | `POST /api/search` (`Filters`, 6 sorts, sealed keyset cursor, facets); `POST /api/stones/batch` (≤100 ids); `GET /api/stones/{public_id}` | `app/main.py:1170-1201`, `app/catalog.py:60-112,204-206,285-298` |
| Matching | `POST /api/match`, `/api/match/describe`, `/api/layouts/search` (shape, target **carat or mm**, count 2–70, grades, `same_supplier`, `locked`, `exclude`, `limits`), `/api/sets/search`, `/api/layouts/check` (re-validate with `prices_seen`), `GET /api/layouts/size-estimate` (carat → mm quartiles) | `app/main.py:1204-1288`, `app/pairs.py:59-110`, `app/layouts.py:49-86,384` |
| Match rules | Spread across a set: 0.03 mm round / 0.05 mm fancy; table 1 pt, depth 2 pt, crown 1.5 pt; loosest 0.10 / 0.20 mm. Lab never mixes with natural. Colour/clarity exact, then one grade apart | `app/matching.py:20-37,62-73`, `docs/DIAMOND-MATCHING.md` |
| Set ranking | fit 40, total weight 20, grades 15, suppliers 15, price 10 | `app/set_options.py:13` |
| Cart | Per **person**, ≤150 stones, one row per stone (no quantity); `set_key` groups a set; `prices_seen` → `409 price_changed`; idempotent adds | `db/schema.sql:934-947`, `app/cart.py:24-46,109-171` |
| Orders | `POST /api/sourcing/orders` ("Buy and Source"): needs Pro + KYC-approved org + the launch gate; creates `orders`, `order_items`, `allocations` | `app/sourcing/api.py:71-126`, `app/sourcing/queries.py:98-110`, `db/schema.sql:1107-1121,1422-1441` |
| Launch gate | Cart and Buy are closed unless `BUY_ENABLED` is `1` or `testers`; production leaves it unset | `app/launch.py:29-31`, `docs/PRODUCTION.md:34` |
| Holds | `allocations`: one `held` row per listing, tied to an order, **no expiry**; `sold_marks` hide sold stones; `stones.availability` is `available` or `memo` | `db/schema.sql:116-124,1496-1532`, `app/catalog.py:376-399` |
| RFQ / requests | `supplier_inquiries` + `inquiry_lines` ask a supplier (WhatsApp) about **existing listings** (`listing_id NOT NULL`). `rfqs`, `quote_terms`, `sourcing_requests` are designed in `docs/SOURCING.md:51-72` but have no tables | `db/schema.sql:1684-1722` |
| Events | Internal only: `stone_events` (first_seen, price_change, gone, back), `buyer_notifications`, `workflow_outbox`. No outbound webhooks | `db/schema.sql:181-188,1563-1575,1877` |
| Conventions | Errors `{"error":{code,message,retryable,…},"request_id"}`; client idempotency by `client_key`/`set_key` uuid; in-process rate limiter; `FakeCatalog` of 15 stones for no-database runs | `app/main.py:257-261`, `app/limits.py:68-73`, `app/catalog.py:695` |
| Web deep links | `/browse?q=<words>&f=<JSON Filters>`; `?stone=<public_id>` (new look only); `/pairs?way=build&shape=&unit=mm&size=&stones=&colors=&clarities=&type=&one=1` | `web/src/browse/useQueryFilters.ts:14-29`, `web/src/browse/filterState.ts:17-56`, `web/src/stone/address.ts:15-19`, `web/src/pairs/buildForm.ts:24-27` |

**Stone fields a caller receives** (`app/catalog.py:233-243`): `id` (public), `stone_type` (CVD / HPHT / Natural), `treatment`, `shape`, `shape_group`, `carat`, `color`, `fancy_color`, `clarity`, `cut`, `polish`, `symmetry`, `fluorescence`, `lab`, `report_no`, `report_url`, `length_mm`, `width_mm`, `height_mm`, `ratio`, `table_pct`, `depth_pct`, `crown_angle`, `crown_height_pct`, `pavilion_angle`, `pavilion_depth_pct`, `girdle_thin`, `girdle_thick`, `culet`, `country`, `city`, `price_usd`, `price_per_carat`, `image_url`, `video_url`, `has_pair`, `pair_count`, `availability`. Vocabularies: shapes `app/shapes.py:20-23`; clarity FL–I3, labs IGI/GIA/GCAL/HRD/SGL/NONE `app/grades.py:16-32`; fancy hues and intensities `app/grades.py:47-48`.

### Gaps against what Pavé needs

| Need | Gap |
|---|---|
| Machine access per Pavé org | No partner auth, scopes or token table |
| Batch "match this BOM" | Search is one filter set per call; the matcher takes carat bands, not seat tolerances; no height filter |
| Accent stones and melee | No parcels, no quantity, no sieve. The development catalogue's smallest stone was 0.34 ct in October 2026, and melee was excluded on purpose (`docs/plans/2026-10-31-pairs-and-large-layouts.md:34,74,261-262`) |
| Moissanite, sapphire and other gems | No material column; `stone_type` is growth method only |
| "List what I can't find" | No spec-based request. Inquiries need an existing listing |
| Soft holds with expiry | Allocations belong to orders and never expire |
| Freshness push | No webhooks, ETags or public event feed |
| Org-level cart | Cart belongs to one person, and is closed in production |
| Metals | Nothing |

## 2. Matching model

### 2.1 `StoneRequirement` (what Pavé emits per stone, set or lot)

```ts
type StoneRequirement = {
  ref: string;                       // stable per CAD stone group in a piece revision
  kind: 'single' | 'matched_set' | 'parcel';
  role: 'centre' | 'accent' | 'melee' | 'pave_lot';
  quantity: number;                  // 1 | N stones | estimated count for a parcel
  material: GemMaterialId;           // @pave/schema: 'diamond' | 'diamond-lab' | 'moissanite' | …
  origin: 'natural' | 'lab' | 'any'; // explicit: fancy and coloured ids don't say
  cut: GemCutId;                     // @pave/schema: 'round' | 'oval' | 'princess' | …
  seat: { length_mm: number; width_mm: number; depth_max_mm?: number;   // GemDims of the CAD stone
          tol_minus_mm: number; tol_plus_mm: number;
          adjustable: boolean };     // true: the CAD may regenerate the seat
  ratio?: { min: number; max: number };
  carat?: { min: number; max: number };          // derived from mm unless pinned
  quality: { colors?: string[]; fancy?: { hues: string[]; intensities: string[] };
             clarities?: string[]; cuts?: string[]; polishes?: string[];
             symmetries?: string[]; fluorescences?: string[]; untreated_only?: boolean };
  cert: { required: boolean; labs?: string[] };
  set?: { mode: 'matched' | 'graduated'; spread_mm?: number; same_supplier?: boolean;
          positions?: { name: string; count: number; length_mm: number; width_mm?: number }[] };
  parcel?: { mm: { min: number; max: number };            // a MELEE_SIZES_MM size ± 0.05
             sieve?: { from: string; to: string };
             total_ct: number; overage_pct: number;        // breakage and selection
             color_band: string; clarity_band: string };   // e.g. "F-G", "VS"
  budget?: { max_total_usd?: number; max_per_carat_usd?: number };
  setting_type: 'prong' | 'bezel' | 'channel' | 'pave' | 'flush' | string;
  ship_to_country?: string; need_by?: string;
};
```

Quality is sent as explicit lists, not ranges, because that is what Diaex filters on and it avoids scale disputes. Default seat tolerances by setting (Pavé defaults, user-editable): prong −0.10 / +0.15 mm, adjustable; bezel and channel ±0.05; pavé and flush ±0.03. For comparison, Diaex's own matcher allows a spread of 0.03 mm (round) or 0.05 mm (fancy) inside a set.

### 2.2 Mapping onto Diaex's schema

| Requirement | Diaex today | Note |
|---|---|---|
| `material` `diamond` / `diamond-lab`, `origin` | `stone_types`: `["Natural"]` or `["CVD","HPHT"]` | `app/matching.py:62` |
| `material` `diamond-yellow`, `diamond-pink` | `fancy_hues: ["Yellow"]` / `["Pink"]` plus `stone_types` from `origin` | no Black hue in Diaex |
| any other `material` | none | request only until a `material` column exists |
| `cut` | `shapes` → `shape_group`. Pavé's ids are Diaex words already (round, oval, princess, emerald, asscher, cushion, radiant, marquise, pear, heart, baguette, trillion) | `cabochon` has no Diaex shape |
| `seat` L/W ± tol | `min/max_length_mm`, `min/max_width_mm` (longer/shorter side, `clean_*`) | exact fit to 0.01 mm |
| `seat.depth_max_mm` | no filter; compare `height_mm` after the read | new server-side check |
| `ratio`, `carat` | `min/max_ratio`, `min/max_carat` or `carat_ranges` | |
| `quality.*` | `colors`, `fancy_hues`, `fancy_intensities`, `clarities`, `cuts`, `polishes`, `symmetries`, `fluorescences`, `treatments` | |
| `cert` | `labs`; reply has `report_no`, `report_url` | `NONE` means no report |
| in stock only | `availability: ["available"]` | memo stones cannot be carted |
| `budget` | `max_price_usd`, `max_price_per_carat` | dropped for unverified callers |
| `matched_set` | `/api/layouts/search` with `target.mm`, `count`, `limits`, `same_supplier` | needs all five profile fields on each stone |
| graduated set | `positions` (`app/set_positions.py:34-48`) in `/api/sets/search` (`app/sets_route.py:30-38`) | ≤6 positions, sizes in carat only |
| `parcel` | none | new listing type |

### 2.3 Ranking candidates

1. **Hard gates:** in stock, origin, shape, cert, inside the seat window (the wider "adjustable" window when the CAD may move), under budget.
2. **Dimensional fit:** `1 − max(|ΔL|, |ΔW|) / tol`, depth clearance pass/fail, ratio. A stone that drops into the seat as drawn beats one needing a regenerated seat.
3. **Quality:** meets the spec without overshooting it (overshoot costs money, not points).
4. **Price:** total, then per carat.
5. **Availability:** `available` over `memo`, has report and photo, ships from a near country.
6. **BOM consolidation pass:** after per-row top-k, re-rank to prefer suppliers already chosen for other rows. Supplier identity is masked for most callers, so the API returns an opaque per-response `supplier_group` token.

### 2.4 Substitutions

Each is returned separately with its delta, never mixed into exact results.

| Substitution | Rule |
|---|---|
| Nearest size (nearest calibrated size for accents) | Outside tolerance but inside the adjustable window: selecting it regenerates the seat |
| One grade apart | Diaex's relaxed ladder; labelled `relaxed` |
| Lab ↔ natural | Only when `origin: "any"` or the user opts in; show count and from-price |
| Alternative material | Not stocked today: offered as "Request on Diaex" |

## 3. Partner API Diaex should expose (`/partner/v1`)

**Conventions.** JSON over HTTPS, additive changes only within v1. Errors keep Diaex's shape. Writes take `Idempotency-Key` (a uuid, stored like today's `client_key`). Lists use Diaex's sealed keyset cursors. Limits answer `429` with `Retry-After`. Stones are always projected through `browse.public_stone`, so the price and supplier gates cannot drift. Test tokens answer from `FakeCatalog`.

**Auth: recommendation.** OAuth 2.1 authorization code + PKCE, "Connect Diaex account", with Diaex as the authorization server. A grant is for one Diaex user in one org, stored on the Pavé org. Every request re-reads that user's access level, exactly as a Firebase call does, so KYC, removal and markup take effect at once. Scopes: `stones:read`, `prices:read`, `cart:write`, `requests:write`, `holds:write`, `orders:read`, `metals:read`.

- Ship first: personal partner tokens created on Diaex's account page and pasted into Pavé. They write the same token rows OAuth will mint later, and they suit self-hosters.
- Not shared SSO: a Firebase ID token carries every right the person has on Diaex, and Pavé is open source and self-hostable.
- Not one global API key: Diaex's price gate is per company.

| Endpoint | Purpose |
|---|---|
| `POST /partner/v1/stones/match` | Batch match, ≤50 requirements |
| `GET /partner/v1/stones/{id}`, `POST /stones/batch` | Refresh; `ETag` / `If-None-Match`, `updated_at` |
| `POST /partner/v1/carts`, `GET/PATCH/DELETE /carts/{id}` | Build a cart; returns `checkout_url` |
| `POST /partner/v1/requests`, `GET/DELETE /requests/{id}`, `POST /requests/{id}/quotes/{qid}/accept` | "Wanted" listing and quotes |
| `POST /partner/v1/holds`, `DELETE /holds/{id}` | Soft hold with expiry |
| `GET /partner/v1/events?after=` and webhooks | Freshness |
| `GET /partner/v1/orders/{id}` | Order status for the production package |
| `GET /partner/v1/metals/quotes` | Later |

**The main sequence (P2).**

1. The designer edits a piece. Pavé recomputes `stone_requirements` from the CAD stone records and marks changed rows unmatched.
2. Pavé server calls `stones/match` with the changed rows. Diaex gates the caller, filters, scores fit and returns candidates and substitutions.
3. The designer picks a candidate. Pavé stores the snapshot and writes the stone's measured mm into the CAD; seats regenerate.
4. "Add all to Diaex cart": Pavé posts the selected stones with `price_seen`. Diaex adds what is still in stock at that price and reports the rest per item.
5. Pavé opens `checkout_url`. The buyer reviews and presses Buy on Diaex, which starts Diaex's own sourcing with the supplier.
6. For rows with no match, Pavé posts a request. Suppliers quote on Diaex; Pavé learns of it from `request.quoted` and shows the quote as a candidate.
7. Pavé polls `events` (or receives webhooks) and marks stale, sold or repriced stones on the Stones tab.

```jsonc
// POST /partner/v1/stones/match
{ "ship_to_country": "US",
  "requirements": [
    { "ref": "centre", "kind": "single", "material": "diamond", "origin": "natural", "cut": "oval",
      "seat": { "length_mm": 8.0, "width_mm": 6.0, "depth_max_mm": 4.1,
                "tol_minus_mm": 0.15, "tol_plus_mm": 0.15, "adjustable": true },
      "quality": { "colors": ["E","F","G"], "clarities": ["VS1","VS2"] },
      "cert": { "required": true, "labs": ["GIA"] }, "limit": 8 },
    { "ref": "halo", "kind": "parcel", "material": "diamond", "origin": "natural", "cut": "round",
      "parcel": { "mm": {"min": 1.25, "max": 1.35}, "total_ct": 0.42, "overage_pct": 10,
                  "color_band": "F-G", "clarity_band": "VS" } } ] }
// 200
{ "results": [
    { "ref": "centre", "status": "matched", "total": 37,
      "candidates": [ {
        "stone": { "id": "DX1042", "shape_group": "oval", "carat": 1.21, "color": "F",
                   "clarity": "VS1", "lab": "GIA", "report_url": "…", "length_mm": 8.04,
                   "width_mm": 5.97, "height_mm": 3.71, "availability": "available",
                   "price_usd": 6120 },
        "fit": { "d_length_mm": 0.04, "d_width_mm": -0.03, "depth_ok": true, "score": 0.93 },
        "match": "exact", "supplier_group": "g1", "etag": "W/\"9c1\"",
        "updated_at": "2026-11-23T18:02:11Z",
        "url": "https://console.thediaex.com/browse?stone=DX1042" } ],
      "substitutions": [ { "kind": "origin", "to": "lab", "count": 212, "from_price_usd": 640 } ],
      "search_url": "https://console.thediaex.com/browse?f=…" },
    { "ref": "halo", "status": "unsupported", "reason": "parcels_not_listed", "can_request": true } ],
  "access": { "level": "approved", "prices": true, "markup": false } }
```

```jsonc
// POST /partner/v1/carts        Idempotency-Key: <uuid>
{ "external_ref": "pave:piece_123@rev7", "title": "Oval halo ring",
  "items": [ { "stone_id": "DX1042", "requirement_ref": "centre", "price_seen": 6120 } ] }
// 201
{ "id": "crt_…", "total_usd": 6120,
  "items": [ { "stone_id": "DX1042", "status": "added" } ],   // or unavailable | on_memo | price_changed (+ price_now)
  "checkout_url": "https://console.thediaex.com/cart?set=<set_key>&src=pave" }

// POST /partner/v1/requests     Idempotency-Key: <uuid>
{ "external_ref": "pave:piece_123:halo", "requirement": { /* StoneRequirement */ },
  "note": "Halo for an oval ring", "need_by": "2026-12-10", "max_quotes": 5 }
// 201
{ "id": "rq_…", "status": "open", "expires_at": "…", "url": "https://console.thediaex.com/requests/rq_…" }
// states: open → quoted → accepted | expired | cancelled → fulfilled

// POST /partner/v1/holds
{ "stone_ids": ["DX1042"], "ttl_minutes": 60 }
// 200
{ "holds": [ { "id": "hld_…", "stone_id": "DX1042", "status": "held", "expires_at": "…" } ] }

// Webhook body, signed: Diaex-Signature: t=<unix>,v1=<HMAC-SHA256>
{ "id": "evt_…", "type": "stone.unavailable", "created_at": "…",
  "data": { "stone_id": "DX1042", "reason": "sold", "cart_ids": ["crt_…"] } }
```

**Checkout: deep link, not headless.** A Buy is a purchase commitment gated by KYC, Pro and the launch switch, the price is re-checked with the supplier afterwards, and Diaex has no payment step to automate yet. So the buyer commits on Diaex, and order status flows back by events.

**Freshness.** Every stone carries `updated_at` and an `etag` over price, availability and hidden state. Events: `stone.price_changed`, `stone.unavailable` (`sold | held | delisted | memo`), `stone.available`, `request.quoted`, `request.expired`, `hold.expired`, `order.created`, `order.item.updated`, `connection.revoked`. They fire only for stones in that connection's carts, holds and selected matches. Self-hosted Pavé often has no public URL, so `GET /events?after=<cursor>` is the required baseline and webhooks are the optimisation.

**Holds.** A partner hold is Diaex's own priority, not a supplier reservation; Diaex already separates those two facts (`db/schema.sql:1496-1500`). Cap them per org and by time (30–120 minutes, one renewal).

## 4. Pavé-side design

### 4.1 Provider interface

```ts
export interface SourcingProvider {
  readonly id: string;                                   // 'diaex' | 'mock' | 'none'
  capabilities(ctx?: Ctx): Promise<{
    linkOut: boolean; match: boolean; cart: boolean; requests: boolean; holds: boolean;
    parcels: boolean; metals: boolean; events: 'webhook' | 'poll' | 'none'; materials: string[] }>;
  searchUrl(req: StoneRequirement): string | null;      // P0: no account needed
  beginConnect?(orgId: string, redirectUri: string): Promise<{ authorizeUrl: string; state: string }>;
  completeConnect?(orgId: string, params: URLSearchParams): Promise<Connection>;
  disconnect?(ctx: Ctx): Promise<void>;
  matchStones(ctx: Ctx, reqs: StoneRequirement[]): Promise<MatchResult[]>;
  getStones(ctx: Ctx, ids: string[], etags?: Record<string, string>): Promise<StoneSnapshot[]>;
  upsertCart(ctx: Ctx, cart: CartDraft): Promise<ProviderCart>;   // includes checkoutUrl
  createRequest(ctx: Ctx, req: StoneRequirement, note?: string): Promise<ProviderRequest>;
  getRequest(ctx: Ctx, id: string): Promise<ProviderRequest>;
  cancelRequest(ctx: Ctx, id: string): Promise<void>;
  hold?(ctx: Ctx, stoneIds: string[], ttlMinutes: number): Promise<Hold[]>;
  release?(ctx: Ctx, holdId: string): Promise<void>;
  quoteMetal?(ctx: Ctx, req: MetalRequirement): Promise<MetalQuote>;
  pollEvents?(ctx: Ctx, after?: string): Promise<{ events: SourcingEvent[]; next: string }>;
  verifyWebhook?(headers: Headers, rawBody: string): SourcingEvent[] | null;
}
type Ctx = { orgId: string; userId: string; connection: Connection; idempotencyKey?: string };
```

`diaex` is the default in the hosted product. `mock` returns deterministic fixtures for tests and demos. `none` makes the Stones tab a plain BOM. The UI reads `capabilities()` and hides what a provider cannot do. `StoneRequirement` belongs in `@pave/schema` as a zod schema, like the design fields. Providers go in a new `packages/sourcing`; `apps/server` exposes `/api/sourcing/*` and holds tokens. The browser never sees them.

### 4.2 Data model additions

| Table | Key columns |
|---|---|
| `sourcing_connections` | `org_id`, `provider`, `external_org_id`, `external_user_id`, `scopes`, encrypted tokens, `access_level`, `status` |
| `stone_requirements` | `id`, `piece_id`, `revision`, `cad_stone_ids[]`, `role`, `kind`, `spec` (jsonb), `spec_hash`, `status` (`unmatched`, `candidates`, `selected`, `in_cart`, `requested`, `ordered`) |
| `sourcing_matches` | `requirement_id`, `provider`, `external_stone_id`, `snapshot` (jsonb), `price_seen`, `etag`, `fetched_at`, `fit`, `rank`, `state` (`candidate`, `selected`, `stale`, `unavailable`) |
| `carts`, `cart_items` | `piece_id`, `provider`, `external_cart_id`, `checkout_url`, `status`; item → `match_id`, `price_seen`, `status` |
| `sourcing_requests` | `requirement_id`, `provider`, `external_request_id`, `status`, `quotes` (jsonb), `expires_at` |
| `sourcing_events` | `provider`, `external_event_id` (unique), `type`, `payload`, `processed_at` |

Pavé stores per-match snapshots with a timestamp. It never mirrors the catalogue.

### 4.3 Where it shows up

- **Stones tab on each piece:** one row per requirement (role, shape, mm, estimated carat, quality, quantity) with a status chip: Unmatched, 8 found, Selected, In cart, Requested, Unavailable. Opening a row shows ranked candidates with the fit delta, price, report link and "Open on Diaex". The user picks or swaps.
- **Footer:** "Add all to Diaex cart" → review dialog (changed prices, gone stones) → opens `checkout_url`. Unmatched rows get "Request on Diaex".
- **Cost roll-up:** selected stones at `price_seen` (stamped with time) plus estimates for unmatched rows feed the production package's cost sheet. Once ordered, the package shows Diaex order and item status.
- **Assistant tools:** `find_stones(piece_id, refs?)`, `build_cart(piece_id)`, `request_stones(requirement_refs, note?)`. The last two always stop for confirmation.

### 4.4 How the CAD reacts to a real stone

Each CAD stone keeps `nominal` dimensions and an optional `sourced` record (provider, id, `length_mm`, `width_mm`, `height_mm`, `table_pct`, crown and pavilion angles, girdle). Seat generation reads `sourced ?? nominal`. Selecting a candidate writes `sourced` as one undoable revision. The seat, prong positions and culet clearance regenerate, and the constraint checker re-runs stone-to-stone gap and finger clearance. If `adjustable` is false and the stone is outside tolerance, the pick is blocked with the reason. A `stone.unavailable` event marks the match stale and offers the next candidate; geometry never changes silently.

## 5. Metals roadmap

1. CAD computes a `MetalRequirement` per alloy: `metal` (a `MetalId` such as `au18k-yellow`, which carries fineness, hallmark and density), `form` (casting grain first; sheet and wire later), `net_grams` (`metalMassG(metal, volumeMm3)`), `casting_allowance_pct` (sprue, button, loss), `order_grams`, optional `recycled` / chain-of-custody flag, `ship_to_country`.
2. `GET /partner/v1/metals/quotes?fineness=750&metal=gold&colour=yellow&form=casting_grain&grams=` returns `quote_id`, `spot` (metal, price per troy oz, basis, `as_of`), `fine_grams`, `metal_value_usd`, `premium` (percent and amount), `total_usd`, `valid_until`, `min_order_grams`.
3. The quote becomes a cart line of kind `metal`. This needs a cart line model with quantity, which parcels need too.

Diaex needs new tables for alloys (code, fineness, density), supplier offers (form, premium, minimum), a spot feed and short-lived quotes.

## 6. Phasing

| Phase | Pavé | Diaex work |
|---|---|---|
| **P0 link-out** | `searchUrl()` builds `https://console.thediaex.com/browse?f=<encodeURIComponent(JSON)>`, e.g. `{"shapes":["oval"],"stone_types":["Natural"],"colors":["E","F","G"],"clarities":["VS1","VS2"],"min_length_mm":7.85,"max_length_mm":8.15,"min_width_mm":5.85,"max_width_mm":6.15,"availability":["available"]}`. Matched sets link to `/pairs?way=build&…`. Stones tab, statuses and manual "mark as sourced" with typed-in mm | None. Works signed out (no prices) |
| **P1 match** | Connect account; `matchStones`, `getStones`; candidates in the tab; CAD override | Partner tokens; `stones/match`, `stones/{id}`, `stones/batch` |
| **P2 cart + requests** | Add all to cart; Request on Diaex; event polling | `carts` over the existing cart; `stone_requests` and quotes; `events` |
| **P3** | Holds, order status in the production package, metals, parcels | Expiring holds; webhooks; orders read; `material` and parcel listings; metals |

## 7. Hand-off checklist for the Diaex implementer

Diaex's own rules apply (`AGENTS.md`): a plan in `docs/plans/` first, PRs of at most 400 lines, tests first, and every new file and class listed in `docs/ARCHITECTURE.md` and `docs/TYPES.md`.

1. **Tokens.** New `partner_tokens` table (hash, `user_id`, `org_id`, `client_id`, scopes, `expires_at`, `revoked_at`, test flag) in `db/schema.sql`. Add a dependency beside `get_firebase_user` in `app/auth.py` that resolves a token to the same `(user_id, Access)` as `browse.person_and_level` (`app/browse.py:111-129`).
2. **Router.** New `app/partner/api.py` with `APIRouter(prefix="/partner/v1")`, included in `app/main.py` near line 1721; reuse `_error` and `app/limits.py` keyed by token.
3. **Match.** New `app/partner/match.py`: translate a requirement to `catalog.Filters` and to `layouts.LayoutSearchIn`; add the height check and the fit score; return stones through `browse.public_stone` only. Use `pairs.SEARCHES` and the candidate cap for engine calls.
4. **Stone refresh.** Wrap `browse.batch` and `browse.stone`; derive the ETag from price, `availability` and whether the stone is in the hidden set (`catalog._HIDDEN`). Give stones a link that opens in both looks (`?stone=` works only in the new one; `f={"lookup":"<id>"}` works in both).
5. **Carts.** Wrap `cart.add_many` / `cart.add_set`; add `'partner'` to the `added_from` check and a `source_ref` column on `cart_items`; make the web cart read `?set=`. Decide the launch-gate rule for partner carts (`app/launch.py`).
6. **Requests.** New `stone_requests` and `stone_request_quotes`; supplier view beside `app/sourcing/pages.py`; outreach as a new `supplier_inquiries.kind` whose lines may have no listing (today `inquiry_lines.listing_id` is NOT NULL).
7. **Events.** A partner outbox written in the same transaction as the fact, following `workflow_outbox` and `app/sourcing/outbox.py`; sources are `stone_events`, `sold_marks`, `allocations`, order transitions.
8. **Holds.** New `partner_holds` with `expires_at`, unioned into `_HIDDEN` in `app/catalog.py:382-384` only while unexpired; keep `listing_id` NOT NULL.
9. **Later.** `stones.material`; a parcel listing type (`stock_map.py` and `stock_config.py` field maps, count / total weight / price per carat); metals tables.
10. **Sandbox.** Test tokens route to `FakeCatalog`; add `requests/partner.http` examples with `{{NAME}}` placeholders.

## 8. Open questions for the founder

1. **Who may see prices and buy?** Diaex shows prices only to KYC-approved companies, and buying needs Pro and is closed in production. Should a Pavé user without KYC see indicative price bands, and should Pavé-originated carts need Pro?
2. **Whose cart?** Diaex carts belong to a person; a Pavé connection belongs to an org. Is "the user who connected owns the cart" acceptable, or does Diaex need org carts?
3. **Melee, coloured stones, moissanite:** will Diaex list these as inventory, or serve them only through requests that staff broker?
4. **Markup mode:** do Pavé-originated buyers trade direct with suppliers or through ASKA with markup, and is there an attribution or commission field for `src=pave`?
5. **Price snapshots:** may Pavé keep Diaex prices in saved designs and exported production packages, and for how long?
6. **Self-hosted Pavé:** may any self-hosted instance connect to production Diaex with a user's token, or only registered clients?
7. **Holds:** will suppliers honour them, or are they only Diaex's internal priority?
8. **Metals:** is Diaex the seller of record, or a referral to refiners? Who carries price-lock risk?

## 9. Sources and limits of this research

- Diaex facts: read directly from the repository; every claim above carries a path.
- Industry context was cut short: the session's web search budget ran out after three searches, so the metals section and the tolerance defaults rest on general trade knowledge and need checking before they become contract.
- What the searches did confirm: Nivoda's GraphQL API exposes `diamonds_by_query` with filters, pagination and offer ids, plus `create_hold` (returns `id`, `denied`, `until`) and `create_order` ([Nivoda API guide](https://buyerhelp.nivoda.com/hc/en-gb/articles/47645423678993-API-Installation-Guide)). Rapaport's Instant Inventory API needs at least one filter, uses bearer tokens, and forbids importing listings into a local database ([Rapaport help](https://help.rapaport.com/en/articles/5594773-search-filter-capabilities-result-limits-and-in-store-use)). Sieve grades predict average stone weight only for well-proportioned rounds ([Skyjems](https://skyjems.ca/pages/encyclopedia-diamond-sieve)), so the contract carries mm as truth and sieve as an optional label.
- Diaex's own earlier research records that melee is under 0.20 ct, sold in parcels by sieve without per-stone reports, that parcels list as count, total weight and price per carat, and that calibrated stones are quoted at ±0.05 to ±0.1 mm (`docs/plans/2026-10-31-pairs-and-large-layouts.md:212-235`).
