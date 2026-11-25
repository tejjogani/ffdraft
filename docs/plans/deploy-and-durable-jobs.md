# Durable jobs, local GPU, hosting on Render, and render nodes

Build brief, planning only: nothing here is built yet, and none of it blocks the founder's first local test with his own Claude API key. Build it after that test.

**Honest summary.** Pavé already checkpoints the assistant one step at a time, and it already meters, claims and design-commits idempotently. Every other piece of long work, though, is owned by "this process": in-memory maps, no lease, no heartbeat, no attempt count. So a restart throws away work that was nearly done. A Blender take starts again from sample 0, a production package is rebuilt, and an assistant run that was mid-step is failed. A clean shutdown fails that run too. None of this is safe with two processes, so it is not safe on Render either: a zero-downtime deploy briefly runs two instances. A GPU machine that renders for a hosted server is not possible today.

The plan has four stages, each useful alone:
1. **Local durability.** One durable work model with leases, attempts and checkpoints. Assistant runs resume instead of failing. Renders resume from sample chunks and kept frames.
2. **Local GPU.** Device detection, a device choice and an honest fallback.
3. **Hosting on Render,** shaped like Diaex: web service, Postgres, a bucket, no Blender.
4. **Render nodes.** The founder's GPU machine runs a small Pavé worker that connects outbound and pulls renders.

Render has no GPUs [S], so GPU work never runs on Render.

Paths are in `/home/user/ffdraft-ai` (branch `ai/assistant`) under `apps/server/src/`, unless they name a package or `workers/`, or are marked `main:` (this repo) or `diaex:` (read-only). Labels: [S] means a web fact not opened at its source (render.com did not resolve from the planning session); [E] means judgement; [verify] means a gate in the build order. bpy facts were probed read-only on `bpy 5.3.0` in `workers/render/.venv`. A second round of probes (renders, merges and denoises in a scratch folder, nothing written to either repo) changed several decisions below; each such change says "changed after the probe". Line numbers were read on 2026-11-25 while other work was editing these files, so expect them to drift by a few lines; the names around them are the anchor.

## 1. Experience

**An interrupted job, with Resume.**
- After a crash, a power cut or `Ctrl-C`, the studio opens with its jobs where they were. A take tile reads "Resuming · 3 of 8 chunks kept". A package reads "Resuming". An assistant run carries on, and its dock shows a quiet line: "Picked up after a restart · 1 step redone".
- Nothing asks the founder to "send the message again". That is today's text (`assistant/service.ts:240-243`, `431-443`).
- When a job cannot safely go on, it stops in a new state, **Interrupted**, with a reason and a **Resume** button instead of a red failure. For example: a tool whose outcome is unknown, or a third crash in a row. Resume runs the job's next attempt from its last checkpoint.
- **Stop** still means stop. A user's Pause on an AI job keeps today's behaviour: Resume replans in a new run (`assistant/service.ts:325-360`).

**A render that survives a crash.**
- A still at standard or final quality renders in sample chunks. The tile shows the chunk count and an honest ETA.
- Kill the server, Blender or the machine mid-render, and on the next start the tile resumes at the first unfinished chunk. Only that chunk's minutes are lost.
- An animation resumes at the first missing frame.
- The finished take matches an unchunked one at the same samples within measured tolerances, not pixel for pixel: chunked stills are denoised after the merge and colour-managed afterwards, where today's are denoised inside the render (4.5). How close is a gate, measured in step 3, not a promise made here.

**Choosing a GPU.**
- The engine dialog (Render tab → engine chip) lists what Blender found: "NVIDIA RTX 4090 · OptiX", "CPU · 24 threads". GPU memory shows only where a vendor tool reports it (4.7).
- **Render on** offers Auto (the first GPU backend found, in a fixed order, then CPU), one named device, or CPU only.
- **If the GPU fails, use the CPU** is on by default locally.
- Each take records the device it used, and says so when it fell back: "Rendered on CPU: the GPU ran out of memory".

**Hosted Pavé, with his own GPU machine as a render node.**
- The founder signs in at a Pavé address on Render. Settings → **Render machines** → **Add a machine** shows a one-time pairing code.
- On his GPU machine he runs `pnpm node pair <address> <code>` from the same Pavé install, then `pnpm node`. The machine appears as "Studio PC · online · RTX 4090 · idle".
- Renders queued in the hosted studio go to it. If it is offline, the take waits with "Waiting for a render machine", or he picks Browser render.
- If the machine sleeps or its network drops mid-render, the take shows "Machine offline, will resume" and carries on from its kept chunks when the machine is back. He can revoke a machine at any time.

## 2. Structure

**Database: one durable work model** (new table `work`, in a migration taking the next free number at build time, on top of `ai:` `0011`; `0012` is already taken by `drizzle/0012_scene_changes.sql`, in `_journal.json` on `ai/assistant`).
- Columns: `id`, `org_id`, `kind` (`render | production | mesh3d | shot | run | fit`), `ref_id` (the domain row), `created_by`, and `requires` (jsonb: `{ engine: 'blender', gpu?: true }`).
- Lease columns: `state` (`ready | leased | parked | finished`), `lease_owner`, `lease_until`, `heartbeat_at`, `lease_epoch`, `failures`, `max_attempts`, `not_before`, `last_error`, `created_at`.
  - `lease_epoch` (bigint) goes up on every claim and is the only fencing token.
  - `failures` goes up only on a counted release or an expired lease, and is what `max_attempts` is checked against. *Changed after review:* one `attempt` column cannot be both, because an uncounted release would either hand the next claimer a token the old process still holds, or use up a try (4.1).
  - `parked` is a run waiting for a person (approval or takes). The claim skips it and nothing heartbeats it (4.1).
- Unique on (`kind`, `ref_id`).
- The domain rows (`render_job`, `production_package`, `mesh_job`, `model_shot`, `agent_run`) keep their status and their sticky updates (`jobs.ts:29-113`). `work` holds only who runs the job, until when, under which epoch, and how many times it has failed.

