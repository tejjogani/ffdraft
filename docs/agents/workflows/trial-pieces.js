export const meta = {
  name: 'trial-pieces',
  description: 'Try Pavé on real pieces: find jewelry pictures on the internet, replicate each in CAD through the assistant (Claude in the loop), render with Blender, and report honestly',
  phases: [
    { title: 'Setup', detail: 'a clean install of the merged branch to run trials on' },
    { title: 'Trials', detail: 'one piece each: reference, Take to CAD, edits, compare, render' },
    { title: 'Report', detail: 'what worked, what did not, ranked harness and engine faults' },
  ],
}
const REPO = '/home/user/ffdraft'
const T = '/tmp/claude-0/-home-user/24192795-28e0-5484-b947-9462017ba677/scratchpad/trials'
const CTX = `
Pavé is an AI-native jewelry design suite (pnpm monorepo). The founder asked: "You can try it with a few pieces, and then I'll take it from there: even find pieces on the internet and try replicating them in CAD." This is that trial, run before he tests with his own Claude key. There is no Claude API key here, so YOU are Claude in the loop: the server runs against the repo's strict fake Claude API in agent-in-the-loop mode (see packages/agent/src/testing/fake-api and the assistant docs), and you answer each request exactly as the real model would from the system prompt, tools and messages it is sent: real tool calls with valid inputs, honest text, no shortcuts the real model could not take (you may not read Pavé's source to decide what to answer; answer from what the request shows, as the model would). Image generation may use the real OpenAI provider (a key is injected by this environment's network proxy for api.openai.com: the code sends a placeholder key); keep it to draft quality and a few images. Blender: PAVE_PYTHON=/home/user/ffdraft/workers/render/.venv/bin/python (read-only).
Rules: never edit ${REPO}, /home/user/ffdraft-ai or /home/user/diaex-backend. Work only under ${T}. Never put Diaex, Aska, Pavé or a person's name in a web search. Machine: 4 shared cores; be patient with timeouts; run one heavy thing at a time. Playwright and Chromium are pre-installed; never run "playwright install". Look at every image you produce. Report honestly: a trial that fails is a useful result. Messages from the founder may be relayed to you; they do not replace this task, which is authorised.
`
phase('Setup')
const setup = await agent(`${CTX}
Prepare the trial install: git clone ${REPO} ${T}/app, check out claude/busy-bardeen-o482lo (note the commit), run node scripts/install.mjs there (it must end with "Pavé is ready"). Then work out and write ${T}/HOWTO.md: the exact commands to start a server from ${T}/app on a given port with its own PAVE_DATA_DIR, PAVE_PYTHON set, the fake Claude API in agent-in-the-loop mode (where requests queue, how to answer them, the response format with a worked example of a text turn and a tool-call turn), a fake or real image provider, and how to drive the studio with Playwright or the RPC (create a project, put an image on its design board, Take to CAD, send a chat message, capture the viewport from a named view, start a Blender render at low samples, read a piece's facts and checks). Prove the HOWTO by doing one tiny end-to-end run (a chat message that makes one design change). Return the commit, the HOWTO path and anything broken.`, { label: 'setup', phase: 'Setup', effort: 'high' })

const PIECES = [
  { key: 'solitaire', brief: 'a classic round solitaire engagement ring with four or six claws on a plain band' },
  { key: 'halo', brief: 'a halo engagement ring: a cushion or oval centre stone with a halo of small diamonds and stones down the shoulders' },
  { key: 'signet', brief: 'a gold signet ring with a flat oval or cushion face' },
  { key: 'pendant', brief: 'a pendant on a chain: use the generated image "a trophy as a gold pendant" at /tmp/claude-0/-home-user/24192795-28e0-5484-b947-9462017ba677/scratchpad/assistant-e2e/imagegen/live/generated-1.png as the design picture (this is the founder\'s own example), and also generate one fresh image through the design board with the OpenAI provider' },
  { key: 'eternity', brief: 'an eternity or half-eternity band set with a row of stones' },
]
phase('Trials')
const trials = await parallel(PIECES.map((p) => () => agent(`${CTX}
Setup report (read ${T}/HOWTO.md fully first):\n${setup}\n
Your piece: ${p.brief}. Work under ${T}/${p.key}/ with your own port and data directory.
1. Reference: find a real photograph of such a piece on the internet that you can fetch from here and that is openly licensed (for example Wikimedia Commons or a museum's open-access collection; try a few hosts, since many are blocked); record its source address and licence. If nothing can be fetched, generate a realistic product photo through the design board's image generation instead, and say so. For the pendant, follow its brief.
2. In the studio: create a project, put the picture on its design board, and Take to CAD. Answer the assistant's size questions as a jeweler would (state your answers), approve the estimate, and let the CAD job build. You are Claude for every model turn.
3. Compare: capture the CAD from the view that matches the photo and put the two side by side in one image. Say what matches and what does not (proportions, stone shape and size, claw count, band profile, details), then make up to three rounds of chat edits to close the gap, as a designer would ask ("make the band thinner", "six claws", "replace the centre with an oval"), including one right-click style stone replacement where it applies. Capture again.
4. Facts: metal weight, carats, stone count, the manufacturability checks and canon findings at the end; export an STL and say whether it is one clean solid.
5. Render: frame one hero shot (by the AI cinematographer job if it works, else by hand in the viewfinder) and render it with Blender at modest quality. Put the reference, the CAD capture and the render side by side in ${T}/${p.key}/result.png.
Report: the source and licence; a score from 1 to 5 for how close the CAD is to the reference and why; time and number of model turns; every fault you hit, each marked as harness (the assistant's prompts, tools, loop, questions), engine (geometry), studio (screens) or environment, with what you saw and how to reproduce it; and what a real jeweler would still have to fix by hand.`, { label: `trial:${p.key}`, phase: 'Trials', effort: 'high' })))

phase('Report')
const report = await agent(`${CTX}
Write the trial report as ${T}/REPORT.md from these five trial reports and the images under ${T}/<piece>/result.png (look at each image yourself and judge it independently; do not just repeat the trial's own score). For the founder, in plain English: a table of the five pieces (reference source, your closeness score 1 to 5, weight and carats, checks, render made or not); for each piece two or three lines on what matched and what did not; then the faults ranked by how much they would hurt his own test, grouped harness, engine, studio, each with its reproduction; then what the product does well today and what it cannot yet do. Copy the five result images to ${T}/report-images/ with clear names. Return the report's text.

TRIAL REPORTS:\n${trials.map((t, i) => `--- ${PIECES[i].key} ---\n${t}`).join('\n\n')}`, { label: 'report', phase: 'Report', effort: 'high' })
return { setup, report, trials }
