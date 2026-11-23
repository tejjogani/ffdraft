# 02 — Production package: what manufacturers ask for and use (Nov 2026)

**Research limits.** This pass ran on web search only: direct page fetches were blocked by the session network allowlist, and the search budget ran out after about 50 queries. Figures below come from search extracts of the linked pages, not from reading the full pages. Items marked *(unverified)* had no usable source in this pass. Most thresholds are one vendor's guideline, not an industry standard, so every one must be user-editable per manufacturer profile.

## 1. What goes in a jewelry tech pack / manufacturing order

No single standard template exists. Public "custom request" forms cover only metal, ring size and stones; none found combine customer-supplied stones, plating, quantity and CAD files. The union below is assembled from OEM guides ([Silverbene](https://blog.silverbene.com/?p=605), [Alibaba OEM guide](https://seller.alibaba.com/blogs/2026/southeast-asia/jewelry-design/oem-customization-moq-design-guide-alibaba-b2b), [Hong Factory, Thailand](https://www.hongfactory.com/oem-jewelry-manufacturing-complete-guide-for-brands/), [Sourcify](https://sourcify.com/?p=11212)), retailer QA specs ([Amazon jewelry QA](https://amzsupport.freshdesk.com/support/solutions/articles/47001059031-jewelry-quality-assurance-standards)) and US casting/CAD services ([Stuller CAD/CAM](https://www.stuller.com/cadcam-services), [Kaprielian](https://www.kaprielian.com/print-and-cast), [Gildform](https://gildform.com/faq)).

| Section | Fields | Evidence / typical values |
|---|---|---|
| Header | SKU, style name, revision number and date, designer contact, approval status | Versioned revisions are general tech-pack practice; one Chinese OEM page says it files a mold ID and CAD file per design (search extract) |
| Drawings | Orthographic views with mm dimensions: ring size, band width and thickness, pendant H×W, chain length, hoop diameter, stone sizes | [Silverbene](https://blog.silverbene.com/?p=605); H×W in mm plus target grams and construction method ([Makers Row](https://makersrow.com/?p=51747)) |
| Metal | Alloy, karat/fineness, colour, construction (cast, die-struck, hollow), target weight and tolerance | Amazon asks for minimum metal weight within 5%, all components included ([Amazon](https://amzsupport.freshdesk.com/support/solutions/articles/47001059031-jewelry-quality-assurance-standards)) |
| Size | Ring size with system (US/UK/EU), size run, tolerance | +1/4 / −1/8 size ([Amazon](https://amzsupport.freshdesk.com/support/solutions/articles/47001059031-jewelry-quality-assurance-standards)) |
| Stones | Per line: type, natural/lab/simulant, shape, cut, mm, ct, quantity, colour/clarity, setting type, who supplies, certificate | Setting method per SKU (sourcing guides, e.g. [Sourcify](https://sourcify.com/?p=11212)); stones must match in colour and size ([AAFES spec](https://webarchive.library.unt.edu/web/20120928171008/http://www.shopmyexchange.com/DoingBusiness/QualityAssurance/jewelry/jewelrySpecs.htm)) |
| Finish | Per surface: high polish, satin, matte, sandblast, hammered, antique; reference photo | Finish reference photos requested (sourcing guides, e.g. [Sourcify](https://sourcify.com/?p=11212)) |
| Plating | Metal, karat/colour, thickness in µm, base layers, e-coat, test method | Gold 0.5–1.0 µm fashion, 1.0–2.5 demi-fine, ≥2.5 vermeil; rhodium 0.1–0.2 µm on silver; verify by XRF ([Sourcify](https://sourcify.com/?p=11212)). "18K gold color" with no thickness is ambiguous ([Xuping](https://www.htnxt.com/supplier/Guangdong-Xuping-Jewelry-Co.,-Ltd./page/Decoding-Fashion-Jewelry-Specs:-How-Production-Process-Impacts-Quality.html)) |
| Marks | Fineness stamp, maker/sponsor mark, logo, engraving text, font, size, location | One custom-order form limits stamps to symbols or letters "larger than 3 mm" (search extract); see §5 |
| Findings | Chain type and length, clasp, posts/backs, jump rings, hinges | Weight must include backs, posts, chains ([Amazon](https://amzsupport.freshdesk.com/support/solutions/articles/47001059031-jewelry-quality-assurance-standards)) |
| Commercial | Quantity, MOQ, target cost, sample plan, lead time, packaging | CAD stage 5–10 days, fee USD 50–200 ([Alibaba guides](https://seller.alibaba.com/blogs/2026/southeast-asia/jewelry-design/oem-customization-moq-design-guide-alibaba-b2b)); Thai OEM vendor pages claim MOQ about 10–20 pcs per design, samples 7–14 days, bulk 25–35 days (vendor claims, search extracts) |
| QC | Dimensional tolerance, weight range, plating test, stone security, sample approval | CAD approval is not sample approval (Bangkok vendor page); supplier-side guides quote ring ID ±0.05 mm ([Alibaba tolerances](https://seller.alibaba.com/blogs/2026/southeast-asia/fashion-jewelry/precision-tolerance-quality-control-guide-alibaba-b2b)) |

Region-specific templates for Jaipur, Surat, Mumbai, Panyu and Italy were not found; treat the table as the superset and let a manufacturer profile hide fields.

## 2. Files manufacturers accept

| Service | Formats | Stated requirements |
|---|---|---|
| [Kaprielian](https://www.kaprielian.com/print-and-cast) (US) | STL preferred, 3DM | Watertight, production-ready; paid clean-up otherwise |
| [Cooksongold](https://www.cooksongold.com/precious-metal-casting/design-guidelines) (UK) | STL | Watertight, no naked or non-manifold edges; ≤50 MB; no sprues (priced on STL volume); no hollow pieces; max 30×50×70 mm; caster applies shrink scaling |
| [Stuller](https://stuller.com/benchjeweler/resources/bencharticles/view/design-create-sell-cad-cam-services) (US) | CAD upload | Quote and render within 24 h; will not cast altered waxes — changes go back into CAD |
| [Gildform](https://support.gildform.com/how-do-i-upload-my-own-3d-model-for-production) (US) | STL, OBJ (+3MF, PLY, glTF on some pages) | ≥1 mm walls; $35 inspection per outside file ([FAQ](https://gildform.com/faq)) |
| [Shapeways](https://support.shapeways.com/hc/en-nl/articles/17001579812252-What-are-the-upload-limitations) | STL, OBJ, 3MF, STEP, DAE, X3D, WRL | 64 MB (one page says 100 MB), 1 M polygons, manifold, correct normals |
| [Materialise](https://www.materialise.com/en/academy/industrial/design-am/silver) | STL, 3DM, OBJ, 3DS, WRL | Export fine enough that facets are invisible |

- **STL (binary, mm) is the universal casting input; 3DM is the editable companion.** STEP and 3MF are accepted only by general bureaus. JewelCAD `.jcd` opens only in JewelCAD and has no Rhino import, so it is not worth targeting ([FileInfo](https://fileinfo.com/extension/jcd), [McNeel forum](https://discourse.mcneel.com/t/how-to-open-a-jewelcad-file-in-rhino/40871)).
- **Mesh density.** Rhino stores no export settings in the STL, so record them ([McNeel](https://discourse.mcneel.com/t/see-the-settings-a-stl-file-was-created-with/90547)). A jewellery workflow cites 0.01 mm max edge-to-surface distance ([Shapeways forum](https://www.shapeways.com/forum/t/starting-jewelry-design-journey.98473/)).
- **Units.** STL carries none; state mm in the manifest and filename. Scale errors are a known support topic ([Gildform](https://support.gildform.com/im-having-issues-with-scale.-help)).
- **Stones, one-file-per-part, naming** *(unverified)*: no caster rule found. Proposed convention is in Decisions.

## 3. Process and design-for-manufacture rules

CAD → printed pattern → sprue/tree → invest and burn out → cast → cut and clean → set → polish/plate → QC.

**Pattern printers.**

| Printer | Resolution | Source |
|---|---|---|
| Formlabs Form 4 (Castable Wax, Castable Wax 40, True Cast) | 50 µm XY; layers from 25 µm; Wax 40 prints at 25/50 µm | [Formlabs specs](https://formlabs.com/3d-printers/tech-specs/), [Wax 40 guide](https://formlabs.com/support/Using-Castable-Wax-40-Resin/) |
| Solidscape S300 series (wax) | Layers about 6–51 µm | [S300 sheet](https://www.multistation.com/voy_content/uploads/2021/04/s300-series-product-sheet-updated.pdf) |
| 3D Systems ProJet MJP 2500W Plus (wax) | 16 µm layers, 1200×1200×1600 dpi | [3D Systems](https://www.3dsystems.com/3d-printers/projet-mjp-2500-plus) |
| Asiga MAX X | 27, 35 or 43 µm pixel | [Asiga](https://myaccount.asiga.com/media/public/2020/docs/Asiga%20for%20Jewelry_us_en.pdf) |
| B9 Core 530 | 30 µm XY | [B9 sheet](https://cdn.shopify.com/s/files/1/0770/7928/1977/files/B9Core_530.pdf) |
| EnvisionTEC/ETEC D4K Pro Jewellery | 50 µm XY (reseller listing) | [iMakr](https://imakr.com/eu/home/3493-envisiontec-d4k-pro-jewellery) |

Rapid Shape figures were not found. Wire filigree needs high green-strength resin; Wax 40 and True Cast are not recommended for it ([Formlabs](https://formlabs.com/white-papers/introduction-to-casting-for-3d-printed-jewelry-patterns/)).

**Design rules.**

| Rule | Value | Source |
|---|---|---|
| Structural wall | ≥0.8 mm; ring band ≥1.0 mm | [Cooksongold](https://www.cooksongold.com/precious-metal-casting/design-guidelines), [Materialise gold](https://i.materialise.com/materials/gold/design-guide), [Gildform](https://support.gildform.com/what-are-the-design-requirement-for-3d-modeling) |
| Print floor | 0.3 mm unreliable, 0.5 mm distorts, 0.75 mm good | [Formlabs paper](https://formlabs-media.formlabs.com/rs/060-UIG-504/images/Jewelry-3D-Printing-Basic-Design-Parameters-Supports-Orientation.pdf) |
| Claws, small bezels | ≥0.5 mm; long unsupported prongs ≥0.8 mm | [Cooksongold](https://www.cooksongold.com/precious-metal-casting/design-guidelines), [Materialise](https://i.materialise.com/materials/gold/design-guide) |
| Pinpoint prong / bezel wall / channel wall | ≥0.45 / ≥0.45 / ≥0.40 mm | [Stuller standards (mirror)](https://cdn.hackaday.io/files/1657037089437152/CADCAMProductionStandards.pdf) |
| Beads | 0.4–0.5 mm, about 70% visible | Stuller, same |
| Scrollwork / openings | ≥0.5 mm / ≥0.4 mm (smaller openings fill in) | Stuller, same |
| Pavé border | ≥0.50 mm | [GIA](https://gia.edu/design-with-melee) |
| Stone seat | Cut with gem cutter at 98% girdle scale; bench burs about 90% of stone diameter | Stuller; [Ganoksin](https://ganoksin.com/article/step-step-guide-single-row-pave-settings) |
| Recessed text | Width ≥0.30–0.35 mm, depth ≤0.50 mm, spacing ≥0.30 mm, depth:width ≤1:1 | [Cooksongold CAD tips](https://www.cooksongold.com/blog/learn/top-tips-for-the-perfect-cad-design), [Shapeways gold](https://shapeways.com/materials/gold), [Materialise](https://i.materialise.com/materials/gold/design-guide) |
| Raised text | ≥0.30 mm thick (Shapeways 0.4), ≤0.60 mm high | Same |
| Part clearance | ≥0.3 mm | [Shapeways gold](https://shapeways.com/materials/gold) |
| Polishing loss | 0.1 mm (Cooksongold), 0.1–0.15 mm (Materialise), up to 0.2 mm (Stuller) | [Cooksongold tips](https://www.cooksongold.com/blog/learn/top-design-tips-for-our-precious-metal-casting-service/), [Materialise forum](https://i.materialise.com/forum/t/lost-wax-casting-tolerances/1712) |
| Hollows | Shell ≥0.7 mm; escape holes 4 mm ×1 or 2 mm ×2+; some casters refuse hollows | [Formlabs](https://formlabs.com/support/Using-Castable-Wax-Resin/), [Shapeways gold](https://shapeways.com/materials/gold), Cooksongold |
| Sprues | Do not model them for bureaus. In-house: thickest section, feed 70–150% of attachment cross-section | Cooksongold; [Ganoksin](https://www.ganoksin.com/article/sprue-system-design/), Formlabs |
| As-cast tolerance | ±5%, floor ±0.15–0.35 mm | [Materialise forum](https://i.materialise.com/forum/t/lost-wax-casting-tolerances/1712) |

**Shrinkage.** No reliable per-metal table was found. Direct cast is about 1% ([Ganoksin](https://www.ganoksin.com/article/tips-avoiding-meltdown/)); Shapeways states about 1–1.5% casting and about 3% after finishing for platinum ([Shapeways](https://www.shapeways.com/materials/platinum)); 5–6% when a vulcanised rubber mould is in the chain (Ganoksin); castable resins add their own drift, forum reports 2.5–10% ([Formlabs forum](https://forum.formlabs.com/t/coping-with-shrinkage-in-castable-wax-40/36241)). **Bureaus compensate themselves** (Cooksongold), so the designer sends nominal geometry and declares that.

**Direct metal.** Cooksongold's precious-metal printing guide keeps the 0.8 mm wall rule ([Cooksongold](https://www.cooksongold.com/3dprinting/design-guidelines)). Generic laser powder-bed minimum feature width is about 0.6–0.9 mm ([3DPrint](https://3dprint.com/237866/design-guidelines-for-direct-metal-laser-sintering-selective-laser-melting-laser-powder-bed-fusion/)). Legor runs support-free binder jetting in silver, bronze, gold and platinum ([Metal AM](https://www.metal-am.com/legor-introduces-3d-metal-jet-printing-service-aimed-at-jewellery-fashion-and-industrial-sectors/)). It is niche; treat it as a profile, not a default.

## 4. Costing

Bureaus quote from the file: Gildform prices from model data against the live metals market ([Gildform](https://support.gildform.com/once-i-upload-my-3d-file-how-does-gildform-determine-the-price)); Kaprielian itemises material, casting fee, finishing and volume discount ([Kaprielian](https://www.kaprielian.com/print-and-cast)); Indian jewellers use weight × rate + wastage + making charges + stones + 3% GST ([Ujjivan](https://www.ujjivansfb.bank.in/banking-blogs/gold-loan/how-gold-price-is-calculated-by-jewellers), [BlueStone](https://blog.bluestone.com/how-to-calculate-the-cost-of-your-gold-jewellery-at-home/)).

```
metal_g     = volume_cm3 × density_g_cm3
metal_cost  = metal_g × (1 + loss_pct) × spot_per_g × fineness × (1 + alloy_premium_pct)
setting     = Σ stones[i].qty × rate[setting_type]
stones_cost = Σ qty × ct × price_per_ct          (0 if customer-supplied)
labour      = cad_fee/qty + print_fee + casting_fee + finish_hours × hourly_rate + plating_fee + assay_fee
cost        = (metal_cost + stones_cost + setting + labour) × (1 + overhead_pct)
price       = cost × (1 + margin_pct) × (1 + tax_pct)
```

| Rate | Starting default (all editable) | Source |
|---|---|---|
| Density g/cm³ | 14K yellow 13.07, 18K yellow 15.58, sterling 10.3–10.46, Pt950 20.15–20.76 (varies by alloy recipe) | [Palloys](https://www.palloys.com/resources/technicalGuides/specificGravities), [Romanoff](https://romanoff.com/help-info/how-to/casting/wax-weight-metal-weight.html) |
| Loss | 3–7% production; India "wastage" 5–15% | [Dojo](https://dojobusiness.com/blogs/news/jewelry-store-material-costs-estimation), [Airtel](https://www.airtel.in/blog/gold-loan/how-to-calculate-making-charges-on-gold/) |
| Alloy premium | About 15% for 14K grain, 18–20% via contract caster (older article) | [Ganoksin](https://www.ganoksin.com/article/changing-metals-market-pricing/) |
| CAD fee | USD 50–200 | [Alibaba](https://seller.alibaba.com/blogs/2026/southeast-asia/jewelry-design/oem-customization-moq-design-guide-alibaba-b2b) |
| Print fee | From USD 31.50 | [Hoover & Strong](https://www.hooverandstrong.com) (search extract) |
| Setting, per stone | Trade pavé USD 5–8; USD 20 generic; USD 35 pavé with layout (dated forum and Geller figures) | [Ganoksin](https://orchid.ganoksin.com/t/pricing-for-micro-pave/48566), [JCK](https://www.jckonline.com/?p=40943) |
| Bench labour | USD 30–100/h | [Jewellery Business](https://jewellerybusiness.com/features/going-custom-the-road-to-success/print) |
| BIS hallmark fee | ₹75 per gold article, ₹35 silver (2026) | [News On Air](https://newsonair.gov.in/bis-raises-hallmarking-charges-for-gold-articles/) |

Current trade setting and casting rate cards were not found; ship defaults as clearly labelled placeholders.

**Live prices.** [MetalpriceAPI](https://metalpriceapi.com/) (XAU/XAG/XPT/XPD, 100 free requests a month), [Metals-API](https://metals-api.com/), [MetalCharts](https://metalcharts.org/api-pricing) (claims commercial use on the free tier), [API Ninjas](https://api-ninjas.com/api/metalsprice) (free tier is non-commercial and daily close). LBMA benchmark prices need an ICE Benchmark Administration licence for any commercial use, including pricing ([LBMA](https://www.lbma.org.uk/articles/lbma-benchmark-prices-data-tables-are-moving), [IBA](https://www.ice.com/iba/licensing)). Pavé should take a user-supplied API key or a manual price, store the timestamp and source, and never bundle LBMA data.

## 5. Standards the spec sheet should capture

| Regime | Capture | Source |
|---|---|---|
| UK Hallmarking Act 1973 | Hallmark required above 1 g gold, 7.78 g silver, 0.5 g platinum, 1 g palladium; sponsor's mark, fineness, assay office; minimum fineness Au 375, Ag 800, Pt 850, Pd 500 | [GOV.UK](https://www.gov.uk/government/publications/hallmarking-guidance-notes/hallmarking-is-the-law-guidance-summary) |
| India BIS | 6-character HUID per gold article; mandatory caratages now include 9K; silver hallmarking voluntary but HUID compulsory when hallmarked (from 1 Sep 2025) | [LKS](https://lakshmisri.com/insights/articles/hallmarking-scheme-of-bis-safeguarding-the-purity-of-precious-metals), [Greater Kashmir](https://m.greaterkashmir.com/article/bis-makes-hallmarking-of-9-karat-gold-mandatory/415593), [Business Today](https://www.businesstoday.in/personal-finance/investment/story/silver-jewellery-gets-safer-govt-makes-huid-compulsory-for-hallmarked-silver-boosting-transparency-consumer-trust-505408-2025-12-06) |
| US stamping law | Tolerances: gold 3‰ (7‰ assayed with solder), silver 4‰. Trademark beside the quality mark *(unverified)* | [15 USC 295–297](https://www.govinfo.gov/link/uscode/15/297) |
| US FTC Jewelry Guides | Vermeil = ≥2.5 µm of ≥10K gold on sterling; lab-grown stones described as "laboratory-grown/-created" or "[maker]-created"; "cultured" only with such a qualifier | [Jewelers Mutual](https://www.jewelersmutual.com/resources/individuals/gold/vermeil-vs-gold-filled-vs-gold-plated), [FTC](https://www.ftc.gov/business-guidance/resources/loupe-advertising-diamond-gemstones-pearls), [National Jeweler](https://nationaljeweler.com/majors/public-policy/6836-8-key-changes-the-ftc-made-to-the-jewelry-guides) |
| Vienna Convention | Common Control Mark + sponsor + assay office marks accepted across contracting states; national minimum fineness still applies | [Hallmarking Convention](https://hallmarkingconvention.org/en/about) |
| EU REACH entry 27 | Nickel release ≤0.5 µg/cm²/week skin contact, ≤0.2 for piercing posts; test EN 1811:2023. Lead and cadmium limits *(unverified this pass)* | [EUR-Lex](https://eur-lex.europa.eu/eli/C/2023/1604/oj/eng/pdf), [TÜV SÜD](https://www.tuvsud.com/en/e-ssentials-newsletter/consumer-products-and-retail-essentials/e-ssentials-9-2023/eu-ec-adopted-en-1811-2023-for-nickel-release-reach-annex-xvii-restriction) |
| Diamonds | Kimberley Process / WDC System of Warranties statement on every B2B diamond invoice; RJC 2024 COP and CoC in force since 1 Jan 2025 | [RJC training](https://www.responsiblejewellery.com/wp-content/uploads/27-KPCS-and-SoW-Training-1.pdf), [RJC](https://www.responsiblejewellery.com/code-of-practices/) |

## 6. Existing software and the gap

| Tool | What it does for this step |
|---|---|
| Excel/PDF spec sheets, Rhino layouts | The default; hand-made, no validation |
| [MatrixGold 4.0](https://blog.stuller.com/press-release/gemvision-releases-matrixgold-4-0/) (May 2026) | Redesigned Tech Report with production data, gem map, material list; desktop, tied to Stuller |
| [RhinoArtisan](https://rhinoartisan.com/jewelry-prototyping/) | Thickness-for-casting analysis and "Smart Conversion"; argues "print-ready" files still need manual fixing |
| [PIRO Fusion](https://www.gopiro.com/jewelry-casting-management) | ERP: job bags, BOM, formula pricing, casting-loss tracking; starts after the design is done |
| [Valigara](https://help.valigara.com/support/solutions/articles/17000124994-pricing-tools-in-valigara) | PIM with formula pricing and gold price feeds; no geometry |
| [Centric PLM](https://www.centricsoftware.com/fashion-apparel/jewelry-accessories-brands), [WFX](https://www.worldfashionexchange.com/blog/jewelry-brands-using-wfx-plm/) | Apparel-derived PLM used by jewellery brands |
| Gildform, Shapeways, Cooksongold, Kaprielian | Upload portals with instant quotes and automatic mesh checks, locked to one maker |

Jewel360, JewelCloud, Atelier, Gembridge, Techpacker, CadCamNYC and RPD were not researched before the search budget ran out. **Gap:** nothing found turns one model into a manufacturer-neutral package — dimensioned drawings, metal-only casting meshes, BOM and stone list, DFM report against a chosen maker's rules, transparent cost, compliance fields and a ready RFQ.

## Decisions for Pavé

**Production Package** — one zip, `<sku>_r<rev>_production/`:

| Path | Content |
|---|---|
| `manifest.json` | Schema version, SKU, revision, units `mm`, `shrinkage_compensated: false`, mesh tolerance, per-part volume / triangle count / SHA-256, alloy density and computed weight, manufacturer profile, price source and timestamp |
| `spec-sheet.pdf` | Human-readable sheet, sections below |
| `drawings/{front,top,side,iso,section}.svg` | Orthographic views, mm dimensions, stone callouts keyed to `stones.csv`, stamp location |
| `cad/<sku>_<part>_<alloy>_<size>.stl` | Binary, mm, metal only, seats cut, one watertight shell per castable part, no sprues |
| `cad/<sku>_stones_REFERENCE.stl` | Stones only; never printed |
| `cad/<sku>.3dm`, `cad/<sku>.step` | Editable assembly with layers `metal/<part>`, `stones`, `cutters`; optional `.3mf` |
| `bom.csv` | Part, alloy, fineness, volume, weight, quantity, finish, plating, findings |
| `stones.csv` | ID, type, origin (natural/lab), shape, cut, L×W×D mm, ct, qty, colour, clarity, setting, supplier, certificate |
| `cost-estimate.json` | Formula inputs, rates, line items |
| `dfm-report.json` | Each check: status, value, threshold, location |
| `renders/*.png`, `rfq-email.md` | Hero and turntable stills; draft RFQ text |

**Spec-sheet sections:** header and revision; views; metal (alloy, fineness, colour, target weight ±5%); size (system, run, +1/4 / −1/8); stones; finish map; plating (µm, layers, XRF); marks and engraving; findings; quantity, MOQ, target cost, lead time; QC criteria; compliance (market, hallmark regime, fineness mark, nickel, lab-grown wording, warranty statement); packaging; notes.

**DFM checks** (defaults; override per manufacturer profile):

| Check | Error | Warn |
|---|---|---|
| Mesh closed, manifold, normals outward, single shell per part | Any failure | — |
| Units and bounding box | Outside profile envelope (e.g. 30×50×70 mm) | Any dimension <2.4 mm |
| File size / triangles | >50 MB or >1 M | — |
| Wall thickness | <0.5 mm | <0.8 mm; ring shank <1.0 mm |
| Prong / claw diameter | <0.45 mm | <0.5 mm; <0.8 mm if length >3× diameter |
| Bezel wall / channel wall | <0.45 / <0.40 mm | — |
| Bead diameter | Outside 0.4–0.5 mm | — |
| Pavé border | — | <0.5 mm |
| Opening or slot width | <0.3 mm | <0.4 mm |
| Recessed text | Width <0.3 mm or depth >0.5 mm | Depth:width >1:1 |
| Raised text | Width <0.3 mm | Height >0.6 mm |
| Polish allowance | — | High-polish wall <1.0 mm (0.1–0.2 mm loss) |
| Stone seat fit | Seat ≥ stone diameter, or stone collides with metal | Seat outside 90–98% of girdle |
| Hollow part | No escape hole | Shell <0.7 mm; hole <2 mm |
| Shrinkage flag | Manifest flag missing | Model scaled when profile says caster compensates |
| Weight | — | Outside target ±5% |
| Hallmark | — | Above UK weight threshold with no mark location |
| Plating claim | "Vermeil" with <2.5 µm or base not sterling | Thickness unspecified |
