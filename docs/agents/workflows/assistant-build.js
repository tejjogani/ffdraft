export const meta = {
  name: 'assistant-build',
  description: 'Build the Claude-powered assistant for CAD (text and photo to design, chat edits, Ask AI hook, MCP), review it adversarially, fix',
  phases: [
    { title: 'Build', detail: 'contract and agent core; loop and approvals; studio dock; photo to CAD and capture; AI jobs and stages; photo to CAD; design directions and the CAD job; Blender render and the render job; plans and allowances; MCP, smoke test and docs' },
    { title: 'Review', detail: 'Claude API correctness; security, privacy and cost; browser end-to-end' },
    { title: 'Fix', detail: 'fix blockers and majors, then re-verify; at most two rounds' },
  ],
}

const WT = '/home/user/ffdraft-ai'
const SHOTS = '/tmp/claude-0/-home-user/24192795-28e0-5484-b947-9462017ba677/scratchpad/assistant-e2e'
const ATTRIB = 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01HkMmiBxywxp9dvbqLFkGE7'

const CTX = `
CONTEXT (read carefully; it applies to every step).

Product: Pavé, an AI-native jewelry design suite (pnpm monorepo, Node 22, TypeScript, zod 4, vitest, biome; Hono server in apps/server, React studio in apps/studio, CAD kernel in packages/kernel, contracts in packages/schema with ONE command registry packages/schema/src/api/commands.ts that drives RPC, the studio client, assistant tools and MCP).

The goal of this whole build: the founder will install Pavé on his own computer (README.md, scripts/install.mjs, pnpm start), put ANTHROPIC_API_KEY in apps/server/.env, and test whether the CAD product works with Claude: describe a piece in words or upload a photo of a piece, get a parametric design, edit it by chatting, and ask about a selected part. It must work for real on the first try with a real key, on macOS, Windows and Linux.

Where to work: ONLY in ${WT}, a git worktree on the local branch ai/assistant (base commit e5d18f2). Never edit anything in /home/user/ffdraft (another workflow is editing that checkout right now) and never touch /home/user/diaex-backend (read-only; never modify, never print anything from it). Commit your work locally on ai/assistant at the end of your step (git add -A; git commit), with a plain-English message that ends with these two lines exactly:
${ATTRIB}
Do not push. Never put a model identifier in a commit message or a code comment (model ID strings as configuration values in code are fine).

The plan is docs/plans/assistant.md (a judged build brief; follow it unless this context overrides it). Also relevant: docs/plans/reference-match.md and docs/research/11-image-to-cad.md (photo to design), docs/plans/targeted-edits.md (stone replacement and "Ask AI"), docs/ARCHITECTURE.md.

Claude API rules (decided; they override the plan where they differ):
- Before writing or reviewing any Anthropic SDK code, invoke the Skill tool with skill "claude-api", then read from its base directory typescript/claude-api/README.md, typescript/claude-api/tool-use.md, typescript/claude-api/streaming.md, shared/tool-use-concepts.md, shared/prompt-caching.md, and the Claude Opus 5.5 and Claude Fable 5.2 sections of shared/model-migration.md. Never guess an SDK name or signature: check the skill docs and the installed SDK's .d.ts files in node_modules.
- Use the official TypeScript SDK @anthropic-ai/sdk (add it to packages/agent with the newest published version; check with npm view). The loop is ours, on the Messages API (plan section 4.1), because every tool runs on the user's own machine against the local kernel and database.
- Models, chosen by tier (the founder's requirement; it overrides the plan's single default model): three tiers named Power, Standard and Light. Default mapping: Power = claude-fable-5-2, Standard = claude-opus-5-5, Light = claude-sonnet-5-5. In settings each tier can be pointed at any model on the allow-list claude-fable-5-2, claude-opus-5-5, claude-sonnet-5-5, claude-haiku-5-5 (so Light can become Haiku). The org's default tier is Standard; the composer has a tier picker per conversation, and everything a run does (including the structured photo read) uses that run's tier. Optional env overrides in apps/server/.env (for example PAVE_ASSISTANT_TIER and one variable per tier's model) win over the settings, and the settings screen says so. Prices come from the skill's model table (Fable 5.2 $8/$40 per million tokens, cache reads $0.20; Opus 5.5 $4/$20, cache reads $0.20; Sonnet 5.5 $2/$10, cache reads $0.10; Haiku 5.5 $0.10/$0.50 up to 100K-token prompts and $0.50/$2.50 beyond; cache writes at the rates the skill gives). Per-model request differences come from the skill, not from memory: for example Haiku 5.5 has no server-side fallback (omit fallbacks and handle refusal yourself), Sonnet 5.5 prefers fallbacks 'default', Fable 5.2 needs 30-day retention (map its 400 to a clear message suggesting Standard), and effort must be set explicitly because some models default to medium. Switching tier mid-conversation is allowed; thinking blocks are passed back unchanged and the API drops what the new model cannot read.
- The API key, entered in the app (the founder's requirement; it overrides the plan's scope cut of key-entry UI): Settings, AI has a field to paste the key, a Test button (the server calls the free Models API to validate it and maps typed errors to plain messages, including "could not reach Claude's API"), Save and Remove. The key is stored on the server only: under PAVE_DATA_DIR in a file readable only by the owner (mode 0600; best effort on Windows), or in the database encrypted with a key derived from the local auth secret; choose one and say why. It is never returned to the browser (show only its last four characters), never logged, never in traces, usage rows, SSE or RPC output. Saving or removing a key takes effect at once, without a restart (register or unregister the assistant service at runtime). ANTHROPIC_API_KEY in apps/server/.env still works and takes precedence; the screen then says the key comes from the .env file and disables editing. In accounts mode the key belongs to the organisation and only owners and admins can set, test or remove it. These settings commands are never tool commands: neither the model nor MCP can reach them. The no-key panel in the dock is this same short form, with a sentence on where to get a key (name the Claude Console's API keys page; link to it only if the skill's docs give the URL). Settings, AI also shows each tier's model and price and a rough cost of a typical run, and this month's AI spend (usage.summary).
- Request shape: streaming (client.beta.messages.stream, then finalMessage), max_tokens about 64000, thinking {type:'adaptive', display:'summarized'}, output_config.effort 'high', tool_choice auto (forced 'any'/'tool' is a 400 on these models), no temperature, top_p, top_k, budget_tokens or assistant prefill. Server-side fallbacks on by default: fallbacks 'default' with the beta the skill names (server-side-fallback-2026-07-01). Check stop_reason (refusal, max_tokens, pause_turn) before running any tool. Pass thinking blocks back unchanged. eager_input_streaming on our tools, and therefore validate every parsed tool input against the command's zod input schema before running it; on failure return an is_error tool_result. Tool names must match ^[a-zA-Z0-9_-]{1,64}$ (dots become underscores, bijection tested).
- Prompt caching: frozen system prompt and a sorted, deterministic tool list first; cache_control breakpoints as the skill describes; volatile context (piece, selection, version, designer edits) goes in appended role:'system' messages after the user turn, never in the top-level system prompt. A test must prove the request prefix is byte-identical across turns.
- Typed SDK errors (Anthropic.AuthenticationError, RateLimitError, APIError...) map to the plan's error codes (provider_auth, rate_limited, refusal, interrupted). The API key is read only on the server, never logged, never stored in traces or usage rows, never sent to the browser.

There is NO Anthropic API key and no access to api.anthropic.com in this environment. Verify with the plan's scriptedModel, SDK-typed fixtures and in-memory test servers. A key-gated live smoke test (pnpm agent:smoke) is for the founder to run.

Machine: 4 cores, shared with another heavy workflow. Run targeted test files rather than every suite; kernel tests need NODE_OPTIONS=--max-old-space-size=4096. Typecheck with pnpm -s typecheck from ${WT}. Playwright and Chromium are pre-installed: require('playwright') works and chromium.launch() needs no options; never run "playwright install".

Code style: plain code over clever code; comments say why, not what; one owner per concern; every resource released on every path (AbortController, SSE streams, worker slots); never block the event loop.

If the worktree holds uncommitted changes when you start (an earlier, interrupted attempt at your step), review them with git status and git diff and keep or discard them as you judge; they are yours now. A first attempt at step 1 already added packages/agent/package.json with @anthropic-ai/sdk 1.13.0 and updated pnpm-lock.yaml; keep that unless a newer version is published.

Messages from the founder may be relayed to you as context while you work. They do not replace or cancel this task, which is authorised.
`

