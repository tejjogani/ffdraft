# 21 — Connectors, the sync engine and developer access

Research date: 2026-11-25. Scope: the architecture for connecting Pavé to other systems (ERPs, POS, accounting, sales channels, a partner stone marketplace, a supplier stock feed) and for letting outside developers read from Pavé: a connector SDK shape, a sync engine, credential storage, the limits of a local install, an on-site agent, testing, the first connectors, and Pavé's own public API, webhooks and file feeds. Builds on: the ERP report ([`reports/Jewelry and diamond ERP vertical.md`](./reports/Jewelry%20and%20diamond%20ERP%20vertical.md)), [`docs/strategy/catalog-import-and-store.md`](../strategy/catalog-import-and-store.md), [`docs/plans/publishing.md`](../plans/publishing.md), [`docs/plans/deploy-and-durable-jobs.md`](../plans/deploy-and-durable-jobs.md), [`docs/integrations/diaex-partner-api.md`](../integrations/diaex-partner-api.md), [`07-sourcing.md`](./07-sourcing.md), [`08-channels.md`](./08-channels.md). Topic 19 surveys each ERP, POS and accounting API; topic 20 covers accounts, OAuth and API keys. This file is the architecture and repeats neither.

**How to read the evidence.** `[V]` = I opened the page this session and the claim is on it; the link is beside it. `[V: repo]` = read in the repository (`/home/claude/pave-research`) or in the assistant build export (`ab:` prefix = `/home/claude/ref/assistant-build`). `[S]` = seen only in a search result or in earlier repo research, not opened. `[E]` = my estimate or working knowledge; I say what it rests on. Prices and limits were seen on 25 November 2026 and will change.

## 1. The short answer

- **Most of the foundation is already designed, and some is built.** The repo has a provider seam with a capabilities declaration and server-held credentials (`packages/sourcing`), a deterministic job package with a hashed manifest and two CSVs (`packages/production`), a command registry that can project a REST API, an append-only audit log, an idempotent usage ledger, and (on the assistant branch) per-organisation sealed secrets and a slot-claim pattern that is exactly a reservation. The publishing plan already names the tables a sync engine needs (`outbound_event`, `inbound_event`, `channel_task`, `stock_movement`, `listing_step`). **What is missing is one shared connector interface and one engine**: today sourcing, channels and (planned) ERP exports would each grow their own.
- **Build one connector interface, in-process, first-party only.** A connector is a pure TypeScript module with a manifest (capabilities, auth descriptor, streams, rate hints) and a handful of optional methods (`check`, `discover`, `pull`, `fetch`, `plan`, `push`, `render`, `parse`, `verifyWebhook`). All I/O goes through an injected context, so the same code runs in the server, in the on-site agent, and later in a sandbox. Do not adopt Airbyte, Singer, Nango or n8n as a runtime: their licences (ELv2, Sustainable Use) or their process model (Docker, Python) do not fit a proprietary app on a laptop. Copy their ideas: a declared spec, cursors as opaque state, discover before read.
- **Do not buy a unified API now.** None of the first four connectors (files, Tally XML, The Edge files, Shopify) is something Merge, Apideck, Unified.to or Rutter makes easier; entry prices are $599–$750 a month [V]; all need a hosted backend to hold the vendor key; and they sit between a jeweler's catalogue and us. Revisit only if three or more cloud accounting or POS systems are demanded at once.
- **The sync engine has five rules.** (1) One owner per field, written down in a matrix; the non-owner's edits become "drift" in a review queue, never a silent overwrite. (2) Every outbound change is an outbox row written in the same transaction as the change, sent at least once with an idempotency key. (3) Every inbound event is a hint: dedupe on its delivery id, then fetch the current state and compare versions. Shopify, Stripe, Square and Etsy all say or imply this [V]. (4) Cursors plus a periodic full sweep; a missing row means "gone" only in a full list. (5) Per-record sync status, dead letters and replay, visible to a person.
- **One-of-a-kind pieces need a reservation ledger, not faster sync.** One holder per stock unit, decided by a unique index, with holds that expire. On the first order event from any channel: reserve, set every other channel to zero (compare-and-swap where the channel offers it), and only then sync anything else. The race window is the webhook delay when hosted and the poll interval when local. No marketplace guarantees anything across channels. For a unique piece the safe default is one checkout channel and "enquire" everywhere else.
- **A local install cannot receive webhooks, and that is acceptable.** It polls. Tunnels are for testing only (Cloudflare says so, and caps Quick Tunnels at 200 in-flight requests with no uptime guarantee [V]). A hosted relay that queues webhooks for the local app to pull is the right later step. A local install has one advantage: it is already on the shop's network, so it can post to Tally on the LAN with no extra program.
- **The on-site agent is only needed once Pavé is hosted.** Then it is a small signed Windows tray program that makes outbound HTTPS connections only, claims jobs by long poll, and talks to Tally (port 9000) or a watch folder locally. This is the QuickBooks Web Connector model, the BI gateway model, and the model Tally itself published as a reference architecture in September 2026 [V]. Pavé's planned render node already has the same protocol (pairing code, hashed token, claim, heartbeat, lease epoch) [V: repo].
- **The connector order in the ERP report holds, with three corrections.** (a) CSV and JSON item-master and job-package export first: confirmed. (b) Tally XML: file first, then HTTP post; confirmed. (c) **The Edge's "Item Data Import" wizard only updates existing items; it cannot create them [V].** New items enter The Edge through "Receive Invoice → Import Invoice", a CSV or Excel file whose columns the user maps on screen, with a blank template downloadable inside the program [V]. So the Edge target is two files, and the exact template headers need a customer's copy. (d) Shopify products one-way, then (e) two-way stock: confirmed, using `changeFromQuantity` and the `@idempotent` key, both required from API version 2026-04 [V].
- **Pavé's own API: REST under `/v1`, generated from the command registry, with a polled events feed as the record and Standard Webhooks as the hint.** Thin payloads by default (ids and a resource link), so what a key may see is decided at read time. File feeds start as an HTTPS manifest with checksums and immutable image URLs; SFTP ($216 a month per endpoint on AWS [V]) waits for a named partner who cannot do HTTPS.

## 2. What exists today that this builds on

### 2.1 Built

| What | Where [V: repo] | Why it matters here |
|---|---|---|
| A provider seam: `capabilities()`, optional methods, a `noSourcing` null provider, `ctx.connection` as opaque server-held credentials | `packages/sourcing/src/provider.ts:10-56` | The shape a connector interface should generalise. `publishing.md` §2 says `packages/channels` will "mirror" this file |
| Stone requirement rows computed from a design | `packages/sourcing/src/requirements.ts:18-37,67-105` | The canonical stone line; already mapped to the partner API in the contract §8 |
| The job package: spec sheet PDF, drawings, CAD files, `bom.csv` (16 columns), `stones.csv` (24 columns), `cost-estimate.json`, `dfm-report.json`, `rfq-email.md`, and `manifest.json` with schema id `pave.production-package/1`, per-file SHA-256, per-part weights, metals per alloy with order grams and fine grams, stone lots, rate provenance | `packages/production/src/bundle.ts:52-169`, `manifest.ts:15-104`, `bom.ts:252-269,351-376` | This is the "job package". It is deterministic (no clocks), so it can be a golden file. Its manifest comment already names "an ERP" as a reader |
| A CSV writer that Excel opens cleanly: UTF-8 with BOM, CRLF, RFC 4180 quoting, a guard against spreadsheet formula injection | `packages/production/src/csv.ts` | Every file connector should use it. It is not exported from the package yet (`publishing.md` §2 notes this) |
| The command registry: each command has a zod input and output, a role, a kind, and a `tool` flag; one pipeline does role check, validation, handler, audit | `packages/schema/src/api/commands.ts`, `apps/server/src/rpc/execute.ts:21-55` | The public API can be projected from it (`publishing.md` §3 adds a `rest` field) |
| An append-only audit log for every mutation, and an append-only design op log with a unique `(piece, seq)` | `apps/server/src/audit.ts`, `db/schema/domain.ts:109-133` | The "unbroken change history" the ERP report asks for; also the source for outbox rows |
| An idempotent ledger: `usage_event` has a unique `(org, idempotency_key)` and `insertIfAbsent` | `apps/server/src/usage.ts:26-40`, `db/schema/domain.ts:521-539` | The exact pattern for inbound-event dedupe and outbound effect keys |
| Job rows with sticky terminal states, and boot recovery | `apps/server/src/jobs.ts:22-64`, `recovery.ts` | A sync run is a job of the same kind |
| Content-addressed blob store; tenancy by a scoped repository that cannot skip the org filter | `apps/server/src/assets/blob-store.ts`, `repo/scoped.ts:7-12` | Media by hash gives immutable image URLs; connectors never see another org |
| Database: embedded PGlite locally, Postgres when `DATABASE_URL` is set, same schema | `apps/server/src/db/client.ts:27-45` | The queue tables are Postgres tables in both modes (see §5.9) |
| Local mode listens on 127.0.0.1 only; `publicUrl` defaults to `http://localhost` | `apps/server/src/config.ts:57-65` | The reason a local install cannot receive webhooks |
| In-process event bus and SSE stream | `apps/server/src/events.ts`, `http/events.ts` | Not durable and not cross-process: it cannot be the outbox |

On the assistant build branch (newer) [V: repo, `ab:`]:

| What | Where | Why it matters here |
|---|---|---|
| Per-organisation secret sealed with AES-256-GCM, org id bound as associated data, key derived from a secret kept outside the database, only the last four characters ever returned | `ab:apps/server/src/assistant/keys.ts:1-104`, `runtime.ts:110` (`deriveKey(purpose)`) | The credential vault for connectors, already written once |
| `secret` field list on a command so those inputs never reach the audit log | `ab:packages/schema/src/api/commands.ts:81-82` | Connector credentials entered through commands stay out of logs |
| Plan claims: a claim takes the lowest free slot under a unique index, has an idempotency key, and is `held`, `used` or `released`, with a stale sweep | `ab:apps/server/src/plans.ts:1-70` | This is a reservation with expiry. The one-of-a-kind hold in §5.8 is the same code shape |
| A fetch that refuses private addresses, checks the address inside the DNS lookup, re-checks every redirect, caps time and size | `ab:apps/server/src/net/safe-fetch.ts:1-70` | The HTTP client every connector and the webhook sender must use |
| A strict fake of an outside API plus recorded runs used as replay tests | `ab:packages/agent/src/testing/fake-api`, `ab:apps/server/src/assistant/fixtures/recordings` | The testing pattern for connectors (§8) |
| An `/mcp` route | `ab:apps/server/src/app.ts:32` | Already a developer surface over the command registry |

