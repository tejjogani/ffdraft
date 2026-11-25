# The fake Claude API

`packages/agent/src/testing/fake-api` is a strict, local stand-in for the Claude API, used to test
the assistant harness without a key and to record journeys with Claude in the loop. Test-only:
nothing in the app imports it.

- `POST /v1/messages`, streamed (SSE) or not; `GET /v1/models` and `GET /v1/models/{id}` (the key
  Test in Settings, AI). The real SDK reaches it through `ANTHROPIC_BASE_URL` (or `baseURL`) with
  the key the fake was started with.
- Every request is validated as the real API would, and a violation is answered with the real error
  shape (`{type:'error', error:{type, message}, request_id}`) and status. The rules are below, each
  with the document it comes from.
- The answer comes from a response source: `scriptedSource` (replies given up front, or functions
  of the request), `replaySource` (a saved recording, with the live run's ids swapped in), or
  `agentSource` (each request written to a queue folder; the fake waits for a reply file written by
  whoever plays the model: Claude, in the recordings).
- The stream is the one the streaming docs describe: `message_start`, `ping`,
  `content_block_start`, `text_delta` / `thinking_delta` / `signature_delta` / `input_json_delta`
  in chunks, `content_block_stop`, `message_delta` with the stop reason, `stop_details` and usage
  (cache reads and writes included), `message_stop`.
- Faults a reply can carry: an HTTP error (401, 403, 404, 413, 429 with `retry-after`, 500, 529),
  `times` in a row so the SDK's own retries are exercised; a connection dropped mid-stream; a reset
  before any response; a refusal with `stop_details`, rescued by the server-side fallback when the
  request allows it (a `fallback` block, the fallback model's usage in `usage.iterations`); running
  out of tokens in the middle of a tool call's input; `pause_turn`.
- Thinking blocks are signed: bound to the model that wrote them and to the exact request prefix
  (tools, system, every earlier message). A changed block is a 400; a changed prefix is a 400, or a
  drop under `prefix_mismatch_behavior: "drop_block"`; a model that cannot read the writer's blocks
  drops them; drops are reported in `input_transformations` with the binding beta.
- The prompt cache is modelled: a prefix written at a breakpoint is read back by a later request
  whose bytes match up to there (20-position lookback, 512-token minimum), so usage shows reads on
  the second turn and a miss when a harness changes something early. Token counts are estimates.
- A reply is held to what the real API guarantees: a structured-output answer must match the
  request's schema, a strict tool's input must match the tool's schema, a tool call must name a tool
  in the request. Otherwise the turn fails with a source error (a test fails, rather than a harness
  being tested against an answer the real API could never give).

## Where it is used

- Every assistant test goes through it: `TestModel` (apps/server/src/assistant/testing.ts) builds
  each run's client with the real SDK (`anthropicModel`) pointed at the fake, which serves the
  test's scripted turns. A request the fake refuses fails the run that sent it, and the fake prints
  the rule. `PAVE_TEST_TRANSPORT=direct` plays turns in-process instead.
- `bash scripts/test-tiers.sh` runs every assistant test file once per tier model (Fable 5.2,
  Opus 5.5, Sonnet 5.5, Haiku 5.5) by pointing the Standard tier at it (`PAVE_TEST_MODEL`).
- `harness-acceptance.test.ts`: all four models in one place, a thread that switches tiers between
  messages, a Design job that asks first on every model, a failed call and a broken stream.
- `replay.test.ts` and `key-check.test.ts`: the recorded journeys (below), replayed.
- `packages/agent/src/testing/fake-api/fake-api.test.ts`: the fake itself (each rule, the SDK
  round trip, each fault, binding, caching, recording and replay, agent mode).

## Recording a journey with Claude in the loop

```
tsx packages/agent/src/testing/fake-api/cli.ts serve --port 4801 --queue <dir> \
    --record <recording.json> --journey <name> --description "<text>" --key <key>
PORT=8811 PAVE_DATA_DIR=<fresh dir> ANTHROPIC_BASE_URL=http://127.0.0.1:4801 PAVE_PLAN=pro \
    PAVE_PYTHON=<bpy venv python> tsx apps/server/src/main.ts      # no ANTHROPIC_API_KEY: journey f saves one
tsx apps/studio/e2e/harness.ts http://127.0.0.1:8811 <outDir> <journey> light 1440
tsx packages/agent/src/testing/fake-api/cli.ts next <dir>          # the next request, readable
tsx packages/agent/src/testing/fake-api/cli.ts reply <dir> <n> --then-next < reply.json
tsx packages/agent/src/testing/fake-api/cli.ts rebuild <dir> <recording.json> --journey <name>
```

The driver plays the designer (it clicks Go on quick questions, approves cards, edits by hand
mid-job, takes a screenshot at each stage) and writes `<journey>.outcome.json`: the design, its
changes, directions, takes, and each run's status, steps, job plan and cost. A reply file is a
`FakeReply`: `{"content": [{"type": "thinking", ...}, {"type": "text", ...}, {"type": "tool_use",
"name": ..., "input": ...}]}`; the fake adds ids, signatures and usage. `rebuild` turns a queue
folder into a recording, working out the usage each reply was served with (the fake's cache is a
pure function of the requests in order), so a replay costs exactly what the recording cost.

The recordings are in `apps/server/src/assistant/fixtures/recordings/`: a brief to directions, a
mix and a pick (a); the CAD job, paused by a hand edit, resumed and accepted (b); a chat edit and a
question about a selected stone (c); a photo to a design, with the structured photo read (d); the
Render job with real Blender takes, a retake and a rose-gold variant (e); the key test and save
(f, outcome only: the Models API carries no conversation); one thread on all three tiers with Light
on Haiku (g); concept images: a brief from two board pictures, four images checked one by one and
a refused request, recorded with live OpenAI images and replayed with the fake image provider (h,
with the expected verdicts in `h-imagegen.images.json`). A replay plays the designer's side through the API and Claude's from the recording;
it must send the same request shapes, have the fake refuse nothing, and end with the recorded
outcome. Tool-result text that may differ (timings, the capture's source, take facts from the
stand-in render engine) is listed in `replay.test.ts`.

## What it cannot prove

Only `pnpm agent:smoke` with a real key, on the founder's machine, covers these:

- that the real API accepts what the documents do not specify (for example the exact limits on
  schema complexity beyond the published ones, how the prefix check treats key order inside a
  replayed tool call's input, or a beta header the account is not enabled for);
- real model behaviour and quality: the replies in the recordings were written by Claude playing
  the model, faithfully but not by the API;
- real latency, real token counts and real cost (the fake estimates tokens), real cache hits,
  real refusals and fallbacks, real compaction.

## Rules

| Rule | What it enforces | Source |
|---|---|---|
| `auth.key` | An x-api-key or Authorization: Bearer header carrying a valid key. | skill:shared/error-codes.md § 401 Unauthorized |
| `headers.version` | anthropic-version is 2023-06-01 or 2026-10-21. | skill:shared/api-version-migration.md (the anthropic-version request header) |
| `headers.beta` | Every anthropic-beta value is one the API knows. | skill:shared/error-codes.md § 400 Bad Request (unknown anthropic-beta value) |
| `body.required` | model, max_tokens and a non-empty messages array are present. | skill:shared/error-codes.md § 400 Bad Request |
| `model.allowed` | The model is one of the four the harness may use (404 `model: <id>` otherwise). | skill:shared/error-codes.md § 404 Not Found; SKILL.md § Current Models |
| `max_tokens.range` | max_tokens is a positive integer no larger than the model’s 128K output limit. | skill:shared/error-codes.md § 400 Validation Errors; SKILL.md § Common Pitfalls (128K output tokens) |
| `sampling.removed` | No temperature, top_p or top_k. | skill:shared/error-codes.md § 400 Validation Errors (API version 2026-10-21; model-specific 400s) |
| `thinking.shape` | thinking is omitted or {type:"adaptive"}; enabled/budget_tokens is a 400 on all four models; disabled is a 400 on Fable 5.2, Opus 5.5 and Sonnet 5.5 and on Haiku 5.5 above effort high; between_tools only on Sonnet 5.5 at high or below with no other field. | skill:SKILL.md § Thinking & Effort (per-model table); shared/error-codes.md § Model-specific 400s |
| `thinking.display` | display is summarized or omitted, or updates with thinking-display-updates-2026-08-18. | skill:SKILL.md § Thinking & Effort (display); shared/model-migration.md § Migrating to Claude Opus 5.5 (display "updates" beta) |
| `thinking.block_binding` | block_binding needs the thinking-binding-controls beta, adaptive thinking, and prefix_mismatch_behavior error\|drop_block. | skill:shared/error-codes.md (thinking.block_binding without thinking-binding-controls-2026-08-01; block_binding only with adaptive thinking) |
| `effort.values` | output_config.effort is low\|medium\|high\|xhigh\|max; there is no top-level effort. | skill:SKILL.md § Thinking & Effort (Effort is inside output_config) |
| `tool_choice.forced` | tool_choice any/tool is a 400 on Fable 5.2, Opus 5.5 and Sonnet 5.5. | skill:shared/tool-use-concepts.md § Tool Choice Options; shared/error-codes.md § Model-specific 400s |
| `prefill.removed` | The conversation does not end with an assistant turn. | skill:SKILL.md § Common Pitfalls (Prefill removed); live:https://platform.claude.com/docs/en/api/messages/create (messages) |
| `fallbacks.shape` | fallbacks needs server-side-fallback-2026-07-01 ("default" form) or -06-01/-07-01 (list form); Haiku 5.5 takes no list; a list names only the model’s permitted targets. | skill:typescript/claude-api/README.md § Refusal Fallbacks; shared/model-migration.md § Haiku 5.5 Safeguards, § Sonnet 5.5 Safeguards and fallback, § Fable 5.2 Structured outputs, safeguards and fallback |
| `compaction.beta` | compact_20260112 needs compact-2026-01-12; clear_* edits need context-management-2025-06-27. | skill:SKILL.md § Compaction (requires compact-2026-01-12); § Context Editing |
| `cache.breakpoints` | At most 4 cache_control breakpoints, the top-level automatic one included; no longer TTL after a shorter one. | skill:shared/prompt-caching.md § API reference (max 4 breakpoints) and § Automatic vs explicit breakpoints |
| `tools.definition` | Each tool has a name matching ^[a-zA-Z0-9_-]{1,128}$ (unique), a description and an object input_schema, and only the documented optional properties. | live:https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools § Specifying client tools; live:https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-reference § Tool definition properties |
| `tools.eager_input_streaming` | eager_input_streaming is a boolean on the tool definition itself, on user-defined tools only. | skill:shared/tool-use-concepts.md § Eager input streaming; live:https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-reference (eager_input_streaming: user-defined tools only) |
| `strict.schema` | Strict tool schemas and output formats use only the supported subset: additionalProperties false on every object, no oneOf/not, no numeric or string length constraints, minItems 0 or 1 only, anyOf not beside type/properties, supported string formats and regex features. | live:https://platform.claude.com/docs/en/build-with-claude/structured-outputs § JSON Schema limitations; skill:shared/tool-use-concepts.md § JSON Schema Limitations |
| `strict.limits` | At most 20 strict tools, 24 optional parameters and 16 union-typed parameters across all strict schemas in one request. | live:https://platform.claude.com/docs/en/build-with-claude/structured-outputs § Schema complexity limits |
| `messages.roles` | Roles are user, assistant or system; the first message is a user message. (shared/error-codes.md lists consecutive same-role messages as a 400; the README, written later, says they are combined, which is what is enforced.) | skill:typescript/claude-api/README.md § Multi-Turn Conversations (first message user; consecutive same-role turns are combined) |
| `messages.system_placement` | A role:"system" message follows a user message, is last or followed by an assistant turn, is never messages[0], and is text only. | skill:shared/prompt-caching.md § Mid-conversation system messages |
| `messages.content_types` | User turns carry text, image, document, tool_result and search_result blocks; assistant turns carry the blocks the API returned; tool_result content is text, image, document or search_result. | live:https://platform.claude.com/docs/en/api/messages/create (content block params); live:https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls (tool_result content) |
| `messages.tool_pairing` | Every tool_use is answered by a tool_result in the very next message, which is a user message; all results of a turn in that one message, before any text; no result without its call. | live:https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls § Important formatting requirements; live:https://platform.claude.com/docs/en/agents-and-tools/tool-use/parallel-tool-use; skill:shared/tool-use-concepts.md § Handling Tool Results |
| `images.limits` | image/jpeg\|png\|gif\|webp, base64 that decodes, at most 10 MB base64 and 8000 px a side, at most 600 per request, and at most 3000 px a side when a request carries more than 20. | live:https://platform.claude.com/docs/en/build-with-claude/vision § Image limits and costs (Supported formats; Request limits) |
| `thinking.binding` | A replayed thinking block must be unchanged (else always 400), and the system, tools and earlier messages must be byte-identical to when it was produced (400, or dropped with prefix_mismatch_behavior drop_block). A block the model cannot read is dropped and, with the binding beta, reported in input_transformations. | skill:shared/model-migration.md § Migrating to Claude Opus 5.5 (breaking change 3), § Migrating to Claude Fable 5.2 (breaking changes 1-2); shared/error-codes.md (history-editing check) |
| `context.window` | The estimated prompt fits the model’s 1M-token context window. | skill:shared/error-codes.md § 413 Request Too Large (input over the context window is a 400 "prompt is too long") |

`skill:` paths are files of the claude-api skill (relative to its base directory); `live:` pages
are on platform.claude.com/docs. Where two documents differ the stricter reading is enforced, and
the rule says so (`messages.roles` on consecutive same-role turns; `tools.definition` uses the live
docs' 128-character name limit, while the harness keeps to 64).
