# Migration between jewelry/diamond ERP and POS systems, and AI-assisted data migration (state as of November 2026)

**Access note:** every page fetch failed because the session's network blocks these hosts: wjewel.com, jewel360.com, gem-logic.com, arxiv.org and edgeuser.com (DNS ENOTFOUND, outside the allowed domains). After those five failures no further fetches were tried. **So every sourced claim below is [S]: seen only in a search-result extract, not verified by opening the page.** Nothing here is [V]. [E] marks my own estimate or inference. Search extracts are summaries written by the search tool, so exact wording and numbers can be off. Re-check any figure before it goes into a decision document. No project or person names were used in any query.

---

## 1. How migrations are done today in the jewelry vertical: vendors, services, prices, durations, what moves and what is left behind

### Takeaway
In the US, each jewelry POS vendor runs its own conversion service. The vendor takes a database backup or CSV export from the old system, builds a "preliminary database", lets the jeweler check it against totals reports, and goes live in about 1–4 weeks. Master data and in-stock tagged inventory move well. In-flight documents (open repairs, layaways, special orders, account balances) are usually brought over as flat totals or re-keyed by hand, and history moves only in limited form. In India, vendors advertise free help moving items, parties, ledgers and opening stock out of Tally or Excel. I found no public method for carrying over gold-scheme balances or karigar (workshop) metal balances.

