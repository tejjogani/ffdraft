# What the catalogue, stock, store and developer-access ask entails

_24 November 2026, revised after two reviews. For the CEO. This is an understanding of the ask, not a build plan; it proposes no code and no schedule._

**The ask, in your words:** import a jeweler's current catalogue (3DM files, sheets and so on) from their ERP; let them deploy a website through us at `thediaex.com/store/<store>`; "design your stones"; cleanly handle ERP and stock; migrate if they want to, or else give their developers FTP or an API to fetch images per piece.

**How to read the evidence.** Paths without a prefix are in the Pavé repo; `diaex:` means `/home/user/diaex-backend`, read and never changed. Test results come in three classes. **Public sample:** nine public Rhino files, which are the Rhino library's own test files, not jewelry. **Round-trip:** a file we wrote and read back with the same library, which shows only that the library reads what it writes. **Not tested:** everything about real jewelry files and real ERP sheets. "Unverified" means a search extract not opened at source: almost every vendor, price and legal claim, because most web hosts are blocked here. "Trade judgement" means a reviewer's or my experience, not checked.

**Sizes** are build effort for one builder, counted after the prerequisites named beside them: **S** about a week, **M** two to four weeks, **L** one to three months, **XL** longer or open-ended. They leave out the real limit, which is your review: you review every pull request in both repos, and Diaex needs an approved plan per item and pull requests of at most 400 lines (`diaex:AGENTS.md` §0–1).

## The answer in seven sentences

1. The ask is nine separate capabilities, and most come down to one thing: a **catalogue** (styles, variants, pictures, CAD, price) plus an answer to "can I have it, and when", shown on a page and readable by a developer.
2. Nothing in it is small: the developer API, an assisted first import and a showroom page are each M to L on their own, and each stands on a product record, a public catalogue and a hosted Pavé service that do not exist, so the smallest real deliverable is many months of work (section 1).
3. The largest parts are reading other people's CAD reliably, a product record that accepts pieces never designed in Pavé, staying in step with an ERP, running a hosted service, and anything on `thediaex.com`: that domain is still served by the old app, Diaex's Terms say trade-only and no payment, and Diaex has no jewelry model.
4. Replacing an ERP and taking money are larger still, and nothing found here weakens the earlier advice against both.
5. **The distinction that matters most is catalogue plus availability versus ERP.** A catalogue says what a piece is and whether it can be had; an ERP says who owns the metal, what was issued to which workshop and what tax is due. Everything in your message can be delivered on the first, provided "migrate" means "bring your items and open stock over and keep your books where they are".
6. Import and "design from stones" do not combine the way the pitch suggests: an imported piece keeps the stones it was drawn with, because their seats are fixed in the metal, so fitting a different stone works only for pieces built in Pavé.
7. None of this is built, and the biggest unknowns are not technical: nobody knows whether your father has a jewelry catalogue, what a jeweler would pay for any of this, or who sells, makes and ships a piece after a store enquiry.

## 1. The ask as nine capabilities

