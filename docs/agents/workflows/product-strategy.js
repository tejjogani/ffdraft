export const meta = {
  name: 'product-strategy',
  description: 'Deep analysis of the business: customer reality, ERP landscape, commerce loop, competitors, Diaex synergy → three competing strategies → skeptical judges → one recommended strategy and pilot plan',
  phases: [
    { title: 'Research', detail: 'five parallel researchers on market, ERP, commerce loop, competition, Diaex synergy' },
    { title: 'Strategize', detail: 'three independent strategists argue competing theses' },
    { title: 'Judge', detail: 'investor, jeweler-operator and marketplace lenses attack each strategy' },
    { title: 'Synthesize', detail: 'one recommendation, written to docs/strategy and docs/research' },
  ],
}

const CONTEXT = `
## Who is asking and what exists
The founder/CEO owns two products:
1. **Diaex** ("thediaex") — a B2B marketplace to source diamonds/stones (suppliers' stock feeds, search by exact mm/carat/grades, matched pairs/sets/layouts, carts and sourcing orders, KYC'd trade buyers). Its backend repo is at \`/home/user/diaex-backend\` (READ-ONLY for you — never modify it; its docs/ and knowledge/ folders describe the business, users, suppliers, the ASKA relationship, stock templates and feeds, matching, sourcing workflows, order assistant, WhatsApp/voice channels). Eventually precious metal (gold/silver/platinum) is to be sourced through Diaex too.
2. **Pavé** (working name) — an open-source, AI-native jewelry design suite under construction at \`/home/user/ffdraft\` (read \`docs/ARCHITECTURE.md\`, \`docs/research/*.md\` — especially 07-sourcing.md (Diaex integration plan), 08-channels.md (Etsy/Shopify/feeds/public API research), 02-production.md, 06-freeform.md — and \`docs/plans/*.md\`, especially publishing.md). What it does or will do: Ideate (reference search + AI concepts) → Spec (assistant agrees a plan) → **parametric CAD** (real, editable; rings to iced-out pendants; an assistant that edits the CAD by tools — e.g. "make the band thinner", "swap to rose gold", "change the stone to a 2 ct oval" — and looks at its own result) → **photoreal renders/animations** (Blender; variants such as a different metal or stone colour from the same CAD) → on-model images with a synthetic brand model → **stone sourcing** (every CAD stone is structured data → matched to purchasable Diaex inventory, cart for the whole design) → **production package** for a caster/manufacturer (drawings, STL/STEP, BOM, costing, manufacturability) → **publish** (selected renders + product data to Etsy/Shopify/feeds/API). Organisations, roles, usage metering, traces of every human and AI edit. Desktop + web.

## What the CEO asked (verbatim intent)
"As a B2B CEO I would like a deep analysis of what the core proposition is **outside the design and renders**. Use cases on my mind: *I have X stones, I need jewelry ideas.* *I need to send jewelry to Etsy, and have their orders updated on my side.* *How does it stay in sync with my ERP?* If we do the Etsy API, this needs to be connected to an existing ERP, or BE the ERP for someone who doesn't have one, or let you migrate — I'm not sure what the best use case is. What is the business value of this sort of product? I just want to get **my dad** to use it and then see how it goes. Having the sourcing vertical for stones, plus jewelry design, plus exporting/listing is huge — especially if we can migrate ERPs as well — and building a jewelry **website from the ERP** — a one-stop shop. Even things like changing stone colour from the CAD and getting renders, or asking the assistant in the CAD view to do those things, is huge: AI-driven CAD editing for jewelry. This is all to be analysed, deeply researched, and then we plan."
The first intended user is the founder's father, who is in the stone/jewelry trade (infer his likely profile from the Diaex repo's docs — e.g. a diamond/stone wholesaler or manufacturer with inventory and trade relationships — and state your inference and its uncertainty explicitly).
Today is 2026-11-24.
`

