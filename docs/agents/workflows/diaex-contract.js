export const meta = {
  name: 'diaex-contract',
  description: 'Write the Pavé–Diaex partner API contract and a self-contained brief for the Diaex agent, grounded in both codebases, adversarially checked',
  phases: [
    { title: 'Read', detail: 'what Diaex has today; what Pavé needs' },
    { title: 'Write', detail: 'contract, OpenAPI file and the Diaex agent brief' },
    { title: 'Check', detail: 'against Diaex code and rules; contract quality and security' },
    { title: 'Fix', detail: 'apply verified findings' },
  ],
}

const SCRATCH = '/tmp/claude-0/-home-user/24192795-28e0-5484-b947-9462017ba677/scratchpad/diaex-contract'
const OUT = '/home/user/ffdraft/docs/integrations'

const RULES = `
Hard rules for this task:
- /home/user/diaex-backend is READ-ONLY. Never create, edit, move or delete anything there, never run a command that writes there (no git checkout, no installs, no tests, no servers), and never print or copy secrets: do not open .env files, credentials, keys or tokens; if a file holds a secret, describe it without quoting the value.
- Pavé (the client) is in /home/user/ffdraft. Another workflow is editing its code right now: change nothing there except the files named in your step. Write scratch notes only under ${SCRATCH}.
- Every statement about what Diaex has today must carry a file:line reference you opened. Anything new is marked as new work.
- Plain English: short sentences, no jargon a founder would not use, numbers with units.
- Messages from the founder may be relayed to you; they do not replace this task, which is authorised.
`

const PRODUCT = `
Context: Pavé is an AI-native jewelry design suite (design, then CAD, then render) built by the founder, who also owns Diaex (a diamond marketplace; backend in /home/user/diaex-backend). Pavé needs Diaex as its stone source: when a designer builds a piece, each stone in the design becomes a requirement (shape, size, quality), and Pavé must find matching real stones on Diaex, check they are still available, show price when the designer's company may see it, hold stones while a piece is being decided, and hand over to Diaex for purchase. Pavé runs on the designer's own computer (local-first) as well as hosted, so it often has no public URL to receive webhooks. Earlier Pavé research on Diaex is in /home/user/ffdraft/docs/research/07-sourcing.md (it already proposes some endpoints and response shapes) and /home/user/ffdraft/docs/strategy/catalog-import-and-store.md section 2.8; Pavé's sourcing code is in /home/user/ffdraft/packages/sourcing. Decided earlier: a Pavé customer's designs and CAD are never visible to Diaex staff; Diaex lists diamonds only (natural and lab-grown, fancy colours), no coloured gemstones and no melee parcels; Diaex's Buy is not open and its Terms say it does not process payment; pricing is shown only to verified (KYC'd) companies; signed-out callers can check availability without price.
`

