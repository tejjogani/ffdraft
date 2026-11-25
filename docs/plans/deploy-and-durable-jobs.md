# Durable jobs, local GPU, hosting on Render, and render nodes

Build brief, planning only: nothing here is built yet, and none of it blocks the founder's first local test with his own Claude API key. Build it after that test.

**Honest summary.** Pavé already checkpoints the assistant one step at a time, and it already meters, claims and design-commits idempotently. Every other piece of long work, though, is owned by "this process": in-memory maps, no lease, no heartbeat, no attempt count. So a restart throws away work that was nearly done. A Blender take starts again from sample 0, a production package is rebuilt, and an assistant run that was mid-step is failed. A clean shutdown fails that run too. None of this is safe with two processes, so it is not safe on Render either: a zero-downtime deploy briefly runs two instances. A GPU machine that renders for a hosted server is not possible today.

The plan has four stages, each useful alone:
1. **Local durability.** One durable work model with leases, attempts and checkpoints. Assistant runs resume instead of failing. Renders resume from sample chunks and kept frames.
2. **Local GPU.** Device detection, a device choice and an honest fallback.
3. **Hosting on Render,** shaped like Diaex: web service, Postgres, a bucket, no Blender.
4. **Render nodes.** The founder's GPU machine runs a small Pavé worker that connects outbound and pulls renders.

Render has no GPUs [S], so GPU work never runs on Render.

Paths are in `/home/user/ffdraft-ai` (branch `ai/assistant`) under `apps/server/src/`, unless they name a package or `workers/`, or are marked `main:` (this repo) or `diaex:` (read-only). Labels: [S] means a web fact not opened at its source (render.com did not resolve from the planning session); [E] means judgement; [verify] means a gate in the build order. bpy facts were probed read-only on `bpy 5.3.0` in `workers/render/.venv`. Line numbers were read on 2026-11-25 while other work was editing these files, so expect them to drift by a few lines; the names around them are the anchor.

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
- The finished take looks the same as an unchunked one at the same samples. That is a gate, measured in step 3, not a promise made here.

**Choosing a GPU.**
- The engine dialog (Render tab → engine chip) lists what Blender found: "NVIDIA RTX 4090 · OptiX", "CPU · 24 threads".
- **Render on** offers Auto (the best GPU, then CPU), one named device, or CPU only.
- **If the GPU fails, use the CPU** is on by default locally.
- Each take records the device it used, and says so when it fell back: "Rendered on CPU: the GPU ran out of memory".

**Hosted Pavé, with his own GPU machine as a render node.**
- The founder signs in at a Pavé address on Render. Settings → **Render machines** → **Add a machine** shows a one-time pairing code.
- On his GPU machine he runs `pnpm node pair <address> <code>` from the same Pavé install, then `pnpm node`. The machine appears as "Studio PC · online · RTX 4090 · idle".
- Renders queued in the hosted studio go to it. If it is offline, the take waits with "Waiting for a render machine", or he picks Browser render.
- If the machine sleeps or its network drops mid-render, the take shows "Machine offline, will resume" and carries on from its kept chunks when the machine is back. He can revoke a machine at any time.

## 2. Structure

**Database: one durable work model** (new table `work`, migration `0012_durable_work.sql` on top of `ai:` `0011`).
- Columns: `id`, `org_id`, `kind` (`render | production | mesh3d | shot | run | fit`), `ref_id` (the domain row), `created_by`, and `requires` (jsonb: `{ engine: 'blender', gpu?: true }`).
- Lease and attempt columns: `state` (`ready | leased | finished`), `lease_owner`, `lease_until`, `heartbeat_at`, `attempt`, `max_attempts`, `not_before`, `last_error`, `created_at`.
- Unique on (`kind`, `ref_id`).
- The domain rows (`render_job`, `production_package`, `mesh_job`, `model_shot`, `agent_run`) keep their status and their sticky updates (`jobs.ts:29-113`). `work` holds only who runs the job, until when, and which attempt this is.

