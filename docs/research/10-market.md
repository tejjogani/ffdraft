# 10 — Market: who pays, for what, and where Pavé sits beside ERPs, channels and Diaex

_Research date: 2026-11-24. Consolidates five analyst reports (customers, ERP, commerce, competition, Diaex), three strategy memos and three judges' reviews. The decisions are in [`docs/strategy/product-strategy.md`](../strategy/product-strategy.md)._

**Evidence.** **[V]** = verified: read first-hand in this repo or in `/home/user/diaex-backend` (read-only; its paths are prefixed `diaex:`). **[S]** = search extract: a search summary of the linked page, not opened at source. **[E]** = expert judgement, with confidence (H/M/L) where it matters. On a table heading or caption a mark covers everything beneath. `gopiro.com`, `apps.shopify.com`, `stuller.com`, `vdbapp.com`, `rhinoartisan.com` and Etsy's policy pages were unreachable, so **no vendor price and no platform policy below was read at source.**

## 1. User zero: the founder's father

| Question | Finding | Confidence |
|---|---|---|
| Who | Operator of **Aska**: Aska Jewels Inc. (USA) and Aska Jewels Pvt Ltd (India). The bridge plan opens with the founder's "sign my dad up" [V: `diaex:docs/plans/2026-11-19-aska-sql-bridge.md:3,178`] | H |
| Trade | Lab-grown (CVD/HPHT) diamond trading; "DiaEx by Aska"; seller of record for Diaex's markup buyers, sends the purchase order and handles payment [V: `diaex:docs/DIAEX-REFERENCE.md:20`, `diaex:docs/SOURCING.md:723`] | H |
| System of record | A vendor-run jewellery ERP ("Heera") on SQL Server, database `DASS_JWLERPN_LIVE`, table `WebLiveStock`. **No API**; Diaex reads it through a read-only login with cost columns (`Rate`, `Amount`) denied; writing to it is a non-goal [V: `diaex:docs/ASKA-FEEDS.md`] | H |
| Own stock | 65–68 stones in July 2026 (PartyId 95), of 27,231 rows from all parties in the same database; whether 95 is his only id is open [V: bridge plan §3, D4]. About $20k at ask [E, L] | M |
| Finished jewellery | **Unknown.** "Jewels" in the name and a jewellery ERP hint at it; the repo shows only stone trading. No manufacturer, workshop or retailer is named anywhere [V: searched `DIAEX-REFERENCE.md`, `ASKA-FEEDS.md`, `SOURCING.md`] | L |
| Operator | "Not an engineer"; works from Diaex's admin panel and WhatsApp [V: `diaex:docs/plans/2026-10-25-admin-panel.md:47`] | H |

Consequences: he has an ERP and will not migrate; "I have X stones" means about 70 certified stones of 1 ct and up, plus seller-of-record access to roughly 18–23k supplier stones; and every pilot design assumes a maker and buyers of finished pieces that nobody has confirmed.

## 2. Customers and jobs