### Cited Findings
**The Edge (Abbott Jewelry Systems), US: the best-documented process found**
- [S] The Edge's conversion can "potentially" convert customers, inventory and sales history, the history "limited". The customer is responsible for the quality of the source data. A signed Conversion Standards form is required. The conversion team builds a preliminary Edge database from the converted data. — [Edge Conversion Standards](https://edgeuser.com/Knowledge/Knowledge-Base/conversion-conversion-procedure-initial-phase-conversion-standards)
- [S] **Open work is not carried over as live documents.** "Repairs are converted as a miscellaneous sale with only the sale total, and repair details are not rebuilt. Open repairs are converted as final sales, and they must be voided and re-entered manually." "All open layaways are converted as picked-up final sales. These transactions should be voided and re-entered in Edge as open layaways." Manual post-conversion cleanup is "in most cases" required: layaways and special orders, customer account balances, merging duplicate customers, and reassigning inventory to the right categories. The page was last updated **April 2022 (older than 2024)**. — [Edge Conversion Standards (devuser mirror)](https://devuser.edgeuser.com/Knowledge/Knowledge-Base/conversion-conversion-procedure-initial-phase-conversion-standards)
- [S] The Edge's QA checklist has a dedicated section, "Verify Vendors, Inventory Item Records, and Item Details: Memo and Consignment (If Applicable)". So memo and consignment stock are checked separately, but the extract gave no conversion rules for them. — [Edge QA checklist: memo and consignment](https://edgeuser.com/Knowledge/Knowledge-Base/conversion-conversion-qa-checklist-verify-inventory-item-records-and-item-details-memo-and-consignment-if-applicable)
- [S] Several preliminary databases ("prelims") can be delivered, with feedback and requested changes after each review. — [Edge: Preliminary database delivered for your review](https://edgeuser.com/Knowledge/Knowledge-Base/conversion-conversion-procedure-evaluation-phase-preliminary-database-delivered-for-your-review)
- [S] A third-party G2 listing says a **$500 deposit** is required to schedule a data conversion, and the conversion starts once that fee is paid in full. This is not confirmed by Abbott. — [G2: Edge pricing](https://g2.com/products/edge/pricing)
- [S] The Edge also has a self-service Item Data Import Wizard (Inventory > Utilities > Item Data Import, tip sheet TIP-2023-200). The column headers in the import file must match Edge field names, and other workstations must be closed during the import. — [Edge: inventory item data import/export](https://edgeuser.com/Knowledge/Knowledge-Base/inventory-item-data-importexport); [TIP-2023-200 PDF](https://devuser.edgeuser.com/Portals/0/docs/TIP-2023-200_ItemDataImportWizard.pdf)
- [S] When merging another store's data into an existing Edge database, shared customers must be merged by hand after conversion. Duplicate categories and vendor codes (e.g. "PAN" vs "PND") appear and need cleaning up. — [Edge: merging multi-store data](https://edgeuser.com/Knowledge/Knowledge-Base/multi-store-multi-store-documents-merging-multi-store-data-into-single-store)

**Other US vendors (all self-reported marketing)**
- [S] WJewel says it regularly migrates inventory, customers, repair history and other transactions from The Edge, Jewelry Shopkeeper, JewelMate, Lightspeed, Business Mind and QuickBooks. It accepts **CSV, Excel, VFP (Visual FoxPro) files, SQL backups and QuickBooks exports**. It quotes **1–3 weeks** from export to go-live for a single store. It says basic migration from common jewelry POS systems is included with onboarding, and its own comparison table lists Jewel360 and The Edge as "limited or extra cost" for migration. That is a competitor's claim. — [WJewel: How to switch your jewelry POS without losing data (2026)](https://www.wjewel.com/blog/how-to-switch-jewelry-pos-system.php); [WJewel FAQ](https://www.wjewel.com/faq.php)
- [S] Bravo Store Systems (pawn/jewelry) says most jewelers switch in about **3–4 weeks**. — [Bravo: Best jewelry store POS software 2026](https://www.bravostoresystems.com/post/best-jewelry-store-pos-software-in-2026)
- [S] Jewel360 says its team moves serialized inventory, customer histories and vendor connections from The Edge. It advises leaving old, unused data behind and keeping active inventory and serialized items. — [Jewel360: The Edge alternative](https://jewel360.com/blog/the-edge); [Jewel360: POS data migration](https://jewel360.com/blog/pos-data-migration); [Jewel360: Edge to Jewel360](https://jewel360.com/edge-to-jewel360)
- [S] Gem Logic offers a self-service path through its built-in import module. It says your current provider is required to give you access to your data. That is a vendor's assertion, not a legal finding. — [Gem Logic data migration](https://www.gem-logic.com/data-migration)
- [S] The vendor sources agree that the jewelry-specific risk sits in field mapping for metal weight, stone data and cost basis. — [GemFind: jewelry POS systems guide 2026](https://gemfind.com/blogs/digital-marketing/jewelry-store-pos-systems-guide)

**Generic retail POS (Lightspeed, Shopify POS)**
- [S] Lightspeed Retail exports inventory as a CSV from Inventory > Item Search. Its import template has a "serialized" column. Re-importing archived SKUs creates duplicates. Quantity on hand must be counted and correct before migrating. — [Lightspeed: preparing inventory data for import](https://retail-support.lightspeedhq.com/hc/en-us/articles/229129988-Preparing-your-inventory-data-for-import)
- [S] Shopify's Lightspeed-to-Shopify guide maps columns one by one (e.g. retail_price → Variant Price, supply_price → Cost per item) and recommends the Matrixify app for bulk import. I found nothing on how serial numbers, certificates or stone attributes carry over. — [Shopify: Lightspeed to Shopify migration](https://www.shopify.com/blog/lightspeed-to-shopify-migration); [Shopify retail: Lightspeed to Shopify](https://www.shopify.com/retail/lightspeed-to-shopify-migration)

**India**
- [S] Indian vendors advertise moving data from Tally, Marg, Vyapar or Excel. One says it loads products, customers, ledgers and opening balances into a test environment for the jeweler to check before go-live, at no charge. Another says its team sets up items, parties and opening stock from Tally or Excel. — [Ornexa: jewellery software](https://ornexajewelleryerp.in/jewellery-software); [Ornexa buyer's guide 2026](https://ornexajewelleryerp.in/blog/best-jewellery-software-india-buyers-guide)
- [S] One 24Gold page describes importing tag stock and running gold loans during setup. — [24Gold](https://24gold.ai/)
- [S] One Indian product syncs with Tally instead of replacing it. Its own layer holds scheme liabilities and karigar metal ledgers, which Tally lacks, and two-way sync keeps Tally authoritative for audit. — [Eriont: jewellery accounting / Tally sync](https://eriont.com/jewellery-software/accounting/); [Tally data connector: jewellery software to Tally](https://tallydataconnector.in/jewellery-software-to-tally/)
- [S] Logic ERP claims it went live at **46 stores of one jewelry chain in 11 days**. It does not say what system they came from or what data was migrated. Self-reported. — [Logic ERP blog](https://www.logicerp.com/blog/record-breaking-superfast-logic-erp-implementation-46-nakshatra-art-jewellery-stores-in-just-11-days/)
- [S] One Indian ERP vendor's blog says "preparing data for import cannot be the responsibility of the ERP solution provider". In other words, cleaning is pushed onto the jeweler. — [GoPiro: implementing a new jewelry ERP](https://www.gopiro.com/blog/are-you-implementing-new-jewelry-erp-thing-definitely-causing-you-headache)
- [S] I found no public documentation of export formats, database structure or import paths for Ornate (DSoft Infotech, Windows-based, for wholesale and manufacturing jewelers), GOLDSOFT or Logic ERP. — [Ornate on IndiaMART](https://m.indiamart.com/dsoft-infotect/); [Capterra: Ornate](https://www.capterra.com/p/87168/ORNATE-Software/alternatives/)

### Inferences
- [E] What usually moves: item masters; in-stock tagged inventory (tag/SKU, category, vendor, cost, retail, and often weight and stone fields if the old system had them); customers; vendors; and, in India, party ledgers and opening balances. What is usually left behind or flattened: detailed sales and repair history (kept as totals or not at all); images; and every open document (repairs/job envelopes, layaways, special orders, memos). Those come over as closed totals and are re-keyed by staff.
- [E] Open memos and consignments (in and out), karigar metal balances by purity, and gold-scheme instalment balances are the least supported items in public material. They are also where the money and the legal exposure sit. A vendor that converts them as live open documents, rather than as final sales to be voided and re-entered, would stand out.
- [E] Typical cost in the US: from free with a subscription up to a few hundred dollars as a deposit, plus heavy unpaid staff time for cleanup and re-keying. Typical duration: 1–4 weeks for a single store. I found no published multi-store or diamond-wholesaler figures.

### Gaps
- I could not confirm current conversion prices for The Edge, Jewel360, Ornate, Logic ERP or GOLDSOFT from their own pages.
- I found no public description of how gold-scheme (instalment) balances, karigar or workshop metal balances, or open memos with diamond certificates are carried over by any vendor.
- I found no Ornate, GOLDSOFT, Logic ERP or Emerald conversion documentation at all.

---

## 2. Why jewelers and diamond firms do not switch: switching costs, lock-in, retraining, tax and stock-count risk

### Takeaway
I found no survey of jewelers specifically. The evidence is vendor guides plus general ERP failure statistics. The recurring barriers are proprietary or encrypted on-premise data, exports that only open in the old vendor's software, manual field mapping, open documents that must be re-keyed, slower support and restricted access once notice is given, and (in India) owners' distrust of software and unwillingness to pay up front.

### Cited Findings
- [S] On-premise and older POS systems often store data in proprietary formats (.db files, encrypted backups, exports that only open in the original vendor's software). Every field has to be mapped by hand, and that mapping is "where most of the risk lives". Some vendors hand over a raw CSV and consider their obligation met. — [KORONA POS: historical sales data migration](https://koronapos.com/blog/pos-historical-sales-data-migration/); [Spartan POS: data migration](https://spartanpos.com/pages/pos-system-data-migration)
- [S] Export before you cancel: once notice is given, support slows and data access can be restricted. — [Lifelong POS: 14-day migration playbook](https://www.lifelongpos.com/resources/blog/migrating-pos-system-14-day-playbook)
- [S] Square advises keeping the old POS active for a short time after switching, to keep access to past data. — [Square: when and how to switch your POS](https://squareup.com/au/en/the-bottom-line/operating-your-business/when-and-how-to-switch-your-pos-system)
- [S] In restaurants, Toast reportedly has no single export of all data, so several files are needed. Its export formats may not import directly elsewhere. Data stays available for 60 days after the account closes. These come from competitor blogs. — [Kwick OS: $14,000 lost to Toast](https://kwickos.com/blog/switching-pos-systems-without-losing-data.html); [Toast (Canada): change POS without losing data](https://pos.toasttab.com/ca/blog/on-the-line/how-to-change-your-restaurant-pos-system-without-losing-data)
- [S] India: a profile of Sales Neuron (a jewelry SaaS startup) reports owners unwilling to pay a one-time cost for software because of distrust of technology. — [Inc42: Sales Neuron](https://inc42.com/startups/sales-neuron-profile)
- [S] General ERP risk figures:
  - Gartner (2009, **older than 2024**, widely re-cited): 83% of data migration projects overrun budget or timeline. Secondary sources describe the metric inconsistently. — [Top Dynamics Partners: failed migrations](https://topdynamicspartners.com/learn/dynamics-migration/failed-migrations)
  - Panorama 2024: 33% of ERP projects over budget, and 35% of respondents blame the overruns on data issues. — [ECI Solutions](https://ecisolutions.com/blog/the-2-million-mistake-why-70-of-erp-implementations-fail); [Impact: ERP stats](https://www.impactmybiz.com/blog/enterprise-resource-planning-erp-stats-facts/)
  - February 2026 research: most SAP migrations bust budgets and timelines. — [The Register, 2026-02-05](https://www.theregister.com/2026/02/05/sap_migrations_research/)
  - Gartner's forecast that by 2027 more than 70% of recently implemented ERP initiatives will not fully meet their business-case goals. — [NetSuite: ERP failure](https://www.netsuite.com/portal/resource/articles/erp/erp-failure.shtml)
- [S] One trade analysis of SAP migrations argues that a faster loader just moves bad data into the new system faster if upstream decisions have not been made. — [erp.today: Accenture McCoy acquisition](https://erp.today/what-accentures-mccoy-acquisition-and-mid-market-push-signals-for-sap-erp-teams/)

### Inferences
- [E] Specific to this trade: (1) stock counts by tag and by weight must match exactly at cut-over, or insurance, lender and consignor positions are wrong; (2) in India the GST return period and the BIS/HUID hallmark records make a mid-period switch risky, so switches cluster at financial-year start (1 April); (3) memo and consignment positions with suppliers and karigars rest on trust, and any discrepancy is a business dispute, not just a data error; (4) staff are used to particular screens and tag-printing layouts.
- [E] Lock-in in this vertical is mostly passive: undocumented FoxPro/Access/SQL schemas, local installs and no export of open documents. I found no evidence of contractual export bans by jewelry vendors.

### Gaps
- I found no Reddit or forum first-hand accounts from jewelers. The search returned none.
- I found no survey of jeweler switching rates or reasons, in the US or India, and no documented case of a jewelry vendor refusing or charging for export.

---

## 3. Legacy technology the data sits in, and the export routes

### Takeaway
US and Indian jewelry systems include desktop applications built on FoxPro/Visual FoxPro, VB6 with MS Access, and SQL Server, many of them on-premise. In India, Tally is the accounting backbone, reachable over XML/HTTP (port 9000) and ODBC. Spreadsheets and paper registers remain common among India's many unorganised jewelers.

### Cited Findings
- [S] WJewel lists **VFP (Visual FoxPro) files and SQL backups** among the formats it accepts from previous jewelry systems. This implies some installed US jewelry POS systems run on VFP or SQL Server. — [WJewel: switching guide](https://www.wjewel.com/blog/how-to-switch-jewelry-pos-system.php)
- [S] An undated student project synopsis describes a jewelry-shop system originally built in FoxPro with a dBase back end, being moved to a VB6 front end with an MS Access back end. It is illustrative of the stack, not evidence of market share. — [Scribd synopsis](https://www.scribd.com/document/505403899/Icecream)
- [S] Ornate is described as Windows-based. Indian listings advertise on-premise multi-user editions at roughly ₹6,500 to ₹49,999. These are listing prices and may be outdated. — [IndiaMART: jewellery software](https://m.indiamart.com/impcat/jewellery-software.html); [Capterra India: Windows jewelry software](https://www.capterra.in/directory/10061/jewelry-store-management/deployment-options/windows/software?page=2)
- [S] **Tally export routes (Tally's official help):**
  - HTTP/XML "Export Data" requests to TallyPrime acting as a server, on port 9000 by default.
  - File-based XML import from Tally's import folder.
  - ODBC, by marking collections `IsODBCTable: Yes`, enabled under Data Synchronization.
  - Tally can also act as a client, pulling over HTTP or ODBC.
  - Pitfall: if the source software gives every voucher the same Voucher ID, an XML import can overwrite or delete existing Tally vouchers. The fix is unique IDs, or stripping remote IDs from the XML before import.
  - Sources: [Tally: XML integration](https://help.tallysolutions.com/xml-integration/); [Tally: TallyPrime as server](https://help.tallysolutions.com/tallyprime-as-server/); [Tally: getting started with integrations](https://help.tallysolutions.com/getting-started-with-tally-integrations/); [Tally: integration initiated from Tally](https://help.tallysolutions.com/integration-initiated-from-tally/)
- [S] TallyPrime markets its own jewellery billing. — [Tally: jewellery billing software](https://tallysolutions.com/billing-software/jewellery/)
- [S] Market structure (World Gold Council): only 15–20% of Indian jewellery manufacturing units are organised and large-scale, up from under 10% about five years earlier. There is no single industry definition of organised versus unorganised. WGC treats a jeweler as organised if it invoices gold sales, uses banking channels and ERP systems, and holds BIS registration. — [WGC: India's gold jewellery market structure](https://www.gold.org/goldhub/research/indias-gold-jewellery-market-structure); [WGC: jewellery market structure, India gold market series](https://www.gold.org/goldhub/research/jewellery-market-structure-india-gold-market-series)
- [S] Vendor blogs say many Indian jewelers still use notebooks, Excel or basic billing tools. These are anecdotal and promotional, not survey data. — [Vyaparify: traditional bookkeeping](https://h-id.vyaparify.com/sukhdev-singh-jewellers/blog/transforming-traditional-bookkeeping-a-modern-solution-for-indian-jewellers); [AuricSuite blog, January 2026](https://auricsuitejewelleryerp.blogspot.com/2026/01/is-traditional-jewellery-management.html)
- [S] The current Indian low end is cloud and mobile billing apps (Vyapar, myBillBook, GimBooks, Marg). GimBooks is noted for girvi (pledge) handling. — [GimBooks: best jewellery billing software](https://www.gimbooks.com/blog/best-jewellery-billing-software/); [Vyapar: jewellery POS](https://vyaparapp.in/pos-software/jewellery)

### Inferences
- [E] Realistic extraction routes for a newcomer, from most to least structured:
  1. Tally XML/ODBC for ledgers, parties and stock-item masters.
  2. SQL Server `.bak` restore, or ODBC read of a vendor's SQL or Access database.
  3. Reading VFP `.dbf` files directly (open readers exist; memo `.fpt` and index `.cdx` files travel with them).
  4. CSV/Excel reports printed from the old system's own report screens. These are often the only practical route for closed systems, and they are lossy.
  5. Photos or scans of paper stock books, karigar books and scheme cards.
- [E] Spreadsheets as the system of record are likely the norm for small Indian jewelers and for many diamond traders' memo books, given WGC's 15–20% organised share. That is an inference, not a measured rate.

### Gaps
- I found no source on Firebird or other specific databases behind named Indian jewelry products (Ornate, GOLDSOFT, Logic ERP, Emerald), and no study of how often spreadsheets are the system of record.

---

## 4. Reconciliation: how a cut-over is proven correct

### Takeaway
The only formal procedure found is The Edge's. It compares old and new counts and values (customers, in-stock items, total in-stock cost, vendors) against the old system's in-stock reports subtotalled by vendor and by category, then a page-by-page QA checklist, with sign-off per line. Indian guidance stresses proving opening balances before paying. Nothing found covers reconciling weight (gross, net, fine) or carats.

### Cited Findings
- [S] The Edge's "General Data Verification" table compares the old and new databases on: number of customers, number of in-stock inventory items, **total cost of in-stock inventory**, and number of vendors. Each line has a column to explain any difference and a column for acceptance. — [Edge QA: general data verification](https://edgeuser.com/Knowledge/Knowledge-Base/conversion-conversion-qa-checklist-general-data-verification)
- [S] The Edge's reconciliation forms (CustInvOnly and CustInvSales) ask the old system for an in-stock inventory report subtotalled by vendor, and another by category or department, with grand totals for item count, cost and retail. The new database is checked against these. — [Edge: Reconciliation Form (CustInvSales)](https://edgeuser.com/Knowledge/Knowledge-Base/conversion-conversion-procedure-initial-phase-reconciliation-form-custinvsales); [Edge: Reconciliation Form (CustInvOnly)](https://edgeuser.com/Knowledge/Knowledge-Base/conversion-conversion-procedure-initial-phase-reconciliation-form)
- [S] The QA checklist runs in order: preliminary database package → general data verification → how to evaluate the preliminary database → item-level pages (e.g. "Verify Fine Item Records", page 4). The prelim is tested for operational integrity and compared with the reconciliation data the store supplied. — [Edge QA checklist](https://edgeuser.com/Knowledge/Knowledge-Base/conversion-conversion-qa-checklist); [Edge: Verify Fine Item Records](https://edgeuser.com/Knowledge/Knowledge-Base/conversion-conversion-qa-checklist-verify-inventory-item-records-and-item-details-fine-item-records); [Edge: how to evaluate the preliminary database](https://edgeuser.com/Knowledge/Knowledge-Base/conversion-conversion-qa-checklist-how-you-should-evaluate-the-preliminary-database)
- [S] An Indian buyer's guide says the vendor should prove the opening balances match before any payment. — [Ornexa buyer's guide 2026](https://ornexajewelleryerp.in/blog/best-jewellery-software-india-buyers-guide)
- [S] Lightspeed requires a physical count before migrating, so that quantity on hand is right. — [Lightspeed: preparing inventory data](https://retail-support.lightspeedhq.com/hc/en-us/articles/229129988-Preparing-your-inventory-data-for-import)
- [S] Vendors recommend a parallel cut-over: the new system is fully loaded and tested before the old one is switched off. — [WJewel: switching guide](https://www.wjewel.com/blog/how-to-switch-jewelry-pos-system.php)

### Inferences
- [E] A trade-grade proof of cut-over would add the following, each as a control total by location, category and status (own stock, memo-in, memo-out, at karigar, on approval):
  - tag count;
  - total gross weight (g);
  - net metal weight per purity, and fine weight (net × purity), per metal;
  - total diamond and colour-stone carats and pieces;
  - certificate count, with certificate numbers checked against the lab (e.g. GIA's API);
  - cost and retail value;
  - open receivables and payables;
  - metal balance per karigar per purity;
  - scheme balance per customer (instalments paid, gold-weight credit);
  - open repair and job count.
  Each is signed off by the owner against the old system's own report printed on cut-over day, plus a physical tag scan of a sample or the full stock.
- [E] Certificate data can be re-verified rather than trusted. Per GIA's developer pages [S]: GIA's Report Results API (GraphQL; needs a lab account and an application; sandbox available) costs **US$0.20 per lookup**, with monthly plans. GIA's free Report Check is a web page, not an API. Its pages disagree on whether re-retrieval is covered for 18 or 24 months. — [GIA Report Results API](https://gia.edu/report-results-api); [GIA Report Data Services](https://www.gia.edu/report-data-services); [GIA developer](https://gia.edu/developer). I found no public IGI verification API.

### Gaps
- I found no published practice for reconciling weight, purity or carats at a jewelry cut-over, nor for memo and consignment positions, karigar metal balances or gold-scheme liabilities.
- I found no account of how long jewelers actually run old and new systems in parallel.

---

## 5. AI-assisted migration and onboarding: state of the art 2024–2026, realistic accuracy, where a human must confirm

### Takeaway
LLM schema matching has advanced a lot in research (Magneto, Matchmaker, ReMatch, LLMatch, Schemora), but accuracy on hard real-world benchmarks is still modest. Top-1 accuracy is around 60% on MIMIC→OMOP, and plain GPT-3.5 matching scored about 0.24 F1. Commercial importers (Flatfile, OneSchema, Osmos) auto-map columns behind confidence thresholds and remembered mappings but publish no accuracy figures. ERP vendors' AI migration tools are mostly in preview. Systems integrators claim speed-ups (TCS "up to 70%", Accenture "weeks to days" per load cycle) without independent baselines. Document AI on clean printed invoices reaches about 90–99% field accuracy in self-reported write-ups. Handwritten, mixed-script ledgers have no benchmark. Human confirmation is still needed for mapping sign-off, low-confidence extractions and every control total.

### Cited Findings
**Research on schema matching**
- [S] **Magneto** (NYU, PVLDB 2025) works in two phases. Small language models retrieve candidate matches cheaply, then an LLM reranks them. The small models are fine-tuned on LLM-generated synthetic data, so no labelled data is needed. The authors report high accuracy on a new benchmark and on existing ones; the extract gave no numbers. Code: VIDA-NYU/magneto-matcher. — [arXiv 2412.08194](https://arxiv.org/html/2412.08194v2); [VLDB](https://vldb.org/pvldb/volumes/18/paper/Magneto%3A%20Combining%20Small%20and%20Large%20Language%20Models%20for%20Schema%20Matching)
- [S] **Parciak et al. 2024** ("Schema Matching with LLMs: an Experimental Study", VLDB TaDA workshop) used off-the-shelf decoder-only GPT models without fine-tuning, on a 9-dataset MIMIC-IV → OMOP benchmark. A later paper reproduces its GPT-3.5 baseline at a **mean 1-to-1 F1 of 0.241**. — [arXiv 2407.11852](https://arxiv.org/pdf/2407.11852); [VLDB TaDA 2024](https://vldb.org/workshops/2024/proceedings/TaDA/TaDA.8.pdf); [arXiv 2508.15610](https://arxiv.org/pdf/2508.15610)
- [S] **Matchmaker** (self-improving LLM programs) reports **62.2 ± 2.4% top-1 accuracy** on MIMIC-OMOP. — [arXiv 2410.24105](https://arxiv.org/pdf/2410.24105)
- [S] Other methods:
  - **ReMatch** (retrieval-enhanced LLM matching, 2024). — [arXiv 2403.01567](https://arxiv.org/html/2403.01567v2)
  - **Schemora** (2025; multi-stage retrieval and metadata enrichment with off-the-shelf LLMs, evaluated on MIMIC-OMOP). — [arXiv 2507.14376](https://arxiv.org/abs/2507.14376)
  - **LLMatch / SchemaNet** (APWeb 2025; a benchmark of real enterprise multi-table schema pairs across three domains; staged table selection then column alignment). — [arXiv 2507.10897](https://arxiv.org/abs/2507.10897)
  - **ConStruM** (2026; structure-guided matching). — [arXiv 2601.20482](https://arxiv.org/pdf/2601.20482)
  - **KcMF** (fine-tuning-free schema and entity matching). — [arXiv 2410.12480](https://arxiv.org/pdf/2410.12480)
  - **Constraint-guided enterprise data mapping with LLMs** (2026). — [arXiv 2608.24218](https://arxiv.org/pdf/2608.24218)
  - **BDIViz** (2026; interactive curation and benchmarking of matchers, with a human in the loop). — [arXiv 2604.10763](https://arxiv.org/pdf/2604.10763)
- [S] **SMoG** (graph-based matching, 2025) reports **F1 of 41.67% on the CMS dataset**, against 47.82% for KG-RAG4SM and 32.72% for the Jellyfish LLM baseline. — [arXiv 2511.20285](https://arxiv.org/html/2511.20285)

**Data-onboarding products**
- [S] **Flatfile**'s Automap plugin runs only when mapping confidence clears a threshold. If even one column falls short, the whole automatic mapping job is aborted and a human maps instead. One comparison says Flatfile was renamed "Obvious" in 2025 and leans toward enterprise migration projects. — [Flatfile docs: Automap](https://flatfile.com/docs/plugins/automap); [Rocketlane: Flatfile alternatives](https://www.rocketlane.com/blogs/flatfile-alternatives)
- [S] **OneSchema** says its auto-mapping now maps more columns and remembers past successful mappings. Its only published figures are for speed (1M rows in 17.5 s), not mapping accuracy. — [OneSchema product update, September 2022 (older than 2024)](https://www.oneschema.co/blog/product-update-september-22); [OneSchema: Flatfile competitors](https://www.oneschema.co/blog/flatfile-competitors-alternatives)
- [S] **Osmos** offers "AutoRecall", machine-learning transformations for recurring pipelines. — [FileFeed: data onboarding tools compared 2026](https://www.filefeed.io/blog/data-onboarding-tools-comparison); [DataFlowMapper: embedded CSV importers](https://dataflowmapper.com/blog/best-embedded-csv-importers-saas)
- [S] I found no independent accuracy benchmark for any commercial importer's column mapping. — (search found none)

**ERP vendors and systems integrators**
- [S] **Microsoft Dynamics 365 Activate** is an AI migration tool in **public preview**, first for Salesforce → Dynamics 365 (CRM). ERP scenarios are planned for later in 2026, with agentic mapping, test sampling and natural-language guidance on the roadmap. Separately, the Dynamics 365 ERP MCP server is generally available, but it is not a migration tool. — [Pulse 2.0: Dynamics 365 Activate](https://pulse2.com/microsoft-launches-dynamics-365-activate-to-accelerate-ai-powered-crm-and-erp-migrations/); [Microsoft 2026 release wave 1 plans](https://www.microsoft.com/en-us/dynamics-365/blog/business-leader/2026/03/18/2026-release-wave-1-plans-for-microsoft-dynamics-365-microsoft-power-platform-and-copilot-studio-offerings/); [erp.today: Dynamics 365 agentic ERP roadmap](https://erp.today/microsoft-dynamics-365-agentic-erp-roadmap-2027/)
- [S] Power Platform's data workspace offers AI-assisted mapping of external data into Dataverse tables (2024 wave 2). — [Microsoft Learn: data workspace](https://learn.microsoft.com/en-us/power-platform/release-plan/2024wave2/data-platform/data-workspace)
- [S] **SAP**: Joule's 2025 items are mainly Microsoft 365 Copilot interop and zero-copy Business Data Cloud links to Fabric, not migration tooling. A third-party guide says ECC and unconverted on-premise S/4HANA customers do not get Joule. — [SAP Help: 2025 what's new for Joule](https://help.sap.com/docs/joule/what-s-new-history-for-joule-612651ba3e4941e1800590e66a8a0e00/2025-what-s-new-for-joule); [ERP Research: SAP Joule](https://www.erpresearch.com/en-us/sap-joule); [erp.today: Joule and Microsoft](https://erp.today/sap-connects-joule-work-to-microsoft-work-iq-copilot-studio-and-fabric)
- [S] **Accenture**: Data Conversion Manager is a GenAI tool that automates data transformation and reduces dependence on experts. Its SAP partner listing says it cuts data-migration load cycles "from weeks to days". — [Accenture: Data Conversion Manager flyer](https://www.accenture.com/content/dam/accenture/final/accenture-com/document-4/Flyer-Data-Conversion-Manager.pdf); [SAP partner listing: Accenture Intelligent Data Platform](https://www.sap.com/canada-fr/products/data-cloud/partners/accenture-global-solutions-ltd-accenture-intelligent-data-platform.html)
- [S] **TCS** claims "up to 70% faster modernisation outcomes" from its AI-first approach. That covers data platforms, not specifically ERP, and is self-reported. TCS and SNP have a 2026 SAP asset on AI for S/4HANA data readiness. — [TCS white paper](https://www.tcs.com/what-we-do/services/data-and-analytics/white-paper/accelerate-data-platform-modernisation-with-ai-first-approach); [SAP asset: TCS and SNP, May 2026](https://www.sap.com/assetdetail/2026/05/d87b2692-507f-0010-bca6-c68f7e60039b.html)
- [S] KPMG frames AI as a data-readiness tool for ERP migrations. — [KPMG: AI data readiness for ERP data migrations](https://kpmg.com/au/en/insights/artificial-intelligence-ai/ai-data-readiness-erp-data-migrations.html)
- [S] **Odoo**: I found no native AI import feature in versions 18 or 19. The standard import offers templates with mapping preconfigured. Third-party apps on the Odoo 19 store add AI mapping suggestions ("AI Data Importer"); one, "AI User Migrator", sends uploaded data to Google Gemini, which raises privacy concerns. Ksolves' Tally-to-Odoo guide positions AI as drafting mappings while a consultant validates them. — [Odoo 19 docs: export and import data](https://www.odoo.com/documentation/19.0/applications/essentials/export_import_data.html); [Odoo app: AI Data Importer](https://apps.odoo.com/apps/modules/19.0/ai_data_importer); [Odoo app: AI User Migrator](https://apps.odoo.com/apps/modules/19.0/ai_user_migrator); [Ksolves: Tally to Odoo migration](https://www.ksolves.com/blog/odoo/tally-to-odoo-migration)
- [S] I found no specific AI-migration claims for **NetSuite** or **Oracle** in the results. — (search found none)

**Document AI (invoices, handwriting)**
- [S] An October 2025 arXiv paper proposes field-level precision, consistency-check failures and exact match for invoice extraction. It names straight-through-processing rate, manual review rate and false auto-approval rate as the business KPIs that matter. — [arXiv 2510.15727](https://arxiv.org/html/2510.15727v1)
- [S] A practitioner write-up (self-reported): about 91% field-level accuracy with an Azure OpenAI RAG setup ("at 10,000 invoices/month, that's 700 invoices with errors"); about 99% after fine-tuning, with confidence below 0.95 routed to human review. — [Towards AI: 99% accurate invoice processing](https://towardsai.net/p/machine-learning/how-we-built-a-99-accurate-invoice-processing-system-using-ocr-and-llms)
- [S] An aggregator cites about 90% field accuracy for Claude 3.5 Sonnet, 96.5% for Gemini 2.5 Pro on clean invoices and 99.5% for ABBYY-class IDP tools. The primary sources are unverified. — [HackerNoon: best AI models for invoice processing](https://hackernoon.com/the-best-ai-models-for-invoice-processing-benchmark-comparisons); [LlamaIndex: best AI for invoice processing](https://www.llamaindex.ai/insights/best-ai-for-invoice-processing)
- [S] An unsourced estimate puts straight-through processing at 70–80% of invoices, with the rest going to a human queue. — [VIPS: finance invoice automation](https://learn.engineering.vips.edu/applications/finance-invoice-processing-automation)
- [S] Handwriting:
  - IndicPage-OCR (IIIT Hyderabad, 2026) fine-tunes a VLM with LoRA and reports lower WER/CER than baselines on handwritten Hindi, Bengali, Tamil and Telugu pages. — [IndicPage-OCR](https://cvit.iiit.ac.in/images/ConferencePapers/2026_01/IndicPage-OCR.pdf)
  - Sarvam's Indic OCR Bench has about 6,900 samples in 22 languages plus English. — [Sarvam Vision 2.1](https://www.sarvam.ai/blogs/sarvam-vision-2-1)
  - A December 2025 study on handwritten Marathi legal documents found OCR-first pipelines propagate recognition errors. — [arXiv 2512.18004](https://arxiv.org/pdf/2512.18004v1)
  - CHURRO (EMNLP 2025) covers historical handwriting in 14 scripts. — [ACL Anthology: EMNLP 2025](https://aclanthology.org/anthology-files/pdf/emnlp/2025.emnlp-main.1763.pdf)
  - A production-scale OCR design paper for India (2026). — [arXiv 2602.16430](https://arxiv.org/html/2602.16430)
  - **I found no benchmark on handwritten ledgers or tabular numerals** (weights, purities, rates), which is what a jeweler's stock book or karigar book holds.

### Inferences
- [E] What AI can realistically automate today for a jewelry migration:
  1. Drafting the column-to-field mapping from a dump of an unfamiliar schema (FoxPro, Access, SQL, CSV) using column names plus sample values. This works well on jewelry fields, which follow strong value patterns: weights in grams with 2–3 decimals; purity as 22K, 916 or 18K/750; carats; GIA numbers of 10 digits; tag-number formats.
  2. Normalising vocabularies (shape, colour, clarity, metal, category codes) against a fixed canonical list.
  3. Extracting header and line fields from printed purchase invoices, memos and lab certificates, then checking each certificate against GIA's API.
  4. Turning old-system reports (PDF or print-to-file) into rows.
  5. Generating the control-total reconciliation and explaining the differences.
- [E] What still needs a human:
  - accepting the mapping, especially for semantically ambiguous fields such as net versus gross weight, cost versus tag price, and wastage or making charges;
  - every row below a confidence threshold (the Flatfile pattern of aborting when any column is unsure is a good model);
  - handwritten books;
  - open-document status (is this memo still open? is this repair collected?);
  - and the final sign-off of control totals against a physical tag count.
- [E] Plan for roughly 85–95% of columns mapped automatically on a new legacy schema, with near-100% only after a human pass. Plan for most printed fields extracted automatically, and for handwriting to be human-verified line by line. These are estimates built from the benchmark ranges above. Real-world MIMIC→OMOP top-1 is only about 62%, but jewelry schemas are far smaller and more regular than clinical ones.
- [E] The defensible design is the research pattern of retrieve-then-rerank with confidence scores and a human review queue, plus a library of saved mappings per source product (as OneSchema does). Once one Ornate or Edge database has been mapped, the next customer on the same product is nearly automatic.

### Gaps
- I could not open the papers (arxiv.org blocked), so Magneto's numbers and Parciak's GPT-4 numbers are missing.
- There is no independent accuracy data for Flatfile, OneSchema, Osmos or Dromo (Dromo was not covered by results). There are no named-client baselines for the SI speed claims. There are no NetSuite or Oracle AI migration specifics. There is no OCR benchmark for handwritten numeric ledgers.

---

## 6. Patterns from other verticals where a newcomer won by making migration easy

### Takeaway
The repeatable playbook is: free migration done by the vendor's own team, a buyout of the remaining contract with the incumbent, and, in some cases, data-export tooling aimed at the incumbent's specific product. Clio is the clearest documented case. Shopify POS bundles free migration with hardware and discounts. Lightspeed paid competitors' termination fees, tied to adopting its payments. I found no source showing an explicit "we import your old system or it's free" guarantee, or measuring how much these offers moved win rates.

### Cited Findings
- [S] **Clio** (legal practice management):
  - Its Migrations Team transfers data from "your current system — at no additional cost" for many common systems. Complex or unsupported systems may cost extra. Migration takes "a few days to a few weeks".
  - Its "Break Free" offer gave up to 6 months of free Clio depending on the remaining contract value. A contract ending within 90 days did not qualify. One regional version required purchase by 30 April 2026.
  - LawNext (March 2024) covered Clio offering to buy out firms stuck in long-term contracts.
  - Sources: [Clio data migration](https://www.clio.com/en-au/data-migration/); [Clio Break Free](https://www.clio.com/web/break-free/); [Clio Break Free press release](https://www.clio.com/uk/about/press/break-free/); [Clio: PCLaw switch](https://www.clio.com/ca/web/pclaw-switch/); [LawNext, 2024](https://www.lawnext.com/2024/03/stuck-in-a-long-term-contract-with-a-practice-management-vendor-clio-offers-to-buy-you-out.html)
- [S] **Shopify POS**: the POS Pro yearly offer bundles free hardware, **free migration by a "POS expert" who handles setup, data migration and go-live support**, and 25% off the subscription. It is valued at over $2,300 and limited to retailers new to POS Pro. A rebate requires $10,000 in Shopify Payments sales within 90 days. Shopify also publishes competitor-specific migration guides (e.g. from Lightspeed, Square). — [Shopify POS Pro yearly (India page)](https://www.shopify.com/in/pos/pos-pro-yearly); [Shopify: switch now](https://www.shopify.com/co/pos/switchnow); [Shopify: Lightspeed migration](https://www.shopify.com/blog/lightspeed-to-shopify-migration)
- [S] **Lightspeed** covered termination fees on existing payment-processing contracts and offered up to $1,500 off Retail, both conditional on adopting Lightspeed Payments. The offer ran through FY24 (**older than 2024 / likely expired**). — [Lightspeed: switch to Lightspeed Payments](https://www.lightspeedhq.com/pos/retail/switch-to-lightspeed-payments-x); [Bicycle Retailer: Lightspeed FAQ PDF](https://www.bicycleretailer.com/sites/default/files/downloads/article/lightspeed_faq.pdf)
- [S] **Restaurant POS**:
  - SkyTab's onboarding team reportedly pulls menu, customer and transaction data from Toast via API.
  - DineOpen and KwickOS advertise free import of a Toast menu configuration.
  - Toast itself advertises tailored onboarding for restaurants coming from paper or legacy tools.
  - I found no Toast migration guarantee.
  - Sources: [North Penn Now: switching from Toast to SkyTab, 2026](https://northpennnow.com/news/2026/feb/16/why-restaurants-switching-from-toast-choose-skytab-instead/); [DineOpen: Toast alternatives 2026](https://www.dineopen.com/blog/toast-pos-alternatives-2026.html); [KwickOS](https://kwickos.com/blog/switching-pos-systems-without-losing-data.html); [Toast (Ireland): change POS without losing data](https://pos.toasttab.com/ie/blog/on-the-line/how-to-change-your-restaurant-pos-system-without-losing-data)
- [S] **ServiceTitan**: onboarding reportedly includes data migration, account set-up and training. A cottage industry of fixed-price migration shops serves migrations into and out of it. The S-1 analyses of November 2024 cover its onboarding model. — [G2: is it easy to migrate to ServiceTitan?](https://www.g2.com/discussions/is-it-easy-to-migrate-to-servicetitan); [Tyler Willis: ServiceTitan to Housecall Pro fixed-price migration](https://tylerewillis.com/migration/servicetitan-to-housecall-pro); [ServiceTitan S-1 breakdown](https://alexandre.substack.com/p/servicetitans-s-1-breakdown)
- [S] Vertical-SaaS siblings of Jewel360 (Music Shop 360) and Tower Systems (Australia) run "switching to us" pages with done-for-you migration. — [Music Shop 360: migrating your data](https://musicshop360.com/blog/migrating-your-data-with-music-shop-360); [Tower Systems: switching to Tower](https://www.towersystems.com.au/switching-to-tower)

### Inferences
- [E] What seems to work:
  1. The vendor does the migration rather than handing the customer a template.
  2. The vendor builds specific importers for the two or three dominant incumbents (Clio for PCLaw; Shopify for Lightspeed and Square; jewelry vendors for The Edge).
  3. The vendor neutralises the remaining contract with a buyout or credit.
  4. The vendor funds migration from payments or subscription revenue rather than charging for it.
- [E] For jewelry this would mean prebuilt extractors for The Edge (US), Tally plus the top Indian jewelry packages (Ornate, GOLDSOFT, Logic ERP, Emerald and others), and spreadsheets. Open memos, repairs, karigar balances and scheme balances would be converted as live documents. A signed control-total reconciliation would be offered as a guarantee, with a parallel run. No found vendor offers that combination publicly.

### Gaps
- I found no data on how much free migration or buyouts lifted conversion or win rates in any vertical. I found nothing on Procore, Veeva (the Vault CRM switch from Salesforce) or Square-specific migration offers.
