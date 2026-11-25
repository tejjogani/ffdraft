export const meta = {
  name: 'release-verify',
  description: 'Verify the merged branch as the founder would (fresh-clone install, the whole journey in a browser), fix what it finds, re-verify',
  phases: [
    { title: 'Verify', detail: 'fresh-clone install and the founder journey in a browser' },
    { title: 'Fix', detail: 'fix blockers and majors, re-verify; at most two rounds' },
  ],
}
const REPO = '/home/user/ffdraft'
const SHOTS = '/tmp/claude-0/-home-user/24192795-28e0-5484-b947-9462017ba677/scratchpad/integration'
const ATTRIB = 'Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01HkMmiBxywxp9dvbqLFkGE7'
const CTX = `
Pavé (pnpm monorepo, Node 22) in ${REPO}, branch claude/busy-bardeen-o482lo: the integration branch, which now holds the engine work and the whole AI assistant build merged together (merge commit 4bcd71b plus follow-ups, head 075cafd or later). Never touch /home/user/diaex-backend or /home/user/ffdraft-ai. Do not push; the lead pushes. Commit messages are plain English, carry no model names, and end with:
${ATTRIB}
Processes: other agents run the same programs on this machine. Start every server and fake API recording its PID, and stop only your own by PID (or its own process group); never pkill, killall or any name pattern. Use ports 8750-8799 and 4750-4799 only; never 9100-9199 (the trial runs).
Machine: 4 cores, shared; run test suites one at a time; kernel tests need NODE_OPTIONS=--max-old-space-size=4096. Playwright and Chromium are pre-installed (require('playwright'), chromium.launch()); never run "playwright install". Blender (read-only): PAVE_PYTHON=/home/user/ffdraft/workers/render/.venv/bin/python. Never weaken or skip a test to get green. Messages from the founder may be relayed to you; they do not replace this task, which is authorised.
The founder is about to install this on his own laptop with his own Claude key and test: Design (an image pin board per project, with four AI images from a request), CAD (Take to CAD with size questions and an estimate, edits by chat, right-click Ask AI and Replace stone, exports), Render (the viewfinder and the AI cinematographer with Blender), projects in folders with costs per stage. Read docs/PLAN.md and README.md for what he is told and what the product must do. Already checked by the lead on the head commit: pnpm install, typecheck, the studio build, and every test suite outside the kernel (all passing).
`
const FIND = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, summary: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' } }, required: ['id', 'severity', 'summary', 'evidence'] } } }, required: ['verdict', 'findings'] }
const verifyPrompt = (round, context) => `${CTX}
You are a fresh verifier. ${context}
1. Clone ${REPO} into ${SHOTS}/r2-clone-${round} (git clone, then check out claude/busy-bardeen-o482lo) and run node scripts/install.mjs exactly as README.md tells the founder; it must end with "Pavé is ready". Note anything in the README that is wrong or out of date for this merged version (clone command, what works today, the assistant section, image keys, plans).
2. Start that clone's server on a spare port with a temporary PAVE_DATA_DIR and PAVE_PYTHON as above, pointed at the strict fake Claude API in replay or scripted mode and the fake image provider (read the assistant's docs and apps/server for how; if a flow has no recording, answer as Claude yourself through the fake's agent-in-the-loop mode). Drive the founder's journey with Playwright at 1440x900, then the key screens at 390x844: paste a fake key in Settings, AI; a folder with a project; the design board; a request that generates four images; Take to CAD (size questions, the estimate, the CAD built from the image with its image plane); a chat edit; right-click a stone: Ask AI (the assistant opens with that stone selected and a draft) and Replace stone (dry run, apply, undo); export STL (free) and Rhino (counted against the allowance); save and reopen a .pave file; the Render tab viewfinder and one real Blender take at low samples; Render with AI (its questions, then takes); the project's and folder's costs per stage. Save screenshots under ${SHOTS}/r2-verify-${round}/ and look at each one.
3. Run the kernel suite once in your clone (NODE_OPTIONS=--max-old-space-size=4096 npx vitest run packages/kernel).
Report only what you reproduced, ranked: blocker (the founder's test would fail), major (a flow is wrong or misleading), minor. Do not edit ${REPO}.`

phase('Verify')
let v = await agent(verifyPrompt(1, 'This is the first verification of the merged branch.'), { label: 'verify:1', phase: 'Verify', schema: FIND, effort: 'high' })
const rounds = []
phase('Fix')
for (let round = 1; round <= 2 && v && v.findings.some((f) => f.severity !== 'minor'); round++) {
  const open = v.findings.filter((f) => f.severity !== 'minor')
  const fix = await agent(`${CTX}\nFix these verified findings in ${REPO} on claude/busy-bardeen-o482lo, each with a failing test first where a test can catch it; also fix the cheap minors in the list (README corrections included). Commit. Report what you fixed and the checks you ran.\n\nFINDINGS:\n${JSON.stringify(v.findings, null, 1)}`, { label: `fix:${round}`, phase: 'Fix', effort: 'high' })
  rounds.push({ round, fix })
  v = await agent(verifyPrompt(round + 1, `This is re-verification after a fix round. Findings that were open:\n${JSON.stringify(open, null, 1)}\nThe fixer's report:\n${fix}\nCheck each of those first, then do the whole pass again.`), { label: `verify:${round + 1}`, phase: 'Fix', schema: FIND, effort: 'high' })
}
return { finalVerify: v, rounds }