| Segment | Works today | Where money leaks | Pays for; how it buys | Size |
|---|---|---|---|---|
| **(a) Stone holders moving downstream** (lab-grown growers, cutters, wholesalers, memo dealers) | Stock in a vendor ERP or Excel; sales by WhatsApp, lists and memo; jewellery via an Indian CAD desk ($300–700/month per designer [E]) or job-work factory | Stock: lab-grown wholesale fell 26% in 2025, 14% YoY in Q1 2026, 13% in Q2 [S: Golan via JCK]; India's polished lab-grown exports fell 10.55% to $1.13bn in FY26 on higher volume [S: GJEPC]; carrying cost about 1–2% a month [E] | Sell-through, not seats. Owner decides after a demo on his own stock; accepts a per-order fee | GJEPC 10–11k exporter members, 85% MSME [S]; lab-grown houses with real stock: low thousands [E, L] |
| **(b) Bench and custom jewelers** | Sketch → freelance CAD → print → caster; Rhino or MatrixGold ($1k–7k [E]); paper job envelopes | Quotes take 3–7 days; each revision is a CAD round; remakes 3–8% of jobs [E, L] | $50–150/month if it replaces the freelancer | Part of 21,949 US trade businesses [S: JBT Q1 2026] |
| **(c) Online made-to-order brands** (Etsy, Shopify, Instagram) | Fiverr CAD; factory drop-ships; manual listings; orders in a spreadsheet | Listing labour 30–60 min per SKU [E]; photos; channel take 10–25% [E] | $20–80/month, self-serve, churn-prone | Etsy 5.6m sellers [S]; perhaps 10–30k fine made-to-order shops [E, L] |
| **(d) Custom-piece (hip-hop) jewelers** | Logo → specialist CAD ($300–1,500 [E]); pavé laid out by hand | Stone count guessed at quote; melee over- or under-bought | Per piece; high when a render closes a $5k–50k ticket | Low thousands in the US [E, L] |
| **(e) Retail stores with a custom counter** | Trade-shop CAD or CounterSketch; the POS is the ERP | Counter conversion lost while CAD is awaited | $150–500/month is normal for POS [S] | 16.6–16.9k US retailers, down 13–17% [S: JBT; two counts] |
| **(f) Casting houses, contract makers** | Receive STL/3DM and WhatsApp notes; re-do CAD | Bad files, re-quotes as metal moves | Little; adopt a free intake format | Thousands in India and Thailand [E, L] |

**Unit costs that anchor value**

| Item | Today | Mark |
|---|---|---|
| CAD, simple ring | $50–110 freelance, 1–7 days; studio from $400; factory CAD stage $50–200, 5–10 days | [S]; factory figure [V: `02-production.md`] |
| Product photo | $25–150 an image; $50–500 for complex pieces | [S, vendor blogs] |
| New SKU ready to sell (CAD + sample + photos) | $560–1,300 and 2–5 weeks; with Pavé a few dollars of compute and under an hour | [S] + [E] |
| 100-SKU line | $40k–150k goods + $7k–45k photography; rendered: under $1k | [E] |
| Admin per made-to-order sale | 60–90 minutes; pre-filled, about 15 | [E, M] |
| Online returns | 4–8% blended; bridal 10–15% online vs 2–4% in store; top driver is how the stone looks in real light | [S, vendor benchmarks] |
| Lab-grown wholesale | $100/ct to $250–500/ct for a 1 ct round: **sources conflict** | [S, L–M] |

A 1 ct lab-grown round is now about 10–15% of a $900–1,500 finished ring [E, M]: the margin has moved to the mounting, the picture, the channel and speed.

**Jobs, in priority order [E]**