**Checkpoints** (new table `work_checkpoint`).
- Columns: `work_id`, `key` (`input`, `draft`, `mask`, `chunk:0003`, `frame:0042`, `file:model.step`), `input_hash`, `blob_sha` (null when the bytes stay on the machine's disk), `bytes`, `meta` (jsonb), `lease_epoch`, `at`. Unique on (`work_id`, `key`).
- A checkpoint counts only when its `input_hash` matches the job's current input, so a changed scene never reuses old samples.

**Server modules**
- `work/lease.ts`: `claim(kinds, owner, caps)`, `heartbeat(id, epoch)`, `release(id, epoch, { counted })`, `park(id, epoch)`, `unpark(id)`, `finish(id, epoch)`. Every write is fenced by `(id, lease_epoch)`. The claim is `UPDATE … SET lease_epoch = lease_epoch + 1 … WHERE id = (SELECT … WHERE state = 'ready' … FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING`.
- `work/runner.ts`: the in-process loop that claims work this process can do, turns each claim into the existing service call (`resume`/`submit`), and heartbeats while it runs. It replaces the one-shot `recover()` (`app.ts:82`; `recovery.ts:44-269`) with a standing loop. At boot it reclaims leases this process owned before (by owner id) and any lease that has expired. A driver aborts itself when a heartbeat fails or when `lease_until` minus a 10 s margin passes [E on the margin], so a process that lost its lease (a long pause, a database blip) stops before a new owner starts (4.1).
- `work/checkpoints.ts`: `put`, `list` and `prune` over `work_checkpoint` and the blob store.
- `engines/render/queue.ts`: it keeps its fairness and concurrency (`queue.ts:116-120`), but takes entries from `work/runner`. It keeps the job's work folder until the job settles, instead of deleting it at start and in `finally` (`queue.ts:203`, `268`). The boot sweep (`queue.ts:130-137`) kills orphan Blender processes but keeps folders that a live `work` row still points at.
- `engines/render/input.ts`: `renderInput` (the GLB and subject) is built once per job and stored as a blob, as checkpoint `input`. Today it is built inside the run (`queue.ts:207-208`). Storing it means a resume does not re-export, and a node can download the same bytes.
- `assistant/service.ts`, `driver.ts`: `resume()` drives a `running` run again instead of failing it (see 4.4). Shutdown stops the run, waits for it to settle, and only then releases its lease, with its status left `running` (`service.ts:239-246`; order in 4.8). `assistant/traces.ts`: `addMessage`, `beginStep` and `completeStep` for a run carry its lease epoch and refuse the write when the epoch no longer owns the lease (4.1).
- `assets/assets.ts`: `putAsset` takes an optional `originKey`, unique per org, and returns the existing row on a repeat (4.3). Today it always inserts a new row under `createId('as')` (`assets/assets.ts:106-125`); only the blob is content-addressed.
- `assets/gcs-store.ts`: a `BlobStore` (`assets/blob-store.ts:5-8`) on a Google Cloud Storage bucket, chosen when `PAVE_BLOB_BUCKET` is set. Puts use `ifGenerationMatch=0`, to keep the local store's never-overwrite rule.
- `http/node.ts`: the render-node API (`/api/node/*`), behind a token middleware separate from session auth.
- `http/health.ts`: `GET /health` (none exists today), returning database reachability and the migration version.
- `config.ts`: adds `PAVE_ROLE` (`all | api | worker`; default `all`), `PAVE_BLOB_BUCKET`, `PAVE_LOCAL_BLENDER` (`auto | off`; off when hosted), and `PAVE_KERNEL_WORKERS` and `PAVE_KERNEL_MEMORY_MB`, which feed the kernel pool's size and per-worker budget (today `min(4, availableParallelism() - 1)` and 1 536 MB: `engines/kernel/pool.ts:97`, `167`; see 4.8).

**Render worker** (`workers/render/pave_worker/`)
- `render.py`: a chunked still mode (`sample_offset` and `use_sample_subset`, one multilayer EXR per chunk, written through `image_settings.media_type = 'MULTI_LAYER_IMAGE'`), the mask render kept as a checkpoint, a resume list of finished chunks and frames, and `list_devices()`.
- `merge.py` (changed after the probe, see 4.5): merge the chunks' Combined pass with `merge_images`, denoise with the albedo and normal from chunk 0, save the result through the scene's view settings to a display PNG, then today's composite and metrics.
- One Blender process renders a job's chunks one after another. A new process is started only after a crash.

**Node** (`apps/node`, new and small)
- A Node CLI with `pair`, `run` and `status`. It reuses `@pave/render/node` (discovery, spawning, progress lines) and the take logic moved from `apps/server/src/engines/render/take.ts` into `@pave/render/node/take.ts`.
- It has no database. Its state is a folder (`PAVE_NODE_DIR`, default `~/.pave-node`) holding the token (file mode 0600 on macOS and Linux; on Windows, where POSIX modes do not restrict NTFS access, an ACL limited to the current user or DPAPI), the device settings, and the checkpoint folders of its jobs.

**Studio**
- `EngineDialog`: device list and "Render on".
- Settings → Render machines: pair, list, revoke, last seen.
- Take tile: chunk progress, Interrupted with Resume, and "Waiting for a render machine".
- Dock line: "Picked up after a restart".

**Deploy** (in this repo, as files, applied to Render by hand as Diaex does)
- `deploy/Dockerfile`: Node 22 with pnpm, the built studio, and the server. No Blender and no Python.
- `deploy/render.yaml`: a blueprint for reference only, the way `diaex:render.yaml:1-5` treats its own.
- `docs/HOSTING.md`.

## 3. Contract changes

**`packages/schema/src/api/entities.ts`**
- `JobStatus` (`entities.ts:568`) adds `interrupted`. It is live for the UI, but not claimable until Resume. `service-context.ts:15`'s `LIVE` stays `queued | running`, so the sticky guard needs a second set for the exits from `interrupted` (4.1, "Interrupted jobs, cancel and plan claims").
- Run status (`entities.ts:788-800`) adds `interrupted` too.
- `RenderJob` adds `chunks: { done: number; total: number } | null`, `attempt` (shown to people: failures plus one), `devices: string[]` (more than one when a resume moved devices), `fellBack: string | null` (the reason), and `node: { id, name } | null`.
- `Run` adds `resumes: number` and `redoneSteps: number`.
- New `RenderNode`: `{ id, name, status: 'online' | 'offline' | 'revoked', devices: Device[], runnerVersion, lastSeenAt, createdBy }`.
- New `Device`: `{ id, backend: 'OPTIX' | 'CUDA' | 'HIP' | 'ONEAPI' | 'METAL' | 'CPU', name, memoryMb? }`. `memoryMb` is filled only from `nvidia-smi` or `rocm-smi` where present; bpy reports none (4.7).
- `Capabilities` adds `renderNodes: boolean` (accounts mode) and `localBlender: boolean`.

**`commands.ts`**
- `jobs.resume { kind, id }`: owner or editor. It moves an `interrupted` job to `queued` and makes its `work` row `ready`, with one more allowed failure (`max_attempts` raised by one). It never claims a plan allowance again: the job's claim is still held (4.1).
- `jobs.cancel` (and the existing render cancel) also accepts an `interrupted` job; it moves it to `canceled` and releases its claim.
- `runs.resume`: today it replans an AI job (`service.ts:333-360`). It also accepts an `interrupted` run, which goes on in place.
- `renders.engine` returns `devices` and `preference`.
- `renders.configureEngine` adds `device: 'auto' | <device id> | 'CPU'` and `cpuFallback: boolean` (local mode only, as today).
- `nodes.list`, `nodes.pair` (returns `{ code, expiresAt }`), `nodes.rename` and `nodes.revoke`: owner only, accounts mode only.
- Tool metadata: each assistant tool def gains `replay: 'safe' | 'keyed' | 'unsafe'` (see 4.4). The tool-list snapshot test then pins every tool's value.
- Job-creating commands (`renders.create`, `production.create`, `shots.create`, `mesh3d.create`) accept an optional `originKey` (at most 128 characters), unique per org on their row. A repeat with the same key returns the existing job.
- Assets: an internal `originKey` on `putAsset` (not a public command), unique per org: `render:<jobId>:take`, `render:<jobId>:frame:<n>`, `render:<jobId>:video`, `export:<runId>:<toolCallId>`.

**Node HTTP API** (`/api/node/*`, bearer node token, JSON)
- `POST /claim {caps, runnerVersion}`: long-polls up to 25 s. It returns `{ workId, epoch, leaseUntil, job, input: { url, sha256 }, checkpoints: [{key, sha256?}] }` or 204.
- `POST /work/:id/heartbeat {epoch, progress, chunks}`: extends the lease to now + 60 s. It returns `{ cancel: boolean }`.
- `PUT /work/:id/files/:key?epoch=n`: streamed bytes, with `x-sha256` as the node's claim. The server computes the SHA-256 itself while streaming and rejects the upload if it differs from `x-sha256`; the blob is stored under the server's hash only. Node-writable keys are `chunk:\d{4}`, `frame:\d{4}` and `result:<name>`; `input`, `draft`, `mask` and any other server-owned key are refused with 403.
- `POST /work/:id/complete {epoch, results, seconds, device, critique}`, and `POST /work/:id/fail {epoch, error, retryable}`. The `critique` and any scene adjustments are parsed with the `RenderJob` critique zod schema, with every string length bounded, before they are stored or reach the assistant's tool results (today they do: `engines/render/take.ts:115`, `135`).
- The server answers `409 stale-epoch` to any write from an epoch that no longer owns the lease.

**Database** (the next free migration number at build time)
- `work`, `work_checkpoint`, `render_node` (with `token_sha256` unique, `org_id`, `name`, `devices`, `runner_version`, `last_seen_at`, `revoked_at`) and `node_pairing` (`code_sha256`, `expires_at`, `used_at`, `tries`).
- `origin_key` columns with partial unique indexes, on the job tables and on `asset`.
- `agent_step.executing_at` (nullable timestamp, 4.4).
- `production_package.render_ids` and `production_package.parties` (a snapshot taken at queue time, 4.6).
- `agent_run.resumes`.
- A backfill creates a work row for every live domain row: `ready` for `queued` and `running` ones, so the first boot after the migration resumes exactly what `recover()` would have, and `parked` for runs that are `awaiting-approval` or `waiting`.

## 4. Hard parts and decisions

### 4.1 One durable work model with leases, heartbeats and attempts

**Decision: one `work` table for every kind, beside the domain rows.**
- The claim is a single SKIP LOCKED query, and there is one reaper, one heartbeat path and one node protocol.
- A lease lasts 60 s and is renewed every 15 s.
- **Two counters, not one** (changed after review). `lease_epoch` goes up on every claim and is the only fencing token: every write a worker makes carries `(workId, lease_epoch)`, and the sticky domain update gains `AND work.lease_epoch = :epoch` in the same transaction. `failures` goes up only on a counted release or an expired lease. A single `attempt` doing both jobs would break: if an uncounted release left it at `n` and the next claim also got `n`, a late write from the old instance (a zero-downtime deploy overlaps two) would pass the fence; if the claim moved it to `n+1`, the uncounted release would still have used up a try.
- A lease that expires makes the row `ready` again with `failures + 1`, after a backoff (`not_before`: 10 s, then 60 s, then 5 min).
- `max_attempts` is 3 for renders and packages and 5 for runs, compared with `failures`. Once reached, the domain row becomes `interrupted` ("Stopped after 3 tries: Blender kept crashing on this scene"), not `failed`. Resume raises `max_attempts` by one.
- A clean shutdown (`main.ts:36-57`, 25 s budget at `main.ts:12`) releases uncounted only the work whose driver has already stopped (order in 4.8), so a deploy or `Ctrl-C` never uses up a try and never frees work that is still running.

**Fencing the assistant loop's own writes** (added after review). Fencing only the sticky domain update is not enough for runs. The loop also writes `agent_message` (`addMessage`), `agent_step` (`beginStep`/`completeStep`, `assistant/traces.ts:222-273`), the run's totals (`addUsage`, `traces.ts:337-352`), and runs tools (`loop.ts:836-890`). If an old driver keeps going after its lease lapses, it and the new owner could each make a model call and store an assistant turn: two assistant messages in a row corrupt the conversation, and tools run twice. So:
- the driver aborts itself when a heartbeat fails, or when `lease_until` minus a 10 s margin passes without a renewal;
- `addMessage`, `beginStep` and `completeStep` for a run are conditional on the lease: they run in a transaction that first checks `work.lease_epoch = :epoch AND work.state = 'leased'` for that run (or an `INSERT … SELECT … FROM work WHERE …` that inserts nothing when the fence fails), and the driver treats a refused write as "lease lost" and stops;
- a kill test freezes the heartbeat while the loop keeps running, and asserts that the frozen driver's next write is refused and that the run holds no two assistant messages in a row.

**Runs waiting for a person are `parked`** (added after review). Live runs include `awaiting-approval` and `waiting` (`recovery.ts:40`), and `service.resume()` returns at once for those (`service.ts:431-436`), so nothing would heartbeat them. Left `leased`, the row would expire every 60 s and reach `interrupted` after 5 failures while the run is only waiting; marked `finished`, nobody would re-ready it.
- When a run suspends (`finishRun` to `awaiting-approval` or `waiting`, `loop.ts:793-796`), its work row moves to `parked` in the same transaction, with its lease cleared. The claim query skips `parked`.
- `decideStep`, a `waits.register` wait settling, and `stillWaiting` finding nothing left to wait for each move the row back to `ready` (`unpark`). Each of those is the place that today calls `resume()`.
- Test: a run awaiting approval for longer than 5 lease periods stays `awaiting-approval`, with `failures` at 0; approving it then drives it once.

**PGlite.** It is real Postgres in a single connection, so `FOR UPDATE SKIP LOCKED` parses and runs. A probe (PGlite 0.5.17, three claims under `Promise.all`) showed that it runs every query one after another: the claims returned a, b, then nothing. So "two claimers never get the same row" passes on PGlite by construction and proves nothing about contention. PGlite runs of the lease suite are smoke tests only; contention is proved on real Postgres in CI (step 1). Local mode keeps one process (`PAVE_ROLE=all`). Leases still matter there: they replace boot-only recovery, they make "resume after a crash" the same code as "resume after a lease expired", and they are what makes hosting safe later.

**Why leases are needed before hosting.** During a zero-downtime deploy, the old instance still drives runs while the new one boots and calls `recover()`. Today that drives each run twice. With leases, the new instance sees a live lease and waits.

**Plan claims.** These are allowances (`plans.ts:13`, `53-69`, `273`). Recovery's orphan-claim release must treat a claim whose work row is leased, `parked`, or `ready` within its tries, as held, not orphaned. A render claim is per take (`render:<takeId>`), not per attempt, so attempts never take two allowances.

**Interrupted jobs, cancel and plan claims** (added after review). Today `updateRender` settles the claim only on terminal statuses and only updates rows in `LIVE` (`queued`, `running`) (`jobs.ts:30-39`; `service-context.ts:15`); `releaseStale` sweeps only exports (`plans.ts:55-68`); and claiming a key that was given back throws "That claim was given back" (`plans.ts:159`). So the rules are:
- An `interrupted` job keeps its claim held. `jobs.resume` moves it back to `queued` and never claims again, so it cannot hit the given-back error.
- Cancel moves an `interrupted` job to `canceled`, and a 7-day expiry (the same hourly sweep that prunes checkpoints, 4.2) moves it to `failed` ("Interrupted for 7 days"). Both release the claim. They go through a sticky guard that admits `interrupted` as a source status alongside `LIVE`; `LIVE` itself is unchanged.
- Tests for all three paths: resume (claim still `held`, one allowance used), cancel (claim released, job `canceled`), expiry (claim released, job `failed`).

**Rejected:**
- *Lease columns on each of the five domain tables.* Five claim queries and five reapers, and nodes would need a kind-specific protocol.
- *Temporal,* as Diaex uses for sourcing (`diaex:deploy/temporal-dev/render.yaml`). A second always-on service with a disk (`diaex:docs/RENDER-DEV.md:481-490`: no zero-downtime deploys), no auth in dev (`RENDER-DEV.md:477-480`), and a new dependency for what one table does here.
- *Render Workflows* [S]: public beta, no GPUs, no pause primitive, and a vendor SDK in the job core. It could host CPU jobs later behind the same `work` rows.
- *Postgres LISTEN/NOTIFY for claims.* PGlite cannot notify across processes, and polling every 2 s plus the node's long poll is enough.

### 4.2 Checkpoints, and where they live

**Decision: a checkpoint is a row in `work_checkpoint` with an input hash.**
- **Small checkpoints, and checkpoints shaped like results, go to the blob store** (content-addressed, idempotent puts, write-then-rename: `assets/blob-store.ts:4-42`): the draft pass and its critique, animation frames (PNG, a few MB each), production package files, and the render input GLB. In hosting, the blob store is the bucket, so any process can resume from them.
- **Large EXR sample chunks stay on the disk of the machine that rendered them**, under the job's kept work folder (`render-work/<jobId>/chunks/`). Only a row is recorded, with `blob_sha` null and a sha256 of the file. A resume on the same machine (local mode, or the same node reclaiming its job) uses them. Another machine starts the still from sample 0, which is honest and rare. Chunks are large: a probe chunk with 20 float32 channels and no compression was 324 KB at 64×64, which scales to roughly 330 MB at 2048×2048 [E], so 8 kept chunks could take several GB. Chunks are therefore written as half float with ZIP or DWAA compression [E: DWAA only if the equivalence gate passes with it], and each take has a stated disk budget (measured in step 3, shown in `pnpm node status` and the engine dialog). Uploading every chunk from a home connection is still a poor trade.
- **Pruning:** a job's checkpoints are dropped when it settles as `done` or `canceled`. They are kept for 7 days when `interrupted` or `failed`, so Resume or Retry can use them. Prune at boot and hourly, and only for settled rows. The same hourly sweep expires a job left `interrupted` for 7 days to `failed` and releases its claim (4.1), so job, claim and checkpoints end together.

**Rejected:** user-visible assets as checkpoints (they would show in galleries and count toward storage the designer sees), and keeping progress only in memory (today's state).

### 4.3 Idempotent ledgers: nothing charged or counted twice

The keys that exist hold across attempts and resumes:
- `usage_event` is unique on (org, key) (`db/schema/domain.ts:601`), with keys `${runId}:${idx}:llm` (`assistant/loop.ts:425`) and `render:${jobId}:${pass}` (`engines/render/queue.ts:238`);
- `plan_claim` has its key and slot uniques (`domain.ts:636-637`);
- `agent_step` has its (run, idx) and (run, toolCallId) uniques (`domain.ts:529-531`);
- design changes use `chg_<runId>_<toolCallId>`, replayed by `commitOnce` (`assistant/loop.ts:925-926`; `design.ts:100-106`).

Additions:
- Render metering per chunk: `render:${jobId}:take:${chunk}` and `render:${jobId}:frame:${n}`. Seconds from a chunk that crashed are not metered: they bought nothing. The draft pass keeps `render:${jobId}:draft`.
- `originKey` on job-creating commands. The loop passes `${runId}:${toolCallId}`, so a replayed `renders.create` returns the same take and its same `render:<takeId>` claim.
- **`origin_key` on `asset`** (added after review). Asset creation is not idempotent today: `putAsset` inserts a new row under `createId('as')` every time (`assets/assets.ts:106-125`), and only the blob is content-addressed. The render queue's `store()` calls it once per pass (`engines/render/queue.ts:246-254`), and `design.export` calls it inside `withClaim`, where a replay with the same export key gets the existing claim back and runs the work again (`handlers/design.ts:193-208`; `plans.ts:158-160`). So a resume or a node retry would create a second take, draft, frame or export asset. With `origin_key` unique per org (`render:<jobId>:take`, `render:<jobId>:draft`, `render:<jobId>:frame:<n>`, `export:<runId>:<toolCallId>`), `putAsset` returns the existing row on a repeat. The "single take asset" and "no duplicate asset" assertions in section 5 depend on this.
- **Run totals count each model call once** (added after review). `addUsage` adds to the run's totals unconditionally after `recordUsage`, even when `recordUsage` returned false because the key was already there (`assistant/loop.ts:418-432`; `traces.ts:337-352`). If the process dies after `recordUsage` but before `addStep` or `addMessage`, the resume gets the same `idx` (`nextIndex`, `loop.ts:125-131`): the ledger drops the duplicate, but `costMicros`, which feeds the run cap, adds it again. Fix: call `addUsage` only when `recordUsage` returns true, and write both in one transaction. The kill tests add a point between `recordUsage` and `addStep`.
- A known gap, stated plainly in the UI: a model call that was streaming when the process died was paid at Anthropic, but its usage never arrived. The resume makes the call again (`${runId}:${idx}:llm` is still free), so the ledger records one call while two were paid. The same holds when the crash lands after the response but before `recordUsage`. Prompt caching makes the repeat mostly cache reads [E]. The run's `redoneSteps` makes this visible. *Rejected:* a pre-call usage reservation, which guesses tokens and misprices.

### 4.4 Assistant runs resume from the last completed step

The loop already stores every model turn and tool batch before it returns (`assistant/loop.ts:1-14`). It already re-runs a step row that was begun but never answered: "Approved (or cut off mid-run by a cancel that never landed): run it now" (`loop.ts:689-697`). So the change is a policy, plus a rule for tool calls that were half done.

- **Boot or lease takeover:** a `running` run is driven again by `step(host)` from its stored position, instead of `closeOut(failed: interrupted)` (`service.ts:431-443`). `awaiting-approval` and `waiting` keep today's handling (`service.ts:432-436`), with their work row `parked` (4.1). A clean shutdown leaves the run `running`, and releases its lease only once its driver has stopped (4.8).
- **Every loop write is fenced** by the run's lease epoch (4.1), so a driver that lost its lease cannot append a turn or a step behind the new owner.
- **A model call in flight:** nothing was stored, so the call is made again (see the gap in 4.3).
- **A tool call in flight:** what happens depends on whether it began, and then on the tool's `replay` class.
  - **Did it begin?** (Added after review.) Today an approved step and a step cut off mid-run look the same: `decideStep` sets status `running` on approval (`traces.ts:305`), `beginStep` is `insertIfAbsent` and never touches the row again (`traces.ts:229`), and the existing-step branch (`loop.ts:689-697`) treats every `running` step alike. So a new nullable `agent_step.executing_at` is written, in its own committed statement, immediately before the tool's `runCommand`. A step that is `running` with `executing_at` null never started, whatever its class: run it, once. The replay class below applies only when `executing_at` is set.
  - A tool with no class counts as `unsafe`.
  - `safe` (queries, `viewport.capture`, `match.fit`, which only proposes ops and never changes the piece: `handlers/match.ts:1-7`): run again.
  - `keyed` (`design.apply` through its change id; job creators through `originKey`; exports through `export:<runId>:<toolCallId>` on both the plan claim and the asset's `origin_key`): run again, and the key makes the side effect happen once. Exports count as `keyed` only once asset `origin_key` exists (4.3); until then the plan claim is keyed but the asset is not, and `design.export` is `unsafe`.
  - `unsafe` (anything else that writes without a key): do not run again. Answer the call with an error result: "Outcome unknown: Pavé stopped while this ran. Check the piece before repeating it." Mark the step `failed` with `errorCode: 'unknown-outcome'`. The model decides what to do next, as with any tool error.
- **Crash loops:** a run whose resume crashes again with no new step stored counts a failure (`failures + 1`, 4.1). After 5 it becomes `interrupted`, and Resume allows one more.
- **The event stream:** the driver's 2000-event ring is in memory (`driver.ts:1-18`). After a restart, a studio's `Last-Event-ID` is unknown, so the stream answers `reset` and the studio refetches the run's steps from the database, which it can already render.
- **AI jobs:** an interrupted job's run resumes in place. Its plan in `agent_run.job` (`domain.ts:495`) is "progress, not truth" (`loop.ts:293`), so the plan's `running` step stays `running` until the loop moves it.

**Rejected:**
- Keeping fail-on-restart (the founder's explicit ask).
- Running every half-done mutation again (a non-idempotent write could happen twice).
- Rolling half-done mutations back (most tools have no inverse, and `design.apply` is already exactly-once).

### 4.5 Blender: chunked stills, kept frames, and what bpy 5.3 really offers

**What bpy 5.3 offers** (probed read-only):
- `scene.cycles.sample_offset`, `use_sample_subset` and `sample_subset_length`, the last described as "typically used for distributed rendering across multiple devices";
- `bpy.ops.cycles.merge_images(input_filepath1, input_filepath2, output_filepath)`: "combine OpenEXR multi-layer images rendered with different sample ranges into one image with reduced noise";
- `bpy.ops.cycles.denoise_animation(input_filepath, output_filepath)`, which "requires denoising data passes and output to OpenEXR multilayer files";
- `view_layer.cycles.denoising_store_passes`;
- multilayer EXR output, set through `image_settings.media_type = 'MULTI_LAYER_IMAGE'` (setting `file_format = 'OPEN_EXR_MULTILAYER'` alone raises an error in 5.3; probed);
- `time_limit`;
- disk-cached tiles, which cannot be resumed from.

There is no "resume a cancelled render" in Cycles. So chunking is the checkpoint.

**What the probes showed** (changed after the probe; scratch renders with `denoising_store_passes`, `use_pass_vector` and `pass_debug_sample_count` on, written as multilayer EXR):
- Each chunk file is a multipart EXR with 19–20 channels: Combined, Vector, Denoising Albedo, Normal, Depth, Roughness, Specular Albedo, Debug Sample Count.
- `merge_images` returns FINISHED, but the merged file is a single-part EXR holding only the 4 Combined channels. It drops every pass the denoiser needs.
- `denoise_animation` on the merged file therefore fails: "Could not find a render layer containing denoising data and motion vector passes". On a single chunk file it succeeds, so it does accept one frame (the old [verify] is answered: yes).
- The merge is an unweighted mean: the average of two chunks minus the merged file is exactly 0, even with the Debug Sample Count pass on. So it is exact only when every chunk took the same number of samples in every pixel, which means adaptive sampling off.
- With adaptive sampling on, chunked against full differed by a mean of 5.4e-4 and a maximum of 0.048 (256 samples, 64×64, CPU), which would trip the gate.
- So the earlier chain (`merge_images`, then `denoise_animation` on the merged file, then today's composite) does not work in bpy 5.3, and is replaced below.

**Decision for stills** (changed after the probe).
- A take pass renders `n` chunks of `samples / n`, using `sample_offset = k·(samples/n)` with the fixed seed (`render.py:80-83`), **with adaptive sampling off**, so each chunk has the same sample count everywhere and the unweighted merge is exact. In-render denoising is off in each chunk. Each chunk stores Combined plus its denoising passes (albedo, normal) and Vector in one multilayer EXR, as half float with ZIP or DWAA compression (4.2).
- Each chunk is written to a temporary name and then renamed, then recorded.
- The mask render (`render_mask`, `render.py:129-143`) is rendered once and kept as checkpoint `mask`, so a resume does not repeat it.
- At the end:
  1. **Merge Combined.** Fold the chunks' Combined pass pairwise with `merge_images` (exact here, because the chunks are equal-weight).
  2. **Denoise** with the merged Combined as the image and the albedo and normal from chunk 0, which converge within the first chunk's samples [E, checked in the gate]. Primary: a compositor Denoise node in a scratch scene, fed by the merged file and chunk 0's passes [verify in step 3 that bpy 5.3's compositor reads named passes from a multilayer EXR]. Fallback: rebuild one multilayer file holding the merged Combined, chunk 0's denoising passes and its Vector pass, and run `denoise_animation` on it, which the probe showed works on a single-frame file with those passes.
  3. **Colour-manage.** The denoised result is still linear scene light. Load it into Blender and save it with `save_render` under the scene's view transform, look and exposure (`render.py:89-93`) as an 8-bit display PNG, which is what today's path produces directly (`render.py:94-98`). Today's composite and metrics (`render.py:117-127`, `146-168`) then run on that PNG unchanged.
- `n` is 1 for preview (15 min cap, not worth it), 4 for standard and 8 for final (`queue.ts:44-51`). Preview keeps today's single pass with adaptive sampling and in-render denoising.
- One Blender process renders all of a job's chunks, with `use_persistent_data` so scene sync and BVH build are paid once [E].
- The draft pass (`engines/render/take.ts:1-6`) is not chunked. Its result and critique become checkpoint `draft`, so a resume skips straight to the take.
- *Considered, kept for later:* merging every pass in Pavé as a sample-count-weighted mean, which would allow adaptive sampling in chunks. It needs an EXR reader, and the venv has no OpenImageIO, so it is either a new dependency (founder's OK) or a small multipart reader written here. Take it up only if the gate shows adaptive-off chunks cost too much.

**Gates (step 3).**
- *Unit gate:* the file handed to the denoiser carries Combined, Denoising Albedo, Denoising Normal and Vector, and the merged Combined equals the per-pixel mean of the chunks within float tolerance. This would have caught the broken chain above.
- *Equivalence gate:* `packages/render/scripts/repeat-check.ts`, extended, compares the chunked path's final display PNG (adaptive off, merged, denoised offline, colour-managed) with today's unchunked output at the same samples (adaptive on, denoised in the render, display PNG), on one jewelry fixture, on CPU. Offline denoising is not the same as in-render OIDN, so equality is not expected: the tolerances are measured, against the metrics in `pave_worker/metrics.py` and a PSNR floor set from two plain repeats of today's path, and written into the gate.
- *Cost gate:* the same fixture measures what turning adaptive sampling off costs. The earlier "about 20% slower" figure is dropped: on the probe (CPU, 256 samples, 64×64) the adaptive render took 0.04 s and the non-adaptive one 0.29 s. That toy scene is not a jewelry take, so the tile states the measured figure from the gate, and if it is large, the options are fewer, larger chunks for standard, or the weighted merge above.

**Animations.** Frames are already rendered one at a time (`render.py:171-191`). The frame folder becomes the checkpoint folder: each composited `frame_NNNN.png` is recorded, uploaded in hosting, and skipped on resume. The video is encoded once at the end (`render.py:196+`). Temporal denoising over frames is a scope cut.

**A resume on a different device** keeps the existing chunks. They are independent sample ranges, so the merge is still statistically valid [E]. The take records both devices, and byte-reproducibility is claimed only for a take rendered on one device.

**Rejected:** `time_limit` slices (no sample bookkeeping, so they cannot be merged exactly), border or region tiles (seams under glare and depth of field, and a jewelry hero shot is all highlights), and leaving stills unchunked (a 3-hour final would lose everything to a crash).

### 4.6 Photo fits and production packages

- **Production packages** are rebuilt byte-identically today: the piece version is checked (`engines/production.ts:66`) and the package is dated with the row's creation time (`production.ts:87`). One kernel task does the whole build (`production.ts:71-96`, up to 900 s at `engines/kernel/pool.ts:53-61`).
  - But a rebuild is byte-identical only if what the package includes is unchanged too: `build()` re-queries `finishedRenders(piece.id)` and `parties(sctx)` on every attempt (`production.ts:68`), so a take finished or a party edited between a crash and the resume changes the zip. Decision (added after review): snapshot the render ids and the parties on the package row at queue time (`production_package.render_ids`, `.parties`), build from the snapshot, and include both in `input_hash`.
  - Decision: split the kernel `package` task's output into its files. Store each finished file (STEP, 3dm, STL, drawings PDF) as a blob checkpoint keyed by `file:<path>` with `input_hash = (pieceId, sourceVersion, request hash, render ids, parties hash)`. A resumed build skips what it has and zips at the end.
  - The STEP and 3dm exports are the slow part [E]. The same blobs also make a re-export of an unchanged version instant.
  - [verify] Measure a real package first. If it builds in under 60 s, this step drops to the scope cuts.
- **Photo fits** take at most two minutes, use a seeded rng (`packages/match/src/rng.ts`), and return ops without changing the piece (`handlers/match.ts:1-7`).
  - Decision: when hosted, a fit runs as `work` of kind `fit` with its stored result, so a restart reruns it deterministically and the caller (a studio or an assistant step) still gets an answer.
  - No mid-fit checkpoint: losing at most two minutes does not justify threading optimizer state through `loop.ts`.
  - Locally it stays a synchronous request (`pool.ts:53-61`), with `replay: 'safe'` for the assistant.
- **Mesh (image to 3D) and on-model shots** can already resume by provider job id (`recovery.ts:183-211`). Neither service is registered in compose on this branch (`compose.ts:24-29`), so they fail. Register them when their providers land (`docs/plans/render-and-models.md` step 6), and add their kill tests then. Until then they become `interrupted`, not `failed`.

### 4.7 GPU device detection and fallback

- Today `select_device()` tries OPTIX, CUDA, HIP, ONEAPI, METAL, then CPU, overridden by `PAVE_CYCLES_DEVICE` (`render.py:26-53`).
- The probe adds `list_devices()`: for each backend this build compiles in (Linux bpy has no METAL; macOS has METAL; probed), it calls `refresh_devices()` and lists id, name and type. bpy reports no memory: `CyclesDeviceSettings` has only `id`, `name`, `type`, `use`, `is_optimized` and `meets_driver_requirement` (changed after the probe). Each backend's list also includes the CPU, so CPU entries under a GPU backend are filtered out. Memory is read from `nvidia-smi` or `rocm-smi` where present and matched by name; otherwise `memoryMb` is left empty. The result is saved with the engine probe in `engine.json` (`engines/render/blender.ts:1-6`).
- **Preference:**
  - `auto` picks the first backend with a usable GPU in a fixed order, OPTIX, CUDA, HIP, ONEAPI, METAL (today's `select_device()` order), then CPU. It does not rank by memory, which bpy cannot report (changed after the probe).
  - A named device pins it.
  - `CPU` forces CPU.
  - `PAVE_CYCLES_DEVICE` still wins, for headless setups.
- **Fallback:** if a GPU pass fails with an error Blender reports as out of memory, or as a device or kernel failure (matched from its log lines), and `cpuFallback` is on, the same attempt re-runs that chunk on CPU. The take records `fellBack`. Other errors fail the attempt as today.
- **Detecting failure honestly:** a GPU that disappears mid-job (a driver reset) shows up as a Blender crash. The lease then expires, and the next attempt probes devices again.
- `PAVE_RENDER_THREADS` (`render.py:84-88`) still limits CPU threads, so the studio stays usable during a CPU fallback.
- *Rejected:* rendering on several GPUs in one Blender process by default. Cycles supports it, but the gain on one-card machines is zero and it complicates out-of-memory fallback. Leave it as an opt-in device choice.

### 4.8 Deploying on Render, like Diaex, and what runs where

Diaex runs in Ohio, with Development and Production environments, a Docker web service with a `/health` check, private Postgres, environment groups made by hand, GCS buckets for files, and a Pro workspace in Production (`diaex:render.yaml:20-56`; `diaex:docs/PRODUCTION.md:17-30`). Pavé copies that shape:

| Where | What |
|---|---|
| Render web service `pave-web` (Docker, Ohio, no disk) | API, studio static files, kernel worker threads (evaluate, export, photo fit, packages), assistant driver, work runner with `PAVE_ROLE=all` and `PAVE_LOCAL_BLENDER=off` |
| Render Postgres `pave-db` (private only, point-in-time recovery in Production) | Everything relational, including `work` and its leases |
| GCS bucket, one per environment (as Diaex: `diaex:docs/RENDER-DEV.md:21-23`) | Blobs: assets, render inputs, frames, package files |
| Environment group `pave-dev` / `pave-prod`, made by hand | `DATABASE_URL`, `BETTER_AUTH_SECRET`, `PAVE_PUBLIC_URL`, `PAVE_BLOB_BUCKET`, `PAVE_KERNEL_WORKERS`, `PAVE_KERNEL_MEMORY_MB`, the service-account secret file. Never `ANTHROPIC_API_KEY`, `PAVE_PLAN` or `HOST` (see "The founder's API key" below) |
| Founder's GPU machine | `apps/node`: Blender renders only |
| Never on Render | Blender, Python, GPUs ([S]: no Render GPU offering), PGlite |

- **No disk on `pave-web`.** A disk turns off zero-downtime deploys and pins the service to one instance (`diaex:docs/RENDER-DEV.md:481-490`; [S]). Scratch goes to `os.tmpdir()`. Everything durable is in Postgres or the bucket.
- **Kernel worker threads are sized, not guessed** (added after review). The pool defaults to `min(4, availableParallelism() - 1)` workers with a 1 536 MB budget each (`engines/kernel/pool.ts:97`, `167`), and in a container `availableParallelism()` may report the host's CPUs rather than the instance's quota [E]. Diaex's API runs on `1c-2g` (`diaex:docs/PRODUCTION.md:22`); four 1.5 GB workers would not fit. `PAVE_KERNEL_WORKERS` and `PAVE_KERNEL_MEMORY_MB` are set in the environment group, for example 1 worker and 1024 MB on a 2 GB instance [E], and step 6 builds a real production package inside the Docker image under that memory limit.
- **Shutdown** (order changed after review). Render sends SIGKILL 30 s after SIGTERM by default, and `maxShutdownDelaySeconds` extends that (`diaex:docs/RENDER-DEV.md:201-208`; [S]). Pavé's 25 s budget (`main.ts:12`) fits. Releasing leases before the drivers have stopped would let the next instance claim work that is still running: an abort can take up to 15 s today (`engines/render/queue.ts:54-56`, `STOP_WAIT_MS` 15 000 with `KILL_AFTER_MS` 5 000), and the loop finishes its mutations before it checks the signal (`assistant/loop.ts:781-785`). So on SIGTERM:
  1. stop claiming;
  2. abort every driver and job with `shutdown`;
  3. await each one settling, bounded by the 25 s budget;
  4. release uncounted only the work that has settled;
  5. exit. Anything still running at the deadline keeps its lease, which expires and is counted as a failure. That costs a try but never runs a job twice.
  A kill test sends SIGTERM mid-tool and checks that no second driver starts before the first has stopped.
- **Migrations** run at boot today (`db/client.ts:36`). Under zero-downtime deploys, old code runs against the new schema for a while, so every migration from the durable-work one on must be additive (expand, then contract in a later release) [E]. Move migration to `preDeployCommand: node dist/migrate.js` as Diaex does (`diaex:render.yaml:34-56`), so a failed migration stops the deploy rather than a boot.
- **One instance for the web service.** The event bus is in-process (`events.ts:22-41`), and node reports arrive over HTTP at that same instance, which publishes them. A second instance needs a cross-instance bus (a scope cut).
- **CPU-heavy work later:** a Render background worker `pave-worker` (`PAVE_ROLE=worker`) can claim `production` and `fit` work from the same table and report through the private network to `pave-web`'s node API, the same path a GPU node uses. Do this only when packages slow the API.
- **Local stays local:**
  - `PAVE_AUTH=local` only listens on loopback (`config.ts:66`);
  - `renders.configureEngine` is refused outside local mode;
  - PGlite and the Electron shell are local only;
  - local mode never registers node endpoints.
- **The founder's API key.**
  - Locally, the assistant uses his key as it does now (`assistant_key`: `domain.ts:84`).
  - Hosted, the same table holds the org's key.
  - The key never goes to a node.
  - Encryption at rest is already done (the old [verify] is removed): the stored key is sealed with AES-256-GCM under a key derived from the auth secret, with the org id as associated data (`assistant/keys.ts:1-60`; `domain.ts:79-91`).
  - **Two traps** (added after review):
    - `ANTHROPIC_API_KEY` in the environment "wins, for every organisation" (`assistant/keys.ts:4`). Set on Render, it would bill every account to the founder's key. So accounts mode refuses to start when it is set [E: refuse rather than warn, as Diaex's API refuses `DIAEX_DEV_AUTH` and `DIAEX_MOCK_LLM`].
    - Rotating `BETTER_AUTH_SECRET` makes every stored key unreadable with no error (`unseal` returns null). `docs/HOSTING.md` says that rotating it means every org saves its key again, and the Settings screen says "Your key needs to be saved again" when a stored key fails to unseal.
  - **Never set on Render**, listed in `docs/HOSTING.md` and as a comment in `deploy/render.yaml`, as Diaex does (`diaex:render.yaml:16-18`): `ANTHROPIC_API_KEY`, `PAVE_PLAN` (a testing override of the plan, warned about at `main.ts:22-24`; already ignored in accounts mode, `config.ts:84`, `93-99`), and `HOST`.
- **Costs** are read from Render's pricing page at deploy time [S]. Diaex Production on a Pro workspace is about $98 a month (`diaex:docs/PRODUCTION.md:30`). Pavé adds one web service, one Postgres and one bucket.

### 4.9 Render nodes

**Pairing.**
- An owner creates a pairing code: 8 characters, single use, valid for 10 minutes, stored as a sha256 hash (`node_pairing`).
- `pnpm node pair <url> <code>` exchanges it for a node token: `pvn_` followed by 32 random bytes in base64url. The token is shown to the node once and stored at `~/.pave-node/token`, with mode 0600 on macOS and Linux, and on Windows (the repo ships `install.ps1`) with an ACL limited to the current user or sealed with DPAPI, because POSIX modes do not restrict NTFS access. The server stores only its sha256 (`render_node.token_sha256`).
- Pairing happens before any token exists, so per-token rate limits do not cover it. The exchange is limited per client IP and per code, and a code is locked after 5 wrong tries (`node_pairing.tries`).
- *Rejected:* reusing a user session or an API key (too broad, and a stolen laptop session would let someone render as that person), and mTLS (painful for a designer to set up).

**Scope.** A node token can:
- call `/api/node/*`;
- claim only `work` of `kind = 'render'` in its own org whose `requires` its devices meet;
- read and write only the files of work it currently leases, at that lease epoch, and write only node-writable keys (`chunk:\d{4}`, `frame:\d{4}`, `result:<name>`), with the hash computed by the server (section 3).

It cannot read pieces, threads or keys, and it cannot create assets directly. Results become assets on the server, after checks.

**Connection.**
- Outbound HTTPS only, with no inbound port on the founder's machine.
- The node long-polls `claim` with a 25 s wait (well under Render's request limits [S]) and heartbeats every 15 s with progress. A `{ cancel: true }` in the heartbeat answer kills Blender's process tree (as `cancel` does today).
- Downloads (the render input GLB) and uploads (frames, the final PNG or MP4, draft and critique) stream through the API first. That keeps one auth path and one place for checks. Signed bucket URLs come later, if bandwidth through `pave-web` costs too much.

**Disconnects.**
- If the network drops, the node keeps rendering and keeps its chunks.
- If it comes back within the lease (60 s), the heartbeat simply continues.
- If the lease expired meanwhile, the job became `ready` (with one failure counted). With no other node it is still queued, so the same node claims it again under a new lease epoch. Its local chunks match by `input_hash`, so it resumes where it was, and the uploads it had not finished are repeated, idempotent by key and the server's sha, and by asset `origin_key` for results.
- If another node took the job, the first node's writes get `409 stale-epoch`, and it discards its work.
- When the server restarts, the node retries with backoff (1, 2, 5, then 30 s) and never drops local checkpoints because of a server error.

**Versions.** The node sends `runnerVersion` (the render worker and `@pave/render` versions). The server refuses claims from a node whose runner differs from the version that produced the job's cache key (`domain.ts:336`), and shows the reason on the machine card: "Update Pavé on this machine". The cache key covers the runner version, so mixed versions would split the cache.

**Job data security.**
- A render input is the design's geometry, which is the jeweler's IP. It goes only to nodes the org paired, over TLS. The node deletes a job's folder once the job is settled, and `pnpm node status` shows what it holds. A revoked node never learns that its jobs settled, so on any `401` or `revoked` answer the node wipes every job folder and its token before it stops.
- The server sends data (scene JSON and GLB), never code. The Blender runner is the node's own installed `workers/render` code, so a compromised server cannot run arbitrary Python on the node through this protocol.
- In the other direction, an upload is checked before it becomes an asset: the server computes its SHA-256 while streaming and refuses a mismatch with `x-sha256` (the blob store skips a put whose key exists, `assets/blob-store.ts`, so a blob stored under a false hash would stay wrong for every org that later has those bytes); its key must be node-writable, so it can never replace `input` or another server-owned checkpoint; its type is read from its magic bytes (PNG, MP4 or WebM); it has a size limit (`PAVE_MAX_UPLOAD_MB`, `config.ts:51`); and its dimensions must match the scene. The critique and scene adjustments are parsed with the critique zod schema, strings bounded, before they are stored or shown to the model. A node cannot write anything else.
- Tokens are revocable, and revocation takes effect at the next request. The machine card shows last seen and IP, with the client IP taken from the rightmost forwarded-for hop added by Render's proxy, never the first entry, which a caller controls (Diaex deliberately trusts no forwarded-for header: `diaex:render.yaml:49-50`) [S on the hop Render adds]. Node endpoints are rate-limited per token, and pairing per IP and per code.

**What stays local-only:** nodes in local mode (a local server already runs Blender itself); pairing in `PAVE_AUTH=local`; Blender discovery and configuration on a hosted server.

## 5. Verification

- **Lease unit tests (Vitest).** They run against real Postgres with real parallel connections, in a new ubuntu-only CI job with a Postgres service (step 1); `.github/workflows/ci.yml` today runs lint, typecheck, test and build on ubuntu, macos and windows with no Postgres. On PGlite, which runs one query at a time (4.1), the same suite runs as a smoke test only.
  - two claimers never get the same row (Postgres only; on PGlite it passes by construction);
  - an expired lease is reclaimed with `lease_epoch + 1` and `failures + 1`;
  - a stale epoch's heartbeat, file, complete, sticky update, `addMessage`, `beginStep` and `completeStep` are all refused;
  - an uncounted release leaves `failures` unchanged, and the next claim still gets a new `lease_epoch`, so a late write from the released holder is refused;
  - `failures` reaching `max_attempts` leads to `interrupted`, and `jobs.resume` allows one more;
  - a run awaiting approval for longer than 5 lease periods stays `awaiting-approval` and `parked`, with `failures` at 0; approval, a settled wait and `stillWaiting` each move it to `ready`;
  - `interrupted` paths: resume keeps the plan claim `held` and claims nothing new; cancel releases it and ends `canceled`; the 7-day expiry releases it and ends `failed`;
  - a held plan claim (leased, `parked`, or `ready` within its tries) is never released as an orphan;
  - `putAsset` with the same `originKey` twice returns one row.
- **Kill tests (`apps/server/test/kill/`, a child-process server with a fake Blender runner from `queue.test.ts`, plus SIGKILL at named points through `PAVE_KILL_AT=<point>`).** For each kind, kill, restart and assert the end state, the ledger rows and the plan claims. They run in the Postgres CI job, and on PGlite locally:
  - **Render:** kill during the draft, after the mask, after chunk 1 of 4 is written, mid-chunk 3, between the last chunk and the merge, after the merge before the denoise, after the denoise before the display PNG, after the PNG before `done`, and between the upload and the `done` row. Assert that each kept chunk is not re-rendered (by counting runner chunk invocations), that `usage_event` has exactly one row per chunk, that one plan claim is `used`, and that a single take asset exists (by `origin_key`).
  - **Animation:** kill after frame 7 of 24. Frames 0–7 are not rendered again, and one video asset exists.
  - **Production:** kill after the STEP file and before the zip. The STEP is not rebuilt, and the zip is byte-identical to an uninterrupted build; finishing a new take between the kill and the restart does not change it (the snapshot, 4.6).
  - **Assistant (`scriptedModel`):** kill during a model call, between `recordUsage` and `addStep`, after the model turn is stored but before the tools, after approval but before `executing_at` is written, during `design.apply` after the commit but before `completeStep`, during `renders.create` after the row but before the step result, during `design.export` after the asset but before the step result, and during an `unsafe` tool after `executing_at`. Assert, in order: one stored turn; one usage row and run totals counted once; tools run once; the approved-but-not-started tool runs exactly once; one design change (replayed); one take (by `originKey`); one export asset (by `origin_key`); the `unknown-outcome` result; `redoneSteps`.
  - **Lost lease:** freeze the heartbeat while the loop keeps running. The frozen driver aborts at `lease_until` minus the margin, its next fenced write is refused, the new owner drives the run, and the conversation never holds two assistant messages in a row.
  - **SIGTERM inside the 25 s budget:** no failure is counted for work that settled, the run is left `running`, and the next boot goes on from there.
  - **SIGTERM mid-tool, with a second instance running:** the second instance does not start a driver for that run until the first has stopped; work that had not settled by the deadline is left to expire and is counted.
  - **Crash loop:** a runner that always crashes ends `interrupted` after 3 failures, with backoff between them.
- **Render unit gate (step 3):** the file handed to the denoiser carries Combined, Denoising Albedo, Denoising Normal and Vector, and the merged Combined is the per-pixel mean of the chunks (4.5).
- **Real Blender here (CPU, gated on the venv):** the chunk equivalence and cost gates from 4.5, plus a real SIGKILL of the Blender process mid-chunk that resumes and finishes.
- **Node tests (`apps/node`, with a test server):**
  - pair (an expired code, a reused code, a code locked after 5 wrong tries, the per-IP limit);
  - claim scope (another org's job, a mesh job);
  - file API: an upload whose bytes do not match `x-sha256` is refused and leaves no blob; a write to `input`, `draft` or `mask` is refused; an oversized or malformed critique is refused before it reaches a tool result;
  - revoke: on the `401` the node wipes its job folders and token;
  - **network cut tests** through a TCP proxy the test can cut: 10 s mid-chunk (the lease is held, no new attempt), 90 s (the lease expires, the same node reclaims and resumes from its local chunks), a cut during an upload (the repeat is idempotent), and a cut on the reply to the final `complete` (the retry gets the same result, with no duplicate asset);
  - two nodes after a cut (the first gets `409`, one result);
  - revoke mid-job (the next heartbeat is refused and the work returns to the queue);
  - a runner version mismatch.
- **GPU (the founder's machine, manual, recorded in the PR):** the device list (no CPU entries under GPU backends; memory shown only where `nvidia-smi` or `rocm-smi` reports it), Auto, a pinned device, CPU only, and a forced out-of-memory (a huge resolution) falling back to CPU with `fellBack` recorded.
- **Hosting image (step 6):** a real production package built inside the Docker image under a 2 GB memory limit, with `PAVE_KERNEL_WORKERS` and `PAVE_KERNEL_MEMORY_MB` as set for Render; and accounts mode refusing to start with `ANTHROPIC_API_KEY` set.
- **Hosting (Render dev environment):**
  - a deploy while a render and a run are live: no duplicate driving, both finish;
  - `/health`;
  - a failed migration stops the deploy;
  - blobs land in the bucket.
- **Screenshots** (`apps/studio/e2e/shots.ts`): Resuming tile, Interrupted with Resume, chunk progress, engine dialog devices, Render machines (empty, pairing, online, offline, revoked), "Waiting for a render machine", the dock line after a restart. Light and dark.
- **Not verifiable here:** GPU behaviour (this box has no GPU; CUEW and HIPEW fail to load), METAL, Render platform behaviour [S], and real home-network upload speeds.

## 6. Scope cuts

- More than one web instance, and a cross-instance event bus.
- Uploading EXR chunks so that another machine can take a still over mid-way.
- Splitting one still across several nodes (`use_sample_subset` would allow it later).
- Temporal denoising of animations (`denoise_animation` across frames).
- Signed bucket URLs for node transfers.
- A platform-owned shared render farm, and nodes shared between orgs.
- Billing for node time (metered at `costUsd: 0`, as today).
- Mid-fit checkpoints for photo fits.
- Render Workflows, Temporal, and Kubernetes.
- Auto-update for nodes.
- Windows service and launchd packaging for the node (it runs in a terminal first).
- A Pavé Production environment before the dev environment has run real jobs for two weeks.

## 7. Build order

Each step ships alone and is tested alone. Steps 1–4 are useful on the founder's own machine before any hosting.

0. **Founder's local test with his Claude key** (not part of this plan; nothing below blocks it). Take notes on which interruptions actually hurt, and reorder steps 2–5 by them.
1. **Durable work core.** `work` (with `lease_epoch`, `failures` and the `parked` state) and `work_checkpoint`, the migration (next free number) and backfill, `work/lease.ts`, `work/runner.ts` replacing one-shot `recover()`, the driver's self-abort on a lost lease, fencing in the sticky updates, the `interrupted` status with its claim, cancel and expiry rules, `jobs.resume`, plan-claim orphan rules, the settle-then-release shutdown order, and a new ubuntu-only CI job with a Postgres service. Proof: the lease unit tests against real Postgres with parallel connections in that CI job (PGlite runs are smoke tests only, because PGlite serialises queries), the existing recovery, queue and production suites unchanged, and kill tests on today's behaviour, including SIGTERM with a second instance.
2. **Assistant runs resume.** Replay classes on every tool def (snapshot), `originKey` on job creators, asset `origin_key` in `putAsset` (before exports count as `keyed`), `agent_step.executing_at`, fenced `addMessage`/`beginStep`/`completeStep`, `parked` on suspend and `unpark` on approval and waits, `addUsage` only when `recordUsage` stored a row, resume instead of fail, shutdown keeps runs `running`, stream `reset`, `redoneSteps`, and the dock line. Proof: the assistant kill tests, including the lost-lease test and the approved-but-not-started case.
3. **Render checkpoints.** The input GLB as a blob, kept work folders, the draft and mask checkpoints, chunked stills with adaptive sampling off (half-float, compressed EXR, a disk budget per take), the Combined merge, the denoise with chunk 0's passes, the colour-managed display PNG, kept frames, take and frame assets by `origin_key`, per-chunk metering, and tile progress. Gates, in this order: the unit gate (the denoiser's input carries the denoising and vector passes), then chunk equivalence against today's denoised unchunked output with measured tolerances, then the measured cost of adaptive-off chunks. Proof: the render kill tests and a real SIGKILL of Blender.
4. **Production checkpoints**, gated on measuring a real package (drop the step if it builds in under 60 s). The render-id and party snapshot goes in either way, because the byte-identical rebuild depends on it. Proof: the byte-identical zip after a kill, with a take finished in between.
5. **Local GPU.** `list_devices()` (bpy names and types, memory from `nvidia-smi`/`rocm-smi` where present, CPU entries filtered), Auto in fixed backend order, the engine dialog's device choice, `configureEngine` device and fallback, `fellBack`, device-aware chunk resume. Proof: unit tests with injected probe output, then the manual GPU run on the founder's machine.
6. **Ready to host.** `GET /health`, GCS `BlobStore` with `ifGenerationMatch=0` (new dependency `@google-cloud/storage`, needs the founder's OK), `PAVE_ROLE`, `PAVE_LOCAL_BLENDER`, `PAVE_KERNEL_WORKERS` and `PAVE_KERNEL_MEMORY_MB`, accounts mode refusing to start with `ANTHROPIC_API_KEY` set, migrations as a separate command, the Dockerfile, and `docs/HOSTING.md` with the "Never set on Render" list and the note on rotating `BETTER_AUTH_SECRET`. Proof: the server suite against Postgres with a fake bucket, the Docker image booting locally against Postgres, and a real package built in the image under a 2 GB memory limit.
7. **Render dev environment.** Created by hand like Diaex: `pave-web`, `pave-db`, the bucket, the `pave-dev` group, an address of the founder's choosing. Before the first deploy, check the group against the "Never set on Render" list (stored keys are already sealed at rest, so that check is no longer a gate). Proof: the deploy-while-live test and `/health`. Production waits (see the scope cuts).
8. **Render nodes.** `render_node`, pairing with per-IP and per-code limits, the node API with token scope, server-computed hashes, node-writable keys only and the critique schema, `apps/node` (`pair`, `run`, `status`) with take logic moved into `@pave/render/node`, the token stored with 0600 or a Windows ACL/DPAPI, the wipe on revoke, Settings → Render machines, "Waiting for a render machine", and the runner version check. Proof: the node tests including network cuts and the file API refusals, then the founder's GPU machine against the dev environment.
9. **Later, when measured:** `pave-worker` for CPU work, `fit` as work when hosted, and registering mesh3d and on-model with their kill tests (with `docs/plans/render-and-models.md` step 6).
