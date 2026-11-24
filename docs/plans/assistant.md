# The assistant: runtime, tools, traces, approval, MCP, and the conversation UI

Build brief: the judged synthesis of two independent design proposals.

## 1. Experience

1. **Home → dock.** `pages/home/Composer.tsx` already uploads attachments. Enter calls `threads.send` with no `threadId`, then `assistant.open({ threadId })`. When the run's `pieces.create` succeeds, the server binds `thread.context.pieceId`. The window follows to the piece only if the route is unchanged since send; otherwise an "Open piece" chip appears.
2. **Spec, not interrogation.** After at most one round of questions the model calls `pieces.setSpec`, shown inline with `openQuestions` as quick replies. It then calls `pieces.buildFromSpec` (`confirm`), and the card's primary button **Build it** is the approval. Editing a field is a human `pieces.setSpec`; "Change something…" denies with a note.
3. **Watching.** Text streams as markdown. Each mutation is a past-tense chip from `Change.label` ("Widened the band to 2.4 mm · Undo · History"). Queries collapse to one quiet line ("Looked from front, side, top", thumbnails on expand). In an open Design tab the geometry updates per change and touched nodes tint once (reduced motion: a static outliner badge). A viewport pill reads "Assistant is working · Stop". A run ends with two lines, a facts row, **Undo all**, tokens and cost.
4. **Approval.** One plain sentence, the exact stored input on expand, and an estimate only when the service supplies one. It survives reload, quit and restart, and never steals focus.
5. **Context chips.** Piece, board, selection and attachments, each removable. `viewOnly` references show a lock: "inspiration only — not shown to the assistant".
6. **States.**
   - Empty: three context-aware starters.
   - Loading: skeleton from `threads.get`, then the live tail.
   - Error: by code (`rate_limited`, `provider_auth`, `refusal`, `interrupted`) with Retry; applied edits stay undoable.
   - Run cap: "Paused at $3 · Continue".
   - Budget: explanation plus an admin link.
   - No key: one calm panel naming the env var, plus "Connect Claude Code via MCP", which needs no key. Home degrades to `pieces.create {brief}` and templates.
7. **Keyboard and screen readers.** `mod+j`; Enter and Shift+Enter (IME-safe); Esc stops. The conversation is `role="log"` and announces completed blocks and approvals only.

## 2. Structure

**`packages/agent`** — pure TS, with subpath exports like `@pave/render`: `.` (isomorphic), `./anthropic`, `./mcp`.
- `tools.ts` — tools from `commands` filtered by `isToolCommand`; dots become underscores (bijectivity tested); sorted; `z.toJSONSchema(input, {io:'input'})`; `eager_input_streaming`; `strict` only where the schema has no records. One global list, never varied by role or capability.
- `prompt/{core,skills/*,node-reference}.ts` — TS strings, not `.md`, so CRLF checkouts cannot change the bytes. The node reference is generated from `NODE_SCHEMAS` with UI-only meta stripped.
- `loop.ts` — `step(host, runId)`, resumable from the DB.
- `gate.ts` — tiers, rights filter, loop breaker, the human-edit overlap check.
- `shape.ts` — one result shaper for both the loop and MCP: truncate, drop `inverse`, attach asset images, append the evaluation after `design.apply`.
- `describe.ts` — chip text, `satisfies Record<ToolName, …>`, so a new tool command without a label fails typecheck.
- `events.ts` — the `RunEvent` reducer, shared by tests and the studio.
- `feedback.ts` — pure `detectFeedback`.
- `model.ts` — `ModelClient.stream(params, {signal})` over SDK types, plus `scriptedModel(turns)`.
- `anthropic.ts`, `pricing.ts` (`MODELS`, `DEFAULT_MODEL`), `mcp/server.ts`, `mcp/stdio.ts` (bin `pave-mcp`, a Node stdio-to-HTTP proxy).

**`apps/server/src/assistant/`**
- `host.ts` — builds `Ctx` once per run and spreads `{...ctx, actor}` per call; `Runtime.context` costs two queries.
- `driver.ts` — live runs, AbortController, event ring buffer, one run per thread.
- `bridge.ts` — `ClientBridge`.
- `routes.ts` — `GET /api/runs/:id/events` and `/mcp`.
- New handlers extend `handlers/assistant.ts`; the feedback hook runs fire-and-forget after `commitChange`, like `refreshFacts`.

