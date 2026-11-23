# 05 — Platform architecture: shell, auth, metering, traces, agent runtime, UI

_Research date: 2026-11-23. Versions are `npm view <pkg> version` on that date._

**Evidence.** This session could reach only npm and GitHub raw files, and the shared web-search budget ran out after six queries. Anything linked to a repo, docs kept in a repo, or npm was read directly. Claims marked **†** are prior knowledge (to mid-2026), not re-checked: vendor pricing, the Figma and Onshape posts, CAD product behaviour, browser release notes. Re-verify those before committing to them.

## 0. Stack verdict

| Item | Current | Verdict |
|---|---|---|
| pnpm + Turborepo | 12.23.0 / 2.11.13 | Keep |
| Vite + React + TypeScript | 8.3.8 / 19.3.1 / 7.0.2 | Keep. TS 7 (native compiler; first stable 7.0.x on npm 2026-07-08) is `latest`; confirm codegen tools (router generator, drizzle-kit) run on it before pinning |
| TanStack Router, Zustand | 1.170.46 / 5.1.0 | Keep. Zustand for UI and viewport state only; document state comes from the op log |
| + TanStack Query | 5.108.4 | **Add** (server state) |
| Tailwind v4 | 4.3.5 | Keep |
| Radix or Base UI | `radix-ui` 1.8.1 / `@base-ui/react` 1.9.0 | Either, not both. Prefer **Base UI** for a from-scratch system (1.0 in Dec 2025, nine minors since). The old `@base-ui-components/react` name is frozen at an RC |
| cmdk, Motion | 1.1.1 / 14.14.0 | Keep. cmdk has had no release since Aug 2025: stable, but quiet |
| three + R3F | 0.187.0 / 9.8.2 | Keep (+ drei 10.7.9, three-mesh-bvh 0.9.18 for picking) |
| **Tauri 2 shell** | 2.12.6 | **Change: Electron 45.4.1 as default shell** behind a thin shell contract (§1) |
| Hono on Node | 4.13.21 / node-server 2.1.11 | Keep |
| Drizzle | 0.45.4 (`rc` tag 1.0.0-rc.6) | Keep on 0.45; plan the 1.0 move |
| PGlite fallback | 0.6.0 | Keep, with caveats (§6) |
| Better Auth + organization | 1.7.27 | Keep (§2) |
| Anthropic TS SDK | 1.13.0 | Keep; use the tool runner (§5) |
| + MCP server SDK, Zod | `@modelcontextprotocol/server` 2.4.0 / zod 4.6.7 | **Add** |

## 1. App shell

