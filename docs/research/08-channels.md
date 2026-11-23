# 08 — Sales channels: publishing a piece to Etsy, Shopify and "any provider"

_Research date: 2026-11-23. Consolidates four researcher reports._

**Evidence.** No official docs host was reachable, only npm and GitHub. **[V]** = read first-hand in a spec, SDK typings or this repo. **(unverified)** = search summary of the linked page, third-party reporting or recall; on a heading or caption it covers everything beneath.

## 1. Etsy

[V] source: `etsy-ts@8.0.1` (2026-08-15), generated from Etsy's OAS (`https://www.etsy.com/openapi/generated/oas/3.0.0.json`). Paths sit under `https://api.etsy.com/v3/application`. No official SDK: generate types from the OAS.

| Topic | Finding |
|---|---|
| Tiers | **Seller App** (July 2026; own shop, light approval) → **Personal App** (deeper review) → **Commercial Access** (manual review; needed once other sellers connect, reportedly beyond about 4 shops). [V] in `etsy-seller-mcp-hub` docs citing [#1647](https://github.com/etsy/open-api/discussions/1647); Etsy's wording (unverified) |
| Key | `x-api-key: <keystring>:<shared_secret>` on every request [V, SDK READMEs]; required 2026-01-18 or enforced 2026-02-09 ([#1531](https://github.com/etsy/open-api/discussions/1531)), both past |
| OAuth | Code + PKCE, `grant_type=refresh_token`, `POST /v3/application/scopes` introspects [V]. Authorize `https://www.etsy.com/oauth/connect`, token `https://api.etsy.com/v3/public/oauth/token`, S256; access token 3600 s, refresh 90 days, rotating (unverified) |
| Scopes | `listings_r listings_w listings_d shops_r transactions_r`; `shops_w` for profiles, `transactions_w` for tracking. Per-endpoint mapping (unverified) |
| Rate limits | Per app key, shared by every tenant; sliding 24 h; 429 with `retry-after` ([doc](https://developers.etsy.com/documentation/essentials/rate-limits), unverified). *Contradiction:* defaults reported as 5 QPS / 5,000 QPD ([#1387](https://github.com/etsy/open-api/discussions/1387)) or 10 / 10,000; neither confirmed, budget for the lower |
| Fees | $0.20 on publish and each 4-month renewal; `should_auto_renew` [V]. Each further unit sold $0.20; edits free ([fees](https://www.etsy.com/legal/fees), unverified). `sold_out` → `active` sets quantity 1 and renews [V] |

**Publish sequence [V]**

| # | Call | Notes |
|---|---|---|
| 0 | `getMe`, `getShopByOwnerUserId`, `getShopShippingProfiles`, `getShopReturnPolicies`, `getShopReadinessStateDefinitions`, `getShopProductionPartners`, `getShopSections` | Resolve ids; create with `createShopShippingProfile`, `createShopReturnPolicy`, `createShopReadinessStateDefinition` |
| 1 | `getSellerTaxonomyNodes`, `getPropertiesByTaxonomyId` (`GET /seller-taxonomy/nodes/{taxonomy_id}/properties`) | Scales and allowed `value_ids`. Jewelry id unconfirmed (1179 by recall, 1430 in a scraper's docs): fetch, never hard-code |
| 2 | `createDraftListing`, `POST /shops/{shop_id}/listings` | Required `quantity, title, description, price, who_made, when_made, taxonomy_id`; `shipping_profile_id` for `type: physical` |
| 3 | `uploadListingImage`, `POST …/listings/{listing_id}/images` (multipart) | `image`, `listing_image_id`, `rank` (default 1), `overwrite`, `is_watermarked`, `alt_text` ≤500 chars; 20 images max |
| 4 | `uploadListingVideo`, `POST …/videos` | `video` + `name`, or an existing `video_id` |
| 5 | `updateListingInventory`, `PUT /listings/{listing_id}/inventory` | Full replace of `products[]` |
| 6 | `updateVariationImages`, `POST …/variation-images` | `[{property_id, value_id, image_id}]`; one property; overwrites all |
| 7 | `updateListingProperty`, `PUT …/properties/{property_id}` | `value_ids[]`, `values[]`, `scale_id?`; one call per attribute; `getListingProperty` (singular) returns 501 |
| 8 | `updateListingPersonalization`, `POST …/personalization` | Full replace |
| 9 | `updateListing`, `PATCH /shops/{shop_id}/listings/{listing_id}`, `state: "active"` | Needs an image, shipping profile and `return_policy_id` (not EU shops). Billable |

- **Draft fields [V]:** `who_made: i_did | someone_else | collective`; `when_made: made_to_order | 2020_2026 | …` (era value changes yearly); `styles[]` 2 × 45 chars; `% : & +` once each in titles. Title 140 chars, 13 tags × 20 chars, 13 materials (unverified).
- **Inventory [V]:** product = `sku`, `property_values[]`, `offerings[{price, quantity, is_enabled, readiness_state_id}]`, plus `price_on_property[]`, `quantity_on_property[]`, `sku_on_property[]`, `readiness_state_on_property[]`; no parentheses in values. Max 2 variation properties, custom ids 513/514, 200 = primary colour (unverified).
- **Made-to-order [V]:** a readiness state holds `ready_to_ship | made_to_order`, `min/max_processing_time` 1–10, `days | weeks`, per listing or per offering, so one listing can mix both.
- **Personalization [V]:** legacy fields were scheduled for removal 2026-04-09; now `personalization_questions[]` with `question_type: text_input | dropdown | unlabeled_upload | labeled_upload`, `question_text` 1–45 chars, dropdown labels 20, `add_on_price`. The spec still says only one `text_input` works.
- **Production partners [V]:** read-only (`getShopProductionPartners`), created in Shop Manager; `who_made: someone_else` requires one (unverified).
- **Stock and orders [V]:** read with `getListingsInventoryByListingIds` (`GET /listings/batch/inventory`, 100 ids, 404 if any is missing; `Inventory` is no longer a `getListing` include, [#1653](https://github.com/etsy/open-api/discussions/1653)); write is full replace, so read-modify-write. `state`: `active | inactive`; `deleteListing`. Orders: `getShopReceipts` (`min_last_modified`, `was_paid`, `limit` ≤100), `createReceiptShipment` (`POST …/receipts/{id}/tracking`).
- **Webhooks (unverified):** launched for commercial apps ([#1509](https://github.com/etsy/open-api/discussions/1509)); thin payload (`event_type`, `resource_url`, `shop_id`), Standard Webhooks signing, portal setup (no subscription endpoint in the typings [V]). *Contradiction:* Etsy's snippets show only `order.paid` and `order.canceled`; [Hookdeck](https://hookdeck.com/webhooks/platforms/guide-to-etsy-webhooks-features-and-best-practices) claims 11 events including `inventory.out_of_stock`, open to personal apps. Etsy's snippets are more credible: rely on order events plus `getShopReceipts?min_last_modified=` polling.
- **API terms** ([etsy.com/legal/api](https://www.etsy.com/legal/api), unverified): show the notice "The term 'Etsy' is a trademark of Etsy, Inc. This application uses the Etsy API but is not endorsed or certified by Etsy, Inc."; cached listing content ≤6 h old, other content 24 h.

**Image policy (unverified, highest risk).** [Listing Image Requirements](https://www.etsy.com/legal/policy/listing-image-requirements/253962679005), reportedly updated 2026-10-22 and revised 2026-11-06 ([help article](https://help.etsy.com/hc/en-us/articles/44297885802647-How-Do-Etsy-s-Listing-Image-Requirements-Apply-to-My-Listings), [DC360](https://www.digitalcommerce360.com/2026/10/26/etsy-ai-policy/amp/), [ppc.land](https://ppc.land/etsy-forces-sellers-to-show-one-unaltered-photo-in-every-listing/)): most listings need one unedited photo of the real item on a real background; AI-generated or AI-edited images are supplements, disclosed in the description; the listing form flags detected AI images; "bot-generated listings without human involvement" are prohibited; non-compliance can lose a not-as-described case. *Contradiction:* the Etsy report could not confirm the change and leans "real photo first"; the compliance report says it need not be first. The latter is more credible (it cites Etsy's help article and the revision date); photo-first is a recommendation, mandatory only for personalized items. Both agree CAD renders are unaddressed, the mockup exception is print-on-demand only, and made-to-order listings should show previously made pieces.

## 2. Shopify and storefront platforms

`@shopify/shopify-api` 15.1.2 (2026-11-19, Node ≥22) lists versions `2024-10` to `2026-10` [V]: quarterly, `2026-10` current. The rest of this section is (unverified) unless tagged.

| Concern | Call | Limits and behaviour |
|---|---|---|
| Upsert | `productSet(identifier: {id \| handle \| customId}, input, synchronous)` | Lists are full replace: omitted variants are deleted ([reference](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/productSet)). 2,048 variants, 3 options, 50,000 inventory quantities per call ([changelog](https://shopify.dev/changelog/posts/productset-limit-for-inventory-quantities.md)) |
| Media | `input.files: [FileSetInput]` (`originalSource` URL or file `id`) | Full replace; `productCreateMedia` deprecated. A [thread](https://community.shopify.dev/t/productset-mutation-with-duplicateresolutionmode-replace-causes-images-to-disappear-every-other-time/14516) reports images dropped on alternate calls |
| Upload | `stagedUploadsCreate` → PUT/POST → `resourceUrl` | Probably required for video and 3D (`model/gltf-binary`, exact `fileSize`) |
| Specs | `input.metafields`, `metafieldsSet` | 25 per call, 256 definitions per resource, values 64 KB, `json` 128 KB ([limits](https://shopify.dev/docs/apps/build/metafields/metafield-limits.md)) |
| Stock | `inventorySetQuantities` | From `2026-04`: `changeFromQuantity` compare-and-swap and an `@idempotent` key ([changelog](https://shopify.dev/changelog/posts/finalizing-compare-and-swap-redesign-for-inventory-set-quantities.md)). Made-to-order: `inventoryPolicy: CONTINUE` or `tracked: false` |
| Go live | `publishablePublish(id, input: [{publicationId}])` | Needs `write_publications`; forum posts conflict on whether public apps get it, confirm |

- **Taxonomy [V]** (`Shopify/product-taxonomy`): `aa-6` Jewelry, `aa-6-9` Rings (`-9-2` engagement, `-9-1` wedding bands), `aa-6-8` Necklaces, `aa-6-6` Earrings, `aa-6-3` Bracelets, `aa-6-5-1` Pendants, `aa-6-1` Anklets, `aa-6-13` Dental Grills; ids as `gid://shopify/TaxonomyCategory/aa-6-9`. Ring attributes include `jewelry_material`, `metal_purity`, `gemstone_type`, `diamond_clarity`, `main_gemstone_creation_method`, `stone_shape`, `ring_size`, `plating`; none for carat, metal weight or dimensions, so use app metafields.
- **Rate limits** ([docs](https://shopify.dev/docs/apps/build/apis/graphql-admin/rate-limits)): 100 points/s standard, 200 Advanced, 1,000 Plus, 2,000 enterprise, per app and store; 1,000 points per query; `productSet` base cost 10; bulk operations exempt.
- **Scopes** (names unverified): `read/write_products`, `read/write_inventory`, `read_locations`, `read/write_publications`, `write_files`, `read_orders`.
- **Webhooks:** `products/update`, `inventory_levels/update`, `orders/create`, `app/uninstalled`; base64 HMAC-SHA256 of the raw body in `X-Shopify-Hmac-Sha256`; dedupe on `X-Shopify-Webhook-Id` / `X-Shopify-Event-Id` (header names [V]).

| Route | Token | Gates (Nov 2026) |
|---|---|---|
| Public app | Expiring offline token (1 h) + rotating refresh (90 days) | Review, listed or unlisted ([forum](https://community.shopify.dev/t/unlisted-shopify-app-review-required-before-installation/33101)); expiring tokens mandatory for new apps since 2026-04-01, all from 2027-01-01 ([changelog](https://shopify.dev/changelog/expiring-offline-access-tokens-required-for-all-public-apps-as-of-january-1-2027)); IP allowlist since 2026-11-20 ([changelog](https://shopify.dev/changelog/ip-allowlists-are-now-required-for-public-apps)); Shopify billing; submission cooldown and identity checks (2026-11-10) |
| Custom distribution | Same | One store or Plus organisation; no review; IP allowlist outside your organisation ([changelog](https://shopify.dev/changelog/ip-allowlists-are-now-required-for-custom-apps-installed-outside-your-organization)); cloning per merchant not allowed |
| Merchant's own Dev Dashboard app | `grant_type=client_credentials` to `https://{shop}.myshopify.com/admin/oauth/access_token`, `expires_in` 86399 s | Same organisation only ([docs](https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant)); exempt from both mandates. No new pasteable `shpat_` tokens since 2026-01-01 ([changelog](https://shopify.dev/changelog/posts/legacy-custom-apps-can-t-be-created-after-january-1-2026.md)) |

**Other storefronts**

| | WooCommerce v3 | Squarespace | Wix Catalog V3 | BigCommerce v3 |
|---|---|---|---|---|
| Auth | Consumer key/secret; self-serve via `/wc-auth/v1/authorize` [V]; no review | Site API key (Commerce Advanced) or registered OAuth | OAuth app or site key | `X-Auth-Token` or app OAuth |
| Products | `POST /wp-json/wc/v3/products`, `/products/{id}/variations`, `/products/batch` [V]; 100 per batch | Products API v2 (GA 2025-12-18); 250 variants | `createProductWithInventory`; 6 options, 1,000 variants [V]; sites are V1 or V3 | `/v3/catalog/products`; 600 variants, 250 values per option |
| Made-to-order | `backorders: no \| notify \| yes` [V] | "unlimited" flag | pre-order fields [V] | inventory tracking none |
| Webhooks | `X-WC-Webhook-Signature` HMAC-SHA256; disabled after 5 failures [V] | Subscriptions API 1.0; orders need OAuth | JWT | `store/product/inventory/updated`; signing header disputed |
| Limits, SDK | Host-dependent; `@woocommerce/woocommerce-rest-api` 1.0.2 [V] | 300 requests/min | `@wix/stores` 1.0.1010 [V] | Plan quota per 30 s |

One capability-driven `ChannelProvider` fits all five.

## 3. Other channels and feeds

| Channel | Access | Push surface | Verdict |
|---|---|---|---|
| Google Merchant Center | Merchant API v1, scope `https://www.googleapis.com/auth/content` [V]; Content API sunset 2026-08-18 (unverified) | `POST /products/v1/accounts/*/productInputs:insert`; `FileInput` `FETCH` with `fetch_uri` daily/weekly/monthly; `PRODUCT_STATUS_CHANGE` to a `call_back_uri` [V] | Feed first |
| Meta catalog | `catalog_management` + app review (unverified) | `POST /{catalog_id}/items_batch` [V], 5,000 items per call, 100 calls/hour (unverified); feeds `HOURLY` to `MONTHLY` [V]. Native checkout reportedly phased out, sources conflict | Feed |
| Pinterest | OAuth2 `catalogs:read/write` [V] | `POST /v5/catalogs/feeds` (URL, optional basic auth, daily); `POST /v5/catalogs/items/batch` ≤1,000 items; `UPSERT` only without a feed source [V] | Feed |
| TikTok Shop | `app_key`, HMAC-SHA256 `sign`, `x-tts-access-token` [V, third-party client]; review, and diamonds/precious metals restricted or invite-only (unverified) | Under `/product/202309`: `/products`, `/images/upload` (`use_case=MAIN_IMAGE`), `/files/upload`, `/products/listing_check`, `/categories/{id}/rules`. `/order/202309/orders/search`; `/event/202309/webhooks` | Adapter, P3; only native made-to-order type |
| eBay | OAuth, scope `sell.inventory` [V] | `PUT /inventory_item/{sku}` → `POST /offer` → `POST /offer/{offerId}/publish`; `POST /bulk_update_price_quantity`; business policies required; Notification API [V] | Adapter, P3 |
| Amazon | SP-API, LWA, role approval; $1,400/yr fee cancelled May 2026 ([report](https://ppc.land/amazon-drops-sp-api-fees-after-developer-pushback)) (unverified) | `PUT/PATCH/DELETE /listings/2021-08-01/items/{sellerId}/{sku}`, 5 rps; `GET /definitions/2020-09-01/productTypes/{productType}`; `ORDER_CHANGE` [V]. No evidence Handmade works via SP-API; $39.99/month waived, about 15% referral (unverified) | Defer; reach via feed tools |
| Faire | API v2, `X-FAIRE-ACCESS-TOKEN` (unverified) | Products, inventory by SKU, orders | On demand |
| 1stDibs, Catawiki, Chrono24, Folksy, NOTHS | No public seller API (unverified) | — | Listing kit: image ZIP, CSV, copy |

Jewelry tools (unverified): [PIRO](https://www.gopiro.com/integrations) and Valigara (about $199/month) could consume Pavé's API; Jewel360 and The Edge (15-minute sync) sit behind Shopify. No adapters.

**Generic layer.** Google's feed attributes are the common format: Pinterest and Meta reuse `id, title, description, link, image_link, additional_image_link, price, availability, google_product_category, item_group_id, brand, gtin, mpn, color, material, size, custom_label_0–4` [V]. Channable, Feedonomics and LitCommerce pull a hosted file (unverified), reaching Amazon, Walmart and the long tail. The agentic [ACP feed](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol) (2026-04-17: `POST /feeds`, `PATCH /feeds/{id}/products`) and schema.org JSON-LD (`ProductGroup`, `Offer`, `subjectOf: 3DModel`) are [V].

| Target | Stocked | Made-to-order |
|---|---|---|
| Google | `IN_STOCK` | `BACKORDER` / `PREORDER` + `availability_date`, or `min/max_handling_time` [V] |
| Meta | `in stock` | `available for order` [V] |
| Pinterest | `in stock` | no such value; send `in stock` [V] |
| TikTok Shop | `inventory.quantity` | `pre_sale.type = MADE_TO_ORDER`, 3–14 business days US; `CUSTOM` 3–30 [V, client] |
| eBay | `shipToLocationAvailability.quantity` | quantity ≥1 [V]; handling time in the policy (unverified) |
| Amazon | quantity | `lead_time_to_ship_max_days` (unverified) |
| ACP / schema.org | `in_stock` / `InStock` | `backorder` / `MadeToOrder` [V] |

**Orders.** Google, Pinterest and Meta (website checkout) return none. Elsewhere webhooks, with polling to reconcile. A normalized order carries channel order id, a SKU that round-trips to piece and variant, options, engraving, price, hold state (TikTok `is_on_hold_order`) and ship-by date (TikTok `rts_sla_time`, Meta `ship_by_date`).

## 4. Media requirements per channel

All (unverified) unless tagged.

| Channel | Images | Video | 3D | Ingest | AI and render rule |
|---|---|---|---|---|---|
| Etsy | 20 [V]; JPG/PNG/GIF, ≥2000 px short side, about 10 MB | One, 5–15 s, ≤100 MB, no audio | — | Binary upload | One unedited real photo; AI only as a supplement |
| Shopify | <20 MB, ≤5000×5000 / 20 MP; 250 media | 1 GB / 10 min | GLB/USDZ ≤500 MB, re-optimised above 15 MB ([checklist](https://help.shopify.com/partners/resources/creating-3d-models/3d-model-standards-checklist)) | URL or staged upload | None found |
| WooCommerce / Wix / Squarespace / BigCommerce | Wix 50 [V]; BigCommerce 1,000; one per variant | Wix only | — | URL (Squarespace: upload and poll) | — |
| Google | 500×500 floor (dates conflict: 2026-06-30 vs 2027-01-31; treat as in force); ≤64 MP, 16 MB; 1 + 10; no AVIF | `video_links[]` [V] | `virtual_model_link` [V], ≤15 MB, US home goods and shoes: jewelry probably ineligible ([help](https://support.google.com/merchants/answer/13674896)) | URL, re-crawled | IPTC `trainedAlgorithmicMedia` kept ([policy](https://support.google.com/merchants/answer/14743464)); `structured_title` / `structured_description` ≤150 / 5,000 chars [V] |
| Meta | ≥500×500, 1080 square; 1 + 20; 8 MB | `videos` [V] | — | URL | "AI info" label from C2PA/IPTC ([Meta](https://about.fb.com/news/2025/02/gen-ai-transparency-metas-ads-products/)) |
| Pinterest | ≥75×75; 1 + 10 [V] | mp4/mov/m4v ≤2 GB [V] | — | URL | `ai_disclosures: ai_modified \| synthetic_performer` [V] |
| TikTok Shop | 300–4000 px, description images 1600×1600, ≤9 (5+ recommended), first on white [V, client]; ≤5 MB | 1:1, ≥720p, 20–60 s [V, client] | — | Binary upload | Visible AI label, weak sources |
| eBay | ≥500 px; 24, or 12 per variation [V]; AVIF/HEIC/WEBP accepted [V] | One, `createVideo` [V], ≤150 MB | — | HTTPS URL | — |
| Amazon | White main image | — | — | URL | Main never fully AI; disclose AI people since July 2026 ([eWeek](https://www.eweek.com/news/amazon-ai-generated-product-images-labels-new-york-law/)) |
| ACP feed | Array, first is primary [V] | `type: video` [V] | `type: model` [V] | URL | — |

## 5. Compliance and disclosure checklist

**Law (unverified; FTC section numbers from memory).**
- **EU AI Act Art. 50**, applied 2026-08-02; existing systems have until **2026-12-02** for Art. 50(2) machine-readable marking, detection interoperability until 2027-02-02 ([Sidley](https://datamatters.sidley.com/2026/06/24/eu-ai-act-transparency-obligations-preparing-for-compliance-by-2-august-2026/), [FAQ](https://digital-strategy.ec.europa.eu/en/faqs/transparency-obligations-under-article-50-ai-act)). Pavé's watermark does not discharge the jeweler's Art. 50(4) visible label on realistic synthetic people.
- **New York GBL §396-b**, effective 2026-06-09: conspicuous disclosure of synthetic performers; $1,000, then $5,000 ([Hunton](https://www.hunton.com/privacy-and-information-security-law/new-york-enacts-law-regulating-the-use-of-ai-generated-synthetic-performers-in-advertising)).
- **FTC 16 CFR 23:** §23.1 true-size, §23.2 "handmade", §23.3 karat beside "gold", §23.4 vermeil (sterling base, ≥2.5 µm), §23.12 "laboratory-grown" immediately before "diamond", §23.24 treatments, §23.17 carat accuracy (".30 ct" = 0.295–0.304). 16 CFR 465/255: a synthetic model is never a customer or testimonial.
- **EU/UK:** UCPD Arts 6–7; CRD Art 16(c) (no withdrawal for made-to-spec, stated); GPSR responsible person; UK hallmark notice; [ASA](https://www.asa.org.uk/news/disclosure-of-ai-in-advertising-striking-the-balance-between-creativity-and-responsibility.html): disclosure does not cure a misleading image.

**Pre-publish check.** In the repo [V]: stone `origin: natural | lab | any` (`packages/schema/src/design/nodes.ts:72`), vermeil platings (`domain/metals.ts:74`), `c2pa: false` (`apps/server/src/services.ts:396`); no treatment field.

| # | Trigger | Rule | Level |
|---|---|---|---|
| 1 | Diamond, `origin=lab` | "lab-grown" / "laboratory-created" immediately before every "diamond"; ban "real", "genuine", "natural", bare "cultured" | Block |
| 2 | `origin=any` | Resolve before publishing | Block |
| 3 | Moissanite, CZ | Gem name or "simulated diamond"; never "lab diamond" | Block |
| 4 | Lab coloured stone | "laboratory-created sapphire" | Block |
| 5 | Treatment (new enum: none / heat / filled / irradiated / HPHT / coated / unknown) | Disclose per §23.24 | Block; `unknown` warns |
| 6 | Gold alloy | "14K gold"; no bare or "solid" gold if plated or hollow | Block |
| 7 | Plating | Disclose, rhodium included; "vermeil" only on 925 at ≥2.5 µm | Block |
| 8 | Carat | Computed value, never rounded up; "ctw"; "approx." for made-to-order | Block |
| 9 | CAD or cast | No unqualified "handmade" | Block |
| 10 | Image `source` | Etsy: one unedited `photo`. Amazon: main not `ai_generated` | Block per channel |
| 11 | Image revision ≠ variant | Stale render; regenerate | Block |
| 12 | `render` | "Digital rendering; made to order"; mm dimensions; one true-scale image | Warn |
| 13 | `syntheticPerson` | Visible "AI-generated model" label; never a testimonial | Block |
| 14 | Generative image | IPTC DigitalSourceType + C2PA in every rendition | Block for Google |
| 15 | EU / UK | GPSR contact, withdrawal notice, hallmark notice | Warn |
| 16 | Generated copy | Ban "certified" (without a report number), "conflict-free", "hypoallergenic", "tarnish-proof", "eco-friendly", "investment" | Warn |

**DigitalSourceType** (enum [V] in [c2pa-rs](https://github.com/contentauth/c2pa-rs/blob/main/sdk/src/assertions/actions.rs)): jeweler's photo `digitalCapture`; AI on-model `trainedAlgorithmicMedia`; render in an AI scene `compositeSynthetic`; AI-retouched photo `compositeWithTrainedAlgorithmicMedia`; Blender render `digitalCreation` (two reports agree; a judgement). C2PA rarely survives CDNs ([Cloudflare](https://developers.cloudflare.com/images/transform-images/preserve-content-credentials/), unverified); IPTC and the visible label carry the weight.

## 6. Public API, webhooks and media delivery

| Topic | Recommendation |
|---|---|
| Auth | Org-owned keys via `@better-auth/api-key` 1.7.27 ([V]: `references: "organization"`, `permissions`, `expiresAt`); OAuth apps later via `@better-auth/oauth-provider`. Gaps [V]: no rotation (expire the old key after 24 h), default limit 10 requests/day, default header `x-api-key` (`customAPIKeyGetter` for `Authorization: Bearer`) |
| Keys, scopes | `pave_live_…` / `pave_test_…`, 64 chars, shown once. `products:read media:read listings:read listings:write channels:read channels:write inventory:write orders:read webhooks:write` |
| Limits | Per-org token bucket (10 rps, burst 50); 429 + `Retry-After`; `Idempotency-Key` on POST, kept 24 h, `409` in flight, `422` on mismatch; RFC 9457 errors |
| Shape | `/v1`, additive only, reserved `Pave-Version: YYYY-MM-DD`; cursor lists (`?limit=50&starting_after=` → `{data, has_more, next_cursor}`), `updated_since`, `expand[]` |
| One registry | Add `rest?: {method, path, scope}` beside `tool` on `CommandDef` (`packages/schema/src/api/commands.ts:68` [V]); OpenAPI 3.1 from `z.toJSONSchema(…, {target: 'draft-2020-12'})` (zod 4.6.7 [V]); `tool.confirm` becomes `POST …/publish`; MCP via `@modelcontextprotocol/sdk` 1.32.2. Skip `@hono/zod-openapi` 1.6.3 (needs its own `createRoute`) |

**Webhooks:** [Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md) [V]. Headers `webhook-id`, `webhook-timestamp`, `webhook-signature`; `v1,base64(HMAC-SHA256(secret, "id.timestamp.body"))`; `whsec_` secrets, two valid during rotation; 5-minute tolerance; payload `{type, timestamp, data}` under 20 kB; retries at 0, 5 s, 5 min, 30 min, 2 h, 5 h, 10 h, 14 h, 20 h, 24 h; `410` disables; SSRF-safe sender; replayable delivery log. Events: `product.updated`, `media.published`, `media.revoked`, `listing.published`, `listing.updated`, `listing.sync_failed`, `listing.compliance_failed`, `inventory.updated`, `order.created`, `channel.disconnected` (one report's `inventory.changed` is the same event).

**Media delivery.** `/api/assets/:id` is `Cache-Control: private` today (`apps/server/src/http/assets.ts:25` [V]), so no channel can fetch it. *Contradiction:* two reports suggest "signed or tokenized" URLs; the compliance report says public, unguessable, content-addressed, non-expiring. The latter wins: feed channels re-crawl for the listing's life and Shopify has failed on query-string URLs (unverified). Serve `/m/{mediaId}/{sha256-prefix}/{rendition}.jpg` as `public, max-age=31536000, immutable`; a changed image gets a new URL; unpublish returns `410`. Signed URLs (15 min–24 h) only for originals and production files. Feeds carry a token in the path (`/v1/feeds/{token}/{channel}.xml`). Renditions are a named set (`etsy`, `google`, `amazon_main`, `meta_square`) with IPTC and re-signed C2PA (`@contentauth/c2pa-node` 0.5.26, `sharp` 0.35.5); egress metered per org.

**Resources:** `products`, `variants`, `media` (provenance, `selected_for[]`, renditions), `channels`, `listings` (product × channel: external id, state, media order, compliance report), `orders` (read-only), `webhook_endpoints` (+ `/deliveries`).

## 7. Decisions for Pavé

- **The selection is the product.** Every asset carries `source: photo | photo_edited | render | ai_generated | ai_edited`, `syntheticPerson`, `digitalSourceType` and a design-revision hash (one enum, merging the reports' three variants). "Put in production" assigns it to ordered slots (`main`, `additional`, `lifestyle`, `video`, `model3d`) per listing.
- **Generic layer first:** public immutable media URLs, a published catalogue, Google-spec feeds (plus Meta CSV, Pinterest TSV, ACP JSON, JSON-LD), `/v1` REST and Standard Webhooks, projected from the command registry. It answers "any provider", has no review gate, and every adapter needs it.
- **Shopify is the first adapter:** renders are allowed, GLB (under 15 MB) is a differentiator, and one `productSet` with `customId` and complete variant and file lists is the whole sync. Ship "bring your own Dev Dashboard app" first; submit the public app in parallel (static egress IP, months of review).
- **Etsy is second and photo-gated.** Apply for Personal then Commercial Access now; accept bring-your-own keys per org. Publish is a resumable job that stops at draft until the user confirms the $0.20 activation, and refuses without one unedited real photo. Never promise render-only Etsy listings.
- **Fulfilment is `stocked {quantity}` or `made_to_order {lead_days_min, lead_days_max}`** per variant. A one-of-a-kind sale pushes zero to every other channel.
- **Compliance runs before every publish:** copy generated from structured data, linted with rules 1–9; add `treatment`; visible label on synthetic models by default; IPTC now (the 2026-12-02 deadline, unverified, is nine days out), C2PA after.
- **Adapters declare capabilities** (`maxVariants`, `maxOptions`, media kinds, `mediaIngest`, `inventoryMode`, `webhookVerify`, `auth`); inbound webhooks get one Hono route per provider with raw-body HMAC and dedupe.
- **Phasing.** P0: provenance, slots, public media, feeds, API keys, REST read, webhooks, listing kit. P1: Shopify, linter, order ingest. P2: Etsy, Google Merchant API, Meta `items_batch`, Pinterest feed registration. P3: eBay, TikTok Shop, WooCommerce. On demand: Amazon, Faire, Wix, Squarespace, BigCommerce.
- **First,** open the primary pages for Etsy's image policy (6 Nov text), Shopify `write_publications`, Amazon's AI-people rule and 16 CFR 23.
