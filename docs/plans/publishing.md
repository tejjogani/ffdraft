# Publish: product record, live media, sales channels, public API and feeds

Build brief: the judged synthesis of two independent design proposals. Research: [08-channels](../research/08-channels.md); most platform policy there is unverified, so rules and limits are data (`compliance.ts`, `capabilities()`), not branches in handlers.

## 1. Experience

**Publish tab** (`/pieces/$id/publish`, after Production). Never empty, no write on read: `product.get` returns derived defaults; the first edit saves.

1. **Pictures.** The tray is seeded from starred takes, passed on-model shots, the turntable and the GLB. Click to make one Live, drag to order (first is the hero), add alt text. Badges (Render / AI model / Photo) follow where the asset came from; stale tiles say "Design changed · Re-render". "Add a real photo" asks a person to attest it.
2. **What you're selling.** Title, description and tags from a deterministic template (no model key needed); "Write it for me" opens the assistant on the same row. A read-only facts table sits below, "from CAD v12".
3. **How you sell it.** *Made to order · 2–3 weeks* or *In stock · 1*. "Also offer in…" chips (metal, ring size, centre stone) show the matrix and a suggested price per variant; placeholder rates show "Set your rates" instead. SKU is editable until first publish, so jewelers keep their own.
4. **Check** runs live: blocks and warnings, each with a one-click fix.
5. **Where.** Always present: *Download listing kit* (offline) and *Pavé catalogue* (feed + API). Each connection adds **New listing** or **Link an existing listing** (defaults to "Pictures only": Pavé replaces images and leaves copy, price and stock alone).
6. **Review sheet**: diff against the channel, findings, fee ("Etsy charges $0.20"). **Send as draft** is the default; **Go live** is a second confirm.
7. **After.** A design, render or price change badges the tab and `/channels`: "Out of date: 4.1 → 4.5 g, hero stale" → Review update. Unpublish deactivates.

**States.** No provider keys: "Not configured", with an admin-only "Use your own app keys" form; the kit still works. Loopback `PAVE_PUBLIC_URL`: catalogue, feeds and Etsy sign-in are disabled with the reason; upload-ingest pushes (Shopify) still work from desktop. Etsy without a real photo, stone origin `any`, or unattested source artwork: publish disabled, naming the fix. Also: "Reconnect"; "4 of 6 sent · Resume"; "Waiting for Etsy · 14:02"; "Changed on Shopify · Use theirs".

