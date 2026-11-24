export const meta = {
  name: 'scope-catalog-store',
  description: 'Understand what importing an existing catalogue (3DM files, ERP sheets), handling stock, a hosted store on thediaex.com and developer access (API/FTP) entail — a scoping document, no code',
  phases: [
    { title: 'Understand', detail: 'five readers: prior decisions, Diaex side, import mechanics, ERP landscape, store and developer access' },
    { title: 'Synthesize', detail: 'one scoping document' },
    { title: 'Critique', detail: 'completeness critic, then revise' },
  ],
}

const S = '/tmp/claude-0/-home-user-ffdraft/24192795-28e0-5484-b947-9462017ba677/scratchpad'
const ASK = `
The founder (a B2B CEO; owns Diaex, a marketplace for sourcing stones, and is building Pavé, open-source AI-native jewelry design software, in /home/user/ffdraft) wrote:

"On an additional thing, how can one import their current catalog including 3dm files, sheets etc from ERP to our platform and we can let them deploy a website through us - goes on thediaex.com/store/users store.
What im getting at is, design your stones, cleanly handle ERP / stock, and migrate it if you want to or we can still give you FTP / api for your developers to get images and such per jewelry. First understand what this ask entails"

Earlier, on the same theme: "If we allow for ETSY api this needs to be connected to an existing ERP or be one for someone who doesn't have one - or allow you to migrate... I just want to get my dad to use it and then see how it goes... Having the sourcing vertical for stones and jewelry design and exporting it is huge, especially if we can migrate ERPs as well. And build Jewelry website from ERP - one stop shop."

The job now is ONLY to understand what the ask entails — not to plan a build and not to write code.
`
const CTX = `${ASK}
Ground rules: read docs/ARCHITECTURE.md in /home/user/ffdraft first. Do not edit any code. /home/user/diaex-backend is READ-ONLY (never modify it, never run anything that writes there, never print secrets from it). Scratch files only under ${S}/scope-store/<your key>/. The machine is shared: nothing heavy, leave nothing running. Many web hosts are blocked here; say what you could not reach and mark unverified claims as unverified. Return dense findings with file paths or sources; no padding.
`