const RESEARCH_RULES = `
Method: read the local repositories first (they are primary sources about this business), then use WebSearch / web fetches. This sandbox blocks many hosts and the search budget is shared with other agents, so spend searches on the highest-value facts (pricing pages, market sizes, API capabilities, competitor positioning) and rely on expert knowledge elsewhere; mark each claim as [verified: source], [search extract], or [expert judgement] and give confidence. Do NOT write any file; your return value IS the deliverable: dense markdown, ~1200–1700 words, tables where useful, ending with "What this means for the strategy" (5–8 bullets, opinionated). Be concrete and numerate: prices, fees, time, headcount, margins, counts. Avoid generic SaaS platitudes; write for a CEO who knows the diamond trade.`

const TOPICS = [
  {
    key: 'customers',
    prompt: `**Customer reality and jobs-to-be-done.** Segment the people who would pay for this: (a) stone holders moving downstream — diamond/gem wholesalers, cutters, lab-grown producers and memo dealers who have inventory and want finished-jewelry revenue ("I have X stones, I need jewelry ideas") — likely the founder's father; (b) independent bench/custom jewelers and small studios; (c) online-first small brands selling on Etsy / Shopify / Instagram, largely made-to-order; (d) hip-hop / custom-piece jewelers; (e) retail stores with a custom-design counter; (f) contract manufacturers / casting houses serving them. For each: how they work today end to end (who does CAD — in-house, freelancer, the manufacturer; typical cost and turnaround of a CAD model, a render set, product photography; how they list products; how they track stones, metal, jobs and orders — which tools), where money and time leak (remakes, slow quotes, dead stock of stones, unsold finished inventory, listing labour, photography, miscommunication with the caster), what they would pay for and how they buy software (price sensitivity, who decides, trial behaviour, trust), and the size of each segment (number of businesses, e.g. Etsy jewelry sellers, US/India/Thailand/Italy custom jewelers, diamond wholesalers) with sources. Then the job statements in priority order with the evidence for each, and which single segment is the best beachhead for a founder who already owns a stone marketplace. Include the economics of **render-first / made-to-order "virtual inventory"**: listing designs that do not exist yet, and what conversion, return and trust issues arise.`,
  },
  {
    key: 'erp',
    prompt: `**Jewelry ERP / inventory / PLM landscape and the "integrate vs be vs migrate" question.** Map what jewelry businesses use as their system of record, by size: spreadsheets + QuickBooks/Xero/Tally + Shopify/Etsy admin (micro), jewelry retail POS/ERP (The Edge, Jewel360, Jewelry Shop Manager/similar), manufacturing/wholesale ERP and PLM (PIRO, Valigara, JewelMate, Ishal/Indian jewellery ERPs such as Synergics/Ornate/Acme Infinity, Gemone/diamond ERPs, GemCloud-like stone inventory tools, RapNet/VDB inventory management, Atelier-style production + storefront tools), general ERPs (NetSuite/Odoo/Zoho) with jewelry add-ons. For each notable product: target customer, core modules (items/SKUs, stones incl. memo/consignment and certificates, metal accounts and loss, job/work orders and WIP by karigar/bench, repairs, purchasing, customers, invoicing, multi-location, barcoding/RFID), pricing, **APIs / import-export** capabilities, known lock-in and satisfaction, and how they connect to Etsy/Shopify/marketplaces today. Then answer rigorously: (1) What is the minimal **data model** a jewelry system of record needs, and how much of it does Pavé already have as a by-product of CAD (BOM, stones, metal weight, cost, SKU/variants, media)? (2) Integrate-with-existing vs be-the-lightweight-record vs migrate-from: feasibility, cost, risk, time-to-value and defensibility of each, per segment; which ERPs are worth a connector and which can only be reached by CSV/Excel import; what a credible **migration** (import items, stones, customers, open jobs from spreadsheets/exports) involves and how AI can do the mapping. (3) Where does "ERP" become a trap (accounting, payroll, tax, POS, compliance) — draw the line of what to never build. (4) How order and stock sync should work conceptually when a customer DOES have an ERP (system-of-record rules, conflict policy, idempotent sync, webhooks vs polling) and when they don't.`,
  },
  {
    key: 'commerce',
    prompt: `**The commerce loop: listing → order → sourcing → production → fulfilment, and "website from the catalogue".** Using \`/home/user/ffdraft/docs/research/08-channels.md\` and \`docs/plans/publishing.md\` as the starting point (do not repeat them; extend and stress-test them): (1) the end-to-end flow for a made-to-order jeweler selling on Etsy/Shopify — what happens operationally after an order (confirm options/ring size/engraving, allocate or buy the stone, order casting, set, QC, ship, update tracking, handle changes/returns) and exactly which steps Pavé + Diaex could automate or pre-fill (stone reservation on order, auto-generated production package for that variant, purchase list, status pushed back to the channel, customer-facing progress with renders); (2) Etsy specifics that matter commercially: fees, the photo/AI/handmade policies and their business risk for render-first listings, order/receipt APIs for syncing orders "on my side", what happens with personalisation, made-to-order processing times, and whether Etsy is actually a good channel for fine jewelry vs Shopify/own site/Instagram/wholesale B2B (give numbers where you can: AOV, category size, fee stack); (3) inventory sync models (stocked one-offs vs made-to-order vs stone-backed "virtual inventory" where a listing is backed by a specific available stone in Diaex or the jeweler's own stock — and must unlist when the stone sells); (4) **website from the catalogue/ERP**: the options (generate a Shopify store/theme + sync, a hosted storefront built into Pavé, a headless storefront kit, embeddable product pages/configurator with live 3D), what jewelers pay today for websites (Punchmark, Thinkspace, GemFind/JewelCloud, Shopify experts), build cost and maintenance burden of each option, and what is defensible; a ring configurator (metal/stone/size with live render and price) as a possible killer feature; (5) the B2B side: wholesale line sheets/catalogues for retailers, quote requests, trade portals. Conclude with which parts of the loop create the most measurable value per unit of build effort.`,
  },
  {
    key: 'competition',
    prompt: `**Competition, analogues and business models.** (1) The closest strategic analogue: suppliers that give away or subsidise design software to sell stones/findings/manufacturing — Stuller with CounterSketch/MatrixGold (Gemvision), Overnight Mountings, Quality Gold, Hoover & Strong, on-demand manufacturers with design portals (Gildform, Shapeways jewelry, casting houses), stone marketplaces with jeweler tools (RapNet instant inventory, VDB, Nivoda's storefront/API tools, IDEX) — how the model works, margins, why jewelers adopt it, lessons. (2) AI-native and configurator players in jewelry design/visualisation as of late 2026 (e.g. Blng, Tiara/others, Gemist, Cadonline, Jweel, DiaCam360/Vision360-type imaging, Atelier, "AI jewelry generator" tools; CAD-outsourcing marketplaces such as CadCrowd/Fiverr/Upwork jewelry CAD; render studios) — what each does, pricing, traction signals, weaknesses. (3) Incumbent CAD (MatrixGold, Rhino+plugins, 3Design, JewelCAD) pricing and why small jewelers still outsource CAD. (4) Horizontal threats: generic text/image-to-3D and AI image tools, Shopify's own AI tooling, Etsy's seller tools. Then: a positioning map; where an open-source, AI-native, sourcing-integrated suite is genuinely differentiated; realistic **business models** and price points (SaaS seats/usage, take rate on stones and metal via Diaex, manufacturing/casting margin via partner network, render/AI credits, storefront fees, lead-gen for suppliers) with a rough unit-economics sketch per segment (what a jeweler doing N custom pieces/month is worth via each stream); the open-source question (what stays open, what is the hosted/paid value; how open-core companies in vertical SaaS handle it); and the most credible moats (data: design+trace+sourcing data; network: jewelers ↔ suppliers ↔ manufacturers; workflow lock-in as system of record).`,
  },
  {
    key: 'diaex',
    prompt: `**Diaex synergy and inventory-first design ("I have X stones → what do I make?").** Read \`/home/user/diaex-backend\` thoroughly (README, docs/DIAEX-REFERENCE.md, ASKA-FEEDS.md, SOURCING*.md, DIAMOND-MATCHING.md, STOCK-DEV.md, stock-templates/, WORKBOARD.md, knowledge/*.md, the stone schema in db/schema.sql, app/ for matching, layouts/sets, stock import, carts, sourcing orders, staff/KYC; cite paths) and \`/home/user/ffdraft/docs/research/07-sourcing.md\`. Establish: who Diaex's users and suppliers are, how it makes money today (markup, Pro, memo, etc.), what is live vs gated, what data and engines it already has (supplier stock ingestion with field-mapping templates, exact-mm search, pair/set/layout matching with size estimates, price history, order/assistant workflows, WhatsApp/voice) — and infer the father's likely role and needs, stating uncertainty. Then design the **inventory-first loop** concretely: stock list in (Diaex stock templates / CSV / an existing Diaex supplier account) → the system proposes jewelry that uses those exact stones (single stones → solitaires/pendants/studs; matched pairs → earrings/three-stone sides; parcels of melee → pavé/eternity/tennis/iced pieces; odd shapes and fancy colours → designs that flatter them), ranked by expected sell-through and margin → CAD + renders generated around the actual measured stones → listed (render-first) with each listing **backed by a specific stone or parcel** → on order: stone allocated, production package issued → stone marked sold everywhere. What existing Diaex capabilities map directly onto this (e.g. layouts/sets search = "find me stones for this design"; the inverse = "find me designs for these stones"), what is missing, and how the two products' accounts, organisations, KYC and pricing visibility should relate. Quantify the value for a stone holder: margin uplift from selling finished jewelry vs loose stones, time/cost to create a SKU traditionally vs with this loop, cash tied up, risk. Also assess the flywheel for Diaex as a business (design tool as demand generation: every CAD stone is a purchase intent; take rate potential; supplier-side value of seeing structured demand; "stones nobody lists" as requests), the channel-conflict risks (suppliers competing with their jeweler customers), and what Diaex-side work is on the critical path.`,
  },
]

