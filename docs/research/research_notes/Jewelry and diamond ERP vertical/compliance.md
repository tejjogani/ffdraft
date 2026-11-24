# Compliance requirements for a diamond and jewelry ERP (system of record), per jurisdiction

Research date: 2026-11-24. Method: 41 web searches and 9 page fetches.

**How to read the labels.**
- [V]: verified by opening the source page. **There are no [V] claims in these notes.** Every page fetch failed because the host is outside this session's allowed network domains (DNS `ENOTFOUND`). The blocked hosts were www.awdc.be, www.ecfr.gov, rapaport.com, www.irs.gov, www.fincen.gov, www.ftc.gov, www.bis.gov.in and www.gov.uk. They would need to be allowed before anything here can be upgraded to [V].
- [S]: seen only in a search-result extract. Most findings carry this label. The cited URL is the page that extract came from. The page itself was not opened.
- [E]: my estimate or inference, or background knowledge I could not confirm in this session. Build-difficulty ratings are all [E].

**Build difficulty scale [E].**
- **L (low):** a field, a validation or a report.
- **M (medium):** a workflow with state, a ledger, or a file export.
- **H (high):** a live government or third-party API integration, a legally sensitive ledger such as an immutable audit log, or per-item chain of custody.

**Who usually does it today [E].** Each item is tagged with where the work usually happens: ERP (jewelry ERPs), ACC (an accounting package such as Tally, QuickBooks or Xero), MAN (by hand, spreadsheets, or a consultant or CA), or 3P (a third-party platform or portal).

This is a report of what rules and sources say. It is not legal advice.

---

## India: GST, e-invoicing, e-way bills, TCS/TDS and cash limits, hallmarking/HUID, PMLA, Companies Act books and audit trail, export schemes

### Takeaway
India is the most software-heavy jurisdiction in scope. Six items are hard legal requirements that a system of record either does itself or must hand off cleanly:
1. Product-specific GST rates: 3% on jewellery, 1.5% on cut-and-polished diamonds and on diamond job work, 0.25% on rough diamonds.
2. IRP e-invoicing at AATO ₹5 crore and above, with a hard 30-day reporting cutoff at AATO ₹10 crore and above since 1 April 2025.
3. A per-piece HUID for gold hallmarking in 380 districts. 9K was added in 2025.
4. A tamper-proof, always-on edit log for any accounting software a company uses (Rule 3(1), from FY 2023-24), with daily backups on servers in India and 8-year retention.
5. A ₹2 lakh cash-receipt bar (s.269ST).
6. PMLA reporting-entity duties once a dealer takes cash of ₹10 lakh or more from a customer.

E-way bills are mostly not required for Chapter 71 goods. Kerala is the exception.

### Cited Findings