phase('Understand')
const READERS = [
  { key: 'prior-decisions', prompt: `Read docs/strategy/product-strategy.md, docs/research/10-market.md, docs/research/08-channels.md, docs/plans/publishing.md and docs/research/07-sourcing.md in /home/user/ffdraft. Extract everything already decided or recommended that bears on this ask: the core proposition, the "never build" list (ERP, migration product, hosted checkout — quote the exact wording and the reasons), the publishing layer (public media URLs, catalogue API with keys, webhooks, feeds, adapters), the pilot with the founder's father. Then say precisely where the new ask agrees with, extends, or contradicts those positions, and which of the earlier reasons still hold if the scope is "import a catalogue + show it in a store + let developers fetch it" rather than "be an ERP".` },
  { key: 'diaex-side', prompt: `Read /home/user/diaex-backend (READ-ONLY): AGENTS.md, docs/ARCHITECTURE.md, docs/TYPES.md, the web app under web/, accounts/auth, browse, deployment docs (e.g. docs/RENDER-DEV.md), db/schema.sql. Answer: what would hosting a seller's store at thediaex.com/store/<store> entail on the Diaex side — routing and rendering in the existing web stack, who a "store owner" is in Diaex's account model, public (signed-out) pages and SEO in a currently signed-in B2B console, the look rules (flat B2B look vs redesign), how stones in a piece would link to live Diaex inventory, what Diaex's process rules require (plan first, small PRs, two work streams), and what it cannot do today (jewelry, not only diamonds; payments; public pages). Also: which domain is which (console.thediaex.com vs thediaex.com) as far as the repo shows. Finish with the cleanest division of labour between Pavé (source of catalogue data, media, 3D) and Diaex (host of the store pages), and the interface between them.` },
  { key: 'import-mechanics', prompt: `Work out what importing an existing jewelry catalogue technically involves for Pavé, by reading the code in /home/user/ffdraft and by small experiments in the scratchpad (rhino3dm is already a dependency of packages/kernel; you may write tiny scripts there that create and read .3dm files).
1. 3DM: what rhino3dm can read without Rhino — meshes, breps (are render meshes present or must the brep be meshed; can rhino3dm mesh a brep at all?), extrusions, SubD, block definitions and instances (how gem libraries are usually stored), layers, object names, user strings, units, materials. What jewelry CAD tools write (Rhino, MatrixGold, RhinoGold, JewelCAD .jcd, ZBrush, 3Design) and which of those we can open. What we can derive automatically from an imported model: dimensions, closed-volume metal weight per layer, stone detection and counting (instances, layer names, recognising cut geometry), a thumbnail and renders through the existing render layer, manufacturability checks, a production package. What we cannot: parametric editing — and what "editable enough" could mean (swap stones, change metal, resize by scale, add engraving).
2. How an imported item fits Pavé's data model today (pieces, design documents with meshBody, assets) and what is missing for a CATALOGUE: style vs variant (metal, size, stone options) vs stock unit, SKU, price, availability, collections, media sets, certificates.
3. Spreadsheets and ERP exports: messy headers, units, free-text stone descriptions ("0.50ct RD G VS2 + 24 melee 0.12tcw"), multiple sheets, images embedded or referenced by filename; column mapping assisted by a model with a human confirming; validation; dry run; idempotent re-import and keys; matching CAD files and images to rows by SKU/filename; duplicates; partial failures and a report.
4. Volume and cost: a catalogue of 200, 5,000 and 50,000 SKUs — storage, processing time per 3DM, thumbnails/renders, what must be queued.
Return a capability-by-capability table: what it is, what exists in the repo (file paths), what is new, how hard (S/M/L/XL), and the unknowns.` },
  { key: 'erp-landscape', prompt: `Research (web search and fetch) how jewelry businesses hold catalogue and stock data today and what "cleanly handle ERP / stock, and migrate it if you want to" would really mean.
- The systems: jewelry ERP/POS/inventory products used by manufacturers, wholesalers and retailers in India, the US and elsewhere (names, who uses them, cloud or desktop), and the very common case of Excel/Tally/WhatsApp. For each family: what can be exported (CSV/Excel reports, database access, APIs, scheduled file drops), and how images and CAD files are stored relative to SKUs.
- The data model those systems share: style/design number, SKU/variant, serialised stock item with barcode/RFID, lot stones vs certified stones, metal accounts and gold rate, making charges and wastage, memo/consignment/approval, job work with karigars, hallmarking, multiple locations. Which of these a catalogue-plus-store needs, and which make something an ERP.
- What "stock" minimally means for selling online: made-to-order vs ready stock, quantity vs one-of-a-kind serialised pieces, reservation when an enquiry or order arrives, price that moves with the gold rate and stone prices.
- Sync patterns that work with such systems: one-time import, scheduled file drop over SFTP, API pull, the store as the source of truth for some fields and the ERP for others; who wins on conflict; how order and stock updates flow back.
- What migrating off an ERP entails (history, accounting, compliance) and why vendors that tried it succeeded or failed.
Give sources and dates. End with a ladder of four levels from "import once" to "be the ERP", with what each level obliges us to build and support.` },
  { key: 'store-and-developers', prompt: `Research (web search and fetch) and reason about the two delivery surfaces in the ask.
A. A hosted store per seller at thediaex.com/store/<store>: what a jewelry store page set needs (collection and product pages, variants by metal/size/stone, 3D viewer and renders, made-to-order customisation such as changing the stone with a live price, certificates), B2B vs consumer (trade-only prices behind sign-in, minimums, quotes) — Diaex is a B2B marketplace, so say which fits; enquiry/quote vs real checkout and what checkout drags in (payments, merchant of record, tax/GST/VAT, shipping and insurance of high-value goods, returns, KYC/AML for jewelry, chargebacks); a shared marketplace domain vs custom domains; SEO, theming limits, trust and moderation (counterfeits, lab-grown disclosure, hallmarking claims); what comparable offerings do (jewelry-specific site builders and vendor portals, Shopify and headless setups, marketplace storefronts). What "deploy a website through us" minimally means and the staircase above it.
B. Developer access: "we can still give you FTP / api for your developers to get images and such per jewelry". What developers at jewelers and their agencies actually consume: a catalogue API (REST, keys, pagination, webhooks), bulk feeds (CSV/JSON), stable public media URLs with size variants on a CDN, a folder tree per SKU over SFTP (plain FTP is insecure — what to offer instead and how FTP expectations are met: SFTP, S3-compatible bucket, rclone/WebDAV), 3D assets (GLB/USDZ), embeddable viewer; rate limits, versioning, access scopes per key, audit; how this overlaps the publishing plan already in docs/plans/publishing.md of /home/user/ffdraft (read it).
Give sources and dates. For each surface: the minimum that is honestly useful, the next two steps, and the things that look small but are not.` },
]
const reads = (await parallel(READERS.map(r => () =>
  agent(`${CTX}\nYour key is "${r.key}".\n${r.prompt}`, { label: `understand:${r.key}`, phase: 'Understand' })
    .then(t => t && { key: r.key, text: t })))).filter(Boolean)
if (reads.length < READERS.length) log(`Only ${reads.length} of ${READERS.length} readers returned; the synthesis says which are missing`)

