# Integrations hub

_25 November 2026._ How Pavé hands a piece to the systems a jeweler already runs, and later reads stock back. It rests on [`19-erp-and-pos-apis.md`](../research/19-erp-and-pos-apis.md) (R19), [`21-connectors-and-developer-api.md`](../research/21-connectors-and-developer-api.md) (R21), the ERP report's order of work as those two correct it, and `docs/strategy/catalog-import-and-store.md`. Labels: `[V]` opened at source, `[V2]` a secondary source, `[S]` search extract, `[E]` estimate; `[V, re-read]` marks pages this plan's writer opened again on 25 November. **It takes over** the engine half of `docs/plans/publishing.md` (build step 6, `ChannelProvider`, the tables `channel_connection`, `listing_step`, `channel_task`, `inbound_event`, `stock_movement`), **narrows** that plan's "variants are never stored" rule (4.2), and **corrects** step 2 of the ERP report's build table on The Edge. Publishing keeps the product record, media, kit, feeds and listings. Identity, the secrets keyring, API keys, Pavé's own `/v1`, events and webhooks, and the partner link's OAuth tokens belong to `docs/plans/accounts-and-developer-api.md` (the sister plan). Masters and catalogue data only: Pavé never keeps books. Not legal advice.

## 1. Experience

**One place.** A top-level **Integrations** page (`/integrations`). The Settings page that lists AI services and Blender under that word today is retitled "Services". The Connections half of `/channels` (publishing §1) moves here; Listings stays.

**The page** is a calm gallery of cards, grouped by a jeweler's words, never by technology:

| Group | Card | States |
|---|---|---|
| Any system | **Pavé item file** (spreadsheets and JSON) | Always ready, offline |
| Accounts | **Tally** | File ready · Send from this computer |
| Store counter | **The Edge** | Update file ready · New-items file needs your template |
| Online store | **Shopify** | Not connected · Connected · Needs attention |
| Stones | The partner marketplace | Opens its own connect flow (sister plan) |
| Other systems | Packages that offer no connection, searchable | "Use the Pavé item file." |

Each card has one sentence on what is sent and one chip. No keys, endpoints or logs.

**Setting a system up** is one sheet with four steps:

1. **What will be sent.** A plain list shown on one of the person's own pieces, with a fixed line: "Pavé never sends invoices, payments or anything to your books." Then who owns what: "Stock, cost and actual weights stay in Tally. Pavé owns names, pictures and expected weights." Only SKU and price have a switch.
2. **Match fields.** Pavé's field with a sample value on the left, their column on the right, defaults filled in. Sure matches are folded away; unsure ones are open with an amber dot. Each row allows one change from a short menu: unit, letter case, a lookup table (14K → 585), a naming pattern. No scripts.
3. **Try it.** Writes nothing anywhere. Per piece: will be added, will change, no change, cannot be sent (with the reason and a fix). Totals a bookkeeper can check: pieces, stones, carats, grams per purity.
4. **Export or Send.** A file downloads with a one-page "how to import this" note. A live send is a second confirm that names the destination ("Company: Atelier Gold 2026–27").

**After.** A system's page has three tabs. **Pieces**: a row per piece with a chip (In step · Waiting · Changed there · Couldn't send · Blocked · Not linked) and the problem in plain words; the chip also shows on the piece's project page. **Needs your eye**: the review queue. Each item shows the field, our value, their value and who owns it, with *Keep ours* and *Use theirs*. A second order for a held one-of-a-kind piece sits at the top. **History**: "Sent 42 pieces to Tally: 40 added, 2 changed", the file that went, and *Try again* on a failure.

**Per system.** *Tally:* "Send to Tally" appears only when Pavé runs on a computer in the shop; the person picks one of Tally's open companies. *The Edge:* "Add new items" is greyed with its fix: "We need your Edge template. In The Edge: Inventory → Items → Add → Rcv Invoice → Import Invoice → Download Blank xlsx. Drop it here." *Shopify:* pictures onto an existing listing first, then products as drafts, stock last. *One-of-a-kind pieces:* "Sold in one place" (default: one checkout, "enquire" elsewhere) or "Listed everywhere" (hosted only; the seller accepts the risk in words).

**On a laptop** the page says: "This computer checks every minute while Pavé is open. Nothing is checked while it sleeps." Anything needing a public address reads "Needs Pavé hosting", never an error.

**With the assistant** ("Set this up with me"). It asks first: which system, which company or shop, whether item names follow the SKU, how groups are named. Then it fills the same mapping rows, runs the same dry run, shows the totals and pauses for approval before anything is sent. The person can watch, pause, and take over by editing a row. It never sees credentials or values read back from the other system (4.11): it is told "3 pieces changed in Shopify"; the person sees the values.

## 2. Structure