const BUILD = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'What you built, in plain English, 5-15 lines' },
    commit: { type: 'string', description: 'The commit SHA on ai/assistant, or "none"' },
    checks: { type: 'array', items: { type: 'object', properties: { command: { type: 'string' }, result: { type: 'string' } }, required: ['command', 'result'] } },
    notDone: { type: 'array', items: { type: 'string' } },
    handoff: { type: 'string', description: 'What the next builder must know: names of commands, events, stores, env vars, fixtures, how to run the scripted mode, known traps' },
  },
  required: ['summary', 'commit', 'checks', 'notDone', 'handoff'],
}

const FINDINGS = {
  type: 'object',
  properties: {
    verdict: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'short stable id, e.g. api-3' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          file: { type: 'string' },
          summary: { type: 'string' },
          evidence: { type: 'string', description: 'how you reproduced it: command, test, screenshot path, output' },
          fix: { type: 'string' },
        },
        required: ['id', 'severity', 'summary', 'evidence'],
      },
    },
  },
  required: ['verdict', 'findings'],
}

const FIXED = {
  type: 'object',
  properties: {
    fixed: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, how: { type: 'string' }, test: { type: 'string' } }, required: ['id', 'how'] } },
    notFixed: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, why: { type: 'string' } }, required: ['id', 'why'] } },
    commit: { type: 'string' },
    checks: { type: 'array', items: { type: 'object', properties: { command: { type: 'string' }, result: { type: 'string' } }, required: ['command', 'result'] } },
  },
  required: ['fixed', 'notFixed', 'commit', 'checks'],
}

