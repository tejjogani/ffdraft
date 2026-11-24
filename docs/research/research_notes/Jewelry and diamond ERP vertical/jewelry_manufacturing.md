# ERP and production software for fine-jewelry manufacturers (design to finished, tagged piece), state as of Nov 2026

**Method and limits (read first).** Research ran on 2026-11-24. Every page fetch was blocked by this environment's network allowlist (DNS refused: gopiro.com, jewelry-admin.com, flowsense.solutions). After three such failures I stopped fetching, as the environment instructed. **So no claim below is [V].** Every sourced claim comes from search-result extracts **[S]**: the search tool returns a model-written summary plus short quotes, not the page itself. Inferences are **[E]**. Most sources are vendor marketing or SEO listicles (Synergics, Gitnux, Worldmetrics, SoftwareSuggest), so treat feature claims as claims, not proof. Search extracts rarely carry dates; anything known to be older than 2024 is marked **(pre-2024)**. 19 searches in all; no names from the project appeared in any query.

---

## 1. Metal accounting: gross, net and stone weight, purity, fine weight, alloying, scrap and refining, metal-on-account and gold loans

### Takeaway
Weight-based metal ledgers are standard in jewelry-specific systems: a balance per party in fine grams beside the currency balance, purity conversion, and loss against tolerance. Horizontal ERPs (NetSuite, Business Central, SAP B1) have none of this natively and get it from a vertical add-on or custom build. True allocated and unallocated pool accounting, the way bullion banks do it, exists only in bullion and trading software (ION), not in jewelry ERPs.

