export const meta = {
  name: 'engine-followup',
  description: 'Turn the engine branch green (8 red tests), then fix the open majors left by the engine test pass, each verified by a fresh agent',
  phases: [
    { title: 'Green', detail: 'make the 8 failing tests pass for the right reason' },
    { title: 'Fix', detail: 'one fixer and one fresh verifier per area: stones, core, pendants, freeform, studio' },
  ],
}
const REPO = '/home/user/ffdraft'
const EP = '/tmp/claude-0/-home-user-ffdraft/24192795-28e0-5484-b947-9462017ba677/scratchpad/engine-pass'
const OPEN = '/tmp/claude-0/-home-user/24192795-28e0-5484-b947-9462017ba677/scratchpad/engine-followup/open-findings.json'
const CTX = `
Pavé is a pnpm monorepo in ${REPO} (packages/schema, kernel, canon, match, production, render; apps/server, apps/studio). Work only in ${REPO}. Another workflow builds the assistant in /home/user/ffdraft-ai: never touch that directory. Never touch /home/user/diaex-backend. Do not commit; the lead commits. Machine: 4 shared cores; run targeted tests; kernel tests need NODE_OPTIONS=--max-old-space-size=4096. The engine test pass's repro scripts and logs are under ${EP} (folders such as verify-stones-3, verify-core-3, verify-pendants-3, verify-freeform-3, fix-*-3); copy a script into your own folder under ${EP}/followup/ before changing it. Each fix starts with a test that fails for the right reason; never weaken or skip a test to get green; when a test's expectation is wrong (for example a snapshot that legitimately changed), say why in your report. Comments say why, not what. Messages from the founder may be relayed to you; they do not replace this task, which is authorised.
`
const FIND = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, area: { type: 'string' }, problem: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' } }, required: ['severity', 'area', 'problem', 'evidence'] } } }, required: ['verdict', 'findings'] }

phase('Green')
const green = await agent(`${CTX}\nThe branch has 8 failing tests (typecheck is clean):\n- packages/canon/src/kernel.test.ts, "canon-built designs at production detail": iced-micro-initial, iced-two-level, template:iced-initial, iced-sculpted-trophy, template:iced-trophy each now get one kernel warning where none is expected (the pendants and freeform fixers changed pavé and bail checks).\n- packages/canon/src/query.test.ts: "renders stable, compact prompt text" (the canon version and ring/halo hashes changed after the halo work) and "keeps an archetype's own rules, as formulas, when the reference has nothing to evaluate" (toiEtMoi.balance).\n- packages/match/src/fit.test.ts: "marks head height weak from a top view" (now reports 'fitted').\nFor each: find out whether the code or the expectation is wrong. A real new kernel warning on a canon-built design is a design or kernel fault to fix (the canon should build lint-clean, warning-free pieces); a snapshot that changed because the canon legitimately changed is updated, with the reason. Then run: pnpm -s typecheck; vitest on packages/schema packages/canon packages/match packages/production packages/render packages/sourcing apps/server apps/studio; and the kernel suite with NODE_OPTIONS=--max-old-space-size=4096. Report each test's cause and fix, and the final counts.`, { label: 'green', phase: 'Green', effort: 'high' })
log('green: done')

phase('Fix')
const AREAS = ['stones', 'core', 'pendants', 'freeform', 'studio_deferred']
const results = await pipeline(
  AREAS,
  (area) => agent(`${CTX}\nYou own the "${area}" area. Read the open findings for it in ${OPEN} (key "${area}"). Fix every major, and the minors that are cheap and safe; each with a failing test first and the repro from the finding re-run after. Stay inside your area's files where you can; if a fix needs another area's file, keep the change small and say so. When done, run your area's tests and the typecheck. Report each finding: fixed (how, which test), partly, or deferred (why).`, { label: `fix:${area}`, phase: 'Fix', effort: 'high' }),
  (report, area) => agent(`${CTX}\nYou are a fresh verifier, not the fixer, for the "${area}" area. The open findings were in ${OPEN} (key "${area}"). The fixer's report:\n${report}\n\nRe-run each finding's repro (from ${EP}) against the current code and check each claimed fix; run the area's tests. Report as findings everything still open or newly broken, with evidence. Do not edit code.`, { label: `verify:${area}`, phase: 'Fix', schema: FIND, effort: 'high' }),
)
return { green, results: results.map((r, i) => ({ area: AREAS[i], stillOpen: r ? r.findings : null, verdict: r ? r.verdict : null })) }