phase('Research')
const research = await parallel(
  TOPICS.map((t) => () =>
    agent(`You are a senior analyst preparing a board-level strategy analysis.\n${CONTEXT}\n## Your research question\n${t.prompt}\n\n${RESEARCH_RULES}`, {
      label: `research:${t.key}`,
      phase: 'Research',
    }),
  ),
)
const reports = TOPICS.map((t, i) => ({ key: t.key, text: research[i] })).filter((r) => r.text)
log(`${reports.length}/${TOPICS.length} research reports returned`)
const researchText = reports.map((r) => `## Research: ${r.key}\n\n${r.text}`).join('\n\n---\n\n')

const THESES = [
  {
    key: 'flywheel',
    text: 'Thesis A — **the sourcing flywheel**: the design suite is demand generation and workflow lock-in for the stone (and later metal and manufacturing) marketplace, in the way a supplier-subsidised design tool works: software cheap or free, money made on every stone, parcel, gram and casting that flows through. Inventory-first design ("I have X stones") and stone-backed listings are the wedge.',
  },
  {
    key: 'operating-system',
    text: 'Thesis B — **the operating system for the small jeweler**: become the lightweight system of record (catalogue, stones, metal, jobs, orders, channels, storefront) for jewelers who have no ERP, import/migrate those who do, sync with Etsy/Shopify, and generate the website — with AI CAD/renders as the reason to start. Money from subscription per business plus payments/storefront.',
  },
  {
    key: 'ai-studio',
    text: 'Thesis C — **the AI design studio**: win decisively on one thing — conversational, AI-driven CAD editing and instant photoreal variants for custom jewelry (quote faster, close more custom orders, cut CAD/render outsourcing) — and deliberately NOT become an ERP or channel manager; integrate lightly (exports, a public API, deep links to Diaex). Money from seats and usage; sourcing as an optional upsell.',
  },
]

