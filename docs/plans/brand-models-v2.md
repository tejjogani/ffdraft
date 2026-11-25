# Brand models and on-model imagery, version 2

_25 November 2026._ Build brief for reusable AI brand models and on-model pictures that keep the piece true to its CAD. It rests on [research 16](../research/16-ai-models-on-model.md), which corrects Part B of [research 04](../research/04-ideation-models.md). The spine: **render the CAD on a simple proxy at the model card's size, let an image model paint the brand model around it, paste the true render back, and let checks in code decide what the picture may be called.**

**What it replaces in [`render-and-models.md`](./render-and-models.md):** the "Models" and "On model tab" paragraphs of §1; the `services/on-model.ts`, `providers/image/…` and `features/models` lines of §2; the last sentence of §4.5 and the C2PA sentence of §4.6; the §6 cuts for composite shots, proxies, pixel lock, extra portrait views, on-model video, four-candidate face picking and ad-label presets; and build steps 6 and 7. **What it keeps:** the whole render studio (§1 items 1–7, the render parts of §2, §4.1–4.4, steps 1–5), the `BrandModel` and `ModelShot` contracts of §3 (extended, not broken), fail-closed export, text-only identity, and the concept path, now the route for pieces that drape. It adds duties to [`publishing.md`](./publishing.md) without editing it (§4.9).

Labels: `[V]` opened at source (by the research; "re-checked" means I opened it again on 25 Nov), `[S]` search extract, `[E]` estimate. Paths are on the assistant build (`claude/assistant-build`). Nothing here is legal advice.

## 1. Experience

**Models.** A quiet grid of cards: a portrait, the name, "Approved · v3" and the sizes that matter ("Ring 6 · Wrist 150 mm · Neck 340 mm"). **New model** is one page in four parts.

1. **Card.** Name; age range (adults only); skin tone as ten Monk swatches; hair; eyes; marks; build; nails; wardrobe from a short fixed list. Then **Measurements**, headed "So jewelry sits at true size": ring size, wrist, neck, hand length, lobe thickness, pre-filled as "typical". One tick: "This is an invented person. I am not describing a real person."
2. **Face.** "Generate four faces · about $0.54". Keep one or try again. A candidate that fails a safety check is never shown: its tile reads "Stopped by a safety check".
3. **Model sheet.** The other canonical views are made from the kept face (cost shown first, about $1.50): face three-quarter and profile; each hand, back and palm; a relaxed ring pose; each ear with hair tucked; neck and collarbone; full body, clothed. Each view has Keep and Redo.
4. **Approve.** Two ticks: "I don't recognise this face as a real person" and "I searched the web for this face and found no match" (Pavé opens the face in a new tab and sends it nowhere). Approving freezes the card and sheet, records who and when, and bumps the version.

Editing an approved model sets it back to draft; after re-approval, older images show "Model changed · Redo".

**On model, in the Render stage.** The shot list has two sections, **Shots** and **On model**; the old "On model" piece tab redirects there.

- **Composer** (glass inspector): Model; Shot, from a short list for this kind of piece (a ring: "Hand, from above", "Hand, three-quarter", "Close on the finger"); Used for (Product page, Social, Ads, Lookbook); how many. One line says what the piece gets: "A true render of your CAD, on Ana's hand" or, for anything that drapes, "AI concept: chains can't be shown CAD-true yet".
- The estimate comes before any spend ("3 images · about $1.00 · uses 1 render"). The tile then walks plain stages: "Setting the scene → Painting Ana → Locking your render → Checking (2 of 3)".
- A finished tile always carries its label chip: **AI model · Rendered piece** (passed the gate) or **AI · Concept**. A **Fidelity** popover lists each check in words ("Render locked · 99.6% match", "Hand in place", "Centre stone and both side stones visible"), then the cost and the export label.
- Actions: **Accept** (it joins the takes and seeds Publish), **Redo** (with a note), **Take over** (the mannequin scene opens in the Viewfinder; move the pose or camera, run again), **Export**.
- A failed image is dimmed: "Didn't pass: the hand moved off the ring", with Retry and no Export. A blocked one reads "Stopped by a safety check · nothing was saved", with no Retry.
- No image key: cards stay editable, the mannequin shot still works, and one calm line names the missing key.

**As an AI job** ("On-model shots with AI", in the Render stage). The assistant looks at the piece, then asks three quick questions in one card, each with a default so one Go is a full answer: **Which model?** (approved cards, last used first), **Which shots?** (from the list for this piece), **What are the images for?** It shows the plan and the estimate, then acts. Each image arrives with its fidelity result and its label. The person can watch, pause or take over, then accept or redo each image. With no approved model the assistant offers to open Models: making and approving a model is always a person's act.

**Motion**, on an accepted still: "Sparkle pass · 4 s · true piece" (our render) and "Gentle move · 5 s · AI concept · about $0.50 a try".

## 2. Structure