**GST rates (HSN Chapter 71)**
- **Rough or unworked diamonds** are taxed at 0.25% [S]. [Razorpay](https://razorpay.com/learn/gst-on-diamond/)
- **Cut and polished diamonds** went from 0.25% to 1.5%, effective 18 July 2022. The stated aim was to fix input tax credit (ITC) accumulation [S]. [FashionNetwork](https://in.fashionnetwork.com/news/Government-raises-gst-on-cut-and-polished-diamonds-to-1-5-,1420044.html); [GJEPC Solitaire](https://gjepc.org/solitaire/?p=16021)
- **Gold, platinum and diamond jewellery** is taxed at 3% on the whole invoice value: stones, metal and making charges [S]. [Swipe](https://getswipe.in/blog/article/gst-on-diamond-jewellery-rates-compliance); [Aditya Birla Capital](https://www.adityabirlacapital.com/abc-of-money/chapter-71-gst-rate-hsn-code-for-diamond-jewellery)
- **The GST 2.0 restructuring** (56th GST Council, 3 Sept 2025, effective 22 Sept 2025) left jewellery at 3% and loose diamond rates unchanged [S]. [Delmer Group blog](https://delmergroup.com/blogs/news/gst-on-gold-jewelry-and-lab-grown-diamond-jewelry-latest-updates-after-gst-council-reforms); [ClearTax 56th meeting](https://cleartax.in/s/56th-gst-council-meet-news)
  - The trade body GJC has asked for jewellery to go to 1% and for a lab-grown concession. These are requests only [S]. [Delmer Group blog](https://delmergroup.com/blogs/news/gst-on-gold-jewelry-and-lab-grown-diamond-jewelry-latest-updates-after-gst-council-reforms)
  - One source says imported diamond jewellery moved to 5% under GST 2.0. This conflicts with the other sources and is unconfirmed [S]. Summary seen in [Bajaj Finserv](https://www.bajajfinserv.in/gst-on-diamond)
- **Lab-grown diamonds: the sources conflict.**
  - One blog puts loose lab-grown diamonds (HSN 7104) at 0.25% and lab-grown jewellery at 3% [S]. [Delmer Group blog](https://delmergroup.com/blogs/news/gst-on-gold-jewelry-and-lab-grown-diamond-jewelry-latest-updates-after-gst-council-reforms)
  - Other HSN tables list synthetic diamonds at 1.5% [S]. [Razorpay](https://razorpay.com/learn/gst-on-diamond/)
  - The rate for lab-grown "seeds" could not be found. **The CBIC notification must be checked.**
- **Diamond job work** (services) went from 5% to 1.5% under Notification 20/2019-CT(R), dated 30 Sept 2019 and effective 1 Oct 2019 [S]. [Taxguru](https://taxguru.in/?p=696690); [Business Standard](https://business-standard.com/article/economy-policy/gst-rate-cut-in-diamond-job-work-to-free-up-rs-1-500-cr-working-capital-119092100384_1.html)
  - The 22 Sept 2025 services restructuring kept it at 1.5% (0.75% CGST plus 0.75% SGST, or 1.5% IGST) [S]. [CA Club India](https://www.caclubindia.com/news/cbic-notifies-major-gst-rate-changes-on-services-effective-september-22-2025-25466.asp); [Axis Bank](https://www.axis.bank.in/blogs/taxation/gst-on-diamonds)
  - Jewellery-making job work by registered job workers is billed separately at 1.5% [S]. [Aditya Birla Capital](https://www.adityabirlacapital.com/abc-of-money/chapter-71-gst-rate-hsn-code-for-diamond-jewellery)
- **Job-work movement rules** [E, background knowledge, not checked this session]:
  - Inputs sent to job workers move under delivery challans and are reported on form ITC-04.
  - Under s.143 CGST, inputs must come back within 1 year (capital goods within 3 years), or they are treated as supplied.
  - For an ERP this means a "metal or stone out to karigar" ledger with due-back dates.
  - Build: M. Today: ERP (vendor pages advertise karigar tracking) and ACC.

**E-invoicing (IRP)**
- **The general mandate** applies from aggregate annual turnover (AATO) of ₹5 crore [S]. [Tally](https://tallysolutions.com/gst/e-invoicing-limit-india/); [Vyapar](https://vyaparapp.in/blog/e-invoicing-applicability-turnover-limit-india/)
- **The 30-day cutoff:** taxpayers with AATO of ₹10 crore or more must report e-invoices to the IRP within 30 days of the invoice date. The IRP rejects late submissions. This took effect on 1 April 2025, under a GSTN advisory of 5 Nov 2024 that lowered the threshold from ₹100 crore [S]. [Maharashtra GST copy of GSTN advisory](https://www.mahagst.gov.in/public/uploads/gstnadvisory/1760531580_293%20Advisory%20Time%20Limit%20for%20Reporting%20e%20Invoice%20on%20the%20IRP%20Portal%20%20Lowering%20of%20Threshold%20to%20AATO%2010%20Crores%20and%20Above.pdf); [KPMG](https://kpmg.com/us/en/taxnewsflash/news/2024/12/tnf-india-new-group-of-taxpayers-required-to-report-invoices-within-30-days.html)
- **A cut to ₹2 crore** has been proposed but is not in force, per one secondary source [S]. [Tally 2026 guide](https://tallysolutions.com/business-guides/e-invoicing-compliance-rules-in-2026/)
- **Build: H.** It needs an IRP API (direct or through a GSP), an IRN and QR on the invoice, cancellation within the IRP window, and a block on invoices nearing the 30-day limit. Today: ACC (Tally) and ERP via a GSP [E].

**E-way bills**
- **Chapter 71 goods are exempt.** Natural or cultured pearls, precious or semi-precious stones, precious metals, and jewellery or goldsmiths' wares appear in the Annexure to Rule 138(14) CGST Rules, so no e-way bill is needed [S]. [IndiaFilings](https://www.indiafilings.com/learn/eway-bill-applicability-for-gold-and-precious-stones); [GSTN advisory via CA Club India](https://www.caclubindia.com/news/gstn-clarifies-e-way-bill-rules-for-precious-metals-stones-under-chapter-71-24527.asp)
- **The Kerala exception:** Kerala requires e-way bills for intra-state movement of Chapter 71 goods other than HSN 7117 (imitation jewellery). GSTN advised on this in February 2025 [S]. [CA Club India](https://www.caclubindia.com/news/gstn-clarifies-e-way-bill-rules-for-precious-metals-stones-under-chapter-71-24527.asp)
  - The nationwide "EWB for Gold" option on the NIC portal has been withdrawn [S]. Same source.
- **Imitation jewellery (HSN 7117)** needs an e-way bill like ordinary goods. One source says the opposite, which looks like an error [S]. Same source.
- **Build: L to M.** It is a state-conditional rule. Today: ACC or the portal by hand [E].

**TCS/TDS and cash limits (Income-tax Act)**
- **Section 269ST:** no person may receive ₹2 lakh or more in cash from one person in a day, for one transaction, or for one event. Under s.271DA the penalty equals the amount received and falls on the receiver. Splitting a payment within a day still counts. In force since 1 April 2017 [S]. [Taxguru](https://taxguru.in/income-tax/rs-2-lakh-cash-transaction-limit-wef-01apr2017-details-examples.html); [Income Tax Dept 271DA](https://www.incometaxindia.gov.in/w/section-271da-8)
  - A 2026 ITAT Delhi ruling deleted a ₹14.96 lakh 271DA penalty against a jeweller. The evidence was a third-party Excel sheet [S]. [Taxguru](https://taxguru.in/?p=1091205)
  - **Build: L** (a hard block or warning per customer per day). Today: MAN or a POS warning [E].
- **Section 206C(1D) TCS on cash sales:** historically 1% on cash sales of bullion above ₹2 lakh and jewellery above ₹5 lakh, from 1 July 2012 [S]. [Zeebiz](https://zeebiz.com/personal-finance/news-tax-collected-at-source-to-be-levied-above-rs-2-lakh-only-if-payment-in-cash-cbdt-3035)
  - In 2017 the government removed sub-sections (1D) and (1E), because s.269ST made large cash receipts unlawful anyway [S]. [Business Standard](https://www.business-standard.com/article/pti-stories/govt-removes-1-tcs-on-cash-purchase-above-rs-2-lakh-117032300963_1.html)
  - The sources are muddled. **Confirm the current Act text.**
- **Section 206C(1H) TCS on sale of goods** above ₹50 lakh was **omitted from 1 April 2025** by the Finance Act 2025, dated 29 March 2025 [S]. [Taxguru FAQ](https://taxguru.in/income-tax/tcs-sale-goods-removed-april-1-2025-faqs.html); [CA Club India](https://www.caclubindia.com/news/reduction-in-compliance-burden-tcs-on-specified-goods-omitted-from-april-2025-24483.asp)
  - TDS under **s.194Q** (the buyer deducts on purchases above ₹50 lakh from one seller) remains, and its carve-out for 206C(1H) cases was removed [S]. [Trilegal](https://trilegal.com/knowledge_repository/trilegal-update-budget-2025-rationalisation-of-tds-and-tcs-provisions/)
  - **Build: M** (per-counterparty cumulative purchase tracking). Today: ACC [E].
- **PAN or Form 60 for jewellery purchases above ₹2 lakh** (Rule 114B) and jeweller reporting under s.285BA could not be confirmed this session [E].
- **New Income-tax Act and Rules:** a draft under the Income-tax Rules 2026 proposes a 7-year retention period for certain businesses. It is a draft [S]. [Taxguru tracker](https://taxguru.in/?p=1078377)
  - Section numbers may change under the new Act [E].

**Hallmarking and HUID (BIS)**
- **Phased rollout** [S]. [BIS milestones press release](https://www.bis.gov.in/wp-content/uploads/2022/09/Press_Release_Milestones_Hallmark_Scheme.pdf); [GJEPC Solitaire](https://gjepc.org/solitaire/?p=28595); [NewsOnAir](https://www.newsonair.gov.in/govt-adds-7-more-districts-in-6th-phase-of-mandatory-gold-hallmarking); [Tribune](https://www.tribuneindia.com/news/business/seven-more-districts-added-in-6th-phase-of-mandatory-hallmarking-of-gold-jewellery/)

  | Phase | Effective | Districts added | Total districts |
  |---|---|---|---|
  | 1 | 2021 | 256 | 256 |
  | 2 | 2022 | 32 | 288 |
  | 3 | 8 Sept 2023 | 55 | 343 |
  | 4 | 5 Nov 2024 | 18 | 361 |
  | 5 | 31 July 2025 | 12 | 373 |
  | 6 | 2 Mar 2026 | 7 | 380 |

- **The HUID-based portal** went live on 1 July 2021 and automates the workflow at assaying and hallmarking centres (AHCs). Jewellers send items to AHCs through the portal. A non-portal route also exists [S]. Search summary of BIS pages incl. [BIS hallmarking-jewellers](https://www.bis.gov.in/hallmarking-jewellers/)
  - Registration is through the National Single Window System (NSWS) or the BIS portal. It is instant, valid for life, and free [S]. Same; [BIS Guidelines for Jewellers (July 2026)](https://www.bis.gov.in/wp-content/uploads/2026/07/Guidelines-for-Jewellers.pdf)
- **Turnover exemption:** jewellers with annual turnover up to ₹40 lakh are outside the mandate but may register voluntarily [S]. [BIS hallmarking-jewellers](https://www.bis.gov.in/hallmarking-jewellers/)
- **Grades:** 9K (375) was added to mandatory hallmarking in 2025, reportedly from 1 July 2025. The grades now are 22K (916), 18K (750), 14K (585) and 9K (375) [S]. [Greater Kashmir](https://m.greaterkashmir.com/article/bis-makes-hallmarking-of-9-karat-gold-mandatory/415593); [NewKerala](https://www.newkerala.com/news/o/bis-makes-hallmarking-karat-gold-mandatory-436)
- **Silver:** HUID-based hallmarking is **voluntary** under IS 2112:2025 (grades 800, 835, 925, among others). BIS expanded the silver HUID ecosystem in August 2026 [S]. [NewsOnAir Aug 2026](https://newsonair.gov.in/bis-expands-hallmark-unique-identification-based-silver-hallmarking-ecosystem/)
- **No public developer API** for the BIS or NSWS portal was found. Vendor pages claim "HUID workflow with BIS portal verification" [S]. [CodingClave guide](https://codingclave.com/guides/best-jewelry-shop-software-india-2026)
  - A 2-gram weight exemption is often quoted but was not confirmed in any result.
- **Build: M** for a 6-character HUID field per piece with uniqueness checks, HUID printed on the invoice, and reconciliation of AHC send and receive. **H** if a live BIS integration becomes possible. Today: ERP for HUID capture; the BIS portal by hand for AHC requests [E].

**PMLA and FIU-IND**
- **Who is covered:** dealers in precious metals and stones (DPMS) become reporting entities when they carry out **cash transactions of ₹10 lakh or more with a customer**, in one operation or in several that appear linked. Notified in December 2020 [S]. [IBJA PMLA FAQ](https://www.ibja.co/Upload/PmlaPdf/Pdf_2650_20230927165317314_PMLA%20FAQ.pdf); [RSM India newsflash](https://www.rsm.global/india/sites/default/files/media/RSM%20India/Publications/2021/rsm_india_newsflash_-_record_of_cash_transactions_in_gems_jewellery_over_and_above_rs._10_lakhs_mandatory_under_pmla.pdf)
- **Duties of a reporting entity** [S]. [FIU-IND dealers user manual](https://fiuindia.gov.in/pdfs/downloads/Guidance_UserManual_Dealers.pdf); [GJC copy, DGA guidelines 04.05.2023](https://gjc.org.in/pdf/04.05.2023_Guidelines_Dealers%20in%20Precious%20Metals%20and%20Precious%20Stones.pdf); [AML-CFT-CPF Guidelines DPMS 29.11.2023](https://gjc.org.in/pdf/AML-CFT-CPF%20Guidelines_DPMS_29.11.2023.pdf)
  - Register on FINGate.
  - Appoint a Principal Officer and a Designated Director.
  - Follow a risk-based approach, under guidelines from the Directorate General of Audit.
- **An older turnover test** (₹2 crore) from 2017 appears superseded [S]. [Business Standard 2017](https://www.business-standard.com/article/markets/money-laundering-norms-stump-jewellery-sector-117082900016_1.html)
- **Build: M to H.** It needs KYC capture, linked-transaction aggregation per customer, CTR and STR data extracts in the FIU-IND reporting format ([format PDF](https://fiuindia.gov.in/pdfs/quicklinks/Reporting_Format.pdf)) [S], and record retention. Today: MAN or a consultant; few ERPs [E].

**Companies Act: books of account, audit trail, retention**
- **Rule 3(1) proviso**, Companies (Accounts) Rules 2014:
  - Accounting software must record an audit trail of every transaction and an edit log of every change with its date, and the trail must not be disabled.
  - It applies from financial years starting **1 April 2023**, after deferrals from 2021 and 2022 (deferred to 2023 by G.S.R. 235(E)).
  - Under **Rule 11(g)** of the Audit and Auditors Rules, the auditor reports whether the feature existed and operated all year.
  - Sources: [S]. [Deloitte](https://www2.deloitte.com/content/dam/Deloitte/in/Documents/risk/in-ra-mandatory-accounting-audit-trail-feature.pdf); [ICAI CA Journal](https://cajournal.icai.org/article-details/audit-trail-requirements-responsibilities); [Taxmann FAQ](https://www.taxmann.com/post/blog/faqs-statutory-auditors-duty-to-report-audit-trails); [Taxguru tracker](https://taxguru.in/?p=1078377)
- **Scope:** only changes to books of account need logging, not every change in the software. Spreadsheets used without accounting software fall outside the rule [S]. [ICAI CA Journal](https://cajournal.icai.org/article-details/audit-trail-requirements-responsibilities)
  - Microsoft documents a specific India "audit trail / edit log" feature in Dynamics 365 Business Central. This is evidence that vendors treat it as a product feature [S]. [Microsoft Learn](https://learn.microsoft.com/fi-fi/dynamics365/business-central/localfunctionality/india/india-audit-trail-edit-logs-accounting-software)
- **Retention:**
  - Section 128(5) requires books and vouchers for at least **8 financial years**.
  - The audit trail is part of the books, so it is kept for 8 years too.
  - The duty survives a software change or a cancelled subscription.
  - Sources: [S]. [Conventus Law](https://conventuslaw.com/report/india-tightening-the-reins-on-book-keeping-recent-amendments-to-the-companies-accounts-rules-2014/); [ICAI CA Journal](https://cajournal.icai.org/article-details/audit-trail-requirements-responsibilities); [Taxguru practitioners guide](https://taxguru.in/company-law/audit-trail-compliance-rule-3-1-rule-11-practitioners-guide.html)
- **Data location (Rule 3(5) proviso, G.S.R. 624(E), 5 Aug 2022):**
  - Backups of electronic books, including any kept abroad, must be on **servers physically in India, daily**.
  - Rule 3(6) requires an annual intimation to the Registrar when books sit on a third-party server.
  - Sources: [S]. [Mondaq](https://webiis10.mondaq.com/india/accounting-standards/1796796/electronic-books-of-accounts-in-india-statutory-location-requirements-and-emerging-compliance-risks); [Taxguru tracker](https://taxguru.in/?p=1078377)
- **Build: H.**
  - An append-only edit log on every ledger-affecting table (who, when, before and after values) that no admin can switch off.
  - An 8-year retention that survives the customer leaving, so an export is needed.
  - A daily backup in an India region.
  - Today: ACC. Tally added an edit log. Microsoft has the feature [S].

**Exports: Kimberley Process, GJEPC, DGFT, SEZ**
- **Kimberley Process:** GJEPC has been India's designated KP importing and exporting authority since **22 Nov 2021**. Traders must be GJEPC members to import or export rough [S]. [FashionNetwork](https://in.fashionnetwork.com/news/Government-gives-gjepc-authority-over-kimberley-process-certification-for-rough-diamond-imports-exports,1356499.html); [GJEPC Solitaire](https://gjepc.org/solitaire/?p=12862)
  - GJEPC runs a KP login portal [S]. [GJEPC KP](https://www.gjepc.org/kp/login.php)
- **Special Notified Zone:** Bharat Diamond Bourse (Mumbai) hosts one, the India Diamond Trading Centre, for rough viewing and sale. Its current operating status is unconfirmed [S]. [Business Standard](https://www.business-standard.com/article/economy-policy/global-diamond-mines-allowed-to-sell-in-india-in-special-zones-115052801269_1.html); [GJEPC Solitaire](https://gjepc.org/solitaire/?p=36357)
- **Diamond Imprest Authorisation (DIA)** [S]. [Taxscan](https://www.taxscan.in/dgft-introduces-diamond-imprest-authorisation-scheme-under-foreign-trade-policy-2023/481566); [A2Z Taxcorp](https://a2ztaxcorp.net/?p=1596); [Taxscan on IGST exemption](https://www.taxscan.in/top-stories/dgft-exempts-diamond-imprest-authorisation-imports-from-igst-duties-compensation-cess-1440045); [Taxscan PN 26/2025-26](https://www.taxscan.in/top-stories/dgft-renumbers-and-updates-provisions-for-diamond-imprest-authorisation-under-handbook-of-procedures-2023-1435108)
  - Created under FTP 2023 by Notification 53/2024-25 of 21 Jan 2025, operational from **1 April 2025**.
  - It allows duty-free import of **natural** cut and polished diamonds of **25 cents (¼ carat) or less each**, including semi-processed, half-cut and broken stones.
  - Export obligation: physical export of natural cut and polished diamonds of 25 cents or less, with 10% value addition.
  - Conditions: Actual User and Pre-Import, plus a bond and a bank guarantee.
  - Applications use ANF 4J.
  - It **excludes lab-grown diamonds**.
  - A later amendment to para 4.63 added IGST and compensation cess exemption.
  - DGFT Public Notice 26/2025-26 (Oct 2025) renumbered the procedures.
- **SEZs:** older GJEPC reports say the KP procedure ran in four SEZs (SEEPZ Mumbai, Surat, Hyderabad, Visakhapatnam). This is dated [S]. [GJEPC annual report via Slideshare](https://www.slideshare.net/DrLendySpires/2014-kpcs-annual-report-india)
- **Build: M** for an authorisation ledger (import quantities and values against export obligation, stone-size and natural-only checks). **H** if stones must be tracked lot by lot through the factory. Today: MAN or consultants plus the DGFT portal [E].

### Inferences
- [E] The heaviest India builds are the IRP e-invoice integration, the Rule 3(1) edit log with India-resident daily backup and 8-year retention, and the job-work and metal ledger. A system of record that also keeps the books inherits the Rule 3(1) duty. One that only keeps stock and pushes vouchers to Tally may not, but it then depends on Tally's edit log.
- [E] The tax line on a single sale can mix 3% (finished jewellery), 1.5% (a loose polished stone or job work) and 0.25% (rough). Rates must therefore be keyed by HSN and nature of supply, not by product family.
- [E] Lab-grown status is a data field that drives GST rate (pending confirmation), DIA eligibility (not eligible), labelling (BIS IS 19469:2025) and G7 scope. It should be a first-class attribute on every stone and lot.
- [E] HUID is a per-piece serial that ties stock to the invoice. The ERP should treat it like a serial number that must be unique and cannot be reused.

### Gaps
- The official CBIC rate notification for lab-grown diamonds (0.25% or 1.5%) was not seen. The sources conflict.
- No BIS or NSWS developer API was found. How software interacts with the BIS portal (manual upload or vendor integration) is unknown.
- Whether s.206C(1D) TCS on cash jewellery or bullion sales still exists is muddled in the sources. Rule 114B (PAN or Form 60 above ₹2 lakh) and s.285BA jeweller reporting were not confirmed.
- How sections are renumbered under the Income-tax Act 2025 and Rules 2026 was not researched.
- The 2-gram hallmarking exemption and other HUID exemptions (exports, Kundan or Polki) were not confirmed.

---

## United States: FinCEN AML (31 CFR 1027), Form 8300, FTC Jewelry Guides, Kimberley Process / CDTA warranties, sales tax nexus, and 2024–2026 changes

### Takeaway
There are four main software-relevant duties:
1. An AML programme for "dealers" above $50,000 a year in covered goods (thresholds [E]; the eCFR page was blocked).
2. Form 8300 within 15 days for cash above $10,000. E-filing has been mandatory since 1 Jan 2024 for filers of 10 or more other information returns.
3. A System of Warranties statement on every B2B diamond invoice, with records kept.
4. Destination-based sales tax with state economic nexus.

Changes in 2024–2026:
- **Russian diamonds:** OFAC's ban phased in at 1.0 carat on 1 March 2024 and 0.5 carat on 1 Sept 2024.
- **Country of mining:** CBP's planned declaration was postponed indefinitely in February 2025.
- **AML programme rewrite:** FinCEN proposed one in April 2026 (comments closed 9 June 2026; no final rule found).
- **Sales tax:** states are dropping the 200-transaction nexus test (Illinois from 1 Jan 2026, Kentucky from 1 Aug 2026).

### Cited Findings

**FinCEN AML programme (31 CFR Part 1027)**
- **Thresholds [E]:** a "dealer" buys more than $50,000 of covered goods and receives more than $50,000 in gross proceeds from their sale in the prior year. Retailers are largely exempt unless they buy more than $50,000 from people other than dealers. The four programme pillars are policies, a compliance officer, training and independent testing.
  - Effective 2005. This is background knowledge only: the eCFR and FinCEN FAQ pages were blocked, so it is unconfirmed.
- **April 2026 proposal:** FinCEN proposed a fundamental rewrite of AML/CFT programme rules, covering dealers in precious metals, stones or jewels.
  - It withdraws the 3 July 2024 proposal.
  - It splits "establishing" a programme from "maintaining" one.
  - Comments closed 9 June 2026, with a 12-month implementation period after a final rule.
  - No final rule was found as of Nov 2026 [S]. [Federal Register 2026-07033](https://www.federalregister.gov/documents/2026/04/10/2026-07033/anti-money-laundering-and-countering-the-financing-of-terrorism-programs); [FinCEN fact sheet](https://www.fincen.gov/system/files/2026-04/Program-NPRM-FactSheet.pdf); [BDO tracker](https://www.bdo.com/insights/advisory/2026-u-s-aml-cft-regulatory-developments-tracker)

**Form 8300 (cash above $10,000)**
- **Deadline:** due within 15 days of the cash transaction [S]. [IRS Form 8300 page](https://www.irs.gov/node/10813)
- **E-filing:** mandatory from **1 Jan 2024** for businesses that file 10 or more other information returns (such as 1099s or W-2s) in the year. The count is re-checked each year, and Forms 8300 do not count toward it. Hardship waivers are available on Form 8508 [S]. [IRS news release](https://irs.gov/newsroom/businesses-must-electronically-file-form-8300-report-of-cash-payments-over-10000-beginning-january-1-2024); [Instructions for Form 8300](https://www.irs.gov/instructions/i8300)
- **Related rules [E], background knowledge not confirmed this session:**
  - Related transactions within 24 hours, or known related within 12 months, are aggregated.
  - Cashier's checks of $10,000 or less count as cash in designated reporting transactions.
  - A written statement goes to the payer by 31 January.
  - Records are kept 5 years.
- **Build: M.** It needs cash aggregation per customer, TIN capture, a form data extract, and a statement letter. Today: MAN or ACC [E].

**FTC Jewelry Guides (16 CFR Part 23)**
- **The July 2018 revision:**
  - Dropped "natural" from the definition of "diamond".
  - Requires clear and conspicuous disclosure of lab-grown origin, using "laboratory-grown", "laboratory-created", "[manufacturer]-created", or "imitation" or "simulated" for simulants.
  - No longer lists "synthetic" as a recommended term.
  - Sources: [S]. [FTC 2019 warning letters press release](https://www.ftc.gov/news-events/news/press-releases/2019/04/ftc-sends-warning-letters-companies-regarding-diamond-ad-disclosures); [JCK](https://www.jckonline.com/editorial-article/ftc-lab-grown-diamond-disclosure/); [National Jeweler](https://nationaljeweler.com/articles/956-a-quick-review-of-the-ftc-s-rules-on-lab-grown-diamonds)
- **Enforcement:** in April 2019 FTC staff sent 8 warning letters (3 to lab-grown sellers, 5 to simulant sellers). The Guides apply to social media. Terms like "cultured" were flagged [S]. Same sources; [JCK on the 8 letters](https://www.jckonline.com/editorial-article/what-ftc-8-warning-letters-said/)
  - No 2024–2026 amendment or new letters were found [S].
- **Build: L.** It needs enforced descriptor fields on product and stone records and listing templates that print the qualifier [E]. Today: by hand in e-commerce copy [E].

**Kimberley Process and Clean Diamond Trade Act**
- **The Act** (Public Law 108-19, 2003) requires US persons importing or exporting rough diamonds to keep a full record of the transactions [S]. [19 USC 3904 via uscode.house.gov](https://uscode.house.gov/us/usc/119-120/t19/s3904/); [PL 108-19 via OFAC](https://ofac.treasury.gov/system/files/126/pl108_19.pdf)
- **The World Diamond Council System of Warranties (SoW):**
  - The warranty statement must appear on B2B invoices and memos each time diamonds change hands.
  - The current wording affirms conflict-free status and adherence to the WDC SoW Guidelines.
  - Each company must keep records of warranty invoices received and issued, and reconcile them.
  - The Act does not itself legislate the SoW wording.
  - Sources: [S]. [WDC FAQ SoW](https://worlddiamondcouncil.org/faqs-sow); [DMCC SoW page](https://dmcc.ae/ecosystems/diamonds/systems-of-warranties); [JCK](https://www.jckonline.com/editorial-article/warranties-diamond-invoices/)
- **Retention period:** a 5-year figure was **not found** in sources this session.
- **Build: L to M.** It needs an invoice-text block and a received-versus-issued reconciliation report by value or carat. Today: ERP (invoice templates); the reconciliation is mostly MAN [E].

**Russian-origin diamonds (US)**
- **The OFAC determination** under E.O. 14068 was issued 8 Feb 2024. It bans import of non-industrial Russian-origin diamonds, including stones cut and polished elsewhere ("substantially transformed"):
  - **1.0 carat and above from 1 March 2024**;
  - **0.5 carat and above from 1 Sept 2024**.
  - Sources: [S]. [Federal Register 2024-04855](https://www.govinfo.gov/content/pkg/FR-2024-03-07/html/2024-04855.htm); [Thompson Hine](https://www.thompsonhine.com/insights/ofac-issues-determinations-to-prohibit-import-of-russian-origin-diamonds); [OFAC FAQ 1164](https://ofac.treasury.gov/faqs/1164)
- **General License 104** authorises certain imports, for example stones outside Russia before the relevant date. One summary says the authorisation runs to 1 Sept 2027 for qualifying diamonds [S]. Same sources. **Confirm the current GL 104 text.**
- **CBP country of mining:** in January 2025 CBP announced a "country of mining" declaration. On **21 Feb 2025** it moved the start date to "TBD".
  - If it returns, CBP says it would apply to loose diamonds only, not jewellery, and not to stones under 0.5 carat or grandfathered stones.
  - No 2026 update was found [S]. [National Jeweler](https://nationaljeweler.com/articles/13695-customs-indefinitely-postpones-requirement-to-disclose-country-of-mining); [JCK](https://www.jckonline.com/editorial-article/country-of-mining-requirement/)

**Sales tax and economic nexus**
- **The standard tests:** after *South Dakota v. Wayfair* (June 2018), most states use $100,000 in sales and/or 200 transactions. Some use $250,000 (Alabama, Mississippi) or $500,000 (California, New York, Texas) [S]. [Avalara](https://www.avalara.com/us/en/blog/2025/06/states-eliminating-economic-nexus-transaction-thresholds); [Sales Tax Institute](https://salestaxinstitute.com/resources/economic-nexus-state-guide)
- **The 200-transaction test is disappearing:**
  - Utah and Alaska removed it in 2025.
  - Illinois from **1 Jan 2026**.
  - Kentucky from **1 Aug 2026**.
  - About 15 jurisdictions still used it in 2026 [S]. [VATCalc Illinois](https://www.vatcalc.com/united-states/us-illinois-end-transaction-nexus-threshold-sales-tax-2026/); [Avalara Kentucky](https://www.avalara.com/blog/en/north-america/2026/04/kentucky-removes-transaction-threshold-taxes-data-brokering-services.html); [TaxCloud](https://taxcloud.com/sales-tax-radar/kentucky-economic-nexus-threshold-change-2026/)
- **Build: M to H.** It needs per-state sales and transaction counters, rate lookup by ship-to address, and exemption certificates for B2B resale. It is normally delegated to Avalara, TaxJar or Shopify Tax. Today: 3P plus ACC [E].
- Jewellery-specific state rules were not found, for example some states' partial bullion or coin exemptions [S].

### Inferences
- [E] US duties are mostly data capture and reporting: customer identity and TIN, cash aggregation, warranty text, disclosure descriptors. They are not API integrations, except sales tax, which is better bought than built.
- [E] For a US wholesaler, the SoW reconciliation (warranties in versus out) and Russian-origin evidence attached to each stone of 0.5 carat or more are the items most likely to be asked for in audits or by customs. They belong on the stone or lot record.

### Gaps
- The exact 31 CFR 1027 definitions and thresholds could not be opened (eCFR and fincen.gov blocked). No final FinCEN programme rule for 2026 was found.
- The SoW and CDTA record-retention period was not confirmed.
- The current GL 104 expiry and any 2026 change in US policy on Russian diamonds was not confirmed.

---

## G7/EU restrictions on Russian-origin diamonds: evidence, thresholds, phase-in, tracing systems, and data-model impact

### Takeaway
The EU ban (Article 3p of Regulation 833/2014, 12th package) covers Russian diamonds and diamond jewellery. Its traceability-based evidence regime reached its final stage on 1 January 2026, after slipping from 1 Sept 2024 and 1 March 2025.

What applies since then:
- Importers of natural rough and polished diamonds of 0.5 carat or more must provide evidence.
- Polished importers file a "Due Diligence Statement on Diamond Origin", backed by documents.
- Rough of 0.5 carat or more is checked in Antwerp, which issues a G7 certificate with a 35-digit ID.
- Mixed origin is no longer accepted on KP certificates.

Using a digital traceability platform such as Tracr or Sarine is reported as **not mandatory**. Platform evidence is optional supporting evidence.

### Cited Findings
- **Scope:** Article 3p covers diamonds of 0.5 carat (0.1 g) and above, including stones polished in third countries. From 1 Sept 2024, all non-industrial natural **and synthetic (lab-grown)** diamonds, rough and polished, of 0.5 carat or more are in scope [S]. [EU Commission FAQ (Dec 2023)](https://finance.ec.europa.eu/system/files/2023-12/faqs-sanctions-russia-diamonds_en.pdf); [Czech Customs copy of EU FAQ 17 Dec 2025](https://celnisprava.gov.cz/cz/Documents/2025-12-17--FAQs-sanctions-Russia-diamonds_en.pdf); [AWDC G7 page](https://www.awdc.be/G7)
  - Lab-grown finished jewellery also falls under the ban [S]. [National Jeweler](https://nationaljeweler.com/articles/12536-lab-grown-diamonds-finished-jewelry-to-fall-under-g7-ban-eu-says)
- **Phase-in and delays:** the G7 moved mandatory traceability for polished imports from 1 March 2025 to **1 January 2026**. AWDC calls 1 Jan 2026 the "fifth and final stage" [S]. [GJEPC](https://gjepc.org/news_detail.php?news=eu-postpones-full-traceability-requirements-for-diamond-imports-to-january-2026); [AWDC news](https://www.awdc.be/news/news/antwerp-diamond-industry-welcomes-postponement-deadline-mandatory-traceability-g7); [Rapaport](https://rapaport.com/news/eu-delays-traceability-rules-requires-specific-mining-origin-on-certs/)
- **Evidence from 1 January 2026:**
  - Polished importers must provide a Due Diligence Statement on Diamond Origin with each shipment.
  - Supporting evidence can include date-stamped transport documents, a date-stamped customs declaration and an invoice, and optionally traceability-system evidence.
  - Scope is natural polished diamonds of 0.5 carat or more.
  - Sources: [S]. [JCK](https://www.jckonline.com/editorial-article/eu-diamond-importers-diligence/); [AWDC EU Import Guidelines, update 1 Jan 2026](https://www.awdc.be/sites/default/files/2025-12/EU%20Import%20Guidelines%20-%20Update%201%20January%202026.pdf)
- **Platforms are not mandatory:** AWDC says there is no obligation to use a digital traceability platform from 1 January 2026 [S]. [AWDC G7/EU FAQ](https://www.awdc.be/g7eu-sanctions-faq); [AWDC update](https://www.awdc.be/update-g7-sixteenth-sanction-package-against-russia)
  - The EU FAQ wording ("fully-fledged traceability system") and AWDC's reading are not fully reconciled in the sources [S].
- **The rough node:**
  - Rough of 0.5 carat or more is verified, including a physical check, in Antwerp. A G7 certificate with a **35-digit number** is cited on the import declaration.
  - Botswana was chosen as a further verification hub.
  - A G7 certificate is issued only for rough of 0.5 carat or more imported through the Diamond Office, and not for synthetic rough.
  - The rough import process has been unchanged since March 2025.
  - Sources: [S]. [EU Commission FAQ](https://finance.ec.europa.eu/system/files/2023-12/faqs-sanctions-russia-diamonds_en.pdf); [AWDC G7](https://www.awdc.be/G7); [Deccan Chronicle](https://www.deccanchronicle.com/business/diamond-exporters-relieved-as-g7-postpones-diamond-traceability-requirement-1863422)
- **Origin on KP certificates:** mixed origin is no longer accepted, and certificates must name a specific mining origin [S]. [Rapaport headline](https://rapaport.com/news/eu-delays-traceability-rules-requires-specific-mining-origin-on-certs/); [AWDC](https://www.awdc.be/G7)
- **Tracing systems:**
  - Tracr (De Beers) registers rough. Sarine verifies the rough-to-polished link. The two firms built a joint solution for G7 entry, framed under the WDC G7 Diamond Protocol [S]. [Rapaport](https://rapaport.com/news/de-beers-sarine-team-up-on-diamond-tracking-solution/); [GJEPC Solitaire](https://gjepc.org/solitaire/?p=23121)
  - GIA agreed to buy 30% of Tracr (announced May 2026). Since 2023, Tracr provenance data has appeared on eligible GIA reports [S]. [IDEX](https://idexonline.com/FullArticle?Id=51242); [JCK 2026](https://www.jckonline.com/article-long/diamond-traceability-in-2026/)
  - Tracr scale: about 2.6 million rough and 400,000 polished stones (undated) [S]. [Rapaport](https://rapaport.com/magazine-article/the-top-diamond-tracking-programs-and-how-they-work/)
  - No official G7 list of "recognised platforms" was found.

### Inferences
- [E] Data model, at the **stone or lot** level:
  - weight, and an in-scope flag (0.5 carat or more);
  - natural or lab-grown;
  - country of mining (specific, never "mixed");
  - KP certificate number(s) and G7 certificate 35-digit ID;
  - import date (for grandfathering and GL 104);
  - a due-diligence statement reference;
  - attached evidence (transport documents, customs declaration, invoice);
  - optional external tracing IDs (Tracr ID, Sarine ID, GIA report number);
  - **parent-child lineage**: one rough stone becomes many polished stones, and many stones are assembled into one piece. Lineage is the hard part.
- [E] **Build: H for full lineage** (splits, merges, re-lots through manufacturing). **M for document capture** at the import and lot level. Today it is mostly MAN, plus the Diamond Office and 3P platforms. Few ERPs model rough-to-polished lineage [E].
- [E] Because platform use is optional, the ERP needs to **store and export evidence packs** for each shipment and lot, and to **link to** platform IDs. It does not need to integrate with any platform to be lawful. Integration is a convenience feature.

### Gaps
- The consolidated Article 3p legal text and any EU change after January 2026 (for example a 19th or 20th package) were not opened. AWDC was blocked.
- Whether the UK, Canada and Japan apply identical 2026 evidence rules was not researched.
- No authoritative list exists of which tracing platforms customs accept.

---

## Diamond hubs: UAE (Dubai/DMCC), Belgium (Antwerp), Hong Kong, Israel, UK — items that change ERP design

### Takeaway
The items that change design are:
- **Cash thresholds** that trigger reporting or registration, so cash must be aggregated per customer and linked transactions detected: AED 55,000 (UAE), HK$120,000 (Hong Kong), €3,000 cash cap (Belgium), €10,000 HVD (UK), about $14,000 report (Israel, dated).
- **The UAE VAT domestic reverse charge** on precious metals and stones between VAT-registered businesses, widened from 25 Feb 2025.
- **Belgian trader registration numbers** and the annual AML report.
- **Hong Kong** Category A/B registration status.

### Cited Findings

**UAE**
- **AML perimeter:** DPMS enter the AML regime for a single or linked **cash** transaction of **AED 55,000 or more**, under Cabinet Resolution 134 of 2025 implementing Federal Decree-Law 10 of 2025 [S]. [AML UAE](https://amluae.com/aml-regulations-for-dpms-in-uae/); [Meydan FZ](https://www.meydanfz.ae/blog/dpms-aml-uae)
- **Reporting:** DPMS Reports (DPMSR) are filed through **goAML** to the UAE FIU. Supervisor: Ministry of Economy (and Tourism). The DPMSR was introduced by Circular 08/AML/2021, effective 12 June 2021 [S]. [AML UAE DPMSR](https://amluae.com/dealers-in-precious-metals-and-stones-report-dpmsr/)
- **Triggers conflict between sources:** for individuals only cash at or above AED 55,000 triggers a report. For companies, cash, exchange-house transfers and international wires may count [S]. [AML UAE checker](https://amluae.com/dpmsr-submission-requirement-checker/)
  - 8,191 DPMS were reportedly registered on goAML by 30 June 2025 (a secondary citation of FIU data) [S]. Same source.
- **VAT reverse charge:**
  - Cabinet Decision 127 of 2024 replaced Decision 25 of 2018, effective **25 Feb 2025**.
  - Scope widened to gold, silver, palladium, platinum, natural **and synthetic** diamonds, pearls, rubies, sapphires and emeralds.
  - It applies where the buyer is VAT-registered and buys for resale or manufacture. Otherwise 5% VAT is charged.
  - Sources: [S]. [UAE MoF](https://mof.gov.ae/en/news/cabinet-issues-decision-no-127-of-2024-on-the-reverse-charge-mechanism-for-precious-metals-and-stones/); [PwC](https://www.pwc.com/m1/en/services/tax/me-tax-legal-news/2025/uae-new-cabinet-decision.html)
- **DMCC designated-zone status for VAT** is unconfirmed. An older report says DMCC was not a designated zone [S]. [Zawya](https://zawya.com/en/business/gold-standards-uae-tax-body-spells-out-vat-treatment-for-gold-and-diamond-traders-f4pd5hd0)
- **Kimberley Process:** DMCC publishes SoW guidance and is the UAE KP office [S]. [DMCC SoW](https://dmcc.ae/ecosystems/diamonds/systems-of-warranties)

**Belgium (Antwerp)**
- **Trader registration:** every Belgian diamond trader must register with the FPS Economy Licensing Service and receives a registration number (distinct from the VAT number). A public register exists [S]. [AWDC registration](https://www.awdc.be/en/node/238); [FPS Economy diamonds](https://economie.fgov.be/en/themes/enterprises/specific-sectors/diamonds/diamonds-administrative)
- **AML duties** [S]. [AWDC AML](https://www.awdc.be/AML); [FPS Economy privacy statement](https://economie.fgov.be/en/themes/enterprises/specific-sectors/diamonds/diamonds-administrative/privacy-statement-supervision)
  - Identify clients, ultimate beneficial owners and (for cash) suppliers **before** the transaction, even when payment is by bank transfer.
  - Respect a **€3,000 cash limit**.
  - File an **annual AML activity report by 31 March** (Royal Decree 2024).
- **Imports and exports** go through the Diamond Office. See the G7 section.

**Hong Kong**
- **The DPMS regime** under the AMLO took effect on **1 April 2023** [S]. [HK Customs](https://www.customs.gov.hk/en/customs-announcement/whats-new/index_id_117.html); [DPMS leaflet](https://www.customs.gov.hk/hcms/filemanager/en/content_177/EN_Leaflet_Local_DPMS.pdf); [Customs press Oct 2026](https://www.info.gov.hk/gia/general/202610/30/P2026103000540.htm)
  - Local dealers must register with Customs to do transactions of **HK$120,000 or more**.
  - Category A registrants may do non-cash transactions only. Category B registrants may also take cash.
  - Non-HK dealers must file a cash transaction report within 1 day.
  - Penalty: up to HK$100,000 and 6 months' imprisonment.
  - Enforcement continued in Oct 2026.

**Israel**
- **Dated rules:** dealers report cash sales above about $14,000. Older reports describe cash caps of NIS 75,000 for retail and NIS 50,000 for dealer-to-dealer. The Diamond Controller supervises. These sources date from 2005 to 2016, and current status is unconfirmed [S]. [Globes](https://en.globes.co.il/en/article-1000064047); [Times of Israel](https://www.timesofisrael.com/in-diamond-business-cash-trust-a-thing-of-the-past/); [Israel NRA 2017](https://www.gov.il/BlobFolder/generalpage/risk-nra/en/periodic-docs_nra_eng_2017.pdf)

**United Kingdom**
- **High-value dealers:** any business that accepts or makes cash payments of **€10,000 or more** (including linked payments) is a high-value dealer and must register with HMRC first. Jewellers are named.
  - Before a high-value cash payment, check that UK counterparties are registered.
  - There is no per-transaction report solely for exceeding €10,000. Suspicious activity reports still apply.
  - Sources: [S]. [GOV.UK HVD registration](https://www.gov.uk/money-laundering-regulations-high-value-dealer-registration); [CMS guide](https://cms.law/en/int/expert-guides/cms-expert-guide-to-lvmh-limits-to-cash-payments/united-kingdom)

### Inferences
- [E] One configurable "cash threshold rule" engine (jurisdiction, currency, threshold, aggregation window, linked-transaction logic, action: block, warn, KYC, or report extract) covers India (₹2 lakh bar, ₹10 lakh PMLA), the US ($10,000 Form 8300), the UAE (AED 55,000), Hong Kong (HK$120,000), Belgium (€3,000 cap) and the UK (€10,000). **Build: M.** Today: mostly MAN [E].
- [E] UAE reverse charge means the VAT treatment depends on the **buyer's** VAT registration and purpose, so the ERP needs a buyer-status check per invoice. **Build: L to M.** Today: ACC (Tally UAE has a guide page) [S]. [Tally UAE](https://tallysolutions.com/mena/uae-vat/new-vat-rule-gold-diamond-business-uae/)
- [E] Counterparty master data should carry jurisdiction registration IDs: Belgian diamond-trader number, HK DPMS category, UK HVD registration, India GSTIN, PAN, BIS registration and GJEPC membership, UAE TRN and goAML status.

### Gaps
- No UAE primary text (Cabinet Resolution 134/2025) was read. DMCC designated-zone status was not confirmed. Dubai Diamond Exchange rules were not researched.
- The legal basis and scope of Belgium's €3,000 cash limit was not confirmed from FPS Economy.
- No current Israeli rules from 2024–2026 were found.
- UK reverse charge or margin VAT schemes for second-hand jewellery were not researched.

---

## Precious-metal regulation affecting software: UK/EU hallmarking and Convention marks, US stamping laws, purity tolerances

### Takeaway
The rules differ by market:
- **UK:** compulsory hallmarking above set weight thresholds (gold 1.0 g, silver 7.78 g, platinum 0.5 g, palladium 1.0 g). Dealers must show the Dealer's Notice (the 2019 version, compulsory since 1 May 2020). Convention marks (the Common Control Mark, CCM) are accepted with sponsor and assay office marks.
- **US:** there is no assay hallmarking. The National Gold and Silver Stamping Act allows a gold fineness shortfall of 3 parts per thousand (7 with solder, per a trade guide). Sterling must be at least 925, with a 4 per thousand tolerance if there is no solder. A registered trademark must accompany any quality mark.

For an ERP, this means piece-level metal weight by metal, fineness, mark and assay status fields, and an exemption check by weight.

### Cited Findings
- **UK exemption weights:** gold 1.0 g, silver 7.78 g, platinum 0.5 g, palladium 1.0 g. For mixed metals, the threshold of the most precious metal applies [S]. [Assay Office London Dealer's Notice 2025](https://assayofficelondon.co.uk/media/3205/london-dealers-notice-2025-a4.pdf); [Hallmarking guidance notes](https://assets.publishing.service.gov.uk/media/63a333b9d3bf7f37654767e0/hallmarking-guidance-notes.pdf)
  - Sources differ on whether base metal counts toward the weight [S]. [BHC internet-sales guidance](https://assets.publishing.service.gov.uk/media/5a75a95f40f0b67f59fcea09/BHC-guidance-selling-articles-of-precious-metal-on-the-internet.pdf)
- **The Dealer's Notice:** released Sept 2019, compulsory from **1 May 2020**. Failing to display it is an offence. Online sellers need a digital equivalent. An online notice was published Feb 2026 [S]. [Digital Dealers Notice](https://gov.uk/government/publications/hallmarking-awareness-and-learning-online-halo-award-2022/digital-dealers-notice-text-only); [Assay Office online notice 2026](https://www.theassayoffice.co.uk/wp-content/uploads/2026/02/online-dealers-notice.pdf)
- **Convention marks:** international hallmarks must include the CCM scales, and CCM articles also need the sponsor's mark and the assay office mark [S]. Same sources.
- **EU hallmarking** is not harmonised. Each member state has its own regime, and many recognise Convention marks [E]. Not researched this session.
- **US stamping:**
  - Gold may fall short of the stamped fineness by at most 3 parts per thousand, and 7 per thousand with solder (a trade-guide figure).
  - Sterling must be at least 925, with a 4 per thousand tolerance if there is no solder.
  - A federally registered trademark must accompany a quality mark.
  - Mixed metals must show both, for example "Sterling 14k".
  - Sources: [S]. [MJSA](https://cms.mjsa.org/publications/compliance-guides/marking-stamping-regulations); [16 CFR 23.10 (Cornell LII)](https://www.law.cornell.edu/cfr/text/16/23.10); [15 USC 296 (govinfo)](https://www.govinfo.gov/link/uscode/15/296); [JVC guide](https://www.ganoksin.com/ftp/JVC_guide.pdf)
- **India** hallmark grades are in the India section: 22K, 18K, 14K, 9K, plus silver grades under IS 2112.

### Inferences
- [E] Per piece, record:
  - metal components (metal, fineness or karat, net weight each);
  - the hallmark set (sponsor, assay office, CCM, HUID);
  - assay status and an exemption-by-weight flag;
  - in the US, the trademark on file.
- [E] **Build: L to M.** Today: ERP fields with weight capture. Assay office submissions are by hand [E].

### Gaps
- EU member-state hallmarking regimes and current Hallmarking Convention membership were not researched.
- The US half-karat (1/2 karat) tolerance and the exact statutory solder tolerance figures were not confirmed from statute.

---

## Lab-grown disclosure and grading-report requirements in major markets

### Takeaway
- **US:** the FTC (2018 Guides) requires a clear qualifier: "laboratory-grown", "laboratory-created" or "[manufacturer]-created".
- **India:** BIS **IS 19469:2025** sets terminology.
  - Only "laboratory-grown diamond" or "laboratory-created diamond" may be used.
  - Abbreviations ("lab grown", "lab-created", "lab diamond", "LGD") and terms like "fake" or "artificial" are disallowed.
  - A brand name alone is insufficient.
  - Treatments must be disclosed.
  - Only a natural diamond may be called simply a "diamond".
- **CCPA:** consultations ran in Nov 2024. Final CCPA guidelines were not confirmed.
- **EU:** lab-grown stones are within Russian-sanctions scope.

No market was found to make a grading report legally mandatory. Reports are commercial practice.

### Cited Findings
- **BIS IS 19469:2025:**
  - Allowed terms: "laboratory-grown diamond" and "laboratory-created diamond".
  - Disallowed: "lab grown", "lab created", "lab diamond", "LGD", "fake", "artificial".
  - Brand name alone is insufficient disclosure.
  - Treatments must be disclosed.
  - Sources: [S]. [GJEPC Solitaire](https://gjepc.org/solitaire/?p=34524); [Outlook Luxe](https://luxe.outlookindia.com/watches-jewellery/jewellery/indias-new-diamond-rule-only-a-natural-diamond-can-be-called-a-diamond); [Entrepreneur India](https://india.entrepreneur.com/business-news/bis-new-diamond-rule-is-a-reset-not-a-roadblock-lgd-brands)
  - Whether IS 19469 is mandatory (under a Quality Control Order) or voluntary was not confirmed [E].
- **CCPA consultation:** held 19 Nov 2024. Bans on "natural" or "genuine" for lab-grown stones were proposed [S]. [PIB](https://pib.gov.in/PressReleasePage.aspx?PRID=2074564); [Business Standard](https://business-standard.com/industry/news/ccpa-to-bring-out-guidelines-for-diamond-sector-in-consumer-interest-124111901186_1.html)
- **GJEPC** said the Indian trade would follow FTC-approved terminology [S]. [National Jeweler](https://nationaljeweler.com/articles/13460-gjepc-says-indian-trade-will-use-ftc-approved-terminology-for-lab-grown-diamonds)
- **US FTC:** see the US section [S].
- **EU and G7:** lab-grown stones of 0.5 carat or more are in sanctions scope from 1 Sept 2024. Rough synthetic stones get no G7 certificate at the Diamond Office [S]. [AWDC](https://www.awdc.be/G7)
- **GIA and Tracr:** GIA reports can carry Tracr provenance. This is commercial, not legal [S]. [JCK 2026](https://www.jckonline.com/article-long/diamond-traceability-in-2026/)

### Inferences
- [E] Store, per stone:
  - an **origin type** (natural, laboratory-grown, simulant) and a **growth method** (HPHT or CVD, required in India per older guidance cited by National Jeweler [S]);
  - treatments;
  - grading lab and report number.
- [E] Generate market-specific display names from those fields, so that "lab diamond" is never typed by hand. **Build: L.** Today: by hand in listings [E].

### Gaps
- UK, EU, UAE and Hong Kong consumer-law rules on lab-grown terminology (for example ISO 18323 or CIBJO Blue Book adoption) were not researched.
- Whether India's IS 19469 is enforced through a Quality Control Order was not confirmed.

---

## Where each item is handled today: inside jewelry ERPs, separate accounting packages, or by hand

### Takeaway
Indian jewellery ERPs and Tally's jewellery edition advertise GST billing, e-invoicing, karigar (job-work) tracking, purity and tag stock, and HUID capture. The legally heavy accounting duties, such as the Rule 3(1) edit log, books retention, and TDS under s.194Q, usually sit in the accounting package. AML/KYC reporting, DGFT authorisation ledgers, the System of Warranties reconciliation and G7 origin evidence are mostly handled by hand or on third-party platforms. That is the gap a system of record could fill. No independent reviews were found. Feature claims are from vendors.

### Cited Findings
- **TallyPrime (jewellery)** advertises karigar and job-work management, purity tracking, tag-based stock and e-invoicing [S]. [Tally jewellery](https://tallysolutions.com/accounting-software/jewellery/); [Tally inventory](https://tallysolutions.com/inventory-management-software/jewellery/)
- **Indian jewellery ERPs:**
  - Jwelly: e-invoice, auto TDS/TCS, hallmark.
  - Marg ERP: karigar management.
  - Jewell Master: karigar jobs and GST reporting.
  - Wingold Next: manufacturing GST, bill of materials, job work.
  - Vendor guides say HUID capture at the point of sale is standard, and some claim BIS portal verification.
  - Sources: [S]. [GimBooks](https://www.gimbooks.com/blog/best-jewellery-billing-software/); [CodingClave](https://codingclave.com/guides/best-jewelry-shop-software-india-2026); [Marg](https://margcompusoft.com/m/jewellery-billing-management-2026-complete-guide-to-boost-profits/); [SoftwareSuggest](https://www.softwaresuggest.com/jewell-master)
- **No evidence was found** of a dedicated fine-gold metal-account ledger with karigar-level reconciliation in the search extracts [S]. Same.
- **Microsoft Dynamics 365 BC** has an India audit trail and edit log feature [S]. [Microsoft Learn](https://learn.microsoft.com/fi-fi/dynamics365/business-central/localfunctionality/india/india-audit-trail-edit-logs-accounting-software)

### Inferences
Summary checklist. Build ratings and who handles it today are [E].

| # | Jurisdiction | Requirement | Threshold / who | Effective | Build | Today |
|---|---|---|---|---|---|---|
| 1 | IN | GST rates by HSN (3% / 1.5% / 0.25%; job work 1.5%) | All GST-registered | 2017; C&P 1.5% from 18 Jul 2022; job work 1.5% from 1 Oct 2019 | L | ERP + ACC |
| 2 | IN | IRP e-invoice; 30-day cutoff | AATO ₹5 cr+; cutoff at ₹10 cr+ | Cutoff from 1 Apr 2025 | H | ACC / GSP |
| 3 | IN | E-way bill (mostly exempt for Chapter 71; Kerala intra-state required) | Kerala intra-state | Feb 2025 advisory | L | MAN |
| 4 | IN | Job-work challans, ITC-04, 1-year return [E] | Principals sending to karigars | 2017 | M | ERP partly |
| 5 | IN | s.269ST ₹2 lakh cash bar | Every receiver | 1 Apr 2017 | L | MAN / POS |
| 6 | IN | s.194Q TDS; 206C(1H) TCS removed | Purchases above ₹50 lakh per seller | 206C(1H) removed 1 Apr 2025 | M | ACC |
| 7 | IN | HUID per piece; AHC workflow | Gold, 380 districts, turnover above ₹40 lakh; 9K added | Phases 2021–2 Mar 2026 | M (H with an API) | ERP + portal by hand |
| 8 | IN | PMLA reporting entity: KYC, CTR/STR, FINGate | Cash of ₹10 lakh+ with a customer | Dec 2020; guidelines 2023 | M–H | MAN |
| 9 | IN | Rule 3(1) edit log; 8-year retention; daily backup in India | All companies using accounting software | FY from 1 Apr 2023; backup rule Aug 2022 | H | ACC |
| 10 | IN | KP via GJEPC; DIA ledger (natural, ≤25 cents) | Rough traders; DIA holders | KP 22 Nov 2021; DIA 1 Apr 2025 | M | MAN / 3P |
| 11 | US | AML programme (31 CFR 1027) [E thresholds]; 2026 rewrite proposed | Dealers above $50,000 a year [E] | 2005; NPRM Apr 2026 | M | MAN |
| 12 | US | Form 8300; mandatory e-file | Cash above $10,000; 10+ other information returns | E-file from 1 Jan 2024 | M | MAN / ACC |
| 13 | US | FTC lab-grown disclosure | All marketers | Jul 2018 | L | MAN |
| 14 | US | SoW statement on invoices; records reconciled | B2B diamond trade | WDC SoW (updated) | L–M | ERP templates; MAN reconciliation |
| 15 | US | Russian-origin ban; CBP country of mining on hold | Stones 1.0 ct+ then 0.5 ct+ | 1 Mar 2024 / 1 Sept 2024; CBP TBD from Feb 2025 | M | MAN |
| 16 | US | Sales tax nexus | $100k (and/or 200 transactions in some states) | Wayfair 2018; IL 1 Jan 2026; KY 1 Aug 2026 | M–H (buy) | 3P |
| 17 | EU/G7 | Due diligence statement; evidence pack; G7 certificate ID; specific mining origin | Natural and lab-grown 0.5 ct+ | Final stage 1 Jan 2026 | M (H for lineage) | MAN / 3P |
| 18 | UAE | DPMSR via goAML; VAT reverse charge | AED 55,000 cash; VAT-registered buyers | DPMSR 2021; reverse charge widened 25 Feb 2025 | M | MAN / ACC |
| 19 | BE | Trader registration; €3,000 cash cap; annual AML report | All Belgian diamond traders | Report due 31 Mar yearly | L–M | MAN |
| 20 | HK | DPMS registration (Category A/B); cash transaction report | HK$120,000 | 1 Apr 2023 | L–M | MAN |
| 21 | UK | HVD registration; hallmarking; Dealer's Notice | €10,000 cash; weight thresholds | Notice 1 May 2020 | L | MAN |
| 22 | IN/US/global | Lab-grown terminology (IS 19469:2025, FTC) | All sellers | 2025 / 2018 | L | MAN |

- [E] The hard, defensible items to build are rows 2, 9, 8 and 17: the IRP integration, the immutable edit log with retention, AML aggregation and extracts, and stone lineage with origin evidence. Most other items are fields, rules and templates.

### Gaps
- No independent comparison of jewellery ERP compliance coverage was found. All feature claims are vendor marketing.
- How QuickBooks and Xero handle US Form 8300 or Indian jewellery-specific GST was not researched.
- Every claim here is [S] or [E]. Before anything is relied on for a product commitment, the official pages should be opened. The blocked hosts (awdc.be, ecfr.gov, fincen.gov, irs.gov, ftc.gov, bis.gov.in, gov.uk, rapaport.com) would need to be allowed in network settings.
