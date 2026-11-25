# Brand models and on-model imagery, version 2

_25 November 2026, revised the same day after an adversarial review._ Build brief for reusable AI brand models and on-model pictures. It rests on [research 16](../research/16-ai-models-on-model.md), which corrects Part B of [research 04](../research/04-ideation-models.md). The spine: **a brand makes a model once; concept pictures ship first; then, if an early spike says go, the CAD is rendered on a simple proxy at the card's size, an image model paints the brand model around it, the true render is pasted back, and checks in code decide what the picture may be called.**

**Replaces in [`render-and-models.md`](./render-and-models.md):** the "Models" and "On model tab" paragraphs of §1; the `services/on-model.ts`, `providers/image/…` and `features/models` lines of §2; the last sentence of §4.5 and the C2PA sentence of §4.6; the §6 cuts for composite shots, proxies, pixel lock, extra views, on-model video, face picking and label presets; build steps 6 and 7. **Keeps:** the render studio (§1 items 1–7, §4.1–4.4, steps 1–5), the `BrandModel` and `ModelShot` contracts (extended), fail-closed export, text-only identity. It adds duties to [`publishing.md`](./publishing.md) without editing it (§4.9).

Labels: `[V]` opened at source by the research ("re-checked": opened again by me on 25 Nov), `[S]` search extract, `[E]` estimate. Paths are on `claude/assistant-build`. Not legal advice.

## 1. Experience

**Models.** A quiet grid of cards: a picture, the name, "Approved · v3", the sizes that matter ("Ring 6 · Wrist 150 mm"). **New model** is one page.

1. **Card.** Name; age range (25–34 and up; §4.5); skin tone as ten Monk swatches; hair; eyes; marks; build; nails; wardrobe from a fixed list. **Measurements**, headed "So jewelry sits at true size": ring size, wrist, neck, hand length, lobe thickness, pre-filled as "typical". A choice: **Hands only** (rings, bangles) or **Full sheet**. One tick: "This is an invented person. I am not describing a real person."
2. **Face** (full sheet). "Generate four faces · about $0.66"; keep one or try again. A candidate that fails a safety check is never shown.
3. **Sheet.** Hands: each hand, back and palm, and a relaxed ring pose (about $0.80). A full sheet adds face three-quarter and profile, each ear with hair tucked, neck and collarbone (about $2.30 in all). **Body** (half and full figure, clothed) is optional and needs the second safety check. Each view: Keep or Redo.
4. **Approve.** Three ticks (a hands-only model needs only the first): "Every view shows an adult", "I don't recognise this face as a real person", "I searched the web for this face and found no match" (Pavé opens the face in a new tab and sends it nowhere). The dialog says: "These are recorded checks, not a guarantee." Approving freezes the card and sheet and bumps the version; a later edit returns it to draft, and older images then show "Model changed · Redo".

**On model, in the Render stage.** The shot list has two sections, **Shots** and **On model**; the old piece tab redirects there.

- **Composer** (glass inspector): Model; Shot, from a short list for this piece (a ring: "Hand, from above", "Hand, three-quarter", "Close on the finger"; earrings add "Portrait"; a necklace: "Portrait", "Figure"); Used for (Product page, Social, Ads, Lookbook); how many. One line says what the piece gets: "A true render of your CAD, on Ana's hand" or "AI concept: the piece is painted by AI and may differ from your design".
- The estimate comes first: "3 images · about $1.00 · 1 render · about 6 min here". The tile walks plain stages: "Setting the scene → Painting Ana → Locking your render → Checking (2 of 3)".
- A finished tile always carries its chip: **AI model · Rendered piece** or **AI · Concept**. A **Fidelity** popover lists the checks in words ("Your render, unaltered", "Hand in place", "Nothing covers the piece", "All 3 main stones present"), which safety checks ran, and the cost. No percentages.
- Actions: **Accept**, **Redo** (with a note), **Take over** (the mannequin scene opens in the Viewfinder), **Export** (the sheet says what the file carries: label, tag, signature).
- Failed: "Didn't pass: the hand moved off the ring", with Retry and no Export. Blocked: "Stopped by a safety check · nothing was saved", no Retry. Unchecked: "The safety check didn't answer, so the image was discarded", with Retry.
- No image key: cards stay editable, the mannequin shot still works, one calm line names the missing key.

**As an AI job** ("On-model shots with AI"). The assistant looks at the piece, then asks three quick questions in one card, each with a default: **Which model?**, **Which shots?**, **What are the images for?** It shows the plan and estimate, then acts. Each image arrives with its fidelity result and label. The person can watch, pause or take over, then accept or redo each. Making and approving a model is always a person's act.

**Motion**, on an accepted still: "Sparkle pass · 4 s · true piece · 2 renders" and "Gentle move · 5 s · AI concept · about $0.53 a try", silent.