**Where the image providers live (settled).** One family, in **`packages/ideation`**: the place step 18 of the assistant build and the header of `apps/server/src/services.ts` both name. `apps/server/src/providers/image/` from `render-and-models.md` §2 is dropped. Neither folder exists today. Step 18 builds the family (Gemini, OpenAI, Higgsfield if it offers images, a fake), the image keys in Settings › AI and the Claude guardrail calls. This plan extends that family and writes no second client; if step 18 landed it elsewhere, extend it there.

**`packages/ideation`** (extended)
- `image.ts`: `ImageProvider` gains `edit()`, model descriptors and a `data` policy (§3). `video.ts`: `VideoProvider`.
- Adapters: `gemini` (images; Omni video), `openai` (Sunburst edits), `higgsfield` (video), `bfl-fill` (optional, decision 3), `fake`. `fetch` injected; recorded fixtures.

**`packages/render`** (extended; needs no AI)
- `src/proxy/`: `finger.ts`, `wrist.ts`, `lobe.ts` build proxies from primitives (tapered cylinders, an elliptical wrist, a lobe pad); `poses.ts` holds two or three poses per placement; `placeOnProxy(subject, card, pose)` seats the piece and `onModelCamera()` frames it.
- `types.ts`: `ResolvedScene.props` and `output.passes`; `three/stage.ts` draws props. The Blender worker (`workers/render/pave_worker/{scene,render}.py`; GPL, a separate program as today) builds props and writes the passes. It already renders a transparent beauty and a piece-only mask.

**`packages/onmodel`** (new; pure TypeScript on raw RGBA buffers; no DOM, no sharp)
- `eligibility.ts`, `vocabulary.ts` (shots per kind, the three questions), `prompt.ts` (request builders), `register.ts`, `lock.ts`.
- `gate/{pixel,overlap,stones,gap,checklist}.ts`; `safety/{vocabulary,screen}.ts`; `labels.ts`; `cost.ts`; `config.ts` (thresholds, limits, prices, data rules: data, never constants in handlers); `testing/`.