| # | Capability | What exists | What is new | Size, and what it comes after | Main risk |
|---|---|---|---|---|---|
| 1 | Import catalogue files: read a sheet, map columns, dry run, match pictures and CAD to rows | A CSV writer (`packages/production/src/csv.ts`); content-addressed file storage (`apps/server/src/assets/assets.ts`); the pattern to copy in `diaex:docs/STOCK-DEV.md` | Sheet reader M, mapping M–L, stone text M, dry run and checks M, re-import keys M, file matching M, bulk upload and queue L | Assisted, one customer: M–L after #3 (we run the mapping by hand; no mapping screen, no queue). Self-serve tool: the seven items, L–XL | The join between a row and its files is a filename habit, not data |
| 2 | Understand imported CAD: open a `.3dm`, find metal and stones, weigh, render, package | 3DM writer; readers for STL, OBJ, PLY, GLB, 3MF (`packages/kernel/src/mesh/parse/index.ts`); weights, renders and packages work on any closed solid | 3DM reader, a container that keeps real size and position, weight per layer, stone detection, thumbnail: each M | L in total when meshes are stored and stones are labelled; another L, unproven, when stones must be inferred; XL for general surfaces with no mesh. After the engine pass | Unknown share of files lack usable meshes; it depends on how the designer saves. The ten-file sample in section 7 is the test |
| 3 | Hold catalogue and stock, for pieces with or without a Pavé design | Designed only: `docs/plans/publishing.md` §3. A piece has no SKU today | The planned record (build steps 1–3); then changes to that plan's rules (2.3) | L for the planned record, plus L for the changes | Scope creep toward an ERP, one reasonable field at a time |
| 4 | Keep in step with an ERP | The pattern, for stones: Diaex's stock connectors and the Heera read-only feed (`diaex:docs/ASKA-FEEDS.md`) | File drop with an always-on inbound endpoint, pull, or read-only SQL; run log; hiding stale items | M per pattern, one way, after #3 and #9; an on-site agent for an ERP behind a firewall is separate and unsized; L two-way | Selling one piece twice; vendors do not deliver access |
| 5 | Migrate off an ERP | Nothing | Nothing beyond #1 for "move items"; a whole ERP for "replace" | M–L, or XL and never | The word "migrate" promises a replacement |
| 6 | A store on `thediaex.com` | Diaex precedents: share links with markup (`diaex:app/shares.py`), a public contact form (`diaex:app/contact_routes.py:61`), signed-out stone and layout routes (`diaex:app/main.py:1170-1267`), server-built pages (`diaex:app/sourcing/pages.py`) | Address, store identity, pages search engines can read, a price rule, Terms, enquiry intake | L–XL as a trade showroom inside Diaex, gated by your review, by #3, by publishing step 4 and, for gated price, by the Diaex connection. M of build if hosted Pavé renders the pages (2.6). XL with consumers or checkout | It changes what Diaex is: audience, Terms, legal exposure |
| 7 | Developer access | Designed only: `docs/plans/publishing.md` P1 | It is build steps 4–5 of that plan, which need steps 1–3 first; then a manifest, SKU-named links, folder access, a viewer | M for key, feed and images after #3; L with SFTP and a viewer | Outside developers depend on formats we must keep stable |
| 8 | "Design your stones", with sourcing tied in (my reading: start a design from a stone; see question 8) | Stone requirements from CAD and Diaex search links (`packages/sourcing/src/diaex.ts`); Diaex's signed-out availability and its layout search for "N stones of a shape and size" (`diaex:app/main.py:1243`) | Stone rows for imported pieces; a page that checks a stone against live stock; the Diaex connection | M in Pavé; M–L on Diaex (the earlier memo counted 8–12 pull requests for the partner layer) | Diaex lists diamonds only, including fancy colours: no coloured gemstones, no melee parcels, no public price |
| 9 | The hosted Pavé service that "through us" implies | Nothing. No deploy configuration; file storage is local disk only (`apps/server/src/assets/blob-store.ts`, although `docs/ARCHITECTURE.md` says "disk or S3"); no outbound email; no public page route; no model provider; `apps/desktop` is absent | Deploy, object storage and delivery, resumable upload, email, backups, abuse handling, someone on call | L to stand up, then a running cost and an operator for good | Nobody has been named to run it, and no legal entity holds the data |

**The smallest real deliverable** is one seller's sheet and pictures turned into a public page with an enquiry button and no price. In order: the engine pass (in progress, not sized here); the product record (L); the record changes for pieces with no design (L); public pictures and the catalogue, step 4 (M); an assisted import (M–L); the page and enquiry intake (M if Pavé renders it); the hosted service (L). Those bands add up to between four and a half and fourteen months for one builder working in sequence. More builders shorten it only as far as your review allows. Understanding CAD (#2) is not on this path and adds L.

## 2. Each capability in turn

### 2.1 Import catalogue files

**What it takes.** A reader for `.xlsx`, `.xls` and `.csv`; finding the real header row; a mapping the assistant proposes and a person confirms; a dry run that writes nothing and reports each row; a key per row (organisation, source, cleaned SKU) and a content hash so a second import changes only what changed; matching of files to rows by filename, folder or a SKU inside the file, with a queue for doubtful matches. There is no model provider in the repo to draft the mapping (`apps/server/src/services.ts` holds interfaces only; `packages/agent/src` is empty). Upload today is one file per request, 200 MB at most, held in memory (`apps/server/src/config.ts:45`).

**Which totals must match.** The earlier rule, "rows, carats, grams, value must equal the source" (`docs/strategy/product-strategy.md:56`), was written for stone and stock rows, and holds for them. A style catalogue has nominal weights and often no value column (Heera denies cost columns), so for styles the test is row count plus stone count and carats per style.