**Checkpoints** (new table `work_checkpoint`).
- Columns: `work_id`, `key` (`draft`, `chunk:0003`, `frame:0042`, `file:model.step`), `input_hash`, `blob_sha` (null when the bytes stay on the machine's disk), `bytes`, `meta` (jsonb), `attempt`, `at`. Unique on (`work_id`, `key`).
- A checkpoint counts only when its `input_hash` matches the job's current input, so a changed scene never reuses old samples.

**Server modules**
- `work/lease.ts`: `claim(kinds, owner, caps)`, `heartbeat(id, attempt)`, `release(id, attempt, { counted })`, `finish(id, attempt)`. Every write is fenced by `(id, attempt)`. The claim is `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING`.
- `work/runner.ts`: the in-process loop that claims work this process can do, turns each claim into the existing service call (`resume`/`submit`), and heartbeats while it runs. It replaces the one-shot `recover()` (`app.ts:82`; `recovery.ts:44-269`) with a standing loop. At boot it reclaims leases this process owned before (by owner id) and any lease that has expired.
- `work/checkpoints.ts`: `put`, `list` and `prune` over `work_checkpoint` and the blob store.
- `engines/render/queue.ts`: it keeps its fairness and concurrency (`queue.ts:116-120`), but takes entries from `work/runner`. It keeps the job's work folder until the job settles, instead of deleting it at start and in `finally` (`queue.ts:203`, `268`). The boot sweep (`queue.ts:130-137`) kills orphan Blender processes but keeps folders that a live `work` row still points at.
- `engines/render/input.ts`: `renderInput` (the GLB and subject) is built once per job and stored as a blob, as checkpoint `input`. Today it is built inside the run (`queue.ts:207-208`). Storing it means a resume does not re-export, and a node can download the same bytes.
- `assistant/service.ts`, `driver.ts`: `resume()` drives a `running` run again instead of failing it (see 4.4). Shutdown stops the run with its lease released and its status left `running` (`service.ts:239-246`).
- `assets/gcs-store.ts`: a `BlobStore` (`assets/blob-store.ts:5-8`) on a Google Cloud Storage bucket, chosen when `PAVE_BLOB_BUCKET` is set.
- `http/node.ts`: the render-node API (`/api/node/*`), behind a token middleware separate from session auth.
- `http/health.ts`: `GET /health` (none exists today), returning database reachability and the migration version.
- `config.ts`: adds `PAVE_ROLE` (`all | api | worker`; default `all`), `PAVE_BLOB_BUCKET`, and `PAVE_LOCAL_BLENDER` (`auto | off`; off when hosted).

**Render worker** (`workers/render/pave_worker/`)
- `render.py`: a chunked still mode (`sample_offset` and `use_sample_subset`, one multilayer EXR per chunk), a resume list of finished chunks and frames, `list_devices()`, and `merge.py` (`merge_images`, then denoise, then today's composite).
- One Blender process renders a job's chunks one after another. A new process is started only after a crash.

**Node** (`apps/node`, new and small)
- A Node CLI with `pair`, `run` and `status`. It reuses `@pave/render/node` (discovery, spawning, progress lines) and the take logic moved from `apps/server/src/engines/render/take.ts` into `@pave/render/node/take.ts`.
- It has no database. Its state is a folder (`PAVE_NODE_DIR`, default `~/.pave-node`) holding the token (file mode 0600), the device settings, and the checkpoint folders of its jobs.

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
- `JobStatus` (`entities.ts:515`) adds `interrupted`. It is live for the UI, but not claimable until Resume. `service-context.ts:15`'s `LIVE` stays `queued | running`.
- Run status (`entities.ts:788-800`) adds `interrupted` too.
- `RenderJob` adds `chunks: { done: number; total: number } | null`, `attempt`, `devices: string[]` (more than one when a resume moved devices), `fellBack: string | null` (the reason), and `node: { id, name } | null`.
- `Run` adds `resumes: number` and `redoneSteps: number`.
- New `RenderNode`: `{ id, name, status: 'online' | 'offline' | 'revoked', devices: Device[], runnerVersion, lastSeenAt, createdBy }`.
- New `Device`: `{ id, backend: 'OPTIX' | 'CUDA' | 'HIP' | 'ONEAPI' | 'METAL' | 'CPU', name, memoryMb? }`.
- `Capabilities` adds `renderNodes: boolean` (accounts mode) and `localBlender: boolean`.

**`commands.ts`**
- `jobs.resume { kind, id }`: owner or editor. It moves an `interrupted` job to `queued` and makes its `work` row `ready`, with one more allowed attempt.
- `runs.resume`: today it replans an AI job (`service.ts:333-360`). It also accepts an `interrupted` run, which goes on in place.
- `renders.engine` returns `devices` and `preference`.
- `renders.configureEngine` adds `device: 'auto' | <device id> | 'CPU'` and `cpuFallback: boolean` (local mode only, as today).
- `nodes.list`, `nodes.pair` (returns `{ code, expiresAt }`), `nodes.rename` and `nodes.revoke`: owner only, accounts mode only.
- Tool metadata: each assistant tool def gains `replay: 'safe' | 'keyed' | 'unsafe'` (see 4.4). The tool-list snapshot test then pins every tool's value.
- Job-creating commands (`renders.create`, `production.create`, `shots.create`, `mesh3d.create`) accept an optional `originKey` (at most 128 characters), unique per org on their row. A repeat with the same key returns the existing job.

**Node HTTP API** (`/api/node/*`, bearer node token, JSON)
- `POST /claim {caps, runnerVersion}`: long-polls up to 25 s. It returns `{ workId, attempt, leaseUntil, job, input: { url, sha256 }, checkpoints: [{key, sha256?}] }` or 204.
- `POST /work/:id/heartbeat {attempt, progress, chunks}`: extends the lease to now + 60 s. It returns `{ cancel: boolean }`.
- `PUT /work/:id/files/:key?attempt=n`: streamed bytes with `x-sha256`. It is stored as a blob and recorded as a checkpoint or a result.
- `POST /work/:id/complete {attempt, results, seconds, device, critique}`, and `POST /work/:id/fail {attempt, error, retryable}`.
- The server answers `409 stale-attempt` to any write from an attempt that no longer owns the lease.

**Database** (`0012_durable_work.sql`)
- `work`, `work_checkpoint`, `render_node` (with `token_sha256` unique, `org_id`, `name`, `devices`, `runner_version`, `last_seen_at`, `revoked_at`) and `node_pairing` (`code_sha256`, `expires_at`, `used_at`).
- `origin_key` columns with partial unique indexes.
- `agent_run.resumes`.
- A backfill creates a `ready` work row for every live domain row, so the first boot after the migration resumes exactly what `recover()` would have.

## 4. Hard parts and decisions

### 4.1 One durable work model with leases, heartbeats and attempts

**Decision: one `work` table for every kind, beside the domain rows.**
- The claim is a single SKIP LOCKED query, and there is one reaper, one heartbeat path and one node protocol.
- A lease lasts 60 s and is renewed every 15 s.
- `attempt` goes up on every claim. Every write a worker makes carries `(workId, attempt)` as a fencing token, and the sticky domain update gains `AND work.attempt = :attempt` in the same transaction.
- A lease that expires makes the row `ready` again, after a backoff (`not_before`: 10 s, then 60 s, then 5 min).
- `max_attempts` is 3 for renders and packages and 5 for runs. Once exhausted, the domain row becomes `interrupted` ("Stopped after 3 tries: Blender kept crashing on this scene"), not `failed`. Resume grants one more attempt.
- A clean shutdown (`main.ts:36-57`, 25 s budget at `main.ts:12`) calls `release(…, { counted: false })`, so a deploy or `Ctrl-C` never uses up an attempt.

**PGlite.** It is real Postgres in a single connection, so `FOR UPDATE SKIP LOCKED` parses and runs with no contention [E]. Local mode keeps one process (`PAVE_ROLE=all`). Leases still matter there: they replace boot-only recovery, they make "resume after a crash" the same code as "resume after a lease expired", and they are what makes hosting safe later.

**Why leases are needed before hosting.** During a zero-downtime deploy, the old instance still drives runs while the new one boots and calls `recover()`. Today that drives each run twice. With leases, the new instance sees a live lease and waits.

**Plan claims.** These are allowances (`plans.ts:13`, `53-69`, `273`). Recovery's orphan-claim release must treat a claim whose work row is leased, or `ready` within its attempts, as held, not orphaned. A render claim is per take (`render:<takeId>`), not per attempt, so attempts never take two allowances.

**Rejected:**
- *Lease columns on each of the five domain tables.* Five claim queries and five reapers, and nodes would need a kind-specific protocol.
- *Temporal,* as Diaex uses for sourcing (`diaex:deploy/temporal-dev/render.yaml`). A second always-on service with a disk (`diaex:docs/RENDER-DEV.md:481-490`: no zero-downtime deploys), no auth in dev (`RENDER-DEV.md:477-480`), and a new dependency for what one table does here.
- *Render Workflows* [S]: public beta, no GPUs, no pause primitive, and a vendor SDK in the job core. It could host CPU jobs later behind the same `work` rows.
- *Postgres LISTEN/NOTIFY for claims.* PGlite cannot notify across processes, and polling every 2 s plus the node's long poll is enough.

### 4.2 Checkpoints, and where they live

**Decision: a checkpoint is a row in `work_checkpoint` with an input hash.**
- **Small checkpoints, and checkpoints shaped like results, go to the blob store** (content-addressed, idempotent puts, write-then-rename: `assets/blob-store.ts:4-42`): the draft pass and its critique, animation frames (PNG, a few MB each), production package files, and the render input GLB. In hosting, the blob store is the bucket, so any process can resume from them.
- **Large EXR sample chunks stay on the disk of the machine that rendered them**, under the job's kept work folder (`render-work/<jobId>/chunks/`). Only a row is recorded, with `blob_sha` null and a sha256 of the file. A resume on the same machine (local mode, or the same node reclaiming its job) uses them. Another machine starts the still from sample 0, which is honest and rare. A multilayer EXR with denoising passes at 2048² is on the order of 100 MB [E], so uploading every chunk from a home connection is a poor trade.
- **Pruning:** a job's checkpoints are dropped when it settles as `done` or `canceled`. They are kept for 7 days when `interrupted` or `failed`, so Resume or Retry can use them. Prune at boot and hourly, and only for settled rows.

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
- A known gap, stated plainly in the UI: a model call that was streaming when the process died was paid at Anthropic, but its usage never arrived. The resume makes the call again (`${runId}:${idx}:llm` is still free), so the ledger records one call while two were paid. Prompt caching makes the repeat mostly cache reads [E]. The run's `redoneSteps` makes this visible. *Rejected:* a pre-call usage reservation, which guesses tokens and misprices.

### 4.4 Assistant runs resume from the last completed step

The loop already stores every model turn and tool batch before it returns (`assistant/loop.ts:1-14`). It already re-runs a step row that was begun but never answered: "Approved (or cut off mid-run by a cancel that never landed): run it now" (`loop.ts:689-697`). So the change is a policy, plus a rule for tool calls that were half done.

- **Boot or lease takeover:** a `running` run is driven again by `step(host)` from its stored position, instead of `closeOut(failed: interrupted)` (`service.ts:431-443`). `awaiting-approval` and `waiting` keep today's handling (`service.ts:432-436`). A clean shutdown leaves the run `running` with its lease released.
- **A model call in flight:** nothing was stored, so the call is made again (see the gap in 4.3).
- **A tool call in flight:** what happens depends on the tool's `replay` class, and a tool with no class counts as `unsafe`.
  - `safe` (queries, `viewport.capture`, `match.fit`, which only proposes ops and never changes the piece: `handlers/match.ts:1-7`): run again.
  - `keyed` (`design.apply` through its change id; job creators through `originKey`; exports through `export:<runId>:<toolCallId>`): run again, and the key makes the side effect happen once.
  - `unsafe` (anything else that writes without a key): do not run again. Answer the call with an error result: "Outcome unknown: Pavé stopped while this ran. Check the piece before repeating it." Mark the step `failed` with `errorCode: 'unknown-outcome'`. The model decides what to do next, as with any tool error.
- **Crash loops:** a run whose resume crashes again with no new step stored counts an attempt. After 5 it becomes `interrupted`, and Resume gives one more.
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
- `OPEN_EXR_MULTILAYER` output;
- `time_limit`;
- disk-cached tiles, which cannot be resumed from.

There is no "resume a cancelled render" in Cycles. So chunking is the checkpoint.

**Decision for stills.**
- A take pass renders `n` chunks of `samples / n`, using `sample_offset = k·(samples/n)` with the fixed seed (`render.py:80-83`). Denoising is off in each chunk, and the chunk stores its denoising data passes in one multilayer EXR.
- Each chunk is written to a temporary name and then renamed, then recorded.
- At the end, the chunks are folded pairwise with `merge_images`, denoised once with `denoise_animation` on the merged single-frame EXR [verify that it accepts one frame; otherwise use a compositor Denoise node], and handed to today's composite and metrics (`render.py:146-168`).
- `n` is 1 for preview (15 min cap, not worth it), 4 for standard and 8 for final (`queue.ts:44-51`).
- One Blender process renders all of a job's chunks, with `use_persistent_data` so scene sync and BVH build are paid once [E].
- The draft pass (`engines/render/take.ts:1-6`) is not chunked. Its result and critique become checkpoint `draft`, so a resume skips straight to the take.

**Adaptive sampling** is on today (`render.py:65-66`). Whether each sample subset adapts the same way as a full render is not documented.
- *Gate (step 3):* `packages/render/scripts/repeat-check.ts`, extended, renders one fixture as one pass and as 4 merged chunks, both on CPU. They must agree within the metrics tolerance (`pave_worker/metrics.py`) and within a PSNR floor set from two plain repeats.
- If they do not agree, chunked passes turn adaptive sampling off and keep the same sample count. That is slower but correct, and it is stated on the tile as "Resumable render: about 20% slower" [E, measured in the gate].

**Animations.** Frames are already rendered one at a time (`render.py:171-191`). The frame folder becomes the checkpoint folder: each composited `frame_NNNN.png` is recorded, uploaded in hosting, and skipped on resume. The video is encoded once at the end (`render.py:196+`). Temporal denoising over frames is a scope cut.

**A resume on a different device** keeps the existing chunks. They are independent sample ranges, so the merge is still statistically valid [E]. The take records both devices, and byte-reproducibility is claimed only for a take rendered on one device.

**Rejected:** `time_limit` slices (no sample bookkeeping, so they cannot be merged exactly), border or region tiles (seams under glare and depth of field, and a jewelry hero shot is all highlights), and leaving stills unchunked (a 3-hour final would lose everything to a crash).

### 4.6 Photo fits and production packages

- **Production packages** are rebuilt byte-identically today: the piece version is checked (`engines/production.ts:66`) and the package is dated with the row's creation time (`production.ts:87`). One kernel task does the whole build (`production.ts:71-96`, up to 900 s at `engines/kernel/pool.ts:53-61`).
  - Decision: split the kernel `package` task's output into its files. Store each finished file (STEP, 3dm, STL, drawings PDF) as a blob checkpoint keyed by `file:<path>` with `input_hash = (pieceId, sourceVersion, request hash)`. A resumed build skips what it has and zips at the end.
  - The STEP and 3dm exports are the slow part [E]. The same blobs also make a re-export of an unchanged version instant.
  - [verify] Measure a real package first. If it builds in under 60 s, this step drops to the scope cuts.
- **Photo fits** take at most two minutes, use a seeded rng (`packages/match/src/rng.ts`), and return ops without changing the piece (`handlers/match.ts:1-7`).
  - Decision: when hosted, a fit runs as `work` of kind `fit` with its stored result, so a restart reruns it deterministically and the caller (a studio or an assistant step) still gets an answer.
  - No mid-fit checkpoint: losing at most two minutes does not justify threading optimizer state through `loop.ts`.
  - Locally it stays a synchronous request (`pool.ts:53-61`), with `replay: 'safe'` for the assistant.
- **Mesh (image to 3D) and on-model shots** can already resume by provider job id (`recovery.ts:183-211`). Neither service is registered in compose on this branch (`compose.ts:24-29`), so they fail. Register them when their providers land (`docs/plans/render-and-models.md` step 6), and add their kill tests then. Until then they become `interrupted`, not `failed`.

### 4.7 GPU device detection and fallback

- Today `select_device()` tries OPTIX, CUDA, HIP, ONEAPI, METAL, then CPU, overridden by `PAVE_CYCLES_DEVICE` (`render.py:26-53`).
- The probe adds `list_devices()`: for each backend this build compiles in (Linux bpy has no METAL; macOS has METAL; probed), it calls `refresh_devices()` and lists name, type and memory. The result is saved with the engine probe in `engine.json` (`engines/render/blender.ts:1-6`).
- **Preference:**
  - `auto` picks the backend with the most GPU memory, OPTIX over CUDA on the same card.
  - A named device pins it.
  - `CPU` forces CPU.
  - `PAVE_CYCLES_DEVICE` still wins, for headless setups.
- **Fallback:** if a GPU pass fails with an error Blender reports as out of memory, or as a device or kernel failure (matched from its log lines), and `cpuFallback` is on, the same attempt re-runs that chunk on CPU. The take records `fellBack`. Other errors fail the attempt as today.
- **Detecting failure honestly:** a GPU that disappears mid-job (a driver reset) shows up as a Blender crash. The lease then expires, and the next attempt probes devices again.
- `PAVE_RENDER_THREADS` (`render.py:84-88`) still limits CPU threads, so the studio stays usable during a CPU fallback.
- *Rejected:* rendering on several GPUs in one Blender process by default. Cycles supports it, but the gain on one-card machines is zero and it complicates out-of-memory fallback. Leave it as an opt-in device choice.

### 4.8 Deploying on Render, like Diaex, and what runs where

Diaex runs in Ohio, with Development and Production environments, a Docker web service with a `/health` check, private Postgres, environment groups made by hand, GCS buckets for files, and a Pro workspace in Production (`diaex:render.yaml:20-56`; `diaex:docs/PRODUCTION.md:17-30`, `203-208`). Pavé copies that shape:

| Where | What |
|---|---|
| Render web service `pave-web` (Docker, Ohio, no disk) | API, studio static files, kernel worker threads (evaluate, export, photo fit, packages), assistant driver, work runner with `PAVE_ROLE=all` and `PAVE_LOCAL_BLENDER=off` |
| Render Postgres `pave-db` (private only, point-in-time recovery in Production) | Everything relational, including `work` and its leases |
| GCS bucket, one per environment (as Diaex: `diaex:docs/RENDER-DEV.md:21-23`) | Blobs: assets, render inputs, frames, package files |
| Environment group `pave-dev` / `pave-prod`, made by hand | `DATABASE_URL`, `BETTER_AUTH_SECRET`, `PAVE_PUBLIC_URL`, `PAVE_BLOB_BUCKET`, the service-account secret file |
| Founder's GPU machine | `apps/node`: Blender renders only |
| Never on Render | Blender, Python, GPUs ([S]: no Render GPU offering), PGlite |

- **No disk on `pave-web`.** A disk turns off zero-downtime deploys and pins the service to one instance (`diaex:docs/RENDER-DEV.md:481-490`; [S]). Scratch goes to `os.tmpdir()`. Everything durable is in Postgres or the bucket.
- **Shutdown:** Render sends SIGKILL 30 s after SIGTERM by default, and `maxShutdownDelaySeconds` extends that (`diaex:docs/RENDER-DEV.md:201-208`; [S]). Pavé's 25 s budget (`main.ts:12`) fits. On SIGTERM it stops claiming, releases leases uncounted, aborts drivers with `shutdown`, and exits.
- **Migrations** run at boot today (`db/client.ts:36`). Under zero-downtime deploys, old code runs against the new schema for a while, so every migration from `0012` on must be additive (expand, then contract in a later release) [E]. Move migration to `preDeployCommand: node dist/migrate.js` as Diaex does (`diaex:render.yaml:34-56`), so a failed migration stops the deploy rather than a boot.
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
  - [verify] that the stored key is encrypted at rest with a server secret before the first hosted deploy, and add that if not.
- **Costs** are read from Render's pricing page at deploy time [S]. Diaex Production on a Pro workspace is about $98 a month (`diaex:docs/PRODUCTION.md:203-208`). Pavé adds one web service, one Postgres and one bucket.

### 4.9 Render nodes

**Pairing.**
- An owner creates a pairing code: 8 characters, single use, valid for 10 minutes, stored as a sha256 hash (`node_pairing`).
- `pnpm node pair <url> <code>` exchanges it for a node token: `pvn_` followed by 32 random bytes in base64url. The token is shown to the node once and stored at `~/.pave-node/token` with mode 0600. The server stores only its sha256 (`render_node.token_sha256`).
- *Rejected:* reusing a user session or an API key (too broad, and a stolen laptop session would let someone render as that person), and mTLS (painful for a designer to set up).

**Scope.** A node token can:
- call `/api/node/*`;
- claim only `work` of `kind = 'render'` in its own org whose `requires` its devices meet;
- read and write only the files of work it currently leases, at that attempt.

It cannot read pieces, threads or keys, and it cannot create assets directly. Results become assets on the server, after checks.

**Connection.**
- Outbound HTTPS only, with no inbound port on the founder's machine.
- The node long-polls `claim` with a 25 s wait (well under Render's request limits [S]) and heartbeats every 15 s with progress. A `{ cancel: true }` in the heartbeat answer kills Blender's process tree (as `cancel` does today).
- Downloads (the render input GLB) and uploads (frames, the final PNG or MP4, draft and critique) stream through the API first. That keeps one auth path and one place for checks. Signed bucket URLs come later, if bandwidth through `pave-web` costs too much.

**Disconnects.**
- If the network drops, the node keeps rendering and keeps its chunks.
- If it comes back within the lease (60 s), the heartbeat simply continues.
- If the lease expired meanwhile, the job became `ready`. With no other node it is still queued, so the same node claims it again as attempt `n+1`. Its local chunks match by `input_hash`, so it resumes where it was, and the uploads it had not finished are repeated, idempotent by key and sha.
- If another node took the job, the first node's writes get `409 stale-attempt`, and it discards its work.
- When the server restarts, the node retries with backoff (1, 2, 5, then 30 s) and never drops local checkpoints because of a server error.

**Versions.** The node sends `runnerVersion` (the render worker and `@pave/render` versions). The server refuses claims from a node whose runner differs from the version that produced the job's cache key (`domain.ts:336`), and shows the reason on the machine card: "Update Pavé on this machine". The cache key covers the runner version, so mixed versions would split the cache.

**Job data security.**
- A render input is the design's geometry, which is the jeweler's IP. It goes only to nodes the org paired, over TLS. The node deletes a job's folder once the job is settled, and `pnpm node status` shows what it holds.
- The server sends data (scene JSON and GLB), never code. The Blender runner is the node's own installed `workers/render` code, so a compromised server cannot run arbitrary Python on the node through this protocol.
- In the other direction, an upload is checked before it becomes an asset: its type is read from its magic bytes (PNG, MP4 or WebM), it has a size limit (`PAVE_MAX_UPLOAD_MB`, `config.ts:51`), and its dimensions must match the scene. A node cannot write anything else.
- Tokens are revocable, and revocation takes effect at the next request. The machine card shows last seen and IP. Node endpoints are rate-limited per token.

**What stays local-only:** nodes in local mode (a local server already runs Blender itself); pairing in `PAVE_AUTH=local`; Blender discovery and configuration on a hosted server.

## 5. Verification

- **Lease unit tests (Vitest, in-memory PGlite and real Postgres in CI):**
  - two claimers never get the same row;
  - an expired lease is reclaimed with `attempt + 1`;
  - a stale attempt's heartbeat, file, complete and sticky update are all refused;
  - an uncounted release keeps the attempt count;
  - exhaustion leads to `interrupted`, and `jobs.resume` grants one more attempt;
  - a held plan claim is never released as an orphan.
- **Kill tests (`apps/server/test/kill/`, a child-process server with a fake Blender runner from `queue.test.ts`, plus SIGKILL at named points through `PAVE_KILL_AT=<point>`).** For each kind, kill, restart and assert the end state, the ledger rows and the plan claims:
  - **Render:** kill during the draft, after chunk 1 of 4 is written, mid-chunk 3, between the last chunk and the merge, after the merge before `done`, and between the upload and the `done` row. Assert that each kept chunk is not re-rendered (by counting runner chunk invocations), that `usage_event` has exactly one row per chunk, that one plan claim is `used`, and that a single take asset exists.
  - **Animation:** kill after frame 7 of 24. Frames 0–7 are not rendered again, and one video exists.
  - **Production:** kill after the STEP file and before the zip. The STEP is not rebuilt, and the zip is byte-identical to an uninterrupted build.
  - **Assistant (`scriptedModel`):** kill during a model call, after the model turn is stored but before the tools, during `design.apply` after the commit but before `completeStep`, during `renders.create` after the row but before the step result, and during an `unsafe` tool. Assert, in order: one stored turn; tools run once; one design change (replayed); one take (by `originKey`); the `unknown-outcome` result; `redoneSteps`.
  - **SIGTERM inside the 25 s budget:** no attempt is counted, the run is left `running`, and the next boot goes on from there.
  - **Crash loop:** a runner that always crashes ends `interrupted` after 3 attempts, with backoff between attempts.
- **Real Blender here (CPU, gated on the venv):** the chunk equivalence gate from 4.5, plus a real SIGKILL of the Blender process mid-chunk that resumes and finishes.
- **Node tests (`apps/node`, with a test server):**
  - pair (an expired code, a reused code);
  - claim scope (another org's job, a mesh job);
  - **network cut tests** through a TCP proxy the test can cut: 10 s mid-chunk (the lease is held, no new attempt), 90 s (the lease expires, the same node reclaims and resumes from its local chunks), a cut during an upload (the repeat is idempotent), and a cut on the reply to the final `complete` (the retry gets the same result, with no duplicate asset);
  - two nodes after a cut (the first gets `409`, one result);
  - revoke mid-job (the next heartbeat is refused and the work returns to the queue);
  - a runner version mismatch.
- **GPU (the founder's machine, manual, recorded in the PR):** the device list, Auto, a pinned device, CPU only, and a forced out-of-memory (a huge resolution) falling back to CPU with `fellBack` recorded.
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
1. **Durable work core.** `work` and `work_checkpoint`, the migration and backfill, `work/lease.ts`, `work/runner.ts` replacing one-shot `recover()`, fencing in the sticky updates, the `interrupted` status, `jobs.resume`, plan-claim orphan rules, and uncounted release on shutdown. Proof: the lease unit tests, the existing recovery, queue and production suites unchanged, and kill tests on today's behaviour.
2. **Assistant runs resume.** Replay classes on every tool def (snapshot), `originKey` on job creators, resume instead of fail, shutdown keeps runs `running`, stream `reset`, `redoneSteps`, and the dock line. Proof: the assistant kill tests.
3. **Render checkpoints.** The input GLB as a blob, kept work folders, the draft checkpoint, chunked stills, merge and denoise, kept frames, per-chunk metering, and tile progress. Gate: chunk equivalence on real CPU Blender (or adaptive sampling off for chunked passes). Proof: the render kill tests and a real SIGKILL of Blender.
4. **Production checkpoints**, gated on measuring a real package (drop the step if it builds in under 60 s). Proof: the byte-identical zip after a kill.
5. **Local GPU.** `list_devices()`, the engine dialog's device choice, `configureEngine` device and fallback, `fellBack`, device-aware chunk resume. Proof: unit tests with injected probe output, then the manual GPU run on the founder's machine.
6. **Ready to host.** `GET /health`, GCS `BlobStore` (new dependency `@google-cloud/storage`, needs the founder's OK), `PAVE_ROLE` and `PAVE_LOCAL_BLENDER`, migrations as a separate command, the Dockerfile, and `docs/HOSTING.md`. Proof: the server suite against Postgres with a fake bucket, and the Docker image booting locally against Postgres.
7. **Render dev environment.** Created by hand like Diaex: `pave-web`, `pave-db`, the bucket, the `pave-dev` group, an address of the founder's choosing. Encryption of stored keys at rest is verified first. Proof: the deploy-while-live test and `/health`. Production waits (see the scope cuts).
8. **Render nodes.** `render_node`, pairing, the node API with token scope and checks, `apps/node` (`pair`, `run`, `status`) with take logic moved into `@pave/render/node`, Settings → Render machines, "Waiting for a render machine", and the runner version check. Proof: the node tests including network cuts, then the founder's GPU machine against the dev environment.
9. **Later, when measured:** `pave-worker` for CPU work, `fit` as work when hosted, and registering mesh3d and on-model with their kill tests (with `docs/plans/render-and-models.md` step 6).