**`apps/studio/src/features/assistant/`**
- `Conversation`, `MessageView`, `ToolChip`, `ApprovalCard`, `Composer`, `ContextChips`, `ThreadList`, `NoKey`, `useRunStream.ts`, `client-tools.ts`, `commands.ts`.
- Reuse, do not rebuild:
  - Lift `pages/piece/SpecCard.tsx` to `components/SpecCard.tsx` with an `inline` variant and a footer slot.
  - Move `describe(op, inverse)` out of `PieceHistory.tsx` into `lib/ops.ts`.
  - Put `Markdown` (no raw HTML, memoised per block) in `@pave/ui`; briefs are markdown too.
  - One `Composer` for Home and the dock.

**State.** The server owns threads, messages and runs. `useRunStream` holds the live tail only. `stores/assistant.ts` gains `activeThreadId`, the draft, chips and `activity {pieceId, runId, nodeIds, label}`, which the CAD feature reads for the tint and pill.

**Live CAD seam.** A typed `onServerEvent('design.changed')` patches the `pieces.get` cache with `applyOps` when `version === cached + 1`, otherwise invalidates.

## 3. Contract changes

**Commands** (not `tool` unless marked):
- `threads.send {threadId?, text, attachments: id[]≤8, referenceIds: id[]≤12, context:{pieceId?, boardId?, selection: string[]}, clientId, clientMessageId}` → `{thread, run}`. Idempotent on `clientMessageId`; pending approvals are auto-denied; 501 through `services.require('assistant')`.
- `runs.decide {runId, toolCallId, decision:'approve'|'deny', note?}` and `runs.cancel {runId}` → `Run`.
- `client.respond {requestId, output?, error?}`.
- `view.capture` (tool) `{pieceId, views: CameraPreset[1..4], highlightNodeIds?, style:'shaded'|'clay'|'lines'}` → `{version, source:'studio'|'server', images:[{view, assetId}]}`.
- `ui.context` (tool, query) and `ui.navigate` (tool) `{pieceId?, tab?, boardId?, selectNodeIds?}`.
- `design.revert` input becomes `{pieceId, seq?, runId?}` (exactly one; tool inputs must be a top-level object). A run reverts as one change.
- `threads.get` gains `run: Run|null`; `traces.run` gains `feedback[]`; `org.settings.*.assistantModel` becomes nullable (null means `DEFAULT_MODEL`).

**Entities**
- New `api/events.ts`: `ServerEventSchema`, moved from `apps/server/src/events.ts`, plus `run.updated` and user/client-targeted `client.request`; and `RunEventSchema` with a per-run `seq`: `run.started`, `text.delta`, `thinking.delta`, `message.completed`, `tool.started`, `tool.awaiting`, `tool.finished{changeIds, assetIds}`, `usage`, `run.finished`.
- `Message.role` gains `'system'`; `Message` gains `seq`.
- `Step` gains `toolCallId`, `status`, `approval`, `usage`, `stopReason`.
- `Run` gains `origin:'studio'|'mcp'` and `errorCode`.
- `FeedbackSchema {source, kind:'up'|'down'|'undone'|'corrected'|'removed', changeId?, detail}`.

**Server**
- `Services.assistant {capabilities:{assistant:true}; model}`.
- `EventBus.publish` takes an optional target; `/api/events?client=<id>` registers presence.
- `traces.beginStep` / `completeStep` (unique on `runId, toolCallId`) and an atomic `addUsage`.
- `ErrorCode` gains `budget_exceeded`.
- Migrations: `agent_message.seq`, step, run and feedback columns, `thread.prompt_hash`, `run_feedback.rating` nullable.
- `threads.list` filters to the caller's own threads.

## 4. Hard parts & decisions

1. **Durable manual loop** (both agree). Use `client.beta.messages.stream` + `finalMessage()`; truth is the message and step rows.
   - Queries run concurrently, mutations in order, all results in one user message; confirm calls run the rest first, then suspend.
   - Every terminal state closes dangling `tool_use` blocks with synthetic results.
   - `max_tokens` with a tool call re-issues once; `refusal` never runs tools.
   - On boot, `running` becomes `failed: interrupted`; `awaiting-approval` resumes.
   - *Rejected:* research 05's `toolRunner`, whose approval is an in-memory promise.

2. **Client tools are registry commands (P1), not a run-stream protocol (P2).** The handler asks a studio through `ClientBridge` and `client.respond`, so MCP gets them for free and the loop has only one suspended state.
   - Target the originating `clientId`, else any window of that user.
   - Capture waits for the kernel at `version`, renders without rAF (Electron throttles hidden windows) at DPR 1, 768 px, inspection materials, reusing the live viewport's renderer.
   - With no window, fall back to `lines`: `@pave/production` hidden-line views rasterised by `sharp`, so headless MCP can still see. Otherwise return a typed error.