## 2. Structure

**Image providers live in `packages/ideation`** (settled): the place step 18 of the assistant build and the header of `apps/server/src/services.ts` name. `apps/server/src/providers/image/` (`render-and-models.md` §2) is dropped. Neither exists today. Step 18 builds the family, the image keys in Settings › AI and the Claude guardrail calls; this plan extends them and writes no second client.

- **`packages/ideation`**: `ImageProvider.edit()`, model descriptors, a `data` policy; `VideoProvider`. Adapters `gemini`, `openai`, `higgsfield` (video), `fake`. Any URL a provider returns is fetched through `apps/server/src/net/safe-fetch.ts` with a per-provider host list and a size cap.
- **`packages/render`** (no AI): `src/proxy/{finger,wrist,lobe,poses}.ts` build proxies from primitives; `placeOnProxy()` seats the piece; `onModelCamera()` frames it. `RenderScene.onModel` (§3) carries all of it. The Blender worker (`workers/render/pave_worker/*`; GPL, a separate program) builds props and passes. Today it has a beauty and a piece-only mask, and nothing for occlusion.
- **`packages/onmodel`** (new, pure TypeScript on raw RGBA buffers): `eligibility.ts`, `vocabulary.ts`, `prompt.ts`, `register.ts`, `lock.ts`, `gate/*`, `safety/*`, `labels.ts`, `cost.ts`, `config.ts`.
- **`apps/server/src/onmodel/`** (new; implements the `OnModelService` in `services.ts`): `service.ts`, `scene.ts`, `judge.ts` (on step 18's guardrail client, metered to `llm`), `moderation.ts`, `video.ts`, `pixels.worker.ts` (decodes with sharp under a pixel cap; all pixel work runs off the event loop). `imaging/disclosure.ts`: label, XMP, signature; shared with publishing.
- **`apps/studio/src/features`**: `models/*` replaces the 46-line placeholder; `render/onmodel/*` mounts in `RenderStudio.tsx`.

**Two routes.** *Concept* (built first): `references → generate → verify → label`, as v1 planned. *Composite*:

| Stage | What happens |
|---|---|
| `scene` | One render job, one camera, `autoTune` off. Passes: **beauty** (piece only; the proxy is hidden from the camera but still reflects in the metal), **occlusion** (a flat pass, piece white and proxy black, which gives the mask after any finger in front), **mannequin** (the base image: the skin-toned proxy with the piece, or with a flat placeholder in its place; spike A picks), **silhouette**, **stone ids** (a flat colour per hero stone). The browser engine gives the same at "Preview quality" |
| `plate` | `edit()`: base = mannequin; references = only the approved sheet views this shot needs (a hand shot never sends the face); instruction: replace the mannequin with this model in exactly this pose, keep the piece or placeholder unchanged. Text is screened first |
| `lock` | Register the plate to the scene (shift, scale and small rotation, searched round the piece). Paste **beauty** through the mask, eroded and feathered |
| `verify` | Safety first (§4.5), then the gate (§4.4). A fidelity failure returns to `plate` with the finding, three attempts at most. Nothing is stored or shown before the safety verdict |
| `label` | Store the provider's original untouched, the final image, findings, provenance and the claim the gate allows |

An `edge` pass (one low-strength edit, used only inside a thin band, then locked again) and a multiplied shadow pass stay off unless spike B shows they help.

**Local and hosted.** Locally: renders in Blender or the browser, pixel work in a worker thread, provider calls from the server. Hosted: the same code on the web service; scene renders on render nodes or in the browser ([`deploy-and-durable-jobs.md`](./deploy-and-durable-jobs.md); a shot is its `work` kind `shot` if that has landed).

## 3. Contract changes

Additive unless marked. One drizzle migration (next free number; `0015` is the last today). Every new table has `org_id`.

**`entities.ts`**
- `BrandModel` adds `scope: 'hands' | 'full'`, `sheetAssetId`, `approval: { adultConfirmed: true, recognisedNoOne, reverseSearchDone } | null`. No `real` identity and no consent table in v2 (§6).
- `card` adds `fingerSizesUs | null` (`ringSizeUs` stays the ring finger), `lobeThicknessMm`, `nails | null`, `wardrobe: enum | null`. `ADULT_AGE_RANGES` is unchanged, but `models.create` and `models.update` refuse `18-24` while `SAFETY.minAgeRange` is `25-34`.
- `portraits[]` adds `label` (`MODEL_VIEWS`: three face views, `hand-{left,right}-{back,palm}`, `hand-relaxed`, `ear-{left,right}`, `neck`, `body-half`, `body-full`), `candidateId` and `checks: { adult, safe, by: string[] }`.
- `ModelShot.placement` adds `'portrait' | 'figure'` (concept only). `SHOT_STAGES` adds `scene, plate, lock, edge`.
- `ModelShot` adds `shotKey`, `purpose: 'product' | 'social' | 'ads' | 'lookbook'`, `media: 'still' | 'clip'`, `parentShotId`, `retryOf`, `review`, `claim: 'concept' | 'composite'`.
- `check` adds `gate: { thresholdsHash, calibrated }` and `safety: { ran: string[] }`; a finding adds `kind` (`scene | size | cover | register | pixel | overlap | gap | judge | safety | drift`), `value?`, `threshold?`.
- `provenance` adds `sceneRenderId`, `plateAssetId`, `originalMarks: { c2pa, synthId }` (as received; not a claim about the composite), `digitalSourceType`, `dataRule`, `costUsd`.
- `RenderScene.onModel: { placement, pose, framing, tone, base: 'piece' | 'placeholder', proxy: { kind, …dimensions in mm } } | null`. It sits in `requestedScene`, so `cacheKeyOf` (`engines/render/queue.ts`) hashes it. `RenderJob.purpose` adds `'onmodel-scene'`, for which the server forces `autoTune: false`; `RenderJob.passes: Record<string, id> | null`.
- `Capabilities` adds `video: string[]` and `secondSafetyCheck: boolean`. `METERS` adds `'video'`. `AiJob.recipe?: 'on-model'`; `JOB_STAGES` stays three.

**`packages/render/src/types.ts`**: `ResolvedScene.props` and `output.passes`; `RESOLVED_SCENE_VERSION` 3. **Breaking** between server and worker, which ship together.

**Commands**
- `models.generatePortraits` takes `MODEL_VIEWS` and `candidates: 1 | 4`; it is the only writer of `portrait_candidate`. `models.keepPortrait { id, candidateId }`: person only, never a tool; the candidate must belong to this model and have passed its checks. No command takes an asset id for a view, so an uploaded photo cannot become one.
- `models.approve { id, adultConfirmed: true, recognisedNoOne?, reverseSearchDone? }` (the last two required for a full sheet): person only. `models.update { status: 'approved' }` is refused. **Breaking**, no caller yet.
- `shots.suggest { pieceId }` → `{ composite: { ok, reason }, shots, models, questions }`; query, tool.
- `shots.create` adds `shotKey`, `purpose`, `fidelity: 'auto' | 'concept'`. `shots.estimate` returns counts, a dollar range and minutes.
- `shots.review`, `shots.retry`, `shots.recheck` (the judge only, on a stored image), `shots.animate` (always confirmed).
- `shots.export { id, preset, trueSizeLine, visibleLabel, reason? }`. **Behaviour change:** today `label: false` returns the untouched original; now every export is a tagged, signed copy. For `claim: 'concept'` the visible label cannot be turned off by anyone, purpose `product` is refused, and `ads` needs a person's second confirmation that names the risk. For `composite`, `visibleLabel: false` needs a person and a reason.
- `org.settings.onModel: { imageProvider, fallbackProvider, videoProvider, dataRules, maxUsdPerJob, maxUsdPerPieceDay, labelPreset }` (admin). Loosening a data rule needs a confirmation that quotes the provider's clause; it is audited.

**`ImageProvider`** (`generate` is step 18's)
```ts
edit(req: { model; base: Img; refs: { img: Img; role: 'identity'|'skin'|'pose' }[]; mask?: Img;
            instruction: string; size: { w; h }; seed? }): Promise<ImageResult>
models: { id; maxRefs: { object; character }; mask: 'none'|'guidance'|'exact';
          priceUsd(size): number | [low: number, high: number] }[]
data: { trainsOnInputs: 'no'|'unless-enterprise'|'unknown'; evidence: string; checkedAt: string }
```
`ProviderBlocked` is never retried. `ProviderUnavailable`, `ProviderRateLimited` and `ProviderNeedsVerification` (OpenAI "may need" organisation verification [V]) are named to the person, then the fallback is tried.

**Tables.** New columns on `brand_model` and `model_shot` for the fields above. `portrait_candidate { id, org_id, model_id, label, asset_id, checks, created_by, at }`. `safety_event { id, org_id, user_id, run_id, subject, subject_id, gate, category, provider, input_hmac, at }`: no pixels, no text, a keyed hash. `asset_provenance { asset_id, org_id, shot_id, digital_source_type, preset, visible_label, reason, signed, original_sha256, exported_by, at }`.

**Config** (`packages/onmodel/src/config.ts`): `GATE`, `SAFETY`, `LIMITS`, `PRICES`, `PROVIDER_DATA`, `LABEL_PRESETS`. `<dataDir>/on-model.json` is read only when `authMode === 'local'` and may only tighten `GATE` and lower `LIMITS`; anything else in it is ignored. Keys follow step 18's sealed store: `GEMINI_API_KEY`, `OPENAI_API_KEY`, `HIGGSFIELD_API_KEY` with `HIGGSFIELD_API_SECRET` [V].

## 4. Hard parts and decisions

**4.1 Only a render can be called product-accurate.** Published editors score 0.70–0.81 on product similarity [V]; a jewelry-photo vendor reports changed prong counts and settings [V, vendor]. *Decision:* render-first with pixel lock. Honest limits: the paste is feathered, so along the silhouette the picture blends our render with the plate. So the remnant check covers the feather band; the piece must be at least `minPiecePx` across and its centre stone `minStonePx` (config [E]) to earn the composite claim; and spike A tests a base with a flat placeholder, so that nothing of ours is repainted. *Rejected:* generative shots as product images; generate-then-repair; fit-to-photo.

**4.2 No licensed hand or body model.** MANO is non-commercial [V, re-checked]; WiLoR's weights are CC BY-NC-ND and need MANO [V]; Meshcapade's hand model costs €600 a year (micro company) or €10,000 (SME), SMPL €1,500 or €25,000 [V]. *Decision:* proxies are our own primitives. Ring size is read from the `ringShank` node's `size` and turned into a bore with `ringInnerDiameter()` (`packages/schema/src/domain/sizes.ts`); `design.evaluate` has no such fact. The finger takes that bore and the shank's axis; the rest of the hand scales from the card. The proxy depends on the card's measurements, not only its tone.

**4.3 What is in the first release.** `compositeEligibility(design)`, pure.

| Piece | Route | Why |
|---|---|---|
| Ring with a `ringShank` node | Composite | Rigid; size and axis known |
| Ring without one (freeform or imported) | Concept: "no ring shank, so its size and axis are unknown" | A measured bore from the kernel is a later step |
| Stud (`earrings`, an `earringPost` finding, no `chain`, under a height limit) | Composite | Rigid; hair is the risk |
| Bangle or cuff (`bracelet`, no `chain`) | Composite | Rigid; an elliptical wrist |
| Huggies, drops, pendants, necklaces, chains, flexible bracelets, brooches | Concept, including the **Portrait** and **Figure** shots | They hang, drape or sit on cloth; no body mesh |

**4.4 The fidelity gate** (composite). Fail closed, in order.
0. **Scene truth:** the scene render's `sourceVersion` and `onModel` block match the shot; the hero stones (roles `center` and `side`) in the render input equal the design's at that version; every id in the stone-id pass is one of them; the stones the shot features are visible.
1. **Size floor** (§4.1).
2. **Cover:** inside the mask, the raw plate still shows the base (piece or placeholder), not skin or hair. This catches a finger painted across the ring and hair over a stud.
3. **Registration:** the transform found must be within limits, else "the hand moved".
4. **Pixel lock:** structural similarity of final image and beauty pass inside the eroded mask ≥ 0.98. A self-test of our pipeline, never shown as a score.
5. **Overlap:** skin against background by a colour model fitted per image; IoU with the proxy silhouette ≥ 0.85 in a band round the piece; finger width within ±4%.
6. **Gap and remnant,** across the feather band too.
7. **Judge checklist:** closed questions on the CAD crop and the output crop: intended finger or ear; plausible scale; five fingers; natural joints; no extra jewelry; nothing covering the piece. Concept shots add hero stone count, shape, setting and metal.
8. **Drift:** tone, marks and nails against the sheet.

The numbers in 4 and 5 are the research's [E]; the rest are mine [E]; none is measured. *Decision:* `calibrated` is true only when every threshold in force is at least as strict as the set measured in step 12; otherwise the claim is capped at concept. *Rejected:* a hard embedding threshold; a judge counting pavé.

**4.5 Safety gates.** Prompts ask; these code paths decide. One structured judge call per image answers safety first.

*Age and likeness are judged at the card.* Every candidate and view with an age signal (face, ear, neck, body) must be answered `adult`; `minor` or `unsure` drops it. A person then ticks "Every view shows an adult", and that is recorded. `18-24` is off until measured on that bracket, where apparent-age error is largest [E]. Whether the judge answers age questions firmly or hedges is unknown until step 4 measures it. Likeness: identity is text only; a Claude screen for names and "looks like" runs on every free-text field (`description`, `hair`, `eyes`, `marks`, `build`, `styling`, the name, each `direction`; the word list is only a cheap first pass); then the two recorded ticks. *Rejected:* a face-recognition gate, which needs a gallery of real faces that both vendors' policies bar without consent [V].

*What an output inherits.* A shot can only be made from an approved card, and the server takes references only from that version's kept candidates.

| Output shows | Age question | Why |
|---|---|---|
| Hand or wrist | "Clearly a child's hand?" Only `yes` fails | A close-up carries almost no age signal; adulthood is inherited from the card. For a hands-only card it rests on the prompt, this check and the approver's tick: a backstop, and the plan says so |
| Ear, portrait, figure | Must be `adult` | If adults are refused too often on ear crops, the shot is framed wider (jaw and cheek); the rule is not softened |

*Order, so that nothing suspected goes further.* (1) The provider's own filter. (2) The judge: age, then clothing ("clothed as chosen? any nudity or sexualised pose?"). An image that fails is dropped: never stored, never shown, sent nowhere else. (3) Only an image that passed (2) goes to OpenAI `omni-moderation-latest` (free; scores `sexual` on images; `sexual/minors` is text-only), whose guide says "Do not send suspected CSAM" to it [V, re-checked]. (4) The fidelity gate. Without an OpenAI key, or with its data rule `never`, `secondSafetyCheck` is false: body views and the Portrait and Figure shots are unavailable, and Settings and the popover say which checks ran.

*When a check cannot answer.* Every judge and screen reply is parsed against a schema. A timeout, an error or a malformed reply gets one retry of that call (not of the image), then fails closed as `check_unavailable`: the image is discarded and Retry is offered. A refusal by the judge counts as a block. For the fidelity questions alone, on an image already safe and stored, `shots.recheck` asks again at no image cost.

*On a block.* The stage stops; nothing is retried or reworded. A `safety_event` row is written. The same request (by keyed hash) is refused for 24 hours without a provider call; three blocks in ten minutes pause that user's on-model requests for ten minutes [E]. Admins see blocks in Settings › Usage.

*Nudity.* Wardrobe is a fixed vocabulary; body views are always clothed; provider filters stay on (`moderation: 'auto'` [V]).

**4.6 What a machine the user owns can enforce.** On a laptop the owner holds the code, the database and the keys, so a determined owner can remove any local gate. Local gates stop accidents, agents and ordinary use. The provider's own filters are the one control the owner cannot remove. Enforced anyway: the override file can only tighten; a loosened threshold caps every claim at concept; safety vocabulary, data rules and labels have no file override; export and publish always go through the labelling path. Hosted, every gate binds server-side.

**4.7 Providers** (list prices on 25 Nov 2026, kept in `PRICES`).

| Role | Model | Price |
|---|---|---|
| Sheet and plate | Google `gemini-3-pro-image`: 5 character and 6 object references, no mask upload | $0.134 per 1K/2K image; batch $0.067 [V, re-checked] |
| Exploration | Google `gemini-nano-banana-2.1` | $0.0336 (1K), $0.0504 (2K) [V, re-checked] |
| Fallback | OpenAI `gpt-image-2.6-sunburst`; its mask "may not follow its exact shape" [V, re-checked] | Token-priced; estimated as a range ($0.02–0.19 at a reseller [V]) and corrected from usage |
| Motion | Google `gemini-omni-1.1-flash`: 3–10 s, first and last frame, audio by default with no documented off switch [V, re-checked] | about $0.10 a second at 720p [V, re-checked] |
| Motion, second | Higgsfield DoP | $0.125–0.56 per 5 s [V] |

**What the founder's keys reach.** Gemini: images and Omni video, not Veo (its Gemini API previews shut on 22 October 2026 [V, re-checked]; Veo needs a Google Cloud project). OpenAI: images only (Sora 2 and the Videos API shut on 24 September 2026, "no one-to-one replacement" [V, re-checked]). Higgsfield: video; step 3 probes which of its two APIs the key belongs to. A newer Omni model id appears in search results only [S]; step 13 reads the id and price first.

**4.8 What is sent to whom.** A plate request carries an unreleased design.

| Provider | Trains on what you send | Default rule |
|---|---|---|
| Google, paid Gemini API | No [V, re-checked: terms of 23 Mar 2026]; the image models are paid-only [V, re-checked]. Pavé cannot see a key's tier, so Settings says the rule assumes a billed project, for video above all | `all` |
| OpenAI API | Not unless you opt in [V]; how moderation inputs are kept is not stated [V, re-checked] | `all` |
| Higgsfield | May train on content; deletion stops future use only; enterprise excluded [V, re-checked] | `public-only` |

*Decision:* the server checks the rule before any bytes leave, for plates, the judge and moderation alike. `public-only` needs a person's audited confirmation that the design is public; an agent cannot give it. No indemnity in the Gemini API terms; Google Cloud indemnifies through the Agent Platform; OpenAI's excludes Output [V].

**4.9 Labelling.** The chip is on every tile. Every export is a copy with three marks; the provider's original is always offered beside it.

| Duty | Evidence | What Pavé does |
|---|---|---|
| Machine-readable tag | Google Merchant Center requires the IPTC source-type tag to be present and kept [V, re-checked] | XMP `DigitalSourceType`: `trainedAlgorithmicMedia` (concept), `compositeSynthetic` (composite; IPTC vocabulary [V, opened 25 Nov]); read-back test on renditions |
| EU AI Act Article 50 | Applies from 2 Aug 2026. The grace period to 2 Dec 2026 covers only systems placed on the market before 2 Aug 2026; later ones comply from placement (Regulation (EU) 2026/1744 [V, re-checked: a national regulator's page and a law-firm note; the act's own text did not load]). Providers are expected to mark with signed metadata plus an invisible watermark [V, research] | No grace applies to Pavé. Exports are **signed by default** with a C2PA manifest (ingredients: CAD render, provider output) under Pavé's own certificate, which validators show as an unknown signer until conformance. If signing cannot load, the export sheet says "unsigned tag only". No preset is named after the EU. We add no watermark of our own |
| New York GBL §396-b | "Conspicuously disclose" a synthetic performer in an ad; $1,000, then $5,000 [V, re-checked]; in effect June 2026 [V, secondary] | Purpose "Ads" selects the "AI-generated model" label |
| FTC Jewelry Guides | A gemstone shown larger than life "may mislead consumers, unless a disclosure is made about the item's true size" (16 CFR 23.1, note 3 [V, re-checked]) | A true-size line from the CAD ("Centre stone 6.5 mm") is on by default for product and ads |
| Amazon, Etsy | Tag AI people; one unedited real photo per listing [V, secondary] | `MediaItem.syntheticPerson` true; shots enter publishing as `lifestyle`, never `main`; concepts never as product images |

Signing uses `@contentauth/c2pa-node` if its licence file allows (its README states none [V, reviewer]); otherwise `c2patool` as a separate process (`c2pa-rs` is MIT or Apache-2.0 [V]).

**For counsel, before step 8 is released to anyone but the founder:** is Pavé a "provider" under Article 50 (if so, a watermark of our own is needed), and is an invented model a "deepfake"; "conspicuous" in New York; the Jewelry Guides; California SB 1000; whether a hosted service has reporting or preservation duties that conflict with "never stored"; the consent form for any later real-likeness feature (signed consent, uses and term with AI named, pay, withdrawal, proof of age, photo hashes, who verified, representation).

**4.10 Video.** The best closed models score about 58–63 of 100 on product consistency [V]. *Decision:* a generated clip is always concept: 3 to 5 seconds, a slow push-in, the accepted still as first and last frame, the audio track removed before storing. The judge sees three frames, safety first. The true-piece option is the sparkle pass: the piece under a moving light (the `rigRotation` track), each frame locked onto the still's plate. It is about 96 path-traced frames, so the composer gives minutes for this machine, and it counts as an animation (2 renders, `ANIMATION_RENDER_COST`).

**4.11 Cost and caps** [E on V list prices; every acceptance rate is a guess until measured].
- A composite attempt is about $0.17 (plate $0.134, references $0.01, one judge call $0.03), or $0.22 with the edge pass. At a guessed 65% kept: **about $0.27 to $0.34 per accepted still; plan on $0.30 to $0.70.** Three attempts cost at most $0.67. Whether a blocked output is billed is not verified; estimates assume it is.
- A model, judge included: hands only about $0.80; full sheet about $2.30; body views $0.33 more.
- A 5-second clip: about $0.53 a try; **$1.50 to $2.10 per accepted clip** at a guessed 25–35% kept.
- **Shown:** usage events (`image`, `llm`, `video`) carry the piece, the Render stage and the key `shot:<id>:<attempt>:<stage>`; the project's Renders section shows "On model · 6 images · $2.31"; model creation shows as "Brand models" in Settings › Usage (on step 17's attribution, plus a `feature` tag if it added none).
- **Caps:** an estimate before any spend; three attempts a shot; twelve auto-approved shots and `maxUsdPerJob` ($10) per AI job; `maxUsdPerPieceDay` ($10) for by-hand use, because `assertBudget` does nothing until an organisation sets a budget; clips confirmed one by one.
- A scene is one render job of about three path-traced passes; it claims one render, and the estimate gives its minutes. It is reused across attempts and across cards whose proxy inputs are equal.

**Decisions that are the founder's**
1. **Composite or concept first?** *Recommend:* models and concept shots first (steps 3–9); the composite track (10–12) only if spike A says go.
2. **Measurement money:** up to $100 in all (spike A $10, the age set $30, spike B $60) and about two hours of labelling. *Recommend yes.*
3. **Higgsfield and unreleased designs.** *Recommend `public-only`.*
4. **Age brackets:** `18-24` off, and full sheets off if the age check misses its marks (hands-only models still ship). *Recommend yes.*
5. **Body views with the Portrait and Figure concept shots,** or cut them. *Recommend keep,* behind the second safety check.
6. **Signing:** sign by default with our own untrusted certificate now; conformance and a trusted certificate after counsel answers. *Recommend yes.*
7. **A Google Cloud project** (Veo, indemnity) and **a BFL key** (true mask inpainting, $0.05 an image [V]). *Recommend later;* BFL only if the spikes show the hand moves too often.
8. **Scene renders count against the 5 free renders,** a sparkle pass as 2. *Recommend yes.*

## 5. Verification

- **Goldens (Vitest, no keys):** proxy dimensions per size; `placeOnProxy` on `packages/render/fixtures/evaluations.ts`; registration, lock and feather as raw-pixel hashes; each check on built images; eligibility per kind, a ring without a shank included; two cards that differ only in wrist size do not share a scene cache key; provider request snapshots; XMP, signature and `asset_provenance` read back.
- **The composite gate's set** (`packages/onmodel/fixtures/set/`): 12 pieces to start, growing to the research's 50; cards at Monk tones 2, 5 and 9. Known-good composites, and failures by class, at least 50 each: plates moved, rotated and rescaled; a finger across the piece; hair over a stud; a remnant ring; a second ring; a gap. Most are built from recorded good plates by warping and overlay; the rest are real failures labelled in spike B. **Pass marks [E]:** false accept at most 2% in every class; false reject at most 25% of known-good. Wrong-CAD variants (a prong removed, a stone added) test only the concept checklist and are reported apart: at least 95% of wrong hero-stone counts caught.
- **The age check's set** (step 4): an age-labelled face set whose licence allows this use, read at source; images never committed, only labels and results. Ear crops are cut from the same faces. **Pass marks [E]:** of faces labelled under 18, at most 1% answered `adult`, and none labelled under 13; of faces labelled 25 or over, at most 15% not answered `adult`. Adult hands from the spikes: at most 5% failed as a child's. Missed marks keep full sheets off.
- **Safety red team** (`fixtures/redteam.json`, 60 or more): age words; nudity phrased as styling; celebrity names, "looks like", misspellings and name-free lookalike descriptions; a private person's name; instructions hidden in each free-text field. Each is stopped before a provider call. Fakes cover a provider block, each age answer, a judge refusal, a timeout, a malformed reply, a moderation hit, the cool-off and the data rules. The suite asserts that nothing was stored and that an age-failed image reached no second endpoint.
- **Bypass tests:** `keepPortrait` with an uploaded asset is refused; an override that loosens a threshold caps the claim; the override is ignored in accounts mode; a concept export with `visibleLabel: false` is refused for every role; a concept export for `product` is refused.
- **Server harness:** person-only approval, provider fallback, caps, resume after a kill at every stage without paying twice, tenancy across two organisations including the new tables.
- **Replay and screenshots:** one recording of the AI job (questions, plan, two images, a retry, a block) in step 16's fixtures; every state in §1, light and dark, 1440×900 and 390×844, keyboard only.
- **Review lenses:** the gate (try to export a wrong ring); safety (try each bypass); security, privacy and cost; the founder's first hour; premium design.
- **By hand, for the founder:** make a hands-only model; ask for three ring shots; open Fidelity; redo one; ask for a necklace and see "Concept"; export and read the tag and signature; type a celebrity's name and see it stopped.
- **Not provable here:** provider rate limits, a trusted signature, how platforms show labels, whether SynthID survives compositing.

## 6. Scope cuts

| Cut | Picked up when |
|---|---|
| Composites for chains, pendants, necklaces, huggies and drops | Rings pass their marks; a body-model licence is budgeted |
| Composite rings without a ring shank | The kernel reports a measured bore and axis |
| Real-person likeness: no `real` identity, no upload, no consent table (the field list is in §4.9) | Counsel, then a plan of its own |
| Fit-to-photo; fine-tunes and vendor identities (LoRA, Soul ID) | A licensed hand model; identity drifts at volume |
| A watermark of our own; a trusted C2PA certificate | Counsel says Pavé is a provider; decision 6 |
| Face-embedding drift; a hand-landmark model (MediaPipe's repository is Apache-2.0 [V, reviewer]; its model file's terms unread) | The judge misses drift or bad hands |
| A tracked composite video; Veo, Runway, Kling | Version 3; decision 7 |

Credits: the Monk Skin Tone Scale is CC BY 4.0 [S]; the app's credits name it.

## 7. Build order

Tests first; each step ships alone. Efforts are builder-days [E], 47 in all. The go or no-go comes after 4 days; the founder makes a model by day 16 and sees AI on-model pictures by day 24. Steps 3 and later need assistant-build step 18.

1. **Proxies and the mannequin shot** (3). *Delivers:* `packages/render/src/proxy/*`, `RenderScene.onModel`, props in the browser engine, a Render-stage shot "On hand (mannequin)": a true-scale picture with no key. *Files:* also `three/stage.ts`, `features/render/shots.ts`, and `pave_worker/job.py` (it rejects unknown scene versions; accept 3). *Tests:* proxy goldens, the cache-key test, a ring without a shank refused. *Done means:* a ring whose shank says size 6 sits on a finger of that bore within 1%.
2. **Spike A: go or no-go** (1; $10 cap). *Delivers:* a throwaway script (`packages/onmodel/scripts/spike-a.ts`; keys from the environment, never printed) that sends step 1's browser mannequin to both providers directly: about 40 plates, hands only (the script accepts no other view), both bases, judged by eye plus a crude overlap number. *Done means:* a one-page result. **Go** if one provider and base keeps the hand in place in at least half the plates [E]; otherwise the composite track stops and decision 1 is settled as concept only. *Depends on:* 1.
3. **Provider `edit` and data rules** (3). *Delivers:* in `packages/ideation`, `edit()` on `gemini` and `openai`, the fake, safe fetching, `PROVIDER_DATA`, `PRICES`, the Higgsfield probe. *Tests:* snapshots, typed errors, rule refusals. *Done means:* one live plate per provider; no key printed or logged.
4. **Safety gates and their measurement** (4; $30 cap). *Delivers:* `safety/*`, `judge.ts`, `moderation.ts`, the order of §4.5, failure handling, `safety_event`, cool-off, and the age set's results in `fixtures/safety/RESULTS.md`. *Tests:* the red team and bypass tests. *Done means:* the pass marks are met, or full sheets are switched off and the step says so. *Depends on:* 3.
5. **Model card and sheet** (5). *Delivers:* schema, `portrait_candidate`, `keepPortrait`, `approve`, hands-only and full sheets, `handlers/models.ts`, `features/models/*`. *Tests:* harness, screenshots. *Done means:* the founder makes and approves a model in the browser. *Depends on:* 4.
6. **The on-model service, concept route** (4). *Delivers:* `apps/server/src/onmodel/*`, `shots.estimate/create/retry/review/recheck`, metering, caps, fallback, resume, the Portrait and Figure shots. *Tests:* harness with fakes: pass, fail closed, block, unanswered check, kill and resume, no double spend. *Depends on:* 5.
7. **Render-stage screens** (4). *Delivers:* `features/render/onmodel/*`, the tab redirect. *Tests:* screenshots of every state. *Done means:* the by-hand flow of §1 works for concept shots. *Depends on:* 6.
8. **Labels and export** (3). *Delivers:* `imaging/disclosure.ts`, XMP, signing, presets, the true-size line, `asset_provenance`, the export rules of §3. *Tests:* read-back; the export bypass tests. *Done means:* an exported file shows its tag and signature in a viewer. Released beyond the founder only after counsel's answer (§4.9). *Depends on:* 6.
9. **The AI job** (3). *Delivers:* `shots.suggest`, the `on-model` recipe in `packages/agent/src/jobs.ts`, the three questions, the approval limit, the replay recording. *Depends on:* 7.
10. **Blender scene passes** (4; only on a go). *Delivers:* props and the passes of §2 in the worker, `RenderJob.passes`, wrist and lobe proxies. *Tests:* one CPU fixture render; passes align to the pixel; the proxy reflects in the metal yet is absent from the beauty pass. *Depends on:* 1, 2.
11. **Lock and the deterministic gate** (4). *Delivers:* `register.ts`, `lock.ts`, `gate/*`, thresholds as config, the composite route in the service. *Tests:* the goldens. *Done means:* a fixture ring yields a locked image with findings and claim `concept`. *Depends on:* 6, 10.
12. **Spike B and calibration** (5; $60 cap). *Delivers:* five pieces, three hands-only sheets (the script accepts no other view), about 260 plates (Gemini by batch at half price, about $16; OpenAI about $12 [E]; judge about $8), labelled by a person in about 90 minutes; the gate's set; `fixtures/set/RESULTS.md`; the `calibrated` rule; whether the edge and shadow passes earn their place. *Done means:* the pass marks are met and composites earn "AI model · Rendered piece"; if not, the label stays off and the step reports the gap. *Depends on:* 11.
13. **Motion** (4). *Delivers:* the sparkle pass, then `VideoProvider` with Omni (read its id and price first), the gentle-move clip without audio, frame checks, the `video` meter. *Tests:* frame-lock goldens, the fake video provider, the Higgsfield rule. *Depends on:* 8; the sparkle pass also needs 12.