**`packages/connectors`** (new; pure TypeScript; no ambient `fetch`, `fs` or `process`; exports `.` and `./testing`)
- `connector.ts`: `Connector` and its manifest (section 3). The engine reads the manifest and never branches on a connector id.
- `canonical.ts`: `CanonicalStyle`, `CanonicalVariant`, `MetalLine`, `StoneLine`, `MediaRef`, `StockUnitRef`, `Certificate`, `digest()`, and `fromPackageContext()`, which builds a style from what `@pave/production` already computes.
- `ownership.ts` (the matrix), `mapping.ts` (the mapping document, the closed transform list, a deterministic `proposeMapping`), `totals.ts` (control totals), `words.ts` (stone names from origin fields: "laboratory-grown diamond", never "LGD").
- `engine/` (pure): `plan.ts` (publishing's `planSync`), `reconcile.ts`, `lanes.ts`, `bucket.ts`, `reserve.ts`.
- `systems/item-file/`, `systems/tally/{xml,json,lan}.ts`, `systems/edge/{update,receive-invoice}.ts`, `systems/shopify/`, later `systems/marketplace/`.
- `testing/`: `conformance.ts`, `fakes/{tally,shopify,generic}.ts`, `cassette.ts`, `oversell-sim.ts`.

`packages/channels` (planned, publishing §2) keeps the listing parts: `desired`, `copy`, `compliance`, `media`, `feeds/*`, `kit`. Its `provider`, `plan`, `http`, `providers/*` and `testing/*` are built here instead. `packages/sourcing` stays as built; when the marketplace is wired, `systems/marketplace` implements `SourcingProvider` and the `query` and `holds` groups on one connection row.

**`packages/production`**: subpath exports `./csv`, `./paths`, `./facts` (`billOfMaterials`, `stoneRows`); `job.ts` writes `job.json` from `bundle.ts`.

**`apps/server/src`**
- `connectors/{registry,service}.ts`: `IntegrationsService` in `services.ts`. `ProductionService` gains `canonical(piece, sctx)`: it evaluates once in the kernel pool and returns a `CanonicalStyle`, because the server may not import the kernel.
- `connectors/context.ts`: all a connector may touch: rate-limited HTTP, a `SecretHandle`, a redacting logger, a clock, an abort signal. Public hosts go through `net/safe-fetch.ts` (assistant build). `net/lan-fetch.ts` is its mirror: **only** loopback and private addresses, only the configured host and port, no redirects.
- `connectors/engine/{outbox,relay,inbound,poll,sweep,review,purge}.ts`. The relay and pollers are a `work` kind (`sync`) from `deploy-and-durable-jobs.md` step 1: no second queue. `events.ts` is not durable: it only refreshes open windows.
- `connectors/remote-store.ts`: the **only** module that touches read-back data (4.11). `handlers/{integrations,stock}.ts`. `rpc/execute.ts` gains the restricted-output mask (the sister plan edits this file too). Credentials go through the sister plan's `secrets/vault.ts`; OAuth refresh reuses its `oauth/refresh.ts`.

**`apps/studio/src/features/integrations`**: `IntegrationsPage`, `SystemCard`, `SetupSheet`, `SystemPage` (Pieces, Review, History), `SyncChip`, `SalePolicy`, `commands.ts`.

**Flow out.** A change to a synced field writes an `outbound_event` in the same transaction → the relay builds the piece's canonical state *now* → `plan` → a `sync_step` intent row → `push` with the step key → digest on `external_ref`. File connectors skip the relay: `render` runs inside a `sync_run` and yields an asset. **Flow in.** A poll (later a relayed webhook) yields hints → `inbound_event` → a coalesced `fetch` → apply under the ownership matrix, or raise a review item.

**Local today:** every file export, the Tally LAN post, Shopify push and polling with the merchant's own app, the review queue, the ledger. **Hosted later:** inbound webhooks and the relay, the on-site agent, a Shopify app of our own, "Listed everywhere", any callback on a public address.

## 3. Contract changes

All additive: no built code changes shape; two unbuilt plans do. Schemas in a new `packages/schema/src/api/integrations.ts`. Migrations take the next free number at build time.

**Connector interface** (`sdk: 1`; first-party, in-process). The manifest is data: `id`, `version`, `label`, `group`, `transport: 'file' | 'http' | 'lan'` (`lan` runs only on a local install or the on-site agent), `dataUse: 'restricted'` (the only value this plan ships, 4.11), `auth` descriptors with scopes per capability, a `config` JSON Schema drawn as a form, static `targetFields` for mapping, `streams` (entity, pull, push, deletes, inventory `none | replace | cas`), `ownership` defaults, output schemas and rate hints.
```ts
interface Connector {
  manifest: ConnectorManifest
  render?(styles: CanonicalStyle[], mapping: Mapping, opts: RenderOpts): FileData[]  // pure, no ctx
  parse?(file: FileData): AsyncIterable<Remote>
  check?(ctx): Promise<Health>;  discover?(ctx): Promise<RemoteField[]>
  pull?(ctx, stream, cursor): AsyncIterable<{ records: Remote[]; next: Cursor; full: boolean }>
  fetch?(ctx, ref): Promise<Remote | null>
  plan?(desired, remote, memo): Step[]       // pure; apply, then re-plan, must be empty
  push?(ctx, step): Promise<StepResult>      // one effect per step.key
  verifyWebhook?(headers, rawBody, secret): Hint[] | null
  auth?: { begin; complete; refresh; revoke? }
  query?: { search; availability };  holds?: { place; extend; release; get }  // reserved: marketplace
}
```
Cursors are opaque and advance only after the page is committed. A major bump ships a migration for cursors and mappings.

**File formats** (versioned apart from our code; columns only appended inside a major; units in the header; empty means unknown, never zero)
- `pave.item-master/1`: `styles.csv` (as R21 §9.1); `variants.csv` (the columns of R21 §9.1, plus `tag_no` and `hsn_code`); `bom.csv` (the 16 existing columns after `variant_id`); `stones.csv` (the 24 existing columns after `variant_id`, plus `growth_method, treatment, lab, report_no`); `media.csv`; `items.json` (the same data nested per style); `manifest.json` (schema id, generator, counts, control totals, SHA-256 per file); `images/<sku>/<nn>-<role>.jpg`. `style_id` is the piece id; `variant_id` is `<piece id>:<variant key>`, key `base` for the design as drawn.
- `pave.job/1`: `job.json` added to the production zip: job id, quantity, size run, due date, expected metal per alloy with casting allowance, the stone schedule with its suppliers, casting-tree inputs. `MANIFEST_SCHEMA` is unchanged.
- `tally-masters/1` (`masters.xml`, `masters.json`); `edge-item-update/1` (one delimited file per Edge category); `edge-receive-invoice/1` (conditional, 4.7).

**Entities.** `Piece.sku` (unique per org; shared with publishing §3, whichever lands first). Stone quality gains optional `growthMethod`, `treatment`, `lab`, `reportNo`; stone origin gains `simulant`. `CommandDef` gains `dataUse?: 'restricted'`; output fields are marked with zod `.meta({ restricted: true })`. `Capabilities` gains `integrations: string[]` and `lan`. `ServerEvent` gains `integration.updated`. `PieceSummary` gains `sync: { connectionId, status }[]`.

**Commands** (publishing's `channels.connect/list/update/disconnect` are replaced by these; `listings.*` are unchanged)

| Command | Input → output | Flags |
|---|---|---|
| `integrations.catalog`, `.describe {system}` | systems with state; what is sent, target fields, config form | query, tool |
| `integrations.connect` | `{system, config?, credentials?}` → `{connection}` or `{authorizeUrl}` | admin, no tool, `secret: ['credentials']` |
| `integrations.update`, `.disconnect`; `.check` | `{id, config?, ownership?, paused?}`; `{id}` → health | admin, no tool; check: query, tool |
| `integrations.mapping.get / .propose / .confirm` | `{id}` → `Mapping`; `{id, version, doc}` | propose: tool; confirm: **confirm** |
| `integrations.dryRun` | `{id \| system, scope}` → `{runId, digest, rows, totals, findings}` | tool |
| `integrations.export` | `{system, profile, scope}` → `{runId, asset}` | tool |
| `integrations.send` | `{id, digest}` → `{runId}`; 409 if anything moved since the dry run | admin, **confirm** |
| `integrations.records`, `.runs`, `.review.list` | `{id, status?, cursor?}` | query, tool, restricted |
| `integrations.review.decide`, `.replay` | `{itemId, choice: 'ours' \| 'theirs'}`; `{stepId}` | person only; admin, **confirm** |
| `stock.units.*`, `stock.reserve`, `stock.release`, `stock.setPolicy` | step 8 | reserve, release: **confirm** |

**Tables** (all `org_id`, through `Repo`)
- `connection` (publishing's `channel_connection`, one name): `connector_id`, `connector_version`, `account`, `status` (`ready | needs_auth | paused | error | stale`), `config`, `ownership`, `allow_assistant_read` (false), `last_ok_at`, `purge_after`. Its secret is a row in the sister plan's `credential` table (kind `channel`, `ref_id` = the connection id).
- `mapping` (unique `(connection_id, version)`); `sync_run` (`kind`: `export | dry_run | push | pull | sweep`, `status`, `totals`, `digest`, `asset_id`).
- `external_ref`: unique `(connection_id, entity, entity_id)`; `external_id`, `external_version`, `pushed_digest`, `seen_digest`, `base_snapshot` (the last synced values, the base for conflicts), `status` (`in_sync | pending | failed | drifted | blocked | unlinked`), `attempts`, `last_error`.
- `outbound_event` (`connection_id`, `entity`, `entity_id`, `desired_digest`, `lane`, `state`): the connectors' outbox only. The public events feed is the sister plan's `api_event`; both are written in the change's transaction.
- `sync_step` (publishing's `listing_step`; unique `key`, `state`: `intent | done | failed | dead`); `inbound_event` (unique `(connection_id, dedupe_key)`, kept 30 days); `review_item` (`kind`: `drift | both_changed | structure | second_order | unknown_outcome`, `field`, `ours`, `theirs`, `state`).
- Step 8: `stock_unit` (`piece_id`, `variant_key`, `tag_no` unique per org, `gross_g`, `net_g`, `certificates`, `hallmark_id`, `location`, `status`: `available | reserved | sold | memo_out | unknown`, `memo`, `sale_policy`: `exclusive | everywhere`, `checkout_connection_id`); `reservation` (`stock_unit_id`, `holder`, `state`: `held | confirmed | released | expired`, `expires_at`, `idempotency_key`) with a **unique partial index on `stock_unit_id` where state is `held` or `confirmed`**; `stock_movement` as in publishing.

## 4. Hard parts and decisions

### 4.1 One interface and one engine

**Decision:** one `Connector` interface and one engine, first-party and in-process. `SourcingProvider` (built), `ChannelProvider` (planned) and an ERP exporter differ only in which optional methods they have (R21 §4.1). All I/O is injected, so the same code later runs in the on-site agent and recording fixtures is one wrapper. *Rejected:* three seams growing three engines; third-party connectors and a sandbox for them (customers' credentials inside our process; outsiders get the public API instead).

### 4.2 A stock unit, and what "variants are never stored" still means

**Position: add a stored `stock_unit`, and keep the rule for what it protects.** Publishing §4.4 computes a variant's facts and cost from the design and rejects "a piece per variant". That stays: a variant is a selection, not a second design. A stock unit is something else: one physical, tagged piece with its own cast weight, certificates, hallmark slot, location and status. It cannot be computed, and overselling protection needs a row to lock (4.5); the catalogue memo lists it as missing (§2.3). Stored variants for imported styles are **not** in this plan. The stock unit arrives at step 8; `tag_no` is in the file format from step 1, so nothing breaks later. *Rejected:* quantity 1 on a variant as the one-of-a-kind record (nowhere for actual weight or a hold); a piece per physical item.

### 4.3 The canonical piece, identity, and one owner per field

Style → variants → stock units, with metal lines, stone lines, media by content hash and certificates: already the shape of `bom.csv`, `stones.csv` and the production manifest. **Identity:** our ids never change; the SKU equals the receiving system's item number wherever that system allows it (The Edge's image and Shopify links key on it [V, R19 §3.2]); the remote id is kept on `external_ref`.

| Field group | An ERP or POS stays (the usual case) | A sales channel |
|---|---|---|
| Identity, design, CAD, expected metal and stones, pictures, published or withdrawn | Pavé | Pavé |
| Title, description, tags | Pavé | Pavé, or the channel for a "pictures only" link |
| SKU string; price | The ERP if it assigns numbers or holds price lists (`ask`); else Pavé | receives |
| Actual weight, certificate, hallmark id, actual cost | The ERP; Pavé's cost is labelled an estimate | never sent |
| Stock and sold status | **The ERP**; Pavé relays | never the owner; it reports sales as events |

The matrix is data on the connection. The owner's change propagates. A non-owner's change becomes *drift* in the review queue, never a silent overwrite. If both changed, the owner's value stands and the other is shown. No last-write-wins by clock. A structural mismatch blocks that record only. A remote delete never deletes in Pavé; a missing row means "gone" only after two full sweeps. **Never the books:** no connector renders or posts a voucher, invoice, payment or stock posting. Stock is read, never set, except on Shopify when the jeweler has made Pavé its owner.

### 4.4 Sync rules

1. **Outbox.** Rows say "this piece's desired state changed", not "apply this delta": five offline edits become one push. One push in flight per connection and entity.
2. **Idempotent effects.** Each step has a key. Where the remote takes one it is sent (Shopify inventory mutations [V]). Where it does not, the intent row goes first and an unknown outcome is settled by reading and adopting by SKU.
3. **Inbound events are hints.** Dedupe on the platform's delivery id, coalesce, fetch current state, compare versions. Order then does not matter and replay is safe (the receiver Shopify, Stripe, Square and Etsy all describe [V, R21 §3.4]).
4. **Polling decides.** Every 60 s while the app is open, 15 min otherwise; a full sweep nightly and after more than an hour offline, *before* pushes resume, so a stale laptop never overwrites newer remote state.
5. **Visible state.** Four lanes per connection (stock and unlisting, orders, content, backfill), rate budget reserved for the first. Five failed attempts move a step to a dead list with *Try again*. After 48 hours without a good run a connection is stale and its stock shows "subject to confirmation".

### 4.5 Overselling a one-of-a-kind piece

**Decision: a reservation ledger decides, not faster sync.** One holder per stock unit, enforced by the partial unique index (the slot-claim pattern of the assistant build's `plans.ts`); expiry is checked on read and swept. On the first order event from any channel: (1) insert the reservation; (2) push quantity 0 to every other channel, compare-and-swap from 1 where offered; (3) only then anything else. If step 1 conflicts, a second order exists: it tops the review queue and is never auto-accepted. **Default: one checkout channel, "enquire" elsewhere.** "Listed everywhere" needs hosting and the seller's written acceptance.

Evidence: no platform guarantees anything across channels, and whether two simultaneous checkouts can both succeed on quantity 1 inside one channel could not be verified (R21). The window is up to a minute hosted, the poll interval locally, unbounded while a laptop sleeps. The software race is small (about 0.002% inside 60 s for a piece that sells monthly [E]); a sleeping laptop and an unseen counter sale are the larger risks.

### 4.6 Tally: a file, then a port with no password

- **Masters only:** units, stock groups, stock items (name = SKU), in that order, under `All Masters` [V]. The renderer has no voucher path and a test fails on any `VOUCHER` tag. Tally overwrites a voucher on a repeated GUID [V, R19].
- **XML for every release; JSON only from TallyPrime 7.0** [V]. The file ships first: it works from any install.
- **The port has no authentication** [V, by absence on every page opened]. So: Pavé only calls Tally and never opens, forwards or tunnels a port; `lan-fetch` reaches only the one configured private address; every request carries the chosen company (`svCurrentCompany` [V]) and a send is refused if the loaded company differs; the screen says plainly that the port has no password and belongs on a trusted network.
- **No dry run in Tally** [E]. So: read existing units, groups and items, plan create, alter or skip locally, and suggest a test company. A unit cannot change once used [V]: never alter units. A dropped connection does not say whether the write happened [V]: read back, then decide.
- **Conditional:** bill-of-material, HSN and GST tags are not in Tally's reference; its advice is to export a hand-made sample and copy the shape [V]. They ship only with a pilot shop's sample export in hand. Each shop's Tally is customised [E], so group naming is a mapping.

### 4.7 The Edge: two files, one conditional

The ERP report called Edge's item import "a ready target". It is not: that wizard **only updates existing items** [V].
- **Update file, buildable now.** Headers must equal Edge's published field names [V] (`itDesc`, metal, size, style, price, web and `itDetail_n` fields), matched by `itKey` or `itVendorID` + `itVendStyleCode`. No weight, stone, cost or image columns exist, so expected weights and stones go into custom details, one category per file.
- **Create file, conditional.** New items enter through Receive Invoice → Import Invoice [V]. Its columns are public only as a screenshot; the blank template is inside the program [S for the names]. **The step starts only when a customer supplies that template and agrees to one test import.** Pictures go in a folder named by vendor style number [V].
- With no Edge licence there is no test here [E]: the update file is a golden against the published headers until a customer imports one. Edge's paid file exchange (EDT, $1,000 to $2,500 to activate, paid by the jeweler [V]) is the only sanctioned read path and is out. Edge takes no new stock from Shopify [V], so that is no back door.

### 4.8 Shopify: the first live connector, one way

- **API.** Admin GraphQL only; REST is legacy [V]. Pin a dated version (2026-10 today [V]). `productSet` keyed by our id, three options at most [V], facts as metafields, stone lines as metaobjects.
- **Limits** [V]: 100, 200, 1,000 or 2,000 cost points a second by plan, 1,000 per query, 10 per mutation. The bucket reads `extensions.cost` and obeys `Retry-After`.
- **Distribution.** A laptop cannot hold our app's secret. **Decision: the merchant's own app with the client-credentials grant**. That grant works only when app and store are in the same Shopify organisation, and tokens last 24 hours [V, re-read]. A public app (review, $19, billing through Shopify, 0% of the first $1,000,000 then 15%, a choice that cannot be changed later [V]) waits for hosting.
- **Protected customer data** [V]. One-way products asks for no order or customer scope. Two-way stock selects only order id, line SKU and quantity; never name, address, phone or email.
- **Two-way stock** (step 9): `inventorySetQuantities` needs `changeFromQuantity` and an `@idempotent` key from 2026-04, and is meant for the system that owns stock [V].

### 4.9 Local-first limits

A local install listens on 127.0.0.1 and cannot receive webhooks. **It polls.** *Rejected:* tunnels (test-only in their vendors' words [V]; they expose a server with no sign-in). **With hosting:** a small relay stores each webhook's raw body and headers; the local app pulls them and verifies signatures itself, so the relay holds no connector secret. **The on-site agent exists only once Pavé is hosted** (a local Pavé is already inside the shop). It reuses the render-node protocol of `deploy-and-durable-jobs.md` §4.9. It is a signed Windows tray build, outbound HTTPS only, with a closed list of operations: post to the configured Tally address; read and write one folder. The server sends data, never a command or SQL; ERP credentials stay on that machine. *Rejected:* touching a desktop ERP's database.

### 4.10 Credentials

One sealed row per connection, per organisation, in the sister plan's `credential` table through its keyring (`secrets/vault.ts`): AES-256-GCM, bound to the organisation, with a key version. This plan adds no second store. Connectors get a `SecretHandle`, not a string; the logger redacts by value; `credentials` is a `secret` command field, so it never reaches the audit log; the browser gets the last four characters and a status. **Least privilege:** scopes are asked per capability, so a one-way product push never asks for inventory or orders. Refresh is single-flight (`refreshing_until`). Where the master key lives is the sister plan's (a keychain waits for the desktop shell); until then the connect sheet says a backup of the data folder contains these tokens.

### 4.11 Terms of service, and the wall around read-back data

| Source | Clause | Effect here |
|---|---|---|
| Shopify API terms, 7 Oct 2026 | §2.3.24: no use of API-derived or merchant data, even aggregated, to create, train or improve AI systems [V, re-read]. Its consent wording does not clearly reach this half, so no exception is assumed | The wall |
| | §6.2.3: delete merchant data within 30 days of uninstall [V, re-read] | `purge.ts` |
| | §2.3.12: no app mainly for moving merchants away; §2.3.8: least data; §6.2.10: breach notice in 24 hours [V] | Exports carry Pavé's own data only; field-level selects; an incident note |
| Shopify partner agreement | A paid public app bills through Shopify (Part C §4), with app review and a further review for customer data; §9.15 repeats the AI bar [V; read in part] | Only if a public app is chosen |
| Xero terms, 4 Dec 2025 | 7(b)(i): API data may not train, fine-tune, adapt or enhance AI models, no exception stated [V, re-read]; 29; 15 and 38. Free to 5 connections, AUD 35 a month to 50; certification from AUD 245; a yearly security assessment from AUD 1,445 [V] | Not in the build order; the wall covers it |
| QuickBooks | $0, $300, $1,700 or $4,500 a month; reads metered; an assessment questionnaire [V, V2]. Terms did not render | Out until read |

The Edge and Tally publish no developer terms; Tally's risk is security (4.6).

**The wall. Every value read back from another system is `restricted`; no connector here ships any other setting.** It sits in four places:
1. **At rest:** read-back values live only in `external_ref.base_snapshot`, `inbound_event`, `review_item.theirs`, `stock_movement` and order rows, reached only through `connectors/remote-store.ts`. An import-graph test fails if anything under `assistant/`, `traces.ts`, `render-feedback.ts`, `pavefile/` or `packages/agent` imports it.
2. **On the way to a model:** in `rpc/execute.ts`. When the actor is not a person (an assistant run, MCP, an API key), fields marked `restricted` are replaced by a marker before the output leaves the pipeline. Mapping proposals use only the manifest's static `targetFields`; live `discover` results are matched by an alias table, with no model.
3. **Into anything that learns:** traces, recordings, feedback rows and `.pave` files store the marker, never the value.
4. **Out again:** within 30 days of a disconnect or a detected uninstall, `purge.ts` deletes that connection's read-back rows and credentials (at next start, if the laptop was off).

A per-connection switch (`allow_assistant_read`) could later let the assistant read those values inside the one request a person made, still never stored. It ships **off and hidden** until counsel answers.

**For counsel:** Shopify §2.3.24, §6.2 and partner §9.15; Xero clauses 7 and 29; Intuit's developer terms in full; whether sending a merchant's own data to a language model to answer that merchant's question "improves" an AI system; whether a sale on one channel may drive an unlisting on another; whether reading a jeweler's desktop database with the jeweler's consent breaches the vendor's licence.

### 4.12 Buy or build

**Build.** The first three connectors are files and a LAN port that no unified API covers [E]; the fourth is Shopify, whose stock rules a unified layer hides; a vendor key is ours, so it cannot live on a laptop; a third party would hold jewelers' catalogues and tokens. Prices seen 25 November [V, R21 §3.2]: Merge $650 a month past three linked accounts (no commerce or POS), Apideck $599 or $1,299, Unified.to from $750, Rutter by quote. Nothing embeddable fits a proprietary laptop app: Airbyte's connectors and Nango are Elastic License 2.0, n8n is Sustainable Use [V]. **What would change this:** three or more cloud accounting or POS back ends asked for in one quarter with Pavé hosted, or a customer on QuickBooks Desktop (Rutter covers it).

### 4.13 What is unverified, and what that does to the order

QuickBooks API detail and terms, Xero item fields [E] and Zoho's terms keep every accounting cloud out of the build order. No Indian jewellery package documents an API (Ornate is still [S]) and Lightspeed R-Series is [E]: no named connectors; the Pavé item file is their route. The Edge's Receive Invoice columns [S] make step 6 conditional. Tally's BoM, HSN and GST tags make part of step 3 conditional. Shopify scope names and POS behaviour [E] are checked against the pinned version in step 7.

### Decisions that are the founder's

1. **Add the stock-unit record**, narrowing publishing's rule as in 4.2? *Recommend yes, at step 8.*
2. **One connector package**, with publishing's engine half built here? *Recommend yes.*
3. **Accept the wall in 4.11**: the assistant neither reads nor learns from a customer's sales until counsel answers? *Recommend yes.*
4. **One checkout channel as the default** for one-of-a-kind pieces? *Recommend yes.*
5. **Tally before The Edge?** *Recommend yes; steps 3–4 and 5–6 can swap for a US pilot.*
6. **Find one Edge store** for the blank template and a test import, and one Tally shop for a sample master export. *Recommend asking now.*
7. **Shopify through the merchant's own app only** in year one? *Recommend yes.*
8. **Stock read-back before a customer pays for it?** *Recommend no: stop after step 7 until one does.*

## 5. Verification

- **Golden files, byte-exact,** for every export, on `packages/production/src/testing/fixtures.ts`, dates injected. Also: Edge headers equal the published list; no `VOUCHER` tag in any Tally output; no "LGD" anywhere; manifest hashes and control totals match the rows; `items.json` validates against its JSON Schema.
- **Conformance suite** every connector passes: a clean failure on bad credentials; `pull` resumable from any cursor; one effect per step key; an empty re-plan after apply; a changed body or old timestamp rejected by `verifyWebhook`; `Retry-After` obeyed; no secret in any log line or fixture.
- **A fake per system, with its real quirks.** `fakeTally`: import counts, line errors, a wrong loaded company, a drop after the write. `fakeShopify`: cost throttling, full-replace `productSet`, a stale `changeFromQuantity`, duplicate and out-of-order events, a crash between any two steps. **Recorded fixtures** from a Shopify development store and a scratch Tally company; the recorder scrubs `Authorization`, cookies, query tokens, known secret values and restricted bodies; CI greps fixtures for token shapes.
- **Property tests:** any reordering and duplication of inbound events ends in the same state; replaying the whole outbox changes nothing. **Kill tests** (`PAVE_KILL_AT`): after the outbox write; after the remote call and before the result is stored; mid-backfill. One effect each.
- **Overselling simulator:** N channels, order arrivals, webhook delay and loss, poll interval, laptop sleep. Pass marks: no unit ever has two confirmed reservations (0 in 100,000 runs, every policy); under "one checkout" no second order reaches the queue. It also prints second orders per 10,000 sales under "everywhere" at 60 s and 15 min, which the seller's acceptance text quotes. The unique index is raced on real Postgres in CI (PGlite runs queries one at a time, so it proves nothing there).
- **The wall:** a canary string planted in a fake Shopify order and a fake Tally item appears in no assistant message, tool result, trace, recording, `.pave` file, log line or other connector's export; the import-graph test; a purge test.
- **Server harness:** tenancy across two organisations for every table; roles; `send` answers 409 on a stale digest; `lan-fetch` refuses public addresses and redirects. **Screenshots** of every state in section 1, light and dark.
- **Benchmark:** 500 fixture pieces exported on a 2023 MacBook Air with the app responsive; pass mark under 60 s with evaluations cached [E].
- **By hand, the founder can:** download the item file for a ring and open it in Excel and Numbers; import `masters.xml` into a scratch Tally company, press "Send to Tally" twice and see "0 added" the second time; send a draft to a Shopify development store, edit its title there and see "Changed there" with both values.
- **Cannot be verified here:** an Edge import; a customised Tally; webhook latency.

## 6. Scope cuts

| Out | Picked up when |
|---|---|
| Vouchers, invoices, payments, stock postings, metal ledgers | Never ("never build the books") |
| QuickBooks, Xero, Zoho item push | Counsel has read the terms and three customers ask in one quarter |
| Valigara (documented API [V]), PIRO, Odoo, Business Central, NetSuite, SAP Business One, Lightspeed | A paying customer names it; Valigara first |
| Named connectors for Ornate, Jewel360 and other closed packages; The Edge's EDT read path | The vendor offers an interface; a customer already pays Edge for EDT |
| XLSX output | A customer's importer cannot take CSV |
| Catalogue import (`parse` of other people's files), stored variants for imported styles | A catalogue-import plan |
| The marketplace client, its holds mirror and OAuth | The partner ships v1; tokens per the sister plan |
| Webhook relay, on-site agent, our own Shopify app, "Listed everywhere" | Hosting exists (durable-jobs steps 6–8) |
| `/v1`, API keys, outbound webhooks, feeds | The sister plan and publishing P1 |

## 7. Build order

Tests first in every step. Effort is one builder before review [E]: S about a week, M two to four weeks, L one to three months. A step touches the modules it names (paths in section 2), their tests, the schema and handler files of section 3, and one migration where it names tables. Steps 1–6 need no hosting and no approvals.

1. **The Pavé item file.** *Delivers:* `packages/connectors` with `canonical.ts`, `totals.ts`, `words.ts`, the `render` half of the interface and `systems/item-file` writing `pave.item-master/1` for each piece as drawn; `Piece.sku`; the `@pave/production` subpath exports; `ProductionService.canonical`; `integrations.export`, logged in `sync_run`; "Download item file" on a piece and on a folder. *Also touches:* `packages/production/package.json`, `packages/schema/src/api/{entities,commands}.ts`, `apps/server/src/{services,compose}.ts`, `apps/studio/src/features/production`. *Tests:* goldens for three fixture pieces; manifest totals; tenancy. *Done means:* the zip opens cleanly in Excel and Numbers, a re-export is byte-identical, and the benchmark is recorded. **S.** Depends on nothing new.
2. **Job file, dictionary, and the Integrations page.** *Delivers:* `job.json` (`pave.job/1`); the four stone fields and `simulant`; a column dictionary and JSON Schema under `docs/formats/`; `/integrations` with the gallery, the item-file card, "What will be sent" and History; Settings retitled "Services". *Tests:* the package golden updated once, on purpose; schema validation; screenshots. *Done means:* a non-developer finds, understands and downloads both files. **S.** Depends on 1.
3. **Tally masters as a file, with mapping and dry run.** *Delivers:* `mapping.ts`; the full `SetupSheet`; `integrations.describe`, `.mapping.*`, `.dryRun`; `systems/tally/{xml,json}.ts`; the `connection`, `mapping` and `external_ref` tables. *Conditional part:* BoM, HSN and GST tags only with a pilot's sample export. *Tests:* goldens; the no-voucher test; a mapping property test; dry-run totals. *Done means:* `masters.xml` imports into a scratch Tally company with the counts the dry run predicted. **M.** Depends on 2.
4. **Send to Tally on the LAN.** *Delivers:* `net/lan-fetch.ts`, `connectors/context.ts`, `systems/tally/lan.ts` (`check`, read companies and masters, `plan`, `push`, read-back), `integrations.connect/check/send`, the company picker and port note, `fakeTally`. *Tests:* conformance; wrong company; drop after write; `lan-fetch` addresses. *Done means:* a second send changes nothing, on the fake and on a recorded real run. **M.** Depends on 3 (Tally needs no stored secret).
5. **The Edge update file.** *Delivers:* `systems/edge/update.ts`, the key choice (item number, or vendor and style), custom-detail mapping, the import checklist, a paste-in of Edge item numbers into `external_ref`. *Tests:* header golden; one file per category. *Done means:* a customer can import it; the tile reads "Not yet checked with The Edge" until one has. **S.** Depends on 3; independent of 4.
6. **The Edge new-items file. Conditional:** starts only with a customer's blank Receive Invoice template and their agreement to one test import. *Delivers:* `systems/edge/receive-invoice.ts` in the template's columns, the photo folder, the template drop zone. *Tests:* a golden in those columns. *Done means:* that customer's import creates the items with pictures. **S.** Depends on 5 and the template.
7. **The engine, then Shopify one way.** (a) *Engine:* `outbound_event`, `sync_step`, `inbound_event`, `review_item`; relay, poller, sweep, lanes, bucket; the restricted mask, `remote-store.ts`, `purge.ts`; the Pieces and "Needs your eye" tabs; `fakeShopify`. (b) *Shopify:* client-credentials connect, link-and-pictures, then `productSet` drafts with metafields and stone metaobjects, polling by `updated_at`. *Tests:* property, kill, canary, conformance; development-store recordings. *Done means:* a draft product round-trips, an edit in Shopify shows as "Changed there", and the canary test is green. **M + M.** Depends on durable-jobs step 1 (`work`), publishing steps 1–3 (product record, media, checks) and the sister plan's keyring step.
8. **Stock units and the reservation ledger.** *Delivers:* `stock_unit`, `reservation`, `stock_movement`; `stock.*`; `SalePolicy`; `engine/reserve.ts`; `oversell-sim.ts`. *Tests:* the index race on real Postgres; expiry sweep; simulator pass marks. *Done means:* the simulator table exists and the default policy shows zero second orders. **M.** Depends on 7 and decision 1.
9. **Two-way stock on Shopify.** *Delivers:* order polling with field-level selects; `inventorySetQuantities` with compare-and-swap and its key; unlist-everywhere-first; second-order review items. *Tests:* stale quantity; duplicate order lines; a kill between reserve and unlist. *Done means:* a sale in the development store reserves the unit and zeroes the other fake channel before any content sync. **M.** Depends on 8, decision 8 and counsel's reading (4.11).
10. **With hosting: the relay, then the on-site agent.** The webhook relay and the local pull; then the agent as a second work kind on the render-node protocol, hosting the Tally LAN connector. *Tests:* conformance across the agent boundary; relay replay. *Done means:* a hosted Pavé sends to a Tally on another network. **M + L.** Depends on durable-jobs steps 6–8.