### 2.2 Designed, not built

- **`docs/plans/publishing.md`**: `packages/channels` with `ChannelProvider` and capabilities (`inventory: 'none'|'replace'|'cas'`, `orders: 'none'|'poll'|'webhook'`, `auth`, `mediaIngest`); a pure `planSync(desired, remote, memo, caps)`; tables `channel_connection` (`credentials_enc`, `key_version`, `refreshing_until`), `listing_step`, `stock_movement` (append-only, unique `ref`), `channel_task`, `outbound_event`, `webhook_endpoint`, `webhook_delivery`, `inbound_event`; `/v1` derived from commands; OpenAPI from zod; Standard Webhooks; `fakeChannel` and cassettes; and the rule that a one-of-a-kind sale zeroes other channels before any content sync (§4.6).
- **`docs/plans/deploy-and-durable-jobs.md`**: one `work` table with leases, a `lease_epoch` fencing token, a separate `failures` counter, checkpoints, `parked` state; a render node that pairs with a code, stores a hashed token, long-polls `POST /claim`, heartbeats, and is refused with `409 stale-epoch` (§3, §4.1, §4.9). The note that PGlite runs queries one at a time (§4.1) matters for queues.
- **`docs/integrations/diaex-partner-api.md`**: OAuth with PKCE and a loopback redirect for a local install, a pasted token as the fallback, `Idempotency-Key` on every write, a polled events feed with a cursor because the local app has no public address (§5.11), optional signed webhooks for hosted, holds with expiry, a daily quota on priced stones, and "never mirror the catalogue".

### 2.3 Not there at all

No `packages/channels`, no connector code, no outbox, no durable queue, no product record, no `sku` column on a piece (the job package falls back to the piece id, `packages/production/src/context.ts:130`), no stock unit, no public route, no hosted service.

## 3. Prior art

### 3.1 Connector frameworks