phase('Synthesize')
const inputs = reads.map(r => `<${r.key}>\n${r.text}\n</${r.key}>`).join('\n\n')
const draft = await agent(`${CTX}
You are the lead. Five readers reported (missing ones: ${READERS.map(r => r.key).filter(k => !reads.some(x => x.key === k)).join(', ') || 'none'}).
${inputs}

Write docs/strategy/catalog-import-and-store.md in /home/user/ffdraft: "What the catalogue, stock, store and developer-access ask entails". The reader is the founder, a B2B CEO, reading it cold. Lead with the answer in five or six sentences: what the ask is really made of, which parts are small, which are large, and the one distinction that matters most (catalogue + availability vs ERP). Then:
1. The ask restated as separate capabilities (import catalogue files; understand imported CAD; hold catalogue and stock; keep in step with an ERP; migrate off one; a store on thediaex.com; developer access by API and files; "design your stones" and sourcing tied in). One table: capability, what it means in practice, what already exists (Pavé or Diaex, with file paths), what is new, size (S/M/L/XL), main risk.
2. For each capability a short section: what it takes, what looks easy but is not, what we still do not know.
3. The ladder from "import once" to "be the ERP": where each rung stops, what it obliges us to support, and where the earlier strategy's "never build" positions sit on it — say plainly what the new ask reopens and whether the earlier reasons still hold.
4. Who builds what: Pavé (open source), the hosted Pavé service, and Diaex (closed, thediaex.com), and the interface between them.
5. What must be true before any of this is built (the engine pass, publishing layer, sign in with Diaex, a first real user).
6. Questions only the founder can answer, each with why it changes the scope (for example: is the store trade-only or consumer; is his father's catalogue in an ERP or in sheets and what files exist; ready stock or made-to-order; who is merchant of record).
7. What to ask his father for, to make this concrete: a sample of real files.
Plain language, complete sentences, tables for facts, no hype, under ~350 lines. Mark unverified claims. Do not write a build plan. Return the path and a 12-line summary.`, { label: 'synthesize', phase: 'Synthesize' })

phase('Critique')
const CRITIQUE = {
  type: 'object',
  properties: {
    verdict: { type: 'string' },
    issues: { type: 'array', items: { type: 'object', properties: {
      kind: { type: 'string', enum: ['missing', 'wrong', 'overclaimed', 'unclear', 'contradiction'] },
      where: { type: 'string' }, problem: { type: 'string' }, fix: { type: 'string' },
    }, required: ['kind', 'where', 'problem', 'fix'] } },
  },
  required: ['verdict', 'issues'],
}
const critics = (await parallel([
  () => agent(`${CTX}
You are a sceptical reviewer with a jewelry manufacturer's operations background. Read docs/strategy/catalog-import-and-store.md in /home/user/ffdraft against the founder's words above and the readers' findings below. What is missing from the picture of what this ask entails? What is understated (support burden, data mess, stock accuracy, high-value fulfilment), overclaimed, or contradicts docs/strategy/product-strategy.md without saying so? Is every file path and "already exists" claim true — open the files and check. Would the founder know what to decide next after reading it?
${inputs}`, { label: 'critic:operations', phase: 'Critique', schema: CRITIQUE }),
  () => agent(`${CTX}
You are a sceptical engineering reviewer. Read docs/strategy/catalog-import-and-store.md in /home/user/ffdraft. Verify each technical claim against the code in /home/user/ffdraft and (read-only) /home/user/diaex-backend: what rhino3dm can and cannot read, what the data model has, what the publishing plan covers, what Diaex's web stack can host. Check the sizes (S/M/L/XL) are defensible and the division of labour between Pavé, the hosted service and Diaex is coherent (auth, tenancy, where data lives, the licence boundary between an AGPL project and a closed site). List what is wrong, missing or unclear.`, { label: 'critic:engineering', phase: 'Critique', schema: CRITIQUE }),
])).filter(Boolean)
const issues = critics.flatMap(c => c.issues)
let revised = null
if (issues.length) {
  revised = await agent(`${CTX}
You wrote docs/strategy/catalog-import-and-store.md in /home/user/ffdraft. Two reviewers raised the issues below. Check each against the sources (the readers' findings follow), correct the document where the reviewer is right, and leave it where they are wrong — say which in your reply. Keep it under ~350 lines, plain language, lead with the answer.
Issues (JSON):
${JSON.stringify(issues, null, 1)}

${inputs}
Return the final 12-line summary of the document, the founder's questions verbatim, and which issues you rejected and why.`, { label: 'revise', phase: 'Critique' })
}
return { path: 'docs/strategy/catalog-import-and-store.md', draft, issues: issues.length, revised }