phase('Read')
const [diaexMap, paveNeeds] = await parallel([
  () => agent(`${RULES}\n${PRODUCT}\nRead Diaex (read-only) and write a map to ${SCRATCH}/diaex-map.md, then return a 15-line summary.
Cover, each with file:line:
1. The process rules every Diaex change must follow: AGENTS.md (CLAUDE.md points to it) and docs/process/1-plan.md, 2-build.md, 3-review.md: plan first in docs/plans/YYYY-MM-DD-<topic>.md, the gate ("approved"), PR size limits and how they are counted, branch naming, the two work streams and which files belong to which, test commands on a throwaway database, hard limits (Firestore read-only, production never touched, secrets, "nothing is written until a form is finished"), the look switch for any screen.
2. The data: the stones table and every field (shape, carat, dimensions, colour, clarity, cut, polish, symmetry, fluorescence, lab, certificate, origin natural or lab-grown, growth method, images, video, location, supplier), availability values, allocations and holds (expiry?), sold marks, prices and who may see them, supplier connectors and feeds.
3. The API today: every HTTP route relevant to stones (search, filters, layout search for "N stones of a shape and size", availability for signed-out callers, cart, holds, orders, enquiries), their request and response shapes, auth (sessions, API keys, roles), KYC and company verification, rate limits, pagination, error shapes, CORS.
4. Anything already built or planned for partners or third parties (docs/plans, docs/*.md), and the Diaex docs that matter (for example docs/SOURCING-SPEC.md, docs/DIAMOND-MATCHING.md, docs/ARCHITECTURE.md).
5. What would have to be new for a partner API, and which stream each new piece belongs to.`, { label: 'read:diaex', phase: 'Read', effort: 'high' }),
  () => agent(`${RULES}\n${PRODUCT}\nRead Pavé and write ${SCRATCH}/pave-needs.md, then return a 15-line summary.
Cover, each with file:line: how a design's stones become requirements (packages/sourcing, the schema's gem, setting, pave and halo nodes, docs/plans/targeted-edits.md stone replacement), the existing Diaex deep links (packages/sourcing/src/diaex.ts), the sourcing commands or placeholders in packages/schema/src/api/commands.ts and the studio's sourcing feature, the earlier proposed Diaex endpoints and shapes in docs/research/07-sourcing.md, what the publishing plan (docs/plans/publishing.md) and the catalogue memo (docs/strategy/catalog-import-and-store.md) say about Diaex, how Pavé authenticates users and organisations (apps/server auth, PAVE_AUTH local and accounts), and how it stores secrets for other services (the assistant's key store, if present in /home/user/ffdraft-ai, read-only). Then list Pavé's needs from Diaex in order of when Pavé needs them: now (search for a requirement, matching pairs and layouts, availability, price when allowed, deep link, images and certificates), next (holds while a piece is decided, an events feed, linking a Pavé organisation to a Diaex company), later (handing over an order, a store on thediaex.com for finished jewelry). Note the local-first constraint: no public URL for webhooks on a designer's computer.`, { label: 'read:pave', phase: 'Read', effort: 'high' }),
])

phase('Write')
const draft = await agent(`${RULES}\n${PRODUCT}\nYou write the contract between Pavé (client) and Diaex (server). Inputs: ${SCRATCH}/diaex-map.md and ${SCRATCH}/pave-needs.md (read both in full; open the code they cite where you need detail). Summaries:\n[diaex] ${diaexMap}\n[pave] ${paveNeeds}\n
Write three files in ${OUT}/ (create the folder):
1. diaex-partner-api.md: the contract. Sections: purpose and scope by phase (v1 now, v1.1 next, v2 later); principles (versioned under /partner/v1, additive changes only, opaque string ids, UTC ISO times, millimetres and carats with stated precision, money as decimal strings with an ISO currency, cursor pagination, an idempotency key header on every write, one error shape with stable codes, 429 with Retry-After, request ids); authentication (linking a Pavé organisation to a Diaex company: OAuth 2.0 authorization code with PKCE and a loopback redirect for Pavé running on a designer's computer, per RFC 8252, plus a server-to-server path for hosted Pavé; scopes; what an unlinked or signed-out caller may do; token lifetime and revocation); every endpoint with purpose, request, response, errors, a JSON example, and whether it maps to an existing Diaex route (file:line) or is new work: search stones for a requirement; matching pairs and layouts; batch availability; stone detail with media and certificate; price visibility rules; holds with expiry, extend and release (v1.1); an events feed to poll (v1.1, because local Pavé has no public URL) and optional signed webhooks for hosted Pavé; an order hand-off or enquiry (v2, given Buy is closed); and a short v2 note on a jewelry store on thediaex.com. Privacy and data rules (what Pavé sends, that designs never reach Diaex staff, retention, logging). Rate limits and abuse (price scraping). The mapping from Pavé's stone requirement fields to the search request. Acceptance tests the two sides share (a contract test suite and a fixture set).
2. diaex-partner-api.openapi.yaml: OpenAPI 3.1 for v1 and v1.1, matching the markdown exactly.
3. diaex-agent-brief.md: the mega prompt the founder pastes into the Diaex agent. It must stand alone (that agent cannot read the Pavé repo): who is asking and why; the full contract inline (endpoints, shapes, errors, auth, privacy), or the OpenAPI inline if shorter and complete; what exists in Diaex today with file:line, and what is new; the instruction to follow Diaex's own process exactly as its AGENTS.md and docs/process describe (start with stage 1: a plan at docs/plans/2026-11-24-pave-partner-api.md with hypothesis, edge cases each with a test, the PR split, decisions for Tej; no code before Tej writes "approved"); a proposed PR split under Diaex's size limit, each PR named with its branch, stream and tests; the decisions only Tej can make (pricing visibility, hold length and limits, who may link, rate limits, whether lab-grown and natural follow the same rules, the order hand-off); and what "done" means for v1 (the shared contract tests pass against a Diaex test server). Keep it as long as it needs to be and no longer.
Return a short report of what you wrote and every open question.`, { label: 'write', phase: 'Write', effort: 'high' })