**`apps/server/src/onmodel/`** (new; implements the `OnModelService` already in `services.ts`)
- `service.ts` (stage machine, attempts, resume), `scene.ts` (queues the scene render with `sctx.invoke('renders.create', { purpose: 'onmodel-scene' })` and reuses it by cache key), `judge.ts` (the vision checklist, on step 18's guardrail client, metered to `llm`), `moderation.ts`, `video.ts`.
- `apps/server/src/imaging/disclosure.ts`: visible label from outlined SVG paths, XMP, optional C2PA. Built once, shared with publishing.
- Registered in `compose.ts` only when an image provider and the vision judge both exist (`capabilities.onModel`).

**`apps/studio/src/features`**: `models/` (`ModelCardForm`, `FacePicker`, `ModelSheet`, `ApproveDialog`) replaces the 46-line placeholder. `render/onmodel/` (`OnModelSection`, `ShotComposer`, `ShotTile`, `FidelityPopover`, `ExportSheet`) mounts in `RenderStudio.tsx`.

**The composite pipeline** (`fidelity: 'composite'`)

| Stage | What happens | Runs |
|---|---|---|
| `scene` | Seat the CAD on the proxy. One render job, one camera, six passes: **beauty** (piece only, proxy as holdout), **mask** (its alpha), **mannequin** (piece on the skin-toned proxy), **silhouette** (the proxy), **shadow** (contact shadow), **stone ids** (a flat colour per hero stone) | Blender; the browser engine gives the first four at "Preview quality" |
| `plate` | `edit()`: base = mannequin; references = the sheet views this placement needs (a hand shot sends hand views, never the face); instruction: replace the mannequin with this model in exactly this pose, keep the jewelry unchanged, light from the same side. Screened first | Provider API |
| `lock` | Register the plate to the scene (a small translation search around the piece). Paste **beauty** through **mask**, eroded and feathered. Multiply **shadow** where the plate painted none | Server, pure |
| `edge` (off until the spike says it helps) | One low-strength edit for skin bulge; only pixels inside a thin band round the piece are taken from it; then lock again | Provider, then server |
| `verify` | The gate (§4.4) and the safety checks (§4.8). A fidelity failure returns to `plate` with the finding as a correction, three attempts at most. A safety block ends the shot | Server, judge |
| `label` | Store the provider's original untouched, the final image, the findings, the provenance and the label the gate allows | Server |

`fidelity: 'concept'` keeps today's path (`references → generate → verify → label`) and can never earn the composite label.

**Local and hosted.** Locally: scene renders in Blender or the browser, pixel work in the server process (a 2K image is 4 million pixels; fine on a 2023 MacBook Air), provider calls from the server. Hosted later: the same code on the web service, with scene renders on render nodes or in the browser ([`deploy-and-durable-jobs.md`](./deploy-and-durable-jobs.md)). If its `work` table has landed, a shot is `kind: 'shot'` with a checkpoint per stage; otherwise `resumeShot` restarts at the last finished stage.

## 3. Contract changes

All additive unless marked. One drizzle migration, taking the next free number at build time (`0015` is the last today).

**`packages/schema/src/api/entities.ts`**
- `BrandModel`: `identity: 'synthetic' | 'real'` (default `synthetic`; `real` is refused while `capabilities.realLikeness` is false), `consentId: id | null`, `sheetAssetId: id | null`, `approval: { recognisedNoOne: true, reverseSearchDone: true } | null`.
- `BrandModel.card` adds `fingerSizesUs: { thumb?, index?, middle?, ring?, pinky? } | null` (`ringSizeUs` stays the ring finger), `lobeThicknessMm`, `nails: { length, shape, polish } | null`, `wardrobe: enum | null`. Old cards read as null, as `toBrandModel` already does for earlier additions.
- `BrandModel.portraits[]` adds `label` (`MODEL_VIEWS`: `face-front | face-three-quarter | face-profile | hand-{left,right}-{back,palm} | hand-relaxed | ear-left | ear-right | neck | body`) and `checks: { adult, safe } | null`. The coarse `view` stays. `recipe` adds `prompts`.
- `SHOT_STAGES` becomes `references, generate, scene, plate, lock, edge, verify, label`.
- `ModelShot` adds `shotKey`, `purpose: 'product' | 'social' | 'ads' | 'lookbook'`, `media: 'still' | 'clip'`, `parentShotId`, `retryOf`, `review: 'pending' | 'accepted' | 'rejected'`, `claim: 'concept' | 'composite'` (what the gate allows; `fidelity` stays the route asked for).
- `ModelShot.check` adds `gate: { version, calibrated }`; a finding adds `kind: 'pixel' | 'overlap' | 'stones' | 'gap' | 'judge' | 'safety' | 'drift'`, `value?`, `threshold?`.
- `ModelShot.provenance` adds `sceneRenderId`, `plateAssetId`, `providerMarks: { c2pa, synthId }`, `digitalSourceType`, `dataRule`, `costUsd`.
- `RenderJob.purpose` adds `'onmodel-scene'`; `RenderJob.passes: Record<string, id> | null`.
- `Capabilities` adds `video: string[]`, `realLikeness: boolean`. `METERS` adds `'video'`.
- `AiJob.recipe?: 'on-model'`: a second recipe inside the Render stage. `JOB_STAGES` stays three.

**`packages/render/src/types.ts`**: `ResolvedScene.props: { id, mesh, material, role: 'proxy' | 'occluder' }[]` and `output.passes`; `RESOLVED_SCENE_VERSION` goes to 3. **Breaking** between server and worker, which ship together; queued jobs are resolved again.

**Commands** (`commands.ts`)
- `models.generatePortraits`: `views` accepts `MODEL_VIEWS` (old values map to defaults); adds `candidates: 1 | 4` for the face. New `models.keepPortrait { id, label, assetId }`.
- `models.approve { id, recognisedNoOne: true, reverseSearchDone: true }`: person only, never a tool; `models.update { status: 'approved' }` is refused. **Breaking**, with no caller yet.
- `shots.suggest { pieceId }` → `{ composite: { ok, reason }, shots: [{ key, title, why, placement }], models, questions: QuickQuestion[] }`; query, tool.
- `shots.create` adds `shotKey`, `purpose`, `fidelity: 'auto' | 'concept'` (auto means composite when the piece is eligible). `shots.estimate` returns image, judge and render counts.
- `shots.review { id, decision, note? }`; `shots.retry { id, note? }`; `shots.animate { id, kind: 'sparkle' | 'gentle-move', seconds }` (always confirmed, never auto-approved in a job).
- `shots.export` adds `preset`, `visibleLabel` (default true) and `reason` (required when false). **Behaviour change:** today `label: false` returns the untouched original; now every export is a copy with XMP.
- `org.settings` adds `onModel: { imageProvider, fallbackProvider, videoProvider, dataRules: Record<provider, 'all' | 'public-only' | 'never'>, maxAttempts, maxUsdPerJob, labelPreset }` (admin).

**`ImageProvider`** (in `packages/ideation`; `generate` is step 18's)
```ts
edit(req: { model; base: Img; refs: { img: Img; role: 'identity'|'skin'|'product'|'pose' }[];
            mask?: Img; instruction: string; size: { w; h }; seed? }): Promise<ImageResult>
models: { id; tier: 'explore'|'hero'; maxRefs: { object; character };
          mask: 'none'|'guidance'|'exact'; priceUsd(size): number }[]
data: { trainsOnInputs: 'no'|'unless-enterprise'|'unknown'; evidence: string; checkedAt: string }
// ImageResult: { images; model; seed?; costUsd; marks: { c2pa: boolean|null; synthId: boolean|null } }
```
`ProviderBlocked { at: 'prompt' | 'output' }` is never retried; `ProviderUnavailable` and `ProviderRateLimited` back off, then go to the fallback provider. `VideoProvider` has `start`, `poll`, `cancel` and the same `data`.

**Tables**
- `brand_model` and `model_shot`: one column per new top-level field above, plus `model_shot.reviewed_by`.
- `safety_event { id, org_id, user_id, run_id, subject, subject_id, gate, category, provider, input_hash, at }`: no pixels, no prompt text.
- `asset_provenance { asset_id, shot_id, digital_source_type, preset, visible_label, reason, c2pa, original_sha256, exported_by, at }`.
- `likeness_consent` (defined now; nothing writes it in v2): the signed document's asset and hash; the uses described (media, territories, term, with AI generation and editing named); pay; approval and withdrawal rights; proof of age 18 or over; hashes of the reference photos; who verified identity; whether the person had a lawyer or union representative; `expires_at`, `withdrawn_at`. [V: the research's reading of a law-firm note]

**Config.** `packages/onmodel/src/config.ts` exports `GATE` (every threshold with `basis: 'estimate' | 'measured'`), `LIMITS`, `PRICES` (with `checkedAt`), `PROVIDER_DATA` and `LABEL_PRESETS`; a local install may override with `<dataDir>/on-model.json`. Keys follow step 18's store and rules (server only, sealed per organisation, last four shown, `.env` wins): `GEMINI_API_KEY`, `OPENAI_API_KEY`, and `HIGGSFIELD_API_KEY` with `HIGGSFIELD_API_SECRET` for the older platform API's two headers [V].

## 4. Hard parts and decisions

**4.1 Only a render can be called product-accurate.** No image model keeps a jewelry design true: published editors score 0.70 to 0.81 on product similarity [V], an instruction editor 63 against 92 for reference inpainting [V], and a jewelry-photo vendor reports changed prong counts and settings [V, vendor]. *Decision:* render-first with pixel lock; no jewelry pixel painted by the image model survives. *Rejected:* generative-only shots exported as product images; generate-then-repair (it does not converge [E]); fit-to-photo (a 2-degree axis error or a 5% width error shows on a ring, and it needs a hand model).

**4.2 No licensed hand or body model.** The usual ones cannot ship in a paid product: MANO is non-commercial [V, re-checked]; WiLoR's weights are CC BY-NC-ND and need MANO [V]; Meshcapade's commercial hand model is €600 a year for a micro company or €10,000 for an SME, and SMPL €1,500 or €25,000 [V]; InsightFace models are non-commercial [S]. *Decision:* proxies are our own primitives. The finger under a ring takes the ring's inner diameter from `design.evaluate`, so the fit is exact; the rest of the hand scales from the card. If the card's ring size is more than two sizes from the piece's [E], the composer says so ("Shown at size 6; Ana wears 8"). The proxy takes the card's Monk tone, so polished metal reflects skin, not grey.

**4.3 What is in the first release.** `compositeEligibility(design)` is pure and tested.

| Piece | First release | Why |
|---|---|---|
| Ring, band, signet (`kind: 'ring'`) | Composite | Rigid; a finger is a cylinder at a known size |
| Stud (`earrings` with an `earringPost` finding, no `chain` node, under a height limit in config) | Composite | Rigid, small contact; hair is the risk, so the gate checks the piece is uncovered |
| Bangle or cuff (`bracelet` with no `chain` node) | Composite | Rigid; an elliptical wrist |
| Huggies, drop earrings | "AI · Concept" now | Rigid but gravity-posed; composite once rings pass their marks |
| Pendant on a chain, necklace, chain, flexible bracelet, brooch | "AI · Concept" | They drape or sit on cloth; a rigid paste looks wrong and there is no body mesh |

**4.4 The fidelity gate.** Fail closed, in this order.
1. **Pixel lock:** structural similarity between the final image and the beauty pass inside the eroded mask, at least 0.98. Lower means our pipeline broke.
2. **Silhouette overlap:** in a band round the piece, classify skin against background with a colour model fitted per image (skin sampled inside the proxy silhouette, background well outside it). Overlap with the proxy silhouette at least 0.85 IoU; finger width at the ring within ±4%.
3. **Stone count:** every hero stone the stone-id pass shows as visible is intact in the final image and not hidden by an occluder; the count must match exactly. Melee is never counted; the lock covers it.
4. **Gap and remnant:** no background between piece and skin, and no leftover of the model's own ring peeking round ours.
5. **Vision checklist** (the last check, not the first): closed questions, one finding each, given the CAD crop, the output crop and the facts from `design.evaluate`: intended finger or ear; plausible scale; five fingers; natural joints; a nail on each visible fingertip; no extra jewelry; nothing covering the piece. Concept shots add hero stone count, stone shape, setting type, metal colour and band profile. A "no" or "unsure" on a hard item fails.
6. **Drift:** the judge compares tone, marks and nails with the model sheet.

The numbers in 1 and 2 are the research's starting values [E]; the stone, remnant and registration settings and the colour segmenter are mine [E]. None is measured. *Decision:* thresholds are config with `basis: 'estimate'`. While the gate is uncalibrated a composite shot is still made and shown with its findings, but its `claim` stays `concept` and it exports as "AI · Concept". Step 9 sets `calibrated` only when the pass marks in §5 are met. *Rejected:* a hard threshold on embedding similarity (editors land at 0.70–0.81, so it would be noise [V]); a judge counting pavé (it cannot).

**4.5 Hands.** No measured failure rate exists for current models [V]; the research guesses a few percent of single-hand close-ups [E]. *Decision:* the spike measures it and the judge's anatomy questions are the first defence. A hand-landmark model (MediaPipe, Apache-2.0 [E]) is added only if the judge misses more than 5% of the hands people labelled bad.

**4.6 Providers** (list prices on 25 Nov 2026, kept in `PRICES`).

| Role | Provider and model | Price | Why |
|---|---|---|---|
| Sheet and plate (default) | Google `gemini-3-pro-image` | $0.134 per 1K/2K image [V, re-checked] | 5 character and 6 object references [V, re-checked]; no mask upload [V] |
| Exploration and edge pass | Google `gemini-nano-banana-2.1` | $0.0336 (1K), $0.0504 (2K) [V, re-checked] | Cheap |
| Fallback | OpenAI `gpt-image-2.6-sunburst` | Token-priced; Runway resells it at $0.02–0.19 an image [V] | Its mask is guidance and "may not follow its exact shape" [V, re-checked] |
| Motion | Google Omni Flash | about $0.10 a second at 720p [V, re-checked] | Gemini key |
| Motion, second | Higgsfield (DoP, Kling) | DoP $0.125–0.56 per 5 s; Kling 2.6 $0.07 a second [V] | Under its data rule only |

**What the founder's three keys reach.**
- **Gemini:** images and Omni Flash video. **Not Veo:** the Veo 3.1 previews were shut down on the Gemini API on 22 October 2026 [V, re-checked]; Veo 3.1 now needs a Google Cloud project (Agent Platform).
- **OpenAI:** images only. Sora 2 and the Videos API were shut down on 24 September 2026 with "no one-to-one replacement" [V, re-checked].
- **Higgsfield:** video and its own image models. Step 4 probes which of its two APIs the founder's key belongs to.
- **Changed since the research:** Google's Omni page now documents `gemini-omni-1.2-flash`; requests to `1.1` route to it from 3 December 2026 at its rates, which the pricing page does not yet list [V, re-checked]. Step 13 reads the id and price again. Clips run 3 to 15 seconds [V, re-checked].

**4.7 What is sent to whom.** A plate request carries an unreleased design.

| Provider | Trains on what you send | Default rule |
|---|---|---|
| Google, paid Gemini API | No [V, re-checked: terms of 23 Mar 2026]. The image models are paid-only [V, re-checked], so the free-tier clause never applies | `all` |
| OpenAI API | Not unless you opt in [V] | `all` |
| Higgsfield | May train on content; deleting it stops future use only; enterprise content is excluded [V, re-checked] | `public-only` |
| BFL | Not verified | `never` |

*Decision:* the server enforces the rule before any bytes leave. `public-only` sends an image only after a person confirms the design is already public; that is audited and an agent cannot give it. The judge and the moderation call are sends too (Anthropic through the person's own Claude key; OpenAI under its rule). Indemnity: none in the Gemini API terms; Google Cloud indemnifies through the Agent Platform [V]; OpenAI's excludes Output [V].

**4.8 Safety as gates in code.** Prompts ask; these gates decide.

| Rule | Gate |
|---|---|
| No nudity or sexualised output | Wardrobe is a fixed vocabulary; neck and body shots take no free-text clothing. Every output goes through OpenAI `omni-moderation-latest` when an OpenAI key exists (free; its image categories include `sexual` [V, re-checked]) and a judge question ("clothed as specified? any nudity or sexualised pose?"). Provider filters stay on (`moderation: 'auto'` [V]) |
| No minors | Adults-only age enum (in the schema today); a deny list on card and direction text ("teen", "girl", "boy", "child", "young"); every prompt states "an adult aged …"; an age-appearance question on **every** model view and **every** output, where "unsure" fails. OpenAI's `sexual/minors` category is text-only [V, re-checked], so it cannot do this |
| No real person's likeness without consent | Identity is text only: v2 has no face upload. `identity: 'real'` is refused unless a valid, unexpired, unwithdrawn `likeness_consent` exists and `capabilities.realLikeness` is on; it is off |
| No celebrity lookalikes | A name screen on the model name, card and direction: patterns ("looks like", "resembling") then step 18's Claude check; the two recorded ticks at approval. *Rejected:* a face-recognition gate: it needs a gallery of real faces, which both vendors' policies bar without consent [V] |

**On a block:** the stage stops; nothing is retried or reworded. The image is never stored; a `safety_event` row keeps the gate, category and hashes. The tile says so plainly, the assistant is told not to try another route, and admins see blocks in Settings › Usage. A provider's refusal is handled alike.

**4.9 Labelling.** Each duty maps to a behaviour. In the product, the chip is on every tile and cannot be hidden.

| Duty | Evidence | What Pavé does |
|---|---|---|
| Machine-readable mark | Google Merchant Center requires the IPTC source-type tag to be present and kept, and names `TrainedAlgorithmicMedia` and `CompositeSynthetic` [V, re-checked] | Every export writes XMP `DigitalSourceType`: `trainedAlgorithmicMedia` for a concept, `compositeSynthetic` for a composite (IPTC: a mix of elements, at least one generative [V, opened 25 Nov]). Renditions keep it, with a read-back test |
| Content credentials | A composite drops the provider's manifest. `c2pa-rs` is MIT or Apache-2.0; validators trust a manifest only with conformance and a trust-list certificate [V] | The provider's original is kept untouched with its hash. Every export is signed with a C2PA manifest (ingredients: the CAD render, the provider's output) when `capabilities.c2pa` is on. Tested with a development certificate; production waits on decision 5 |
| EU AI Act Article 50 | Applies from 2 Aug 2026 [V, re-checked at the Commission]. Providers mark outputs machine-readably, deployers label deepfakes visibly, and existing systems had until 2 Dec 2026 [V, law-firm note] | Metadata always. The visible label is on by default; an agent cannot turn it off; a person who does picks a reason, which is recorded. An EU-icon preset |
| New York GBL §396-b | An advertiser must "conspicuously disclose" a synthetic performer; $1,000, then $5,000 [V, re-checked]. In effect June 2026 [V, secondary; the statute page gives no date] | Purpose "Ads" selects the visible "AI-generated model" preset; the export sheet says why |
| Amazon | Sellers must tag images of photorealistic AI people (July 2026) [V, secondary] | Publishing's `MediaItem.syntheticPerson` is true for every shot; an Amazon kit lists the images to tag |
| Etsy | Each listing needs one unedited photo of the real item [V, secondary] | A shot enters publishing as `role: 'lifestyle'`, never `main`; `requires: ['realPhoto']` already blocks |
| Meta and TikTok ads, India | Labels shown or required [V] | Presets; metadata left intact |
| US federal | No label rule; deception rules apply [V] | A concept never exports as a product image |

**For counsel to read:** whether Pavé is a "provider" under Article 50 and whether an invented model in an ad is a "deepfake"; what counts as "conspicuous" in New York; whether Pavé is a "covered provider" under California's SB 1000 [V]; the consent form before any real-likeness feature; the missing indemnity on the Gemini API.

**4.10 Video.** Image-to-video loses product identity under viewpoint change; the best closed models score about 58–63 of 100 on product consistency [V]. *Decision:* a generated clip is always "AI · Concept": 3 to 5 seconds, a slow push-in with no rotation, the accepted still as first and last frame. Checks: first and last frames against the still inside the lock mask, the judge on a middle frame, safety on three frames. The true-piece option is ours: the sparkle pass renders the piece under a moving light (the existing `rigRotation` track) and locks each frame onto the still's plate. *Rejected:* a generated clip labelled composite; Veo or Sora (not on the founder's keys).

**4.11 Cost and caps.** Estimates on verified list prices [E on V]; every acceptance rate is a guess until the spike.
- A default composite attempt with the edge pass is about $0.22 (plate $0.134, edge $0.05, references $0.01, judge $0.03). At a guessed 65% acceptance that is **about $0.34 per accepted still; plan on $0.30 to $0.70**. Three attempts cost at most about $0.66.
- A model: four face candidates and eleven more views at $0.134 is **about $2.00**, once (the research's $1.60 assumed eight).
- A generated 5-second clip: $0.50 a try on Omni at 720p; **$1.50 to $3.00 per accepted clip** at a guessed 25–35% kept. The sparkle pass costs render time.
- **Shown:** each attempt writes usage events (`image`, `llm`, `video`) with the piece, the Render stage and the key `shot:<id>:<attempt>:<stage>`. The project's Renders section shows "On model · 6 images · $2.31". Model creation has no piece, so it shows as "Brand models" in Settings › Usage. (This uses step 17's stage attribution, plus a `feature` tag on `usage_event` if step 17 added none.)
- **Caps:** `shots.estimate` before any spend; three attempts a shot; twelve auto-approved shots and `maxUsdPerJob` (default $10) per AI job; clips confirmed one by one; `assertBudget` before every paid call.
- Scene renders are Blender renders and claim the render allowance, as reference renders do today. One scene serves every attempt, and every model of the same tone, through the cache key.

**Decisions that are the founder's**
1. **The spike:** spend up to $30 (200 to 300 images) on step 5 and label the results (about 30 minutes). *Recommend yes.*
2. **Higgsfield and unreleased designs.** *Recommend `public-only`:* motion from stills already public, no Soul ID, unless he takes its enterprise plan.
3. **A BFL key** for FLUX.1 Fill, a true inpainting mask at $0.05 an image [V]. *Recommend not yet:* only if the spike shows Gemini and OpenAI move the hand too often, and after its API terms are read.
4. **A Google Cloud project** for Veo 3.1 and Google's output indemnity. *Recommend later;* Omni is enough for concept clips.
5. **C2PA conformance and a trusted certificate.** *Recommend:* ship IPTC tags, visible labels and the provenance record now; start conformance when the first brand publishes.
6. **Real-model likeness.** *Recommend not in v2;* counsel reads the consent form first.
7. **The visible label default.** *Recommend* on, with a recorded reason to turn it off.
8. **Do on-model scene renders count against the 5 free renders?** *Recommend yes,* one per scene.

## 5. Verification

- **Goldens, deterministic (Vitest, no keys):** proxy dimensions per ring size, wrist and lobe; `placeOnProxy` on `packages/render/fixtures/evaluations.ts`; registration, lock, feather and shadow multiply on fixture buffers, compared as raw-pixel hashes (not PNG bytes); each check on built images with a known shift, scale, gap, remnant or hidden stone; `compositeEligibility` per piece kind; provider request snapshots; XMP, `asset_provenance` and the C2PA manifest read back.
- **A fixed test set** (`packages/onmodel/fixtures/set/`): 12 pieces to start (six rings from solitaire to pavé band, two studs, two bangles, a cuff, and a chain pendant as the ineligible case), growing to the research's 50; model cards at Monk tones 2, 5 and 9. For each piece: known-good composites; wrong-CAD variants from our own engine (a prong removed, a stone added, a different setting); moved-plate variants (2°, 4% and 8%). Only the plates cost money, once; they are recorded.
- **The gate's measured rates** (step 9): false accept at most 2% of the wrong variants, and none for a wrong hero-stone count or a scale error above 8%; false reject at most 25% of the known-good set. The targets are mine [E]. Rates, set version and thresholds go to `packages/onmodel/fixtures/set/RESULTS.md`; `calibrated` cannot be true unless that file passes in CI.
- **Safety red team** (`packages/onmodel/fixtures/redteam.json`, at least 60 prompts): age words and school settings; nudity phrased as styling; celebrity names, "looks like" and misspellings; a private person's name; instructions hidden in direction text. Each must be stopped before a provider call. With `LIVE=1`: ten borderline requests that pass the prompt screen must be stopped at output or come back clean. Fakes cover a provider block, an age "unsure", a moderation hit and the `public-only` rule; the suite asserts nothing was stored.
- **Server harness:** person-only approval, export refused without `check.passed`, the claim capped at concept while uncalibrated, provider fallback, budget and job caps, resume after a kill at every stage without paying twice, tenancy across two organisations.
- **Replay and screenshots:** one recording of the on-model AI job (three questions, plan, two images, a retry, a block) added to step 16's fixtures. Screens: every state in §1; light and dark; 1440×900 and 390×844; keyboard only.
- **Review lenses:** the gate (try to get a wrong ring exported); security, privacy and cost (keys, data rules, an injected direction); the founder's first hour; premium design.
- **By hand, for the founder:** make a model; ask for three ring shots; open Fidelity; redo one; ask for a chain and see "Concept"; export and read the tag in a metadata viewer; type a celebrity's name and see it stopped.
- **Not provable here:** provider rate limits, a trusted C2PA signature, how platforms show labels.

## 6. Scope cuts

| Cut | Picked up when |
|---|---|
| Chains, pendants and necklaces as composites (drape, a body mesh) | Rings pass their marks and a body-model licence is budgeted |
| Huggies and drop earrings as composites | The step after the first release |
| Fit-to-photo (the brand's own photograph) | A licensed hand model |
| Real-person likeness, face uploads | Decision 6 and counsel |
| Fine-tunes and vendor identities (LoRA, Soul ID) | Identity drifts at volume; decision 2 for Soul ID |
| Face-embedding drift (AuraFace), a hand-landmark model | The judge misses drift or bad hands |
| A tracked composite video (true piece on a moving model) | Version 3 |
| Veo 3.1 on Agent Platform; Runway, Kling direct, FLUX 3 Video; a trusted C2PA certificate; batch pricing | Decisions 4 and 5, or volume |

## 7. Build order

Each step writes its tests first and ships alone. Efforts are builder-days [E]. Steps 4, 6 and later need assistant-build step 18 (providers, keys, guardrail client); step 8 reads step 17's cost attribution.

1. **Proxies and the mannequin shot.** *Delivers:* `packages/render/src/proxy/*`, `ResolvedScene.props` in the browser engine, and a Render-stage shot "On hand (mannequin)" for rings: a true-scale picture with no key. *Files:* `packages/render/src/{proxy/*,types.ts,three/stage.ts}`, `apps/studio/src/features/render/shots.ts`, and `workers/render/pave_worker/job.py` (it rejects unknown scene versions; accept 3, ignore props until step 2). *Tests:* proxy dimension goldens, placement on fixtures, framing. *Done means:* a size-6 ring sits on a size-6 finger in the viewfinder; the measured width is within 1%. *Effort:* 3. *Depends on:* nothing.
2. **Blender props and passes.** *Delivers:* props in the worker, the six passes, `RenderJob.passes`, `purpose: 'onmodel-scene'`, wrist and lobe proxies. *Files:* `workers/render/pave_worker/{scene,render,job}.py`, `packages/render/src/node/index.ts`, `apps/server/src/handlers/render.ts`, schema, migration. *Tests:* one CPU fixture render gated on the venv; passes align to the pixel; the browser mask agrees with Blender's within 2%. *Done means:* one job returns six aligned assets. *Effort:* 4. *Depends on:* 1.
3. **The deterministic core.** *Delivers:* `packages/onmodel` with eligibility, registration, lock, the four deterministic checks and thresholds as config. *Tests:* the goldens of §5. *Done means:* a built image with a 4% shift fails overlap and a clean one passes. *Effort:* 4. *Depends on:* 2 for fixtures.
4. **Provider `edit` and data rules.** *Delivers:* in `packages/ideation`, `edit()` on `gemini` and `openai`, the fake, `PROVIDER_DATA`, `PRICES`, the Higgsfield key probe. *Tests:* request snapshots, recorded fixtures, typed errors, the `public-only` refusal. *Done means:* one live plate per provider, cost reported, no key printed or logged. *Effort:* 3. *Depends on:* step 18.
5. **The measurement spike** ($30 cap). *Delivers:* `packages/onmodel/scripts/spike.ts`: five pieces (ring, pavé band, signet, stud, bangle), three hand-only model sheets (no faces, no bodies), 200 to 300 plates through both providers, with and without the edge pass. A person labels each result. *Output:* `packages/onmodel/fixtures/spike/RESULTS.md`: hand-anatomy failure rate, hand drift, acceptance per route, whether registration and the colour segmenter hold up, first measured thresholds, cost per accepted still. *Done means:* the numbers replace the guesses in `config.ts` and decision 3 can be closed. *Effort:* 2, plus the labelling. *Depends on:* 2–4.
6. **Safety gates.** *Delivers:* `safety/*`, `moderation.ts`, the age and wardrobe questions, `safety_event`, the block flow. *Tests:* the red-team file against fakes. *Done means:* every red-team prompt is stopped before a provider call and nothing is stored. *Effort:* 3. *Depends on:* step 18.
7. **Model card and sheet.** *Delivers:* the schema additions, four face candidates, `models.keepPortrait`, `models.approve`, the composed sheet (`handlers/models.ts`), the Models pages (`features/models/*`). *Tests:* harness (person-only approval, version bump, staleness), screenshots. *Done means:* the founder makes and approves a model in the browser. *Effort:* 5. *Depends on:* 4, 6.
8. **The on-model service.** *Delivers:* `apps/server/src/onmodel/*`, both routes end to end, `shots.estimate/create/retry/review`, metering, caps, fallback, resume. *Tests:* harness with fake image and vision: pass, fail then pass, fail closed, block, kill and resume at each stage, no double spend. *Done means:* `shots.create` on a fixture ring yields a locked image with findings and claim `concept`; export stays refused until step 12. *Effort:* 5. *Depends on:* 3, 4, 6, 7.
9. **Judge and calibration.** *Delivers:* `judge.ts`, the drift check, the fixed test set, `RESULTS.md`, the `calibrated` switch. *Tests:* the rates of §5 as a CI gate on recorded outputs. *Done means:* the pass marks are met and composites earn "AI model · Rendered piece"; if not, the label stays off and the step reports the gap. *Effort:* 4. *Depends on:* 5, 8.
10. **Render-stage screens.** *Delivers:* `features/render/onmodel/*` and the tab redirect. *Tests:* screenshots of every state; keyboard only; reduced motion. *Done means:* the hand flow of §1 works in a browser. *Effort:* 4. *Depends on:* 8.
11. **The AI job.** *Delivers:* `shots.suggest`, the `on-model` recipe in `packages/agent/src/jobs.ts` (look and ask; set up; make and check; you review), the three questions, the approval limit. *Tests:* recipe unit tests, the replay recording. *Done means:* one Go produces a reviewed set. *Effort:* 3. *Depends on:* 10.
12. **Labels and export.** *Delivers:* `imaging/disclosure.ts`, XMP per claim, presets, `asset_provenance`, the export sheet, C2PA signing behind its flag. *Tests:* XMP and manifest read back; `visibleLabel: false` needs a person and a reason. *Done means:* an exported file shows the right source type in a metadata viewer. *Effort:* 3. *Depends on:* 8.
13. **Motion.** *Delivers:* the sparkle pass (frames locked onto the plate), then `VideoProvider` with Omni, the gentle-move clip, its frame checks and the `video` meter. Read Omni's current id and price first. *Tests:* frame-lock goldens, the fake video provider, the Higgsfield data rule. *Done means:* both motions appear on an accepted still with the right labels. *Effort:* 4. *Depends on:* 9, 12.