### Cited Findings
- **Metal is kept as a ledger in its own right, separate from cash.** Daysum (a GCC/Arabic-market jewelry ERP) "tracks these metal balances independently of your cash accounts to protect both parties from currency and gold price fluctuations". Its example is a supplier delivering chains, with the debt recorded in weight, not dollars [S]. — [Daysum consignment](https://daysum.net/en/jewelry-consignment-software-erp/)
- Zsoltech describes metal as "an account in its own right": pure grams held as stock, owed to suppliers, and credited to customers [S]. — [Zsoltech metal ledger](https://www.zsoltech.com/jewelry-accounting-software)
- EasyJewelry shows each party's balance in both grams and currency. Its Loan module tracks gold and silver loans given against jewelry collateral, with the outstanding balance in metal and currency. This is retail pawn-style lending, not supplier gold loans [S]. — [EasyJewelry balance sheet](https://easyjewelry.co/features/balance-sheet)
- Memo gold deals are often priced as metal weight plus a fixed making charge; the vendor payable is worked out at the gold rate on the day of sale [S]. — [Daysum consignment](https://daysum.net/en/jewelry-consignment-software-erp/)
- WJewel (US) handles customer and vendor memos, purchase orders, invoices and consignments for wholesale and manufacturing [S]. — [WJewel](https://www.wjewel.com/)
- **Pool accounts.** ION's precious-metals product lets bullion custodians and refiners "manage their allocated and unallocated gold pools" and handles consignment stock as well as owned stock. It is aimed at bullion and refining, not jewelry factories [S]. — [ION precious metals](https://iongroup.com/products/commodities/precious-metals/)
- **e-Jewelry (an extension on Microsoft Dynamics 365 Business Central)** keeps day-to-day prices per metal, metal statements for customers and vendors (including outstanding metal owed to a vendor), and "metal-based toll accounting" [S]. — [e-Jewelry](https://e-jewelry365.com/); [BC capability guide PDF, 2023 (pre-2024)](https://e-jewelry365.com/pdf/Business-Central-Capabilities-Guide-e-Jewelry-Detailed-Features.2023.pdf)
- NetSuite ships no jewelry vertical. Folio3 builds custom integrations with metal exchange data feeds to keep material costs current in NetSuite's BOM and costing engine [S]. — [Folio3 NetSuite blog](https://netsuite.folio3.com/blog/best-erp-for-jewellery-manufacturers/)
- Jobin & Jismi's Jewellery Manufacturing Suite (JMS), built on NetSuite, claims metal tracking "by weight, location and purity standards" [S]. — [Jobin & Jismi JMS](https://www.jobinandjismi.com/industries/jewellery-manufacturing)
- Integrators such as Mindster configure Dynamics 365 for metal rates, karat conversion and making charges [S]. — [Mindster](https://mindster.com/industries/jewellery-digital-transformation)
- SAP Business One vendor pages claim per-item records of weight, purity and value. An independent comparison says precious-metal cost integration, lot-level traceability and multi-entity consolidation are where B1 "shows its SMB origins", and that its jewelry add-on ecosystem is fragmented [S]. — [Elevratech SAP B1](https://www.elevratech.in/industries/gems-and-jewellery/); [Gitnux](https://gitnux.org/best/jewellery-manufacturing-software/)
- Open source: JewelimaERP (ERPNext v16 / Frappe v16 app) keeps the native Stock Ledger, Work Order and BOM, and adds a **Metal Ledger** that is opt-in per item ("Keep Metal Ledger"). Submitting a Purchase Receipt or Invoice posts a Metal Ledger Entry for each such line automatically [S]. — [GitHub JewelimaERP](https://github.com/JoE7289ee/JewelimaERP)
- Casting arithmetic (Rio Grande instruction sheet, 2023, pre-2024): weigh the wax tree, add about 10% for the button, then multiply by the alloy's specific gravity. Example: 5.5 g wax × 13.07 (14KY) = 71.89 g of metal [S]. — [Rio Grande PDF](https://www.riogrande.com/globalassets/knowledge-hub/instruction-sheets/2023/how-to-determine-metal-weight-for-wax-trees-pdf.pdf)

### Inferences
- [E] The minimum data model the market expects: per transaction, gross weight, stone weight, net metal weight, karat or fineness, and fine (pure) weight. Per party (supplier, karigar, customer, refiner), a running balance in fine grams for each metal beside the currency balance. Loss and wastage carried as tolerated versus actual.
- [E] Alloying (fine gold plus master alloy into a karat lot) and refining (scrap, filings and sweeps sent to a refiner, assay, fine metal credited back) were described only in passing. I found no source showing a jewelry ERP that models the assay-and-settlement lifecycle with a refiner as well as ION does for bullion. This is a likely gap.
- [E] "Gold loan" means two things. Retail Indian and Gulf software uses it for loans to consumers against jewelry. Manufacturers in the US, Italy and India use it for leased or consigned metal from banks and bullion dealers, with lease fees in grams or %. The second meaning showed up in no jewelry-ERP result.

### Gaps
- No source detailed refining-lot settlement (assay result versus declared fine weight, refining charges, recovery %) inside a jewelry ERP.
- No source showed manufacturer metal-lease accounting (bank consignment gold, lease rate, hedging) in any vertical system.
- Platinum and silver specifics (Pt 950/Pt 900, sterling 925, different loss rates) were not covered by any extract.

---

## 2. Job work and workshops: karigars and contract casters or setters, issue and receipt by weight, allowed loss, piece-rate and per-gram labour, reconciliation

### Takeaway
Every India- and Gulf-focused vendor sells the same pattern: issue metal and stones to a karigar or department by weight, receive back pieces plus scrap, compare the loss with a per-process tolerance, debit any excess to the worker's ledger, and pay labour per piece or per gram. Tally cannot do this without add-ons. The differences between vendors are depth and auditability, not concept.

### Cited Findings
- **FlowSense:** a ledger per artisan of metal issued, metal returned, and deductions for loss above tolerance; actual loss reconciled against tolerance per job card for each stage (casting, filing, polishing) [S]. — [FlowSense](https://www.flowsense.solutions/jewellery-manufacturing-erp) (fetch blocked)
- **Synergics (SEA ERP, India):** a loss-management module tracks metal and stone issues against receipts per worker or department, and computes melting, filing and polishing losses against preset tolerances; it benchmarks loss % per karigar by process and metal type [S]. — [Synergics manufacturing](https://www.synergicssolutions.com/jewellery-erp-suite/jewellery-manufacturing-software); [Synergics loss article](https://www.synergicssolutions.com/top-5-ways-jewellery-manufacturing-software-reduces-production-losses-in-2026)
- **SunFacet / Suntech (Dubai):** tracks issued weight, returned weight and production loss by worker, by process and by design; its job-work module debits shortages automatically [S]. — [Suntech](https://www.suntech-global.com/jewellery-manufacturing-software/)
- **Joolet (India, Windows desktop):** controls metal loss by percentage or by "touch" (purity), showing where wastage happens across casting, handmade work and job work; also offers karigar tracking [S]. — [Joolet](https://joolet.com/jewellery-manufacturing-inventory-management-software/)
- **Tally** handles outsourced gold work as "job work-out". A worked case assumes a yield ("out of 10 gms of raw gold only 8 gms will be converted") so the worker's output can be checked against billing [S]. — [TallyNine job work](https://tallynine.com/job-work-for-gold-processing/)
- A vendor guide says Tally "does not price an ornament from a live rate and weight … or track metal issued to karigars". The usual Indian split: a jewelry ERP runs operations and passes clean figures to Tally for the books [S]. — [Whirl Designs](https://whirldesigns.com/blog/jewellery-erp-for-small-jewellers)
- Vowerole and others list the same karigar module: metal issued, expected return weight, wastage tolerance, outstanding balance; receipts, wastage, labour charges and settlement on one running ledger [S]. — [Vowerole](https://www.vowerole.com/industries/custom-jewellery-erp)
- Indian GST context: open-source JewelCore ERP handles "Karigar job-work metal reconciliation (Form GST ITC-04)". ITC-04 is the GST return for goods sent to and received from job workers [S]. — [GitHub JewelCore-ERP](https://github.com/prasant-0n/JewelCore-ERP)
- Other open-source projects (CaratFlow; a `/karigar-management/ledger` route covering work, payment, material and balance ledgers) are small personal repositories [S]. — [GitHub ratsam93](https://github.com/ratsam93/jewelry-ERP-platform); [GitHub jewellery-software (Laravel 13/MySQL)](https://github.com/webotapp-academy/jewellery-software)
- **Italy, contract workshops ("conto terzi" / "conto lavorazione"):** Valenza Ufficio sells Visual Cedsoft, plus a simplified edition for workshops that work for third parties and control jobs commissioned by others [S]. — [Valenza Ufficio, conto terzisti](https://valenzaufficio.it/soluzioni-light/)

### Inferences
- [E] Contract casters and setters in the US and Italy work the same way as karigars in India, but the terms differ: "consignment to contractor", "conto lavorazione", "toll". e-Jewelry's "metal-based toll accounting" is the Business Central version of the same idea.
- [E] What separates vendors: (a) tolerance per process, per metal and per karigar versus one flat %; (b) whether scrap, filings and dust come back as separate items at their own purity; (c) whether loss is settled in fine weight or in money; (d) whether labour rate cards (per piece, per gram, per stone set) are tied to the job card. The extracts describe (a) and (b) only loosely.
- [E] A new system would need to beat the incumbents on audit trail and on handling a weighing scale at the bench (no retyping weights). Clockwork's SAP B1 work says scales can feed financial systems, but this is not shown as standard anywhere.

### Gaps
- No pricing or customer counts for Synergics, Suntech, Joolet or FlowSense.
- No independent evidence (reviews, case studies) that karigar loss modules reduce loss; vendor-claimed reduction figures are unverified.
- No source on how stone-setting labour is paid per stone by size in any system.

---

## 3. Production stages: CAD, wax or resin print, casting tree, filing, polishing, setting, plating, QC, hallmarking, tagging

### Takeaway
Stage-by-stage job cards or "production vouchers" (casting → filing → polishing → setting → plating → QC) are common in the jewelry-specific systems. Casting-tree grouping is offered by a few (the Jobin & Jismi NetSuite suite, FlowSense, Synergics, Raytecno in Spain). Hallmark and HUID integration (India) and RFID tagging are sold mainly by retail-facing vendors. Some MES vendors argue that ERPs track only order status and that bench-level weight capture needs a separate MES.

### Cited Findings
- **Casting trees:** JMS on NetSuite groups wax items into casting trees and defines gold requirement and recovery per tree [S]. — [Jobin & Jismi](https://www.jobinandjismi.com/industries/jewellery-manufacturing)
- FlowSense runs casting orders against a tree or flask plan and reconciles post-cast metal with the theoretical figure [S]. — [FlowSense](https://www.flowsense.solutions/jewellery-manufacturing-erp)
- Raytecno (Spain) describes manufacturing orders that generate tree documentation automatically (expected weight, number of pieces, alloy) and a pour record: temperature, time, operator, input metal batch, plaster batch, post-casting weight and real yield [S]. — [Raytecno casting blog](https://www.raytecno.es/en/blog/fundicion-microfusion-joyeria)
- SAP B1 does not natively manage casting-tree design or casting batches; casting batch tracking and alloy recipes need custom data structures (SDK add-ons) [S]. — [Gitnux](https://gitnux.org/best/jewellery-manufacturing-software/); [SAP B1 Wikipedia](https://en.wikipedia.org/wiki/SAP_Business_One)
- **ERP versus MES:** iFactory argues that standard jewelry ERP tracks order-level status, while an MES logs wax weight, tree configuration and gold loss per tree; it integrates with Tally, SAP, Oracle and custom ERPs over APIs. This is a vendor arguing for its own product [S]. — [iFactory](https://ifactoryapp.com/industries/diamond-and-jewellery/why-jewellery-erp-is-not-enough-without-manufacturing-execution-system)
- **Thailand:** Outsourcify built a custom ERP for Maneekan Siam (Bangkok), replacing Microsoft Access tools. It covers metal stock and production vouchers following batches through Casting, Setting, Polishing, Plating and QC, deployed on-premise in the factory [S]. — [Outsourcify case](https://outsourcify.net/portfolio/jewelry-manufacturing-erp/)
- **Italy:** Master Informatica's Oroplus! (Arezzo) tracks production progress by barcode and calculates costs automatically. Italcom's 1b Gold handles production phases, order traceability and material attribution. ePlay's eManager (Valenza) is an ERP + MES + CRM suite for gold manufacturers and brands [S]. — [Oroplus!](https://www.masterinformatica.net/i-nostri-software/oroplus/); [1b Gold](https://www.italcom.it/1b-gold-gestionale/); [ePlay](https://www.eplaylab.it/chi-siamo)
- **Valigara (US/Israel, eCommerce and PIM first)** added a Jobs and production module: made-to-order, custom orders, manufacturing and assembly tasks, BOM, materials and costing. A third-party review says it links checkpoints to work orders but that casting-tree automation is limited [S]. — [Valigara jobs](https://www.valigara.com/company-updates/valigara-adds-jewelry-jobs-production-management-software/); [Gitnux](https://gitnux.org/best/jewellery-manufacturing-software/)
- **Jewel360.ai** says it is a manufacturing platform for gold jewelry makers in the UAE: multi-stage tracking (filing, casting, polishing, setting, QC), workers assigned per stage, AI photo analysis that "detects metal type and estimates weight", and offline use with idempotent replay and dead-letter handling [S]. **Conflict:** jewel360.com is described elsewhere as a US cloud retail POS. These may be different companies sharing the name [E]. — [jewel360.ai](https://www.jewel360.ai/); [jewel360.com blog](https://jewel360.com/blog/jewelry-software)
- **Hallmarking (India):** Appit Software describes an ERP integration with the BIS hallmarking-centre (AHC) portal that submits pieces, polls assay status and retrieves HUIDs. This is a product description, not a customer result [S]. — [Appit HUID blog](https://www.appitsoftware.com/blog/bis-hallmarking-huid-compliance-jewellery-erp)
- The open-source Laravel ERP advertises item-level BIS HUID tracking [S]. — [GitHub jewellery-software](https://github.com/webotapp-academy/jewellery-software)
- **RFID:** Omunim (India) sells a higher ₹15,500 tier that includes RFID and barcode features [S]. — [SoftwareSuggest Omunim](https://www.softwaresuggest.com/omunim-jewellery). An RFID vendor reports Chow Tai Fook (a retailer, not a manufacturer) RFID-tagged over 2 million items, with daily audits under 30 minutes, integrated with its ERP [S]. — [DTB RFID](https://www.dtbrfid.com/comprehensive-rfid-management-solution-for-jewelry-stores/). ERPNext has no native RFID reading; consultants map RFID codes to serial numbers [S]. — [ClefinCode](https://clefincode.com/blog/global-digital-vibes/en/erpnext-customization-for-gold-trading-and-jewelry-business)
- Academic: an ISM-AHP modelling paper on RFID-enabled hallmark traceability, with a case on Tanishq (about 2023, pre-2024; a model, not an implementation report) [S]. — [ResearchGate](https://www.researchgate.net/publication/371698720_Modelling_of_RFID-enables_jewellery_hallmark_transparency_attributes_inter-relationship_and_ranking_performance_criterion_in_Supply_chain_Responsiveness_Using_ISM-AHP_approach)

### Inferences
- [E] The CAD and 3D-print stages (design approval, resin print, wax injection from rubber moulds) are usually outside the ERP. The work order often starts at "wax received" or "casting". No extract showed the ERP tracking CAD revisions or print-plate batches, apart from Valigara's file attachments and FlowSense's "from CAD" marketing.
- [E] Tagging at the end (barcode or RFID label with gross/net weight, stone details, HUID) is where manufacturing systems hand over to wholesale and retail. This is the step where weight data, often re-weighed, gets fixed into the item.

### Gaps
- No vendor documentation was readable to confirm how many stages are configurable, or whether stage routing differs by design.
- No figures on how many Indian manufacturers integrate with the BIS portal automatically versus uploading by hand.
- Plating (rhodium, gold) loss and cost tracking was not covered.

---

## 4. Bill of materials and costing: stones by count and weight per design, making charges, the day's metal rate, wastage %, made-to-order quotes

### Takeaway
The Indian-style pricing model is now built into vertical software: net weight × the day's rate per karat, plus wastage % (or "touch"), plus making charge (per gram, per piece, or %), plus stones at count × carat × rate, plus taxes. Western systems (PIRO, Valigara, NetSuite and BC add-ons) use a BOM plus labour costing with live metal feeds. No source showed a strong quoting tool for made-to-order work that reads the design itself.

### Cited Findings
- The open-source Laravel ERP lists "live metal rate calculation", "dynamic making charges & wastage billing" and old-gold exchange valuation as core features. This is typical of the Indian feature set [S]. — [GitHub jewellery-software](https://github.com/webotapp-academy/jewellery-software)
- Tally does not price an ornament from a live rate and weight; dedicated ERPs do [S]. — [Whirl Designs](https://whirldesigns.com/blog/jewellery-erp-for-small-jewellers)
- Valigara's Jobs module covers BOM, materials and costing, and BOM data drives the production cost. Its PIM has 13 built-in gemstone parameters, certificate handling, metal settings and a live gold feed [S]. — [Valigara jobs](https://www.valigara.com/company-updates/valigara-adds-jewelry-jobs-production-management-software/); [Valigara PIM guide](https://www.valigara.com/jewelry-ecommerce-articles/jewelry-pim-the-definitive-guide-to-product-information-management-for-jewelers/)
- PIRO's manufacturing module offers job tracking and labour costing [S]. — [PIRO Fusion on Capterra](https://www.capterra.com/p/236081/PIRO-Fusion/)
- NetSuite costing uses its native BOM engine fed by custom metal-price integrations [S]. — [Folio3](https://netsuite.folio3.com/blog/best-erp-for-jewellery-manufacturers/)
- WinGold Next is described as for large manufacturers, wholesalers and exporters, with job-order tracking and labour cost analysis [S]. — [SoftwareSuggest blog](https://www.softwaresuggest.com/blog/jewellery-manufacturing-software/)
- Diatech Make (a browser-based jewelry CAD) advertises "a stone list with cut, size, count and carats, and one-click pricing from your Studio price book". This is the closest thing found to a quote built from the CAD [S]. — [Diatech Make features](https://cad.diatech.ai/features)

### Inferences
- [E] For a made-to-order quote you need the design's metal volume (to get weight per alloy), its stone list (shape, size, count, quality, carats), labour rate cards and the day's metal price. Today these come from different places: CAD report → spreadsheet → ERP. A system that builds the quote straight from the CAD geometry with live prices would beat what any incumbent showed.
- [E] Indian "wastage %" is partly a pricing convention charged to the buyer, not physical loss. A system has to keep billed wastage and actual process loss apart.

### Gaps
- No vendor quoting screen (configurator for ring size, metal colour, centre-stone swap) could be checked.
- No standard for the pricing formula was found; GJEPC or BIS material was not found by these searches.

---

## 5. Links from CAD to ERP: does anything read 3DM, STL, Matrix, RhinoGold, JewelCAD or 3Design files to fill the item master, weights and stone lists? Is "the CAD is the item master" done anywhere?

### Takeaway
I found no evidence that any mainstream ERP (PIRO, Valigara, Ornate, SAP B1 or Business Central add-ons, the Indian vendors) imports a CAD file to fill the item master, weights or stone list. The CAD tools produce reports on their own side (MatrixGold's technical report with a gemstone table and metal weights in g or dwt, exported as PDF), and people copy the data across. "The CAD is the item master" appears only as marketing language and in new browser-CAD tools. It is a clear open gap.

### Cited Findings
- MatrixGold 4.0 (Gemvision/Stuller) technical report: render grids, a "sortable grouped gemstone report panel", "machinable metal weights in grams or DWT", and an "improved PDF export". No Excel, CSV or ERP export is mentioned [S]. — [MatrixGold 4.0 notes](https://en.design-engineering.net/matrixgold/matrixgold-4-0); [MatrixGold](https://gemvision.com/matrixgold)
- MatrixGold imports legacy Matrix and RhinoGold files; the plug-ins run inside Rhino [S]. — [Gemvision MatrixGold](https://gemvision.com/matrixgold)
- JewelCAD has tools to count and weigh stones, and exports STL and OBJ for manufacturing. No export format for reports is documented [S]. — [Tashvi comparison](https://tashvi.ai/blog/cad-software-comparison-rhinogold-matrixgold-jewelcad); [IndiaCADworks](https://www.indiacadworks.com/blog/cad-jewelry-design-software/)
- One vendor in the CAD/ERP landscape (eLUXE3D's integrated-workflow article) says its software "exports to Excel or JSON for ERP integration", with a complete report of gemstone specs, gem maps and a full material list. The field mapping is not described [S]. — [eLUXE3D](https://eluxe3d.com/integrated-digital-manufacturing-systems-for-jewelry-eluxe3d/)
- RhinoArtisan (RhinoGold's successor family) markets "manufacturing software for manufacturers" with production reports carrying stone and metal weight estimates [S]. — [RhinoArtisan manufacturers](https://www.rhinoartisan.com/manufacturers/)
- Valigara says a PIM should hold "every detail from the initial CAD design to the final hallmarked piece". This is general guidance; no CAD parser is described [S]. — [Valigara PIM guide](https://www.valigara.com/jewelry-ecommerce-articles/jewelry-pim-the-definitive-guide-to-product-information-management-for-jewelers/)
- A Business Central migration provider warns that generic export and import "creates duplicates, broken item cards, incorrect on-hand quantities" for jewelry product structures [S]. — [e-Jewelry migration](https://e-jewelry365.com/jewelry-erp-data-migration-services-for-business-central/)
- Diatech Make (browser CAD) exports STEP, STL and 3MF, and produces a stone list plus price-book pricing. The data stays in that CAD's own studio, not an ERP [S]. — [Diatech Make](https://cad.diatech.ai/)

### Inferences
- [E] STL and 3MF carry geometry only. From geometry you can get volume, and so metal weight per alloy density, but not the stone list unless stones are separate named bodies. 3DM (Rhino) files from MatrixGold and RhinoGold keep stones as objects with user data (shape, size), so a 3DM parser (for example rhino3dm, open source) could in principle extract them. JewelCAD (.JCD) and 3Design formats are proprietary. [E, not verified against vendor docs]
- [E] "The CAD is the item master" would mean: each design version is a CAD document whose computed metal volume, stone schedule and finding list become the BOM, and production orders refer to a specific design revision. No incumbent showed this. It is the most clearly differentiated position for a new system of record.

### Gaps
- PIRO's documentation was unreachable; no extract mentioned any CAD import in PIRO.
- No answer on whether 3Design (Vectorworks/Cadess) has any ERP connector.
- No customer evidence of a CAD-to-ERP link in production use.

---

## 6. Vendors and what large manufacturers use (India, US, Italy, Thailand, Hong Kong/China, UAE, UK)

### Takeaway
The market is fragmented and mostly vertical. In India many small Windows desktop products (Omunim, Joolet, Ornate, Logic ERP, Marg, WinGold, Tally plus add-ons) serve retail and small manufacturing; exporters and big manufacturers run SAP (B1 or S/4), NetSuite or Dynamics with vertical add-ons or custom builds. In the US the players are PIRO (manufacturing and wholesale, from $299/month), Valigara (eCommerce/PIM plus Jobs), WJewel and Luxare, while The Edge and Jewel360 are retail. Italy runs local "gestionali orafi" from Valenza and Arezzo. Global brands run tier-1 ERPs (Pandora: SAP S/4HANA Cloud with RISE).

### Cited Findings: India
- **Ornate (India):** popular with jewelry retail showrooms, wholesalers and manufacturers. One comparison rates its manufacturing support "Partial" and puts it at bespoke and luxury retail. A listing says it "does not provide API" [S]. — [SaaSworthy Ornate](https://www.saasworthy.com/product/ornate); [Synergics top 11](https://www.synergicssolutions.com/top-11-jewellery-erp-software-providers-a-deep-dive-into-2026s-leading-solutions)
- **Omunim / Online Munim (Pune):** base jewelry billing package ₹10,500 + 18% GST; a ₹15,500 tier with RFID and barcode. IndiaMART listings run from ₹8,500 (single user) through ₹16,800 and ₹54,800 ("all features") to ₹1,60,000/year (add-ons); some listings are over three years old (pre-2024) [S]. — [SoftwareSuggest Omunim](https://www.softwaresuggest.com/omunim-jewellery); [IndiaMART ₹54,800](https://www.indiamart.com/proddetail/omunim-jewellery-software-with-all-features-20455498791.html); [IndiaMART ₹1.6 lakh/yr](https://www.indiamart.com/proddetail/omunim-jewellery-software-with-add-on-features-20455508391.html)
- **Logic ERP:** production planning, raw material, inventory, job work, billing and dispatch. Reviews praise it as "cloud-based, all-in-one", while some report support delays and thin documentation [S]. — [SoftwareSuggest jewellery software](https://www.softwaresuggest.com/jewellery-software)
- **Marg ERP:** called cost-effective for small and medium exporters, with strong billing [S]. — [Digifysoft top 10](https://www.digifysoft.in/top-10-erp-for-jewellery-industry-in-2026)
- **SIONIQ ERP:** strong B2B sales and compliance modules [S]. — [Digifysoft](https://www.digifysoft.in/top-10-erp-for-jewellery-industry-in-2026)
- **Jewelsoft Plus:** listed by Retailware Softech Pvt Ltd on IndiaMART; no price found [S]. — [IndiaMART directory](https://dir.indiamart.com/impcat/jewellery-software.html)
- **Synergics (SEA ERP, cloud)** offers a conversational AI assistant called VISOR [S]. — [Synergics](https://www.synergicssolutions.com/)
- **SAP B1 partners in India** with jewelry add-ons: Zyple (GST-compliant jewelry add-ons), Clockwork (scale and sensor integration), Elevratech, Uneecops [S]. — [Zyple](https://www.zyplesoft.com/jewellery-manufacturing-erp/); [Clockwork case](https://clockwork.in/sap-b1-case-studies/sap-business-one-for-jewelry-manufacturing-business/); [Uneecops](https://www.uneecops.com/blog/how-sap-business-one-transforms-jewelry-industry/)
- **ERPNext:** Quantbit sells ERPNext for gems and jewellery; JewelimaERP is an open-source v16 app [S]. — [Quantbit](http://quantbit.io/services/erpnext-for-gems-jewellery); [JewelimaERP](https://github.com/JoE7289ee/JewelimaERP)
- **Not found:** GOLDSOFT and Emerald (no extracts returned for either); no SEEPZ exporter case study.

### Cited Findings: US and global
- **PIRO Fusion (US):** Starter $299/month, Pro $599/month, Enterprise $999/month. Starter includes 2 admin users; extra limited users $70/month; billed monthly, no contract; all core modules in every plan. QuickBooks integration. A 14-day trial per Crozdesk; no free version per Software Advice. An older DiscoverCloud listing shows $285/month for 3 users or $9,995 lifetime for 3 users (likely dated) [S]. — [PIRO pricing](https://www.gopiro.com/pricing) (fetch blocked); [Capterra](https://www.capterra.com/p/236081/PIRO-Fusion/); [Crozdesk](https://crozdesk.com/software/piro-fusion); [DiscoverCloud](https://www.discovercloud.com/products/piro)
- **Valigara:** "all-in-one PIM, ERP, and multi-channel command center", Jobs and production added; listed on G2 [S]. — [Valigara](https://www.valigara.com/landing-page1/); [G2](https://www.g2.com/products/valigara-online-jewelry-manager/reviews)
- **Luxare (US):** "cloud-native software purpose-built for jewelry manufacturers and wholesalers since 1995", with AI-driven production forecasting [S]. — [Luxare](https://www.luxare.com/jewelry-manufacturing-software)
- **The Edge (US, retail):** Windows software on store PCs with a server; cloud version in beta; $3,000–5,000 hardware plus $4,600–5,700 software for a single store; retail focus [S]. — [WJewel comparison](https://www.wjewel.com/jewelry-pos-comparison.php)
- **e-Jewelry (Dynamics 365 Business Central extension):** manufacturing, repairs, job management, metal management [S]. — [e-Jewelry](https://e-jewelry365.com/)
- **Jobin & Jismi JMS (NetSuite)**: see sections 1 and 3 [S]. — [Jobin & Jismi](https://www.jobinandjismi.com/industries/jewellery-manufacturing)
- **Other US and western names in results:** JewelerEase Factory Manager, Jewelsteps, JewelryAdmin ("the most advanced jewelry manufacturing ERP"), Jewelia.io (cloud POS, memo, AI) [S]. — [JewelerEase](https://jewelerease.com/factory-manager/); [Jewelsteps](https://jewelsteps.com/jewelry-manufacturing-erp/); [JewelryAdmin](https://www.jewelry-admin.com/); [Jewelia](https://jewelia.io/)
- **Pandora (Denmark, makes all lines in Thailand, Vietnam factory opening):** moving to SAP S/4HANA Cloud via RISE with SAP, started 2023 in B2B and the European DC; the Thailand DC went live with SAP plus a new TMS. AppsRunTheWorld records a 2019 Dynamics 365 Retail POS rollout (pre-2024, conflicts with the SAP story) and a 2025-02-04 evaluation of SAP Digital Manufacturing for MES (evaluation, not confirmed) [S]. — [TechTarget](https://www.techtarget.com/searchsap/feature/Pandora-embarks-on-SAP-S-4HANA-Cloud-digital-transformation); [Retail Tech Innovation Hub, 2025-07](https://retailtechinnovationhub.com/home/2025/7/1/denmark-headquartered-jewellery-brand-pandora-taps-sap-technology-as-part-of-digital-transformation-journey); [AppsRunTheWorld](https://www.appsruntheworld.com/customers-database/customers/view/pandora-jewelry-llc-united-states)
- **Corundum (Poland)** and **Spark (jewelry, Poland)** run SAP Business One via All for One [S]. — [All for One, Corundum](https://www.all-for-one.pl/en/case-studies/corundum-sap-in-jewelry-manufacturing/); [All for One, Spark](https://www.all-for-one.pl/en/news/sap-business-one-supports-the-production-of-spark-jewelry/)

### Cited Findings: Italy, Thailand, UAE, Hong Kong
- **Italy (Valenza and Arezzo gestionali orafi):** ePlay eManager (ERP/MES/CRM; also resold by Omnia, Valenza, with a B2B/B2C catalogue); Valenza Ufficio Visual Cedsoft (technical sheets, orders, internal and external production, warehouse); Tetrasoft (Arezzo, Zucchetti dealer, Mago4 with MES and a gold-sector module); Master Informatica Oroplus! (Arezzo); Flex Line Alo' (site looks dated); Italcom 1b Gold [S]. — [ePlay](https://www.eplaylab.it/chi-siamo); [Omnia eManager](https://www.omniavalenza.com/software-emanager/); [Valenza Ufficio](https://valenzaufficio.it/settore-orafo/); [Tetrasoft](https://www.tetrasoft.it/); [Oroplus!](https://www.masterinformatica.net/i-nostri-software/oroplus/); [Flex Line](http://win.flexline.it/Default.aspx?lang=IT); [1b Gold](https://www.italcom.it/1b-gold-gestionale/)
- **Thailand:** a custom on-premise ERP at Maneekan Siam (Outsourcify); Jewels Core markets jewelry software in Thailand [S]. — [Outsourcify](https://outsourcify.net/portfolio/jewelry-manufacturing-erp/); [Jewelscore Thailand](https://www.jewelscore.com/blog/jewellery-software-in-thailand)
- **UAE:** Suntech/SunFacet (Dubai), Jewel360.ai (UAE gold manufacturing), Daysum (GCC) [S]. — [Suntech](https://www.suntech-global.com/jewellery-manufacturing-software/); [jewel360.ai](https://www.jewel360.ai/); [Daysum](https://daysum.net/en/jewelry-consignment-software-erp/)
- **Hong Kong/China and UK:** no relevant result was returned.

### Inferences
- [E] Customer counts were not found for any vendor. The Indian vendors' marketing claims (often "10,000+ jewellers") were not seen in these extracts, so none are reported.
- [E] Technology split: India's small vendors are mostly Windows desktop with local SQL Server or MySQL (Joolet confirmed Windows desktop) [S for Joolet]; the open-source projects use Laravel/MySQL, Next.js/Postgres and Frappe/MariaDB; the US vendors are cloud SaaS (PIRO, Valigara, Jewel360.com), with The Edge still on-premise Windows.
- [E] Large Indian exporters (SEEPZ, Surat SEZ) most likely run SAP (B1 or S/4) or long-built in-house systems with a vertical layer. No source confirmed a named exporter's stack.

### Gaps
- Systems at named Indian exporters (for example Tanishq/Titan manufacturing, Kalyan, Malabar), Italian factories (Vicenza) and Hong Kong/Shenzhen factories: not found.
- Customer counts and ARR for PIRO, Valigara, Ornate and Logic: not found.
- GJEPC material on ERP adoption: not found.

---

## 7. Practitioner complaints, what is missing, and AI- or cloud-native newcomers since 2023

### Takeaway
The complaints are about implementation, not features: unfinished scopes, project-manager turnover, extra fees for "custom" work (PIRO), forced re-contracting (Ornate on GST), and ledger reconciliation that falls short. Newcomers present themselves as "AI-native" or cloud-native (Bonx, Jewel360.ai, Synergics VISOR, Luxare forecasting, browser CADs), but I found no funded, verifiably adopted AI-native jewelry manufacturing ERP.

### Cited Findings
- **PIRO Fusion, negative:** a 2024 Capterra review rates it 1/10: once paid, "it is 'not their problem' even if you have never been able to use it". A Software Advice reviewer says the team "failed to fulfil any of the basic promises or requirements in their original scope" after years, with two project managers who disappeared. Functions that should be standard are "considered custom developments and cost extra" [S]. — [Capterra PIRO](https://www.capterra.com/p/236081/PIRO-Fusion/); [Software Advice PIRO](https://www.softwareadvice.com/retail/piro-fusion-profile/)
- **PIRO Fusion, positive:** "incredibly quick response time from their support team", "outstanding" support, a "solution-oriented" team with workarounds [S]. — [Software Advice PIRO](https://www.softwareadvice.com/retail/piro-fusion-profile/); [SoftwareSuggest PIRO](https://www.softwaresuggest.com/piro-fusion)
- **Ornate:** only 2 Capterra UK reviews, one complaining the vendor forced new terms "for GST Version"; on SoftwareSuggest the "ledger tallying process is not up to the mark", while others praise support and value [S]. — [Capterra UK Ornate](https://www.capterra.co.uk/software/87168/ornate-software); [SoftwareSuggest Ornate reviews](https://www.softwaresuggest.com/ornate/reviews)
- **Logic ERP:** support delays and limited documentation during implementation [S]. — [SoftwareSuggest](https://www.softwaresuggest.com/jewellery-software)
- **Structural gaps the market names:** SAP B1's jewelry add-on ecosystem is fragmented, and it is weak on metal cost integration and lot traceability [S] — [Gitnux](https://gitnux.org/best/jewellery-manufacturing-software/). ERPs track order status, not bench-level weights [S] — [iFactory](https://ifactoryapp.com/industries/diamond-and-jewellery/why-jewellery-erp-is-not-enough-without-manufacturing-execution-system). Ornate has no API [S] — [SaaSworthy](https://www.saasworthy.com/product/ornate). Generic migrations break item cards [S] — [e-Jewelry migration](https://e-jewelry365.com/jewelry-erp-data-migration-services-for-business-central/)
- **Newcomers:**
  - **Bonx** calls itself "the AI-native manufacturing ERP for jewelry manufacturers" (orders, inventory, purchasing, planning, production, quality, traceability, logistics), deployed in under three months; no funding found [S]. — [Bonx blog](https://www.bonx.com/blog/how-to-choose-between-generic-erp-and-jewelry-specific-software)
  - **Jewel360.ai**: AI photo analysis to estimate metal type and weight; offline-first sync [S]. — [jewel360.ai](https://www.jewel360.ai/)
  - **Cratorlabs.ai**: a jewellery ERP for India [S]. — [Cratorlabs](https://www.cratorlabs.ai/industries/jewellery-erp-software-india)
  - **JewelCore ERP** (open source): Next.js 15, Express 5, Neon Postgres 17, IoT RFID, dual-custody vaults, analytical QC [S]. — [GitHub JewelCore](https://github.com/prasant-0n/JewelCore-ERP)
  - **Browser CAD with pricing:** Diatech Make; Tashvi.ai (CAD content) [S]. — [Diatech Make](https://cad.diatech.ai/); [Tashvi](https://tashvi.ai/blog/cad-software-comparison-rhinogold-matrixgold-jewelcad)
- The funded AI-native ERPs (Rillet $70M Series B, Aug 2025; Doss $55M Series B, Mar 2026) are financials- or operations-first, and "none offers manufacturing depth comparable to the established suites" [S]. — [ERP Research AI-native](https://www.erpresearch.com/en-us/ai-native-erp)

### Inferences
- [E] **What a new system of record would have to match:**
  1. Fine-weight ledgers per party and per metal, in grams and currency.
  2. Karigar and contractor issue and receipt with tolerance per process.
  3. Stage job cards and casting trees.
  4. Live metal-rate pricing with making charge and wastage.
  5. Memo and consignment.
  6. GST ITC-04 and BIS HUID in India.
  7. Barcode and RFID tagging.
  8. Hand-off to Tally or QuickBooks.
- [E] **Where it could beat them:**
  1. CAD-derived BOM (metal volume → weight per alloy, stone schedule) as the item master, tied to design revisions.
  2. Bench scales feeding weights directly, so nothing is retyped.
  3. Refining and assay settlement, and metal-lease accounting.
  4. Open APIs (Ornate has none).
  5. Fixed-scope, quick onboarding and migration (the main complaint against PIRO).
  6. Multi-entity, export-ready cloud for exporters who now pick between SMB desktop tools and heavy SAP or NetSuite projects.

### Gaps
- Forums (Ganoksin, Reddit r/jewelers, Indian WhatsApp/Facebook trade groups) and trade press (JCK, National Jeweler, Solitaire International, Retail Jeweller India) returned nothing in these searches.
- No funding or customer data for Bonx, Jewel360.ai or Cratorlabs.
- With fetches blocked, none of the newcomers' feature claims could be checked against their product pages.