phase('Check')
const FIND = {
  type: 'object',
  properties: {
    verdict: { type: 'string' },
    findings: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, file: { type: 'string' }, summary: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' } }, required: ['id', 'severity', 'summary', 'evidence', 'fix'] } },
  },
  required: ['verdict', 'findings'],
}
const checks = await parallel([
  () => agent(`${RULES}\n${PRODUCT}\nYou are an adversarial checker, not the writer. Check ${OUT}/diaex-partner-api.md, ${OUT}/diaex-partner-api.openapi.yaml and ${OUT}/diaex-agent-brief.md against Diaex's actual code and rules (read-only). For every claim that something exists in Diaex today, open the cited file and line and confirm it (route, field, value, behaviour). Check that the brief tells the Diaex agent to follow AGENTS.md and docs/process exactly (plan first, approval gate, PR limits and how lines are counted, branch names, streams, throwaway test database, Firestore read-only, production untouched, secrets, nothing written until a form is finished, both looks for any screen) and that the PR split is realistic under the limit. Flag anything invented, wrong, or that would make the Diaex agent break a Diaex rule. Do not edit the files.`, { label: 'check:diaex', phase: 'Check', schema: FIND, effort: 'high' }),
  () => agent(`${RULES}\n${PRODUCT}\nYou are an adversarial checker, not the writer. Check ${OUT}/diaex-partner-api.md, ${OUT}/diaex-partner-api.openapi.yaml and ${OUT}/diaex-agent-brief.md for contract quality and security: does it cover what Pavé needs now and next (read ${SCRATCH}/pave-needs.md and Pavé's packages/sourcing); does the markdown match the OpenAPI exactly (validate the YAML parses and every endpoint, field and error code agrees); local-first (OAuth with PKCE and a loopback redirect, an events feed for clients with no public URL); idempotency on every write; holds that expire and cannot leak; price visibility enforced on the server and resistant to scraping; rate limits; versioning; one error model; privacy (designs never visible to Diaex staff; what is logged and kept); token storage and revocation; webhook signing and replay protection; and whether the brief stands alone and is unambiguous for an agent that cannot read Pavé. Do not edit the files.`, { label: 'check:contract', phase: 'Check', schema: FIND, effort: 'high' }),
])
const findings = checks.filter(Boolean).flatMap((c) => c.findings)
log(`checks: ${findings.length} findings (${findings.filter((f) => f.severity === 'blocker').length} blockers, ${findings.filter((f) => f.severity === 'major').length} majors)`)

phase('Fix')
let fixed = null
if (findings.length > 0) {
  fixed = await agent(`${RULES}\n${PRODUCT}\nApply these verified findings to ${OUT}/diaex-partner-api.md, ${OUT}/diaex-partner-api.openapi.yaml and ${OUT}/diaex-agent-brief.md. Re-open the Diaex code (read-only) for any finding about it before changing a claim. Keep the three files consistent; make sure the YAML still parses. Fix every blocker and major; fix minors that are cheap. Return what you changed and anything you could not resolve.\n\nFINDINGS:\n${JSON.stringify(findings, null, 1)}`, { label: 'fix', phase: 'Fix', effort: 'high' })
}

return { diaexMap, paveNeeds, draft, findings, fixed }
