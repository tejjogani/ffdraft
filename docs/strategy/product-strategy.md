# Product strategy: what Pavé is for, beyond design and renders

_24 November 2026. For the CEO. Evidence and sources: [`docs/research/10-market.md`](../research/10-market.md). Every market figure here is an analyst estimate or an unopened search result; none is measured._

## The recommendation in five sentences

1. Outside design and renders, Pavé's business is **sell-through**: it turns stones (a trader's own, or Diaex's) into priced pieces a buyer can order, and each order into an allocated stone and a factory package, with nothing typed twice.
2. Start with one narrow loop for one kind of customer: a stone house (your father's Aska first) quoting **centre-stone pieces** (solitaire, pendant, studs, three-stone) to trade buyers it already knows, going from a stone to a priced quote in hours.
3. **Do not build an ERP, an ERP migration product or a storefront with checkout, and build no Etsy order sync until real orders exist.** Sit beside the ERP he has, import by file, and use Shopify as the hub when channels come.
4. Spend the first week on a test that needs no new software (ten hand-priced pieces on a PDF, sent by WhatsApp to five of his buyers), because nobody yet knows whether Aska can get finished pieces made or whether anyone orders them from a picture.
5. The one-stop shop is the destination, reached in this order: quote, order-to-job, trade catalogue, Shopify, Etsy, website configurator. Each step is built only after the one before has produced orders.

## The core proposition outside design and renders

**"Turn stones into orders: every stone you hold or can source becomes a priced, picture-ready piece your buyer can order today, and every order arrives with its stone allocated and its factory package attached."**

| Outcome | Today (estimates) | Target |
|---|---|---|
| Request to priced quote (picture, weight, price, stone list) | 3–7 days | Under 24 hours in the pilot; under 2 hours once built |
| Cost to put a new style on offer | $560–1,300 and 2–5 weeks (CAD, sample, photos) | A few dollars and under an hour |
| Gross dollars per stone, sold in a piece instead of loose | $10–60 loose | At least 2× at a trade price. **Unproven** |
| Admin per order | 60–90 minutes of retyping and stone hunting | About 15 minutes |

The record behind this is a by-product: the design already holds the style, variants, bill of materials, weights and cost, which is what an ERP makes a clerk type.

## Who it is for first, and why

**Stone holders moving downstream**: lab-grown traders and cutters whose stock is losing 13–14% a year. It is the only segment where you already hold the scarce input (live stock feeds on Diaex), know the decision-maker and have a channel.

**User zero, inferred from the Diaex repo.** Your father operates Aska (Aska Jewels Inc., USA, and Aska Jewels Pvt Ltd, India): a lab-grown diamond trader and Diaex's seller of record. His stock lives in a vendor ERP (Heera) with no API, which Diaex reads through a read-only bridge; his own stock was about 65–68 stones in July. He is not an engineer. I am confident of that much. I do **not** know whether Aska makes or sells finished jewelry, who would make it, or who would buy it: the repo shows only stone trading.

If he only trades loose stones, he is the supplier and the channel. User zero then becomes one of his jeweler customers, and the pitch is quote speed.

Not first: Etsy micro-sellers (pay $20–80 a month and churn), retail stores (slow buyers), iced-out custom houses (richest accounts, but they need melee, which Diaex lacks).

## The use cases, judged

| Use case | Value to the customer | Value to us | Effort, given what is built | Risk | Verdict |
|---|---|---|---|---|---|
| "I have X stones → jewelry ideas" | High. His stated job; no tool starts from a stock list | High. The direction no competitor occupies | Medium. A rules table (single → solitaire, pair → studs), seats from the measured stone, his rate card | He owns about 70 stones; trade margin unproven | **Now**, centre stones only |
| "List to Etsy and see orders on my side" | Medium for $150–1,500 consumer pieces; low for a trade house | Low. About $1–2k a year per seller | High. Sync engine, Etsy adapter and order ingest are unbuilt | Real-photo rule; fees 9.5–25%; shared API quota | Sync: **Later**. One listing by hand: **Now**, if a shop and a made piece exist |
| "Stay in sync with my ERP" | High once orders exist | Medium. Retention | Low for files and read-only feeds; 3–6 weeks per named connector | Vendors refuse (Heera did); overselling between syncs | **Next**: files and Shopify only |
| "Be the ERP for those without one" | Medium. Their spreadsheet works | Low. Lowest payers, most support | Thin record comes free from the design; a real ERP is years | Scope creep | Thin record: **Next**. Real ERP: **Never** |
| "Migrate ERPs" | Low. Your father will not | Low. A services business | Medium. 3–4 weeks for a mapping tool | Promising a replacement | One-way import: **Next**. Migration product: **Never** |
| "Build a jewelry website from the catalogue" | Medium to high. Jewelers pay $145–475 a month for ring builders | Medium. Add-on revenue | Trade catalogue 2–3 weeks; Shopify 3–5; configurator 6–8; hosted checkout 12–16, then forever | Rebuilding Shopify | Trade catalogue, Shopify: **Next**. Configurator: **Later**. Hosted checkout: **Never** |
| "Change stone colour in CAD and get renders / ask the assistant in the CAD view" | High. Replaces $50–400 and days per CAD round | High. The engine every other row needs | High. The kernel is the most-built part; the assistant package is empty | Edit quality; Pencil ($199 a month) claims the same | **Now**, four templates, tested first |
| "Source stones and metal through Diaex" | Medium. Saves 1–2 days of stone hunting | High in theory, small today: 5% of a $250 stone is $12.50, and Diaex Buy is closed | Links work today; a partner layer is 8–12 Diaex PRs; melee is new supply | Buyers bypass to WhatsApp or Nivoda | Links: **Now**. Match and cart: **Next**. Melee: **Later**. Metal: **Later**, referral only |
| "Send a production package to a manufacturer" | High. Right first time | High. Proves the quote is true | Low. The package exists; never shown to a caster | Cast weight differs from the quote | **Now**. One real cast piece is the acceptance test |

## The ERP answer

**What we are:** the product record and the order relay. Say "design-to-order", never "ERP".

**What we connect to:** Shopify (The Edge, Jewel360, PIRO and Valigara already sync to it, so one connector reaches five systems); spreadsheets in and out; a public API when a customer asks; invoice lines to QuickBooks or Xero. Closed ERPs such as Heera are read-only, through the feed Diaex already has.

**What we import:** stones and styles, one way, as onboarding. The assistant proposes the column mapping, and totals (rows, carats, grams, value) must equal the source.

**What we never build:** ledger, tax, payroll, point of sale, payments, financing, repairs, appraisals, hallmark filing, artisan metal accounts, or writes into Heera.

**Sync rules.** Each field has one owner:

| Field | Customer has an ERP | No ERP |
|---|---|---|
| Design, bill of materials, pictures, listing text | Pavé | Pavé |
| SKU and stock quantity | The ERP; Pavé relays it | Pavé |
| Order | Channel creates, Pavé records, ERP receives | Pavé holds it |
| Loose-stone availability | Diaex | Diaex |

- Every incoming order is stored once before anything acts on it, so a repeat cannot double-count.
- On a stock mismatch the owner wins and the difference is logged.
- The sale of a one-off piece sets every other channel to zero first; made-to-order pieces need no stock sync.
- For your father: read Heera, write nothing. An order goes back as a file or WhatsApp message his staff key in, and overselling is possible for as long as the file interval.

## The Etsy/Shopify/own-site answer

Order of channels: a private trade link with "request a quote", then Shopify (pictures on existing listings first, full listings and stock later), then Etsy. "Website from the catalogue" means a Shopify store filled from Pavé, and later an embeddable configurator that changes the real geometry and reprices.

**The honest Etsy constraint.** Since 22 October 2026 Etsy reportedly requires one unedited photo of the real item on most listings, with renders only as disclosed supplements (not read at source). So Etsy is make-one-then-list: it cannot sell or test a design that has never been made, and we never promise render-only Etsy listings. It takes 9.5%, up to 25% on small ad-driven orders. For a trade house it is an experiment.

## How the money works

All price points are hypotheses to test, not decisions.

| Stream | Price | Collectable today? |
|---|---|---|
| Subscription per business | $49 (one seat) or $149 (three seats, catalogue, orders) | Yes |
| Usage: renders and assistant runs | About 3× our cost, roughly $6 a piece | Yes |
| Fee per order carried through | $5–10 flat | Yes, once orders exist |
| Stones through Diaex | 3–5%, or Aska's markup where Aska is the seller | **No.** Buy is closed |

**Worked example**, a custom jeweler making 15 pieces a month: $149 + $90 usage + $75 order fees = **$314 a month** without Diaex. Once Buy opens, stones add $135–225 (lab-grown centres) or $400–675 (larger stones). The jeweler saves about $1,500 of freelance CAD and 15 hours of admin.

**What Diaex gains:** every CAD stone becomes a purchase request with exact size and grade, unmatched requests become supplier leads, and Pavé orders are the first reason to open Buy. Today it gains nothing, and where Aska is the seller the money is Aska's markup, not a platform fee.

**Where the judges disagreed.** The marketplace judge wants seats charged from day one; the investor wants pricing decided after evidence. My call: do not charge your father or fix the mix yet, but get one unrelated business paying $50 a month or more within 90 days. Prefer flat fees, because falling stone prices shrink a percentage.

## The 30-day pilot with user zero (the founder's father)

You operate the software; he asks by WhatsApp. It is peak season and a made-to-order piece takes 10–15 working days, so the 30-day test is commitment, not delivery.

| When | What he does | What you do |
|---|---|---|
| Days 1–2 | Answers three questions: does Aska sell finished pieces, who makes them, which five buyers. Gives last month's quote count, turnaround and loose-stone margin | Record the baseline. With no maker or no buyers, switch to one of his jeweler customers |
| Week 1 | Picks 10 stones; approves prices; sends one PDF to five buyers | Build ten centre-stone pieces by hand (existing kernel and Blender; a freelancer where it fails). Price at trade level, valid 7 days, ±5% weight |
| Week 2 | Forwards every request | Answer each within 24 hours. Start one physical piece at the named workshop with a real Aska stone |
| Week 3 | Asks for a purchase order or deposit | Run the engine tests on the four templates. If anyone has an Etsy shop, list the made piece by hand |
| Week 4 | Reviews with you | Compare the cast piece with its quote (by day 45 if casting is late). Decide |

| Metric | Pass |
|---|---|
| Demand | At least 2 of 5 buyers commit with a purchase order or deposit |
| Margin | Gross on committed pieces at least 2× the loose-stone gross, after metal, labour and a 5% remake allowance |
| Speed | Median request-to-quote under 24 hours |
| Truth | Cast piece within 5% of quoted weight and cost; no CAD re-done by the workshop |
| Pull | He sends a request unprompted in weeks 3–4; under 2 hours a week of his time |

| Outcome | Decision |
|---|---|
| Demand and margin pass | Build stock-in → quote → trade catalogue → order-to-job for Aska; recruit two paying jewelers from his customers |
| Quotes requested, nobody commits | The gap is trust: make three samples, send them on memo, re-test. Build no catalogue |
| No maker, or no interest | He is the channel. Move the pilot to a jeweler customer and charge them |
| Margin fails at trade prices | Finished pieces to the trade is not his business; test direct-to-consumer on Shopify with a made sample |
| Truth fails | Stop commerce work; fix the engine |

**Where the judges disagreed.** The investor and marketplace judges wanted a commitment as the test; the operator wanted a delivered piece within 5% of its quote. I kept both: commitment at day 30, the delivered piece by day 45.

## Roadmap changes

`docs/ARCHITECTURE.md` says the core engine is finished and tested before breadth features. That stays, and narrows: test the four centre-stone families first, with one cast piece as the final acceptance test.

**Moves up, after the engine pass:**
- Starting from a stone: seats from the real stone's measurements (`07-sourcing.md` §4.4).
- `production.estimate`, the rate card and a quote sheet (publishing build step 1).
- Assistant build steps 1–5 and variant renders, for the four templates only.
- Stock import by spreadsheet.
- A private trade link with "request a quote", then `orders.start` on an accepted quote (pulled from publishing P3).

**Deferred until orders exist:** idea boards; freeform and iced-out pendants; on-model images; the public API, feeds and webhooks; Shopify (first channel when resumed); Etsy sync (last); MCP; sign-in with Diaex.

**Cut:** hosted checkout; listings tied to one named stone; a sell-through prediction model; named ERP connectors.

**Diaex:** nothing for the pilot. Then, in order: Aska's feed live, Buy open for testers with a `src=pave` tag, the partner layer, melee. You review every PR in both repos, so take one Diaex item at a time.

## Risks and kill criteria

| Risk | Kill or change criterion |
|---|---|
| Buyers will not order from a render | Zero commitments after the memo re-test: drop "virtual inventory" for trade; the product is a quoting tool for jewelers |
| The engine is not trustworthy | Under 70% of assistant edits kept on a 50-task benchmark, or a workshop re-does more than 1 package in 5: no commerce work until fixed |
| Nobody unrelated pays | No outside payer at $50 or more within 90 days: stop and rethink the customer |
| Stones do not flow through Diaex | Under 25% of ordered pieces buy stones on Diaex three months after Buy opens: Pavé is a software business |

## Decisions needed from the CEO

1. **Ask your father the three questions this week, and accept that he may not be user zero.** Recommended: yes; if he only trades stones, pilot with one of his jeweler customers.
2. **Approve the positioning and the never-build list** ("design-to-order", no ERP, no migration product, no hosted checkout). Recommended: yes.
3. **Approve the build order:** week 1 by hand before any commerce code; the engine pass narrowed to four centre-stone families; idea boards, freeform and iced-out, on-model images, the public API and Etsy sync deferred. Recommended: yes.
4. **Who sells the finished piece and who pays for a remake?** Recommended: Aska sells, a named workshop makes, 5% remake allowance in the price, quotes valid 7 days. Check duty on India-made finished jewelry first.
5. **What may a quote or trade link reveal?** Diaex shows prices only to verified companies. Recommended: piece price and stone specification, never the stone's line price or supplier.
6. **Separate your father's two roles before any outside jeweler connects.** Recommended: his Pavé organisation uses the Aska company account, not his staff sign-in, and Pavé designs and stone requests are never visible to Diaex staff.
7. **Etsy: does anyone you can reach have an Etsy or Shopify shop today, and can you hand over the local Etsy skill?** I did not find the skill in the Pavé repo or this session's skills folder. Recommended: use it to list one made piece by hand; build no sync until that listing produces orders.
8. **Commit to one unrelated paying customer within 90 days.** Recommended: yes, at $50 a month or more, before choosing the pricing mix.