**What looks easy and is not.**
- **The join.** No evidence was found that any jewelry ERP holds CAD as data; the `.3dm` usually sits on a designer's PC or in WhatsApp, named by design number at best (trade judgement).
- **Style versus variant.** 50,000 SKUs is usually far fewer styles, and CAD exists per style.
- **Stone text.** On a workbook we wrote ourselves (round-trip), a simple parser read `24 melee 0.12tcw` as a 0.12 size, could not tell emerald the stone from emerald the cut in `7x5 EM`, and failed on `RBC .25 F/VS1 & bagt 6pc=0.18`. Real ERP text was not tested. It needs a model, a person confirming and arithmetic checks.
- **Other mess (trade judgement).** Melee given as sieve sizes or lot codes; purity written as 14K, 585 or 58.5; one style under several customer-specific numbers; discontinued styles; styles with a mould and no CAD; mixed number formats and `TOTAL` rows among the data.
- **Sign-off, built.** A piece made from someone's source files cannot be exported or packaged until a person attests it (`packages/schema/src/api/entities.ts:100`, `apps/server/src/handlers/pieces.ts:62`). **Sign-off, designed and not built.** An uploaded picture counts as an edited photo until a person attests it (`docs/plans/publishing.md:62`). A catalogue needs a bulk version of both.
- **Volume.** Assuming 15 MB of CAD and 10 MB of photos per style (unverified): 200 styles is about 5 GB and uploads from a browser; 5,000 styles is about 125 GB and needs resumable upload to object storage, neither of which exists (#9). Repairing a one-million-triangle mesh took 19.8 s and 1.85 GB here, above the kernel's 1,536 MB budget; a Blender preview takes 21–26 s (`docs/research/03-rendering.md:12`). Past a few hundred styles the catalogue's own photos must serve as covers.

**A cross-check only Pavé can attempt.** Sheet net weight against CAD volume times density, and sheet stone count against stones found in the CAD. The stone count is solid. The weight check has an unknown tolerance: files are often scaled for casting shrinkage, finishing removes metal, bought-in heads and findings are not modelled, and a sheet weight is an average over cast pieces (trade judgement). The tolerance must be set from your father's sample, and the check may flag most rows until then.

**What we do not know.** What real files and sheets look like; how disciplined the file names are; whether `.xls` and "picture in cell" images read correctly; how Indian ERPs store images.

### 2.2 Understand imported CAD

Tested with the `rhino3dm` library the kernel already depends on:

| Content of a `.3dm` | Readable without Rhino? | Evidence |
|---|---|---|
| Units, layers, names, user text, materials, groups | Yes | Public sample; reading back `SKU=R-1042` was a round-trip |
| Mesh objects | Yes; a band came within about 1% of its exact volume | Round-trip |
| Solids saved with their display meshes | Yes; all six in one Rhino 7 file closed cleanly | Public sample |
| Solids saved without display meshes | Partly. Exact surfaces, edges and bounding boxes are readable, so overall size, part counts and stone diameters survive. There is no tessellation and no trim curves, so volume, weight and pictures do not | Public sample, re-probed during review |
| SubD surfaces | The control cage only | Public sample |
| Blocks (one gem repeated) | Count and size came back from 24 copies of a 1.30 mm gem | Round-trip. Nested, mirrored or unevenly scaled blocks, as a jewelry plug-in may write them: not tested |
| Plug-in history (MatrixGold builders) | No | My knowledge, unverified |

**What it takes.** A 3DM reader; a container that keeps an imported body at its real size and position with several metals (today's `meshBody` rescales, flattens the back and takes one metal: `packages/kernel/src/features/meshBody.ts`); separating stones from metal before repair, because repair fuses overlapping shells; unit conversion and block flattening; mapping layers to alloys with a person confirming; turning detected stones into real `gem` records (`packages/schema/src/design/nodes.ts:132-176`).

**Files with no stored mesh, cheapest route first.** A small Rhino script the jeweler runs once to export meshes or STEP for the whole folder with the SKU written in (not tested); re-saving from Rhino with shading on; sending STEP (our own STEP cylinder read back exactly, a round-trip; a Rhino-exported pavé ring was not tested, and STEP is not wired in as an importer); building meshes ourselves for extrusions and simple faces (S–M, a reviewer's estimate); a Windows server with licensed Rhino; our own converter for general trimmed surfaces (XL and fragile).

**What looks easy and is not.**
- **"Editable."** On an imported mesh, changing metal, swapping stone material at the same size and engraving work. Changing a stone's size is L, true ring resizing is XL, parametric editing is never possible. For sizes the honest answers are one file per size or "sized at the bench".
- **Other tools.** MatrixGold, RhinoGold and 2Shapes save `.3dm`. JewelCAD's `.jcd` opens only in JewelCAD; ask for STL (unverified).
- **Leftovers in files.** Cutters, sprues, hollow parts, open shells, shrinkage scaling and finishing allowance all distort weight.

**What we do not know.** What share of real files lack stored meshes, and whether a normal Rhino save keeps them; how MatrixGold stores gems; whether cut can be recognised from bare gem geometry.

### 2.3 Hold catalogue and stock

**What it takes.** The product record in `docs/plans/publishing.md` §3, none of it built. A piece with an empty design can exist today (`packages/schema/src/design/design.ts:32`), but its facts have nowhere to be stored except a four-field cache (metal mass, carats, stone count, metal: `packages/schema/src/api/entities.ts:114`) that evaluation overwrites.

**Rules in the plan that a catalogue import breaks.** These are design changes, not additions:
- Weights and stone lists are computed from the design and never stored (§3).
- Prices come only from `production.estimate`, and a person confirms each (§4.4).
- Every publish is reviewed and then confirmed by an admin, one listing at a time; automatic publishing and publishing over the API are out of the first version (§4.2, §6).
- Photo attestation is one picture at a time, by a person.
- Variants are a fixed vocabulary compiled from the design; "a piece per variant" was rejected (§4.4).
- Mixed stocked and made-to-order variants, and stock in several locations, were cut (§6).

**Fields the plan lacks.** A stock unit (one tagged piece with its own weight, price, certificate, location and memo status); certificates; the source system's id; CAD per variant; the customer's price inputs; several collections per piece; and a per-style "may be shown to" setting (public, named buyers, nobody), because catalogues hold private-label and customer-exclusive styles and freelancers' CAD.

**What looks easy and is not.**
- **"Stock" is three things:** made to order (a lead time), ready stock by count, and one serialised piece.
- **A serialised piece is its own record.** Cast weight differs piece to piece, so weight and price belong to the tag, not the variant.
- **Price is a formula, not a field:** net weight times metal rate times purity, plus making, wastage, stones, markup and tax, moving daily with metal. Nobody has yet been named to own the metal rate, the reprice or how long a shown price is valid (question 9). The Heera login cannot read cost, so price cannot be derived from that feed.
- **Memo stock** can be recalled by its owner. The catalogue needs a flag meaning "not ours to promise".
- **With no ERP, Pavé owns SKU and stock.** That is the "thin record" the earlier research sized at 6–10 weeks beyond the publishing plan (`docs/research/10-market.md:86`), and where the pull toward an ERP starts.

| A catalogue with a store needs | An ERP adds |
|---|---|
| Style, variant, media, CAD, stone lines, metal weights and purity, rate card as read-only inputs, stock count or tagged piece, certificate number, a memo flag | Lot stones by weight, metal ledger, job work with workshops, memo documents, purchases, invoices, tax, hallmark filing, old-gold exchange, repairs, branch transfers |

### 2.4 Keep in step with an ERP

**What it takes.** One of four patterns per customer: a one-time import; a scheduled file drop; a pull from the ERP's API; or a read-only database login. Diaex's stone connectors are the working model: a practice run that writes nothing, counts of rows loaded and refused, and items hidden after 48 hours without a good run. The planned stock command `inventory.set`, with its own key scope, is already the designed way for an ERP to push counts in.

**Who owns what when the ERP stays.** The ERP owns stock, weights, cost and rates; we own titles, pictures and collections and pass the count on to sales channels. This matches the earlier rule (`docs/strategy/product-strategy.md:60-67`) and the publishing plan, which rejects a sales channel, not an ERP, as the source of stock truth.

**What looks easy and is not.**
- **A hold in Pavé binds nobody when we cannot write to the ERP.** The counter or a memo-out can still sell the tag, so overselling is not only a matter of the sync interval. A hold is real only if staff physically pull the tag or the ERP accepts a write. Otherwise ready stock is "subject to confirmation".
- **File drops run both ways.** An ERP pushing files to us (The Edge and RapNet-style feeds work this way; unverified) needs an always-on server that we run, with per-customer isolation and a fixed address for firewalls.
- **Read-only SQL is a special case.** It works for Heera because the vendor hosts the database on a public port and the firewall is being opened to Diaex's host (`diaex:docs/plans/2026-11-19-aska-sql-bridge.md:50,169`). A jeweler's own ERP behind a firewall needs an on-site agent or the vendor's help.
- **Heera has not delivered an API.** The Diaex plan says a request is pending (same plan, line 40); the earlier Pavé research says "refused", which the Diaex repo does not show.
- **A missing row** means "gone" only when the file is a full list.
- **Flow back barely exists.** For most desktop ERPs an online order returns as an email or CSV that a person keys in (unverified).
- **The Aska feed reads loose stones only,** and is built but not confirmed live (2.8).

### 2.5 Migrate off an ERP

**Two meanings.** Moving item masters, pictures and open stock is capability 1 done well, plus two to four weeks beside the old system. Replacing the ERP means owning books, metal accounts, job work, tax and hallmarking per country. India requires an audit trail and eight years of books (unverified), so the old system stays either way.

**What the market shows (unverified).** Website and catalogue vendors (Punchmark, GemFind, Jwero, Valigara) integrate with ERPs and stayed layers. Point-of-sale vendors replace other point-of-sale vendors and leave history behind. No case was found of a store or catalogue vendor that became the ERP.

**What looks easy and is not.** The labour is per customer: half a day to two days for a spreadsheet customer, one to two weeks for a database ERP (`docs/research/10-market.md:86`), more with pictures and CAD. That is a services business. The earlier research records that your father will not migrate.

### 2.6 A store at `thediaex.com/store/<store>`

**Is a Diaex store the cheapest way to get what you want?** The Diaex reader's conclusion was that the cheapest honest first version for your father is not on Diaex at all.

| Route | What must be built | What it gives | What it lacks |
|---|---|---|---|
| Pavé private trade link with "request a quote" | 2–3 weeks on the planned catalogue (`docs/research/10-market.md:134`); already moved up in the earlier memo | A link per buyer with piece price; no Diaex work | Not public; no search traffic |
| The Diaex share link | Nothing; it exists (`diaex:app/shares.py`) | A white-label, marked-up, live stone list for 14 days | Stones only |
| Shopify with its trade features | The Shopify channel (publishing P2) | Checkout and company price lists (reported on all plans since April 2026; unverified) | Not ours |
| A store on Diaex | Everything below | Two things the others cannot: Diaex's verified-company identity on both sides, and a piece's stones checked against live Diaex stock | |

**Three ways to host it, which change the size and who builds what.**

| Shape | Diaex builds | Pavé builds | Note |
|---|---|---|---|
| A. A route in Diaex's web app | Jewelry snapshot tables, pages, a way to give search engines real HTML (none today), a third look | A Diaex channel | Dozens of pull requests; L–XL |
| B. Pages built by Diaex's API behind a rewrite rule | The same tables; server-built HTML, as `diaex:app/sourcing/pages.py` already does | A Diaex channel | No new front-end framework |
| C. A rewrite rule to pages built by hosted Pavé | The rule, store identity and takedown, Terms | A public page set and enquiry intake (not in the publishing plan) | No jewelry tables in Diaex; every page depends on the Pavé host. Diaex already rewrites `/api/*` this way (`diaex:deploy/production/render.yaml:102-104`); a rewrite to a host outside Render is unverified |

**Three addresses, which decide whether price can be gated.**

| Address | Consequence |
|---|---|
| `thediaex.com/store/x` | The apex is served by the old app today; moving it is "Phase D", waiting on your decision about the old app's users, Stripe and WhatsApp (`diaex:docs/plans/2026-10-26-render-deploy.md:376-399`). After the move the apex is the landing site, a different origin from the signed-in app, and as designed it sends every path but `/` to the console (`diaex:web/src/landing/LandingSite.tsx`). So pages there are public, and a price for verified companies cannot show without single sign-on work (sign-in is per origin: my knowledge, unverified) |
| `console.thediaex.com/store/x` | Gated price works with today's sign-in. The store shares an origin with the signed-in app, so sellers get no HTML or scripts of their own, only logo, colours and layout choices |
| A subdomain | One DNS record and no wait. Neither of the above is inherited; gated price needs single sign-on |

**Also missing in Diaex.** A store identity: no handle, public name or logo, and company details change only through staff approval (`diaex:db/schema.sql:603-620`). Public pictures: the only bucket is private. Search visibility: token pages (`/s/`, supplier lists) are hidden from search by design, and every other page is one client-drawn shell with no per-page title or preview. Permission: the Terms say "trade-only marketplace ... not a consumer service" and "do not process payment" (`diaex:web/src/routes/legal/Terms.tsx:19-40`). The enquiry form itself is the smallest part: it extends the existing public contact route, which stores messages for a staff inbox with no email dependency.

**After the enquiry.** An enquiry-only showroom for high-value goods still needs answers nobody has given:
- Who quotes, and for how long the quote holds while metal moves.
- Who makes the piece, who checks it, and who pays for a remake.
- Samples and memo: the trade buys on "samples in hand, memo and net 30–60 terms" (`docs/research/10-market.md:139`).
- Insured shipping, which Aska entity sells (India or USA), and the duty (decision 4 of the earlier memo, still open).
- Spam, who owns the lead, the buyer's personal data passed to the seller, uptime, and export when a seller leaves.

**What looks easy and is not.**
- **Who sees which price.** Public, signed in, verified company and "this buyer's price" are four answers, and competitors can sign up as buyers. A public price that depends on a Diaex stone would be a second exception to Diaex's rule that only verified companies see prices.
- **A named stone can sell between the page view and the order.** A piece should promise a specification and a "from" price and confirm the stone at order time. Diaex holds a stone only inside an order (`diaex:db/schema.sql:1496-1511`), with no timer and no hold a partner can ask for, and Buy is closed in production.
- **Words collide.** In Diaex a "seller" is a stone supplier; a jeweler with a store is, in today's model, a buyer.
- **Custody.** A jeweler would upload its whole CAD library and price inputs to a service whose owner's family is a stone supplier, and a Diaex staff sign-in sees every company (`docs/research/10-market.md:190`; decision 6 of the earlier memo). Aska's store would also sit beside its own customers' stores.
- **Checkout** brings payments and disputes, marketplace sales tax, tax collection at source in India, and anti-money-laundering duties; **a consumer store** brings seller-verification law. All unverified here; each needs a lawyer.

**What comparable offerings charge (all unverified).**

| Offering | Price |
|---|---|
| Stuller Showcase: white-label catalogue and quoting on a Stuller subdomain, no checkout. The closest precedent | Free |
| Etsy Pattern: a standalone site from an Etsy shop | About $15 a month |
| Ring builders with live stone prices | $89–250 a month |
| VDB embeds; GemFind's diamond feed | $50–100 per product a month plus setup; $195 a month |
| The Edge's data export for a website | $2,000–2,500 once |

The lesson: "a website" has a low price ceiling. What jewelers pay for is live stock and price inside their own site. The earlier memo rated "migrate ERPs" and "be the ERP" as low value to us, and nothing here changes that.

### 2.7 Developer access by API and files

**What it takes.** Most of it is designed in `docs/plans/publishing.md` P1: a catalogue API filtered by SKU and "updated since", keys with scopes, feeds, permanent public image links in named sizes, and signed webhooks. None is built, and the earlier memo deferred it until orders exist (`docs/strategy/product-strategy.md:138`). Not in the plan: a list of every file with checksums, image links named by SKU, a folder per SKU, the iPhone AR format, an embeddable viewer, a price list per key.

**What "FTP" means.** In this trade it means "a folder my importer can mirror every night" (unverified). In rising order of cost: a feed address over HTTPS (in the plan); a manifest listing every file with a checksum (small); read-only SFTP with a folder per SKU (a real server: about $216 a month per endpoint on AWS, unverified, plus host keys, isolation, a fixed address, always on). Plain FTP sends passwords in clear text and should not be offered.

**What looks easy and is not.**
- **Stable against permanent links.** Developers want `/{sku}/hero.jpg` forever; feeds want links that change with the picture. The plan answers 410 for a withdrawn picture, so someone must decide what a customer's site then shows.
- **Which price a key sees.** An agency key for a retail site must never receive trade price or cost, and a stale price in a feed lands on someone else's site.
- **SKU as the key.** ERP SKUs contain spaces and slashes, get renamed, and may mean a style or a variant.
- **3D.** A standard web viewer shows Pavé's stones as glass, so an embeddable viewer has to be our own (see the licence note in section 4). A public 3D file is a downloadable design: display-grade only.
- **"Through us" means capability 9.** A desktop Pavé cannot serve a catalogue, a feed or a public image; the offline listing kit and Shopify uploads still work from it (`docs/plans/publishing.md` §1).

### 2.8 "Design your stones", with sourcing tied in

**The reading is an assumption.** I read the phrase as "start a design from a stone". It could also mean "design your store" or "design with your own stock of stones" (question 8).

**What exists.** Designing from a stock list is the "Now" row of the earlier memo. Every stone in a Pavé design is a requirement row, and deep links into Diaex search work today (`packages/sourcing/src/diaex.ts`). Diaex answers "is this stone still available" to signed-out callers, without price.

**What import does to it.** An imported style cannot be refitted to a different stone, because its seats are part of the metal (2.2). Imported pieces get sourcing rows for the stones they already have, once those are recognised, and nothing more. "Design from stones" applies only to pieces built in Pavé.

**Your father's stone feed.** A read-only feed from his ERP is built and awaiting go-live; the Diaex docs do not show it live (`diaex:docs/ASKA-FEEDS.md` is titled "turning them on"). Nothing follows his prices or sends orders back.

**What we do not know.** Whether buyers order from a picture, and at what margin. That is what the earlier memo's pilot tests.

## 3. The ladder, and where the earlier positions sit

| Rung | What the customer gets | What it obliges us to support | Earlier position |
|---|---|---|---|
| **1. Import once** | Their sheet, pictures and CAD become a catalogue and a page; made to order by default | Hand-holding per customer; re-imports | "One-way import: Next" |
| **2. Scheduled sync, ERP is master** | The store follows their ERP for stock and price; orders reach them by email or CSV; we write nothing into the ERP | A connector per ERP family; overselling; their ERP vendor as a dependency | "Sync: Next, files and Shopify only"; "named ERP connectors" cut |
| **3. Two-way, split ownership** | We are the record for catalogue, media, online stock, holds and orders; the ERP keeps books, metal and manufacturing | Reconciliation; blame for a double sale; formats outsiders depend on | The earlier rule was "SKU and stock quantity: the ERP; Pavé relays it". Rung 3 reverses that for online stock, and a hold we cannot write back is not a real hold (2.4) |
| **4. Be the ERP** | They leave Heera, Ornate, The Edge or Tally | Tax, compliance, audit support, liability for books | "Real ERP: Never"; "Migration product: Never" |

Your message describes rung 3. Your father is short of rung 2: his stone feed is built, not live. "Migrate if you want to" is rung 1 if it means bringing items over and rung 4 if it means leaving the old system.

**Status of the earlier positions.** The never-build list was a recommendation awaiting your approval; no record of approval was found. Read narrowly, the ask breaks none of its "never" items. What it reopens:

| Earlier position | What the ask changes | Does the earlier reason still hold? |
|---|---|---|
| "Website means a Shopify store filled from Pavé" | A hosted page set on Diaex's domain | Partly. Payments and tax fall away without checkout; hosting, search, content rules and upkeep remain ours for good |
| "Hosted checkout: Never" | Nothing, unless a store takes money | Yes, fully |
| "Public API, feeds, webhooks and sign-in with Diaex deferred until orders exist" | All pulled forward; gated price on a store needs the sign-in | The designs stand; only their place in the queue is in question |
| "Diaex: nothing for the pilot" | A store is Diaex work that you review | Yes |
| "A private link per buyer beats a marketplace" | A public store | Yes for trade buyers; it argues for gated price |
| First customer: stone holders with no jewelry line | Import presumes a business with a catalogue and CAD | A different customer from the one the pilot tests |
| "The design is the item master" | Imported pieces have no Pavé design | Does not apply to them |
| "Be the ERP: scope creep; lowest payers, most support" and "Migration: a services business" | Rung 3 for customers with no ERP; files add labour | Yes, more so |
| "Build each step only after the one before produces orders" | Breadth before the first order | Yes. The ask answers none of the open questions: who makes, who buys, at what margin |

## 4. Who builds what

This section depends on question 6 (whose product the store is) and on the hosting shape in 2.6. As written it assumes shape A or B.

**Principle.** Pavé is the record for everything about a piece. Diaex is the record for stones, companies and the public trade identity. Where one holds the other's data, it is a cache with a named owner and a rule for going stale.

| | Pavé, open source | The hosted Pavé service (capability 9) | Diaex, closed |
|---|---|---|---|
| Owns | Import; the product record; facts from CAD or the sheet; the price as shown, however question 9 settles it; stock mode and count; the catalogue API, feeds and public media; the stone list per piece | An always-on public address; storage and delivery at volume; the inbound file-drop endpoint and SFTP if offered; bulk workers; the mapping model; keys and usage; the people who help with each import | Who may have a store (company, verification, handle, takedown); the pages, in shapes A and B; live stone availability and the price rule; Terms |
| Does not own | Anything that exists only when hosted | Catalogue logic a self-hoster would lack | A second developer API; picture files |

**The four seams.**

1. **Connect.** Two designs exist and one must be chosen: a token created on Diaex's account page and pasted into Pavé (`docs/research/07-sourcing.md` §3, "ship first"), then "Continue with Diaex" as a full sign-in (`docs/ARCHITECTURE.md`). Diaex issues no partner tokens today, so this is M on the Diaex side. Open points: Aska is two Diaex companies, so the mapping is many companies to one Pavé organisation; Diaex staff have no company account; which role may grant; whether identity, sourcing and store publishing are separate scopes; revocation; what a self-hosted Pavé with no sign-in gets.
2. **Catalogue, Pavé to Diaex.** Diaex keeps a cached copy per product (title, text, prices, picture links, stone requirements, a digest) so it can draw a page without calling Pavé. The cache needs a contract: Pavé owns it; a withdraw event and a time limit clear it; and the page must behave when a picture is withdrawn or the Pavé host is down, since pictures stay on Pavé.
3. **Stones, Diaex to the page.** Each stone requirement is resolved by Diaex's existing code, so the price and supplier rules cannot drift.
4. **Demand.** One system must be named the record for an enquiry; a copy in both doubles the personal data. Delivering enquiries into Pavé also pulls forward the plan's inbound events and order intake, which it places last (P3).

**The licence boundary (needs a lawyer; this is my reading).** Pavé is AGPL-3.0-or-later (`LICENSE`); Diaex is closed. The repo has no copyright notice, contributor agreement or contributing file.
- The safe boundary between the two is the network only: API, feeds, webhooks, an embedded frame.
- Hosted-only code that changes the server (bulk workers, mapping glue, keys, SFTP) would have to be published, unless the operator holds all the copyright. The first outside contribution ends that freedom unless a contributor agreement or second licence is in place first.
- Our viewer inside Diaex's closed pages or a customer's site is AGPL code in a closed front end, unless it is served in a frame from the Pavé host or licensed separately.
- Diaex may call Pavé but not copy its code (for example the stone-requirement mapping) without a separate licence from the owner.
- A Diaex channel in Pavé's open tree publishes the contract between the two.

## 5. What must be true first, and what each thing gates

| Must be true | Gates | State today |
|---|---|---|
| The engine pass is done | Imported CAD (#2); by the roadmap's rule, all breadth features | In progress |
| The product record exists (publishing steps 1–3) | Import, the API, feeds, any store | Designed, unbuilt |
| The record accepts pieces with no design, with the rule changes in 2.3 | Publishing any imported piece | Not designed |
| Public pictures and the catalogue exist (step 4) | The API, feeds, any store | Designed, unbuilt |
| A hosted Pavé exists and has an operator | Anything public: store, API, feeds, file drops | Nothing exists |
| Pavé and Diaex accounts are connected | Only gated price and live stone checks on a store. Not import, the API, or a store with price hidden | Not built; the earlier memo deferred it and counted 8–12 Diaex pull requests |
| You have decided address, audience, price rule, hosting shape, look and store identity | A store on Diaex only | None raised yet |
| A first real user with real files | Every size in this memo | Unknown |
| **Recommendation, not a fact:** the pilot's first week has run | Whether any of this is worth building first (question 2) | Not run, as far as the docs show |

## 6. Questions only you can answer

In order: the first two decide whether the rest matter now, and question 3 decides 4, 5 and 7. Defaults are what the findings support.

| # | Question | Default the findings support | Why it changes the scope |
|---|---|---|---|
| 1 | Is your father's jewelry catalogue in Heera, in sheets, or nowhere yet, and which files exist? | Unknown; ask him (section 7) | It decides whether he can be the first import at all |
| 2 | Does this come before or after the pilot's first orders? | After | Doing it first changes the first customer |
| 3 | Who visits a store: verified trade buyers, or a jeweler's retail customers? | Trade buyers | Trade fits Diaex's Terms today; consumers mean new Terms and consumer law |
| 4 | Is price public, shown only to verified companies, or absent? | Hidden first, then gated | Gated price needs the Diaex connection and limits the address (question 7) |
| 5 | Does any store take money in the first year, and who is merchant of record? | No | With payment, whoever charges the card owns refunds, disputes and tax |
| 6 | Is the store a Diaex product or a Pavé product on Diaex's address? | Open; shape C makes it Pavé's | It decides who builds the pages, whose sign-in and support |
| 7 | Which address: the apex after the old app is retired, the console, or a subdomain now? | A subdomain | The apex waits on Phase D and cannot gate price without more work |
| 8 | Does "design your stones" mean start a design from a stone, design with your own stock, or design your store? | Start from a stone | The last is a theme editor, a different capability |
| 9 | Is the price shown copied from the ERP, computed from a rate card, or absent; who updates the metal rate; how long is it valid? | Absent first | A stale price reaches buyers and other people's sites |
| 10 | Who sells, makes, checks, ships, insures and stands behind a remake for a store order, and from which Aska entity? | The earlier memo's: Aska sells, a named workshop makes, 5% remake allowance; duty unchecked | Without it an enquiry has nowhere to go |
| 11 | Ready stock, made to order, or both? | Made to order | Ready stock needs real holds, which a read-only ERP cannot give |
| 12 | Does "migrate" mean "bring my items over" or "leave my ERP"? | Bring items over | The second is rung 4 |
| 13 | May a store list pieces that have no Pavé design? | Yes | It changes the shape of the product record |
| 14 | Would a named jeweler pay for the page, the import or the API, and how much? | Unknown; comparables suggest little for a page | It decides whether this earns anything |
| 15 | Who runs the hosted Pavé service, and which legal entity is responsible for jewelers' catalogues and visitors' enquiries? | Open | Nothing public can exist without it |
| 16 | Who at Diaex or Pavé may see an imported library, and how are Aska's roles kept apart? | The earlier memo's: never visible to Diaex staff | Jewelers will not upload CAD to a supplier's family otherwise |
| 17 | Who holds Pavé's copyright, and is a contributor agreement or second licence adopted before outside contributions? | Open; needs a lawyer | It decides what the hosted service and Diaex may keep closed |
| 18 | Which named developer or agency wants FTP, and what do they point at it? | A feed address or manifest | SFTP is a running service |

## 7. What to ask your father for

A small sample of real files answers most of the unknowns above, and costs him an hour.

| Ask for | What it settles |
|---|---|
| Ten real `.3dm` files of pieces he sells or would sell, saved the way his designer normally saves them, with the name of the CAD tool. Include some old or discontinued styles, some made for one customer, and one with a mould and no CAD | Whether files carry usable meshes; how stones are stored; file naming; the weight tolerance |
| The same ten as STL or STEP, if his designer can export them | Whether the fallback route works |
| One export from his system covering those ten pieces and about fifty more, exactly as it comes out | Column names, stone text, purity and melee notation, how styles and variants are told apart |
| The photos for the same pieces, in the folders they live in, untouched | How pictures are matched to items |
| His price sheet or rate card: metal rate, making charge, wastage, markup | Whether price can be computed or must be copied |
| Four answers: is the jewelry in Heera at all; ready stock or made to order; does anyone outside ask him for files today; which styles may not be shown publicly | Stock mode, a real user for developer access, visibility rules |
| The names of two or three jewelers among his customers, what system each uses, and what each pays for a website today | A second sample, and a first answer to question 14 |

If he has no jewelry catalogue, that is itself the answer: the first import customer is one of his jeweler customers, and the questions in section 6 go to them.