| | Tauri 2.12 | Electron 45 | PWA |
|---|---|---|---|
| Engine | WebView2 (Windows), WKWebView (macOS), WebKitGTK (Linux): three engines ([docs](https://v2.tauri.app/reference/webview-versions/)) | One bundled Chromium everywhere | User's browser |
| WebGPU | Windows yes†. macOS only on macOS 26+, where Safari 26 shipped it ([web.dev](https://web.dev/blog/webgpu-supported-major-browsers); WebKit bugs [299237](https://bugs.webkit.org/show_bug.cgi?id=299237), [299510](https://bugs.webkit.org/show_bug.cgi?id=299510)). Linux: no evidence it is on by default in WebKitGTK 2.52 ([open bug](https://bugs.webkit.org/show_bug.cgi?id=306223)) | Yes, same as Chrome | All major browsers, current versions only |
| WebGL on Linux | Tauri's own docs: NVIDIA/DMABUF blank windows, WebGL can **silently** fall to software, renderer string is masked; "give it a non WebGL fallback" ([docs](https://v2.tauri.app/develop/debug/linux-graphics/)) | Chromium GPU stack | n/a |
| SharedArrayBuffer / WASM threads | COOP/COEP configurable since 2.1 ([docs](https://v2.tauri.app/security/http-headers/)); test `crossOriginIsolated` per engine | Set the headers yourself | Set the headers yourself |
| Local Node server (Hono + PGlite) | Sidecar: a self-contained binary per target triple ([docs](https://v2.tauri.app/develop/sidecar/), [Node guide](https://v2.tauri.app/learn/sidecar-nodejs/)) | Runs in-process, no packaging step | Not possible |
| OAuth deep links | Plugin; on Windows/Linux the URL arrives as argv to a new process, so single-instance is required ([docs](https://v2.tauri.app/plugin/deep-linking/)) | Protocol client + second-instance event† | Normal redirect |
| Better Auth integration | Community only ([daveyplate](https://github.com/daveyplate/better-auth-tauri), [laakal](https://github.com/laakal/tauri-plugin-better-auth)) | Official `@better-auth/electron` 1.7.27: system browser + PKCE ([docs](https://better-auth.com/docs/integrations/electron)) | Native |
| Auto-update | Updater plugin, signature mandatory ([docs](https://v2.tauri.app/plugin/updater/)) | electron-updater 6.8.11 | Service worker |
| Size | Small shell, but the Node sidecar erases most of the gain | ~100 MB+† | 0 |

**Recommendation: Electron for v1.** Tauri's case is bundle size and memory, and Pavé gives most of that up once it ships a Node runtime for the local server. What remains is three rendering engines under a GPU viewport, a sidecar build matrix and a community auth bridge. OpenCode made the same move in 2026, citing slower WebKit rendering and style inconsistencies ([post](https://dev.to/brendonovich/moving-opencode-desktop-to-electron-4hip); their [desktop package](https://github.com/sst/opencode/blob/dev/packages/desktop/package.json) is now Electron 44).

Tauri wins again if support is limited to Windows plus macOS 26+, or once its Chromium runtime ships: `tauri-runtime-cef` is at v0.1.0 on an unmerged [`feat/cef` branch](https://github.com/tauri-apps/tauri/tree/feat/cef/crates/tauri-runtime-cef).

**One build for web and desktop.** Make the shell disposable:

- `apps/web` is the Vite SPA. `apps/server` is Hono and also serves the built SPA, which gives the single-binary mode.
- `apps/desktop` only starts that server on `127.0.0.1:<random port>` with a per-launch secret and opens a window on it. Loopback HTTP is a secure context, so cookies, WebGPU, SAB and COOP/COEP behave as on the web, with no custom-protocol code path.
- `packages/platform` defines `openFile`, `saveFile`, `deepLink`, `secureStore`, `update`, with web and desktop implementations. Nothing else imports shell APIs.

Pitfalls: sign and notarize from day one; serve every asset same-origin, because COEP breaks third-party images; make WebGL2 the baseline and WebGPU an enhancement; do not bundle Blender — detect a user install or use cloud render workers.

## 2. Auth and tenancy

| Option | Licence / shape | Orgs, roles | SSO / SCIM | Fit |
|---|---|---|---|---|
| **Better Auth 1.7** | MIT library in your server and your DB | Org plugin: invitations, teams, runtime roles ("dynamic access control"), `activeOrganizationId` on the session ([docs](https://better-auth.com/docs/plugins/organization)) | `@better-auth/sso` (OIDC + SAML), `@better-auth/scim` rebuilt in 1.7 with Groups and role projection ([1.7 post](https://better-auth.com/blog/1-7)) | **Best**: the only option that runs inside a single binary |
| WorkOS AuthKit | Hosted, closed | Yes | Excellent; priced per connection† | Blocks offline and self-host |
| Clerk | Hosted, closed | Yes (add-on†) | Yes† | Same |
| Stack Auth | MIT + AGPL per npm | Teams | Partial† | Main npm package last published 2026-05; repo status not verified |
| Supabase Auth | OSS service | No org primitive† | SAML† | Pulls in the Supabase stack |
| Zitadel | AGPL-3.0 Go service ([repo](https://github.com/zitadel/zitadel)) | Strong multi-tenancy | Yes | Separate service; fine as an external IdP |
| Keycloak | Apache-2.0 Java service† | Yes† | Yes | Heavy |
| Ory Kratos | Apache-2.0 core; SCIM, SAML and org SSO need the Enterprise License ([README](https://github.com/ory/kratos)) | Limited | Paid | No |
| Auth.js | "Now part of Better Auth"; recommends it for new projects ([README](https://github.com/nextauthjs/next-auth#readme)) | — | — | Superseded |

Better Auth also covers passkeys, 2FA, admin, org-owned API keys ([docs](https://better-auth.com/docs/plugins/api-key)), an OAuth provider and `@better-auth/mcp` for MCP authorization.

Cautions:

- **It moves fast.** 1.7 (2026-08-17) changed the account identity model and required full SCIM re-provisioning; a 1.8 beta already has docs. Upgrade all `@better-auth/*` packages together and defer SSO/SCIM until a customer asks.
- **Audit logs and self-service SSO onboarding are in the paid "Infrastructure" product** ([docs](https://better-auth.com/docs/infrastructure/plugins/audit-logs)). Own the audit log.
- **PGlite is not mentioned in its docs.** The Drizzle adapter should work unchanged over the PGlite driver; add an integration test that runs the auth schema and an invitation flow on PGlite in CI.

**Tenancy model.**

- `user` ↔ `organization` is many-to-many through `member(role)`. The session carries the active org. Every domain row has `org_id`.
- **App-layer scoping is the primary guard**: one `scoped(orgId)` repository; raw `db` is lint-banned outside it.
- **RLS is a second guard on server Postgres**: policies read `current_setting('app.org_id')`, set with `SET LOCAL` per request under a non-owner role. Ship the same policies to PGlite so the schema matches, but connect as owner there; a single-user local database gains nothing from RLS.
- **Local mode** (no `DATABASE_URL`): auto-create one user and a personal org, so the same scoping code runs.
- **Roles**: `owner` and `admin` (built in), plus `designer` (edit, run the agent, render), `viewer` (read, comment) and `manufacturer_guest` (only the pieces and packages granted). Define them as static access-control statements.
- **Manufacturer share links**: `share_link(token_hash, package_id, perms, expires_at, revoked_at, passcode_hash)`, pointing at an immutable package version. No account needed; every open and download is logged. Promote to `manufacturer_guest` for ongoing work.
- **Audit log**: own append-only table for auth events (Better Auth hooks) and domain events.

## 3. Usage metering and billing

**Meter** these, each tagged with `org_id, user_id, run_id`:

- LLM tokens by model, split into input, output, cache-read and cache-write, because they are priced differently
- image generations (model × resolution)
- render seconds (by GPU class)
- search queries
- storage (byte-hours)
- seats

**Ledger.**

- `usage_event` is append-only, with `idempotency_key UNIQUE` (for example `run_id:step_idx:meter`), quantity, unit and a `cost_micros` snapshot. Write it in the same transaction as the step it measures.
- `credit_ledger` holds signed entries: grants, purchases, consumption, expiry.
- `usage_rollup` is derived per org, meter and day, and backs quota checks.
- Enforce limits before a run starts (warn, then refuse), never mid-tool-call.
- Read tokens from the Messages API response `usage`, not from OTel spans: on spans `gen_ai.usage.input_tokens` includes cache tokens, in the response it excludes them ([Anthropic OTel docs](https://platform.claude.com/docs/en/manage-claude/opentelemetry)).

| Option | Open? | Notes |
|---|---|---|
| Stripe Billing meters | Hosted | Meter-events API†; widest reach; Stripe bought Metronome† |
| [Polar](https://github.com/polarsource/polar) | Apache-2.0 | Merchant of record; token/usage metering; Better Auth plugin |
| Autumn | OSS layer over Stripe ([per Better Auth docs](https://better-auth.com/docs/plugins/autumn)) | Plans, metering, feature gates; licence not verified |
| [OpenMeter](https://github.com/openmeterio/openmeter) | Apache-2.0 | Metering, entitlements, credits, invoicing; self-hostable |
| [Lago](https://github.com/getlago/lago) | AGPLv3 | Full billing, AI-token focus; heavy to operate |
| Orb, Metronome | Hosted† | Enterprise contracts; too early |

**Recommendation:** the built-in ledger is the source of truth and is always on, including self-host. A `BillingAdapter` interface (`syncCustomer`, `reportUsage(batch)`, `getEntitlements`, `checkoutUrl`, `handleWebhook`) ships with `none` and `stripe`, then `polar`. Adapters read `usage_event` through an outbox, never in the request path.

## 4. Traces

### 4a. Agent traces

**OTel GenAI conventions are still "Development", not stable.** They moved to their own repo ([semantic-conventions-genai](https://github.com/open-telemetry/semantic-conventions-genai)), which has no schema URL yet. Current names ([agent spans](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md), [execute tool](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/execute-tool.md)):

- `gen_ai.operation.name`: `chat`, `invoke_agent`, `invoke_workflow`, `create_agent`, `plan`, `execute_tool`
- Span name: `{operation} {gen_ai.agent.name}`
- Identity: `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.conversation.id`, `gen_ai.agent.id|name|version`
- Tools: `gen_ai.tool.name`, `gen_ai.tool.call.id`, `gen_ai.tool.call.arguments|result`
- Usage: `gen_ai.usage.input_tokens|output_tokens`, `gen_ai.usage.cache_read.input_tokens`, `gen_ai.usage.cache_write.input_tokens`, `gen_ai.usage.reasoning.output_tokens`
- Content (opt-in): `gen_ai.input.messages`, `gen_ai.output.messages`, `gen_ai.system_instructions`

The Anthropic SDK emits OTel spans itself, carrying these `gen_ai.*` attributes (`openTelemetry` client option; spans `anthropic.messages.tool_runner`, `anthropic.messages.create`, `anthropic.custom_tool_use <tool>`). Its default content mode is metadata-only.

| Backend | Licence | Self-host | Note |
|---|---|---|---|
| [Langfuse](https://github.com/langfuse/langfuse) | MIT | Yes (Compose, Helm) | OTLP-native; part of ClickHouse since Jan 2026 |
| [Arize Phoenix](https://github.com/Arize-ai/phoenix) | Elastic License 2.0 | Yes | OTel/OpenInference; ELv2 forbids offering it as a service |
| [Helicone](https://github.com/Helicone/helicone) | Apache-2.0 | Yes | Proxy-style; company status not verified |
| LangSmith, Braintrust | Closed | Enterprise only† | Strong eval UX |

**Decision:** our Postgres tables are the system of record, because traces drive history, undo and billing. OTLP export is an optional operator mirror, off by default, with Langfuse as the documented target. Store runs, steps, verbatim messages, tool calls with inputs and results, per-step tokens, latency, model, cost, stop reason and feedback.

### 4b. Human edit traces: op log, not CRDT

| | Server-ordered op log | Yjs 13.6 (14 in beta) | Automerge 3.5 | Loro 1.19 |
|---|---|---|---|---|
| Attribution (user vs agent run) | Native columns | Client-ID mapping, manual | Per-change actor | Per-peer |
| Undo/redo | Inverse ops, per actor | UndoManager | Manual | Built in |
| Branches / versions | `branch_id` + fork seq | Snapshots | Fork/merge | Best: time travel, shallow snapshots ([README](https://github.com/loro-dev/loro)) |
| Replay for evals | A SQL query | Decode binary updates | Possible | Possible |
| Semantic validity of merges | Server validates and re-evaluates | Not guaranteed | Not guaranteed | Not guaranteed |
| Offline multi-writer | Rebase on reconnect | Yes | Yes | Yes |
| Complexity | Lowest | Medium | Medium | Medium |

CRDT cells without a link are prior knowledge†. A parametric feature tree is a small program: two edits that merge cleanly as data can still produce a model that fails to rebuild, so the hard problems are ordering and validation, not convergence. The closest products use a central order:

- **Figma**: server-authoritative, last-writer-wins per property, explicitly not a CRDT† ([post](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)).
- **Onshape**: every change is an immutable microversion in a workspace history, with branch and merge† ([post](https://www.onshape.com/en/blog/how-does-onshape-really-work)).
- **Linear**: client transactions, a server-assigned monotonic sync id, delta packets broadcast to all clients, undo as inverse transactions ([reverse-engineering study](https://github.com/wzhudev/reverse-linear-sync-engine)).

**Decision:** `doc_op(doc_id, branch_id, seq, actor, command, args, inverse)` with periodic snapshots. Multiplayer later means broadcasting ops by `seq` and rebasing pending local ops, with no data-model change. Use a CRDT (Yjs) only inside free-text fields and boards.

### 4c. Linking the two

- Every op carries `actor_type` (`user`, `agent`, `system`), `actor_user_id`, and for agent ops `run_id` and `tool_call_id`.
- `agent_run.base_seq` pins the document state the model saw, so a run can be replayed.
- **Implicit feedback** is computed asynchronously from later ops:
  - `undone`: an inverse op targets an agent op
  - `rejected`: the preview was discarded
  - `corrected`: a human edits the same feature or parameter within N ops; store the parameter delta
  - `accepted`: the op survives to the next stage transition
- Together with explicit thumbs and comments, this yields (state, instruction, agent ops, human correction) tuples for evals and fine-tuning.

**Privacy and retention.** Three separate switches:

1. Operational traces: always on, needed for history and billing.
2. Content retention window: per org, default 90 days, after which message bodies and tool payloads are nulled and metadata kept.
3. Use for evals or training: **opt-in per org, default off**, revocable, with a per-run exclude flag.

Also: export and delete per org; store blob ids, not image bytes, in traces; scrub names and emails from exported text; keep the OTLP mirror metadata-only unless the operator opts in.

## 5. Agent runtime

| Approach | Verdict for Pavé |
|---|---|
| Messages API + **SDK tool runner** (`client.beta.messages.toolRunner`, `betaZodTool`) | **Default.** We host the loop, so it runs in the single binary with the org's own key. Per-turn hooks cover approval, interception and result editing ([tool use docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview)) |
| Managed Agents | Optional cloud adapter for long background jobs. Beta, bills session runtime, not eligible for zero data retention ([overview](https://platform.claude.com/docs/en/managed-agents/overview)) |
| Claude Agent SDK | Claude Code as a library (files, bash) ([README](https://github.com/anthropics/claude-agent-sdk-typescript)). Wrong shape for an in-app assistant; useful later for a sandboxed scripting worker |
| MCP server | Yes, as a second front end to the same commands. Spec 2026-07-28 is stateless (no sessions or handshake) ([changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)); SDK v2 is split packages and accepts any Standard Schema such as Zod 4 ([repo](https://github.com/modelcontextprotocol/typescript-sdk)); `@better-auth/mcp` provides the OAuth side |

**One command registry, three front ends.** `packages/commands` exports entries of this shape:

`{ id, title, description, input (Zod), output (Zod), risk: 'read' | 'write' | 'destructive', scope, run(ctx, input) → { ops, result } }`

- **UI**: buttons, shortcuts and the command palette dispatch by `id`.
- **Agent**: a generator turns the registry into `strict: true` tools for the runner.
- **MCP**: the same generator registers tools on `/mcp` (Hono middleware, Better Auth OAuth), so Claude Code or Desktop can drive Pavé.

All three pass through the same `ctx`: org scope, permission check, op-log append, audit, metering. Keep input schemas flat: strict mode does not support recursive schemas or numeric bounds ([structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)); the SDK strips those and validates client-side.

**Runtime rules.**

- **Loop location.** The loop runs server-side beside the op log. Tools that need the client (viewport screenshot, current selection) are relayed over the run's event stream and answered by the SPA.
- **Persist, then stream.** Write each step row first, then stream the same events over SSE, so reload and resume are free.
- **Append-only history.** Store `response.content` verbatim and replay it unchanged. Current models tie thinking blocks to the conversation and check for edited history; an append-only message table satisfies that by construction.
- **Approval.** `read` runs automatically. `write` applies as a previewable, undoable op group. `destructive` and anything external (send package, spend credits, share link) pause for a human; record who approved.
- **Caching.** Prefix order is tools → system → messages. Emit tools in a deterministic order, keep timestamps out of the system prompt, add mid-run guidance as appended `system` messages, and use tool search rather than swapping tool sets when the registry grows large ([prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)).
- **Model behaviour.** The current Opus and Sonnet reject forced `tool_choice`: use `auto` plus strict tools, or `output_config.format` when only JSON is wanted (spec extraction). Handle `stop_reason: "refusal"`. Validate streamed tool inputs before running them.
- **Models.** `claude-opus-5-5` for the orchestrator; `claude-sonnet-5-5` or `claude-haiku-5-5` for sub-agents and bulk extraction ([models](https://platform.claude.com/docs/en/about-claude/models/overview)). Make the model a per-org setting.
- **Sub-agents** (ideation, spec, CAD, render, production) are child runs with their own tools and prompt, linked by `parent_run_id`. Start with one agent whose skills load on demand; split a domain out only when its tools or context crowd the main loop.

## 6. Sync and storage

| Engine | State (Nov 2026) | Why not for v1 |
|---|---|---|
| [Zero](https://github.com/rocicorp/mono) 1.12 | 1.0 in Mar 2026, Apache-2.0 | Needs a zero-cache service and logical replication. Repo is now a filtered mirror; server tests were unpublished and history rewritten on 2026-09-30 |
| [Electric](https://github.com/electric-sql/electric) | Read-path sync over HTTP | Needs logical replication, which embedded PGlite does not offer† |
| [PowerSync](https://github.com/powersync-ja/powersync-service) | Client SQLite + sync service | Extra service and a second local database |
| LiveStore 0.5.1 | Event-sourced†, pre-1.0 | Closest in spirit; immature |
| [Jazz](https://github.com/garden-co/jazz) 2.0 | Beta with an entirely new API | Churn |
| [InstantDB](https://github.com/instantdb/instant) | Full backend | Replaces our server |
| [TanStack DB](https://github.com/TanStack/db) 1.0-rc | Client store, README still says beta | Revisit at 1.0 |

**Simplest robust v1:** typed Hono RPC + TanStack Query for everything relational. For design documents: `POST /docs/:id/ops` (optimistic, idempotent on `client_op_id`) and `GET /docs/:id/ops?since=seq` over SSE. That is already a sync protocol for the only data that needs one.

**PGlite caveats.** It is single-connection ([README](https://github.com/electric-sql/pglite)): run one instance behind an async queue. 0.6.0, released today, jumps to PostgreSQL 19.0 (0.5.17 was 18.7): pin exact versions, keep prod Postgres on the same major, and build a dump/restore path for existing data directories before shipping desktop.

**Blobs:** content-addressed `blob(sha256, size, mime, storage_key)` behind a `BlobStore` interface: `s3` (any S3-compatible store, presigned URLs) on the server, `fs` (app-data directory, streamed through a Hono route with range support) on desktop. Thumbnails, GLB and STL are separate blobs linked through `asset`.

## 7. UI/UX system

**Calm, premium baseline** (Notion, Linear, Arc, Raycast, Things†):

- **Type.** Inter variable ([OFL 1.1](https://github.com/rsms/inter)) or Geist ([OFL](https://www.npmjs.com/package/geist); the family now includes a serif). Sizes 11/12/13/14/16/20/24/32; UI base 13 px, document body 15–16 px; weights 400/500/600 only; tabular numerals in numeric fields. One serif (Geist Serif, Newsreader or Instrument Serif†) for piece and collection titles and empty states only.
- **Spacing.** 4 px grid, steps 4/8/12/16/24/32/48. Controls 28 or 32 px high. Sidebar 240, inspector 300. Radius 6 (controls), 10 (menus, cards), 14 (dialogs).
- **Colour.** One 12-step neutral scale in OKLCH per theme, and **one** accent for selection, focus and the primary action only. Metals and stones supply the colour; the chrome stays neutral.
- **Borders and shadows.** 1 px hairlines at 6–10% foreground alpha carry the structure. Shadows only on floating layers, at two levels (popover, dialog).
- **Motion.** 100–150 ms for hover and press, 150–200 ms for menus, 250–300 ms for panels; ease-out on enter, faster on exit; transform and opacity only. Keyboard-triggered UI appears instantly. `prefers-reduced-motion` swaps movement for a fade.
- **Density.** Compact by default, controlled by one density token.

**Frosted glass, done right.** Use it only on transient floating layers (menus, palette, popovers, viewport toolbars), never on content panes.

- Recipe: `backdrop-filter: blur(24px) saturate(1.6)`; surface fill at 70–80% alpha; 1 px inner border (white 10% in dark, black 6% in light); optional 2–3% noise to hide banding.
- Contrast: text must hold 4.5:1 against the worst backdrop; raise fill alpha before weakening text.
- Fallbacks: opaque when `backdrop-filter` is unsupported, under `prefers-contrast: more`, and under `prefers-reduced-transparency: reduce`. That last query is Chromium 118+ only, flagged in Firefox and absent in Safari ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-transparency)), so also add an in-app "Reduce transparency" setting.
- Performance: glass over a live WebGL canvas re-blurs every frame. Keep glass areas small, never nest or animate blur, and render the viewport on demand.

**Keyboard and palette.** Every registry command has an id, a title and a default shortcut. ⌘K lists them in context; unmatched text falls through to "Ask Pavé". Single-key tool shortcuts in CAD; `?` opens the cheat sheet. Empty states are one sentence, one primary action and one suggested prompt.

**CAD conventions** (Onshape, Fusion, Shapr3D, Plasticity, Spline, Womp†):

- Viewport first: the canvas keeps at least 70% of the window; panels collapse.
- Feature tree on the left in rebuild order, with rollback bar, suppress, rename and inline rebuild errors. For jewelry: Parameters → Shank → Head/Setting → Stones → Details → Finish.
- Contextual inspector on the right showing only the selection's parameters. Numeric fields take units and expressions, scrub on label drag, commit on Enter. A drag previews live and commits **one** op on release.
- On-canvas gizmos bound to parameters; X/Y/Z as red/green/blue; snapping with a fine-adjust modifier.
- View cube, standard views, fit-to-selection, zoom to cursor, orthographic/perspective toggle.
- Domain units as first-class types: mm, ring-size systems, carat ↔ mm, live metal weight.
- Selection: hover pre-highlight, then accent outline; a filter for face, edge, body, stone.
- A visible history panel with human and assistant avatars; an agent run is one undoable group that expands to its steps.

**Information architecture.**

- **Sidebar:** org switcher · Search (⌘K) · Home · Inbox · **Collections** · **Pieces** (saved views by stage) · **Boards** · **Library** (stones, settings, findings, materials, templates) · **Brand** (style guide, brand models) · **Renders** · **Production** (packages, manufacturers, share links) · Settings (members, usage, data and traces, API/MCP).
- **Object model:** Org → Collections → Pieces. A Piece owns a spec, one design document (branches are variants), renders, on-model images and production packages. Boards, Library items and Brand models are org-level and referenced by pieces.
- **Piece page:** a Notion-like header (title, cover, properties) above a stage stepper: **Ideate → Spec → CAD → Render → On-model → Production**. Stages are non-linear. Each has a status and records the `source_seq` it was made from, so a CAD change marks renders and packages "stale". A production package is immutable once sent.
- **Assistant:** a global right-hand panel (⌘J) that knows the current piece, stage and selection, plus inline entry points: the palette fallback, a selection chip in the viewport, slash commands in docs, suggested next actions per stage. Agent edits arrive as a preview with Apply and Reject; every run is listed in history.

## Decisions for Pavé

- **Shell:** Electron 45 behind `packages/platform`; the desktop app is a window onto the local Hono server on loopback. Revisit Tauri when its CEF runtime merges.
- **Web:** the same SPA against a hosted server; WebGL2 baseline, WebGPU as enhancement.
- **Auth:** Better Auth 1.7 with the organization plugin (teams off, static roles first); passkeys and 2FA at launch; SSO, SCIM and API keys when sold. System-browser PKCE on desktop; auto-provisioned local user in single-binary mode.
- **Tenancy:** `org_id` on every row; mandatory scoped repository; RLS as a second guard on server Postgres; own `audit_log`.
- **Metering:** built-in `usage_event` ledger with idempotency keys and credits; `BillingAdapter` for `none`, `stripe`, then `polar`.
- **Traces:** Postgres is the system of record; optional OTLP mirror using GenAI attribute names; eval and training use is opt-in per org.
- **Documents:** server-ordered op log with inverse ops, snapshots and branches. No CRDT in the CAD core.
- **Agent:** Anthropic SDK tool runner on our server; one Zod command registry feeding UI, agent tools and MCP; risk-tiered approval; append-only messages.
- **Sync:** Hono RPC + TanStack Query, plus SSE op streams. No sync engine in v1.
- **Storage:** content-addressed blobs behind `s3` and `fs` adapters. Pin PGlite and match the Postgres major.
- **UI:** Base UI + Tailwind v4 tokens; Inter or Geist plus one serif; 13 px base on a 4 px grid; hairlines over shadows; glass only on floating layers, with opaque fallbacks; every action is a command.

**ER sketch** (all domain tables carry `org_id`):

```
user ─< member(role) >─ organization ─< invitation
session(active_organization_id)        organization ─< api_key, share_link, audit_log

organization ─< collection ─< piece(stage, status)
piece ─1 spec        piece ─1 document ─< doc_branch ─< doc_op ; document ─< doc_snapshot
piece ─< render(source_seq) ; on_model_image ; production_package(version, source_seq, sent_at)
organization ─< board ; library_item ; brand_model ; blob ─< asset

doc_op(doc_id, branch_id, seq, actor_type, actor_user_id, run_id?, tool_call_id?,
       command, args, inverse, client_op_id, created_at)

agent_run(id, parent_run_id?, user_id, piece_id?, doc_id?, base_seq, skill, model, status,
          trace_id, tokens_in/out/cache_read/cache_write, cost_micros, started_at, ended_at)
agent_run ─< agent_step(idx, kind, model, request_id, usage, latency_ms, stop_reason)
agent_run ─< agent_message(idx, role, content_json)
agent_step ─< tool_call(id, command, input, result, is_error, approval, approved_by)
tool_call ─< doc_op                     run_feedback(run_id, tool_call_id?, kind, source, detail)

usage_event(idempotency_key UNIQUE, meter, quantity, unit, model?, run_id?, cost_micros, occurred_at)
credit_ledger(delta, reason, ref) ; usage_rollup(meter, day, quantity)
org_settings(trace_retention_days, allow_eval_use, model, quotas)
```