const opts = (label, phase, schema) => ({ label, phase, schema, effort: 'high' })
const handoffs = []
const prior = () => handoffs.length ? `\nHANDOFF FROM EARLIER STEPS (trust but verify against the code):\n${handoffs.map((h, i) => `--- step ${i + 1} ---\n${h}`).join('\n')}\n` : ''

const STEPS = [
  {
    key: 'core',
    prompt: `STEP 1 of 5: contract, plumbing and the agent core (plan section 7, steps 1 and 2).
Build: the schema events and command changes of plan section 3 (api/events.ts with ServerEventSchema and RunEventSchema, threads/runs/steps/messages fields, view.capture, ui.context and ui.navigate as tool commands, design.revert {runId}, budget_exceeded), the database migrations, the events.ts named-event fix and a typed onServerEvent in the studio, message seq. Then packages/agent: tools.ts (tools from the registry filtered by isToolCommand, sorted, z.toJSONSchema with io 'input', eager_input_streaming, strict only where valid), prompt/core.ts plus skills as TS strings (spec chat, editing, photo to design, replacing a stone, answering about a selected part) and a node reference generated from the node schemas, describe.ts (chip text, satisfies Record<ToolName, ...>), shape.ts, events.ts reducer, feedback.ts, model.ts (ModelClient.stream plus scriptedModel(turns)), pricing.ts (MODELS for the four allow-listed models, TIERS with the default mapping, cost from usage including cache reads and writes and Haiku's long-prompt rate), anthropic.ts (the request builder typed against the SDK's beta streaming params, and the adapter from SDK stream events to our RunEvents).
The prompts matter: they are what makes the founder's first test good. Ground them in the repo's design knowledge (packages/canon: style guides, rules, suggestParameters, lintDesign; the node schemas; the templates and recipes) so the model builds sound, manufacturable jewelry with few questions (plan: "spec, not interrogation").
Proof: typecheck; snapshot tests of the tool list, the node reference and the prompt hash; a test that every tool's JSON schema is one the API accepts (no $ref cycles, object at the root, names valid); the request builder test against SDK types; existing suites still green (schema, server rpc tests).`,
  },
  {
    key: 'loop',
    prompt: `STEP 2 of 7: the loop, approvals and feedback (plan section 7, steps 3 and 4).
Build in apps/server/src/assistant/ and packages/agent: host.ts, driver.ts (live runs, AbortController, event ring buffer, one run per thread), loop.ts step(host, runId) resumable from the database, gate.ts (tiers, rights filter, loop breaker, the human-edit overlap check), the run SSE route GET /api/runs/:id/events (open only while a run is live; org-scoped), threads.send (idempotent on clientMessageId), runs.cancel, runs.decide, client.respond, usage ledger and budget (key \${runId}:\${idx}:llm, priced from response.model, monthlyBudgetUsd checked before each call, caps of 40 turns and $3 per run with Continue), restart resume (running -> failed interrupted; awaiting-approval resumes), design.revert {runId}, the feedback hook. The key and the tiers (see CONTEXT): the key store, the non-tool settings commands (get, set key, test key, remove key, set tier mapping and default tier) with their role checks, and registering or unregistering the assistant service at runtime when a key is saved or removed (session.get capabilities.assistant follows it at once); ANTHROPIC_API_KEY in apps/server/.env wins. With no key the assistant commands answer the plan's not-configured error and the studio shows the key form. threads.send and the run carry the chosen tier; the request builder resolves tier to model and applies that model's request differences. Env overrides for tier and models: unknown values give a clear start-up warning and fall back to the defaults. Add a test-only mode PAVE_ASSISTANT=scripted:<fixture> that registers the assistant with scriptedModel and fixtures under a fixtures folder, so the studio and Playwright can be driven with no key; it must be impossible to enable by accident in normal use (log a loud line when on).
Attachments: photos attached to threads.send reach the model as image blocks (long edge resized as the plan says; JPEG/PNG/WebP; HEIC out of scope) and are stored as assets.
Proof: scripted integration tests with testServer(): a brief to pieces.create, setSpec, approval, buildFromSpec, design.apply, a fix; deny; resume from a fresh driver; cancel in each phase; overlap conflict; truncation (max_tokens with a tool call); refusal; budget exceeded; replay idempotency; the ledger; a property test that requests stay append-only and byte-identical in their prefix; the no-key path; saving a key turns the assistant on without a restart and removing it turns it off; the key never appears in any RPC output, log line, trace or usage row (search for it); a member who is not owner or admin cannot set the key in accounts mode; each tier resolves to its model and each model gets its own request shape; an org cannot read another org's run events.`,
  },
  {
    key: 'dock',
    prompt: `STEP 3 of 8: the studio dock, AI jobs and the three stages (plan section 1 and section 7, step 5).
The founder's model of the product, which this and every later step serves: a piece moves through three stages, Design, then CAD, then Render. Each stage can be done entirely by hand, or by an AI job: design to CAD is an AI job, CAD to renders is an AI job, and a human monitors each job and changes its outputs. Show the three stages as a stepper on the piece, in that order. The existing CAD workspace is the CAD stage: if its tab is labelled Design today, relabel it CAD, and give the Design stage to the directions that step 5 builds (until then it can show the brief, the references and the spec).
An AI job is an assistant run with a stage, a one-sentence goal, a short plan of steps shown before it starts, live progress, and outputs (design changes, directions, takes). Build it on the same loop and run records, adding only the fields you need (for example stage, goal, plan, outputs); do not build a second engine. Jobs are started from a stage's button ("Propose directions with AI", "Make the CAD with AI", "Render with AI") or from the chat; both are the same thing and both show in the job panel and the dock. The human monitors as it works: a job panel on the piece shows the plan with each step's state, the live viewport or takes, the chips with Undo, cost and time so far, and Pause, Resume, Stop and Take over (a manual edit pauses the job; Resume replans from the current state; the overlap gate keeps the human's edit). When a job finishes, its outputs wait for review: Accept, change them by hand or by chat ("make the band thinner", "redo the top view darker"), or re-run one step. This step builds the stepper, the job record and the job panel; steps 4 to 6 fill in what each job does.
Build apps/studio/src/features/assistant/ per the plan: Conversation, MessageView (markdown, no raw HTML), ToolChip (past-tense label, Undo, History), ApprovalCard, SpecCard inline variant with Build it, Composer shared with Home (attach photos by button, drag and drop and paste; show thumbnails; IME-safe Enter), ContextChips (piece, selection, attachments; removable), ThreadList, the NoKey panel (the short paste-your-key form from CONTEXT, plus one line that Claude Code can connect over MCP instead), Settings, AI (key field with Test, Save, Remove and the last four characters; the "from .env" state; the three tiers with their model, a model menu per tier from the allow-list, price per million tokens and a rough cost per typical run; the default tier; this month's AI spend), a tier picker in the composer (Power, Standard, Light, showing the model name under each), error states by code with Retry, the run cap pill "Paused at $3 · Continue", the run footer with tokens and cost, the "Assistant is working · Stop" pill, useRunStream, the live CAD cache patch (design.changed with version === cached + 1 patches with applyOps, else invalidate) and the touched-node tint, mod+j to open with the current selection, Esc to stop, role="log" announcements.
Ask AI: expose a small public API in stores/assistant.ts, e.g. openAssistant({ pieceId, selection, draft }), that opens the dock with the selection as a context chip and the composer focused. Do NOT add "Ask AI" items to the CAD context menus: another branch is adding those and will call your API at merge time; put the exact API in your handoff.
Follow the look and components already in the studio and packages/ui; the existing CAD workspace is in apps/studio/src/features/cad.
Proof: studio tests; typecheck; a production build; then boot the server in scripted mode on a spare port with a temporary PAVE_DATA_DIR and take Playwright screenshots at 1440x900 and 390x844 (light; and dark if the studio has it) of: empty dock, no-key panel (start without the scripted mode and without a key), Settings AI with no key, with a saved key (use an obviously fake key; Test shows the could-not-reach message because this machine has no route to the API), and with the key from .env, the composer tier picker, streaming text, tool chips, spec card, approval, an error, the cap pill, live CAD update with tint. Also screenshot the stage stepper and the job panel (planned, running, paused after a manual edit, finished awaiting review). Save them under ${SHOTS}/dock/ and look at every one yourself; fix what looks wrong before you finish.`,
  },
  {
    key: 'photo',
    prompt: `STEP 4 of 8: seeing the design, and photo to design (plan section 7, step 6; docs/plans/reference-match.md). Photo to design runs as a CAD-stage AI job (see step 3's handoff), and can also be started from the chat.
Build view.capture through the ClientBridge (target the originating clientId, else any window of the user; wait for the kernel at the requested version; render without requestAnimationFrame at DPR 1, 768 px, inspection materials; reuse the live viewport's renderer; see apps/studio/src/features/cad/capture-tool.ts and the viewport). With no studio window, fall back to a server-side image so the model can still see (the plan's 'lines' fallback, or a shaded render with the @pave/match software rasteriser if that is simpler and better; state which). ui.context and ui.navigate.
Photo to design with only a Claude key (no segmentation model is available): (1) a structured read of the photo (a reference.read or similar tool command, metered on the llm meter, using a separate Messages call with structured output) giving piece kind, view, stone shapes and arrangement, setting style, prong count, band profile and widths as ratios, metal colour, each with a visibility flag; (2) build through the canon (suggestParameters, recipes or templates) and pieces.setSpec / buildFromSpec; (3) view.capture from the camera that matches the photo's view; (4) the model compares the capture with the photo side by side and makes targeted edits, at most a few rounds, reporting what still differs. If the photo has a plain background, add a classical subject matte (no model: thresholding and flood fill from the border) and, where it fits the remaining time, a match.fit tool that runs @pave/match's fitter on that matte in a worker with cancellation and a time budget, gated by checkTarget and FIT_FLOOR, and reporting quality honestly. If match.fit does not fit in this step, leave it out and say so in notDone rather than shipping something half-working.
Proof: tests with scripted turns and synthetic photos made from kernel renders of templates (ground truth known); capture tests; a Playwright run in scripted mode where a photo is attached and a design appears; screenshots under ${SHOTS}/photo/ that you look at.`,
  },
  {
    key: 'design',
    prompt: `STEP 5 of 8: the Design stage, and the design-to-CAD AI job.
The founder's definition of the product, which every remaining step serves: one AI assistant that carries a piece from design to CAD to a Blender render, and he will not test until that whole journey works.
This step is the design stage, with only a Claude key: no image-generation model is configured, and you must not add one. Build "directions": from a brief, a photo or saved references, the assistant proposes two to four distinct directions, each a one-line idea plus a built parametric variant (through the canon, recipes and templates, so each is sound and manufacturable), shown side by side in the dock and on the piece as cards with a captured preview, the key facts (metal weight, carats, stone count, a rough cost from the existing estimate) and the canon's style notes. The user picks one, or mixes ("the band of B with the head of A"); the others stay as alternatives he can return to; the chosen one moves to the CAD stage. Directions are a Design-stage AI job ("Propose directions with AI") and can also be made by hand (from templates).
The design-to-CAD AI job ("Make the CAD with AI"): from the chosen direction, or straight from a brief or a photo, it turns the draft into production-ready CAD: production detail; every manufacturability check run, and each warning fixed or explained; ring size or length set; stone fit and seats checked; weights, carats and cost confirmed; and a short report of what it changed and what the human should look at. Its outputs then wait for review as step 3 describes. Decide whether directions are variants of one piece or separate pieces in a collection by what the schema already supports (pieces.duplicate, collections, variants) and the least new contract, and say why. Use the ideas board only as far as it serves this (attaching references; keyless reference search only if already built). The UI says plainly that image concepts need an image model, which is not part of this build. Write a directions skill prompt: directions differ in one or two big decisions, not in many small ones; they are grounded in the canon; and they are honest about trade-offs (stone size against budget, durability, comfort).
Proof: scripted tests (a brief, three directions, a pick, a mix, then a chat edit on the chosen one; a design-to-CAD job that fixes a seeded manufacturability warning, paused by a manual edit, resumed, and accepted); Playwright screenshots of the direction cards at 1440x900 and 390x844 under ${SHOTS}/design/ that you look at.`,
  },
  {
    key: 'render',
    prompt: `STEP 6 of 8: the Render stage and the CAD-to-render AI job, the last stage of the founder's journey (design, then CAD, then render).
The CAD-to-render AI job ("Render with AI"): it proposes a shot set for the piece kind and a look, shows the plan (shots, looks, size, the estimated machine time, and how much of the plan's render allowance it would use, from step 7) before it starts, renders, critiques each take with its own vision, re-renders what falls short a bounded number of times, and hands over a set for review. The human can swap a take, change a shot or look and re-render, star, and set the cover. Rendering by hand in the Render tab stays fully available.
The server already has a Blender render queue (apps/server/src/engines/render/: queue.ts, take.ts, Blender discovery, process handling) and the renders.* commands. The plan is docs/plans/render-and-models.md: build what this step needs from its sections 1 to 5; brand models and on-model imagery are out of scope.
Build (a) the Render tab on a piece: default shots by piece kind (Hero, Front, Top, Macro); looks in plain words (studio white, black acrylic, soft gradient; metal and stones taken from the design); size and quality presets with an honest time estimate; Render and Render all; progress with a ring, ETA and Cancel; a takes filmstrip; compare; star; set as cover; download; stale takes after a design change with Re-render; the Blender status dialog (found or not, version, a path field, Re-check, and how to install it with node scripts/install.mjs --render); with no Blender, a preview from the live viewport clearly labelled "Preview quality".
Build (b) the assistant end to end: renders.create is already a tool, so check its gate tier and that a render shows its machine time, not dollars. The run waits for the take without holding a model call open (an event or a poll tool, per the loop design). The finished image appears inline in the conversation and in the Render tab. The model looks at the render with its own vision and offers concrete changes (light, angle, backdrop, or a design fault it spots), and a re-render is one approval. "Render it in rose gold and platinum" makes one take per variant with a shared groupId.
Blender is installed here: set PAVE_PYTHON=/home/user/ffdraft/workers/render/.venv/bin/python (bpy 5.3.0). Use it read-only and change nothing in that checkout.
Proof: a real Blender take of a template started by the assistant in scripted mode (low samples, to stay fast on this 4-core machine), saved under ${SHOTS}/render/ and looked at; scripted tests for the wait, cancel, stale, critique and variants; Playwright screenshots of the Render tab at 1440x900 and 390x844.`,
  },
  {
    key: 'plans',
    prompt: `STEP 7 of 8: plans, allowances and the upgrade screen.
The founder's pricing model: the free version includes the CAD software in full (design, CAD, checks, previews, and the AI jobs with his own Claude key). Blender renders and CAD-format exports (Rhino .3dm and STEP) are paid, with some free each month. STL is always free and never counted (the founder's decision), and so are the other mesh formats (3MF, OBJ, GLB).
Build a plans module with two plans, Free and Pro, defined in one small config file so the founder can change the numbers. Defaults, which he will change later: Free gets 5 Blender renders and 5 Rhino or STEP exports per calendar month (UTC); Pro is unlimited, with a fair-use ceiling as a constant. What counts: each finished Blender take is one render; each Rhino .3dm or STEP export is one export; STL, 3MF, OBJ and GLB exports never count; a production package counts as one export when it contains a .3dm or STEP file; browser previews and the captures the AI takes to see the design never count.
Enforcement is on the server, before the work starts, for renders.create, design.export and production.create, and for the same actions taken by AI jobs and MCP. An export made in the browser must first claim its allowance from the server (a claim command), so the server still decides. Each action is counted once, with an idempotency key; the count is released when the work fails or is cancelled before delivery; and it is race-safe: two tabs cannot both take the last free one, because the database decides (a unique constraint or a row lock).
Over the limit, the server answers a typed error (plan_limit) that the studio turns into a calm card ("You have used your 5 free renders this month. Pro has unlimited renders.") with Upgrade. AI jobs plan within the allowance and ask before spending the last free render or export.
Settings gains a Plan section: the plan, this month's use, and when it resets. An Upgrade screen compares the plans with no checkout yet: payments are not part of this build, and it says so. In local mode PAVE_PLAN=pro in apps/server/.env switches plans for testing. In accounts mode the plan belongs to the organisation.
Proof: tests for each counted action; the release on failure and cancel; the race; the monthly reset; MCP and AI jobs at the limit. Playwright screenshots of the upgrade card, Settings Plan and the Upgrade screen at 1440x900 and 390x844 under ${SHOTS}/plans/, looked at.`,
  },
  {
    key: 'mcp',
    prompt: `STEP 8 of 8: MCP, the live smoke test, and the founder's instructions (plan section 7, steps 7 and 8). The founder's journey to document and smoke-test is the three stages, each by hand or as an AI job he monitors: Design (directions), then CAD (the design-to-CAD job, then edits by chat and by hand), then Render (the CAD-to-render job with Blender). Document the Free and Pro plans and PAVE_PLAN too.
Build: stateless HTTP MCP at /mcp with the same tool definitions and result shaper (official @modelcontextprotocol/sdk; newest version), skills as MCP prompts, calls recorded as steps of a rolling mcp run with an agent actor, confirm-tier tools raising the studio approval card and waiting 60 s; local mode checks Host and Origin; accounts mode 404 until API keys exist. A stdio proxy bin pave-mcp so Claude Code can connect with one command; put that command in the README.
pnpm agent:smoke: key-gated; reads ANTHROPIC_API_KEY from the environment or apps/server/.env; boots the server in memory; runs (a) a text brief to directions and a built design, (b) a photo to a design using a kernel-rendered photo of a template, (c) one chat edit, (d) a Blender render with low samples when Blender is found (skipped with a clear line otherwise) and the model's critique of it; asserts the run finished, the design evaluates, a second turn reads from the cache, no thinking block was dropped, and prints tokens and dollars per run; refuses to run without a key with a clear message; never prints the key.
Docs and install: apps/server/.env.example gains ANTHROPIC_API_KEY and the tier and model overrides (commented, with the allow-list and prices); scripts/install.mjs --check reports whether a key is set (in .env or saved in the app) without printing it; README.md gains a section "Use the assistant with your Claude API key" (where to get a key; paste it in Settings, AI, or put it in apps/server/.env; what to try first: the whole journey from a brief or a photo to directions, to CAD edits, to a Blender render, with three example briefs; installing Blender with node scripts/install.mjs --render; Power, Standard and Light, which model each uses and roughly what a run costs on each; how to change a tier's model; the no-key panel, connecting Claude Code over MCP instead, troubleshooting 401/429/refusal) and the "What works today" table is updated honestly; docs/ARCHITECTURE.md and any docs tests updated for the new files.
Proof: MCP test with an in-process SDK client (tools/list, apply an op, the change carries an agent actor); agent:smoke without a key prints the refusal and exits non-zero; typecheck; the installer's --check; every test you touched.`,
  },
]