| System | Shape | Licence | What to take | What not to take |
|---|---|---|---|---|
| Airbyte | A connector answers `spec`, `check`, `discover`, `read` (sources) or `write` (destinations) and emits typed messages (`RECORD`, `STATE`, `LOG`, `SPEC`, `CONNECTION_STATUS`, `CATALOG`, `TRACE`). State is a checkpoint the platform treats as a black box; a state is reused only if the destination committed the data before it. Sync modes: `full_refresh`, `incremental`; destination modes `append`, `append_dedup`, `overwrite` [V [protocol](https://docs.airbyte.com/platform/understanding-airbyte/airbyte-protocol)]. A low-code layer describes REST sources in a YAML manifest (requester, paginator, record selector, incremental sync, error handler with backoff) [V [low-code overview](https://docs.airbyte.com/platform/connector-development/config-based/low-code-cdk-overview)] | Protocol: MIT. Connectors and everything else in the public repos: Elastic License 2.0 [V [licences](https://docs.airbyte.com/platform/developer-guides/licenses/)]. The Python CDK repository: MIT [V [repo](https://github.com/airbytehq/airbyte-python-cdk)] | The five verbs; "state is opaque and only advances after commit"; a declared config spec that renders a form; a declarative layer for plain REST sources | Running it: connectors are Python in Docker [E], it is one-way extract-and-load (no push with business rules, no holds), and ELv2 connectors could not ship inside a proprietary desktop app without legal review |
| Singer | A tap writes `SCHEMA`, `RECORD` and `STATE` lines to stdout; a target reads them; `--discover` prints a catalog; bookmarks per stream; replication methods `FULL_TABLE`, `INCREMENTAL`, `LOG_BASED` [V [spec](https://hub.meltano.com/singer/spec/)] | Spec is open; each tap has its own licence [E] | The idea that a connector is a process speaking JSON lines: the cheapest sandbox there is | Python runtime; no write-back; uneven tap quality [E] |
| Meltano | Runs Singer taps and targets, declared in code; MIT [V [repo](https://github.com/meltano/meltano)] | MIT | Nothing to embed | Python |
| Fivetran Connector SDK | A Python `connector.py` deployed to Fivetran's cloud; upserts, soft deletes, incremental state; no webhooks; billed by monthly active rows [V [overview](https://fivetran.com/docs/connector-sdk)]. The functions are named `schema` and `update`, with a checkpoint operation [E: working knowledge; the reference landing page did not list them] | Proprietary service | "Checkpoint explicitly" as an operation | A hosted warehouse loader; wrong problem |

### 3.2 Buying instead of building

| Vendor | Covers (relevant) | Price seen 25 Nov 2026 | Fits Pavé? |
|---|---|---|---|
| Merge | Accounting, ATS, CRM, file storage, HR, ticketing. No commerce or POS category on the pricing page | 3 production linked accounts free; then $650 a month up to 10, $65 each beyond [V [pricing](https://www.merge.dev/pricing)] | No: no commerce, and accounting is "the books" |
| Apideck | Accounting, CRM, HRIS, ATS, file storage, ERP, ecommerce, issue tracking (12 claimed); no POS named on the page | Launch $599 a month for 25 consumers and one category; Scale $1,299 for 100 consumers and three categories [V [pricing](https://www.apideck.com/pricing)] | Only for a long tail of cloud stores, later |
| Unified.to | Accounting (391 integrations claimed), e-commerce (320), payments, shipping; billed by API request, unlimited connections | Grow $750+ a month for 750,000 requests; Pro $1,500+; Scale $3,000+ [V [pricing](https://unified.to/pricing)] | Same |
| Rutter | Accounting (QuickBooks Online and Desktop, Xero, NetSuite, Sage Intacct…), commerce (Shopify, WooCommerce, Etsy, Amazon, eBay…), payments (Stripe, Square…). Lightspeed not listed | Quote only; a 30-day sandbox plan [V [pricing](https://www.rutter.com/pricing)] | Closest fit for QuickBooks Desktop; quote only |
| Codat | Not opened (the page failed to load). Accounting and commerce data for lenders [E] | Unknown | Unverified |

**Verdict: build, for now.** Reasons: (1) the first connectors are files, Tally XML and The Edge files, which none of these cover [E from the category lists above; no vendor page I opened names Tally or The Edge]; (2) the fourth is Shopify, which the publishing plan already designs in detail and whose stock rules (compare-and-swap, idempotent key) are exactly the part a unified layer hides; (3) a unified API key is ours, not the customer's, so it cannot live in a local install; (4) a third party would hold jewelers' catalogue data and tokens; (5) at $599–$750 a month the fixed cost exceeds what a first handful of customers would pay for integrations [E]. Reopen when three or more cloud accounting or POS back ends are requested in the same quarter.

### 3.3 Embedded integration platforms and automation tools

| Tool | Open source? | Notes |
|---|---|---|
| Nango | Source-available under Elastic License 2.0: may not be offered to others as a hosted or managed service; licence-key features may not be circumvented [V [LICENSE](https://github.com/NangoHQ/nango/blob/master/LICENSE)]. Cloud: free tier with 10 connections; $50 a month pay-as-you-go; $0.29 per connection a month; self-hosting listed under Enterprise [V [pricing](https://www.nango.dev/pricing)] | Useful mainly as an OAuth token broker for a hosted Pavé. It is a separate service, so it cannot be part of a local install |
| Paragon | Closed; quote only; priced by connected tenants; self-hosting on Enterprise [V [pricing](https://www.useparagon.com/pricing)] | Too heavy for four connectors |
| Prismatic | Closed; platform fee plus active instances (one integration for one customer = one instance); an on-prem agent only on Enterprise and Custom [V [pricing](https://prismatic.io/pricing/)] | The on-prem agent is the interesting precedent |
| Workato Embedded, Tray Embedded | Not opened for pricing; both quote-only [E] | Workato's on-prem agent is a strong precedent (§7) |
| n8n | Not open source. Sustainable Use License: use and modify only for your own internal business purposes or non-commercial use; distribution only free of charge for non-commercial purposes; `.ee` files under a separate enterprise licence [V [LICENSE.md](https://github.com/n8n-io/n8n/blob/master/LICENSE.md)] | **Cannot be embedded in or shipped with Pavé** without a commercial embed agreement [E reading of the licence]. A customer may run their own n8n against our API |
| Zapier, Make | Hosted services. A Zapier integration needs either a list endpoint that returns newest items first (polled every 1–15 minutes, deduplicated by Zapier) or REST hooks: a subscription API plus webhook delivery [V [Zapier triggers](https://docs.zapier.com/platform/build/trigger)]. Make: not opened [E] | **A cheap first surface, but only on top of a hosted public API.** It costs us an app definition, not an engine. Design `/v1` so it qualifies: newest-first lists and webhook subscription CRUD |

### 3.4 What the platforms say about sync

| Source | Guidance | Evidence |
|---|---|---|
| Shopify webhooks | Delivery is not guaranteed; run reconciliation jobs that fetch by `updated_at`. No ordering guarantee within or across topics; sort by `X-Shopify-Triggered-At` or the payload's `updated_at`. Respond within 5 seconds; up to 8 retries over 4 hours; a failing subscription is removed. Dedupe deliveries on `X-Shopify-Webhook-Id`; `X-Shopify-Event-Id` groups deliveries of one merchant action and is for correlation | [V [best practices](https://shopify.dev/docs/apps/build/webhooks/best-practices)], [V [troubleshooting](https://shopify.dev/docs/apps/build/webhooks/troubleshooting-webhooks)], [V [duplicates](https://shopify.dev/docs/apps/build/webhooks/ignore-duplicates)] |
| Shopify inventory | States: `available`, `committed`, `reserved`, `damaged`, `safety_stock`, `quality_control`, `incoming`; `on_hand` is their sum. Apps cannot change `committed`. `inventorySetQuantities` takes `changeFromQuantity` (compare-and-swap; a mismatch fails with `CHANGE_FROM_QUANTITY_STALE`; `null` opts out and is advised only when you are the source of truth). The `@idempotent(key:)` directive is required for inventory mutations from 2026-04. `referenceDocumentUri` records which system made a change | [V [inventory apps](https://shopify.dev/docs/apps/build/orders-fulfillment/inventory-management-apps)], [V [quantities](https://shopify.dev/docs/apps/build/orders-fulfillment/inventory-management-apps/manage-quantities-states)] |
| Shopify versioning | A dated version every quarter; each supported at least 12 months with 9 months of overlap; requests to a retired version "fall forward" to the oldest supported one | [V [versioning](https://shopify.dev/docs/api/usage/versioning)] |
| Stripe webhooks | Signature header carries a timestamp and an HMAC-SHA256 over `timestamp.body`; default tolerance 5 minutes; no ordering guarantee; duplicates happen, so log event ids; return 2xx before doing work; retries for up to three days; two secrets valid during a roll. "Thin" events (ids only, then fetch the object) are now the recommended payload | [V [webhooks](https://docs.stripe.com/webhooks)] |
| Stripe idempotency | `Idempotency-Key` on POST, up to 255 characters; the first status and body are saved once execution begins and replayed, including 500s; keys may be pruned after 24 hours; different parameters with the same key are an error | [V [idempotent requests](https://docs.stripe.com/api/idempotent_requests)] |
| IETF | The `Idempotency-Key` header is still an Internet-Draft (draft-09, updated 21 Nov 2026): 400 when a required key is missing, 409 while the first request is in flight, 422 when a key is reused with a different payload | [V [draft](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/)] |
| Square | Inventory is movement between states (`IN_STOCK`, `SOLD`, `WASTE`…) per item variation and per location; a count is computed from adjustments since the last physical count, and a physical count overrides it. Webhooks may arrive more than once and in any order; `event_id` is the dedupe value; retries for 24 hours; an Events API exists to recover and reconcile missed notifications | [V [inventory](https://developer.squareup.com/docs/inventory-api/what-it-does)], [V [webhooks](https://developer.squareup.com/docs/webhooks/overview)], [V [inventory events](https://developer.squareup.com/docs/inventory-api/webhooks)] |
| Etsy | 11 webhook events (order paid, canceled, shipped, delivered; listing created, updated, deleted; inventory created, updated, deleted, out of stock), for commercial and personal apps; Standard Webhooks signing; **thin payloads with a `resource_url` to fetch** | [V [Etsy webhooks](https://developers.etsy.com/documentation/essentials/webhooks)] |
| eBay | With out-of-stock control on, a fixed-price listing at quantity 0 stays alive but hidden from search until restocked | [V [out-of-stock](https://developer.ebay.com/api-docs/user-guides/static/trading-user-guide/out-of-stock.html)] |
| Lightspeed Retail | Not opened (robots refused). Items with per-shop quantity on hand and a leaky-bucket rate limit [E: working knowledge] | Unverified |
| Transactional outbox | Write the message to an outbox table in the same transaction as the business change; a relay publishes it, by polling the table or tailing the log; delivery is at least once, so consumers must be idempotent | [V [microservices.io](https://microservices.io/patterns/data/transactional-outbox.html)] |
| Change data capture | Debezium's outbox router reads only the outbox table and routes by `aggregatetype`, keys by `aggregateid`, and carries the event `id` for consumer dedupe | [V [Debezium](https://debezium.io/documentation/reference/stable/transformations/outbox-event-router.html)] |
| Standard Webhooks | Headers `webhook-id`, `webhook-timestamp`, `webhook-signature`; `v1` = HMAC-SHA256 over `id.timestamp.body`, `v1a` = ed25519; `whsec_` secrets; payload `type`, `timestamp`, `data`; thin or full payloads; retries over about 75 hours; `410` disables an endpoint; send through an egress proxy that blocks internal addresses | [V [spec](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md)] |
| RFC 9457 | `application/problem+json` with `type`, `title`, `status`, `detail`, `instance` and extension members; obsoletes RFC 7807 | [V [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html)] |

**What this adds up to.** Four independent platforms (Shopify, Stripe, Square, Etsy) converge on the same receiver design: verify, dedupe by delivery id, do not trust order, fetch current state, and reconcile on a timer. CDC by log tailing is the right relay at scale; for a single embedded database a polling relay over the outbox table is enough, and log tailing is not available on PGlite anyway [E: PGlite is one in-process connection; `deploy-and-durable-jobs.md` §4.1 rejects LISTEN/NOTIFY for the same reason].

## 4. A connector SDK shape

### 4.1 One interface, not three

`SourcingProvider` (built), `ChannelProvider` (planned) and an ERP exporter are the same thing with different capabilities. One interface with optional methods and a declared manifest covers all three, and the engine reads the manifest to decide what it may ask.

```ts
// Illustrative only. Research, not product code.
export interface ConnectorManifest {
  id: string                       // 'csv-item-master' | 'tally-xml' | 'edge-file' | 'shopify' | …
  version: string                  // semver of this connector
  sdk: 1                           // major of the interface it implements
  label: string
  transport: 'file' | 'http' | 'lan'   // 'lan' runs only in a local install or the on-site agent
  auth: AuthDescriptor[]           // [] for file connectors
  config: JsonSchema               // non-secret settings; rendered as a form
  streams: StreamDecl[]
  limits?: { perMinute?: number; perDay?: number; burst?: number; quota?: string } // hints; 429 still rules
}
type AuthDescriptor =
  | { kind: 'oauth2'; pkce: boolean; needsClientSecret: boolean; scopes: Record<Capability, string[]> }
  | { kind: 'apiKey'; fields: { name: string; label: string }[] }
  | { kind: 'paired-agent' }                      // credentials live on the agent, never on the server
interface StreamDecl {
  entity: 'style' | 'variant' | 'stockUnit' | 'media' | 'order' | 'stone' | 'voucher'
  pull?: 'full' | 'incremental'
  push?: 'create' | 'upsert' | 'replace'          // 'replace' = full-replace APIs (Shopify productSet, Etsy inventory)
  deletes: 'none' | 'tombstone' | 'absent-from-full-list'
  inventory?: 'none' | 'replace' | 'cas'
  hints?: string[]                                // webhook topics this stream can be nudged by
}
export interface Connector {
  manifest: ConnectorManifest
  check(ctx: Ctx): Promise<{ ok: boolean; account?: string; problems: Finding[] }>
  discover?(ctx: Ctx): Promise<RemoteField[]>                         // remote fields, for the mapping screen
  pull?(ctx: Ctx, stream: string, cursor: Cursor | null): AsyncIterable<{ records: Remote[]; next: Cursor; full: boolean }>
  fetch?(ctx: Ctx, ref: ExternalRef): Promise<Remote | null>          // "polling decides"
  plan?(desired: Canonical, remote: Remote | null, memo: Memo): Step[] // pure; apply-then-replan must be empty
  push?(ctx: Ctx, step: Step): Promise<{ externalIds: Record<string, string>; fingerprint: string }> // idempotent per step.key
  render?(desired: Canonical[], opts: unknown): FileData[]            // file export; no credentials
  parse?(file: FileData): AsyncIterable<Remote>                       // file import
  verifyWebhook?(headers: Headers, rawBody: Uint8Array, secret: string): Hint[] | null // null = bad signature
  auth?: { begin(ctx): AuthStart; complete(ctx, callback): Secrets; refresh(ctx): Secrets; revoke?(ctx): void }
}
interface Hint { dedupeKey: string; stream: string; ref: ExternalRef; occurredAt?: string }
interface Ctx {                     // everything a connector may touch
  http: SafeHttp                    // rate-limited, SSRF-guarded, retry-after aware, recordable
  connection: { id: string; config: unknown; secrets: SecretHandle } // server-held; never serialised
  log: RedactingLogger; now(): Date; signal: AbortSignal
}
```

Design notes:

- **Capabilities are data.** The engine never branches on a connector id. `publishing.md` already takes this line for platform rules.
- **`fetch` is separate from `pull`.** `pull` walks a stream with a cursor; `fetch` reads one record now. Webhook handling needs only `verifyWebhook` and `fetch`.
- **`plan` is pure and `push` executes one keyed step.** This is the publishing plan's `planSync` and `listing_step`. It gives resumability and a property test for free: apply, re-plan, expect nothing.
- **`render` and `parse` make file connectors first-class**, with no credentials and no network. The first three connectors use only these.
- **No ambient I/O.** A connector may not import `fetch`, `fs` or `process`. That single rule is what makes later sandboxing possible and makes cassette recording automatic.
- **Cursors are opaque to the engine** and advance only after the page's records are committed (Airbyte's rule).

### 4.2 Manifest and versioning

- Connector `version` is semver. A major bump means stored cursors or mappings need a migration, which the connector supplies as a function.
- `sdk` is the interface major. The engine supports the current and previous major.
- Each connection row stores the connector version that last ran, so a failed upgrade can be diagnosed.
- File connectors also version their **output schema** separately (for example `pave.item-master/1`), because outside developers depend on it for longer than on our code (§9.1).

### 4.3 Field mapping a non-developer can configure

A mapping is a JSON document per connection: for each canonical field, a source (a remote column or field from `discover`, or a constant) and at most one transform from a closed list: trim, change case, unit conversion (grams, pennyweight, carats, millimetres), a lookup table (`14K` / `585` / `58.5` → alloy), split or join with a template, number format, date format. No scripts.

Flow: the assistant proposes a mapping with a confidence per field; a person confirms each low-confidence field; a **dry run** writes nothing and shows per-row results plus control totals (rows, stone count, carats, grams per purity), as the ERP report requires; the confirmed mapping is saved, versioned, and reused on every later run. The ERP report's planning figure is that 85–95 % of columns map automatically and a person still confirms weight, price and memo fields [E in the report]. For The Edge the customer maps columns again inside The Edge's own import screen [V §9.3], so our headers only need to be readable.

### 4.4 Testing and certifying a connector

Every connector ships with: a fake of its remote system, recorded fixtures, golden files for anything it renders, and a pass of one shared **conformance suite** that the engine runs against any connector: `check` fails cleanly on bad credentials; `pull` resumes from any emitted cursor without loss or duplicates; `push` with the same step key twice has one effect; apply-then-replan is empty; `verifyWebhook` rejects a tampered body and an old timestamp; no secret appears in any log line or fixture; a 429 with `Retry-After` is obeyed. "Certified" means the suite is green in CI and, where a vendor sandbox exists, the contract tests in §8 ran this week.

### 4.5 In-process or sandboxed; first-party or third-party

| Option | Isolation | Cost | When |
|---|---|---|---|
| In-process TypeScript module | None beyond the injected context and code review | Lowest; shares types | **Now. First-party only** |
| Separate process speaking JSON lines (the Singer and Airbyte shape) | Operating-system process; can be killed, time-boxed, memory-capped | A protocol to maintain; the on-site agent needs this boundary anyway | When the agent ships: the agent is this |
| WebAssembly plug-in. Extism is BSD-3-Clause, has a JavaScript host SDK for Node, and offers host-controlled HTTP and runtime limits [V [repo](https://github.com/extism/extism)] | Strong; no network or files unless the host grants them [E on defaults; not on the page I opened] | Plug-in authors compile to Wasm; debugging is harder | Only if third parties write connectors |

Third-party connectors bring review, support and liability for code that handles customers' credentials. Reject them until there is a public API with real users; a third party can integrate through that API instead, which needs no code inside Pavé.

## 5. The sync engine

### 5.1 One owner per field

| Field | Pavé alone (no ERP) | An ERP or POS stays (the usual case) | A sales channel |
|---|---|---|---|
| Style identity (stable id), design, CAD | Pavé | Pavé | never |
| SKU string | Pavé | The ERP if it assigns numbers; Pavé stores it as an external reference and keeps its own id | receives |
| Title, description, tags, collections | Pavé | Pavé | Pavé when it manages the whole listing; the channel when the listing is "linked, pictures only" |
| Images and renders | Pavé | Pavé | Pavé |
| Expected facts: metal per alloy, stone schedule, bill of materials | Pavé (computed from the design) | Pavé | receives a subset |
| Actual weight, certificate, hallmark id of a tagged piece | Pavé's job record (later) | ERP | never |
| Cost | Pavé's estimate, labelled as such | ERP owns actual cost; Pavé never overwrites it | never sent |
| Price | Pavé, confirmed by a person | ERP if it holds price lists; otherwise Pavé | receives |
| Stock quantity and sold status | Pavé | **ERP**; Pavé relays | never the owner; it reports sales as events |
| Published or withdrawn | Pavé | Pavé | follows |
| Orders | n/a | the channel creates; the ERP books | the channel |

This matches the earlier rule that the ERP owns stock, weights, cost and rates while Pavé owns titles, pictures and collections (`catalog-import-and-store.md` §2.4), and the publishing plan's rejection of a channel as the source of stock truth. The matrix is stored per connection as data (`owner: 'pave' | 'remote'` per field group), because one customer's ERP owns price and another's does not.

### 5.2 The canonical model

| Entity | Key fields | Note |
|---|---|---|
| **Style** | stable id, style number, title, category, visibility (public, named buyers, nobody), origin (designed in Pavé, or imported) | One per design. CAD exists per style |
| **Variant** | SKU, selection (metal, size, stone option), fulfilment mode: made to order (lead time), stocked (count), or serialised | The publishing plan compiles variants from a design; an imported style needs stored variants |
| **Stock unit** | tag number, variant, actual gross and net weight, certificate numbers, hallmark id slot, location, status (available, reserved, sold, memo-out, unknown), memo flag | **One-of-a-kind pieces live here.** The publishing plan has no such record; `catalog-import-and-store.md` §2.3 lists it as missing |
| **Bill of material line** | metal line: alloy, fineness, net grams, casting allowance. Stone line: role, material, origin (natural, laboratory-grown, simulant), growth method, treatment, cut, millimetres, count, carat each and total, quality, lab and report number, supplied by. Finding line | Already the shape of `bom.csv`, `stones.csv` and the manifest |
| **Media** | asset hash, role, renditions, provenance, alt text | Immutable URL per hash |
| **Certificate** | lab, number, link, which stone | |
| **External reference** | connection, entity, external id, external version or etag, digest last pushed, digest last seen, sync status | One row per entity per connection. Every sync decision reads this row |

### 5.3 Inbound: idempotent events

1. The webhook route (hosted only) reads the raw body, calls `verifyWebhook`, and inserts one `inbound_event` row per hint with a unique `(connection_id, dedupe_key)`. A conflict means "seen": answer 2xx and stop. Then it answers 2xx. Nothing else happens in the request (Shopify allows 5 seconds [V]).
2. The dedupe key is the platform's delivery id: `X-Shopify-Webhook-Id`, Square `event_id`, Etsy and Standard Webhooks `webhook-id`, Stripe event id [V §3.4].
3. Each hint becomes a `refresh` task keyed by `(connection, stream, external id)`. Tasks with the same key coalesce, so a burst of ten events costs one fetch.
4. The task calls `fetch` and compares the remote version (etag, `updated_at`, or a digest of the fields we read) with the external reference row. Older or equal: drop. Newer: apply under the ownership matrix.
5. Ordering therefore does not matter, and **replay is safe**: re-running any stored inbound event fetches the same current state.
6. Polled sources go through the same path from step 3: a poll produces hints.

Keep inbound rows for 30 days (the longest retry window above is Stripe's three days [V]) so a replay tool has something to replay.

### 5.4 Outbound: the outbox

- A change to a synced field writes an `outbound_event` row **in the same transaction**: `(id, org, connection, entity, entity id, desired digest, created_at)`. The row says "this entity's desired state changed", not "apply this delta".
- A relay (a `work` kind, leased as in the durable-jobs plan) picks rows per connection, respecting the rate hints. For each entity it builds the desired state now, calls `plan`, and runs each step through `push`.
- **State-based, not delta-based.** If five edits queue up while offline, one push of the latest state is sent. Stock is the exception: quantities go through compare-and-swap where the channel has it.
- **Each step has a key** derived from `(outbox id, step kind, target)`. Where the remote accepts an idempotency key (Shopify inventory mutations [V], the partner marketplace's writes [V: repo]), the key is sent. Where it does not (most creates), an intent row is written before the call and, after an unknown outcome, the connector reads and adopts by SKU or custom id. This is `publishing.md` hard part 5.
- **One in-flight push per `(connection, entity)`.** Later rows for the same entity wait and then usually collapse.
- Our own webhooks to developers are just another consumer of the same outbox.

### 5.5 Webhooks to trigger, polling to decide; cursors and sweeps

| Loop | Interval | Purpose |
|---|---|---|
| Hints (webhook or events feed) | seconds when hosted | Make the common case fast |
| Incremental poll per stream, cursor = `(updated_at, id)` or the remote's own feed cursor, re-reading a small overlap | 60 s while the app is open, 15 min in the background (the cadence the partner contract §7 already sets) | Catch everything a webhook missed; the only mechanism on a local install |
| Full reconciliation sweep: list everything, compare digests with external reference rows | nightly, and always after waking from more than an hour offline | Catch silent drift, expired cursors (a 410), and deletes |

A local laptop sleeps. On wake, every cursor is suspect: run the sweep before resuming pushes, so a stale desired state is not pushed over a newer remote one.

### 5.6 Conflicts, the review queue, deletes

- The engine keeps the last synced snapshot per entity as the common base, so it can tell which side changed a field.
- Owner changed: propagate. Non-owner changed a field it does not own: do not overwrite at once; mark the record **drifted** and put it in the review queue with both values and two buttons (keep ours, use theirs). The publishing plan already names the state "Changed on Shopify · Use theirs".
- Both changed: the owner's value stands; the queue shows the other.
- No last-write-wins by timestamp across systems: clocks differ, and a POS edit at the counter is not less true for being older.
- Structural mismatch (the remote has variants we do not know, a SKU maps to two styles): block that record, sync the rest.
- **Deletes.** A remote delete never hard-deletes in Pavé: the link becomes `unlinked` and the record shows it. A delete in Pavé archives; the channel listing is deactivated, not deleted, unless a person chooses delete. In a pulled feed, absence means "gone" only when the page was marked `full` (`catalog-import-and-store.md` §2.4), and then only after two consecutive full sweeps.
- Items hidden when their source has had no good run for 48 hours: the rule the marketplace's stock connectors already use (`catalog-import-and-store.md` §2.4).

### 5.7 Backfills, rate limits, observability

- A backfill is a resumable `work` item whose checkpoint is the cursor. It runs in the lowest of four priority lanes per connection: **stock and unlisting**, orders, content, backfill. A reserve of the rate budget is kept for the first lane (`publishing.md` hard part 5 does this for Etsy).
- Rate limiting is a token bucket per connection (and per app key where the quota is shared), fed by the manifest hints and corrected by `429` and `Retry-After`.
- Per record: status (`in_sync`, `pending`, `failed`, `drifted`, `blocked`, `unlinked`), last synced time, last error in plain words, attempt count. After five failed attempts a step goes to a dead-letter list with a **Replay** button; nothing retries for ever.
- Per run: rows read, changed, refused, and control totals, as the marketplace's connectors report today.
- A "Sync" page per connection: health from `check`, the lanes' queue depth, the review queue, dead letters, the last 50 inbound events with their outcome.

### 5.8 Overselling protection for one-of-a-kind pieces

**The ledger.** A stock unit has at most one holder. A reservation row `(stock_unit, holder, source, expires_at, state)` sits under a unique partial index on the unit for live states, so the database decides a race, as plan claims do today [V: repo `ab:plans.ts`]. "Live" depends on time, which an index cannot see, so expiry is checked on read and a sweep ends overdue holds (the partner contract §5.10 reaches the same conclusion). `stock_movement` (planned, append-only, unique `ref` = channel order line id) records the sale exactly once.

**On the first order event from any channel**, in this order: (1) insert the reservation (source = that order); (2) push quantity 0 to every other channel, in the stock lane, using compare-and-swap from 1 to 0 where offered so that a concurrent sale there is detected as a stale value rather than hidden [V Shopify]; (3) only then run any other sync. If step 1 conflicts, a second order has arrived for a held unit: flag it for a person at once; never auto-accept.

**The race window** is the time between a sale on channel A and quantity 0 landing on channel B.

| Deployment | Window | Basis |
|---|---|---|
| Hosted, webhooks | Seconds to about a minute, plus our push | Square says most notifications arrive well under 60 s [V]; Shopify gives no latency figure |
| Hosted, a webhook missed | Until the next poll | Shopify and Square both say delivery is not guaranteed [V] |
| Local install, app open | Poll interval (60 s) plus the push | §5.5 |
| Local install, laptop asleep | Unbounded | Nothing runs |

A rough size [E]: if a piece would sell on channel B about once in 30 days, the chance of a second sale inside a 60-second window is about 0.002 %, and inside 15 minutes about 0.03 %. The software race is small. The larger risks are the laptop being off and a sale the system never sees: a counter sale, or a memo recall, in an ERP we cannot write to. `catalog-import-and-store.md` §2.4 says it plainly: a hold in Pavé binds nobody when we cannot write to the ERP.

**What marketplaces guarantee.** Inside one channel, the channel decrements its own quantity when it takes an order: eBay hides a zero-quantity listing when out-of-stock control is on [V]; Etsy emits `inventory.out_of_stock` [V]; Shopify moves units to `committed`, which apps cannot alter [V]. Whether two simultaneous checkouts can both succeed on a quantity of 1 I could not verify at source for any of them. **Across channels nobody guarantees anything.**

**Policy, as a per-piece setting.**

| Policy | Oversell risk | Use for |
|---|---|---|
| Made to order | None | The default for designed pieces |
| Exclusive: quantity 1 on one checkout channel, "enquire" on the others | None from sync | **Default for one-of-a-kind** |
| Everywhere with quantity 1, pessimistic unlisting | Small but real; requires hosted with webhooks | Only when the seller accepts it in writing in the UI |
| ERP-owned stock we cannot write to | Cannot be bounded | Show "subject to confirmation" |

### 5.9 Durability on a small install

- The founder's note says "SQLite-backed queues". The repo's local database is PGlite, an embedded Postgres, with the same schema as hosted [V: repo `db/client.ts`]. So the queue is ordinary tables (`outbound_event`, `inbound_event`, `work`) in both modes; there is no second queue technology to choose.
- PGlite runs one query at a time, so a local install has one worker and no contention; leases still give crash recovery, and the same code is safe with several processes on real Postgres (`deploy-and-durable-jobs.md` §4.1).
- **Exactly-once effects** means at-least-once delivery plus dedupe at every boundary: the outbox row in the change's transaction, a key on every push, a unique index on every inbound id and every stock movement reference. A kill between "call sent" and "result stored" is the one hard case, and it is covered by the intent row plus read-and-adopt.

## 6. Credential storage for connectors

Topic 20 covers OAuth flows and keys; this is only what the connector layer needs.

| Concern | Rule | Basis |
|---|---|---|
| At rest | One sealed blob per connection: AES-256-GCM, key derived per purpose from a master secret outside the database, organisation id and connection id as associated data, a `key_version` column | The assistant key store does this today [V: repo `ab:assistant/keys.ts`]; `publishing.md` §2 plans `channel_connection.credentials_enc` and `key_version` |
| Master secret, hosted | An environment secret now; a cloud key service wrapping per-organisation data keys later | [E] |
| Master secret, local | The operating system keychain where available; otherwise the 0600 file in the data folder, with a plain warning that a backup of that folder contains the tokens | The partner contract §9 already requires this |
| Rotation | Re-seal on `key_version` change in a background pass; both versions readable during it | [E] |
| Refresh | One refresh at a time per connection (`refreshing_until` as a lease); rotate refresh tokens; tolerate the provider's reuse-detection grace window | Partner contract §3.4; `publishing.md` "single-flight refresh" |
| Scopes | Declared per capability in the manifest; ask only for what the enabled capabilities need. A one-way product push never asks for inventory write | [E] |
| Client secrets | A local install is a public client and cannot keep a provider's client secret. For providers that require one: the customer's own app keys (the publishing plan's "Use your own app keys"), or a hosted token broker later | [E]; RFC 8252 reasoning as in the partner contract |
| Never in logs or the browser | Secrets are a handle, not a string, in the connector context; the logger redacts by value; commands mark secret inputs; the browser gets only the last four characters and a status | [V: repo `ab:commands.ts:81-82`] |
| Fixtures | The recorder scrubs `Authorization`, cookies, query tokens and any value equal to a known secret before writing; a CI check greps fixtures for token shapes | §8 |
| Agent | ERP passwords and database logins stay on the agent's machine and are never uploaded; the server knows only a hash of the agent's own token | QuickBooks Web Connector keeps the password on the user's machine, encrypted, and not in its config file [V §7] |

## 7. Local-first limits and the on-site agent

### 7.1 No public address means no inbound webhooks

| Option | Works? | Verdict |
|---|---|---|
| Polling only | Yes, everywhere | **The baseline.** Slower, and nothing runs while the laptop sleeps |
| A hosted relay: a small always-on endpoint we run that receives webhooks and stores the raw body and headers; the local app pulls them with a cursor and commits an offset | Yes. Svix sells this as "polling endpoints" for consumers without a public URL [V [Svix](https://docs.svix.com/advanced-endpoints/polling-endpoints)]; the partner contract's events feed is the same idea | **The right later step.** The relay need not hold connector secrets: it stores, the local app verifies signatures. It is a hosted service with an operator, so it arrives with hosting |
| Tunnels | Fragile | **Do not rely on them.** Cloudflare Quick Tunnels are for testing only, have no uptime guarantee, cap at 200 in-flight requests and change address every time [V [Cloudflare](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)]. Stripe suggests tunnels for testing only [V]. The Hookdeck CLI does not queue events while the listener is disconnected [V [Hookdeck](https://hookdeck.com/docs/cli)]. A stable tunnel also exposes a server that has no sign-in in local mode |

Consequence already in the plans: with a loopback public URL, catalogue, feeds and provider sign-ins that need a callback are disabled with the reason shown (`publishing.md` §1).

### 7.2 Desktop ERPs behind a firewall

Tally listens for XML over HTTP on a port of the PC it runs on, 9000 by default, once its HTTP server is enabled in settings [V [Tally XML integration](https://help.tallysolutions.com/xml-integration/)]. A desktop POS keeps a database on a shop PC [S, ERP report]. Neither is reachable from a hosted service.

**Two cases, and only one needs an agent.**

- **Local Pavé on the shop's network:** the Pavé server itself can post to `http://<tally-pc>:9000` or write into a watch folder. A `transport: 'lan'` connector runs in-process. No extra program.
- **Hosted Pavé:** something inside the shop must make the outbound connection. That is the on-site agent.

**Precedents.**

| Precedent | Model | Evidence |
|---|---|---|
| QuickBooks Web Connector | A program on the user's PC starts every session: it calls the vendor's web service, asks for work, relays requests to QuickBooks and returns the answers. No inbound port. The user sets the polling interval; the config file carries no password; HTTPS is required in production | [V [programmer's guide](https://static.developer.intuit.com/resources/QBWC_proguide.pdf)] |
| Tally's own reference architecture (updated 23 Sep 2026) | A connector in the customer's environment opens an outbound secure WebSocket to the vendor's server and forwards requests to Tally's local HTTP endpoint; presented as a pattern for solution providers, not something Tally supplies | [V [Tally WebSocket integration](https://help.tallysolutions.com/secure-websocket-integration-with-tallyprime/)] |
| A third-party Tally connector | A Windows tray program on the Tally PC or the same network; host and port 9000 configurable; incremental sync every 15 minutes to 24 hours; a full sync every 48 hours that also removes deleted records; posts masters and vouchers back | [V [FinlyticZ connector](https://payvance-innovation.gitbook.io/finlyticz-help-center/connector-setup)] |
| Microsoft on-premises data gateway | The gateway polls a cloud relay for pending queries; credentials arrive encrypted and are decrypted on the gateway | [V [Microsoft](https://learn.microsoft.com/en-us/data-integration/gateway/service-gateway-onprem-indepth)] |
| Tableau Bridge | Client software inside the network makes an outbound encrypted connection | [V [Tableau](https://help.tableau.com/current/online/en-us/qs_refresh_local_data.htm)] |
| Workato on-prem agent | Outbound only, TLS WebSocket on port 443 with mutual TLS; agents can be grouped for availability | [V [Workato](https://docs.workato.com/on-prem.html)] |
| Pavé's planned render node | Pairing code, token stored hashed, long-poll claim, heartbeat, lease epoch, minimum runner version | [V: repo `deploy-and-durable-jobs.md` §3, §4.9] |

**Design of the agent** [E, assembled from the precedents]:

- **What it is.** A small signed Windows program (the ERP PCs in this trade are Windows [E]) that runs in the tray and starts with the PC. It hosts the same `transport: 'lan'` connector code as the server, behind the process boundary of §4.5.
- **Network.** Outbound HTTPS on 443 only. It long-polls `claim` for work, heartbeats, and posts results: the render node protocol reused. A plain long poll survives more proxies than a WebSocket; a WebSocket can come later.
- **What it may do.** A closed list of operations compiled into the signed build: post XML to the configured Tally address; read and write files in one configured folder; later, run **named** read-only queries against a configured database. The server sends an operation name and data, never a command line and never SQL text.
- **Secrets.** A pairing code typed once; the agent's token stored with Windows DPAPI for the current user; ERP credentials entered on the agent and kept there.
- **Updates.** A signed auto-update channel with a staged rollout; the agent reports its version at every claim and the server refuses versions below a minimum. An agent that cannot update is the main support cost of this pattern [E].
- **Failure behaviour.** If Tally is closed or the company is not loaded, the job waits and the Sync page says so in plain words; nothing is dropped. The server marks the connection stale after 48 hours without a good run.
- **Security model.** The agent trusts the server only for the closed operation list. The server treats agent output as untrusted input: it parses XML with entity expansion off, with size caps, and maps through the mapping layer.

## 8. Testing

| Layer | What | Notes |
|---|---|---|
| Fakes | One in-memory fake per external system implementing its real quirks: full-replace lists, non-idempotent create, 429 with `Retry-After`, token rotation, out-of-order and duplicate webhooks, a crash between any two steps | `publishing.md` §5 specifies `fakeChannel` this way; the assistant build's strict fake API is the house pattern [V: repo] |
| Recorded fixtures | Record real HTTP through the injected client; replay offline; scrub secrets on write | Because all I/O is injected, recording is one wrapper, not a library choice. A CI check fails on any token-shaped string in a fixture |
| Contract tests | The conformance suite (§4.4) against a vendor sandbox on a schedule, not on every commit: a Shopify development store, a Square sandbox, a scratch Tally company. The Edge has no sandbox we can reach [E], so its files are validated by a customer | For the partner marketplace both sides already share one acceptance suite and a fixture set (contract §10) |
| Golden files | Byte-exact CSV, JSON and XML for a fixed set of designs (`packages/production/src/testing/fixtures.ts` exists) | The job package is already deterministic; exports must stay so (no clocks; dates injected) |
| Property tests | (1) Any permutation and duplication of a set of inbound events yields the same final state. (2) Apply, then re-plan: zero steps. (3) Replaying the whole outbox changes nothing. (4) `pull` resumed from any emitted cursor yields the same record set | These encode §5.3 and §5.4 |
| Kill tests | Kill the server at named points: after the outbox write, after the remote call and before the result is stored, mid-backfill; restart; assert one effect | The durable-jobs plan has `PAVE_KILL_AT` for this |
| Overselling simulator | A discrete-event simulation: N channels, order arrivals per channel, webhook delay and loss, poll interval, laptop sleep. Asserts that a unit never has two confirmed orders; reports how often a second order reached the review queue per policy | It turns the table in §5.8 into numbers before anyone lists a unique piece in two places |

## 9. The first connectors

### 9.1 (a) Item-master and job-package export, CSV and JSON

No network, no credentials, works on a laptop. Schema id **`pave.item-master/1`**, carried in `manifest.json` and in the folder name. Rules: columns are only ever appended within a major; order is stable; units are in the header name (`_g`, `_mm`, `_ct`); empty means unknown, never zero; one stable `style_id` and `variant_id` in every file; stone names are generated from origin fields, so no file can say "LGD" (the ERP report's wording rule).

| File | One row per | Columns (first version) |
|---|---|---|
| `styles.csv` | style | `style_id, style_no, title, description, category, collection, source_design_version, created_at, updated_at, status` |
| `variants.csv` | variant | `variant_id, style_id, sku, metal_alloy, fineness, plating, ring_size, stone_option, fulfilment, lead_days_min, lead_days_max, net_metal_g, gross_weight_g, stone_count, stone_ct_total, est_cost, price, currency, hallmark, country_of_origin` |
| `bom.csv` | variant × line | the 16 existing columns, prefixed with `variant_id` |
| `stones.csv` | variant × stone lot | the 24 existing columns, prefixed with `variant_id`, plus `growth_method, treatment, lab, report_no` (the ERP report's four schema choices) |
| `media.csv` | variant × image | `variant_id, position, role, file, url, sha256, width, height, provenance, alt` |
| `items.json` | style, nested | the same data as one document per style |
| `manifest.json` | export | schema id, generator version, counts, **control totals** (rows, stones, carats, grams per alloy), SHA-256 of each file |

Images: when hosted, `url` is the immutable public link; on a local install the export is a zip with `images/<sku>/<nn>-<role>.jpg` and `file` filled in. Both columns always exist.

The **job package** is the existing production zip. Add one file, `job.json` (schema `pave.job/1`): job id, quantity, size run, due date, expected metal per alloy with casting allowance, the stone schedule with who supplies each lot, and casting-tree inputs. Most of it is already in `manifest.json` under `metals` and `stones`.

### 9.2 (b) Tally XML

- **Masters first, in dependency order:** units (grams, carats, pieces), stock groups, then stock items (name = SKU, parent group, base unit, description; HSN code as an optional field the accountant confirms). Tally's samples show unit, stock group, stock item and godown masters imported under the report name "All Masters", and an import that names a missing master fails until that master exists [V [sample XML](https://help.tallysolutions.com/sample-xml/)].
- **Vouchers later, and narrowly.** The line "never build the books" means no sales, purchase or receipt vouchers. The only candidates are inventory vouchers for a finished job; they wait for the job record (ERP report step 3) and an accountant's sign-off. Tally's published samples cover sales vouchers; I did not find an official stock-journal sample on the page I opened.
- **Delivery, in order:** (1) a `.xml` file the bookkeeper imports through Tally's own import menu: works today, from any install; (2) HTTP POST to port 9000 from a local Pavé on the same network; (3) the same POST through the on-site agent when hosted.
- **Idempotency.** Masters are matched by name: send `Create`, and send `Alter` for known items. Parse the response counts (`CREATED`, `ALTERED`, `IGNORED`, `ERRORS`) and any `LINEERROR` and show them per item [V same page]. Every voucher, when they come, gets a unique id of ours: the ERP report records a pitfall where repeated voucher ids overwrite existing vouchers [S, not re-verified].
- **No dry run exists in Tally** [E], so: validate the XML locally, and offer "send to a test company first".

### 9.3 (c) The Edge

Checked at source; this corrects the ERP report.

| Edge feature | What it does | Use |
|---|---|---|
| Item Data Import wizard | **Updates existing items only.** Matches on `itKey` (item number) or on `itVendorID` + `itVendStyleCode`. Updatable headers are published: `itDesc, itMetalColor, itMetalFinish, itMetalType, itSize, itStyle, itRetailPrice, itLowestPrice, itCurrentPrice, itMfg, itLength, itMillimeter, itFolioNumber, itVendBarCode, itSerialNumber`, web fields `imTitle, imMetaTitle, imMetaKeywords, imMetaDescription, imDescription, imWebTags`, and custom details `itDetail_1..16`, `imDetail_1..8`. Delimited file; other workstations must be closed; back up first [V [file format](https://edgeuser.com/Knowledge/Knowledge-Base/inventory-item-data-importexport-item-data-import-item-data-import-file-format)], [V [tip sheet](https://devuser.edgeuser.com/Portals/0/docs/TIP-2023-200_ItemDataImportWizard.pdf)] | **File 2:** push descriptions, prices and web copy onto items that already exist. Buildable now from the published headers |
| Receive Invoice → Import Invoice | **Creates new inventory items** from a CSV or Excel file with headers in row one. The user maps each column to an Edge field on screen; images are matched from the Photos folder by file name or vendor style number (`Image 1`–`Image 5`); a blank template with every importable column can be downloaded from that screen [V [importing data](https://edgeuser.com/Knowledge/Knowledge-Base/inventory-receive-invoice-recv-invoice-importing-data)] | **File 1:** new items as a "vendor invoice". The template's column names are not published as text: **needs one customer's blank template**. Because mapping is manual in The Edge, a clearly named CSV works before we have it |
| Vendor catalog files | Supplied by The Edge itself; they do not create in-stock items [V [vendor catalogs](https://edgeuser.com/Knowledge/Knowledge-Base/inventory-vendors-importing-vendor-catalog-files)] | Not a route for us |

So the Edge connector is `render` only, two profiles, plus an image folder named by vendor style number. Not found: any public Edge API.

### 9.4 (d) Shopify products, one way; (e) two-way stock

As `publishing.md` build steps 6–7 specify: connect; **link an existing listing and send pictures only** first; then full listings with `productSet` keyed by our custom id (full replace, so abort if the remote has variants we do not know); then stock. For (e): `inventorySetQuantities` with `changeFromQuantity` and an `@idempotent` key [V], order and inventory webhooks as hints, `updated_at` polling to decide, and the §5.8 ledger. (e) needs a hosted install or the seller's acceptance of polling delays.

### 9.5 The order: confirmed, with changes

1. **(a) stays first.** It needs no hosting, no approvals, no credentials, and (b) and (c) are projections of it.
2. **(b) before (c) holds for India-first customers; swap them for a US-first customer.** They are independent. Each is S-sized once (a) exists [E].
3. **(c) is two files, and its "create" half is blocked on a customer's template.**
4. **Add a generic step before (d):** the listing kit and a Google-format feed, already P0–P1 of the publishing plan. They prove the canonical model against a second consumer without any live API.
5. **(d) then (e)** as planned. Nothing two-way before the review queue and the dead-letter list exist.

## 10. Pavé's own public API

### 10.1 REST, generated from the command registry

**Recommend REST with JSON under `/v1`.** Reasons: the registry already holds a zod schema per command, so routes and an OpenAPI 3.1 document can be generated and snapshot-tested (`publishing.md` §3); the consumers are agencies' nightly importers, Zapier-style tools and ERPs, which expect REST and files [E]; cursor lists and immutable image URLs cache well. GraphQL would add a second schema, query-cost limiting and a harder scope model for price visibility, for no named consumer. Reject it for now; `/mcp` already serves the "ask for exactly what you need" case for AI clients.

| Resource | Notes |
|---|---|
| `pieces` (styles) and `variants` | Published only; filter by `sku`, `updated_since`; newest first, so Zapier's polling works |
| `designs` | Read-only facts (weights, stone schedule) and version; CAD download only with a files scope and subject to plan allowances |
| `files`, `renders`, `images` | Metadata plus immutable URLs by content hash; named renditions; `410` once withdrawn |
| `catalog/feeds` | Feed URLs and their formats |
| `stock` | Read; `inventory.set` write behind its own scope |
| `jobs` | Export and feed-build jobs: start, poll, download |
| `events` | The polled change feed (below) |
| `webhook_endpoints`, `deliveries` | Subscription CRUD, delivery log, replay, test |

### 10.2 Conventions

| Topic | Choice | Basis |
|---|---|---|
| Versioning | Major in the path; additive changes only inside a major; unknown fields and enum values must be tolerated by clients; a dated changelog; at least 12 months of support after a successor ships; a `Sunset` header on the old one | Shopify's 12-month window [V]; the partner contract's principle 2 |
| Pagination | `limit` and an opaque `cursor`; `next_cursor: null` at the end; cursors bound to the key and the query | As the partner contract principle 8 |
| Errors | RFC 9457 problem details with a stable `code` extension and `request_id` | [V RFC 9457]; `08-channels.md` §6 |
| Idempotency | `Idempotency-Key` required on every write; kept 24 hours; scoped to key, method and path; replay returns the first reply; 409 in flight; 422 on reuse with a different body | Stripe [V]; the IETF draft [V] |
| Rate limits | Token bucket per organisation; `429` with `Retry-After`; `RateLimit` and `RateLimit-Policy` headers as information only | The header draft is still an Internet-Draft (draft-12, 20 Nov 2026) [V [draft](https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/)] |
| Keys and scopes | Topic 20. From this file: price visibility is a scope, and trade price and cost never leave through a key that lacks it | `catalog-import-and-store.md` §2.7 |

### 10.3 Events feed and webhooks

- **The feed is the record.** `GET /v1/events?after=<cursor>` returns ordered events, kept 30 days; an older cursor answers 410 and the client re-reads. It is the only mechanism a consumer without a public address can use, and it is what we ask of our own partner.
- **Webhooks are the hint**, signed per Standard Webhooks, with the `webhook-id` equal to the event id so a consumer dedupes across both paths; the spec's retry schedule; two signatures during secret rotation; `410` disables; the sender uses the SSRF-safe fetch and re-checks the address at every attempt.
- **Thin payloads by default:** `{type, timestamp, data: {id, sku, url}}`. A consumer fetches with its own key, so scopes decide what it sees at that moment, and a stale price never travels inside an event. Etsy and Stripe both moved this way [V].
- **Catalogue:** `product.updated`, `variant.updated`, `media.published`, `media.revoked`, `stock.updated`, `stock.reserved`, `stock.released`, `listing.published`, `listing.sync_failed`, `order.created`, `export.ready`, `connection.needs_auth`. (`publishing.md` §3 has most of these.)
- All of this exists only when hosted.

### 10.4 Bulk export and file feeds

| Option | Cost to us | Who accepts it |
|---|---|---|
| **A manifest over HTTPS**: one URL per feed listing every file with size, SHA-256 and an immutable link; a nightly importer mirrors what changed | Small; no new server | Any developer; the "folder my importer can mirror" need in `catalog-import-and-store.md` §2.7 |
| **Standard feed files at a token URL**: Google-format TSV or XML, the item-master CSVs | Small | Google Merchant Center takes a crawlable `image_link` plus up to 10 `additional_image_link` URLs, and groups variants by `item_group_id` [V [Google](https://support.google.com/merchants/answer/7052112)] |
| **Push to the customer's bucket** (S3-compatible) | Medium; their credentials in our vault | Larger partners [E] |
| **SFTP we host** | A real server: AWS Transfer Family is $0.30 an hour per endpoint, $216 a month, plus $0.04 per GB [V [AWS](https://aws.amazon.com/aws-transfer-family/pricing/)]; plus host keys, isolation and a fixed address | Only on a named partner's demand |
| **SFTP or FTP we push to** (their server) | Medium; a connector with `transport: 'http'`-like rules | What trade marketplaces ask of suppliers: one says suppliers integrate by API or FTP [V [supplier help](https://supplyhelp.nivoda.com/hc/en-gb/articles/35390236532753-How-can-I-integrate-my-inventory-system-with-the-Nivoda-platform)] |

**What trade partners accept, as far as I could open pages:** tabular files with image **links**, not images inside the file. A large diamond listing service publishes a dictionary of accepted header aliases and takes image and video URLs [V [Rapaport fields](https://help.rapaport.com/en/articles/5469769-rapaport-trade-formerly-rapnet-diamond-fields-values)]. A POS vendor's supplier catalogue format is CSV with one row per variant, a `groupID` for variants and space-separated image URLs, delivered by API or SFTP [V [Lightspeed vendor CSV](https://lightspeed-vendors.readme.io/docs/csv-format)]. A large US findings supplier offers custom CSV feeds built in an account page and downloaded [V [Stuller](https://stuller.com/ecommerce-data-feed-tutorials)]. The jewelry vendor-to-retailer network names no file format on its public page [V [JewelCloud](https://gemfind.com/jewelcloud/)]; a jewelry website platform has a "Jewelry CSV Fields" page I could not render [S [Punchmark](https://punchmark.atlassian.net/wiki/x/FIBmKg)]. **There is no jewelry catalogue feed standard**; the ERP report says the same for diamonds. Plain FTP sends passwords in clear text and should not be offered.

### 10.5 Source of truth, SDKs, sandbox, docs

- **OpenAPI is generated**, never hand-written, and its snapshot is a test. Hand-written prose lives beside it.
- **SDKs:** generate a TypeScript client from the OpenAPI file; one MIT-licensed generator produces SDKs and zod schemas [V [hey-api](https://github.com/hey-api/openapi-ts)]. Paid generators (Stainless, Speakeasy, Fern) were not priced [E]. Do not hand-maintain SDKs.
- **Docs:** render the reference from the same file; Scalar is MIT and has a Hono integration [V [Scalar](https://github.com/scalar/scalar)], and the server is Hono.
- **Sandbox:** `pave_test_…` keys against a seeded organisation with fixture pieces, a "send test event" button, and the delivery log with replay. The partner contract §11 takes the same approach.

## 11. A partner marketplace and a supplier stock bridge as connectors

Described generically: a B2B diamond marketplace with OAuth, stone search, holds and orders (the contract in `docs/integrations`), and a read-only feed of a supplier's stock.

**What they share with ERP and channel connectors.** A connection row with sealed credentials; a manifest with capabilities and scopes per capability; `check`; a polled events feed with an opaque cursor, plus webhooks as hints when hosted; inbound dedupe on the event id (the contract makes `webhook-id` equal the event id); an idempotency key on every write; rate hints with `429` and `Retry-After`; a fake, recorded fixtures and a shared acceptance suite; per-record status and replay.

**What is different.**

| Aspect | ERP or channel connector | Marketplace connector | Supplier stock bridge |
|---|---|---|---|
| Main verb | Sync a catalogue (`pull`, `push`) | **Query at the moment of need** (`search`, `availability`, `fetch`); nothing is mirrored | `pull` only, full list |
| Who owns the data | Split by the matrix | The marketplace owns everything about a stone | The supplier's system |
| Caching | The external reference row holds a snapshot | Only stones linked into a design, each with `seen_at`; never the catalogue; access and price are recomputed on every request, so no cached answer may be shown as current | The latest full list; items hidden after 48 hours without a good run |
| Price | A synced field | **Perishable and private:** shown with its date, refreshed on open, never published to a store, feed or public link, marked stale after a revoke; a daily quota on priced items is a second rate dimension that the manifest's `quota` hint must express | Often absent (a read-only login may not see cost) |
| Holds | Our reservation ledger is the authority | **The remote hold is the authority.** Our ledger mirrors it: an expiry time, one extension, a countdown, a `hold.expiring` event; after expiry assume nothing. A replayed create returns the original reply, so read the hold again for its status now. A hold is the marketplace's priority, not the supplier's promise | **No real holds:** we cannot write. Everything is "subject to confirmation" |
| Unknown values | Reject or map | Tolerate: an unknown status means "not pickable" | Reject the row, count it |
| Failure of access | Reconnect | Access can vanish between two calls (verification lost); drop cached prices and holds at once | Mark the source stale |
| Transport | HTTP, file or LAN | HTTP, server to server; token never in the browser | A read-only database login or file drop; behind a firewall it needs the on-site agent |

So the interface in §4.1 needs two additions beyond catalogue sync: an optional `search`/`availability` pair for query-time connectors, and an optional `hold` group (`place`, `extend`, `release`, `get`). `SourcingProvider` already has the first; the contract defines the second. Both go through the same engine for credentials, rate limits, dedupe and observability, and skip the outbox for reads.

## 12. What this means for the plan

### 12.1 Inputs for `docs/plans/integrations-hub.md`

1. **One package, `packages/connectors`**, holding the interface of §4.1, the conformance suite, the mapping document type and the file connectors. `packages/channels` (planned) and `packages/sourcing` (built) become connector families inside it or thin adapters over it. Decide which before either grows.
2. **Canonical model additions:** `piece.sku`, stored variants for imported styles, a **stock unit** record, external reference rows, the four stone fields from the ERP report. These precede every connector.
3. **Engine tables:** reuse the publishing plan's names (`outbound_event`, `inbound_event`, `channel_task` or the `work` table, `stock_movement`) and add `external_ref`, `sync_record_status`, `reservation`, `mapping`. Use the durable-jobs `work` model for the relay rather than a second queue.
4. **Build order:**
   1. `pave.item-master/1` and `pave.job/1` exports with golden files (no hosting needed).
   2. Tally XML masters as a file; then LAN post from a local install.
   3. The Edge update file from the published headers; the create file once a customer's template is in hand.
   4. Listing kit and a Google-format feed.
   5. Outbox, inbound dedupe, per-record status, review queue, dead letters, with `fakeChannel`.
   6. Shopify: link and pictures, then products, one way.
   7. Reservation ledger and the overselling simulator; then two-way stock.
   8. With hosting: the webhook relay, then the on-site agent (reusing the render node protocol).
5. **Screens:** a Connections page, a Sync page per connection (§5.7), a mapping screen with dry run, a review queue.

### 12.2 Inputs for `docs/plans/accounts-and-developer-api.md`

1. `/v1` REST generated from commands; OpenAPI snapshot-tested; RFC 9457 errors; `Idempotency-Key` on writes; cursor pagination; newest-first lists.
2. The events feed first, webhooks second; thin payloads; Standard Webhooks signing.
3. File feeds as an HTTPS manifest with checksums; SFTP only on demand.
4. Scopes that separate price and cost from catalogue reads; test keys with a seeded sandbox.
5. A generated TypeScript SDK and a rendered reference; a Zapier app only after there are API users.
6. Connector credentials in the same sealed store as the assistant key, with `key_version`.

### 12.3 Reject, and why

| Rejected | Why |
|---|---|
| Adopting Airbyte, Singer or Meltano as the runtime | Python and Docker on a jeweler's laptop; extract-only; ELv2 on connectors |
| Embedding n8n or Nango | Sustainable Use and ELv2 terms; separate services |
| Buying a unified API now | Does not cover the first four connectors; $599–$750 a month floor; needs hosting; a third party holds customer data |
| An embedded iPaaS (Paragon, Prismatic, Tray, Workato) | Priced and shaped for dozens of SaaS integrations, not four trade-specific ones |
| Third-party connectors | Credential liability; the public API serves outsiders better |
| GraphQL | No named consumer; a second schema; harder price scoping |
| Tunnels for local webhooks | Vendors mark them test-only; they expose an unauthenticated local server |
| Hosting SFTP by default | $216 a month per endpoint before any user asks |
| Last-write-wins by timestamp | Clocks differ; it hides real disagreements |
| Listing a unique piece on several checkout channels by default | No cross-channel guarantee exists; counter sales are invisible |
| Sales, purchase or receipt vouchers into Tally | "Never build the books" |
| A general "run this SQL" or "run this command" agent | It would turn the agent into remote access to the shop's PC |

### 12.4 Decisions for the founder

1. **One connector package or two?** Fold `channels` and `sourcing` into one interface now (recommended), or keep them apart and accept three engines later.
2. **Add a stock unit record** (a tagged, one-of-a-kind piece) to the product model? It changes the publishing plan's "variants are compiled, never stored" rule.
3. **Default policy for one-of-a-kind pieces:** one checkout channel and "enquire" elsewhere (recommended), or everywhere with pessimistic unlisting?
4. **India first or US first** for the second connector (Tally or The Edge)?
5. **Can a customer who runs The Edge send us the blank "Receive Invoice" template** and try one import? That unblocks the create file.
6. **Who confirms the Tally master layout** (groups, units, HSN) with a chartered accountant, and are inventory vouchers ever in scope?
7. **Is a hosted webhook relay acceptable before full hosting**, as a first small always-on service, and who operates it?
8. **Agent platform and signing:** Windows only at first? Which legal entity holds the code-signing certificate?
9. **SFTP:** is there a named partner who needs it? If not, it stays out.
10. **Public API timing:** the publishing plan defers it until orders exist; the catalogue memo pulls it forward. Which holds?

## Repo notes for the lead

- **ERP report, The Edge.** It calls the Edge item import "a ready target for an item master exported from Pavé". At source the Item Data Import wizard only updates existing items; new items come in through Receive Invoice → Import Invoice with on-screen column mapping (§9.3).
- **`08-channels.md` §1, Etsy webhooks.** It flags a contradiction and prefers "order events only". Etsy's own page now lists 11 events, including inventory events, for commercial and personal apps, with thin payloads (§3.4).
- **Founder's brief says "SQLite-backed queues".** The repo's local database is PGlite (embedded Postgres); there is no SQLite. The queue is Postgres tables in both modes.
- **Two error shapes.** `08-channels.md` §6 chooses RFC 9457 for Pavé's API; the partner contract §6 defines its own `{error:{code,…}}` shape for the marketplace. Both are legitimate (different APIs) but Pavé's client code will handle two. Also, the contract answers 422 for a missing idempotency key where the IETF draft says 400.
- **Two secret-store designs.** `publishing.md` §2 plans `secrets.ts` with a key from `PAVE_SECRETS_KEY` or `<dataDir>/secrets-key`; the assistant build already has `runtime.deriveKey(purpose)` and `assistant/keys.ts`. Pick one.
- **Outdated statements.** The ERP report and `catalog-import-and-store.md` §2.1 say `packages/agent` is empty and no model provider exists; the assistant build export has both.
- **`piece.sku`.** The production package reads `piece.sku` and falls back to the id; the research checkout's piece entity has no `sku` field. `publishing.md` §3 adds it.
- **`docs/ARCHITECTURE.md`** still says blobs go to "disk or S3"; the blob store is local disk only (already noted in the catalogue memo).

## Sources

Every link below was opened this session (`[V]`) unless marked. Prices seen 25 November 2026.

- **Connector frameworks and licences [V]:** https://docs.airbyte.com/platform/understanding-airbyte/airbyte-protocol · https://docs.airbyte.com/platform/developer-guides/licenses/ · https://docs.airbyte.com/platform/connector-development/config-based/low-code-cdk-overview · https://github.com/airbytehq/airbyte-python-cdk · https://hub.meltano.com/singer/spec/ · https://github.com/meltano/meltano · https://fivetran.com/docs/connector-sdk · https://github.com/NangoHQ/nango/blob/master/LICENSE · https://www.nango.dev/pricing · https://github.com/n8n-io/n8n/blob/master/LICENSE.md · https://github.com/extism/extism · https://docs.zapier.com/platform/build/trigger
- **Unified APIs and embedded platforms [V]:** https://www.merge.dev/pricing · https://www.apideck.com/pricing · https://unified.to/pricing · https://www.rutter.com/pricing · https://www.useparagon.com/pricing · https://prismatic.io/pricing/
- **Sync guidance [V]:** https://shopify.dev/docs/apps/build/webhooks/best-practices · https://shopify.dev/docs/apps/build/webhooks/troubleshooting-webhooks · https://shopify.dev/docs/apps/build/webhooks/ignore-duplicates · https://shopify.dev/docs/apps/build/orders-fulfillment/inventory-management-apps · https://shopify.dev/docs/apps/build/orders-fulfillment/inventory-management-apps/manage-quantities-states · https://shopify.dev/docs/api/usage/versioning · https://docs.stripe.com/webhooks · https://docs.stripe.com/api/idempotent_requests · https://developer.squareup.com/docs/inventory-api/what-it-does · https://developer.squareup.com/docs/inventory-api/webhooks · https://developer.squareup.com/docs/webhooks/overview · https://developers.etsy.com/documentation/essentials/webhooks · https://developer.ebay.com/api-docs/user-guides/static/trading-user-guide/out-of-stock.html · https://microservices.io/patterns/data/transactional-outbox.html · https://debezium.io/documentation/reference/stable/transformations/outbox-event-router.html
- **Standards [V]:** https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md · https://www.rfc-editor.org/rfc/rfc9457.html · https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/ · https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/
- **Local-first, agents, relays [V]:** https://static.developer.intuit.com/resources/QBWC_proguide.pdf (first 100,000 characters read) · https://help.tallysolutions.com/xml-integration/ · https://help.tallysolutions.com/sample-xml/ · https://help.tallysolutions.com/secure-websocket-integration-with-tallyprime/ · https://help.tallysolutions.com/tally-connector/ · https://payvance-innovation.gitbook.io/finlyticz-help-center/connector-setup · https://learn.microsoft.com/en-us/data-integration/gateway/service-gateway-onprem-indepth · https://help.tableau.com/current/online/en-us/qs_refresh_local_data.htm · https://docs.workato.com/on-prem.html · https://docs.svix.com/advanced-endpoints/polling-endpoints · https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/ · https://hookdeck.com/docs/cli (first 100,000 characters read)
- **The Edge [V]:** https://edgeuser.com/Knowledge/Knowledge-Base/inventory-item-data-importexport-item-data-import · https://edgeuser.com/Knowledge/Knowledge-Base/inventory-item-data-importexport-item-data-import-item-data-import-file-format · https://devuser.edgeuser.com/Portals/0/docs/TIP-2023-200_ItemDataImportWizard.pdf · https://edgeuser.com/Knowledge/Knowledge-Base/inventory-receive-invoice-recv-invoice-importing-data · https://edgeuser.com/Knowledge/Knowledge-Base/inventory-vendors-importing-vendor-catalog-files
- **Feeds and developer tooling [V]:** https://support.google.com/merchants/answer/7052112 (first 100,000 characters read) · https://help.rapaport.com/en/articles/5469769-rapaport-trade-formerly-rapnet-diamond-fields-values · https://lightspeed-vendors.readme.io/docs/csv-format · https://stuller.com/ecommerce-data-feed-tutorials · https://supplyhelp.nivoda.com/hc/en-gb/articles/35390236532753-How-can-I-integrate-my-inventory-system-with-the-Nivoda-platform · https://gemfind.com/jewelcloud/ · https://aws.amazon.com/aws-transfer-family/pricing/ · https://github.com/hey-api/openapi-ts · https://github.com/scalar/scalar
- **[S], not rendered:** https://punchmark.atlassian.net/wiki/x/FIBmKg (a "Jewelry CSV Fields" page; the title came from a search result).

**Could not verify**
- Whether Shopify, Etsy or eBay prevent two simultaneous checkouts on a quantity of 1 (Shopify's Help pages were opened and are silent on it).
- The column names in The Edge's blank Receive Invoice template.
- The Tally duplicate-voucher-id overwrite pitfall (kept as [S] from the ERP report), and an official stock-journal import sample.
- Pricing for Codat (page failed to load), Tray Embedded, Workato Embedded and Make; Lightspeed's inventory API (robots refused); the n8n docs page for its licence (404; the licence file on GitHub was read instead).
- Extism's default network and file permissions (the repository page states host-controlled HTTP, not the defaults); the Fivetran function names (`schema`, `update`).
