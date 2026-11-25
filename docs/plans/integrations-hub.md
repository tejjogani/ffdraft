# Integrations hub

_25 November 2026, revised the same day after an adversarial review (which is why it runs past the usual 40 KB)._ How Pavé hands a piece to the systems a jeweler already runs, and later reads stock back. It rests on [`19-erp-and-pos-apis.md`](../research/19-erp-and-pos-apis.md) (R19), [`21-connectors-and-developer-api.md`](../research/21-connectors-and-developer-api.md) (R21), the ERP report's order of work as those two correct it, and `docs/strategy/catalog-import-and-store.md`. Labels: `[V]` opened at source, `[V2]` a secondary source, `[S]` search extract, `[E]` estimate; `[V, re-read]` marks pages this plan's writer opened on 25 November. **It amends three unbuilt plans**, `publishing.md`, `deploy-and-durable-jobs.md` and `accounts-and-developer-api.md` (the sister plan): readers of those, see "This plan amends" in section 3. Masters and catalogue data only: Pavé never keeps books. Not legal advice.

**Start gate.** Nothing here starts before lane A's release (A3) and the founder's first test ("core product first; ERP work later", HANDOVER §6). Step 1 starts when the founder says so; whether later steps also wait for the ERP report's pilot gate is decision 1.

## 1. Experience

**One place.** A top-level **Integrations** page (`/integrations`). The Settings page that lists AI services under that word today is retitled "Services". The Connections half of `/channels` (publishing §1) moves here.

**The page** is a calm gallery of cards in a jeweler's words. Names are plain text, no logos, each with "Pavé is not affiliated with …".

| Group | Card | States |
|---|---|---|
| Any system | **Pavé item file**: spreadsheet files, and a data file for other software | Always ready, offline |
| Any system | **Your own columns**: a spreadsheet laid out the way your system's import screen wants | Always ready, offline |
| Accounts | **Tally** | File ready · Send from this computer · "Not yet checked with Tally" until one real import is recorded |
| Online store | **Shopify** | Not connected · Connected · Needs attention |
| Stones | The partner marketplace | Its own connect flow (sister plan) |
| Other systems | The Edge and the packages that offer no connection | "Use the Pavé item file or your own columns; you match the columns in your system's own import screen." |

**Setting a system up** is one sheet with four steps:

1. **What will be sent.** A plain list shown on one of the person's own pieces, with a fixed line: "Pavé never sends invoices, payments, opening stock or anything to your books." Then who owns what: "Stock, cost and actual weights stay in Tally. Pavé owns names, pictures and expected weights."
2. **Match fields.** Pavé's field with a sample value on the left, their column on the right, defaults filled in. Sure matches are folded away; unsure ones are open with an amber dot. Each row allows one change, each shown with an example: unit (4.10 g → 2.64 dwt), letter case, a lookup (14K → 585), a naming pattern (`{category} {purity}`).
3. **Try it.** Writes nothing anywhere. Per piece: will be added, will change, no change, cannot be sent (with the reason and a fix: no SKU, artwork not confirmed, a stone with no stated origin). Totals a bookkeeper can check: pieces, stones, carats, grams per purity.
4. **Export or Send.** A file downloads with a one-page "how to import this" note. **Every live send is confirmed by a person on this screen**, which names the destination ("Company: Atelier Gold 2026–27"); the server refuses a send without that confirmation (4.6).

**After.** A system's page has three tabs. **Pieces**: a row per piece with a chip (In step · Waiting · Changed there · Removed there · Couldn't send · Blocked · Not linked) and the problem in plain words. **Needs your eye**: the field, our value, their value and who owns it, with *Keep ours* and *Use theirs* ("This copies the value into your piece. From then on it is your data, and the assistant can read it."). A second order for a held one-of-a-kind piece sits at the top. **History**: "Sent 42 pieces to Tally: 40 added, 2 refused", the file that went, and *Try again*.

**Tally.** The sheet shows, with pictures: where to switch Tally's server on; "Find Tally on this computer" (the default and the safest); and, for another PC, how to find its address and the Windows Firewall rule that lets only this computer reach the port. It says plainly that the port has no password, and to switch it off when unused.

**Shopify, honestly.** On a laptop this is the one technical task here: "This takes about ten minutes and the store owner's Shopify login." A checklist with pictures: open Shopify's developer dashboard, create an app, tick the scopes Pavé lists, install it on the store, copy the Client ID and Client secret, paste them here. *Check* names any missing scope. Once Pavé is hosted, an app of our own makes this one click (4.9, decision 6). Then: pictures onto an existing listing, products as drafts, stock last.

**One-of-a-kind pieces.** "Sold in one place" (default: one checkout, "enquire" elsewhere) or "Listed everywhere" (hosted only; the seller accepts the measured risk in words). The screen says: "If the piece is also in your display case, that is a second place. Mark counter sales here."

**On a laptop** the page says: "This computer checks every minute while Pavé is open. Nothing is checked while it sleeps." Anything needing a public address reads "Needs Pavé hosting".

**With the assistant** ("Set this up with me"). It asks first: which system, which company or shop, how item names and groups are formed. It fills the same mapping rows, runs the same dry run, shows the totals, and stops: the person presses Send. The person can watch, pause and take over by editing a row. It never sees credentials or anything read back from another system (4.11): at most "Some pieces need your eye in Integrations".

## 2. Structure