phase('Build')
const builds = []
for (const s of STEPS) {
  const r = await agent(`${CTX}${prior()}\n${s.prompt}\n\nReturn your report through the schema. "checks" lists every command you ran to prove the work and its result; "notDone" is honest.`, opts(`build:${s.key}`, 'Build', BUILD))
  if (!r) { log(`build:${s.key} returned nothing; stopping the build here`); break }
  builds.push({ key: s.key, ...r })
  handoffs.push(`[${s.key}] commit ${r.commit}\n${r.summary}\nNot done: ${r.notDone.join('; ') || 'nothing'}\n${r.handoff}`)
  log(`build:${s.key} done (${r.commit}); not done: ${r.notDone.length}`)
}

const LENSES = [
  {
    key: 'api',
    prompt: `Lens: Claude API correctness and loop durability. Load the claude-api skill and its docs first (see CONTEXT). Check every request the code can build for each of the four allow-listed models and each tier, including a tier switch mid-conversation: forbidden parameters, the fallbacks beta, thinking replay, eager input validation, stop_reason handling (refusal, max_tokens, pause_turn), tool schemas the API accepts, tool-name bijection, caching (byte-identical prefix across turns, breakpoint placement, nothing volatile before the last breakpoint), compaction, typed error mapping, cancellation mid-stream and mid-tool, restart resume, ledger idempotency, waiting for a render without holding a model call open, and images (photos, captures, renders) sent to the model at sizes and types the API accepts. Write a failing test or script for every finding before you report it.`,
  },
  {
    key: 'safety',
    prompt: `Lens: security, privacy and cost. The API key: never logged, never in traces, usage rows, SSE, RPC output or the studio bundle; .env ignored by git; the saved-key file or column protected as CONTEXT says and never copied into exports, backups made by the app, or error messages; the key settings commands unreachable by the model and MCP, role-checked in accounts mode, and protected against cross-site requests in local mode (Origin and Host checks). Prompt injection: text inside a photo, a filename, a node name or an attachment must not trigger a confirm-tier tool without the human, nor reach non-tool commands. Gate and rights: the agent has the user's role. Org isolation of threads, runs and run events. Budget and caps cannot be bypassed (Continue, retries, MCP). Plan allowances cannot be bypassed either: a browser export without a claim, parallel requests for the last free one, retries, MCP, AI jobs, or cancelling after the file was delivered. Renders: the model cannot queue unbounded Blender work (a cap per run and per org), Cancel and shutdown kill the whole Blender process tree, and the Blender path setting cannot be used to run an arbitrary program from the model or a cross-site request. MCP: Host and Origin checks, bind address, no access in accounts mode. Upload limits on attachments. Licences of new dependencies are compatible with a proprietary product. Reproduce every finding (test, curl against a scripted-mode server, or script).`,
  },
  {
    key: 'e2e',
    prompt: `Lens: the founder's first hour, end to end in a browser. His definition of the product: one AI assistant that carries a piece from design to CAD to a Blender render; he will not test until that whole journey works. Follow README.md from the top as he would (in ${WT}; skip only the network install), build the studio, start the server in scripted mode on a spare port with a temporary PAVE_DATA_DIR and PAVE_PYTHON=/home/user/ffdraft/workers/render/.venv/bin/python (Blender, read-only), and drive with Playwright: the whole journey first, as AI jobs he monitors (a brief to a directions job, a pick, the design-to-CAD job: watch it, pause it with a manual edit, resume, accept and change an output by chat; then the CAD-to-render job with Blender: the plan, the takes, the critique, a re-render in another metal, swapping a take, the takes in the Render tab); the same three stages by hand; the free allowance running out (the upgrade card), and PAVE_PLAN=pro lifting it; then a text brief to a spec card to Build it to a design in the CAD view; a photo attached to a read, a design and a comparison; a chat edit with a chip and Undo; an approval denied; Stop during a run; the no-key panel (a server with no key and no scripted mode); pasting an obviously fake key in Settings, AI, Test (expect a clear could-not-reach message here), Save, the last four characters shown, Remove; choosing Power, Standard and Light and changing Light's model to Haiku, and seeing the run carry the tier; the cost footer; mod+j with a selection; the 390 px width. Also run pnpm agent:smoke without a key and the installer's --check. Save screenshots under ${SHOTS}/review/ at deviceScaleFactor 1, look at each, and report defects with the screenshot path as evidence. Judge it as the founder would: would this make him believe the product works?`,
  },
]