const STRATEGY_OUTPUT = `
Return a strategy memo in markdown (no preamble), ~1100–1500 words, with exactly these sections: 1. **Thesis in one paragraph** · 2. **Who it is for first** (ICP, the father as user zero: what he does in week 1, what would make him keep using it) · 3. **Core value proposition outside design and renders** (the measurable business outcome, in the customer's numbers) · 4. **The ERP answer** (integrate / be / migrate — exactly what, for whom, and where the line is) · 5. **The commerce loop** (Etsy/Shopify/own website: what is built, how orders and stock stay in sync, what is deferred) · 6. **Product sequence** (next 4 weeks, 3 months, 12 months — what to build, and the explicit not-to-build list; tie to what already exists in /home/user/ffdraft) · 7. **Business model and unit economics** (price points, streams, a worked example) · 8. **Risks and what would prove this thesis wrong** (kill criteria) · 9. **The pilot with the father** (a 30-day plan with 3–5 measurable success metrics). Argue your thesis as strongly as honesty allows, using the research; where the research contradicts it, say so and adapt rather than ignore it.`

phase('Strategize')
const memos = await parallel(
  THESES.map((t) => () =>
    agent(
      `You are a strategist arguing one thesis before the CEO.\n${CONTEXT}\nYou may read the repositories (\`/home/user/ffdraft/docs\`, \`/home/user/diaex-backend/docs\`) but must not modify anything.\n\n## Your assigned thesis\n${t.text}\n\n## Research (five analysts)\n${researchText}\n${STRATEGY_OUTPUT}`,
      { label: `strategy:${t.key}`, phase: 'Strategize' },
    ),
  ),
)
const strategies = THESES.map((t, i) => ({ key: t.key, thesis: t.text, memo: memos[i] })).filter((s) => s.memo)
const strategyText = strategies.map((s) => `## Strategy memo: ${s.key}\n${s.thesis}\n\n${s.memo}`).join('\n\n---\n\n')