**`packages/connectors`** (new; pure TypeScript; no ambient `fetch`, `fs` or `process`; exports `.` and `./testing`)
- `connector.ts`: `Connector` and its manifest (section 3). The engine never branches on a connector id.
- `canonical.ts`: `CanonicalStyle`, `CanonicalVariant`, `MetalLine`, `StoneLine`, `MediaRef`, `digest()`, and `fromPackageContext()`, built from what `@pave/production` already computes.
- `ownership.ts`, `mapping.ts` (the document, the closed transform list, a deterministic `proposeMapping`), `totals.ts`, `words.ts` (stone wording, 4.12), `xml.ts` (the one escaping XML writer, 4.7).
- `engine/` (pure): `plan.ts` (publishing's `planSync`), `keys.ts`, `reconcile.ts`, `lanes.ts`, `bucket.ts`, `reserve.ts`.
- `systems/item-file/`, `systems/own-columns/`, `systems/tally/{masters,lan}.ts`, `systems/shopify/`; gated `systems/edge/`; later `systems/marketplace/`.
- `testing/`: `conformance.ts`, `fakes/{tally,shopify,generic}.ts`, `cassette.ts`, `oversell-sim.ts`.

**`packages/production`**: subpath exports `./csv`, `./paths`, `./facts`; `csvCell` gains a cell mode (4.12); `job.ts` writes `job.json`.

**`apps/server/src`**
- `connectors/{registry,service,snapshot}.ts`. `snapshot.ts` keeps one canonical snapshot per piece (4.3). It is computed by a new kernel task `canonical` (`engines/kernel/protocol.ts`, `engines/production.ts`), through that engine's limit of one, because the server may not import the kernel.
- `net/request.ts`: `safe-fetch.ts` is GET-only [V: repo], so it is extended into a request function (method, headers, body in; status, headers, body out) that keeps its address check inside the lookup, manual redirects and caps. **This plan owns the extension** (step 5); the sister plan's webhook sender uses it. A `lan` policy on the same core allows **only** the one configured loopback or private address and port.
- `connectors/context.ts`: all a connector may touch: an HTTP client bound to that connection's pinned hosts, a `SecretHandle`, a structured logger, a clock, an abort signal.
- `connectors/gate.ts`: `isPerson(ctx)` and send approvals (4.6).
- `connectors/remote-store.ts` and `stock-store.ts`: the only doors to the quarantined schema `remote` (4.11).
- `connectors/engine/{outbox,relay,inbound,poll,sweep,review,purge}.ts`: `work` kind `sync`; no second queue. `events.ts` is not durable: it only tells open windows to refetch.
- `handlers/{integrations,stock}.ts`; `rpc/execute.ts` gains the fail-closed projection (the sister plan edits this file too).

**`apps/studio/src/features/integrations`**: `IntegrationsPage`, `SystemCard`, `SetupSheet`, `SystemPage`, `SyncChip`, `SalePolicy`, `commands.ts`.

**Flow out.** A reviewed change writes a `sync_outbox` row in its transaction → the relay reads the piece's snapshot → `plan` → a `sync_step` intent row → `push` with the step key → digest on `sync_link`. File connectors skip the relay: `render` runs inside a `sync_run`. **Flow in.** A poll (later a relayed webhook) yields hints → `remote.event` → a coalesced `fetch` → compare under the ownership matrix → nothing, or a review item. Read-back never lands in an ordinary table.

**Local today:** file exports, the Tally send, Shopify with the merchant's own app, the review queue, the ledger. **Hosted later:** inbound webhooks and the relay, the on-site agent, a Shopify app of our own, "Listed everywhere".

## 3. Contract changes

All additive to built code. Schemas in a new `packages/schema/src/api/integrations.ts`.

**This plan amends** (none of these is built; a builder follows this file where they differ)
- **`publishing.md`.** Its build step 6 (engine) and the Shopify half of step 7 are built here (steps 7 to 9); do not build them from that file. `ChannelProvider` becomes `Connector`; `packages/channels` keeps `desired`, `copy`, `compliance`, `media`, `feeds/*`, `kit`. `channels.connect/list/update/disconnect/browse` become `integrations.*`. Tables: `channel_connection` → `connection` plus the sister plan's `credential`; `listing_step` → `sync_step`; `channel_task` → `work` kind `sync`; `inbound_event` → `remote.event`; its `outbound_event` (the developer-webhook outbox) is the sister plan's `api_event`; `secrets.ts` is the sister plan's keyring. `listings.publish` and `.unpublish` need a `send_approval` (4.6). **Stock quantity (its §3, §4.6):** a variant is *counted* or *serialised*, never both. Counted: `variants[].quantity`, written by `inventory.set`, as publishing says. Serialised (one of a kind, from step 10): quantity is the count of its `available` stock units; `inventory.set` on it is refused with a pointer to `stock.*`. Where an ERP owns stock, its number wins and Pavé relays it. For non-persons `product.get` returns the quantity a person last set, not live stock (4.11). Its "variants are never stored" rule is narrowed in 4.2.
- **`deploy-and-durable-jobs.md`.** `work.kind` gains `sync`. One standing row per connection and lane, `ref_id = <connection id>:<lane>` (this fits its unique `(kind, ref_id)`); after a pass it is released uncounted with `not_before` set to the next poll, never `finished`. Step 12 lets a node claim a second kind (`lan`), which widens its §4.9 scope.
- **`accounts-and-developer-api.md`.** Steps 5 and later here depend on its Host and Origin guard and its launcher token (its steps 1 and 2 today). Its keyring step must carry the `credential` table and `secrets/vault.ts` with kind `channel` (today the vault file is listed under its step 16), plus a `bound_host` that is part of the sealed value's associated data (4.6). `isPerson` reads its `context.request`. `net/request.ts` is owned here. `inventory.set` over `/v1` follows the quantity rule above.

**Connector interface** (`sdk: 1`; first-party, in-process). The manifest is data: `id`, `version`, `label`, `group`, `transport: 'file' | 'http' | 'lan'` (`lan` connectors do not register when hosted), `hosts(config)` (the pinned destinations, 4.6), `dataUse: 'restricted'` (the only value this plan ships), `auth` descriptors with scopes per capability, a `config` zod schema drawn by the existing field renderer, static `targetFields`, `streams` (entity, pull, push, deletes, inventory `none | replace | cas`), `ownership` defaults, output profiles (each with `cells: 'spreadsheet' | 'machine'` and a `gated` flag, off by default) and rate hints.
```ts
interface Connector {
  manifest: ConnectorManifest
  render?(styles: CanonicalStyle[], mapping: Mapping, opts: RenderOpts): FileData[]  // pure, no ctx
  parse?(file: FileData): AsyncIterable<Remote>
  check?(ctx): Promise<Health>;  discover?(ctx): Promise<RemoteField[]>
  pull?(ctx, stream, cursor): AsyncIterable<{ records: Remote[]; next: Cursor; full: boolean }>
  fetch?(ctx, ref): Promise<Remote | null>   // null = gone
  plan?(desired, remote, memo): Step[]       // pure; apply, then re-plan, must be empty
  push?(ctx, step): Promise<StepResult>      // one effect per step.key
  verifyWebhook?(headers, rawBody, secret): Hint[] | null
  auth?: { begin; complete; revoke? }
  query?: { search; availability };  holds?: { place; extend; release; get }  // reserved: marketplace
}
```
Connectors throw only `ConnectorError { code, ref }` with `code` from a closed list of ours; the remote's own text goes to `remote.error` under `ref`.

**File formats** (versioned apart from our code; columns only appended inside a major; units in the header; empty means unknown, never zero)
- `pave.item-master/1`: `styles.csv`, `variants.csv` (columns as R21 §9.1 plus `hsn_code`), `bom.csv` (the 16 existing columns after `variant_id`), `stones.csv` (the existing columns after `variant_id`, **without** `sourcing_provider`, `sourcing_sku`, `sourcing_url`, plus `growth_method, treatment, lab, report_no`), `media.csv`, `units.csv` (one row per physical piece; header only until step 10), `items.json` (the same data nested; **the form a program should read**), `manifest.json` (schema id, generator, counts, control totals, `csv_cells`, SHA-256 per file). `style_id` is the piece id; `variant_id` is `<piece id>:<variant key>`, key `base` for the design as drawn.
- **What step 1 writes with no product record:** one `base` variant per piece with ids, SKU, title, kind as category, collection, metal, fineness, weights, stone counts and carats, BoM and stone lines. Price, currency, description, fulfilment, lead days and stone option stay empty. `media.csv` is header only and no pictures are exported: which pictures are Live, and where each came from, is publishing's rule (its step 2). Those columns fill when publishing steps 1 and 2 land; the format does not change. `est_cost` is empty whenever any rate was a placeholder.
- `pave.job/1`: `job.json` in the production zip: job id, quantity, size run, due date, expected metal per alloy with casting allowance, the stone schedule with its suppliers, casting-tree inputs.
- `own-columns/1` (the person's headers and order); `tally-masters/1` (`masters.xml`; `masters.json` for TallyPrime 7.0 and later).

**Entities.** `Piece.sku` (unique per org; shared with publishing §3). Stone quality gains optional `growthMethod`, `treatment`, `lab`, `reportNo`; stone origin gains `simulant`. `CommandDef` gains `dataUse?: 'restricted'` and `agentOutput?` (a second, smaller zod schema). `Capabilities` gains `integrations: string[]` and `lan`. `ServerEvent` gains `integration.updated { connectionId }` (no status: windows refetch).

**Commands.** Every `integrations.*` and `stock.*` command is `restricted`. A non-person gets `agentOutput` or, where none is declared, a refusal (4.11).

| Command | Input → output | Flags |
|---|---|---|
| `integrations.catalog`, `.describe {system}` | systems; what is sent, static target fields, config form | query, tool |
| `integrations.connect` | `{system, config, credentials?}` → `{connection}` | admin, person only, `secret: ['credentials']` |
| `integrations.update`, `.disconnect` | `{id, settings?, ownership?, paused?}`; the destination cannot change | admin, person only |
| `integrations.mapping.get / .propose / .confirm` | `{id}` → `Mapping`; `{id, version, doc}` | get, propose: tool; confirm: person only |
| `integrations.dryRun` | `{id \| system, scope}` → `{runId, digest, rows, totals, findings}`; agent: `{runId, digest, total, ourFindings}` | tool |
| `integrations.export` | `{system, profile, scope}` → `{runId}`; the asset arrives on the run | tool |
| `integrations.approve` | `{id, digest}` → one single-use approval, 10 minutes | admin, person only |
| `integrations.send` | `{id, digest}` → `{runId}`; needs an unused approval for that digest from the same session; 409 if a snapshot moved | admin |
| `integrations.runs` | `{id?}` → runs; agent: what Pavé sent, plus `needsPerson` | query, tool |
| `integrations.chips`, `.records`, `.browse`, `.review.list`, `.check` | per-piece status; remote values and listings; health | query, person only |
| `integrations.review.decide`, `.replay` | `{itemId, choice}`; `{stepId}` | person only |
| `stock.units.*`, `stock.reserve`, `stock.release`, `stock.setPolicy`, `stock.counterSale` | step 10 | person only |

**Tables.** Ordinary (all `org_id`, through `Repo`):
- `canonical_snapshot` (`piece_id`, `design_version`, `rates_version`, `product_rev`, `body`, `digest`), unique on those four keys.
- `connection`: `connector_id`, `connector_version`, `destination` (immutable), `settings`, `ownership`, `state`, `purge_after`. Its secret is a sister-plan `credential` row (kind `channel`, `ref_id` = connection id, `bound_host` = destination).
- `mapping` (unique `(connection_id, version)`); `sync_run` (`kind`, `status` including `interrupted`, `progress`, `totals`, `digest`, `asset_id`); `send_approval` (`connection_id`, `digest`, `approved_by`, `session_id`, `expires_at`, `used_at`).
- `sync_link`: unique `(connection_id, entity, entity_id)`; `state` (`pending | sent | failed`), `pushed_digest`, `attempts`, `error_code`, `sent_at`: only what Pavé itself did.
- `sync_outbox` (`connection_id`, `entity`, `entity_id`, `desired_digest`, `lane`, `state`); `sync_step` (unique `key`, `state`: `intent | done | failed | superseded | dead`).

Quarantined, in the Postgres schema `remote` (PGlite is real Postgres and has schemas [E]), with no accessor on `Repo`:
- `remote.link` (`external_id`, `external_version`, `seen_snapshot`, `status`: `in_sync | drifted | removed | blocked | unlinked`), `remote.event` (unique `(connection_id, dedupe_key)`, kept 30 days), `remote.error`, `remote.review_item` (`kind`: `drift | both_changed | structure | removed_there | second_order | relist | unknown_outcome`, `field`, `ours`, `theirs`, `state`).
- Step 10: `remote.stock_unit` (`piece_id`, `variant_key`, `tag_no` unique per org, `status`: `available | reserved | sold | unknown`, `sale_policy`, `checkout_connection_id`): only what the lock needs; actual weights, certificates, hallmark and memo wait for the job-record plan. `remote.reservation` (`stock_unit_id`, `holder`, `state`: `held | confirmed | released | expired`, `expires_at`, `idempotency_key`) with a **unique partial index on `stock_unit_id` where state is `held` or `confirmed`** and a unique `(org_id, idempotency_key)`. `remote.stock_movement` (append-only, unique `ref`).

## 4. Hard parts and decisions

### 4.1 One interface and one engine

**Decision:** one `Connector` interface and one engine, first-party and in-process. `SourcingProvider` (built), `ChannelProvider` (planned) and an ERP exporter differ only in which optional methods they have (R21 §4.1). All I/O is injected, so the same code later runs in the on-site agent. *Rejected:* three seams growing three engines; third-party connectors (customers' credentials inside our process; outsiders get the public API).

### 4.2 A stock unit, and what "variants are never stored" still means

**Position: add a stored stock unit, and keep the rule for what it protects.** Publishing §4.4 computes a variant's facts and cost from the design and rejects "a piece per variant". That stays. A stock unit is one physical, tagged piece: it cannot be computed, and overselling protection needs a row to lock (4.5). **It is cut to the lock:** id, piece, variant key, tag number, status, sale policy, checkout connection. The ERP report gates the tagged piece with actual weight and certificate on a cast piece landing within 5% of its quote and on a paying customer; that record is not this plan's, and where an ERP stays it owns those facts (4.3). Stored variants for imported styles are also out. *Rejected:* quantity 1 on a variant as the record (nothing to hold a reservation against); a piece per physical item.

### 4.3 The canonical piece, its snapshot, identity, and one owner per field

Style → variants → stock units, with metal lines, stone lines, media by content hash and certificates: the shape of `bom.csv`, `stones.csv` and the production manifest.

**Snapshot.** The canonical piece needs a kernel evaluation, and a kernel keeps one design at a time [V: repo, `engines/kernel/worker.ts`]; nothing is cached across pieces. So each piece's canonical body is stored once per (design version, rate-card version, product revision), computed on first need through the production engine's limit of one so designing stays smooth. Exports, digests, the `send` 409 check and the relay read it; none re-evaluates. A multi-piece export is a `sync_run` job in today's pattern: progress, `interrupted` after a restart, and a re-run that reuses finished snapshots.

**Identity.** Our ids never change. A piece with no SKU "cannot be sent"; exports never fall back to the piece id, as the production package does today. The SKU freezes at the first export or publish. A later rename is a person's action that raises one review item per connection, because Tally matches masters by name [V, R21] and a renamed SKU would make a second item. Where a system lets us set its item number we send the SKU; the remote's own number stays on `remote.link`.

| Field group | An ERP or POS stays (the usual case) | A sales channel |
|---|---|---|
| Identity, design, CAD, expected metal and stones, pictures, published or withdrawn | Pavé | Pavé |
| Title, description, tags | Pavé | Pavé, or the channel for a "pictures only" link |
| SKU string; price | The ERP if it assigns numbers or holds price lists; else Pavé | receives |
| Actual weight, certificate, hallmark id, actual cost | The ERP | never sent |
| Stock and sold status | **The ERP**; Pavé relays | never the owner; it reports sales as events |

The matrix is data on the connection. Pavé's change to a field it owns propagates. **A field the remote owns is never copied into Pavé's records:** Pavé stops sending it and shows the remote's value beside its own, to people only. A non-owner's change is *drift* in the review queue, never a silent overwrite. No last-write-wins by clock. A structural mismatch blocks that record only. **Never the books:** connectors write only an allowlist of master types (4.7), never a voucher, invoice, payment, ledger, opening balance, cost list or tax rate. Stock is read, never set, except on Shopify when the jeweler has made Pavé its owner.

### 4.4 Sync rules

1. **Outbox.** Rows say "this piece's desired state changed", not "apply this delta": five offline edits become one push. One push in flight per connection and entity. Content pushes come only from a state a person reviewed (publishing's digest); the only unattended pushes are stock-lane quantity writes on listings a person published.
2. **Step keys.** Key = hash of connection, entity, step kind, target, desired digest **and the remote version the plan was made against**. A retry re-plans; if either moved, the old step is `superseded` and a new key is made. So A → B → A is three effects, and a retry never sends a different body under an old key. Where the remote takes a key it is sent (Shopify inventory [V]); elsewhere the intent row goes first and an unknown outcome is settled by reading and adopting by SKU.
3. **Hints.** Dedupe a webhook on the platform's delivery id, a **polled** record on (stream, external id, remote version). Then coalesce, fetch, compare. Order does not matter and replay is safe [V, R21 §3.4].
4. **Gone.** `fetch` returning nothing for a record that had an external id marks it `removed` and raises "Removed there" (*Leave it removed* / *List it again*). A create is never planned for such a record unless a person chose to relist, so a full-replace upsert cannot bring a deleted product back. In a pulled list, absence means gone only after two full sweeps.
5. **Polling decides.** Every 60 s while the app is open, 15 min otherwise; a full sweep nightly and after more than an hour offline, before content pushes resume. **The stock lane is exempt:** zeroing other channels after a sale goes first, by compare-and-swap, or after one `fetch` of that listing where the channel has none.
6. **Visible state.** Four lanes per connection (stock, orders, content, backfill), rate budget reserved for the first. Five failures move a step to a dead list with *Try again*. After 48 hours without a good run a connection is stale and its stock reads "subject to confirmation".

### 4.5 Overselling a one-of-a-kind piece

**The ledger stops Pavé from giving one unit to two orders. It cannot stop two channels from each taking a paid order**; no platform promises that, and whether one channel can sell quantity 1 twice at once could not be verified (R21). So the default is **one checkout channel, "enquire" elsewhere**, and "Listed everywhere" needs hosting and the seller's written acceptance of the simulator's figures.

- **Reserve, in one transaction:** look up `(org, idempotency_key)` first, where the key is the channel's order-line id: a repeat of the same order returns the same row and is not a second order. On a unit conflict, if the holder is `held` past `expires_at`, expire it there and retry once; otherwise it is a second order. Order reservations are `confirmed` and do not expire; only a person's or the marketplace's hold is `held`.
- **Then:** push quantity 0 to every other channel (compare-and-swap from 1 where offered), and only then anything else. A second order tops the review queue and is never auto-accepted.
- **Cancel and refund:** the order's cancel or refund event releases the reservation and writes a reversing `stock_movement`. The unit goes back to `available`, but relisting waits for a person ("Back in stock? Relist"), because a refund is not a returned piece.
- **Counter sales:** "Sold at the counter" reserves the unit by hand and zeroes every channel.

The race is small only **if sales arrive independently** (about 0.002% inside 60 s for a piece that sells monthly [E]). A marketing post that drives every channel at once, a sleeping laptop and an unseen counter sale are the real risks; the simulator models them (section 5).

### 4.6 Who may send: the local server, the person gate, hosts and secrets

**The local server answers every caller as the owner today** and checks neither `Host` nor `Origin` [V: repo, `runtime.ts`, `app.ts`]; a `confirm` flag only pauses an assistant run. A rebinding web page or a local program could therefore press "Send to Tally" or use a stored connection.
- **Dependency.** No step that sends data out or stores a credential (step 5 onward) ships before the sister plan's Host and Origin guard and launcher token. File exports (steps 1 to 4) add no outbound path.
- **Person gate, on the server.** `isPerson(ctx)` is true only for `actor.type === 'user'` on a request that passed the guard with a studio session. Every other actor type, and any added later (MCP, API keys), is not a person by default. `integrations.send` needs a `send_approval` row for the same connection and digest, made by `integrations.approve`: person-only, single-use, gone in 10 minutes. The assistant can prepare a send; it cannot approve one. Tally has no relay: every post is one person's action.
- **Pinned hosts.** A stored secret must never be sent to a host an editable setting names. Each connector derives its destinations from validated config: Shopify must match `^[a-z0-9][a-z0-9-]*\.myshopify\.com$`; Tally must be a loopback or private IP literal and a port. The connection's HTTP client reaches nothing else. `destination` cannot be edited; a new one means connecting again and typing the secret again. The secret is sealed with `bound_host` as associated data, so it does not open for another host.
- **Secrets.** What is stored for Shopify is the app's Client secret; the 24-hour tokens it mints stay in memory [V, re-read]. Connectors get a `SecretHandle`, not a string; `credentials` is a `secret` command field; the browser gets the last four characters. Scopes are asked per capability: a one-way product push never asks for inventory or orders. The sister plan keeps the master key outside the data folder, so a copied data folder does not open these.
- **`lan` policy.** Loopback and private ranges only; link-local addresses, the server's own port and names that resolve to more than one address are refused; the address is pinned inside the lookup; `lan` connectors do not register when hosted.

### 4.7 Tally: a file, then a port with no password

- **Terms.** Tally's licence allows extensions "exclusively" through APIs it publishes, bars unapproved tools that evade licence limits, and grants no trademark rights [V, re-read: Terms of Use for TallyPrime, sections B, F, J; undated]. The file import and the XML and JSON port are in Tally's own integration help [V, R19], so both steps use published interfaces; counsel confirms.
- **Allowed masters, positively.** The renderer may emit only the envelope elements, `UNIT` (`NAME`, `ISSIMPLEUNIT`, `DECIMALPLACES`), `STOCKGROUP` (`NAME`, `PARENT`) and `STOCKITEM` (`NAME`, `PARENT`, `BASEUNITS`), under report `All Masters` [V]. A test parses every output, XML and JSON, and fails on any other element. Never: ledgers, account groups, vouchers, godowns, opening balance, rate or value, standard cost or price lists, tax rates. Tally overwrites a voucher on a repeated GUID [V, R19], one more reason.
- **Create only.** Whether an `Alter` with a partial master clears the fields it omits is unchecked, and Tally may match names ignoring case and spacing [E]. So v1 creates and never alters; the dry run folds case and spaces and blocks collisions; an item changed in Pavé after it was sent is a note for the bookkeeper. `Alter` is a gated profile, opened by a check on a real Tally.
- **Gated, off by default:** BoM, HSN and GST. They are not in Tally's reference; its advice is to export a hand-made sample [V]. An HSN **code** may ship as a mapped constant once the shop's accountant confirms it; a tax **rate** never does (the lab-grown rate is disputed [S, ERP report]).
- **Writing XML.** One writer builds from the allowlist, escapes every text node and attribute, and never uses CDATA. A value holding a character XML 1.0 cannot carry, or longer than the field allows, is "cannot be sent" in the dry run, never silently changed.
- **Reading replies.** A body containing `<!DOCTYPE` or `<!ENTITY` is refused before parsing; 5 MB and 30 s caps; one named parser (4.14). Everything read from Tally is untrusted text, shown as text, and stored only in `remote`.
- **The port has no authentication** [V, by absence]. Pavé does not open it, but this feature asks for it. So: same-computer (127.0.0.1) is the default; for another PC the sheet gives the firewall rule and the reminder to switch the server off; before **every** post Pavé reads the loaded company and refuses on a mismatch (`svCurrentCompany` is sent too [V]); `check` verifies the reply looks like Tally first, and the screen says that whatever answers on that address receives the item list. Tally has no dry run [E], so the plan is computed locally from what was read. A dropped connection does not say whether the write happened [V]: read back, then decide.
- **XML for every release; JSON only from TallyPrime 7.0** [V].

### 4.8 The Edge: gated on its licence

The ERP report called Edge's item import "a ready target". Two things are wrong with that. The wizard only updates existing items; new items enter through Receive Invoice → Import Invoice [V]. And The Edge's licence, last updated 23 July 2026, bars a store from integrating or interfacing other software with the product without written permission, bars scripts and data-extraction tools, bars making downloads available to third parties, treats non-public documentation as confidential, and excludes "unauthorized integrations" and data corrupted by third-party action from support [V, re-read: sections 3, 15, 16, 21]. It is silent on its own import feature and carves out what the law expressly permits. Whether a file a jeweler imports through Edge's own wizard is "interfacing" is for counsel.

**So:** no output named for The Edge ships, no customer is asked for the in-program template, and nothing implies Edge's approval, until the vendor gives written permission or counsel says the wizard route is not interfacing. Until then an Edge store has the two neutral files of steps 1 and 3 and matches columns in its own import screen, like any other system's user. Step E (section 7) holds the work: an update file from the published headers [V] and, with permission that covers the template, a new-items file. Edge's paid file exchange (EDT, $1,000 to $2,500 to activate [V]) is the sanctioned read path and is out. Edge takes no new stock from Shopify [V], so that is no back door. The options are decision 3.

### 4.9 Shopify: the first live connector, one way

- **API.** Admin GraphQL only; REST is legacy [V]. Pin a dated version (2026-10 today [V]). `productSet` keyed by our id, three options at most [V], facts as metafields, stone lines as metaobjects (never the sourcing columns).
- **Limits** [V]: 100, 200, 1,000 or 2,000 cost points a second by plan, 1,000 per query, 10 per mutation.
- **Distribution, and its cost to the customer.** A laptop cannot hold our app's secret, so the local route is **the merchant's own app with the client-credentials grant**: no fee, no review, but the developer task of section 1. The grant works only when app and store are in the same Shopify organisation, and tokens last 24 hours [V, re-read]. Which role or plan may create the app is not stated at source [V, re-read: silent]. **Step 9 opens by proving it on an ordinary store with a non-developer; if a normal merchant cannot do it, Shopify waits for hosting.** The alternatives need hosting: *custom distribution* (our app, one store or one Plus organisation, no review [V]) or a *public app* (review; $19 once; if paid, billing through Shopify at 0% of the first $1,000,000 then 15%, plus 2.9% processing; the 0% tier is lost above $20M App Store or $100M company revenue [V, re-read]; a further review for customer data; and the choice cannot be changed later [V]).
- **Protected customer data** [V]. One-way products asks for no order or customer scope. Two-way stock selects only order id, line SKU and quantity, never name, address, phone or email. Shopify "encourages" encryption at rest even for a merchant's own app [V, by the reviewer]; a local database is plain files, and the connect sheet says so.
- **Two-way stock** (step 11): `inventorySetQuantities` needs `changeFromQuantity` and an `@idempotent` key from 2026-04, and is meant for the system that owns stock [V].

### 4.10 Local-first limits

A local install listens on 127.0.0.1 and cannot receive webhooks. **It polls.** *Rejected:* tunnels (test-only in their vendors' words [V]; they expose the local server). **With hosting:** a relay queues webhooks for the local app to pull. It subscribes to ids-only topics or filtered fields and the app fetches the rest, so no customer name or address rests on our server; bodies are kept 72 hours [E]; the app verifies signatures itself. **The on-site agent exists only once Pavé is hosted.** It reuses the render-node protocol of `deploy-and-durable-jobs.md` §4.9: a signed Windows tray build, outbound HTTPS only, a closed list of operations (post to the configured Tally address; read and write one folder). The server sends data, never a command or SQL. Costs [E]: a code-signing certificate (a few hundred dollars a year) and one small always-on service; both need an owner (decision 8). *Rejected:* touching a desktop ERP's database.

### 4.11 Terms of service, and the wall around read-back data

| Source | Clause | Effect here |
|---|---|---|
| Shopify API terms, 7 Oct 2026 [V, re-read] | §2.3.24: no use of API-derived or merchant data, "anonymous, aggregate, or derived" included, to create, train or improve AI systems. Two exceptions (Shopify's or the merchant's consent) follow the clause's second limb; whether they reach the AI limb is unclear | The wall; counsel |
| | §6.2.8: no transfer of Shopify data, derived data included, to a third party unless needed for the app's service or authorised by the merchant or Shopify. §2.1.6: service providers need a protective agreement | A model provider is a third party: the wall; counsel |
| | §2.1.4: private credentials need the account owner's express authorisation | The connect sheet records who gave it |
| | §6.2.3: delete merchant data within 30 days of uninstall | `purge.ts` |
| | §2.3.8: no scraping or derivative works of merchant data; §2.3.12: no app mainly for moving merchants away; §2.3.14: request the least data; §6.2.10: breach notice in 24 hours | Field-level selects; read-back never flows to another system; an incident note |
| Xero terms, 4 Dec 2025 | 7(b)(i): API data may not train, fine-tune, adapt or enhance AI models, no exception [V, re-read]. Free to 5 connections, AUD 35 a month to 50; certification from AUD 245; a yearly security assessment from AUD 1,445 [V] | Not in the build order |
| QuickBooks | $0 to $4,500 a month by tier; reads metered; an assessment questionnaire [V, V2]. Terms did not render | Out until read |
| The Edge licence; Tally terms of use | 4.8 and 4.7 [V, re-read] | Step E is gated; Tally by published interfaces only |

**The wall is structural: read-back lives where the assistant's code cannot reach, and the mask is not what protects it.**
1. **Separate storage, deny by default.** Everything read from another system (records, versions, statuses derived from them, raw errors, review items, stock sold or reserved through a channel) lives only in the schema `remote`. `Repo`, through which every handler, the assistant's per-turn context builder (`assistant/turn.ts`, which bypasses the command pipeline [V: repo]), traces, recordings, feedback and `.pave` saves read, has no accessor for it. Two modules open it, `remote-store.ts` and `stock-store.ts`, and only an explicit allowlist may import them: `connectors/engine/*`, `handlers/integrations.ts`, `handlers/stock.ts`, `purge.ts`.
2. **Nothing is copied out by the engine.** A remote-owned field stays in `remote` (4.3). `sync_link` holds only what Pavé did. Errors cross as our closed codes; logs take structured fields from a fixed list, never the remote's text. Events say only "refetch". Audit rows of `integrations.*` carry ids, never values.
3. **Fail closed at the command pipeline.** A `restricted` command answers a non-person with its `agentOutput` schema, built from what Pavé authored (what was sent, our own findings, our mapping over static target fields) plus one flag, `needsPerson`. With no `agentOutput` it refuses. A forgotten field cannot leak, because nothing is passed by default. A registry test fails if any `integrations.*` or `stock.*` command is a tool without one.
4. **A person may adopt a value.** *Use theirs* is person-only and copies one value into the person's own record, with the notice in section 1. From then on it is the merchant's own data and an ordinary field. Counsel confirms that reading; a connector flag can turn adoption off.
5. **Out again.** Within 30 days of a disconnect or detected uninstall (at next start if the laptop was off), `purge.ts` drops that connection's `remote` rows and its credential. Adopted values and the files Pavé itself sent are the merchant's and Pavé's own and stay.

Even a count ("3 pieces changed") is "derived" on the strict reading, so until counsel answers the assistant is told only that something needs a person. A switch letting it read these values inside one request a person made ships off and hidden.

**For counsel:** Shopify §2.3.24 (does the merchant's consent reach the AI limb, and is a merchant running their own app on their own computer that consent, which would make the wall unnecessary on a local install?), §6.2.8 and §2.1.6 (is the person's own model key a "third party"?), §6.2.3 and adoption; partner agreement §9.15; Xero clauses 7 and 29; Intuit's terms in full; The Edge licence sections 3, 15, 16, 21; Tally's "published APIs"; whether a sale on one channel may drive an unlisting on another; whether reading a jeweler's desktop database with their consent breaches the vendor's licence.

### 4.12 Files a person opens, files a program reads, and what a file may claim

- **CSV cells.** The bug-sweep branch already stops a formula that starts with a minus sign and a digit (`claude/bugsweep-packages`, `c8d4ecf`). What remains: the guard's apostrophe is right for a spreadsheet and wrong for a program, where it becomes part of the name. So each output profile declares `cells`. `spreadsheet` (the item file's CSVs; "your own columns" by default): the apostrophe guard, recorded in the manifest. `machine` (chosen with "This file will be read by another program"): no apostrophe; a text cell that starts with `=`, `+`, `-`, `@`, tab or return and is not a plain number is "cannot be sent" in the dry run, with a fix that strips it. `items.json` needs neither and is what programs are told to read.
- **Attestation.** `integrations.export`, `.dryRun` and `.send` call `assertAttested`, as production and exports do today [V: repo]. A piece made from someone else's artwork is "cannot be sent" until a person confirms it.
- **Stone wording.** `stoneOrigin` returns `unspecified` when nobody said natural or laboratory-grown [V: repo]. Then: in data files `origin` is empty and the name reads "<material>, origin not stated"; in any generated text (a description, a web field) the piece is "cannot be sent". No file writes an unqualified "diamond" unless origin is declared natural, and none says "LGD".

### 4.13 Buy or build

**Build.** The first connectors are files and a LAN port that no unified API covers [E]; then Shopify, whose stock rules a unified layer hides; and a vendor key is ours, so it cannot live on a laptop. Prices seen 25 November [V, R21 §3.2]: Merge $650 a month past three linked accounts (no commerce or POS), Apideck $599 or $1,299, Unified.to from $750, Rutter by quote. Airbyte's connectors and Nango are Elastic License 2.0 and n8n is Sustainable Use [V]: none can ship in a proprietary laptop app. **What would change this:** three or more cloud accounting or POS back ends asked for in one quarter with Pavé hosted, or a customer on QuickBooks Desktop.

### 4.14 Unverified facts, costs and libraries

- **Out of the build order for lack of verified facts** (section 6): every accounting cloud (QuickBooks detail and terms, Xero item fields [E], Zoho's terms); the Indian jewellery packages (no API on any page opened; Ornate still [S]); Lightspeed R-Series [E].
- **Checked on a real Tally (step 6's pilot check) before "Send to Tally" is offered to any customer:** whether `Alter` clears omitted fields; how names are matched; whether the server listens on every interface; whether the port works in trial mode.
- **Costs** [E unless marked]: one Windows machine or VM and a Tally rental (₹750 a month [V]) for steps 4 and 6, with a named person to run it (decision 8); the Shopify route costs nothing; step 12's costs are in 4.10. **Total effort:** about 30 to 45 builder-weeks before review; steps 1 and 2 alone are about three weeks and give the item file with nothing else needed.
- **Libraries.** The sister plan's rule applies: a permissive licence checked at install and the founder's OK. Candidates [E, licences to confirm]: `fast-xml-parser` (MIT) for Tally's replies, with entity processing off; `fast-check` (MIT) for property tests. No spreadsheet reader and no JSON Schema library: the template in step E is pasted as a header row, and forms and validation use zod.

### Decisions that are the founder's

1. **Start gate.** Keep the ERP report's pilot gate ("at least 2 of 5 pilot buyers commit")? *Recommend: steps 1 and 2 on your word after your first test; steps 3 onward keep the gate.*
2. **Add the stock unit**, cut to the lock (4.2), with publishing's engine half built here and the quantity rule of section 3? *Recommend yes, at step 10.*
3. **The Edge.** (a) Ask the vendor for written permission or partner status; (b) take counsel's opinion on the wizard route; (c) drop The Edge from the build order; (d) ship only the neutral files a jeweler matches themselves. *Recommend (d) now, which steps 1 and 3 already deliver, with (a) and (b) in parallel; build step E only on a written yes. Edge's support may refuse help after any third-party import.*
4. **Accept the wall in 4.11:** the assistant reads nothing that came back from a customer's other systems until counsel answers? *Recommend yes.*
5. **One checkout channel as the default** for one-of-a-kind pieces, and an agreed ceiling of paid second orders per 10,000 before "Listed everywhere" is offered? *Recommend yes.*
6. **Shopify.** The merchant's own app now (free, but a ten-minute developer task per customer, unproven for ordinary merchants), or wait for hosting and an app of our own (one click; review, and the revenue share of 4.9 if public)? *Recommend the merchant's own app for pilots; decide again when hosting exists.*
7. **Stock read-back before a customer pays for it?** *Recommend no: stop after step 9 until one does.*
8. **Owners:** who runs the Tally test machine and confirms HSN with an accountant; later, who holds the signing certificate and runs the relay.

## 5. Verification

Each step's "done means" is a check a build machine can run with fakes; checks that need hardware, a licence or a customer are listed apart as founder or pilot checks.

- **Golden files, byte-exact,** for every export, on `packages/production/src/testing/fixtures.ts`, dates injected. Also: manifest hashes and control totals match the rows; `items.json` parses with its zod schema; the default profile of every connector omits every gated output.
- **Tally output:** the element allowlist over XML and JSON; a property test of the writer with `<`, `&`, `]]>`, quotes, control characters and 10,000-character names; case-and-space collisions blocked. **Tally replies:** an entity bomb and a 50 MB body are refused.
- **Cells and claims:** the OWASP formula strings through both cell modes of every profile; an unattested piece and an unspecified-origin stone are "cannot be sent"; no unqualified "diamond", no "LGD".
- **Conformance suite** every connector passes: a clean failure on bad credentials; `pull` resumable from any cursor; one effect per step key; A → B → A makes three effects; an empty re-plan after apply; a changed host with an unchanged credential is refused; `Retry-After` obeyed; no secret in any log line or fixture.
- **A fake per system, with its real quirks.** `fakeTally`: import counts, line errors, a wrong loaded company, a drop after the write; checked once against responses recorded from a real Tally. `fakeShopify`: cost throttling, full-replace `productSet`, a stale `changeFromQuantity`, duplicate and out-of-order events, delete-then-push, cancel and refund, a crash between any two steps. **Recordings:** headers kept by allowlist; every minted token registered with the recorder as it is parsed; the token endpoint never recorded; CI greps for token shapes, Shopify's prefixes included.
- **The gate:** `Host: evil.test` is refused on every `integrations.*` command; `send` without an approval, with a used one, or with another digest is refused; an agent or system actor cannot approve; a `lan` connector does not register when hosted; link-local, the server's own port and a two-address name are refused.
- **The wall.** An import-graph test: only the allowlist imports the two stores, and no module under `assistant/`, `traces.ts`, `pavefile/`, `render-feedback.ts`, `audit` or `http/events.ts` reaches `db/schema/remote.ts`. A reader walk: every tool command and the context builder run as an agent against a database seeded with canaries. The canary (in a fake Shopify order, product title and error text, and a fake Tally item) must appear in no assistant message, context message, tool result, trace, recording, `.pave` file, `activity.list` row, log line or other connector's export, across a poll, a dry run, a failed push, a second order and a purge. After *Use theirs* it appears only in the adopted field. A registry test for `agentOutput`.
- **Engine:** any reordering and duplication of inbound events ends in the same state; replaying the outbox changes nothing; the stock lane runs before a pending sweep. **Kill tests** (`PAVE_KILL_AT`): after the outbox write; after the remote call and before the result is stored; mid-backfill.
- **Overselling.** Engine properties: a repeated order line is one reservation; an overdue hold never causes a "second order"; every paid order is the confirmed holder or a review item, none lost, none auto-accepted; cancel releases and never relists by itself. The unique index is raced on real Postgres in CI (PGlite runs queries one at a time). **Simulator:** inputs are channels, a burst arrival model, a counter-sale rate, webhook delay and loss, poll interval and laptop sleep. It reports **paid second orders per 10,000 sales** per policy. "No unit has two confirmed reservations" stays only as a sanity check: it is true by construction. "Listed everywhere" is offered only under the ceiling of decision 5.
- **Benchmarks, both measured in step 2:** a cold export of 500 fixture pieces (no pass mark on time; interactive evaluation stays within 20% of its usual latency and progress shows) and a warm one (under 60 s [E]).
- **Screens:** every state in section 1, light and dark. A first-hour test: a non-developer connects a Shopify development store from the checklist alone.
- **Founder or pilot checks:** the item file opens cleanly in Excel and Numbers; `masters.xml` imports into a scratch Tally company with the dry run's counts, and "Send to Tally" twice adds nothing the second time; the four Tally questions of 4.14; a draft sent to a development store, edited there, shows "Changed there". **Cannot be verified here:** an Edge import; a customised Tally; webhook latency.

## 6. Scope cuts

| Out | Picked up when |
|---|---|
| Vouchers, invoices, payments, ledgers, opening stock, tax rates, metal ledgers | Never ("never build the books") |
| Any output named for The Edge; its EDT read path | Written permission, or counsel's yes (decision 3) |
| Tally `Alter`, BoM, HSN, GST | The real-Tally checks; an accountant's sign-off for HSN |
| QuickBooks, Xero, Zoho item push | Counsel has read the terms and three customers ask in one quarter |
| Valigara (documented API [V]), PIRO, Odoo, Business Central, NetSuite, SAP Business One, Lightspeed; named connectors for closed packages | A paying customer names it; the vendor offers an interface |
| Pictures in the item file; price and description columns | Publishing steps 1 and 2 |
| Actual weight, certificates, hallmark and memo on a stock unit; stored variants for imported styles; catalogue import | The job-record and catalogue-import plans |
| XLSX output | A customer's importer cannot take CSV |
| The marketplace client, its holds mirror and OAuth | The partner ships v1; tokens per the sister plan |
| Webhook relay, on-site agent, our own Shopify app, "Listed everywhere" | Hosting exists (durable-jobs steps 6 to 8) |
| `/v1`, API keys, outbound webhooks, feeds | The sister plan and publishing P1 |

## 7. Build order

Tests first in every step. Effort is one builder before review [E]: S about a week, M two to four weeks, L one to three months. A step touches the modules it names (paths in section 2), their tests, the schema and handler files of section 3, and one migration where it names tables. All steps build on the merged bug-sweep branches. Steps 1 to 4 need no hosting, credentials or vendor's permission.

1. **The Pavé item file for one piece.** *Delivers:* `packages/connectors` with `canonical.ts`, `totals.ts`, `words.ts`, the `render` half of the interface and `systems/item-file`; the kernel task `canonical` and `canonical_snapshot`; `Piece.sku` and the no-SKU rule; the cell modes in `csv.ts`; `integrations.export` for one piece, behind `assertAttested`; "Download item file" on a piece. *Also touches:* `packages/production/{package.json,src/csv.ts}`, `engines/kernel/protocol.ts`, `engines/production.ts`, `services.ts`, `compose.ts`. *Tests:* goldens for three fixture pieces, with and without a product record; totals; cells and claims; tenancy. *Done means:* a re-export is byte-identical and the columns of section 3 are filled or empty exactly as stated. **S to M.** Depends on the start gate only.
2. **A folder at a time, the job file, the dictionary.** *Delivers:* multi-piece export as a `sync_run` job with progress and `interrupted`; `job.json` (`pave.job/1`); the four stone fields and `simulant`; the column dictionary under `docs/formats/`. *Tests:* a killed run resumes from finished snapshots; the package golden updated once, on purpose; both benchmarks recorded. *Done means:* 500 fixture pieces export with the app usable throughout. **S.** Depends on 1.
3. **The Integrations page, matching, dry run, "your own columns".** *Delivers:* `/integrations` with the gallery, "What will be sent" and History; `mapping.ts` and the full `SetupSheet`; `integrations.catalog/describe/mapping.*/dryRun`; `systems/own-columns`; `connection`, `mapping`, `sync_link`; Settings retitled "Services". *Tests:* a mapping property test; dry-run findings and totals; screenshots. *Done means:* from a fixture mapping, a file in someone else's column layout is byte-stable, and every "cannot be sent" case shows its fix. **M.** Depends on 2.
4. **Tally masters as a file.** *Delivers:* `xml.ts`; `systems/tally/masters.ts` (XML, and JSON for 7.0 and later); the name-collision check; the "Not yet checked with Tally" state. *Tests:* goldens; the allowlist; the writer's property test; the gated profiles are off. *Done means:* `fakeTally` accepts the file with the counts the dry run predicted. *Pilot check, apart:* the same on a real Tally, recorded as fixtures. **S.** Depends on 3.
5. **Guarded sending.** *Delivers:* `net/request.ts` with both policies; `connectors/context.ts` with pinned hosts; `gate.ts`, `send_approval`, `integrations.connect/update/approve/send`; the schema `remote` with `remote-store.ts`; `agentOutput` and the fail-closed projection in `rpc/execute.ts`; `ConnectorError` and the structured logger; `purge.ts`; the generic fake end to end. *Tests:* the gate cases; the wall cases that need no real connector; `safe-fetch`'s own suite, widened. *Done means:* against the generic fake, nothing is sent without a person's approval and the canary test is green. **M.** Depends on 3 and the sister plan's guard and launcher-token steps.
6. **Send to Tally on the LAN.** *Delivers:* `systems/tally/lan.ts` (`check`, read companies and masters, `plan`, `push`, read-back); the Tally sheet with its pictures, "Find Tally on this computer" and the firewall rule; `fakeTally`. *Tests:* conformance; wrong company; drop after write; hostile replies. *Done means:* against `fakeTally`, a second send creates nothing. *Pilot check, apart:* the same on a real Tally, and the four questions of 4.14. **M.** Depends on 4 and 5.
7. **Engine, outbound.** *Delivers:* `sync_outbox`, `sync_step`, `keys.ts`, relay, lanes, bucket, the dead list, the Pieces tab. *Tests:* step keys; replay; kill tests. *Done means:* against `fakeShopify`, five queued edits make one push and a killed push has one effect. **M.** Depends on 5 and durable-jobs step 1.
8. **Engine, inbound.** *Delivers:* poller, hint dedupe, sweep with the stock-lane exemption, `reconcile.ts`, `remote.review_item`, "Needs your eye", *Use theirs* with its notice, "Removed there". *Tests:* reordering; delete-then-push; adoption and the full canary walk. *Done means:* against `fakeShopify`, an edit and a delete made "there" each raise the right item and nothing is overwritten or resurrected. **M.** Depends on 7.
9. **Shopify, one way.** *Opens with* the ordinary-merchant proof of 4.9. *Delivers:* client-credentials connect with the checklist and *Check*; link-and-pictures; `productSet` drafts with metafields and stone metaobjects. *Tests:* conformance; recordings from a development store; the first-hour test. *Done means:* a recorded draft round-trip replays green. *Founder check, apart:* the same by hand. **M.** Depends on 8, publishing steps 1 to 3, and the sister plan's keyring step with `credential` kind `channel` and `bound_host`.
10. **Stock units and the ledger.** *Delivers:* the three `remote` stock tables, `stock-store.ts`, `stock.*`, `SalePolicy`, `engine/reserve.ts`, `oversell-sim.ts`, `units.csv` filled. *Tests:* the overselling properties; the index race on real Postgres. *Done means:* the simulator's table exists for each policy. **M.** Depends on 8 and decision 2.
11. **Two-way stock on Shopify.** *Delivers:* order polling with field-level selects; `inventorySetQuantities` with compare-and-swap and its key; unlist-everywhere-first; cancel and refund; second-order and relist items. *Tests:* stale quantity; duplicate order lines; cancel; a kill between reserve and unlist. *Done means:* against `fakeShopify`, a sale reserves the unit and zeroes the other fake channel before any content sync, and a refund releases without relisting. **M.** Depends on 9, 10, decision 7 and counsel's reading (4.11).
12. **With hosting: the relay, then the on-site agent.** The ids-only webhook relay and the local pull; then the agent as a second work kind on the render-node protocol, hosting the Tally connector. *Tests:* conformance across the agent boundary; relay replay; no customer field at rest on the relay. *Done means:* against fakes, a hosted server posts to a Tally it cannot reach directly. **M + L.** Depends on durable-jobs steps 6 to 8 and decision 8.

**E. The Edge, gated (decision 3); any time after step 3 once the gate opens.** *Delivers:* an update file from the published headers (key by item number, or vendor and style; custom details, one category per file; `machine` cells; the import checklist) and, only with permission that covers the template, a new-items file in its columns with the photo folder. *Tests:* a header golden; the profile is `gated` and off by default. *Done means:* the golden passes; the tile reads "Not yet checked with The Edge" until a permitted customer import. **S + S.**