**`/channels`**: Listings and Connections (with Etsy's trademark notice). **Settings › API & webhooks**: keys shown once, scopes, endpoints, delivery log with replay, feed URLs.

**Assistant**: drafts copy, proposes the hero, runs `product.check` and `listings.review`; publish, unpublish and stock pause for approval; connect, keys and attestation are never tools.

## 2. Structure

**Corrections to both proposals (checked against the tree)**
- `apps/server` depends only on `@pave/schema`; its `EvaluationSummary` lacks stone origin, plating and ring size, and `estimateCost` needs a `PackageContext` built from a kernel `Evaluation`. Facts and prices therefore come through `ProductionService`, not from importing `@pave/production` into handlers (P1). `CostEstimate` is an interface and needs a schema before a command can return it.
- No sourcing command exists and `@pave/sourcing` is not wired into the server, so `orders.start` cannot "call Diaex" (both).
- `safeSegment` and `toCsv` are not exported by `@pave/production`: add `./paths` and `./csv` subpath exports. `originNeedsAttestation` must gate publishing too (both forgot).
- sharp 0.35.5 has `withXmp`, so `DigitalSourceType` needs no new dependency. `imaging/disclosure.ts` (render brief) and an SSRF guard do not exist yet: build once, shared.
- Both missed "connect their stock": jewelers already have listings. Linking one and sending only pictures is the smallest, safest sync, so it ships first.

**`packages/channels`** (new; pure TS, `fetch` injected; mirrors `packages/sourcing/src/provider.ts`; exports `.` and `./testing`)
- `provider.ts`: `ChannelProvider`, `ChannelCapabilities`, `noChannel`.
- `desired.ts`: `buildDesired(product, facts, listing, caps)` and its canonical-JSON `digest`.
- `copy.ts` (template), `compliance.ts` (research rules 1–16 → `Finding[]`), `media.ts` (named renditions, `DigitalSourceType` mapping).
- `plan.ts`: pure `planSync(desired, remote, memo, caps) → SyncStep[]`.
- `feeds/{google,meta,pinterest,acp,jsonld,csv}.ts`, `kit.ts` (fflate), `webhooks.ts` (Standard Webhooks), `http.ts` (token bucket, `retry-after`).
- `providers/{generic,catalog,shopify,etsy}.ts`; `testing/{fakeChannel,cassette}.ts`.

**`apps/server/src`**
- `handlers/{product,channels,listings,inventory,catalog,orders,access}.ts`.
- `channels/{engine,tasks,tokens}.ts`: step executor; durable `channel_task` rows leased by conditional update (PGlite-safe) for sync, deliveries and polling; single-flight refresh.
- `secrets.ts`: AES-256-GCM; key from `PAVE_SECRETS_KEY` or `<dataDir>/secrets-key` (like `loadOrCreateSecret`); org and connection as AAD.
- `assets/assets.ts`: generalise `readThumbnail` into `readVariant`, so renditions reuse `asset_variant`.
- `net/safe-fetch.ts` (shared with `CaptureService`), `http/{v1,public}.ts`, `repo/public.ts` (the only cross-org reads: token lookups).

**`apps/studio/src/features/publish`**: `PiecePublish`, `MediaTray`, `ProductForm`, `VariantMatrix`, `CheckList`, `ReviewSheet`, `LinkDialog`, `ChannelsPage`, `commands.ts` (new `CommandGroup` "Publish"); `pages/settings/ApiSettings.tsx`.

**State.** Server rows in TanStack Query; the review sheet holds only the `digest`. Starring (`renders.update`) only seeds the tray; Live is `product.media`.

## 3. Contract changes

Schemas live in a new `packages/schema/src/api/publish.ts`; pure `variantOps(design, selection) → Op[]` and `variantOverrides(design, selection) → RenderScene['overrides']` in `design/variants.ts`.

**`CommandDef`** gains `rest?: { method, path, scope }`.

**Entities**
- `VariantSelection { metal?, plating?, ringSize?, stone?: { material, origin: 'natural' | 'lab' } }`: a closed vocabulary, not free ops.
- `ProductFacts` (derived, never stored): metals with mass, plating, stones `{ role, material, origin, treatment, cut, count, caratEach, mm }`, `caratTotal`, ring sizes, `extentMm`.
- `CostEstimateSchema` moves here; `@pave/production` infers its type from it.
- `Product { pieceId, rev, saved, sku, title, description, tags, copySource: 'template' | 'person' | 'assistant', currency, options: [{ axis: 'metal' | 'ringSize' | 'stone', values: [{ code, label, selection }] }], variants: [{ key, sku, selection, priceMinor, suggestedMinor, quantity, enabled }], fulfilment: { mode: 'made_to_order', leadDaysMin, leadDaysMax } | { mode: 'stocked' }, media: MediaItem[], facts }`.
- `MediaItem { assetId, origin: { type: 'render', jobId } | { type: 'shot', shotId } | { type: 'upload' } | { type: 'cad' }, source: 'photo' | 'photo_edited' | 'render' | 'ai_generated' | 'ai_edited', syntheticPerson, digitalSourceType, role: 'main' | 'additional' | 'lifestyle' | 'video' | 'model3d', alt, variantKey?, sourceVersion, stale, attestation }`. The server sets `source` from `origin`; an upload is `photo_edited` until attested.
- `ChannelConnection { id, provider, account, status: 'ready' | 'needs_auth' | 'paused' | 'error', capabilities, settings, builtin }`: no credential fields.
- `Listing { id, pieceId, connectionId, manages: 'media' | 'all', state: 'draft' | 'syncing' | 'live' | 'paused' | 'error' | 'unpublished', externalId, externalUrl, outOfDate, settings, progress, findings, error }`.
- `Finding { code, level: 'block' | 'warn', message, path?, fix? }`; `ChannelOrder`, `ApiKey`, `WebhookEndpoint`, `WebhookDelivery`; the webhook event union.
- Changed: `Piece.sku` (unique per org; `PieceInfo.sku` now receives it), `StoneQuality.treatment`, `Actor += { type: 'apiKey', keyId }`, `Capabilities += channels: string[], publicMedia`, `METERS += 'channel', 'egress'`, `ServerEvent += listing.updated { listingId, pieceId, state, progress }`, `PIECE_TABS += 'publish'`, `org.settings += rates` (the shared rate card; `production.create` defaults to it).

**Commands**

| Command | Input → output | Flags |
|---|---|---|
| `product.get` | `{pieceId}` → `Product` | query, tool |
| `product.update` | `{pieceId, rev?, patch}` → `Product` | tool |
| `product.check` | `{pieceId, connectionId?}` → `{findings, blocked}` | query, tool |
| `product.attestPhoto` | `{pieceId, assetId, shows: 'this-piece' \| 'earlier-example'}` | person only |
| `production.estimate` | `{pieceId, selections[], rates?}` → `{facts, estimates[]}` | query, tool |
| `channels.list` | → `{providers[], connections[]}` | query, tool |
| `channels.connect` | `{provider, shop?, credentials?}` → `{connection}` or `{authorizeUrl}` | admin, no tool |
| `channels.update`, `channels.disconnect` | `{id, settings?}` | admin, no tool |
| `channels.browse` | `{connectionId, q?, cursor?}` → remote listings to link | query |
| `listings.list` | `{pieceId?, connectionId?, state?}` → `Listing[]` | query, tool, rest |
| `listings.prepare` | `{pieceId, connectionId, externalId?, manages, settings}` → `Listing` (nothing sent) | tool |
| `listings.review` | `{id}` → `{digest, diff, steps, findings, feeUsd}` | query, tool |
| `listings.publish` | `{id, digest, mode: 'draft' \| 'live'}` → `Listing` | admin, **confirm** |
| `listings.unpublish` | `{id, mode: 'deactivate' \| 'delete'}` | admin, **confirm** |
| `listings.export` | `{pieceId, provider}` → `Asset` (kit zip) | tool |
| `inventory.set` | `{items: [{sku, quantity}]}` | **confirm**, rest |
| `catalog.list`, `catalog.get` | published products, variants, media URLs; filter by `sku`, `updatedSince` | query, rest |
| `orders.list`, `orders.get`; `orders.start {id}` → `{pieceId}` | P3 | rest (reads); start: **confirm** |
| `apiKeys.create/list/revoke`; `webhooks.create/list/update/delete/deliveries/replay/test` | | admin, no tool |

**`ChannelProvider`**
```ts
id; label
capabilities(): { export, link, push, draftFirst, inventory: 'none'|'replace'|'cas', orders: 'none'|'poll'|'webhook',
  auth: ('oauth'|'clientCredentials'|'apiKey')[], maxVariants, maxOptions, media: { image: { max, minPx }, video, model3d },
  mediaIngest: 'upload'|'url', requires: ('realPhoto'|'publicMedia')[], feeUsd }
exportKit(desired): FileData[] | null        // no credentials; this seam's linkOut
preflight(desired, account?): Finding[]      // pure
auth?: { begin; complete; refresh }
discover?(ctx): ChannelAccount               // shop, taxonomy, profiles: fetched and cached, never hard-coded
find?(ctx, q, cursor); read?(ctx, externalId): RemoteSnapshot
apply?(ctx, step, memo): { externalIds, fingerprint }      // idempotent per step.key
setInventory?; unpublish?; verifyWebhook?(headers, rawBody); pollOrders?(ctx, cursor)
```
`ctx.connection` is server-held, as in `SourcingContext`.

**Services.** `Services.channels: { list(); get(id) }`; the default holds `generic`, `catalog`, and export-only `shopify`/`etsy`, so the kit never answers 501. `ProductionService.estimate(piece, { selections, rates }, sctx)` evaluates once and reprices per selection.

**Tables** (all `org_id`, through `Repo`): `product`, `channel_connection` (`credentials_enc`, `key_version`, `refreshing_until`), `channel_account` (discovery cache), `listing` (pushed snapshot, id map), `listing_step`, `stock_movement` (append-only, unique `ref`), `published_media`, `channel_task`, `outbound_event`, `webhook_endpoint`, `webhook_delivery`, `inbound_event` (dedupe), `channel_order`. API keys use `@better-auth/api-key`, organisation-owned.

**Public surface (derived, not written).** `http/v1.ts` walks `commands`: each `rest` entry becomes a `/v1` route whose context comes from `Runtime.contextForApiKey` (the key's creator, role capped, scopes checked) and runs through `runtime.execute`. `GET /v1/openapi.json` is `z.toJSONSchema` over the same entries. Scopes: `catalog:read listings:read inventory:write orders:read mcp`. Outbound webhooks follow Standard Webhooks (`product.updated`, `media.published`, `media.revoked`, `listing.published`, `listing.updated`, `listing.sync_failed`, `inventory.updated`, `order.created`, `channel.disconnected`), written to `outbound_event` in the change's transaction. Unauthenticated: `/m/{token}/{sha12}/{rendition}.{ext}` (immutable; 410 once revoked), `/feeds/{token}/{format}`, `/api/channels/{provider}/webhook/{connectionId}`.

## 4. Hard parts & decisions

1. **"We provide the renders" against real-photo and AI rules.** `source` derives from `origin`, never from the client or a vision guess. `requires: ['realPhoto']` blocks; renders go as supplements with a disclosure line; AI-model images only as `shots.export` labelled copies; every rendition carries XMP `DigitalSourceType`. *Rejected:* warn-and-publish; classifying uploads with vision.
2. **Only what was reviewed ships.** `listings.publish` takes the `digest` from `listings.review`; the server re-plans and answers 409 if design, media, price or remote moved. Agents pause on `confirm`. Over REST, an admin-granted scope is the standing consent for `inventory.set`; publishing has no `rest` entry. *Rejected:* auto-sync on design change; a second route registry.
3. **Linked listings and full-replace APIs.** `manages: 'media'` touches images only. `manages: 'all'` sends complete variant and file lists from the stored id map (Shopify `productSet`, Etsy inventory) and aborts if the remote has variants Pavé does not know. *Rejected:* partial patches.
4. **Variants without duplication.** One `VariantSelection` compiles to ops (facts and cost, in memory, never committed) and to render overrides (matching takes, rule 11). Prices come only from `production.estimate`; a person confirms each. *Rejected:* a piece per variant; arbitrary `Op[]` axes (P1).
5. **Non-idempotent creates, partial failure.** A `listing_step` intent row precedes each call; a retry `read`s and adopts by SKU or `customId`; a second sync plans zero steps. Etsy's quota is per app key: one bucket, per-org fair queue, a reserve for stock pushes.
6. **Stock truth.** Pavé owns stocked quantities for `manages: 'all'`; `stock_movement.ref` dedupes order lines; a one-of-a-kind sale zeroes other channels before any content sync. *Rejected:* a channel as source of truth.
7. **Public media and secrets.** Immutable content-addressed URLs for Live media only. *Rejected:* signed expiring URLs (feeds re-crawl); opening `/api/assets`; tokens in Better Auth's user-scoped `account` table.

## 5. Verification

- **Vitest, pure:** `variantOps` goldens; `buildDesired` on `packages/production/src/testing/fixtures.ts`; a pass and a fail per compliance rule; `planSync` property test (apply, then re-plan is empty); feed goldens; Standard Webhooks spec vectors.
- **`fakeChannel`** (full replace, non-idempotent create, 429, token rotation, a crash between any two steps); `PAVE_CHANNEL_FAKE=1` registers it for e2e. **Cassettes:** Etsy requests type-checked against `etsy-ts` (dev-only); Shopify 2026-10 documents snapshot-tested.
- **Server harness:** tenancy across two organisations (listings, `/m`, feed tokens, keys); roles; digest 409; resume after a kill without duplicate images; inbound dedupe → stock 0 elsewhere; every `rest` route scope-checked; OpenAPI snapshot; XMP read back from `/m`; no secret in any output; delivery and retry to a loopback receiver.
- **Screenshots** (`apps/studio/e2e/shots.ts`): every state in §1; light and dark; keyboard-only.
- **Unverifiable here:** live OAuth and app review; quotas; Etsy taxonomy ids and photo-policy enforcement; Shopify's `write_publications` grant; feed crawlers; XMP survival on CDNs.

## 6. Scope cuts

Out of v1: automatic publishing; publishing over REST; third-party OAuth apps; per-channel copy, prices and currencies; mixed stocked and made-to-order variants; carat as an axis; multi-location stock; video transcoding; shipping-profile editing; personalization beyond one engraving line; tracking; C2PA signing; 3D on Google; Amazon, Faire.

- **P0, offline:** product record, live media with provenance, check, listing kit.
- **P1, no approvals:** Pavé catalogue (public media, feeds, API keys, `/v1`, outbound webhooks). File the Etsy and Shopify applications and read the primary policy pages now.
- **P2:** sync engine; Shopify with the merchant's own Dev Dashboard app: link and pictures first, then full listings and stock.
- **P3:** Etsy with bring-your-own keys behind the photo gate; order ingest. `orders.start`, only once paid and off hold, composes `pieces.duplicate` and `design.apply` (the variant's ops) into a job piece; its Sourcing tab (Diaex links) and `production.create` are the next steps. Later: hosted apps, Google, Meta, Pinterest, eBay, TikTok, WooCommerce.

## 7. Build order

1. **Contracts and product**: schema, migration, `Piece.sku`, `variants.ts`, `production.estimate`, `product.get/update`. Harness and goldens.
2. **Media and check**: provenance, `attestPhoto`, `readVariant` renditions with XMP, `compliance.ts`, `product.check`.
3. **Kit and Publish tab**: `exportKit`, `listings.export`, the tab. Screenshots. *P0 done.*
4. **Catalogue**: `/m`, `catalog` connection, `prepare/review/publish` with digest, feeds, `catalog.*`.
5. **API**: keys, `http/v1.ts`, OpenAPI, `channel_task`, outbound webhooks, `ApiSettings`. *P1 done.*
6. **Engine**: `planSync`, steps, `secrets.ts`, tokens, connect, browse and link, `fakeChannel` end to end, `/channels`.
7. **Shopify**: client credentials, staged uploads, media-only then `productSet`, inventory, inbound webhooks.
8. **Etsy and orders**: photo-gated draft-first publish, receipts polling, `orders.*`.