1. *Turn stones I own, or can get, into pieces someone orders, before they lose more value.* Stones in, designs out: the reverse of Pavé's current flow. No tool found starts from a stock list.
2. *Give my trade customer a picture, a price and a stone list today, not next week.* Pavé already computes weight, bill of materials and cost from the design [V: `packages/production/src/bom.ts`, `cost.ts`].
3. *Show a line I have not made* (virtual inventory for line sheets and retailers' sites).
4. *Make it right first time at the factory* (the production package; no manufacturer-neutral equivalent found [V: `02-production.md` §6]).
5. *Stop retyping* (listing → order → job → stone allocation). A retention feature: it matters only once orders exist.
6. *Be my books.* Lowest: stone houses and stores have an ERP; Etsy sellers will not pay ERP prices.

Sources: [JCK](https://www.jckonline.com/editorial-article/lab-grown-wholesale-freefall/) · [Rapaport/JBT](https://rapaport.com/news/us-jewelry-business-closures-continue-to-ease/) · [GJEPC](https://gjepc.org/solitaire/gjepc-celebrates-historic-achievement-of-reaching-10000-members/) · [Upwork](https://www.upwork.com/services/product/design-custom-cad-jewelry-design-for-all-types-of-jewelry-pieces-1861729017909041967) · [Clipping World](https://www.clippingworld.com/product-photography-pricing) · [Branvas returns](https://branvas.com/blogs/news/jewelry-return-rates-by-category) · [Eightx](https://eightx.co/blog/average-jewelry-return-rate-benchmarks) · [Capterra PIRO](https://www.capterra.com/p/10031702/PIRO-Retail/).

## 3. ERP landscape: integrate, be, or migrate

| Segment | Record lives in | Price [S] | API and channels | Lock-in [E] |
|---|---|---|---|---|
| Micro maker | Sheets + QuickBooks/Xero + Etsy/Shopify admin; Stocksmith (was Craftybase) | $20–291/month | CSV; Etsy and Shopify import | Low |
| Shopify apps | Forge; Jewelry Studio Manager | $29–149; $9.99; both 0 reviews | Shopify only | None |
| Independent retailer | The Edge; Jewel360 | Edge $4,600 "Basic" (term unclear); Jewel360 $89 or $199/month (**conflict**) | Edge: no public API found, a Shopify connector | High |
| Manufacturer, wholesaler | PIRO Fusion; Valigara; Adaptive; Fulfil | PIRO $299–599/month; Valigara $199–600 (**conflict**); Adaptive from $149/user | PIRO and Valigara list an API and Shopify/Etsy links | Medium–high |
| India manufacturing and diamond trade | Heera, Ornate, Synergics, Tally beside them | Quote only | Mostly none: SQL or Excel ([V] for Heera, [E] otherwise) | High |

Patterns: every jewellery ERP "starts after the design is done" [V: `02-production.md` on PIRO] and item masters are typed by hand; the tools already converge on Shopify as channel hub [S]; at the bottom the incumbents are spreadsheets.

**The record an ERP needs, and what Pavé already holds**

| Record | Pavé today [V] | Verdict |
|---|---|---|
| Style, variants, SKU | `Product`, `VariantSelection`, `Piece.sku` (publishing plan) | Free from CAD |
| Bill of materials, weights | `BomLine`, `StoneRow` exist | Free from CAD |
| Cost | `CostEstimate` exists; **rates are placeholders** | Needs the jeweler's rate card |
| Media with provenance | Planned `MediaItem` | Free |
| Loose-stone stock, memo, cost | Not in Pavé; Diaex has `stones`, `availability: available \| memo`, connectors | Keep in Diaex |
| Finished stock, channel orders | Planned `stock_movement`, `channel_order` | Light version only |
| Job stages | `orders.start` planned; no stages | About six statuses, no more |
| Metal accounts, purchasing, invoices, repairs | None | Never (below) |

Four of the nine records come free from the CAD, and they are the four that ERPs make people type: **the design is the item master.**

| | Integrate | Be the light record | Migrate |
|---|---|---|---|
| What | `/v1` API, webhooks, CSV/XLSX; few named connectors | Styles, variants, stock counts, orders, job status | One-way import of items and stones |
| Build [E] | Generic layer is publishing P1; 3–6 engineer-weeks per connector, plus upkeep | 6–10 weeks beyond the publishing plan | 3–4 weeks for a mapping tool; 0.5–2 days per spreadsheet customer; 1–2 weeks per SQL ERP |
| Risk | Vendor refuses (Heera did [V]) | Scope creep into ERP | Promising a replacement |
| Fits | Retailers, manufacturers | Micro makers, small ateliers | Everyone, as import only |

- **Connectors worth building:** Shopify (The Edge, Jewel360, PIRO and Valigara already sync to it, so one adapter reaches five systems [S]); Etsy; invoice export to QuickBooks/Xero; PIRO only when a payer asks. Files or read-only SQL for The Edge, Indian desktop ERPs, Tally and Heera.
- **A credible import:** upload exports → the assistant proposes a column mapping and normalises vocabulary → dry run where row count, carats, grams and value equal the source → a person resolves flagged rows → each row keeps its source id and content hash → 2–4 weeks in shadow. Diaex already drafts supplier mappings with a model [V: `diaex:app/stock_draft.py`]; spreadsheet upload is not built there [V: `diaex:docs/STOCK-DEV.md`].
- **Never build [E, H]:** general ledger, tax filing, payroll; point of sale, payments, financing; repairs and appraisals; hallmark/HUID filing, KYC/AML; artisan metal accounts and loss by worker; multi-company consolidation. Each is regulated, per-country, owned by an entrenched vendor, and not improved by knowing the CAD.
- **Sync [V for the plan's mechanics, E for the field table]:** one owner per field, never per record. Inbound events are keyed by (channel, order, line) and stored before processing; outbound changes go to an outbox in the same transaction; webhooks trigger and polling decides; quantities are never last-write-wins (Shopify compare-and-swap, Etsy read-modify-write); a one-of-a-kind sale zeroes every other channel first. For a desktop ERP the same keys travel by nightly file and the oversell window equals the interval.

Sources: [PIRO](https://www.gopiro.com/pricing) · [Valigara](https://www.valigara.com/pricing/) · [Jewel360](https://jewel360.com/blog/best-jewelry-store-pos-systems) · [Edge Shopify guide](https://edgeuser.com/Portals/0/docs/TIP-2021-158_ShopifyIntegration.pdf) · [Stocksmith](https://craftybase.com/site/plans) · [Forge](https://apps.shopify.com/forge-2) · [Adaptive](https://www.capterra.com/p/144018/Adaptive-Jewelry-ERP/) · [Ornate](https://www.capterra.in/software/87168/ornate-software).

## 4. The commerce loop

| Step after a made-to-order sale | Manual today | Pavé + Diaex | Exists? [V] |
|---|---|---|---|
| Order arrives | Retyped into ERP or job sheet | Polled or webhooked; SKU maps to piece and variant | Planned P3 |
| Confirm size, engraving, stone | 2–5 messages | Variant → CAD ops → a render of that exact variant as proof | `variantOps` planned |
| Stone | Own stock, then WhatsApp | Variant's requirements matched on Diaex | Deep links only; Diaex has no partner API, webhooks or expiring holds |
| Job | STL and notes emailed | Package regenerated for that size, metal and stone | Package exists; per-order is `orders.start` (P3) |
| Ship, tracking | Pasted into the channel | `createReceiptShipment` | Cut from v1 |

A made-to-order lab-grown ring takes 10–15 working days [E, M].

**Etsy [S unless marked].** Listing $0.20 [V: `08-channels.md`], transaction 6.5%, processing 3% + $0.25; Offsite Ads 15%, or 12% and mandatory above $10k a year, capped at $100 an order.

| Order | Etsy, no ad | Etsy, ad-attributed | Shopify Basic |
|---|---|---|---|
| $300 | $28.95 (9.7%) | $73.95 (24.7%) | $9.00 |
| $1,800 | $171.45 (9.5%) | $271.45 (15.1%) | $52.50 |
| $4,300 | $408.95 (9.5%) | $508.95 (11.8%) | $125.00 |

- 86.5m buyers spending $121 a year each; jewellery share undisclosed. A real channel for $150–1,500 pieces, weak above about $3,000 [E, M].
- **Image policy:** since 22 October 2026 (revised 6 November) most listings reportedly need one unedited photo of the real item; AI and edited images are disclosed supplements; made-to-order should show a piece already made; CAD renders are not addressed [S; consistent with `08-channels.md`]. Etsy is make-one-then-list and cannot demand-test an unmade design.
- **Mechanics [V: `08-channels.md`]:** two variation axes; one reliable text personalisation; quota per app key, reportedly 5,000–10,000 calls a day shared by every shop, so 15-minute polling caps one key near 50 shops [E] until Commercial Access.

**What backs a listing**

| Model | Sync rule | State |
|---|---|---|
| Made to order | None; a lead time | Most CAD designs |
| Stocked one-off | A sale zeroes other channels first | Planned [V] |
| Stone class ("at least N Diaex stones match at or below $X") | Re-check daily; pause or reprice when low | Safe today for lab-grown |
| One named stone | Unlist within minutes of a sale | **Not safe:** no outbound events, 5-minute feed cache, 48-hour stale sweep, holds never expire [V] |

**Website from the catalogue [build effort E; prices S]**

| Option | Build | Verdict |
|---|---|---|
| Private trade catalogue: renders, facts, price, "request quote", no checkout | 2–3 weeks on the planned catalogue | The B2B wedge |
| Shopify store filled from the catalogue | 3–5 weeks after the adapter; app review takes months | Distribution; also the "website" answer |
| Embeddable configurator that changes real geometry and reprices | 6–8 weeks | Differentiated; ring builders charge $145–295/month, VDB $75–475/month plus $500–3,000 setup |
| Hosted storefront with checkout | 12–16 weeks, then permanent payments, tax, fraud, SEO | No: it rebuilds Shopify |

**Trade side [E].** Fine-jewellery wholesale runs on relationships, samples in hand, memo and net 30–60 terms; Faire takes 15% (0% on retailers you bring) [S]. A private link per buyer beats a marketplace here.

Sources: [Etsy Offsite Ads](https://help.etsy.com/hc/articles/360000338367) · [Etsy fees](https://checkoutpage.com/blog/etsy-fees) · [Etsy 10-K](https://www.sec.gov/Archives/edgar/data/1370637/000137063726000019/etsy-20251231.htm) · [DC360](https://www.digitalcommerce360.com/2026/10/26/etsy-ai-policy/amp/) · [ppc.land](https://ppc.land/etsy-forces-sellers-to-show-one-unaltered-photo-in-every-listing/) · [Shopify pricing](https://shopify.com/pricing) · [GemFind](https://apps.shopify.com/gemfind-ring-builder) · [Keyideas](https://apps.shopify.com/diamond-filter-ring-builder) · [VDB](https://vdbapp.com/pricing/integrations/) · [Faire](https://blog.faire.com/selling/north-america-pricing-update/).

## 5. Competition and business models

| Player | What it is | Numbers [S] | Lesson |
|---|---|---|---|
| **Stuller** (CounterSketch, MatrixGold) | Design software whose output Stuller makes | CounterSketch $2,495–2,995, $349/year; "50,000+ professionals" | Software covers itself; profit is the mounting, stones and labour. **Stuller owns the factory and the stock; Diaex owns neither** |
| **Star Gems** (GemArt AI) | A manufacturer gives retailers AI design, 20,000+ designs, live pricing (Jul 2026) | Pricing not found | The closest analogue to "dad plus Pavé", and his competitor for retailers |
| **Pencil** | AI agent for "rendered, parametric CAD", live pricing | $199/month Shopify app | Most direct competitor; closed, no stone marketplace |
| **RhinoArtisan** | Rhino plug-in; reportedly Nivoda's inventory in the design panel and CAD over MCP (Sept 2026) | Vendor claim | "CAD with a stone marketplace inside" is **not unique** |
| **Nivoda** | Stone marketplace, feeds, credit | $30m B, $51m C (2024), $60m credit line; "10,000+ jewelers"; 1.5–2% commission (a rival's claim) | Wins on capital and logistics; do not fight on breadth |
| BLNG, Gemist | Image-first design; configurator over fixed SKUs | $3m and $6m seeds (2025) | No castable CAD |
| Shopify Sidekick, image models | Product imagery | — | Commoditise ideation and renders, not mm-true geometry |

**Position.** "Editable CAD with a stone marketplace inside" is reportedly taken (RhinoArtisan with Nivoda). The unoccupied direction is the inverse: **stock → designs → listings → orders → stone marked sold** [E, M]. Pavé's real differences today [V]: every CAD stone is a structured requirement; the assistant and a person use the same logged commands; AGPL with STEP/STL, so no file lock-in; one record carries design, bill of materials, cost, package and listing. Not yet different [V]: no melee, coloured stones, metals or partner API on Diaex; **Diaex Buy is closed in production** (`diaex:docs/PRODUCTION.md:35`); `packages/agent/src` is empty.

**Revenue per account per month [E; take rates 3–5% certified, 6–8% parcels; referral 10% of labour; seat $79]**

| Segment | Software + credits | Stones via Diaex | Making referral | Total |
|---|---|---|---|---|
| Etsy or indie designer | $44 | $20 | up to $120 | $60–180 |
| Custom jeweler, 15 pieces | $248 | $400–675 | $375 | $1,100–1,400 |
| Iced-out house, 6 pieces | $297 | $1,800–2,400 | $300–600 | $2,500–3,300 |
| Wholesaler (dad) | $300–500 | 1–2% supplier side | — | $300–500 + sell-through |

Software is 20–25% of a real jeweler's value in this model, but every other column needs something that does not exist: open Buy, melee, a caster network. With lab-grown centres only (about $300 a piece) the same jeweler yields $135–225 of stone take, less than the seat fee [E]. Dealers resist a visible commission (RapNet markets "zero commission" [S]).

**Open source [V: `LICENSE`, AGPL-3.0].** Keep the kernel, schema, exporters, command registry and self-host server open; charge for what a self-hoster cannot replicate: render farm and managed AI keys, the Diaex connection (pricing is gated per KYC'd company), channel app access, organisations and audit. Precedents: Odoo, ERPNext, Cal.com, Medusa [E, M].

Sources: [CounterSketch](https://www.toolworthy.ai/en/tool/countersketch-gemvision) · [Star Gems](https://www.americangemsociety.org/star-gems-expands-gemart-ai-to-help-retailers) · [Pencil](https://jewellerymonthly.co.uk/pencil-launches-ai-jewellery-cad-design-agent/) · [Pencil app](https://apps.shopify.com/pencil-shop) · [RhinoArtisan + Nivoda](https://rhinoartisan.com/blog/all-of-nivodas-diamonds-now-inside-rhinoartisan/) · [Nivoda C](https://jewellerymonthly.co.uk/nivoda-secures-51m-to-expand-global-diamond-supply-chain) · [BLNG](https://tech.eu/2025/04/08/blng-secures-3m-for-ai-jewellery-design/) · [Gemist](https://nationaljeweler.com/articles/14047-gemist-raises-6m-in-funding-to-scale-jewelry-tech-platform) · [RapNet vs Nivoda](https://www.bizzbuzz.news/industry/jewellery/rapnets-zero-commission-trading-and-what-that-means-for-diamond-dealers-and-buyers-and-their-bottom-line-1382694).

## 6. Diaex synergy and inventory-first design

**Diaex today [V].** A B2B lab-grown directory: browse, pairs and layouts for 2–70 stones, assistant, price tracker, voice. Development holds 18,021 stones, all lab-grown, smallest 0.34 ct, 318 under 1 ct (`diaex:docs/plans/2026-10-31-pairs-and-large-layouts.md:34`). Production runs browse, assistant and voice; **Buy, Temporal and sourcing are deliberately not deployed**; traffic is "a handful of people" (`diaex:knowledge/migration-brief.md:24`). Revenue is designed (per-company markup with ASKA as seller of record; Pro) but none is live.

| Step of "I have X stones" | Exists [V] | Missing |
|---|---|---|
| 1. Stock in | Feed connectors; the Aska bridge (whether Render can reach port 2019 was unknown on 22 Nov) | CSV/XLSX upload; a private-stock flag; parcels |
| 2. Classify: singles, pairs, sets | Pair and layout engine; `has_pair`, `pair_count` per stone | An owner-scoped "sets inside my stock" call |
| 3. Propose: single → solitaire, pendant; pair → studs, sides; 5–9 → half-eternity; 20–60 → line | Pavé's parametric families | A rules table |
| 4. Rank | `price_bands`, days listed | **A sell-through model: nobody has finished-piece sales data.** Rank by margin and rules first |
| 5. CAD from measured stone | All dimensions are in the stone payload | Pavé's `sourced ?? nominal` seat logic (`07-sourcing.md` §4.4) |
| 6. List | Saved-layout replacement resolver | Listing-to-stone link; candidate-count check |
| 7. Order | `allocations`, `sold_marks` | Expiring holds; external allocations; events; ERP write-back |

- **Coverage.** Diaex can back solitaires, pendants, studs and three-stones of roughly 1 ct and up. Tennis, eternity, pavé and iced-out pieces need melee parcels: a new listing type and new supply, not a column [V + E].
- **Cost is hidden by design.** The bridge denies `Rate` and `Amount`; margin maths uses his asking price as transfer price, or cost typed into Pavé [V].
- **Flywheel, honestly.** Every CAD stone is a purchase intent (mm, grade, need-by) and every unmatched row a qualified request, but a 5% take on a $250 centre is $12.50, and where ASKA is seller of record the money is ASKA's reseller markup, not a platform fee [V + E].
- **Diaex work on the path:** nothing for a first pilot (deep links work signed out); then the Aska feed live; Buy open for `testers`; partner tokens and `stones/match`; expiring holds and events; later parcels and metals. Diaex's rules (plan first, 400-line PRs, one reviewer) make the partner layer roughly 8–12 PRs [E].
- **Conflicts.** A supplier selling finished pieces competes with the jewelers who buy his stones. His Diaex staff sign-in is its own account, outside any company, and sees every company's orders, both prices and supplier contacts; he also approves KYC [V: `diaex:docs/SOURCING.md` decisions 15–16, line 910]. A permissions wall may not cure the perception.

## 7. What review changed

All three judges ranked the theses the same way (sourcing flywheel 5.5–6/10, AI studio 5/10, operating system 3.5–4/10) and noted that the three pilots are the same pilot. Their main correction: the analysts' "5–10× gross dollars per stone" compares an Etsy **retail** price with a loose **wholesale** spread, while every memo recommends a trade channel. On the analysts' own figures [E]:

| 1.5 ct lab-grown solitaire, cost about $650 (stone $300 at ask, 14k $236, labour $115) | Price received | Gross |
|---|---|---|
| Loose stone | $150–450 | $10–60 |
| Etsy at $1,100 retail | $995 after base fees | $345 ($213 with Offsite Ads) |
| Trade, retailer keystones a $1,100 piece | $550 | **−$100** |
| Trade, piece retails at $1,500 | $750–975 | $100–325 |

The uplift in the recommended channel is therefore somewhere between negative and about 5×, before remakes, QC, insured shipping, duty and the cost of financing gold. Gold at $4,000/oz is an unverified assumption. Other corrections:

- **Stuller is the wrong analogy in kind:** it owns factory and stock. The plan owns neither, and no caster network exists.
- **Metal is not a take-rate business:** 1–3% over spot, hedging, credit and licences; casters usually supply their own [E].
- **Deflation shrinks a percentage take;** only a per-piece or per-order fee is protected [E].
- **A father using it proves usability, not demand;** ASKA buying from ASKA produces no arm's-length sales.
- **A demand test needs no software:** about ten hand-priced pieces on a PDF, sent by WhatsApp.
- **Build reality [V]:** every file here is dated 23–24 November; `packages/agent` 0 lines, `packages/sourcing` about 300, no catalogue, quote, channel or order code; no piece has been cast.

## 8. What we still do not know

In priority order. Each needs a real person, not more search.

1. **Does Aska sell, or want to sell, finished jewellery; who would make it; who stands behind remakes?** Every pilot assumes yes. Ask the father.
2. **Will his existing trade buyers commit (purchase order or deposit) to a finished piece shown only as a render,** or must they hold a sample or take it on memo? Untested; all conversion figures are [E].
3. **The wholesale price of a finished lab-grown piece and his gross after metal, labour and remakes.** The headline economics are a consumer-channel number (§7).
4. **Does a cast piece match the quote?** Finished weight and cost within about 5%, stone seated without re-doing the CAD. Nothing has been cast; rates in `cost.ts` are placeholders.
5. **Assistant edit quality** (share of edits kept uncorrected). `packages/agent` is empty.
6. **Will any unrelated business pay,** and how: seat, per order, or take? Not one jeweler was asked.
7. **Will jewelers buy stones through Diaex** rather than Nivoda or their memo suppliers, and expose design intent to a marketplace whose operator's father is a seller?
8. **Does anyone in reach have an Etsy or Shopify shop today?** The founder's own question (orders back to "my side") implies one; nothing in either repo shows it.
9. **Etsy at source:** the image-policy text of 6 November, Commercial Access terms, real quota. They are the basis for demoting Etsy.
10. **Cross-border cost:** duty and paperwork on India-made finished jewellery into the US versus loose stones; hallmarking and lab-grown disclosure duties for a first-time finished-goods seller. Not checked.
11. **Competitor facts at source:** Pencil, GemArt AI, RhinoArtisan/Nivoda, MatrixGold pricing; Nivoda's take rate.
12. **Diaex's path:** when Buy can open (payments, terms, memo), whether suppliers consent to their stock backing listings, and whether melee parcels are obtainable.
13. **Heera:** whether the vendor and the other parties in the shared database accept anything beyond today's read-only, cost-denied feed.