const VERDICT = {
  type: 'object',
  properties: {
    ranking: { type: 'array', items: { type: 'string' } },
    scores: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          strategy: { type: 'string' },
          score: { type: 'number' },
          strongest: { type: 'string' },
          fatalFlaw: { type: 'string' },
        },
        required: ['strategy', 'score', 'strongest', 'fatalFlaw'],
      },
    },
    weakestAssumptions: { type: 'array', items: { type: 'string' } },
    whatAllThreeMissed: { type: 'array', items: { type: 'string' } },
    recommendation: { type: 'string' },
  },
  required: ['ranking', 'scores', 'weakestAssumptions', 'whatAllThreeMissed', 'recommendation'],
}

const JUDGES = [
  { key: 'investor', text: 'a vertical-SaaS and marketplace investor who has seen design-tool-plus-marketplace plays fail: you care about a sharp ICP, a wedge that is 10× better at one job, distribution, unit economics, defensibility and focus; you punish scope sprawl ("one-stop shop" as a euphemism for no priorities) and unvalidated assumptions.' },
  { key: 'operator', text: 'a second-generation jeweler-manufacturer and diamond dealer who has run a 15-person business with a bench, a casting partner, memo stock and a dusty ERP, and has sold on Etsy and his own site: you care about what actually happens on a Tuesday — trust in weights and prices, stones on memo, remakes, customers changing their minds, who enters the data — and you know what software jewelers abandon after a week.' },
  { key: 'marketplace', text: 'a marketplace strategist focused on Diaex: you care whether this grows stone (and later metal) GMV and take rate, whether suppliers and buyers both win, channel conflict, KYC/pricing-visibility constraints, and whether the Diaex-side work on the critical path is realistic for a small team.' },
]