3. **Frozen prefix.** Default `claude-fable-5-2` (the brief asks for most capable), $8/$40 against Opus 5.5's $4/$20, and it needs 30-day retention. The allow-list is Fable 5.2, Opus 5.5 and Sonnet 5.5, which share one request shape.
   - Request: `effort:'high'`, `thinking:{type:'adaptive',display:'summarized'}`, `tool_choice` auto, `fallbacks:'default'`, a breakpoint on the last system block plus top-level `cache_control`.
   - Context (piece, selection, version, designer edits) goes in appended `role:'system'` messages after the user turn.
   - Compaction: take P1's server-side `compact-2026-01-12`, since verbatim storage already satisfies it. *Rejected:* P2's thread cap.
   - Binding: always send `drop_block` and record `input_transformations` on the step. *Rejected:* P2's send-on-hash-mismatch, which flips the request shape.

4. **Human and agent on one piece.** `changeId = chg_<toolCallId>`. Before `design.apply`, the gate compares intervening non-run changes by node id. On overlap it returns them as an error so the human wins; with no overlap it applies and notes them. *Rejected:* P2's blanket `baseVersion` conflict (needless re-plans) and silent rebase.
   - Feedback: `design.revert` records `undone` exactly; `corrected` and `removed` come from `detectFeedback` over the next 10 changes.

5. **Gate and MCP parity.** Reads and reversible writes run automatically; `confirm` needs a human; non-tool commands are unreachable; the agent has the user's role. `viewOnly` contributes metadata only.
   - MCP: stateless HTTP at `/mcp`, the same `toolDefs()` and shaper, skills as prompts. Calls are steps of a rolling `mcp` run with an agent actor.
   - `confirm` over MCP raises the studio card and waits 60 s, then returns "approve in Pavé and retry"; an identical retry consumes the approval. *Rejected:* P2's off-by-default.
   - Local mode checks Host and Origin; accounts mode returns 404 until API keys exist.

6. **Cost.** Ledger key `${runId}:${idx}:llm`, priced from `response.model`. `monthlyBudgetUsd` is checked before each call. Caps of 40 turns and $3 are constants, with Continue. *Rejected:* P1's `runCapUsd` setting.

**Repo facts the proposals got wrong or missed**
- `lib/events.ts` listens on `onmessage`, but the server sends named events, so no live event reaches the studio today. P2's `DOMAIN_QUERIES` bug is real too.
- Message order is `(createdAt, random id)`, which is not stable enough for byte-identical replay; hence `seq`.
- `CAMERA_PRESETS` has no `back` (P2). There is no `w1568` variant (P2); `THUMB_WIDTHS` tops out at 1920 and is width-only. Add a long-edge model variant in `assets.ts`.
- `references.save` does not fetch URLs, so P2's URL guard is dropped.
- `org_settings.assistant_model` defaults to `claude-opus-5-5`.
- `pieces.create {spec}` builds with no approval; the spec skill routes through `setSpec` then `buildFromSpec`.
- `@pave/render/three` has only `metal.ts` and `space.ts`; `createKernelClient` and `evaluationToThree` are not landed, so capture depends on the CAD workstream.
- Two SSE streams per tab press on the HTTP/1.1 six-connection cap. Open the run stream only while a run is live.

## 5. Verification

- **Vitest**, `scriptedModel` + `testServer()` (in-memory PGlite):
  - trophy → `pieces.create` → `setSpec` → approval → `buildFromSpec` → `design.apply` → `view.capture` → fix;
  - deny, resume from a fresh driver, cancel in each phase;
  - overlap conflict, truncation, refusal, budget, replay idempotency;
  - a property test that requests stay append-only;
  - feedback rows; ledger idempotency.
- **Snapshots:** tool list, node reference, prompt hash; identical on all three CI OSes.
- **Typecheck:** the request builder against `Anthropic.Beta.MessageCreateParamsStreaming`; the adapter against SDK-typed event fixtures.
- **MCP:** an in-process SDK client runs `tools/list` and applies an op; the change carries an agent actor.
- **Playwright:** `e2e/shots.ts` intercepts RPC and 204s `/api/events`, so add a mode that boots `createApp` in memory with `PAVE_ASSISTANT=scripted:<fixture>`. Shots in light and dark: empty, no-key, streaming, chips, spec card, approval, error, cap, live CAD tint. Plus reduced-motion and keyboard-only passes.
- **Not verifiable without keys:** real stream shapes, strict-schema acceptance, cache hits, binding enforcement, fallbacks, compaction, prompt quality, vision critique. Ship a key-gated `pnpm agent:smoke` that asserts zero dropped thinking blocks.

## 6. Scope cuts