const reviewPrompt = (l) => `${CTX}\nYou are an adversarial reviewer, not the builder. Review the work on branch ai/assistant in ${WT}: git diff e5d18f2..HEAD, plus running it. The builders' reports:\n${builds.map((b) => `[${b.key}] ${b.summary}\nNot done: ${b.notDone.join('; ') || 'nothing'}`).join('\n')}\n\n${l.prompt}\nReport only what you reproduced. Severity: blocker = the founder's test fails or data, money or the key is at risk; major = a flow is wrong or misleading, or a rule above is broken; minor = polish. Do not fix anything; do not commit.`

let findings = []
if (builds.length > 0) {
  phase('Review')
  const reviews = await parallel(LENSES.map((l) => () => agent(reviewPrompt(l), opts(`review:${l.key}`, 'Review', FINDINGS))))
  findings = reviews.filter(Boolean).flatMap((r) => r.findings)
  log(`review: ${findings.length} findings (${findings.filter((f) => f.severity === 'blocker').length} blockers, ${findings.filter((f) => f.severity === 'major').length} majors)`)
}

phase('Fix')
const rounds = []
let open = findings.filter((f) => f.severity !== 'minor')
const minors = findings.filter((f) => f.severity === 'minor')
for (let round = 1; round <= 2 && open.length > 0; round++) {
  const fix = await agent(`${CTX}\nYou fix review findings on branch ai/assistant in ${WT}. For each finding: first write a test that fails for the right reason, then fix, then run it. Fix every blocker and major below; also fix minors that are cheap and safe. Do not weaken or skip a test to get green. Commit once at the end.\n\nFINDINGS (blockers and majors):\n${JSON.stringify(open, null, 1)}\n\nMINORS (optional):\n${JSON.stringify(round === 1 ? minors : [], null, 1)}`, opts(`fix:${round}`, 'Fix', FIXED))
  if (!fix) break
  const verify = await agent(`${CTX}\nYou are an independent verifier, not the fixer. On branch ai/assistant in ${WT}, check each claimed fix by reproducing the original failure scenario, then do a regression pass: pnpm -s typecheck; the agent, server and studio tests that the change touches; the studio build; and a short Playwright pass in scripted mode over the dock's main flows with screenshots under ${SHOTS}/verify-${round}/ that you look at. Report as findings everything still open or newly broken (keep the original ids for findings that are still open). Do not fix anything.\n\nFINDINGS THAT WERE TO BE FIXED:\n${JSON.stringify(open, null, 1)}\n\nTHE FIXER'S REPORT:\n${JSON.stringify(fix, null, 1)}`, opts(`verify:${round}`, 'Fix', FINDINGS))
  rounds.push({ round, fix, verify })
  open = verify ? verify.findings.filter((f) => f.severity !== 'minor') : open
  log(`round ${round}: fixed ${fix.fixed.length}, not fixed ${fix.notFixed.length}; still open after verify: ${open.length}`)
}

return {
  builds: builds.map((b) => ({ key: b.key, commit: b.commit, summary: b.summary, checks: b.checks, notDone: b.notDone })),
  findings,
  rounds: rounds.map((r) => ({ round: r.round, fixed: r.fix.fixed, notFixed: r.fix.notFixed, commit: r.fix.commit, stillOpen: r.verify ? r.verify.findings : null })),
  open,
}
