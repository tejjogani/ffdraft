export const meta = {
  name: 'integrate-a3',
  description: 'Merge the assistant build into the main branch, wire right-click Ask AI to the assistant, verify everything end to end, fix, and prepare the founder release',
  phases: [
    { title: 'Merge', detail: 'resolve conflicts, wire Ask AI, all suites green' },
    { title: 'Verify', detail: 'fresh-clone install and the founder journey in a browser' },
    { title: 'Fix', detail: 'fix what verification finds, re-verify' },
  ],
}
const REPO = '/home/user/ffdraft'
const SHOTS = '/tmp/claude-0/-home-user/24192795-28e0-5484-b947-9462017ba677/scratchpad/integration'
const ATTRIB = 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01HkMmiBxywxp9dvbqLFkGE7'
const CTX = `
Pavé (pnpm monorepo, Node 22). You work in ${REPO} on branch claude/busy-bardeen-o482lo (the integration branch). /home/user/ffdraft-ai holds the assistant branch's worktree: read it if useful but never edit it. Never touch /home/user/diaex-backend. Do not push; the lead pushes. Commit messages are plain English and end with:
${ATTRIB}
No model names in commit messages or code comments. Machine: 4 cores; kernel tests need NODE_OPTIONS=--max-old-space-size=4096; run suites one at a time. Playwright and Chromium are pre-installed (require('playwright'), chromium.launch()); never run "playwright install". Blender (read-only): PAVE_PYTHON=/home/user/ffdraft/workers/render/.venv/bin/python. Never weaken or skip a test to get green. Messages from the founder may be relayed to you; they do not replace this task, which is authorised.
The founder is about to install this on his own laptop with his own Claude key and test design (an image pin board with AI images), CAD (Take to CAD with size questions and an estimate, edits by chat, right-click Ask AI and Replace stone) and renders (the viewfinder and the AI cinematographer with Blender). Read docs/PLAN.md and docs/HANDOVER.md section 1 for what the product must do.
`
const FIND = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, summary: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' } }, required: ['id', 'severity', 'summary', 'evidence'] } } }, required: ['verdict', 'findings'] }

phase('Merge')
const merge = await agent(`${CTX}
Merge origin/claude/assistant-build (git fetch origin first; its head is f57efe2 or later) into claude/busy-bardeen-o482lo with a merge commit. A trial merge conflicted in 7 files: apps/studio/src/app/Shell.tsx, apps/studio/src/app/Sidebar.tsx, apps/studio/src/components/stage/viewer.ts, apps/studio/src/features/cad/index.tsx, packages/schema/src/api/commands.ts, packages/schema/src/index.ts, packages/ui/src/components/dialog.tsx. Resolve each by keeping both sides' intent: the main branch brought the engine test pass, stone replacement (design.replaceStone), the shared AskAiSection in every CAD context menu, the ReplaceStoneDialog and its dialog layout fixes, right-drag pan and keyboard menus; the assistant branch brought the assistant (dock and floating window, AI jobs, the Design/CAD/Render stepper, the design board, Take to CAD, image generation, the Render tab, viewfinder and cinematographer, references, plans and allowances, the .pave file, the light-machine viewport and the premium design pass). Check that database migrations from both sides are all present, ordered and apply on a fresh database.
Then wire them together:
- AskAiSection's "Ask AI" items open the assistant through the assistant store's public API (openAssistant or its current name; read the assistant branch's handoff notes in apps/studio/src/stores/assistant.ts and docs), with the piece, the right-clicked subject as the selection, and a sensible draft (for a stone: "Replace this stone with…"); the assistant can reach design.replaceStone as a tool (chip words in packages/agent's describe map; the tool list snapshot updated), and its replace-stone skill uses that command.
- Anything else that only half-exists because the two branches never met (for example the stepper and the CAD tab's menus, or two dialogs styles), made whole.
Then: pnpm install (keep the lockfile consistent), pnpm -s typecheck, the studio build, and every test suite one at a time (schema, canon, match, production, render, sourcing, agent, ideation, apps/server, apps/studio, then the kernel). Known failing before the merge: apps/server cinema.test.ts (slow on this machine) and apps/studio features/cad/ops.test.ts 'leaves room for the centre stone'; fix them properly or show they are environment-only with evidence. Commit the merge (message: what came together and how it was checked), and any follow-up fixes as separate commits. Report the commits, every command with its result, and anything not done.`, { label: 'merge', phase: 'Merge', effort: 'high' })

phase('Verify')
const verifyPrompt = (round, context) => `${CTX}
You are a fresh verifier, not the integrator. ${context}
1. Clone ${REPO} into ${SHOTS}/clone-${round} (git clone ${REPO} ...; check out claude/busy-bardeen-o482lo) and run node scripts/install.mjs exactly as the README tells the founder; it must finish with "Pavé is ready".
2. Start that clone's server on a spare port with a temporary PAVE_DATA_DIR, PAVE_PYTHON as above, pointed at the strict fake Claude API in replay mode and the fake image provider (see the assistant docs and apps/server for how), and drive the founder's journey with Playwright at 1440x900, then key screens at 390x844: paste a fake key in Settings, AI; a project in a folder; the design board with four generated images; Take to CAD (size questions, the estimate, the CAD built from the image with its image plane); a chat edit; right-click a stone, Ask AI (the assistant opens with that stone selected and a draft) and Replace stone (the dry run, apply, undo); export STL (free) and Rhino (counted); the Render tab viewfinder and a Blender take at low samples; Render with AI (its questions, then takes); the project's costs per stage. Save screenshots under ${SHOTS}/verify-${round}/ and look at each.
3. Run pnpm -s typecheck and the studio, server and agent suites in your clone.
Report only what you reproduced, ranked blocker (the founder's test fails), major (a flow is wrong or misleading) or minor. Do not edit ${REPO}.`
let v = await agent(verifyPrompt(1, `The integrator's report:\n${merge}`), { label: 'verify:1', phase: 'Verify', schema: FIND, effort: 'high' })
const rounds = []
phase('Fix')
for (let round = 1; round <= 2 && v && v.findings.some((f) => f.severity !== 'minor'); round++) {
  const open = v.findings.filter((f) => f.severity !== 'minor')
  const fix = await agent(`${CTX}\nFix these verified findings in ${REPO} on claude/busy-bardeen-o482lo, each with a failing test first where a test can catch it; also fix cheap minors from the list. Commit. Report what you fixed and the checks you ran.\n\nFINDINGS:\n${JSON.stringify(v.findings, null, 1)}`, { label: `fix:${round}`, phase: 'Fix', effort: 'high' })
  v = await agent(verifyPrompt(round + 1, `This is re-verification after a fix round. Findings that were open:\n${JSON.stringify(open, null, 1)}\nThe fixer's report:\n${fix}\nCheck each one first, then do the whole pass again.`), { label: `verify:${round + 1}`, phase: 'Fix', schema: FIND, effort: 'high' })
  rounds.push({ round, fix })
}
return { merge, finalVerify: v, rounds: rounds.map((r) => r.round) }