phase('Judge')
const verdicts = (
  await parallel(
    JUDGES.map((j) => () =>
      agent(
        `You are ${j.text}\n${CONTEXT}\nThree strategists each argued a thesis for where this business should focus. Judge them hard: score each 0–10, name its strongest point and its fatal flaw, list the weakest assumptions across them (the ones that, if false, sink the plan) and what all three missed, and give your own recommendation in ≤150 words (which thesis, or which combination in which order, and the single most important thing to validate with the father in the first 30 days). Default to scepticism; do not reward ambition without evidence.\n\n## Research\n${researchText}\n\n# Strategy memos\n${strategyText}`,
        { label: `judge:${j.key}`, phase: 'Judge', schema: VERDICT },
      ).then((v) => ({ judge: j.key, v })),
    ),
  )
).filter(Boolean)
const verdictText = verdicts
  .map((x) => `### Judge: ${x.judge}\nRanking: ${(x.v.ranking || []).join(' > ')}\n${(x.v.scores || []).map((s) => `- ${s.strategy}: ${s.score}/10 — strongest: ${s.strongest} — fatal flaw: ${s.fatalFlaw}`).join('\n')}\nWeakest assumptions:\n${(x.v.weakestAssumptions || []).map((a) => `- ${a}`).join('\n')}\nMissed by all:\n${(x.v.whatAllThreeMissed || []).map((a) => `- ${a}`).join('\n')}\nRecommendation: ${x.v.recommendation}`)
  .join('\n\n')

phase('Synthesize')
const final = await agent(
  `You are the chief of staff writing the decision document for the CEO.\n${CONTEXT}\nFive analysts researched the question, three strategists argued competing theses, and three sceptical judges (investor, jeweler-operator, marketplace) attacked them. Read the repositories yourself where needed (\`/home/user/ffdraft/docs\`, \`/home/user/diaex-backend/docs\`; never modify diaex-backend). Now write exactly two files in \`/home/user/ffdraft\` (the only files you may create or modify):\n\n**1. \`docs/research/10-market.md\`** — the consolidated research record in the house style of the other docs/research files (tight, tables, every claim keeping its [verified]/[search extract]/[expert judgement] mark and sources; ~2,500–3,500 words): customers and jobs; ERP landscape and the integrate/be/migrate analysis; the commerce loop; competition and business models; Diaex synergy and inventory-first design; ending with "What we still do not know" (the facts that must be validated with real users, in priority order).\n\n**2. \`docs/strategy/product-strategy.md\`** — the decision document (≤ ~2,400 words, plain language, written for a CEO to act on; lead with the answer). Sections: **The recommendation in five sentences** · **The core proposition outside design and renders** (one sentence, then the three or four measurable outcomes behind it) · **Who it is for first, and why** · **The use cases, judged** — a table of every use case the CEO raised ("I have X stones → jewelry ideas", "list to Etsy and see orders on my side", "stay in sync with my ERP", "be the ERP for those without one", "migrate ERPs", "build a jewelry website from the catalogue", "change stone colour in CAD and get renders / ask the assistant in the CAD view", "source stones and metal through Diaex", "send a production package to a manufacturer") with: value to the customer, value to us, effort given what is already built, risk, and a verdict (now / next / later / never) · **The ERP answer** (precisely: what we are, what we connect to, what we import, what we never build; how order and stock sync works with and without an existing ERP — a short concrete description of the sync rules) · **The Etsy/Shopify/own-site answer** (incl. the honest constraint on render-only Etsy listings) · **How the money works** (streams, price points, a worked example for one customer, and what Diaex gains) · **The 30-day pilot with user zero (the founder's father)** — week by week, what he does, what we measure (3–5 metrics with thresholds), and the decision each outcome leads to · **Roadmap changes** — what this means for the build order in \`docs/ARCHITECTURE.md\` and \`docs/plans/*\` (what moves up, what is cut or deferred; note that the core engine must be tested first, per the CEO) · **Risks and kill criteria** · **Decisions needed from the CEO** (only real ones, each with a recommended answer). Where the judges disagreed, say so and explain the call you made. Be direct about what NOT to do; a one-stop shop is a destination, not a starting point — sequence it.\n\nThen reply with the full text of the sections "The recommendation in five sentences", "The use cases, judged" (the table), "The 30-day pilot" and "Decisions needed from the CEO".\n\n# Research\n${researchText}\n\n# Strategy memos\n${strategyText}\n\n# Judges\n${verdictText}`,
  { label: 'synthesize:strategy', phase: 'Synthesize' },
)

return { final, judges: verdicts.map((x) => ({ judge: x.judge, ranking: x.v.ranking, recommendation: x.v.recommendation })) }
