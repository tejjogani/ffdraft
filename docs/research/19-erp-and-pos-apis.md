# 19 — ERP, point-of-sale and accounting connectivity, system by system

Research date: 2026-11-25. Scope: for every system a jeweler is likely to run (jewelry retail POS, jewelry manufacturing ERPs, Indian jewellery packages, Tally, Shopify, the accounting clouds and the general ERPs), whether there is an API or only file import and export, how it authenticates, what it exposes, its limits, developer access and cost, import templates, partner requirements and restrictive terms; then which connectors Pavé should build, in which order. Builds on: [`reports/Jewelry and diamond ERP vertical.md`](./reports/Jewelry%20and%20diamond%20ERP%20vertical.md) and its notes, [`../strategy/catalog-import-and-store.md`](../strategy/catalog-import-and-store.md), [`08-channels.md`](./08-channels.md), [`10-market.md`](./10-market.md), [`../plans/publishing.md`](../plans/publishing.md). Pavé's side of the hand-off is fixed: item master data, a bill of materials with metal weights and stones, a job package and images go out; stock and orders may be read back later; Pavé never keeps books.

**How to read the evidence.** `[V]` = I opened the linked page this session and the claim is on it. `[V2]` = opened this session, but the page is a secondary source (an integrator's guide or a directory), not the vendor's own documentation. `[S]` = seen only in a search result or in earlier repo research; not opened. `[E]` = my working knowledge or estimate. Several official documentation sites render only in a browser and returned empty pages here (Intuit's developer portal, most of Xero's API reference, Xero Central, parts of Zoho help, SAP Help PDFs, Lightspeed R-Series docs); facts about those are marked `[E]` or `[V2]`, never `[V]`. Prices and limits were read on 25 November 2026. Nothing here is legal advice.

Effort sizes follow the repo's scale: **S** about a week, **M** two to four weeks, **L** one to three months, for one builder, before review.

## 1. The short answer

- **Files first is confirmed, but the first two targets change.** The ERP report named The Edge's item import as "a ready target". It is not: that wizard only updates items that already exist [V]. The Edge's real creation path is the **Receive Invoice import** (CSV or Excel with a header row, a column-mapping screen, and a photo folder matched by vendor style number) [V]. Tally is the stronger first target: one small XML or JSON file creates units, stock groups and stock items, the format is documented, and a locally running Pavé can post it straight to Tally on the same PC [V].
- **Tally is a desktop program with an unauthenticated HTTP port.** It listens on port 9000 by default, takes XML (and native JSON from release 7.0), and its own guidance for remote access is a tunnel or an outbound WebSocket connector with your own gateway in front [V]. Pavé running locally is an advantage here: no tunnel is needed. A hosted Pavé needs a small connector on the jeweler's PC, or a downloaded file.
- **Shopify is not a back door into The Edge or Jewel360.** Both push their own items *to* Shopify; neither takes new stock items *from* it (The Edge downloads web titles, tags and web sales only; Jewel360 imports Shopify products once, at first sync) [V]. `08-channels.md` implied the opposite.
- **Three jewelry-specific vendors have something a third party can use today:** The Edge's EDT (JSON files of customers, inventory and transactions to a folder or FTP site; the jeweler pays an activation fee of $1,000 to $2,500) [V]; Valigara's documented API (bearer key; product and gemstone import, orders) [V]; PIRO, which lists REST and XML/CSV as integration methods but only through a custom-integration request [V]. Jewel360, BusinessMind, Jewelry Shopkeeper, Ornate, Omunim, Jwelly and Gehna ERP publish no API [V for each "not mentioned"; one directory says outright that Gehna has none].
- **The accounting clouds are cheap to write to and add little.** QuickBooks Online, Xero and Zoho Books hold an item as name, SKU, price, cost and accounts: no bill of materials, no stones, no metal weight. QuickBooks does not meter create and update calls (only reads) [V2]; Xero is free for 5 connections and then AUD 35 a month for up to 50 [V]; Zoho needs data-centre-aware OAuth [V]. Zoho Inventory is the one with composite items (a bill of materials) and Indian GST fields [V for the module list].
- **No general system models jewelry.** Memo, repairs, metal accounts, karigar issue and receipt, making and wastage, HUID: only the jewelry packages have them, and almost none of those packages has an API. A connector can carry these facts only as custom fields, metafields, batch or lot attributes, or user-defined fields (section 4).
- **Two terms matter for an AI-native product.** Shopify and Xero both forbid using data obtained through their APIs to train or improve AI models [V]. Reading stock and orders back from those APIs must be kept out of anything that learns. Counsel should read those clauses before Pavé reads back any data (section 6).
- **Recommended order** (section 7): (1) one neutral piece export (CSV, XLSX, JSON) with a column dictionary; (2) Tally masters file, then direct local push; (3) Shopify, as already planned in `08-channels.md`; (4) The Edge Receive Invoice file plus photo folder, once a real Edge user has given us the in-app blank template; (5) Zoho Inventory, then QuickBooks, then Xero item push; (6) Valigara; then on demand: PIRO, Business Central, Odoo, NetSuite, SAP Business One, Lightspeed. Reading a desktop ERP's database directly is rejected.

## 2. Comparison tables

Columns are the same in every table. "Obj." = the objects a third party can reach. "—" means the vendor publishes nothing on the point. Evidence: **High** = vendor documentation opened; **Med** = vendor marketing page or a secondary source opened; **Low** = search results or working knowledge only.

### 2.1 Commerce and accounting clouds

| System | API type | Auth | Obj. | Webhooks | Rate limits | Sandbox / dev access, cost | File import / export | Partner / store requirements | Restrictive terms | Evid. |
|---|---|---|---|---|---|---|---|---|---|---|
| **Shopify** (and POS) | Admin GraphQL; REST is legacy | OAuth; token in `X-Shopify-Access-Token`; scopes | Products, variants, metafields, metaobjects, inventory by location, orders, draft orders, customers | Yes, HMAC-signed | 100 / 200 / 1,000 / 2,000 points per second by plan; 1,000 per query; bulk operations exempt | Dev stores (cap 250 per organisation); $19 once to list on the App Store | Product CSV (section 5) | Public app: review. Custom distribution: one store or one Plus organisation, no review | No AI training on API data; delete data within 30 days of uninstall; no app whose main purpose is moving merchants off | High |
| **QuickBooks Online** | REST (JSON) | OAuth 2.0 [E] | Item (inventory, non-inventory, service), Customer, Invoice, Estimate, PurchaseOrder, Bill [E] | Yes, plus change-data-capture [E] | 500 requests a minute per company, 10 concurrent [V2] | Sandbox companies free [E]; Builder tier free | CSV / Excel / Google Sheets, 1,000 rows | App Partner Program: Builder $0, Silver $300, Gold $1,700, Platinum $4,500 a month; reads metered | Terms page did not render; not read | Med |
| **Xero** | REST (JSON) | OAuth 2.0, PKCE for native apps [E] | Items, Contacts, Invoices, PurchaseOrders, Quotes [E] | Contacts, invoices, credit notes, subscriptions [V2] | 5 concurrent, 60 a minute, 5,000 a day per organisation, 10,000 a minute per app | Starter free: 5 connections, 1,000 calls a day; Core AUD 35 | CSV item import [E] | Certification from Plus (AUD 245); security assessment from Advanced | No AI training; no helping customers leave Xero; no scraping | High |
| **Zoho Books / Inventory** | REST (JSON) | OAuth 2.0 per data centre | Items, item groups, composite items, serial numbers, batches, sales and purchase orders, invoices, contacts, delivery challans | Not in the API sidebar | 100 a minute per organisation; 1,000 to 10,000 a day by plan; 5 or 10 concurrent | Free plan gives 1,000 calls a day | CSV, TSV, XLS; 1 MB | Zoho Marketplace optional [E] | API terms page did not open | High |
| **Lightspeed Retail X-Series** | JSON over HTTP, dated versions | OAuth 2.0 code grant; personal tokens on Plus plan | Products, inventory, sales, customers, price books, consignments (stock transfers) | 7 event types, HMAC-signed | 300 × registers + 50 per 5 minutes | Developer registration; unapproved apps limited to 30 stores | — (not verified) | Approval for public apps | — | High |
| **Lightspeed Retail R-Series** | REST [E] | OAuth 2.0 [E] | Item, matrix, serialized, work orders, sales [E] | — | Leaky bucket: 90, draining 1 a second [V2] | — | — | — | — | Low |

Sources for this table are in the per-system notes (section 3).

### 2.2 General ERPs

| System | API type | Auth | Obj. | Webhooks | Rate limits | Sandbox / dev access, cost | File import / export | Partner / store requirements | Restrictive terms | Evid. |
|---|---|---|---|---|---|---|---|---|---|---|
| **Tally Prime** | XML over HTTP; native JSON from 7.0; ODBC (read); TDL inside | **None** on the port; desktop, behind the firewall | All masters (stock items, groups, units, godowns, ledgers) and vouchers | None; TDL can call out | None published; single desktop process | A Silver licence: ₹22,500 once or ₹750 a month | XML, JSON, Excel with mapping templates | None to call the port; TDL add-ons need TallyPrime Developer | Not found | High |
| **SAP Business One** | Service Layer (OData v3 and v4); DI API (.NET); B1if | Session login (`B1SESSION` cookie); OAuth 2.0 from 10.0 FP 2305 [V2] | Items, business partners, orders, bills of materials, production orders, user-defined fields [V2, E] | None in Service Layer [E] | Customer's own server | Through an SAP partner [E] | Data Transfer Workbench, Excel [E] | Partner channel; indirect-access licensing [E] | Not read | Med |
| **Dynamics 365 Business Central** | REST API v2.0 (OData v4); custom API pages in AL | Microsoft Entra ID OAuth 2.0 [E] | items, itemVariants, customers, vendors, salesOrders, salesInvoices, purchaseInvoices, pictures, dimensions | Subscriptions, 3-day expiry | 6,000 requests per 5 minutes per user; 5 concurrent | Sandbox environments [E] | Configuration packages (Excel, .rapidstart) | AppSource only if you ship an AL extension: registered affix and ID range, signed app | Microsoft APIs Terms of Use (not read) | High |
| **NetSuite** | SuiteTalk REST (records, SuiteQL) and SOAP; RESTlets | Token-based auth and OAuth 2.0 [E] | Any generally available record, custom records and fields | None native [E] | Concurrency: 5 / 15 / 20 by tier, +10 per SuiteCloud Plus licence | Developer and partner accounts: base 5 | CSV import assistant [E] | SuiteCloud Developer Network for partners [E] | Not read | Med |
| **Odoo** | JSON-2 API (new in 19.0); XML-RPC and JSON-RPC being removed | API key as bearer token | Any model the user can access, including products, bills of materials, stock | None native; automations can call out [E] | Not published | Own instance | CSV, XLSX with External ID | API needs the Custom plan | — | High |

### 2.3 Jewelry retail systems (US and UK)

| System | API type | Auth | Obj. | Webhooks | Rate limits | Sandbox / dev access, cost | File import / export | Partner / store requirements | Restrictive terms | Evid. |
|---|---|---|---|---|---|---|---|---|---|---|
| **The Edge** (Abbott Jewelry Systems) | No API. EDT app writes JSON files to a folder or FTP | Licence feature, enabled by Edge | Out: customers, inventory, transactions, images. In: customers (other Edge pages add wish lists and sales) | None | Scheduled task | "EDT test environment" for developers; activation $1,000 to $2,500; $300 a year unless via a partner | Receive Invoice import (CSV, Excel); Item Data Import (update only); vendor catalog files | Punchmark is the only EDT partner | Not found | High |
| **Jewel360** | None published | — | — | — | — | — | "Spreadsheet creation and updates" exist; format not published | Named integrations only (QuickBooks, Clientbook, Stuller, Shopify) | — | Med |
| **BusinessMind** | None published | — | — | — | — | — | — | "Solutions+" for special integrations | — | Med |
| **Jewelry Shopkeeper** (Compulink) | None published; desktop | — | — | — | — | Trial download | Exports daily sales and payables to QuickBooks | — | — | Med |
| **wJewel**, **JewelMate**, **Adaptive / Diaspark** | Listed under an "API" filter by one directory | — | — | — | — | — | wJewel accepts CSV, Excel, FoxPro, SQL backups on migration [S] | — | — | Low |
| **Bransom** (UK) | — | — | — | — | — | — | — | Site now redirects to Clarity & Success (SelectLine Group) | — | Med |
| **Pursuit** (UK) | — | — | — | — | — | — | — | Vendor site showed a default WordPress page | — | Low |

### 2.4 Jewelry manufacturing, wholesale and catalogue systems

| System | API type | Auth | Obj. | Webhooks | Rate limits | Sandbox / dev access, cost | File import / export | Partner / store requirements | Restrictive terms | Evid. |
|---|---|---|---|---|---|---|---|---|---|---|
| **PIRO** | "REST API" and "XML / CSV" named as methods; no public reference | — | Via PIRO's own connectors: Shopify (two-way), QuickBooks Online, Xero, RapNet, GIA, Etsy, EDI | — | — | By custom-integration request | XML / CSV batch imports for catalogues | Custom integration, scoped by PIRO | — | Med |
| **Valigara** | HTTP API with `action` parameter, JSON out | Bearer key from My Account | Products (import, update, search, sold, export, listings), gemstones, orders, batches | None documented | Leaky bucket on some actions, no numbers | Test credentials on request | Excel, CSV, XML feeds, Google Drive, Airtable, FTP | — | — | High |
| **GemLightbox hub** | Integration built into The Edge | Hub admin account | Images and AI descriptions matched on item number = SKU | — | — | Free with a GemLightbox account | — | — | — | High |
| RapNet / IDEX feeds | Context only: stone listing feeds, not item masters [S] | | | | | | | | | Low |

### 2.5 Indian jewellery packages

| System | API type | Auth | Obj. | Webhooks | Rate limits | Sandbox / dev access, cost | File import / export | Partner / store requirements | Restrictive terms | Evid. |
|---|---|---|---|---|---|---|---|---|---|---|
| **Ornate** (DSoft Infotech) | None published | — | — | — | — | — | "Integration with accounting software", unnamed | — | — | Low |
| **Acme Infinity** | "Advanced API integrations", no detail | — | — | — | — | Demo on request | Exports vouchers as XML for Tally | — | — | Med |
| **Synergics** | None published; lists Tally, QuickBooks, Salesforce, Qlik, EDI integrations | — | — | — | — | — | CSV and EDI order imports; Google Sheets entry | — | — | Med |
| **Online Munim (Omunim)** | None published; cloud | — | — | — | — | Free demo; ₹8,500 in page metadata | — | Own e-commerce portal | — | Med |
| **Jwelly** | None published | — | — | — | — | — | — | — | — | Med |
| **Gehna ERP** | A directory states it has no API | — | — | — | — | — | — | — | — | Med |
| Marg ERP jewellery, Logic ERP, RetailGraph / SwilERP, Jilaba | Not verified | | | | | | | | | Low |

**Reading the tables together.** Every system with a usable public API is a general one. Every jewelry-specific one is file-in, file-out or closed, with Valigara the exception and The Edge's EDT a paid, file-based half-exception. This is the same picture the ERP report drew from search extracts; it now rests on opened pages for the systems in bold.

## 3. Per-system notes

### 3.1 Tally Prime

**What it is.** A Windows desktop program holding the books of most Indian jewelers; the usual split is a jewelry package for operations and Tally for accounts [S, ERP report]. A third party reaches it in four ways [V] ([integration overview](https://help.tallysolutions.com/integrate-with-tallyprime/), [methods](https://help.tallysolutions.com/integration-methods-and-technologies/)):

1. **XML over HTTP.** Turn on the HTTP server (F1 Help → Settings → Advanced Configuration, or Exchange → Data Synchronization: "TallyPrime act as" Server or Both, and a port). The default port is 9000, so the endpoint is `http://<pc>:9000`. Requests are HTTP POST with an XML body; a company must be loaded [V] ([XML integration](https://help.tallysolutions.com/xml-integration/), [prerequisites](https://help.tallysolutions.com/pre-requisites-for-integrations/)).
2. **Native JSON, from TallyPrime 7.0.** Same port. The request type moves into HTTP headers (`content-type: application/json`, `version: 1`, `tallyrequest: Import` or `Export`, `type: Data | Collection | Object | Function`, `id`), and the body carries `static_variables`, `tallymessage` and so on. Tally recommends the "JSONEx" format for new work. Imports of masters use id `All Masters`; vouchers use `Vouchers`. `svCurrentCompany` should always be sent, or data may land in whichever company is active [V] ([JSON integration](https://help.tallysolutions.com/tally-prime-integration-using-json-1/)). The help site carried a TallyPrime 7.2 banner on 25 November 2026 [V].
3. **ODBC.** Tally acts as an ODBC server; each collection is a table and each method a column; a collection is exposed with `Is ODBCTable: Yes`. The documented SQL is `SELECT` with `WHERE`, `ORDER BY` and `TOP`. Treat it as read-only [V] ([ODBC](https://help.tallysolutions.com/odbc-integrations/)).
4. **Files.** The user imports an XML, JSON or Excel file from the Import menu (Alt+O). Excel import uses saved mapping templates (column to field), sample workbooks, and a choice of stopping at, recording or ignoring exceptions [V] ([importing data](https://help.tallysolutions.com/getting-started-with-importing-data-into-tallyprime/), [samples](https://help.tallysolutions.com/tally-prime/import-data/download-sample-excel-files-with-data-for-import)).

**The envelope.** A master import, written from Tally's inventory-masters reference [V] ([inventory masters](https://help.tallysolutions.com/?p=149538)):

```xml
<ENVELOPE>
  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST><TYPE>Data</TYPE><ID>All Masters</ID></HEADER>
  <BODY><IMPORTDATA>
    <REQUESTDESC><REPORTNAME>All Masters</REPORTNAME></REQUESTDESC>
    <REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
      <UNIT Action="Create"><NAME>gm</NAME><ISSIMPLEUNIT>Yes</ISSIMPLEUNIT><DECIMALPLACES>3</DECIMALPLACES></UNIT>
      <STOCKGROUP Action="Create"><NAME>Rings 18K</NAME></STOCKGROUP>
      <STOCKITEM Action="Create"><NAME>R-1042-18Y-7</NAME><PARENT>Rings 18K</PARENT><BASEUNITS>gm</BASEUNITS></STOCKITEM>
    </TALLYMESSAGE></REQUESTDATA>
  </IMPORTDATA></BODY>
</ENVELOPE>
```

Optional stock-item tags in the same reference: `OPENINGBALANCE`, `OPENINGRATE`, `OPENINGVALUE`, `GODOWN`, `BATCHNAME`, `STANDARDCOSTLIST.LIST`, `STANDARDPRICELIST.LIST`, `MAILINGNAME.LIST` (part numbers). The response counts `CREATED`, `ALTERED`, `DELETED`, `COMBINED`, `IGNORED`, `ERRORS`, `CANCELLED` and returns `LASTVCHID` [V]. For any tag the reference does not show (GST and HSN details, for example), Tally's own advice is to create a sample master by hand and export it as XML to see the shape [V]. A unit cannot be changed on an item once it has been used [V]. Tally also publishes an "API Explorer" tool and sample payload files [V link on the overview page; payloads not opened].

**What Pavé would send.** Masters only: units (gm, ct, pcs), stock groups, one stock item per variant, the bill of materials, standard cost. Tally's Excel import has samples for "stock items with BoM details" (component item, quantity, godown, type, rate) and price lists [V]. Never vouchers: a voucher is a books entry, and Tally will overwrite an existing voucher when an imported one has the same GUID if the import is configured that way, and always when importing into a different company [V]. That is the pitfall the ERP report mentioned; it is now confirmed, and it is a reason to stay out of vouchers altogether.

**Security and reach.** None of the Tally pages opened mentions any authentication on the port [V, by absence]. Tally's tunnel guide says a gateway must enforce authentication in front of TallyPrime, that the last hop to Tally is plain HTTP, and that the company name in a request is not proof of access; it uses the third-party tool zrok as its worked example [V] ([tunnel guide](https://help.tallysolutions.com/building-tunnel-based-connectivity-for-tallyprime-integrations/)). A second pattern has a small connector on the Tally PC open an outbound secure WebSocket to the vendor's server; Tally calls this an illustration, not infrastructure it provides, and warns that a dropped connection does not tell you whether a write happened [V] ([WebSocket pattern](https://help.tallysolutions.com/secure-websocket-integration-with-tallyprime/)).

**Licensing and partners.** Silver (one user) is ₹22,500 once and Gold (a local network) ₹67,500, plus GST; rental is ₹750 or ₹2,250 a month; yearly Tally Software Services renewal is ₹4,500 or ₹13,500 [V, page dated 13 July 2026] ([cost guide](https://tallysolutions.com/business-guides/tallyprime-total-cost-of-ownership-india/)). No fee or registration for calling the port was found [E from absence]. TDL extensions are written in TallyPrime Developer, which also bundles a "Tally Connector" for XML integration; its price is not on the page [V] ([Tally Developer](https://tallysolutions.com/id/tally-developer-9)). I could not find a published integration-partner programme with terms or fees; Tally sells and customises through local partners [S]. Most jewelers' Tally is customised by such a partner, so stock-item fields differ from shop to shop [E].

### 3.2 The Edge (Abbott Jewelry Systems)

**No API was found.** The knowledge base describes three file paths and one export application.

- **Item Data Import wizard** (Inventory → Utilities → Item Data Import). Updates existing items from a delimited file whose headers must equal Edge field names; rows are matched by `itKey` (the Edge item number) or by `itVendorID` plus `itVendStyleCode`. The tip sheet says: "It cannot be used to add new items." Other workstations must be closed and a backup is offered [V] ([file format](https://edgeuser.com/Knowledge/Knowledge-Base/inventory-item-data-importexport-item-data-import-item-data-import-file-format), [TIP-2023-200](https://devuser.edgeuser.com/Portals/0/docs/TIP-2023-200_ItemDataImportWizard.pdf)). Columns are in section 5.
- **Receive Invoice import** (Inventory → Items → Add → Rcv Invoice → Import Invoice). This is how new stock gets in from a file. CSV or Excel with headers in row one; the user maps Edge fields to columns; an optional photo folder attaches images by file name (Image 1 to 5) or by vendor style number; options include parsing details out of the description and fulfilling open purchase orders; nothing is saved until the user reviews the lines and clicks Save. A "Download Blank xlsx" button inside the program gives a template that maps automatically. The page shows the field list only as a screenshot, so the column names are not public text [V] ([Receive Invoice import](https://edgeuser.com/Knowledge/Knowledge-Base/inventory-receive-invoice-recv-invoice-importing-data)).
- **Vendor catalog files** (Inventory → Vendor → Load Catalog). Downloaded from the Edge user site after login. They hold vendor-style data for quick entry and do not create stock items. No format is published and no route for a third party to produce one is described [V] ([vendor catalogs](https://edgeuser.com/Knowledge/Knowledge-Base/inventory-vendors-importing-vendor-catalog-files)).
- **Edge Data Transfer (EDT).** A separate application that exports customers, inventory, transactions and images as JSON files to a local folder or an FTP site on a schedule (first run everything, then changes), and imports customer data placed in an "Outbox" folder; another Edge page lists wish lists and sales as importable too. A developer has to build the other end. It must be bought and enabled on the licence. Pricing: activation $1,000 (export only) or $1,250 (both ways) through a partner, $2,000 or $2,500 otherwise; $300 a year unless through a partner; $500 a year for the "virtual web store" needed for imports. Punchmark is named as the only partner [V] ([EDT overview](https://edgeuser.com/Knowledge/Knowledge-Base/website-edt-edt-website-integration-edge-data-transfer-edt-overview), [technical overview](https://download.edgeuser.com/EdgeUpdates/EDT/Content/EDT_Overview.htm), [pricing](https://edgeuser.com/Knowledge/Knowledge-Base/website-edt-edt-website-integration-edt-pricing-and-additional-details)). A "for developers" section with a test environment exists; its pages had no content I could read [V for existence].
- **Shopify, through Edge Connector (ECon).** Edge uploads items and images to Shopify every 15 minutes by default; web sales come down into a queue for a person to process; titles, descriptions, tags and collections can come down; Edge transactions do not go up. $750 activation plus $95 a month. Variant support is "very limited", and the tip sheet (dated April 2021) says no third-party Shopify app integrates with Edge. ECon and EDT cannot run together [V] ([TIP-2021-158](https://edgeuser.com/Portals/0/docs/TIP-2021-158_ShopifyIntegration.pdf)).

**What third parties do.** Punchmark built its two-way website sync on EDT [V, Edge side; Punchmark's own page did not load]. GemLightbox is built into Edge: images are pulled per item, matched on Edge item number equals hub SKU, and unmatched items are pushed to the hub as products [V] ([TIP-2023-196](https://devuser.edgeuser.com/Portals/0/docs/TIP-2023-196_GemLightbox_ByPicupMedia.pdf)). That SKU-equals-item-number convention is the one Pavé should adopt for images.

### 3.3 Shopify and Shopify POS

- **API.** The Admin GraphQL API, current version 2026-10 [V] ([reference](https://shopify.dev/docs/api/admin-graphql/latest)). REST became legacy on 1 October 2024, and new public apps have had to use GraphQL since 1 April 2025 [V] ([REST reference](https://shopify.dev/docs/api/admin-rest)).
- **Rate limits.** Cost points per second by the store's plan: 100 standard, 200 Advanced, 1,000 Plus, 2,000 enterprise. A query may not cost more than 1,000 points; a mutation costs 10; the response's `extensions.cost` reports the bucket. Array inputs are capped at 250 items, pagination at 25,000 objects, and a store with 500,000 variants may add only 10,000 a day (not Plus) [V] ([GraphQL rate limits](https://shopify.dev/docs/apps/build/apis/graphql-admin/rate-limits.md), [API limits](https://shopify.dev/docs/api/usage/limits)). This confirms the figures `08-channels.md` carried as unverified.
- **Bulk operations.** `bulkOperationRunQuery` returns a JSONL file whose link lasts a week; the run itself is not charged to the rate limit; from 2026-01 five can run at once per app and store; the `bulk_operations/finish` webhook announces completion [V] ([bulk queries](https://shopify.dev/docs/api/usage/bulk-operations/queries)).
- **Objects for a piece.** Product and variants (three options at most [V, CSV page]); metafields for typed facts; metaobjects for structured records such as a stone line (40 fields per definition, 128 definitions per app, a million entries per definition) [V] ([metaobject limits](https://shopify.dev/docs/apps/build/custom-data/metaobjects/metaobject-limits)); inventory per location through `inventorySetQuantities`, which from 2026-04 needs an idempotency key and a `changeFromQuantity` on every line, and which Shopify says to use only when your system is the source of truth [V] ([mutation](https://shopify.dev/docs/api/admin-graphql/latest/mutations/inventorySetQuantities)). Draft orders suit a made-to-order quote [E].
- **POS.** Shopify POS has no separate data API: it sells the same products and inventory by location, and its sales arrive as orders [E, working knowledge; not opened]. Development stores cannot take real payments and the page does not say POS can be tested on them [V].
- **Customer data.** Orders, draft orders and customers are "protected customer data". A public app must request access and pass review, with extra requirements for name, address, phone and email (encrypted backups, access logs, an incident policy). A custom app gets both levels without review [V] ([protected customer data](https://shopify.dev/docs/apps/launch/protected-customer-data)).
- **Distribution.** Public (App Store, review, one-time $19 registration, 0% on the first $1,000,000 of lifetime revenue then 15%, plus 2.9% processing) or custom (one store, or the stores of one Plus organisation; no review; no Shopify billing). The choice cannot be changed afterwards. Apps created in the store admin are no longer available for new apps [V] ([distribution](https://shopify.dev/docs/apps/launch/distribution), [revenue share](https://shopify.dev/docs/apps/launch/distribution/revenue-share)). Development stores: up to 250 per organisation [V] ([dev stores](https://shopify.dev/docs/apps/build/dev-dashboard/development-stores)); a Partner account is free [E].
- **Terms.** Section 6.

### 3.4 QuickBooks Online

Intuit's developer portal did not render here, so the API detail is `[E]` and the programme detail comes from an Intuit blog post and an integrator's notes.

- **API** [E]: REST with JSON, OAuth 2.0, one "realm" per company. An Item is Inventory, NonInventory, Service or a bundle; an inventory item needs a quantity on hand, a start date and income, expense and asset accounts; quantity then moves only through transactions. Webhooks and a change-data-capture query exist. Sandbox companies are free.
- **Limits** [V2] ([Apideck connector notes](https://developers.apideck.com/connectors/quickbooks/docs/application_owner+api_changes)): 500 requests a minute per company and 10 concurrent in production; sandbox 10 a second.
- **App Partner Program.** Launched in the US on 28 July 2025 with four tiers, Builder, Silver, Gold and Platinum, a flat monthly fee by tier and variable API fees [V] ([Intuit press release](https://investors.intuit.com/_assets/_08ee5483ec4c057568cc8774f3fd6aad/intuit/news/2025-07-28_Intuit_Launches_New_App_Partner_Program_to_Drive_1261.pdf)). Builder is free with a cap of 500,000 "CorePlus" credits a month; Silver is $300 a month with usage fees past 1,000,000; both need an assessment questionnaire [V] ([Intuit developer blog](https://blogs.intuit.com/?p=35319)). Gold is $1,700 and Platinum $4,500 a month; creates and updates are "Core" calls and unmetered, reads are "CorePlus" and metered; Builder calls past the cap are blocked; Gold needs 500 active connections and Platinum 3,000; metering reached the UK, Australia and Canada on 3 November 2025 [V2] ([Apideck guide](https://www.apideck.com/blog/quickbooks-api-pricing-and-the-intuit-app-partner-program), same connector notes).
- **For Pavé:** pushing items is free of metering; reading stock back is what costs. A push-only connector fits Builder.

### 3.5 Xero

- **Pricing, verified.** Five tiers from 2 March 2026, replacing the old revenue-share model: Starter (free, 5 connections, 1,000 calls a day per organisation), Core (AUD 35 a month, 50 connections, 10 GB of data out), Plus (AUD 245, 1,000 connections, 50 GB), Advanced (AUD 1,445, 10,000 connections, 250 GB), Enterprise (by quote). Extra data out is AUD 2.40 per GB; data in is unlimited. Plus and above need app certification; Advanced and Enterprise need a yearly security assessment. Starter and Core cannot be listed in the Xero App Store [V] ([pricing](https://developer.xero.com/pricing), [policy FAQ](https://developer.xero.com/faq/pricing-and-policy-updates)). A connection counts until you remove it, even if the customer has left [V] ([commercial terms](https://developer.xero.com/xero-developer-platform-commercial-terms)).
- **Limits.** 5 calls in progress, 60 a minute and 5,000 a day per organisation, 10,000 a minute per app [V] ([limits FAQ](https://developer.xero.com/faq/limits)).
- **Webhooks.** Contacts, invoices, credit notes and subscription events; thin payloads (ids only); signed with HMAC-SHA256 in `x-xero-signature`; an "intent to receive" check before activation [V2] ([Hookdeck guide](https://hookdeck.com/webhooks/platforms/guide-to-xero-webhooks-features-and-best-practices.md)). No item or stock event was listed.
- **Items** [E]: code, name, sales and purchase details, a tracked-inventory flag with an asset account; quantity moves only through invoices and bills. Tracked inventory in Xero is basic and has an item-count ceiling I could not confirm (the limits page did not render). OAuth 2.0 with PKCE for apps that cannot hold a secret [E].

### 3.6 Zoho Books and Zoho Inventory

- **Endpoints.** One base address per data centre: `zohoapis.com`, `.eu`, `.in`, `.com.au`, `.jp`, `.ca`, `.com.cn`, `.sa` (Books also lists `.ae`). Every call needs `organization_id` [V] ([Books API](https://www.zoho.com/books/api/v3/introduction/), [Inventory API](https://www.zoho.com/inventory/api/v1/introduction/)).
- **OAuth across data centres.** The client is enabled per data centre in the API console; the authorisation response returns `location` and `accounts-server`, the token call goes to that server, and the token response gives the `api_domain` to use. Access tokens last an hour [V] ([multi-DC](https://www.zoho.com/accounts/protocol/oauth/multi-dc.html)). An Indian jeweler's organisation lives on `.in`; a connector that hard-codes `.com` fails for them.
- **Limits.** 100 requests a minute per organisation; per day 1,000 (Free), 2,000 (Standard), 5,000 (Professional), 10,000 (Premium and above); 5 concurrent on Free, 10 on paid [V].
- **Objects.** Inventory's API lists items, item groups, composite items (with assemblies), serial numbers, batches, price lists, inventory adjustments, transfer orders, sales orders, purchase orders, delivery challans and locations. Books' API lists items and item variants [V]. Composite items are the nearest thing to a bill of materials in any of the accounting clouds. India fields (HSN or SAC code, intra-state and inter-state tax rates) are on the item form [V] ([Books item help](https://www.zoho.com/in/books/help/items/index.md)); the API field names are `[E]`.

### 3.7 Lightspeed

Two retail products with different APIs.

- **X-Series** (formerly Vend). Dated API versions, 2026-10 current [V] ([introduction](https://x-series-api.lightspeedhq.com/docs/introduction)). OAuth 2.0 authorisation-code grant with a per-store domain prefix in the token address; personal tokens only on the Plus plan; a new app is "Not Approved" and can connect to 30 stores, and public apps need approval [V] ([authorization](https://x-series-api.lightspeedhq.com/docs/authorization)). Limit: 300 × registers + 50 requests per rolling five minutes [V] ([rate limiting](https://x-series-api.lightspeedhq.com/docs/rate_limiting)). Webhooks: `product.update`, `inventory.update`, `sale.update`, `customer.update`, `consignment.send`, `consignment.receive`, `register_closure.create`; retried up to 20 times over 48 hours [V] ([webhooks](https://x-series-api.lightspeedhq.com/docs/webhooks)). "Consignment" here means a stock transfer, not goods on approval.
- **R-Series.** Its documentation blocks automated readers. A directory reports a leaky bucket of 90 requests draining at one a second, growing with registers [V2] ([APIs.io](https://apis.io/rate-limits/lightspeed-pos/lightspeed-pos-rate-limits/)). Objects (items, matrices, serialized items, work orders) are `[E]`.

### 3.8 SAP Business One

Service Layer is a REST API following OData 3.0 and 4.0 [V] ([SAP Learning](https://learning.sap.com/courses/leveraging-the-sap-business-one-service-layer/introducing-service-layer-api-terms-and-documentation)). An integrator's guide gives the rest [V2] ([Apideck guide](https://www.apideck.com/blog/sap-business-one-api-integration-guide)): typical address `https://<server>:50000/b1s/v2/`; login by posting company, user and password, which returns a `B1SESSION` cookie that idles out after 30 minutes; OAuth 2.0 from 10.0 FP 2305; SQL Server or HANA; 20 records a page by default; `$batch`; user-defined fields prefixed `U_`. The DI API is a .NET library for add-ons on the same machine, and B1if is middleware. Each customer runs their own server, usually behind a firewall, and access is arranged through their SAP partner [E]. Indian exporters on B1 run a jewelry add-on [S, ERP report], so the real schema is the add-on's user-defined tables.

### 3.9 Dynamics 365 Business Central

- **Standard API v2.0.** `item` has number, display name, type, category, base unit, GTIN, unit price and cost, with `itemVariants`, `picture` and `documentAttachments`; `inventory` is read-only [V] ([item resource](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/api-reference/v2.0/resources/dynamics_item)). Fields cannot be added to the standard APIs; the route is a custom API page written in AL [V] ([API v2.0](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/api-reference/v2.0/)).
- **Webhooks.** Subscriptions with a validation handshake, three-day expiry, a 30-second batching delay, and a single "collection" notice when more than 1,000 records change; items, customers, vendors, sales orders and invoices are covered [V] ([subscriptions](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/api-reference/v2.0/dynamics-subscriptions)).
- **Limits.** 6,000 requests per five minutes per user, 5 concurrent, 8-minute timeout, 20,000 entities a page, 200 webhook subscriptions [V] ([operational limits](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/administration/operational-limits-online)).
- **AppSource.** Needed only if Pavé ships an extension: registered affixes and object-ID range, a signed `.app`, automated validation against every supported release [V] ([checklist](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-checklist-submission)). A connector that only calls the standard APIs installs nothing. Jewelry verticals on Business Central add their own tables, reachable only through that vendor's API pages [E].

### 3.10 NetSuite

SuiteTalk REST gives create, read, update and delete on records, a metadata catalogue, SuiteQL queries and asynchronous requests [V] ([REST overview](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_1540391670.html)). Concurrency is governed per account: base 5 (Standard tier), 15 (Premium), 20 (Enterprise, Ultimate), plus 10 per SuiteCloud Plus licence; developer and partner accounts stay at 5 [V] ([concurrency](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/bridgehead_1500275603.html)). Token-based authentication and OAuth 2.0, the SOAP service, and the SuiteCloud Developer Network (the partner programme that grants test accounts) are `[E]`; I did not open their pages.

### 3.11 Odoo

Odoo 19.0 adds a JSON API at `/json/2/<model>/<method>` with an API key sent as a bearer token; keys last at most three months. The older `/xmlrpc`, `/xmlrpc/2` and `/jsonrpc` endpoints are scheduled for removal in Odoo 20, which the page dates to autumn 2026; I did not check whether that release has shipped. The page also says external API access is "not available on One App Free or Standard plans" [V] ([external API](https://www.odoo.com/documentation/19.0/developer/reference/external_api.html)). File import is CSV or XLSX; an `id` (External ID) column makes a re-import update the same records instead of creating new ones, and related records are named by name, database id or external id [V, 18.0 page] ([import and export](https://www.odoo.com/documentation/18.0/applications/essentials/export_import_data.html)). Odoo has real bills of materials and manufacturing orders, so it is the general ERP that fits Pavé's data best [E].

### 3.12 Jewel360

Its integrations page names QuickBooks, Clientbook, Jewelers Mutual, Stuller, Geller's Blue Book, Buyers Intelligence Group and Affirm, and mentions no API or developer access [V] ([integrations](https://jewel360.com/integrations)). Its Shopify sync: at first sync active Shopify products are created in Jewel360; afterwards products, prices and categories flow from Jewel360 to Shopify only; web orders come back; one physical location only; serialized items sync as pooled stock without serial data; consignment contracts are not updated by Shopify sales [V] ([sync details](https://knowledge.jewel360.com/article/shopify-integration-comprehensive-data-sync-technical-details)). **Platform:** Rain Retail Software's jewelry POS page uses image files named for Jewel360 [V] ([Rain jewelry POS](https://www.rainpos.com/jewelry-store-pos)), which suggests Jewel360 is the jewelry edition of Rain's retail platform [E]; no page I opened states it.

### 3.13 PIRO

The integrations page lists Shopify (two-way prices, inventory, orders), QuickBooks Online, Xero, Etsy, RapNet, GIA certificates, the Signet portal by EDI, shipping carriers, TaxJar, HubSpot and Zapier, and names "REST API" and "XML / CSV" as supported methods. It publishes no API reference; the route in is a custom-integration request. CAD is not mentioned [V] ([PIRO integrations](https://www.gopiro.com/integrations)). The Zapier listing may be a self-service path worth a look [E].

### 3.14 Valigara

A documented API at `https://api.valigara.com/client/V1/`, called with an `action` parameter and a bearer key found in the account settings; JSON out; a leaky-bucket limit on some actions. Actions cover products (import, update, search, sold, delete, list fields, post to and revise listings), gemstones (import, update, search, delete, list fields), orders and batches. Updates overwrite with empty values, so existing values must be re-sent. Test credentials are given on request [V] ([API docs](https://www.valigara.com/docs/api/), [gemstone actions](https://www.valigara.com/features/external-integrations/api/gemstones-actions/)). It also pulls scheduled feeds from Excel, CSV, XML, Google Drive, Airtable and FTP, and has ready connectors to five diamond-inventory programs [V] ([external integrations](https://www.valigara.com/features/external-integrations/)). It syndicates to eBay, Etsy, Amazon, Walmart, Shein, Facebook and others [V] ([features](https://www.valigara.com/main-features/)). A search result also showed "MCP" tool pages under Valigara's integrations section [S].

### 3.15 Ornate and the Indian packages

None of the Indian packages I opened documents an API. What each page did say [V unless marked]:

- **Ornate** (DSoft Infotech): a directory lists "integration with accounting software" without naming Tally, plus repair management and barcode scanning ([SoftwareSuggest](https://www.softwaresuggest.com/us/ornate)). The earlier note that a directory lists it as having no API stays `[S]`.
- **Acme Infinity**: current (2026 footer); exports vouchers as XML for import into Tally; RFID; savings schemes; "advanced API integrations" with no detail ([site](https://acmeinfinity.com/)).
- **Synergics**: style master with multi-metal bills of materials, karigar job bags, loss tolerance, memo and repair modules; integrations named are Tally, QuickBooks, Salesforce, Qlik and EDI; CSV imports for US retailers ([site](https://www.synergicssolutions.com/jewellery-erp-suite/jewellery-manufacturing-software)). The name "JewelSteps" was not on the page.
- **Online Munim**: cloud; karigar, approvals, repairs, girvi, schemes, HUID search, RFID; claims 10,000+ customers; no API or Tally export mentioned ([site](https://www.omunim.com/)).
- **Jwelly**: retail, manufacturing, girvi and scheme modules; no integrations named ([site](https://www.jwelly.com/)).
- **Gehna ERP**: a directory says it does not provide an API ([SaaSworthy](https://www.saasworthy.com/product/gehna-erp)).
- **Marg, Logic ERP, RetailGraph / SwilERP, Jilaba**: searches returned only directory listings; nothing verified.

**The practical route into all of them is the same:** a file the jeweler or the vendor imports, and, for the accounts side, Tally. A Tally bridge exists in at least one (Acme, by XML vouchers) [V]. For Pavé that means the neutral export of step 1 below is the Indian connector until a vendor agrees to more.

### 3.16 Other US and UK retail systems

**BusinessMind** is cloud-based and names no integrations or API [V] ([site](https://www.businessmind.com/)). **Jewelry Shopkeeper** is desktop software that exports daily sales and payables to QuickBooks [V] ([site](https://www.jewelryshopkeeper.com/)). **Bransom**'s UK address now redirects to Clarity & Success, part of SelectLine Group, which lists online-shop integration and no API [V] ([site](https://clarity-success.com/en/)). **Pursuit**'s address returned a default WordPress page; nothing verified. One directory's "has an API" filter lists wJewel, Adaptive Jewelry ERP (Diaspark), Valigara, JewelMate Enterprise Retail, PIRO Fusion and Lightspeed Retail, and does not list The Edge or Jewel360 [V2] ([GetApp](https://www.getapp.com/retail-consumer-services-software/jewelry-store-management/f/api/)); directory flags are self-reported.

## 4. Jewelry-specific objects and how each system models them

"Native" means a first-class record. "Field" means Pavé can only carry it as a custom field, metafield, batch attribute or user-defined field. All cells are `[E]` unless a section 3 source says otherwise; the general systems' gaps are well known, the jewelry packages' depth is taken from their own pages.

| Object | Jewelry retail POS (The Edge, Jewel360) | Jewelry ERPs (PIRO, Synergics, Indian packages) | Tally | Shopify | QuickBooks / Xero / Zoho | SAP B1 / BC / NetSuite / Odoo |
|---|---|---|---|---|---|---|
| Memo and consignment (goods on approval) | Native; Edge checks memo stock separately on conversion [S] | Native (memo, approvals) [V Synergics, Omunim] | Not native; done with godowns or delivery notes | None; Jewel360's own consignment is not updated by Shopify sales [V] | None; Zoho has delivery challans [V] | Consignment stock and transfer orders exist; memo terms are add-on work |
| Repairs and job orders | Native (repair envelopes) | Native | Job work in / out orders [S] | None; third-party apps | None | Service or work orders; Lightspeed R work orders |
| Metal accounts (fine-gram balance per party) | Trade-in and scrap only | Native | Not native; needs TDL | None | None | Add-on |
| Karigar issue and receipt | — | Native (job bags, loss tolerance) [V Synergics] | Job work out, material in / out [S] | None | None | Subcontracting orders (Odoo, B1, NetSuite) |
| Making charges and wastage | Labour as a cost line | Native price formula | Not native | Price only; show the breakdown in metafields | Price only | Price lists; formula is add-on |
| Stones as serialised lots with certificates | Item details; GIA lookup in Jewel360 [S] | Native | Batches | Metaobjects (stone lines) | Serial and batch in Zoho Inventory [V] | Serial and lot tracking, native |
| One-of-a-kind versus style with variants | One record per tagged piece; Edge variants "very limited" in Shopify [V] | Style master plus tagged pieces | Stock item per variant; batch per piece | Product with up to 3 options [V]; a one-off is a product with quantity 1 | Zoho item groups and variants [V]; QuickBooks dropped variants on 1 June 2026 [V] | Item variants (BC [V]); matrix items (NetSuite); attributes (Odoo) |
| Hallmark and HUID (India) | — | Field on the piece; Omunim searches by HUID [V] | Field or batch attribute | Metafield | Custom field | User-defined field |
| GST and HSN | — | Native | Native on stock items | Tax by region; HSN as metafield | Zoho India native [V]; others not | Localisation packs |
| Barcode and RFID tags | Native barcode tags | Barcode and RFID [V Acme, Omunim] | Part number / alias | Barcodes column (up to 20) [V] | SKU only | Native barcodes |

**What follows for Pavé's data model.** The piece record needs four things every target can take in some form: a stable style id and variant id; a per-piece (tag) id that can live in a batch, serial or SKU field; stone lines as rows of their own; and metal lines with alloy, purity and expected weight. Everything else in the table belongs to the receiving system.

## 5. Import file formats

### 5.1 The Edge: Item Data Import (update only) [V]

From the file-format page and tip sheet in 3.2. One key is required: `itKey`, or `itVendorID` with `itVendStyleCode` (which updates every item of that vendor style).

| Column | Meaning |
|---|---|
| `itDesc` | Description |
| `itMetalType`, `itMetalColor`, `itMetalFinish` | Metal type, colour, finish |
| `itSize`, `itLength`, `itMillimeter` | Size, length, millimetres |
| `itStyle`, `itMfg` | Item style, manufacturer |
| `itRetailPrice`, `itCurrentPrice`, `itLowestPrice` | Prices |
| `itFolioNumber`, `itVendBarCode`, `itSerialNumber` | Folio, vendor barcode, serial number |
| `imTitle`, `imDescription`, `imWebTags`, `imMetaTitle`, `imMetaKeywords`, `imMetaDescription` | Website fields |
| `itDetail_1` … `itDetail_16`, `imDetail_1` … `imDetail_8` | Custom details, one category per import |

No stone, weight, cost or image columns are listed. **Receive Invoice import**: CSV or Excel, headers in row one, columns mapped on screen; named fields are Image 1 to 5 and Vendor Style Number; the full list is in the in-app blank template, which I could not obtain: `[S]`.

### 5.2 Shopify product CSV [V]

From [Shopify's CSV help page](https://help.shopify.com/en/manual/products/import-export/using-csv). Shopify renamed the columns; older names (Handle, Body (HTML)) are still accepted.

| Column | Required | Notes |
|---|---|---|
| `Title` | Yes for new products | |
| `URL handle` | For updates and extra variant rows | Defaults from the title |
| `Description`, `Vendor`, `Type`, `Tags` | No | 250 tags at most |
| `Product category` | No | Must be a Standard Product Taxonomy value |
| `Published on online store`, `Status` | No | Default `true`, `active` |
| `Option1 name` / `Option1 value` (to Option3) | For variants | Three options at most |
| `SKU`, `Barcodes` | No | Up to 20 barcodes, separated by semicolons |
| `Price`, `Compare-at price`, `Cost per item`, `Charge tax` | No | Price defaults to 0.00 |
| `Inventory tracker`, `Inventory quantity`, `Continue selling when out of stock` | No | Quantity only for single-location stores; `deny` by default |
| `Weight value (grams)`, `Weight unit for display`, `Requires shipping` | No | |
| `Product image URL`, `Image position`, `Image alt text`, `Variant image URL` | No | |
| `SEO title`, `SEO description` | No | 70 and 320 characters |
| `<name> (product.metafields.<namespace>.<key>)` | No | Product metafields only; variant metafields are not supported in CSV |

### 5.3 Tally: stock items [V]

By XML or JSON, the tags in 3.1. By Excel, the field names Tally lists for mapping include Group Name (alias Parent Name, Under), Category, Units (alias UOM), Alternate units, Part No., Opening Balance – Value, godown allocations, a "maintain in batches" flag, and for a bill of materials: BOM name, unit of manufacture, component item, quantity, godown, type and rate. Bold headers in the sample sheet are mandatory. The sample workbooks are zip downloads on the samples page; I did not open the workbooks themselves.

### 5.4 QuickBooks Online: products and services [V, partial]

From [Intuit's import article](https://quickbooks.intuit.com/learn-support/en-us/manage-lists/import-products-and-services-from-excel/00/185613): CSV (the new screen), or Excel and Google Sheets (the older one); 1,000 rows per import; fields named are product or service name (512 characters in the new version), category (colon-separated, four levels), SKU (100 characters), descriptions (4,000), income and expense account (not sub-accounts), and quantity as-of date. The article does not list every column; the rest (type, sales price, cost, quantity on hand, inventory asset account) is `[E]`.

### 5.5 Xero: inventory items [E]

The help page did not render. From memory the template columns are `*ItemCode`, `ItemName`, `PurchasesDescription`, `PurchasesUnitPrice`, `PurchasesAccount`, `PurchasesTaxRate`, `SalesDescription`, `SalesUnitPrice`, `SalesAccount`, `SalesTaxRate`, `InventoryAssetAccount`, `CostOfGoodsSoldAccount`, with only the code required. Check against a live Xero organisation before building.

### 5.6 Zoho Books: items [V, partial]

CSV, TSV or XLS, 1 MB at most; duplicates are skipped or overwritten, matching on Item Name, Item ID or SKU (case-sensitive); the mapping can be saved. The page points to a sample file for the columns and does not list them; the item form has rate, accounts, descriptions, intra-state and inter-state tax rates, track-inventory flag, opening stock and rate, reorder point and preferred vendor.

### 5.7 Odoo, Business Central, Lightspeed

**Odoo** [V]: any model imports from CSV or XLSX; keep an `id` column of your own External IDs so a second import updates; empty cells overwrite with empty. **Business Central** [V] ([configuration packages](https://learn.microsoft.com/en-us/dynamics365/business-central/admin-migrate-customer-data)): the Excel workbook must be exported from the Configuration Packages page so that it matches the table structure; Microsoft says to use packages for first-time company setup and XMLports afterwards. So there is no fixed public column list: the template is generated per tenant. **Lightspeed product import**: not verified.

## 6. Terms and programme requirements that restrict or tax a connector

Not legal advice. Clause numbers are as shown on the pages on 25 November 2026.

| System | Clause | What it says, in short | Why it matters to Pavé |
|---|---|---|---|
| Shopify [API terms](https://www.shopify.com/legal/api-terms), updated 7 Oct 2026 [V] | §2.3.24 | No use of API-derived or merchant data, even aggregated, to train or improve AI or machine-learning systems without Shopify's or the merchant's consent | Orders and stock read back must stay out of any learning loop |
| | §6.2.3 | Delete merchant data within 30 days of uninstall | Needs a deletion job per store |
| | §2.3.12, §2.3.10 | No app whose main purpose is moving merchants off Shopify; no substantial copy of Shopify products | An export-out feature must not be the app's purpose |
| | §2.3.14, §2.3.8 | No scraping or systematic harvesting; request the minimum data | Use the API only |
| | §2.4, §2.3.9 | Limits are Shopify's to set; no working around them | |
| | §2.3.18 | No alternative checkout without approval | Pavé takes no payments, so no conflict |
| | §6.2.10, §7, §8 | Breach notice within 24 hours; Shopify may monitor and audit | |
| Shopify [Partner Program Agreement](https://www.shopify.com/partners/terms), 27 Feb 2026 [V, first two-thirds of the page] | Part C §4; §9.15 | Charging merchants must go through Shopify's billing; the AI-training bar again | A paid public app means Shopify bills for it |
| Xero [developer platform terms](https://developer.xero.com/xero-developer-platform-terms-conditions), 4 Dec 2025 [V] | 7(b)(i) | API data may not train, fine-tune or enhance AI models | Same as Shopify |
| | 29 | No moving customers off Xero, no reproducing Xero's products, no scraping or browser automation, no passing aggregated user data to third parties | |
| | 15, 38 | Security standards; incidents reported within 24 hours; audits up to twice a year | |
| | 7(a) | Limits and fees follow the tier; exceeding needs consent | |
| Intuit | — | Terms page did not render | Counsel must read before any QuickBooks work |
| Zoho | — | API terms page did not open | Same |
| The Edge | — | No public developer terms found; EDT is the sanctioned route and is paid by the jeweler | Reading the Edge database directly has no stated permission |
| Tally | — | No terms on calling the port found | The risk is security, not contract |
| Microsoft | — | [Microsoft APIs Terms of Use](https://learn.microsoft.com/en-us/legal/microsoft-apis/terms-of-use) is referenced by the Business Central API page [V link]; not read | |

**Costs and gates in one place.** Shopify public app: $19, review, 15% after the first $1,000,000. Xero: AUD 35 a month from the sixth connection, certification before the 51st. QuickBooks: free up to 500,000 reads a month, then $300 a month. Business Central: nothing unless an extension is shipped. The Edge: the jeweler pays Edge $1,000 to $2,500 plus yearly fees for EDT. Tally, Odoo, Zoho: no programme fee found.

**For counsel to read:** Shopify API terms §2.3.24 and §6.2, and Partner Program Agreement §9.15; Xero terms clauses 7 and 29; Intuit's developer terms in full; whether sending a merchant's own data to a language model to answer that merchant's question counts as "improving" an AI system under those clauses; and whether reading a jeweler's desktop database with the jeweler's consent but without the vendor's breaches the vendor's licence.

**Unofficial access to desktop databases.** I found no published clause for The Edge, Ornate or the other desktop packages either way. The practical objections are enough: schemas change without notice, a write can corrupt stock, and the vendor's support will blame the connector [E]. Read-only SQL is a special case to accept only when the vendor itself offers it.

## 7. Ranked recommendation

The ERP report's order, files first and live connectors later, holds. What changes is which files, and that two "live" connectors are cheap enough to follow immediately. All sizes and risks are `[E]`.

| # | Connector | What it does | Effort | Risk | Why here |
|---|---|---|---|---|---|
| 1 | **Neutral piece export** (CSV, XLSX and JSON, with a published column dictionary) | One row per variant; separate sheets for metal lines, stone lines and images; stable style, variant and tag ids | S | Low | Every later connector is a mapping of this file. It is also the only route into Ornate, Omunim, Jwelly, PIRO's batch import, Odoo, Business Central packages and NetSuite CSV today |
| 2 | **Tally masters** | (a) an XML and a JSON file the user imports; (b) "Send to Tally" from local Pavé to `localhost:9000`, masters only, with a dry run that reads existing units and stock groups first | S for (a), M for (b) | Medium: no auth on the port; each shop's Tally is customised; item naming collisions; must never post vouchers | Documented, free to call, and where Indian jewelers' item lists end up |
| 3 | **Shopify** (as planned in `08-channels.md`) | Products, variants, metafields, stone metaobjects, images; later orders and stock by webhook | M | Medium: protected-customer-data review and the AI clause once orders are read | Already the first channel; the same adapter serves jewelers who use Shopify POS as their till |
| 4 | **The Edge: Receive Invoice file + photo folder** | A spreadsheet in Edge's blank-template columns and a folder of images named by vendor style number; optionally a second file for the Item Data Import to fill web fields and custom details | S | Medium: column names unknown until an Edge user sends the template; we cannot test without an Edge licence | About 3,500 US stores claimed [S]; needs no permission from Edge |
| 5 | **Zoho Inventory, then QuickBooks Online, then Xero: item push** | Create or update items (and composite items in Zoho) | M each | Low to medium: per-data-centre OAuth (Zoho); partner tiers (QuickBooks, Xero) | Cheap, but these systems keep little of what Pavé knows. Zoho first because it has a bill of materials and Indian tax fields |
| 6 | **Valigara** | Product and gemstone import by API | S–M | Low: documented; ask for test credentials | The one jewelry-specific system with a public API; reaches marketplaces Pavé will not build |
| 7 | **Read-back** | Shopify webhooks; Tally export of stock items locally; The Edge EDT JSON if a customer already pays for it | M each | Medium to high: terms on AI use; EDT cost falls on the jeweler | Only after a paying customer asks |
| 8 | **On demand** | PIRO (by agreement), Business Central (standard API, or an AL extension if a jewelry vertical is involved), Odoo, NetSuite, SAP Business One, Lightspeed X-Series | M–L each | Varies; SAP and NetSuite need the customer's partner | Each is one customer's requirement, not a market |
| — | **Rejected** | Direct reads or writes to a desktop ERP's database; posting vouchers or invoices anywhere; building on REST for Shopify; relying on Shopify to reach The Edge or Jewel360 | | | Fragile or outside the "never the books" line; the last one does not work (section 1) |

## 8. What this means for the plan

Inputs for `docs/plans/integrations-hub.md`:

1. **Define the neutral export first and make it the contract.** Sheets: pieces (style id, variant id, tag id, title, category, metal, purity, size, expected metal weight per alloy, stone count and carats, cost, price inputs, HSN code, HUID slot, origin wording), metal lines, stone lines (shape, size, count, carats, origin type, lab, report number), images (file name = SKU or vendor style number). Every connector is a mapping from it.
2. **Adopt one identity rule.** SKU = the receiving system's item number wherever that system allows it (The Edge's GemLightbox link and its Shopify link both key on it [V]). Keep the receiving system's own id beside ours after the first push.
3. **Connector shape.** Each connector declares: direction (push, pull), transport (file, local HTTP, cloud API), objects, a dry run, an idempotency key and a run log. Tally and The Edge are "file or local" transports; plan a small local connector for the hosted product, following Tally's outbound-connection pattern.
4. **A hard rule in the hub:** masters and catalogue data only. No vouchers, invoices, payments or stock postings. Stock is read, never set, except in Shopify when the jeweler has made Pavé the source of truth for a made-to-order item.
5. **A data-use rule:** anything read back through Shopify or Xero is tagged with its source and excluded from prompts used to improve models, from recordings and from any training set. Decide with counsel whether per-merchant inference is allowed.
6. **Order of work:** section 7, steps 1 to 4, before any cloud accounting connector.
7. **Reject** named live connectors to Ornate, Jewel360, BusinessMind and the other closed packages until a vendor offers an interface; offer them the neutral file.

Open questions for the founder:

1. Can a jeweler who runs The Edge send us the in-app "Download Blank xlsx" from Receive Invoice, and try one test import? Step 4 depends on it.
2. Which Tally release and which jewelry package does the pilot workshop run, and who customised its Tally? That decides XML or JSON and the stock-group naming.
3. Should Pavé approach The Edge (now under a private-equity owner [S]) and PIRO for partner status, or stay permissionless on files?
4. Is a Shopify public app wanted in the first year (review, billing through Shopify), or only custom-distribution apps per customer?
5. Does the founder accept the AI-data rule in point 5, given that it limits what the assistant may learn from customers' sales?
6. Is reading stock back wanted at all before a customer pays for it? It is where most of the cost and all of the terms risk sit.

## 9. What this file corrects in earlier repo research

| Earlier statement | Where | Finding |
|---|---|---|
| The Edge's self-service item import is "a ready target for an item master exported from Pavé" | ERP report, migration section | **Corrected.** The wizard only updates existing items [V]. The creation path is the Receive Invoice import |
| "as The Edge's item-import columns" as an export target | ERP report, build table step 2 | **Corrected** in the same way; target the Receive Invoice template |
| Tally reachable over XML on port 9000 or ODBC; duplicate voucher ids overwrite | ERP report | **Confirmed** [V], with detail: the overwrite is keyed on the voucher GUID |
| Jewel360 and The Edge "sit behind Shopify" (15-minute sync) | `08-channels.md` line 95 | **Half right.** 15 minutes is confirmed for The Edge [V]; but both push to Shopify and neither takes new stock from it |
| "The Edge, Jewel360, PIRO and Valigara already sync to [Shopify], so one adapter reaches five systems" | `10-market.md` line 90 | **Corrected.** They sync their own items to Shopify. A product created in Shopify by Pavé does not become stock in The Edge, and reaches Jewel360 only at its first sync [V]. PIRO's Shopify link is two-way for prices, inventory and orders, not stated for new items [V]. One adapter reaches Shopify, not five systems |
| "Edge: no public API found, a Shopify connector" | `10-market.md` line 62 | **Confirmed** [V], and EDT added |
| "No adapters" for PIRO and Valigara | `08-channels.md` | **Updated.** Valigara has a public API [V]; PIRO lists REST and XML/CSV but only by custom request [V] |
| Shopify rate limits 100 / 200 / 1,000 / 2,000 (unverified) | `08-channels.md` | **Confirmed** [V] |
| The Edge and RapNet-style feeds push files (unverified) | `catalog-import-and-store.md` 2.4 | **Confirmed for The Edge**: EDT writes JSON to a folder or FTP [V] |
| Ornate "listed as having no API" | ERP report | **Not verified**; still `[S]`. The page I opened is silent on APIs |
| Punchmark two-way sync covers products, customers, repairs and transactions | ERP report | **Partly verified.** Edge's own pages give customers, inventory and transactions out and customers (plus wish lists and sales on one page) in [V]; repairs not seen; Punchmark's page did not load |

Not rechecked: Jewel360 and PIRO prices, The Edge's licence price and store count, the Serent Capital purchase.

## Repo notes for the lead

- `docs/research/08-channels.md` line 95, `docs/research/10-market.md` line 90, and the ERP report's migration section and step 2 of its build table carry the errors listed in section 9. `docs/plans/publishing.md` does not mention The Edge or Tally, so it needs no change.
- `10-market.md` line 90 also lists "invoice export to QuickBooks/Xero" as a connector worth building. The later decision ("never build the books", `HANDOVER.md` section 6) and this file's rule of masters only point the other way. The lead should decide which stands.
- This file is about 77 KB, above the 25 to 45 KB aim. Roughly a quarter is link text, because each of about a hundred sources appears once inline and once in Sources, as the brief requires.
- The ERP report and `catalog-import-and-store.md` name the founder's related companies and a specific ERP; this file does not, per the shared brief. No action needed, only a note that the two styles now coexist.
- `docs/HANDOVER.md` section 2 still lists research as `01`–`11` "(`12-rhino-parity.md` when written)"; `12` exists.

## Sources

**Tally** — [V] [Integrate with TallyPrime](https://help.tallysolutions.com/integrate-with-tallyprime/) · [V] [XML integration](https://help.tallysolutions.com/xml-integration/) · [V] [JSON integration](https://help.tallysolutions.com/tally-prime-integration-using-json-1/) · [V] [ODBC](https://help.tallysolutions.com/odbc-integrations/) · [V] [Prerequisites](https://help.tallysolutions.com/pre-requisites-for-integrations/) · [V] [Methods and technologies](https://help.tallysolutions.com/integration-methods-and-technologies/) · [V] [Integration initiated from third-party applications](https://help.tallysolutions.com/integration-initiated-from-tpas/) · [V] [TallyPrime as server](https://help.tallysolutions.com/tallyprime-as-server/) · [V] [Integration of inventory masters](https://help.tallysolutions.com/?p=149538) · [V] [Tunnel-based connectivity](https://help.tallysolutions.com/building-tunnel-based-connectivity-for-tallyprime-integrations/) · [V] [Secure WebSocket integration](https://help.tallysolutions.com/secure-websocket-integration-with-tallyprime/) · [V] [Getting started with importing data](https://help.tallysolutions.com/getting-started-with-importing-data-into-tallyprime/) · [V] [Sample Excel files](https://help.tallysolutions.com/tally-prime/import-data/download-sample-excel-files-with-data-for-import) · [V] [Total cost of TallyPrime](https://tallysolutions.com/business-guides/tallyprime-total-cost-of-ownership-india/) · [V] [Tally Developer](https://tallysolutions.com/id/tally-developer-9) · [S] [Stock item creation payload (docx)](https://help.tallysolutions.com/wp-content/uploads/2025/11/Stock-Item-Creation-Payload.docx)

**The Edge** — [V] [Item data import/export](https://edgeuser.com/Knowledge/Knowledge-Base/inventory-item-data-importexport) · [V] [Item data import](https://edgeuser.com/Knowledge/Knowledge-Base/inventory-item-data-importexport-item-data-import) · [V] [Item data import file format](https://edgeuser.com/Knowledge/Knowledge-Base/inventory-item-data-importexport-item-data-import-item-data-import-file-format) · [V] [TIP-2023-200 Item Data Import Wizard](https://devuser.edgeuser.com/Portals/0/docs/TIP-2023-200_ItemDataImportWizard.pdf) · [V] [Receive Invoice: importing data](https://edgeuser.com/Knowledge/Knowledge-Base/inventory-receive-invoice-recv-invoice-importing-data) · [V] [Importing vendor catalog files](https://edgeuser.com/Knowledge/Knowledge-Base/inventory-vendors-importing-vendor-catalog-files) · [V] [EDT overview](https://edgeuser.com/Knowledge/Knowledge-Base/website-edt-edt-website-integration-edge-data-transfer-edt-overview) · [V] [EDT technical overview](https://download.edgeuser.com/EdgeUpdates/EDT/Content/EDT_Overview.htm) · [V] [EDT pricing](https://edgeuser.com/Knowledge/Knowledge-Base/website-edt-edt-website-integration-edt-pricing-and-additional-details) · [V, no content] [EDT for developers: launch process](https://edgeuser.com/Knowledge/Knowledge-Base/website-edt-for-developers-edt-test-environment-launch-process) · [V] [TIP-2021-158 Shopify integration](https://edgeuser.com/Portals/0/docs/TIP-2021-158_ShopifyIntegration.pdf) · [V] [TIP-2023-196 GemLightbox](https://devuser.edgeuser.com/Portals/0/docs/TIP-2023-196_GemLightbox_ByPicupMedia.pdf) · [S, did not load] [Punchmark POS bi-directional integration](https://punchmark.atlassian.net/wiki/x/BQCITw)

**Shopify** — [V] [Admin GraphQL reference](https://shopify.dev/docs/api/admin-graphql/latest) · [V] [REST Admin reference](https://shopify.dev/docs/api/admin-rest) · [V] [GraphQL rate limits](https://shopify.dev/docs/apps/build/apis/graphql-admin/rate-limits.md) · [V] [API limits](https://shopify.dev/docs/api/usage/limits) · [V] [Bulk queries](https://shopify.dev/docs/api/usage/bulk-operations/queries) · [V] [Protected customer data](https://shopify.dev/docs/apps/launch/protected-customer-data) · [V] [Distribution](https://shopify.dev/docs/apps/launch/distribution) · [V] [Revenue share](https://shopify.dev/docs/apps/launch/distribution/revenue-share) · [V] [Development stores](https://shopify.dev/docs/apps/build/dev-dashboard/development-stores) · [V] [inventorySetQuantities](https://shopify.dev/docs/api/admin-graphql/latest/mutations/inventorySetQuantities) · [V] [Metaobject limits](https://shopify.dev/docs/apps/build/custom-data/metaobjects/metaobject-limits) · [V] [Product CSV](https://help.shopify.com/en/manual/products/import-export/using-csv) · [V] [API terms](https://www.shopify.com/legal/api-terms) · [V, partial] [Partner Program Agreement](https://www.shopify.com/partners/terms)

**QuickBooks Online** — [V] [Intuit press release, 28 July 2025](https://investors.intuit.com/_assets/_08ee5483ec4c057568cc8774f3fd6aad/intuit/news/2025-07-28_Intuit_Launches_New_App_Partner_Program_to_Drive_1261.pdf) · [V] [Intuit developer blog on the Silver tier](https://blogs.intuit.com/?p=35319) · [V2] [Apideck: QuickBooks API pricing](https://www.apideck.com/blog/quickbooks-api-pricing-and-the-intuit-app-partner-program) · [V2] [Apideck: QuickBooks API changes](https://developers.apideck.com/connectors/quickbooks/docs/application_owner+api_changes) · [V] [Import products and services](https://quickbooks.intuit.com/learn-support/en-us/manage-lists/import-products-and-services-from-excel/00/185613) · [did not render] [App Partner Program page](https://developer.intuit.com/app/developer/qbo/docs/get-started/app-partner-program), [partner FAQ](https://developer.intuit.com/app/developer/qbo/docs/get-started/partner-faq), [inventory workflow](https://developer.intuit.com/app/developer/qbo/docs/workflows/manage-inventory)

**Xero** — [V] [Pricing](https://developer.xero.com/pricing) · [V] [Pricing and policy updates](https://developer.xero.com/faq/pricing-and-policy-updates) · [V] [Limits FAQ](https://developer.xero.com/faq/limits) · [V] [Developer platform terms](https://developer.xero.com/xero-developer-platform-terms-conditions/) · [V] [Commercial terms](https://developer.xero.com/xero-developer-platform-commercial-terms) · [V2] [Hookdeck: Xero webhooks](https://hookdeck.com/webhooks/platforms/guide-to-xero-webhooks-features-and-best-practices.md) · [did not render] [Items API](https://developer.xero.com/documentation/api/accounting/items), [OAuth limits](https://developer.xero.com/documentation/guides/oauth2/limits/), [webhooks](https://developer.xero.com/documentation/guides/webhooks/overview/), [import inventory items](https://central.xero.com/s/article/Import-inventory-items)

**Zoho** — [V] [Books API introduction](https://www.zoho.com/books/api/v3/introduction/) · [V, navigation only] [Books Items API](https://www.zoho.com/books/api/v3/items/) · [V] [Inventory API introduction](https://www.zoho.com/inventory/api/v1/introduction/) · [V] [Multi-DC OAuth](https://www.zoho.com/accounts/protocol/oauth/multi-dc.html) · [V] [Books India item help](https://www.zoho.com/in/books/help/items/index.md) · [did not open] [API terms](https://www.zoho.com/developer/api-terms.html)

**Lightspeed** — [V] [X-Series introduction](https://x-series-api.lightspeedhq.com/docs/introduction) · [V] [Authorization](https://x-series-api.lightspeedhq.com/docs/authorization) · [V] [Rate limiting](https://x-series-api.lightspeedhq.com/docs/rate_limiting) · [V] [Webhooks](https://x-series-api.lightspeedhq.com/docs/webhooks) · [V2] [APIs.io: R-Series rate limits](https://apis.io/rate-limits/lightspeed-pos/lightspeed-pos-rate-limits/) · [blocked] [R-Series docs](https://developers.lightspeedhq.com/retail/introduction/introduction/)

**General ERPs** — [V] [SAP Learning: Service Layer terms](https://learning.sap.com/courses/leveraging-the-sap-business-one-service-layer/introducing-service-layer-api-terms-and-documentation) · [V2] [Apideck: SAP Business One guide](https://www.apideck.com/blog/sap-business-one-api-integration-guide) · [blocked] [Working with Service Layer (PDF)](https://help.sap.com/doc/fc2f5477516c404c8bf9ad1315a17238/10.0/en-US/Working_with_SAP_Business_One_Service_Layer.pdf) · [V] [Business Central API v2.0](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/api-reference/v2.0/) · [V] [item resource](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/api-reference/v2.0/resources/dynamics_item) · [V] [subscriptions](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/api-reference/v2.0/dynamics-subscriptions) · [V] [operational limits](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/administration/operational-limits-online) · [V] [AppSource technical checklist](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-checklist-submission) · [V] [configuration packages](https://learn.microsoft.com/en-us/dynamics365/business-central/admin-migrate-customer-data) · [V] [NetSuite REST overview](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_1540391670.html) · [V] [NetSuite concurrency limits](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/bridgehead_1500275603.html) · [V] [Odoo 19 external API](https://www.odoo.com/documentation/19.0/developer/reference/external_api.html) · [V] [Odoo 18 import and export](https://www.odoo.com/documentation/18.0/applications/essentials/export_import_data.html)

**Jewelry vendors** — [V] [Jewel360 integrations](https://jewel360.com/integrations) · [V] [Jewel360 Shopify sync details](https://knowledge.jewel360.com/article/shopify-integration-comprehensive-data-sync-technical-details) · [V] [Rain POS jewelry page](https://www.rainpos.com/jewelry-store-pos) · [V] [PIRO integrations](https://www.gopiro.com/integrations) · [V] [Valigara API](https://www.valigara.com/docs/api/) · [V] [Valigara gemstone actions](https://www.valigara.com/features/external-integrations/api/gemstones-actions/) · [V] [Valigara external integrations](https://www.valigara.com/features/external-integrations/) · [V] [Valigara features](https://www.valigara.com/main-features/) · [V] [Acme Infinity](https://acmeinfinity.com/) · [V] [Synergics](https://www.synergicssolutions.com/jewellery-erp-suite/jewellery-manufacturing-software) · [V] [Online Munim](https://www.omunim.com/) · [V] [Jwelly](https://www.jwelly.com/) · [V2] [SoftwareSuggest: Ornate](https://www.softwaresuggest.com/us/ornate) · [V2] [SaaSworthy: Gehna ERP](https://www.saasworthy.com/product/gehna-erp) · [V] [BusinessMind](https://www.businessmind.com/) · [V] [Jewelry Shopkeeper](https://www.jewelryshopkeeper.com/) · [V] [Clarity & Success](https://clarity-success.com/en/) · [V2] [GetApp: jewelry software with an API](https://www.getapp.com/retail-consumer-services-software/jewelry-store-management/f/api/) · [no usable content] [Pursuit](https://www.pursuitsoftware.co.uk/)

**Repo** — the ERP report and its notes; `08-channels.md`; `catalog-import-and-store.md`; `publishing.md`; `PLAN.md`; `HANDOVER.md`.