- Sub-agents.
- "Always allow" approvals.
- The `viewOnly` override.
- Pixels for unsaved search results (metadata only).
- Key-entry UI and `safeStorage`: the desktop shell registers `assistant` at runtime through `services.register`.
- MCP OAuth.
- Thread rename, branching and message editing.
- Model-written titles (truncate the first message).
- Web search and fetch.
- OTLP.
- The retention purge job (flag to platform).
- Per-user quotas.
- Preview-before-apply.
- Voice.
- HEIC.

## 7. Build order

1. **Contract and plumbing.** Schema events and commands, migrations, the `events.ts` named-event fix, typed `onServerEvent`, message `seq`. Proof: typecheck, `rpc.test.ts`, existing suites.
2. **Agent core.** Tools, prompt, describe, shape, pricing, `scriptedModel`. Proof: snapshots.
3. **Loop.** Host, driver, run SSE, `threads.send`, `runs.cancel`, usage and budget, the Anthropic adapter. Proof: scripted integration tests.
4. **Approval and feedback.** `runs.decide`, restart resume, `design.revert {runId}`, the feedback hook.
5. **Dock.** Stream, chips, spec card, approvals, states, Home hand-off, cache patch. Proof: Playwright shots.
6. **Bridge.** `view.capture` and `ui.*` once the CAD viewport lands; the `lines` fallback.
7. **MCP.** HTTP, then the stdio proxy.
8. **Smoke script** and no-key polish.

## 8. Decided since this brief (they override the sections above)

- **Tiers, not one model.** Power, Standard and Light; defaults Fable 5.2, Opus 5.5 and Sonnet 5.5; any tier may point at any of Fable 5.2, Opus 5.5, Sonnet 5.5 or Haiku 5.5 (`ASSISTANT_MODELS`). The organisation's default tier is Standard (`org.settings.*.assistantTier`, `assistantModels`); the composer picks a tier per conversation (`threads.send.tier`) and a run records it (`Run.tier`). `PAVE_ASSISTANT_TIER` and `PAVE_ASSISTANT_MODEL_{POWER,STANDARD,LIGHT}` in `apps/server/.env` win over the settings (`resolveTiers` in `packages/agent/src/pricing.ts`).
- **Per-model request rules** live in `MODELS`: Haiku 5.5 has no server-side fallback, so its requests carry no `fallbacks`; Fable 5.2 needs 30-day retention, so its 400 maps to `model_unavailable` with a sentence suggesting Standard. Effort is always sent (`high`); two of the models default lower.
- **Error codes** gain `provider_unreachable` (connection failures, 5xx) and `model_unavailable` (no access to the tier's model, retention).
- **Key entry in the app** replaces the scope cut in §6 (built in a later step); `pnpm agent:smoke` runs the real request shape against each tier with the founder's key.
- **Built (loop, approvals, feedback, key):** the loop lives in `apps/server/src/assistant/loop.ts` (it needs the database directly); the gate's pure rules are in `packages/agent/src/gate.ts`. The key is stored in the database per organisation (`assistant_key`), sealed with AES-256-GCM under a key derived (HKDF) from the auth secret, which stays outside the database; `assistant.setup.get` and `assistant.key.{set,test,remove}` (owners and admins; never tools) manage it, and the `assistant` service is registered while any key exists. A run cap (40 calls or $3) ends the run with `run_cap`; "Continue" is a new message. `PAVE_ASSISTANT=scripted:<fixture>` plays `src/assistant/fixtures/<fixture>.json` for tests and Playwright.
- **Built (dock, stages, AI jobs):** a piece moves through three stages, Design, CAD and Render, shown as a stepper in the piece's tabs (the CAD workspace keeps its `/design` path and is labelled CAD; the Design stage is `/pieces/:id/directions` until step 5's directions land). An AI job is an assistant run with `Run.job {stage, goal, plan, continues, review, pausedBy}`; the plan is each stage's recipe in `packages/agent/src/jobs.ts`, moved by the server as the run's tool calls start (`advanceJob`), settled when the run ends (`endJob`), never written by the model. `threads.send.job` starts one (a stage's button or a dock starter), a message in a thread whose job is paused or awaiting review carries it on, and `runs.pause {takeover?}`, `runs.resume {redoStepId?}` and `runs.accept` steer it; a person's edit to the piece pauses its job (`assistant/job-watch.ts`), and Resume is a new run that replans. Run status gains `paused`; run events gain `job.updated`. The studio's dock lives in `apps/studio/src/features/assistant/`; `openAssistant({pieceId, selection, draft, threadId?})` in `stores/assistant.ts` is the entry point for Ask AI.
