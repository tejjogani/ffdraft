# 16 — AI human models and on-model imagery: vendors, identity, fidelity to the CAD, video, safety, cost

Research date: 2026-11-25. Scope: identity-consistent virtual models a brand can create and reuse (face, hand, body), putting the exact CAD piece on the model, video, safety and labelling law, vendors with prices and licences, and a cost model. Builds on [`docs/plans/render-and-models.md`](../plans/render-and-models.md) (this file feeds a version 2 of its brand-models part) and extends and corrects Part B of [`04-ideation-models.md`](./04-ideation-models.md). Rendering background: [`03-rendering.md`](./03-rendering.md). No image was generated and no paid API was called; this is desk research.

**How to read the evidence.** `[V]` = I opened the page this session and the claim is on it; the link is beside it. `[S]` = seen only in a search result or a secondary page; not opened at source. `[E]` = my own estimate or working knowledge; the basis is stated. Prices and limits are as seen on 25 November 2026 and will move. Nothing here is legal advice; section 6 is a map for a conversation with counsel.

## 1. The short answer

- **No image model keeps a jewelry design true.** Vendors say so in their own docs (OpenAI: recurring brand elements "may not stay consistent" [V]), papers measure it (section 4.2), and jewelry-photo vendors describe prong counts and settings changing. A generated on-model picture is a concept. Only a picture whose jewelry pixels come from the CAD render can be called product-accurate.
- **Recommended pipeline: render first, paint the person around it.** Pose the CAD on a plain proxy (a finger at the model's ring size, a wrist, an ear, a neck), render the piece with Blender or the browser engine, then ask the image model to replace the proxy with the brand model. Paste the true render back inside its mask ("pixel lock") and let the model touch only a thin contact band. Scale, light direction and occlusion are known because we built the scene. This needs no licensed body model for rings, studs and bangles.
- **Default provider: Google, with the founder's Gemini key.** Nano Banana Pro (`gemini-3-pro-image`, $0.134 per 1K/2K image, up to 5 character references) for the model sheet and the plate; Nano Banana 2.1 (`gemini-nano-banana-2.1`, $0.034 at 1K, $0.050 at 2K) for exploration and the edge pass [V]. Paid-tier data is not used for training [V]. **First fallback: OpenAI** `gpt-image-2.6-sunburst` (mask-guided edits; API content not trained on by default) [V]. **Higgsfield: motion only, and with care**: its help centre says it may train on user content unless you are an enterprise customer [V], so unreleased designs should not go there without the founder's say.
- **Three facts in research 04 and the plan are now wrong.** (1) Veo is no longer on the Gemini API: the Veo 3.1 preview models were shut down there on 22 October 2026; the Gemini-key video model is Gemini Omni Flash (`gemini-omni-1.1-flash`, about $0.10 per second at 720p), and Veo 3.1 remains on Google Cloud's Agent Platform (the renamed Vertex AI) [V]. (2) OpenAI has no video API: Sora 2 and the Videos API were shut down on 24 September 2026 with no replacement [V]. (3) Black Forest Labs now sells FLUX 3 Image and FLUX 3 Video; FLUX.2 is the previous line [V].
- **Identity: a frozen model sheet plus multi-reference conditioning** is enough for v2. Fine-tunes (Higgsfield Soul ID, FLUX LoRA) hold a face better at volume but lock the brand to one vendor and one model family. Hands are the weak spot: I found no current measured failure rate, so the plan needs a small paid spike before thresholds are fixed.
- **The fidelity gate is two checks.** A deterministic one (the jewelry pixels equal the render; the skin lines up with the proxy) and a vision-model checklist against facts from `design.evaluate`. Fail closed. Thresholds to try are in section 4.5.
- **Video cannot be made CAD-true by generation.** Benchmarks show product identity drifting in image-to-video, worst under viewpoint change (section 5). Ship short, slow moves from an approved still as "AI · Concept" motion; keep true-piece video for Blender turntables until a tracked composite is built.
- **Labelling is now law and platform rule, not a nicety.** EU AI Act Article 50 has applied since 2 August 2026; New York requires a conspicuous disclosure for a "synthetic performer" in an ad; Amazon requires metadata tags on images with photorealistic AI people; Etsy requires at least one unedited photo of the real item; Google Merchant Center requires the IPTC source-type tag to be kept [V, section 6].
- **Cost:** about $0.30 to $0.70 per accepted on-model still and $1.50 to $4 per accepted 5-second generated clip, including retries (section 7, estimates on verified list prices).

## 2. Vendors and APIs

### 2.1 What each one does and costs (25 Nov 2026)

| Vendor / model | Does | API | Price | Max size | Evidence |
|---|---|---|---|---|---|
| **Google Nano Banana Pro** `gemini-3-pro-image` | Text to image, edit by instruction, up to 6 object + 5 character + 3 style refs (14 total, 5 at high fidelity). Masks are "semantic" (described in words), not uploaded | Gemini API, Agent Platform | $0.134 (1K/2K), $0.24 (4K); batch half; each input image about $0.0011 | 4096×4096; 5504×3072 at 16:9 | [V pricing](https://ai.google.dev/gemini-api/docs/pricing.md.txt), [V docs](https://ai.google.dev/gemini-api/docs/image-generation.md.txt) |
| **Google Nano Banana 2.1** `gemini-nano-banana-2.1` | Same, up to 10 object + 4 character refs; video as input | same | $0.0336 (1K), $0.0504 (2K), $0.113 (4K); batch half; input $1.50 per 1M tokens | 4K | same |
| **Google Nano Banana 2 Lite** `gemini-3.1-flash-lite-image` | Fast generate; 14 object refs, **no character refs** | same | $0.0336 (1K only) | 1K | same |
| Nano Banana 2 `gemini-3.1-flash-image` (previous) / Nano Banana `gemini-2.5-flash-image` (deprecated, off 15 Mar 2027) | — | same | $0.067 at 1K / $0.039 | 4K / 1K | same |
| **Google Gemini Omni Flash** `gemini-omni-1.1-flash` | Text/image to video, first and last frame, image refs (doc example uses six), up to 3 short reference videos, conversational video edit, extend to 40 s; audio by default | Gemini API (paid), Agent Platform | Video output $17.50 per 1M tokens: about $0.034/s at 360p, $0.10/s at 720p, $0.15/s at 1080p (upscaled), $0.30/s at 4K (upscaled) | 4K upscaled; 16:9, 9:16 | [V docs](https://ai.google.dev/gemini-api/docs/omni.md.txt), [V Cloud pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing) |
| **Google Veo 3.1 / Fast / Lite** | Image to video, first/last frame, up to 3 "asset" reference images of one person or product, extension; 4/6/8 s, 24 fps | **Agent Platform only** (Gemini API previews shut 22 Oct 2026) | Video only: $0.20/s (720p/1080p), $0.40/s 4K; Fast $0.08/$0.10/$0.25; Lite $0.03/$0.05. With audio: $0.40, Fast $0.10–0.12, Lite $0.05–0.08 | 4K | [V shutdown notice](https://ai.google.dev/gemini-api/docs/veo.md.txt), [V Cloud pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing) |
| Google Virtual Try-On `virtual-try-on-001`, Imagen Product Recontext | Garment try-on; product in new scene | Agent Platform | $0.06 / $0.12 per image | not verified | [V pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing); product types not verified (page truncated) |
| **OpenAI GPT Image 2.6** `gpt-image-2.6-sunburst` (precise edits), `-flare` (fast) | Generate, edit with several input images, mask edit (the mask is guidance and "may not follow its exact shape"), markup-layer edits, transparent background, SVG and GIF output | Images and Responses API; organisation verification may be needed | Tokens: image out $30, image in $8, text in $5 per 1M; batch half. OpenAI gives no per-image figure for 2.6; its older gpt-image-2 table is $0.006 / $0.053 / $0.211 (low/medium/high, 1024²). Runway resells 2.6 at $0.02–0.19 per image | 3840 px edge, 8.29 MP | [V pricing](https://developers.openai.com/api/docs/pricing), [V guide](https://developers.openai.com/api/docs/guides/image-generation.md), [V Runway](https://docs.dev.runwayml.com/guides/pricing/) |
| OpenAI Sora 2 / Videos API | — | **Shut down 24 Sep 2026**, no replacement API | — | — | [V](https://developers.openai.com/api/docs/guides/video-generation) |
| **Higgsfield** platform API (Soul, Soul ID, DoP) | Soul text to image; Soul ID trained character (a "custom reference" object with id, status, reference media); DoP image to video | `platform.higgsfield.ai`, headers `hf-api-key` + `hf-secret` | $1 = 16 credits. Soul: $0.09 (720p), $0.19 (1080p), batch of four $0.13 / $0.31. Soul ID character: $2.50. DoP 5 s: Lite $0.125, Turbo $0.41, Standard $0.56 | 1080p | [V pricing](https://docs.higgsfield.ai/pricing), [V character API](https://docs.higgsfield.ai/api-reference/character/get-character) |
| **Higgsfield** model API (16 Sep 2026) | One key for "50+" models: own Soul 2, Soul Cinema, DoP, Marketing Studio Image; third-party Kling, Seedance, Wan, MiniMax, PixVerse, LTX, Grok, Ideogram, Recraft, Qwen. Veo, Nano Banana and GPT Image are not named | `api.higgsfield.ai`; Python/TS SDKs; async with polling or webhook; 20 concurrent requests; outputs kept at least 7 days; failed runs refunded | "Starting" rates: Soul 2 $0.0032/image, Marketing Studio Image $0.0059, Kling 2.6 $0.07/s, Kling 3.0 $0.112/s, Seedance 2.5 $0.074/s, DoP $0.125/generation | per model | [V blog](https://higgsfield.ai/blog/higgsfield-api), [V help](https://higgsfield.ai/creator-hub/help-center/integrations/what-is-the-higgsfield-api). Whether Soul ID works on this newer API: not verified |
| **Black Forest Labs** FLUX 3 Image / Klein | Generate and image-to-image | BFL API | $0.048 (1K), $0.07 (2 MP), $0.10 (4 MP), $0.607 (16 MP); Klein $0.009–0.036 | 16 MP | [V](https://bfl.ai/pricing) |
| BFL FLUX.2 [pro] / [max] / [flex] | Generate and edit with up to 8 references (API) | BFL API, aggregators | [pro] $0.03 first MP + $0.015 per extra MP and per reference MP; [max] $0.07 + $0.03; [flex] $0.05/MP | 4 MP | [V prices](https://bfl.ai/pricing), [V overview](https://help.bfl.ai/articles/9364115800-flux-models-overview) |
| BFL FLUX.1 Kontext [pro]/[max], **Fill [pro]**, VTO tool, FLUX 3 Video | Instruction edit; **true mask inpainting** (Fill); garment try-on; video | BFL API | Kontext $0.04 / $0.08; Fill $0.05; VTO from $0.0375; FLUX 3 Video $0.15/s HD, $0.24/s FHD, draft $0.06/s | — | [V](https://bfl.ai/pricing) |
| Adobe Firefly APIs | Generate, fill, expand, image to video; custom models not verified | Enterprise ("Operations" metering); no public per-call price found | not public | not verified | [V](https://helpx.adobe.com/legal/product-descriptions/adobe-firefly.html) |
| Midjourney | Image, video, character/omni reference in the app | **No API.** Terms: no "automated tools" | subscription | — | [V ToS, 27 May 2026](https://docs.midjourney.com/docs/terms-of-service) |
| Ideogram 4.0 (4.5 and 4.6 exist) | Generate, edit, a character-consistency feature | API | $0.03 / $0.06 / $0.10 (Turbo / Default / Quality) | 2K | [V](https://ideogram.ai/models/4.0/); 4.5 seen on Runway's list at $0.04–0.25 [V](https://docs.dev.runwayml.com/guides/pricing/) |
| Runway (own: Gen-4.5, Gen-4 Turbo, Aleph 2.0, Act-Two, Gen-4 Image with references) | Image to video, video edit, reference image generation; also resells Kling, Seedance, Wan, Veo, Omni, Nano Banana, GPT Image, Seedream | API, $0.01 per credit | Gen-4.5 $0.12/s; Gen-4 Turbo $0.05/s; Aleph 2.0 $0.28/s; Gen-4 Image $0.05 (720p) / $0.08 (1080p); Omni Flash 1.2 $0.07/s at 720p | — | [V](https://docs.dev.runwayml.com/guides/pricing/) |
| Kling (4.0, 4.0 Flash, 3.0, 3.0 Omni, 2.6, 2.5 Turbo) | Text/image/reference to video, motion control | Official API | 4.0: $0.157/s (720p), $0.235/s (1080p), $0.549/s (4K); 3.0 no audio: $0.084 / $0.112 / $0.42; 2.6 and 2.5 Turbo: $0.042 / $0.07 | 4K | [V](https://kling.ai/document-api/pricing/base/video.md) |
| Luma Ray3.2 / Ray3.14 | Text/image to video, video to video, HDR | API exists; dollar API rates not on the page I opened (credits only: 720p 100 credits per 5 s) | not verified | 1080p | [V](https://lumalabs.ai/pricing.md) |
| Recraft V4.1 | Generate, style from 1–10 refs, vector | API | from $0.035 raster, $0.08 vector; Flash $0.007 | 2K ("pro") | [V](https://www.recraft.ai/docs/api-reference/models/overview) |
| Krea 3 | Generate with references; resells others | API | $0.03 (1K), $0.06 (2K), +$0.02 per 1K reference | 2K | [V](https://www.krea.ai/app/api/pricing) |
| fal (aggregator) | One key, many models, plus GPUs for open pipelines | API | Nano Banana Pro $0.15, Kling v3 Pro $0.14/s, H100 $4.50/h list | — | [V](https://fal.ai/pricing) |
| FASHN | Garment try-on, product-to-model, model create, face-to-model, image to video | API, $0.075 per credit | Try-on 1 credit; Try-On Max / product-to-model 1–5 credits by mode and size; +3 credits for a face reference; video 5 s 1/3/6 credits | 4K | [V docs](https://docs.fashn.ai/llms-full.txt), [V pricing](https://help.fashn.ai/plans-and-pricing/api-pricing). Jewelry is not mentioned |
| Stability, Pika, Replicate, Seedream (ByteDance) | — | APIs exist | **Not verified this session.** Seedream 5.5 seen only on Runway's list at $0.02–0.04 [V](https://docs.dev.runwayml.com/guides/pricing/) | — | [E] none of these changes the recommendation |

Rate limits: only Higgsfield's (20 concurrent requests) was found published [V]. Google, OpenAI and BFL limits depend on the account tier and were not verified.

**Jewelry-specific and try-on products.** I found no API product that claims CAD-true on-model jewelry.
- A July 2026 roundup of ten try-on APIs lists none for jewelry, watches or accessories; all are garment models [V fal](https://fal.ai/learn/tools/best-virtual-try-on-apis-2026).
- Jewelry photo tools (Melius, Claid, Pixelcut, Photta, Flair, Photoroom): Claid's "Precise" mode locks the product but cannot put it on a person; Melius layers the real asset over a generated scene; the rest regenerate the product. This comes from a vendor's own comparison, so weigh it accordingly [V Melius](https://www.melius.com/blog/best-ai-tools-jewelry-product-photos).
- AR try-on vendors (Perfect Corp, mirrAR and others) are closed shopper SDKs [S, from research 04]; not re-verified.

### 2.2 Licence, data, provenance, safety

| Vendor | Who owns outputs / commercial use | Trains on your data | Indemnity | Provenance on outputs | Filters you cannot switch off | Evidence |
|---|---|---|---|---|---|---|
| Google (Gemini API, paid) | Google "won't claim ownership"; similar content may be generated for others | No on paid; yes on the free tier. EEA/UK/CH users must be served from paid | None in the Gemini API terms. Google Cloud indemnifies generally available Gemini, Imagen and Veo models through the Agent Platform API; the AI Studio route is not listed | SynthID in every image and video. C2PA: announced for Nano Banana Pro in the Gemini app, Vertex and Google Ads (Nov 2025); for the Gemini API it is **not verified** | Prompt and output safety filters; thinking cannot be disabled; image-to-video accepts adults only; uploads showing minors unsupported in EEA/CH/UK; "certain recognizable people" refused | [V terms, 23 Mar 2026](https://ai.google.dev/gemini-api/terms), [V indemnified list, 20 Jul 2026](https://cloud.google.com/terms/generative-ai-indemnified-services), [V C2PA post](https://blog.google/technology/ai/ai-image-verification-gemini-app/), [V Veo](https://ai.google.dev/gemini-api/docs/veo.md.txt), [V Omni](https://ai.google.dev/gemini-api/docs/omni.md.txt), [V policy](https://policies.google.com/terms/generative-ai/use-policy?hl=en_IN) |
| OpenAI (API) | Customer "owns all Output" | Not unless you opt in | The services agreement indemnifies the Services, and excludes Customer Content (which includes Output); separate service-specific terms not read | Images carry C2PA and a SynthID watermark; a check endpoint exists (`/v1/content_provenance_checks`) | All prompts and images filtered; `moderation` can only be `auto` or `low` | [V agreement, 1 Jan 2026](https://openai.com/policies/services-agreement/), [V provenance](https://developers.openai.com/api/docs/guides/content-provenance), [V guide](https://developers.openai.com/api/docs/guides/image-generation.md) |
| Higgsfield | You keep outputs; commercial use allowed | **May train on your content**; stop by deleting it; enterprise content excluded | Enterprise plan only | Not verified | Not verified. You may not use an image of another person without permission | [V](https://higgsfield.ai/creator-hub/help-center/account/who-owns-my-generations-and-can-i-use-them-commercially) |
| BFL | API terms not opened. Open weights: only FLUX.2 [klein] 4B is Apache-2.0; klein 9B, FLUX.2 [dev], Kontext [dev] are non-commercial without a paid licence | not verified | not verified | C2PA per research 04 [S] | Moderated outputs are not charged, so a filter exists | [V](https://help.bfl.ai/articles/9364115800-flux-models-overview), [V](https://bfl.ai/pricing) |
| Adobe Firefly | — | not on the page | Yes for Firefly features including the APIs; excludes non-Adobe models and betas | C2PA applied automatically on export | Adobe may block inputs | [V](https://helpx.adobe.com/legal/product-descriptions/adobe-firefly.html) |
| Midjourney | You own assets; a company over $1M revenue needs Pro or Mega | broad licence to Midjourney | You indemnify them | — | Needs permission from anyone depicted | [V](https://docs.midjourney.com/docs/terms-of-service) |
| FASHN | not on the pages read | No, unless you opt in | — | — | `ContentModerationError`; a `moderation_level` setting on some endpoints | [V](https://docs.fashn.ai/llms-full.txt) |

**Corrections to research 04** (all [V] above): Veo and Imagen are gone from the Gemini API; Sora is gone entirely; FLUX 3 exists and Kontext is still sold; Nano Banana 2.1's price and ID are confirmed; GPT Image 2.6 IDs are confirmed but "16 references per request" is not on OpenAI's page; Higgsfield does have a pay-per-use API with a character object; "C2PA on Vertex" for Google is confirmed only for Nano Banana Pro.

## 3. Identity-consistent brand models

### 3.1 Methods and how well they hold

| Method | How it works | Face | Hands | Body | Portability | Notes |
|---|---|---|---|---|---|---|
| **Multi-reference conditioning** | Send the frozen canonical views with every request | Good with 3–5 face views. Google documents "character resemblance" for up to 4 (2.1) or 5 (Pro) characters [V](https://ai.google.dev/gemini-api/docs/image-generation.md.txt) | Fair: skin tone and nail shape follow; veins, knuckle lines and moles drift [E] | Fair | **High**: any vendor that takes references | The v2 default. OpenAI warns recurring characters may not stay consistent [V](https://developers.openai.com/api/docs/guides/image-generation.md) |
| **Model sheet** (one image with canonical views) | Front, three-quarter, profile, both hands, ear, neck on one neutral sheet; used as a single reference | Helps a model that takes few references | Helps | Helps | High | Costs one reference slot instead of six; lower resolution per view [E] |
| **Vendor character feature** | Higgsfield Soul ID: train on 20–80 photos, a few minutes, $2.50; Ideogram character reference; Kling/Veo/Omni subject references for video | Higgsfield's own wording: expect "clearly the same person", not a pixel-identical face [V](https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-create-and-use-a-soul-id-character) | Not claimed | Not claimed | **None**: the trained identity cannot be downloaded [V, same page] | Higgsfield suggests generating portraits first, then training on them, for an invented person |
| **Fine-tune / LoRA** (FLUX family, on BFL, fal or own GPU) | Train on 20–40 curated images | Highest at volume [E] | Can learn the hand if hands are in the set [E] | Good | Tied to one model family; retrain on each upgrade | BFL's fine-tuning is in beta, billed at base-endpoint rates; rights for open weights need a paid licence tier [V](https://docs.bfl.ai/quick_start/pricing.md), [V](https://bfl.ai/pricing) |
| **Identity embeddings** (InstantID, PuLID, IP-Adapter FaceID) | Inject a face embedding | Good faces | No | Weak | Open pipelines only | Depend on InsightFace models, which are non-commercial without a licence [S, research 04]. Keep out of the default path |

Third-party ranking of "reference adherence" (a vendor's blind-vote arena, September 2026): Seedream 5.0 Pro and GPT Image 2 lead, Nano Banana Pro is mid-table, FLUX.2 Pro is last. One man, three shots; no anatomy test [V OpenArt](https://openart.ai/blog/which-ai-image-model-gets-faces-and-hands-right/). Treat as weak evidence.

### 3.2 Creating a model that is not a real person

1. **Text-only identity** (already in the plan): a card with an adults-only age enum, Monk tone, undertone, hair, eyes, marks, build. No uploaded face. Screen card text for names.
2. **Generate the face**, human picks, then generate the remaining views conditioned on the kept face (the plan's flow). Add the hand, ear and neck views that jewelry needs: both hands back and palm, a relaxed ring pose, each ear with hair tucked, neck and collarbone.
3. **Check it does not resemble a real person.** There is no reliable automatic test.
   - A vision model will not identify faces (the plan already rejects this gate).
   - A face-embedding search needs a gallery of real faces, which means processing biometric data of real people. OpenAI's policy bans facial recognition databases without consent [V](https://openai.com/policies/usage-policies/), and Google's bans using biometrics without legally required consent [V](https://policies.google.com/terms/generative-ai/use-policy?hl=en_IN). Do not build one.
   - What is left: (a) never put a name, a celebrity or "looks like" in a prompt; (b) reject a face the approver recognises; (c) ask the approver to run a reverse image search on the kept face and tick a box saying they did; (d) record all of it. Call it a recorded human check, not a guarantee.
4. **Freeze and version.** Store the canonical images, the recipe (provider, model ID, prompts, seed where the API gives one), the approver, the attestation and the reverse-search tick. A re-approval bumps `version` and makes shots stale (already in the schema).

### 3.3 Storing and reusing

- Keep the canonical set as Pavé assets, not as a vendor object. A Soul ID or a LoRA is an optional per-provider "identity handle" stored beside the set, never the source of truth.
- Send only the views a shot needs: hand shots get hand references plus one face-free skin reference. Fewer references leave more model attention for the piece [E].
- **Drift check on every shot.** Compare the result with the canonical set: a vision-model check on tone, marks and nails, plus an embedding similarity on the face when a face is visible. AuraFace is Apache-2.0 and trained for commercial use, but separates people less cleanly than InsightFace's model (strangers score up to 0.42 against a true-match median of 0.55), and its bundled detector comes from InsightFace's zoo [V](https://mixpeek.com/models/auraface-v1.md). Use it as a soft signal, and only on the synthetic model's own images.

### 3.4 Hands, ears, neck, wrist

- **Hands.** I found no measured anatomy failure rate for current models. HandEval (2025) builds a hand-quality scorer but reports no per-model defect share [V](https://arxiv.org/html/2510.08978v1). A vendor article repeats a 2025 figure that close to half of images had distortions and says it applies to older models [V](https://openart.ai/blog/which-ai-image-model-gets-faces-and-hands-right/). My estimate for 2026 models: clear finger-count errors in a few percent of single-hand close-ups, more when hands interlock or hold something [E, from general use; must be measured].
- **What to control:** nail length, shape and polish; skin tone and undertone; knuckle wrinkles and veins (age cue); hair on the forearm; which finger; left or right. Put them on the model card and in the hand reference views.
- **Automatic anatomy checks:** a hand-landmark model must find one hand with 21 landmarks and five separated fingertips (MediaPipe, Apache-2.0 [E]); the vision checklist asks for finger count, joint direction, nail on every visible fingertip.
- **Ears:** hair across the lobe hides or half-hides studs; ask for hair tucked behind the ear and check the lobe is visible. **Neck:** chains need drape over collarbones; a rigid render pasted on skin looks wrong, so chains stay generative ("concept") until a drape simulation exists. **Wrist:** bangles and cuffs are rigid and fit the render-first route; flexible bracelets do not.

## 4. Fidelity to the CAD

### 4.1 Route (a): composite a true render

**Render-first (recommended).** Build the scene ourselves, so nothing has to be estimated.
1. **Proxy.** For a ring: a tapered cylinder whose diameter comes from the model card's ring size, plus neighbouring-finger cylinders so occlusion and bounce light exist. For a bangle: an elliptical wrist. For a stud: a lobe-shaped pad. Give the proxy a skin-coloured material from the card's Monk tone so polished metal reflects skin, not grey.
2. **Render passes** from the same camera: beauty of the piece, an alpha mask, a shadow and contact-occlusion pass on the proxy, and the proxy's silhouette. Blender for final quality; the browser engine for the preview tier.
3. **Paint the person.** Send the proxy render and the model's references. Prompt: replace the mannequin hand with this model's hand in exactly this pose; keep the ring unchanged; light from the same side as the render.
   - Nano Banana Pro: no mask upload, so the instruction and the base image carry it [V](https://ai.google.dev/gemini-api/docs/image-generation.md.txt).
   - GPT Image 2.6 Sunburst: mask or markup layer as guidance [V](https://developers.openai.com/api/docs/guides/image-generation.md).
   - FLUX.1 Fill [pro]: a real inpainting mask, $0.05 [V](https://bfl.ai/pricing). Worth a third key if the first two move the hand.
4. **Pixel lock.** Paste the beauty render back through its alpha, eroded by 1–2 px and feathered 2–4 px. Multiply the rendered shadow pass onto the generated skin if the model did not paint a contact shadow.
5. **Edge pass (optional).** One low-strength edit limited to a band around the piece for skin bulge and tiny shadows. Then pixel-lock again.

Quality: stones, prongs and engraving are exact; fit is exact for rigid pieces; the weak points are the generated skin drifting off the proxy (a floating or sunken ring) and light mismatch. Cost: one or two image calls plus a local render. Failure modes: the model re-poses the hand; fingers that should cross in front of the piece are not painted in front (handle with a proxy occluder mask so the paste-back excludes them); skin tone of the proxy differs from the painted skin, so reflections in the metal look off; dead-looking diamonds if the render's lighting is too flat (use the studio HDRI from the Render stage, not an estimated one).

**Fit-to-photo (second mode, later).** Start from an existing photo or plate; estimate hand pose, depth and light; pose the CAD to match. Building blocks and their licences:

| Need | Option | Licence | Evidence |
|---|---|---|---|
| Hand mesh model | MANO | **Non-commercial only**; commercial via Max Planck / Meshcapade | [V](https://mano.is.tue.mpg.de/license.html) |
| | Meshcapade hand model, SMPL body | Commercial: hand €600/yr (micro company) or €10,000/yr (SME); SMPL €1,500 / €25,000 | [V](https://meshcapade.com/assets/body-models) |
| | Meta MHR rig via SAM 3D Body | SAM License; a mirror's summary says commercial use is permitted; its bundle includes an AGPL detector that must be swapped | [V mirror page](https://huggingface.co/Blendcap/sam-3d-body); read Meta's licence text before relying on it |
| Hand pose from a photo | WiLoR | Weights CC BY-NC-ND and needs MANO: not usable | [V](https://github.com/rolpotamias/WiLoR) |
| | MediaPipe landmarks | Apache-2.0 [E]; joints only, no finger girth | — |
| Depth | Depth Anything 3 | `DA3METRIC-LARGE`, `DA3MONO-LARGE`, Base, Small are Apache-2.0; Giant, Large and Nested are CC BY-NC | [V](https://raw.githubusercontent.com/ByteDance-Seed/Depth-Anything-3/main/README.md) |
| Relighting | IC-Light | Repository is Apache-2.0; weights' terms not confirmed on the page; its suggested background remover is non-commercial | [V](https://github.com/lllyasviel/IC-Light) |

A 2-degree axis error or a 5% width error shows on a ring (research 04's point stands). Fit-to-photo is harder and needs a licensed hand model; it should not be in v2.

### 4.2 Route (b): generative editing with the render as a reference

What the evidence says:
- **ProductConsistency** (June 2026): 174 product images, 870 edits. Even the best closed editor had non-zero text error; segmented DINO similarity between the edited product and the original was 0.70 (Nano Banana), 0.78 (GPT-Image-1 High), 0.81 (FLUX.1 Kontext dev). Rewarding visual similarity alone made a model copy the input instead of editing it [V](https://arxiv.org/pdf/2606.19103). Those were 2025-generation models and packaged goods, not jewelry.
- **HiFi-Inpaint** (March 2026): for person-with-product images, an instruction editor (FLUX Kontext) scored 63 on DINO product similarity against 92 for a reference-inpainting method with a high-frequency detail loss [V](https://arxiv.org/pdf/2603.02210).
- **Jewelry try-on research.** "Shining Yourself" (CVPR 2025) handles rings, bracelets, earrings and necklaces at 512 px; its stated limits are weaker specular highlights, wrong orientation that hides the featured part, and necklaces as the hardest class; no code licence stated [V](https://arxiv.org/html/2503.16065v1). "JewelTry" (September 2026) adds a scale token and a benchmark with real product sizes, and makes scale accuracy a metric [V](https://arxiv.org/abs/2609.16626v1). Neither is a product you can call.
- **Vendors' own words.** Google tells users to describe critical details in depth to preserve them [V](https://ai.google.dev/gemini-api/docs/image-generation.md.txt). A jewelry-photo vendor reports prong counts changing, claw settings read as bezels, drifting stone placement, blurred chains and flattened domes [V Melius](https://www.melius.com/blog/best-ai-tools-jewelry-product-photos).

| Usually kept [E] | Often changed [E] |
|---|---|
| Metal colour, overall silhouette, centre stone shape and colour, piece type | Prong count, melee count and row count, gallery and under-bezel detail, milgrain, engraving text, band width and taper, stone size relative to the finger |

Quality: attractive, often convincing, not reliable. Cost: one call. Failure mode: a plausible different ring. This route stays, as today, "AI · Concept".

### 4.3 Route (c): hybrids

1. **Placeholder then replace.** Generate the model wearing "a plain band of this size", locate it, render the CAD at that pose, paste. It needs pose recovery from the generated picture (fit-to-photo's problem). For a ring, the band's ellipse gives the axis and scale without a hand model: fit an ellipse to the placeholder's two visible edges [E]. Workable for plain shots, fragile when fingers occlude.
2. **Render-first with a generative contact band** (section 4.1 steps 4–5). This is the recommended hybrid.
3. **Generate, then repair only failed details** with a masked edit. This does not converge: every edit can change something else [E].

| Route | Fidelity | Fit and contact | Cost per attempt | Main failure | Claim allowed |
|---|---|---|---|---|---|
| (b) generative with references | Low to medium | Looks natural | 1 image call | A different design | "AI · Concept" |
| (c1) placeholder then replace | Exact pixels | Medium | 1 call + render | Wrong pose solve | "Composite" after the gate |
| **(c2) render-first + contact band** | **Exact pixels** | **Good for rigid pieces** | 1–2 calls + render | Hand drifts off the proxy | "Composite" after the gate |
| (a) fit-to-photo | Exact pixels | Depends on the fit | Render + estimation models | Floating or sunken piece | "Composite" after the gate |

### 4.4 Which pieces fit which route

| Piece | v2 route | Why |
|---|---|---|
| Ring, signet, band | Render-first | Rigid; a finger is a cylinder at a known size |
| Stud, huggie | Render-first | Rigid; small contact area; hair is the risk |
| Bangle, cuff | Render-first | Rigid; an elliptical wrist |
| Drop earring | Render-first with gravity-aligned pose | Rigid parts hang; fix the tilt in the scene |
| Pendant on chain, necklace, flexible bracelet | Generative concept only | Needs drape; no body mesh in v2 |

### 4.5 Checking fidelity automatically

**Stage 1, deterministic (composite shots).**
- Pixel lock held: structural similarity between the final image and the beauty render inside the eroded mask. Try ≥ 0.98; lower means the pipeline broke, not the model.
- The hand did not move: segment skin in the final image and compare with the proxy silhouette in a band around the piece. Try IoU ≥ 0.85 in the band; finger width at the ring within ±4% of the proxy.
- No uncovered gap: no background-coloured pixels between piece and skin inside the contact band.

**Stage 2, measured (generative shots, and as a second look at composites).**
- Segment the jewelry in the output (text-prompted detector plus a segmenter, as ProductConsistency and AdSpark do [V](https://arxiv.org/pdf/2606.19103), [V](https://arxiv.org/pdf/2610.10047)), align it to the CAD reference render by a similarity transform, then:
  - silhouette IoU: try ≥ 0.90 for rings, ≥ 0.85 for earrings; skip for chains;
  - hero stones: count must be exact; shape class must match;
  - melee: do not count; compare row count and covered-area ratio within ±10% (the plan's "coverage" rule);
  - scale: piece width over finger width within ±6% of what the ring size and CAD say;
  - embedding similarity of the crop to the render (DINO-class) as a soft score only; published editors land at 0.70–0.81 on a similar metric, so a hard threshold there would be noise.
- Perceptual metrics (LPIPS, SSIM-HF from HiFi-Inpaint) work only after alignment and only as soft signals [E].

**Stage 3, vision-model checklist.** Give the judge the CAD reference crop, the output crop and the expected facts from `design.evaluate`. Ask closed questions, one finding each: hero stone count; stone shape; setting type; prong count on the hero; metal colour; band profile; engraving present and legible; piece on the intended finger or ear; scale plausible; finger count; no extra jewelry; nothing covering the piece. Any "no" on a hard item fails the shot. The judge is the last check, not the first: it cannot count pavé and it misses small proportion changes.

**Stage 4, safety** (section 6.2) runs on every output before it is shown as passed.

Every threshold above is a starting value [E]. Fix them with a labelled set: 50 CAD pieces, each with known-good and deliberately wrong outputs (one prong removed, one stone added, 8% scale error), and tune until the gate rejects the wrong ones.

## 5. Video

**What exists.** Image to video from the approved still: Omni Flash 1.1 (Gemini key; first and last frame, image references) [V](https://ai.google.dev/gemini-api/docs/omni.md.txt); Veo 3.1 on Agent Platform (start and end frame, up to three asset references of one person or product, 8 s needed for 1080p) [V](https://ai.google.dev/gemini-api/docs/veo.md.txt); Kling, Seedance, Wan, DoP through Higgsfield's key [V](https://higgsfield.ai/blog/higgsfield-api); Runway Gen-4.5; FLUX 3 Video. OpenAI: nothing.

**How badly detail drifts.**
- ConsID-Gen (CVPR 2026): image-to-video loses object identity as the viewpoint changes, with shape warps, merged parts and changing textures; even a strong open model drops about five points on their identity metric from text-to-video to image-to-video [V](https://arxiv.org/html/2602.10113).
- AdSpark (October 2026), product-centred ad video: the best closed models scored about 58–63 on product consistency and 54–60 on key regions such as logos, out of 100 on DINOv3 similarity; text fidelity was 34 at best. The authors blame motion blur, shape distortion and appearance drift under complex motion [V](https://arxiv.org/pdf/2610.10047).
- For jewelry, expect prongs to merge, facets to swim and melee to shimmer as noise within the first second of any rotation [E, consistent with both papers].

**Options to keep the piece true.**

| Option | How | Fidelity | Effort |
|---|---|---|---|
| Short, slow move | 3–5 s, slight push-in or a breath of hand motion, no rotation of the piece; give the approved still as both first and last frame so the clip must return to it | Concept only; drift is smaller, not zero | Low: one call |
| 2.5D still | Animate the approved composite still with a depth-layer parallax and a light sweep rendered by our own engine | Exact (it is the still) | Medium; no vendor |
| Locked camera, moving light | Blender renders the piece over the proxy under a moving light; the plate is the still | Exact piece, static model | Medium |
| Tracked composite | Generate a plate clip with the proxy or a placeholder, track the finger segment per frame, render the CAD per frame with holdout masks, composite | Exact piece on a moving model | High; a v3 item |

Check a generated clip by running the still gate on sampled frames (first, middle, last) and tracking the jewelry mask's area and centroid for jumps, as AdSpark's stability metric does [V](https://arxiv.org/pdf/2610.10047). A clip that fails is labelled concept or dropped; it never becomes "composite".

**Durations, sizes, prices** are in the table in section 2.1. For the cost of a 5-second clip see section 7.

## 6. Safety and law (practical; not legal advice)

### 6.1 Rules Pavé should enforce itself

| Rule | How |
|---|---|
| No nudity or sexualised output | Fixed wardrobe vocabulary on the card (no free-text clothing for neck and body shots); prompt screen; output moderation; provider filters stay on (`moderation: auto`) |
| No minors | Adults-only age enum (already in the schema); never accept "young", "teen", "girl", "boy" in card or direction text; vision check for apparent age on every portrait and shot; reject and log |
| No real person's likeness without consent | Text-only identity by default; no face uploads in v2; name screen on text; recorded human reverse-search step (section 3.2) |
| No celebrity lookalikes | Name and "looks like" screen; approver attests |
| Honest product picture | The fidelity gate; generative shots always carry "AI · Concept"; only gated composites export as on-model product images |

**If a brand later wants a real model's likeness,** keep a consent record with the model: a signed written consent; a reasonably specific description of the uses (media, territories, term, AI generation and editing named); pay; approval and withdrawal rights; proof of age 18 or over; hashes of the reference photos; who verified identity; and a note of whether the person had a lawyer or union representative. California and New York make digital-replica contract terms unenforceable when the uses are not specifically described and the person was not represented; Tennessee bans using a likeness in advertising without consent [V MoFo](https://www.mofo.com/resources/insights/250922-digital-avatars-deep-dive-series-navigating). Higgsfield and Midjourney also require the depicted person's permission in their terms [V](https://higgsfield.ai/creator-hub/help-center/account/who-owns-my-generations-and-can-i-use-them-commercially), [V](https://docs.midjourney.com/docs/terms-of-service). The federal NO FAKES Act was reintroduced in April 2025; its status today was not verified.

### 6.2 Moderation tools

- **OpenAI `omni-moderation-latest`**: free; text and images; image categories are sexual, violence and self-harm. **`sexual/minors` is text-only**, so it cannot judge apparent age in a picture [V](https://developers.openai.com/api/docs/guides/moderation.md). Good for screening prompts and for a nudity check on outputs.
- **Apparent age and wardrobe**: a vision-model question in the judge call ("does any person appear under 18?", "is the person clothed as specified?"). Treat "unsure" as a fail.
- **Provider filters**: Google and OpenAI filter prompts and outputs and cannot be fully disabled (section 2.2). A blocked request must surface as a clear, non-retried error.
- Google Cloud Vision SafeSearch, AWS Rekognition and Hive exist as paid alternatives; not verified this session.

### 6.3 Provenance: C2PA and SynthID

- **What arrives from providers.** Google: SynthID in every image and video; C2PA confirmed for Nano Banana Pro on some surfaces [V](https://blog.google/technology/ai/ai-image-verification-gemini-app/). OpenAI: C2PA plus SynthID on images, with a public check endpoint [V](https://developers.openai.com/api/docs/guides/content-provenance). Metadata is lost on re-encode, crop or screenshot; the watermark survives some of that [V, same page].
- **A composite breaks the chain.** Pasting our render and re-encoding drops the provider's manifest and may weaken its watermark. So Pavé must mark its own exports. The plan's rule (keep originals untouched, export labelled copies) stays right.
- **Signing our own.** The C2PA Rust SDK (`c2pa-rs`) is MIT or Apache-2.0, implements a subset of spec 2.4 and has a C API [V](https://raw.githubusercontent.com/contentauth/c2pa-rs/main/README.md). A manifest signed with any certificate is technically valid, but validators only show it as trusted if the product passed the C2PA conformance programme and holds a claim-signing certificate from a CA on the C2PA trust list [V DigiCert, Aug 2026](https://www.digicert.com/blog/why-c2pa-signing-requires-more-than-an-sdk). For a small company that is a later step.
- **What to do now.** Always write IPTC `DigitalSourceType` in XMP (sharp can; the plan has this). Google Merchant Center requires that tag to be present and kept, and recognises `TrainedAlgorithmicMedia`, `CompositeSynthetic` and `AlgorithmicMedia` [V](https://support.google.com/merchants/answer/14743464?hl=en). Use the trained-algorithmic value for generative shots and a composite value for render-locked shots (check the exact IPTC term when implementing [E]). Keep a server-side provenance record. Add C2PA signing behind `capabilities.c2pa` with the provider's output listed as an ingredient.
- **What platforms show.** Meta said in June 2026 it will detect ads made with third-party AI tools from "industry-standard signals" and label them [V](https://about.fb.com/news/2025/02/gen-ai-transparency-metas-ads-products/). What LinkedIn, TikTok and YouTube display from C2PA was not verified this session.

### 6.4 Disclosure and labelling rules

| Where | Rule | Effect on Pavé | Evidence |
|---|---|---|---|
| EU | AI Act Article 50 transparency duties apply from **2 Aug 2026**. A code of practice (10 Jun 2026) and guidelines exist. Providers mark outputs machine-readably (signed metadata plus invisible watermark); systems already on the market had until **2 Dec 2026**. Deployers label deepfakes visibly at first exposure; an EU icon satisfies it. Fines up to €15M or 3% | Exports need machine-readable marks and an optional visible label. Whether a fully invented model in an ad is a "deepfake" is not settled by what I read; advertising rarely gets the creative-work exemption | [V Commission](https://digital-strategy.ec.europa.eu/en/news/commission-publishes-code-practice-marking-and-labelling-ai-generated-content), [V Faegre Drinker](https://www.faegredrinker.com/en/insights/publications/2026/7/eu-ai-act-commission-confirms-transparency-code-of-practice-as-adequate-and-publishes-final-version-of-its-guidelines-on-transparency-obligations) |
| New York | GBL §396-b: an advertiser who knows an ad contains a "synthetic performer" (an AI-made human not recognisable as a real performer) must conspicuously disclose it. $1,000 first violation, $5,000 after. Audio ads and the media carrying the ad are exempt. In effect June 2026 | A brand model in an ad is exactly this. Offer a visible "AI-generated model" label preset | [V statute](https://www.nysenate.gov/legislation/laws/GBS/396-B); effective date from [V Quartz](https://qz.com/amazon-sellers-label-ai-generated-people-product-images-072426) |
| California | AI Transparency Act as amended by SB 1000 (30 Sep 2026): the one-million-user threshold is gone; a provider of a public generative system must embed a permanent latent disclosure. Platform duties from 1 Jan 2027 | Whether a tool that calls third-party models is a "covered provider" is open; ask counsel | [V MoFo](https://www.mofo.com/resources/insights/261001-california-revamps-ai-transparency-requirements) |
| US federal | No rule requires a label just because an image is AI-made. The FTC acts on deception and unsupported claims | A wrong ring in an ad is a product-misrepresentation risk whatever the label says | [V Holland & Knight, Aug 2026](https://www.hklaw.com/en/insights/publications/2026/08/a-look-at-the-ftcs-current-approach-to-ai-regulation) |
| India | IT Rules amendment notified 10 Feb 2026, in force 20 Feb 2026: synthetic content that appears real must carry a prominent visible label (the draft's 10% size rule was dropped) and permanent metadata where feasible; large platforms must ask uploaders to declare it | Duties fall on intermediaries and platforms; a brand's upload will be declared and labelled there. Offer the label | [V Nishith Desai](https://www.nishithdesai.com/research-and-articles/hotline/technology-law-analysis/deepfakes-disclosure-and-due-diligence-unpacking-indias-sgi-amendments-15532) |
| Meta ads | "AI info" label; shown next to "Sponsored" when an AI-generated photorealistic human is present; third-party tools detected from signals | Keep metadata intact; expect the label | [V](https://about.fb.com/news/2025/02/gen-ai-transparency-metas-ads-products/) |
| TikTok ads | Fully AI-generated or significantly AI-edited content is allowed only with TikTok's label or the advertiser's own clear disclaimer; otherwise the ad is rejected or restricted. No private person's likeness without permission | Label preset | [V](https://ads.tiktok.com/help/article/tiktok-ads-policy-misleading-and-false-content) |
| Google Merchant Center | AI images allowed, including the main image, if the IPTC source-type tag is present and kept | Write the tag; never strip it | [V](https://support.google.com/merchants/answer/14743464?hl=en) |
| Amazon | Since July 2026 sellers must tag images and A+ content that show photorealistic AI-generated people; Amazon plans a visible marker | Publishing kit must carry the tag and tell the seller | [V Quartz](https://qz.com/amazon-sellers-label-ai-generated-people-product-images-072426); Amazon's own page not opened |
| Etsy | Guidelines of 22 Oct 2026: every listing needs at least one unedited photo of the actual item on a real background; other images may be AI-edited; all must represent the item accurately | An on-model image can only be a supplementary picture. Matches `requires: ['realPhoto']` in the publishing plan | [V Digital Commerce 360](https://www.digitalcommerce360.com/2026/10/26/etsy-ai-policy/amp/); Etsy's page not opened |
| Shopify | Acceptable use policy says nothing specific about AI images; fraud is banned | The merchant's own market law applies | [V](https://shopify.com/legal/aup) |
| YouTube | Disclosure of altered or synthetic content exists | Not opened | [S](https://support.google.com/youtube/answer/14328491) |

## 7. Cost model (estimates on verified list prices, 25 Nov 2026)

Assumptions [E]: 2K output; six reference images in; one vision-judge call per attempt at about $0.03 (metered to `llm`; depends on the Claude tier); CAD renders cost nothing extra beyond the render allowance. Acceptance rates are guesses to be replaced by the spike: generative route 35–40% for a solitaire, far lower for pavé; render-first composite 60–70% (failures are anatomy or a drifted hand, not the piece).

| Route | Per attempt | Acceptance [E] | **Per accepted still** |
|---|---|---|---|
| Concept, Nano Banana 2.1 | $0.05 image + $0.01 inputs + $0.03 judge ≈ $0.09 | 35% | ≈ $0.26 |
| Concept, Nano Banana Pro | $0.134 + $0.01 + $0.03 ≈ $0.17 | 40% | ≈ $0.43 |
| **Composite, Pro plate + 2.1 edge pass** | $0.134 + $0.05 + $0.01 + $0.03 ≈ $0.22 | 65% | **≈ $0.34** |
| Composite, GPT Image 2.6 Sunburst at high quality | $0.10–0.20 + $0.03 | 60% | ≈ $0.25–0.40 |
| Composite, FLUX.1 Fill [pro] plate | $0.05 + $0.03 | 60% | ≈ $0.13 |
| Higgsfield Soul 1080p (concept only) | $0.19 + $0.03 | 35% | ≈ $0.63 |

Plan on **$0.30–0.70 per accepted still** and cap a shot at three attempts (about $0.70 worst case on the default route). One-time per brand model: a face pick of four candidates plus about eight canonical views on Nano Banana Pro ≈ $1.60; a Soul ID, if wanted, $2.50 [V prices above].

| 5-second clip | Price | With retries [E, 25–35% kept] |
|---|---|---|
| Omni Flash 1.1, 720p / 1080p | $0.51 / $0.76 | ≈ $1.50–3.00 |
| Veo 3.1 Fast, video only, 1080p (Agent Platform; 1080p may force 8 s ≈ $0.80) | $0.50 | ≈ $1.50–3.20 |
| Kling 2.6 / 3.0 / 4.0 at 1080p, no audio | $0.35 / $0.56 / $1.18 | ≈ $1.00–4.70 |
| Runway Gen-4 Turbo / Gen-4.5 | $0.25 / $0.60 | ≈ $0.75–2.40 |
| Higgsfield DoP Lite / Standard | $0.125 / $0.56 | ≈ $0.40–2.20 |
| 2.5D still or moving-light render (our engine) | render time only | $0 vendor cost |

## 8. What this means for the plan (inputs for `docs/plans/brand-models-v2.md`)

**Pipeline.** Extend `SHOT_STAGES` from `references → generate → verify → label` to: `scene` (pose CAD on proxy, render beauty, mask, shadow, proxy silhouette) → `plate` (paint the model around it) → `lock` (paste back, shadow multiply) → `edge` (optional contact band, then lock again) → `verify` (deterministic, measured, checklist, safety) → `label`. `fidelity: 'concept'` keeps today's shorter path. `fidelity: 'composite'` is allowed only for rings, studs, huggies, bangles, cuffs and gravity-posed drops.

**Build first.**
1. Proxy library and scale from the model card (ring size, wrist, lobe) in `packages/render`; needs no AI.
2. Pixel lock and the deterministic checks; unit-testable with `FakeImage`.
3. Provider adapters: `gemini` (Pro and 2.1), `openai` (Sunburst with mask), then `bfl` Fill as an optional third. One `ImageProvider` family, as the plan says.
4. The labelled fidelity set (50 pieces, known-wrong variants) and threshold tuning.
5. Model sheet views for hand, ear, neck; drift check.
6. Disclosure: IPTC tag per fidelity, label presets (EU icon, "AI-generated model"), provenance record.
7. Video last: short-move concept clips through a `VideoProvider` (`gemini-omni`, then Higgsfield), with frame-sampled checks; 2.5D still as the product-true option.

**Providers.** Default Gemini (Pro for sheet and plate, 2.1 for exploration and edge). Fallback OpenAI Sunburst. Optional BFL. Higgsfield for motion and, if the founder accepts its data terms, Soul ID. Video default Omni Flash 1.1; Veo 3.1 only if the founder opens a Google Cloud project.

**Fidelity gate.** Section 4.5, fail closed, three attempts, cost-capped. `shots.export` refuses unless `check.passed`; findings name the failed item. Composite and concept exports carry different labels and different IPTC values.

**Safety gates.** Section 6.1 table; prompt screen and output moderation on every call; adults-only enum; no face uploads; recorded human likeness check at approval; provider blocks surfaced, not retried.

**Reject, and why.**
- Generative-only shots exported as product images: the evidence says designs change.
- A face-recognition lookalike gate: needs real people's biometrics; vendors' policies and privacy law stand in the way.
- MANO, WiLoR and InsightFace-based adapters in the default path: non-commercial licences.
- Midjourney: no API and automation is banned.
- Veo or Sora as assumed video back-ends on the founder's existing keys: neither is reachable with them today.
- Fit-to-photo and chain drape in v2: too many estimated quantities; later.

**Decisions for the founder.**
1. Budget about $20–30 for a spike (200–300 images) to measure hand-anatomy failures and acceptance rates on five real pieces. Every acceptance number here is a guess until then.
2. May unreleased designs be sent to Higgsfield, given that it may train on content unless on an enterprise plan? If no, Higgsfield gets motion from already-published stills only.
3. Add a BFL key for true mask inpainting, or stay with Gemini and OpenAI?
4. Open a Google Cloud project for Veo 3.1 and Google's output indemnity, or stay on the Gemini API key (Omni Flash, no indemnity)?
5. Is "composite" worth its extra build over "concept" for the first release, or ship concept plus the gate and add composite next?
6. Offer real-model likeness at all? If yes, it needs the consent record and counsel first.
7. Pursue C2PA conformance and a trusted signing certificate, or ship IPTC tags and visible labels now and add C2PA later?
8. Which label presets and which default: always-on visible "AI-generated model" label, or opt-out per export?

**Open questions I could not close.** Whether the Gemini API (not only Agent Platform) attaches C2PA; Google's and OpenAI's rate limits; whether Soul ID is callable on Higgsfield's newer API; Higgsfield's content filter rules; BFL's API terms on ownership and training; Luma, Pika, Stability and Replicate prices; Google Virtual Try-On's supported product types; Amazon's and Etsy's own policy pages; the NO FAKES Act's status; whether an invented model in an ad is a "deepfake" under the EU guidelines.

## Repo notes for the lead

- `docs/research/04-ideation-models.md` Part B: stale on video (Veo on the Gemini API, Sora) and on BFL (FLUX 3 exists; Kontext is still sold). Its `Environment variables` list has no Higgsfield key, while `docs/PLAN.md` line 13 names "Gemini, OpenAI or Higgsfield" for design images.
- Where the image provider family lives is stated two ways: `docs/plans/render-and-models.md` §2 says `apps/server/src/providers/image/{gemini,bfl,fake}.ts`; the assistant-build `apps/server/src/services.ts` header says `packages/ideation`. Neither exists in either tree. Neither lists OpenAI or Higgsfield.
- The assistant-build schema already has `ModelShot.fidelity: 'concept' | 'composite'` and four `SHOT_STAGES`; the plan's §6 lists composite as a scope cut. A v2 plan should say which wins.
- `BrandModel.portraits[].view` allows `face | hands | neck | ear | body`; v2 needs finer views (left and right hand, back and palm, each ear) or a `label` field.
- `docs/plans/render-and-models.md` §4.6 says provider C2PA "survives" on originals. True for stored originals; not true for any composite or re-encoded export, which must be marked by Pavé.
- In this working copy `apps/studio/src/features/models/index.tsx` is still a 46-line placeholder.

## Sources

**Google** — [V] [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing.md.txt) (the HTML page served an older copy without Nano Banana 2.1; the `.md.txt` copy is the one cited) · [V] [image generation docs](https://ai.google.dev/gemini-api/docs/image-generation.md.txt) · [V] [Veo docs and shutdown notice](https://ai.google.dev/gemini-api/docs/veo.md.txt) · [V] [Omni Flash docs](https://ai.google.dev/gemini-api/docs/omni.md.txt) · [V] [Cloud generative AI pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing) · [V] [Gemini API terms](https://ai.google.dev/gemini-api/terms) · [V] [indemnified services](https://cloud.google.com/terms/generative-ai-indemnified-services) · [V] [prohibited use policy](https://policies.google.com/terms/generative-ai/use-policy?hl=en_IN) · [V] [C2PA and SynthID post](https://blog.google/technology/ai/ai-image-verification-gemini-app/) · [V, truncated] [Content Credentials docs](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/content-credentials) · [V, truncated] [Virtual Try-On model page](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/vto/virtual-try-on-001) · [V] [The Decoder on Nano Banana 2 Lite and Omni Flash](https://the-decoder.com/google-launches-nano-banana-2-lite-for-fast-ai-images-and-gemini-omni-flash-for-video-via-api/) · [V] [Tech Insider on Nano Banana 2.1](https://tech-insider.org/nano-banana-2-1-launches-halves-image-price-2026/)

**OpenAI** — [V] [pricing](https://developers.openai.com/api/docs/pricing) · [V] [image generation guide](https://developers.openai.com/api/docs/guides/image-generation.md) · [V] [video guide with shutdown notice](https://developers.openai.com/api/docs/guides/video-generation) · [V] [content provenance](https://developers.openai.com/api/docs/guides/content-provenance) · [V] [moderation](https://developers.openai.com/api/docs/guides/moderation.md) · [V] [usage policies](https://openai.com/policies/usage-policies/) · [V] [services agreement](https://openai.com/policies/services-agreement/)

**Higgsfield** — [V] [platform pricing](https://docs.higgsfield.ai/pricing) · [V] [character endpoint](https://docs.higgsfield.ai/api-reference/character/get-character) · [V] [API help page](https://higgsfield.ai/creator-hub/help-center/integrations/what-is-the-higgsfield-api) · [V] [API launch post](https://higgsfield.ai/blog/higgsfield-api) · [V] [ownership and training](https://higgsfield.ai/creator-hub/help-center/account/who-owns-my-generations-and-can-i-use-them-commercially) · [V] [Soul ID](https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-create-and-use-a-soul-id-character)

**Other vendors** — [V] [BFL pricing](https://bfl.ai/pricing) · [V] [BFL pricing docs](https://docs.bfl.ai/quick_start/pricing.md) · [V] [BFL cost article](https://help.bfl.ai/articles/7986977817-what-are-the-costs-associated-with-using-your-models) · [V] [BFL models overview](https://help.bfl.ai/articles/9364115800-flux-models-overview) · [V] [Adobe Firefly product description](https://helpx.adobe.com/legal/product-descriptions/adobe-firefly.html) · [V] [Midjourney terms](https://docs.midjourney.com/docs/terms-of-service) · [V] [Ideogram 4.0](https://ideogram.ai/models/4.0/) · [V] [Recraft models](https://www.recraft.ai/docs/api-reference/models/overview) · [V] [Runway API pricing](https://docs.dev.runwayml.com/guides/pricing/) · [V] [Kling API pricing](https://kling.ai/document-api/pricing/base/video.md) · [V] [Luma pricing](https://lumalabs.ai/pricing.md) · [V] [Krea API pricing](https://www.krea.ai/app/api/pricing) · [V] [fal pricing](https://fal.ai/pricing) · [V] [fal try-on roundup](https://fal.ai/learn/tools/best-virtual-try-on-apis-2026) · [V] [FASHN docs](https://docs.fashn.ai/llms-full.txt) · [V] [FASHN API pricing](https://help.fashn.ai/plans-and-pricing/api-pricing) · [V, vendor] [Melius jewelry tools comparison](https://www.melius.com/blog/best-ai-tools-jewelry-product-photos) · [V, vendor] [OpenArt faces and hands](https://openart.ai/blog/which-ai-image-model-gets-faces-and-hands-right/)

**Papers and models** — [V] [JewelTry](https://arxiv.org/abs/2609.16626v1) · [V] [Shining Yourself](https://arxiv.org/html/2503.16065v1) · [V] [ProductConsistency](https://arxiv.org/pdf/2606.19103) · [V] [HiFi-Inpaint](https://arxiv.org/pdf/2603.02210) · [V] [AdSpark](https://arxiv.org/pdf/2610.10047) · [V] [ConsID-Gen](https://arxiv.org/html/2602.10113) · [V] [HandEval](https://arxiv.org/html/2510.08978v1) · [V] [MANO licence](https://mano.is.tue.mpg.de/license.html) · [V] [Meshcapade licensing](https://meshcapade.com/assets/body-models) · [V] [WiLoR](https://github.com/rolpotamias/WiLoR) · [V] [Depth Anything 3](https://raw.githubusercontent.com/ByteDance-Seed/Depth-Anything-3/main/README.md) · [V] [SAM 3D Body mirror](https://huggingface.co/Blendcap/sam-3d-body) · [V] [IC-Light](https://github.com/lllyasviel/IC-Light) · [V] [AuraFace summary](https://mixpeek.com/models/auraface-v1.md) · [V] [c2pa-rs](https://raw.githubusercontent.com/contentauth/c2pa-rs/main/README.md) · [V] [DigiCert on C2PA signing](https://www.digicert.com/blog/why-c2pa-signing-requires-more-than-an-sdk)

**Law and platforms** — [V] [EU code of practice news](https://digital-strategy.ec.europa.eu/en/news/commission-publishes-code-practice-marking-and-labelling-ai-generated-content) · [V] [Faegre Drinker on Article 50](https://www.faegredrinker.com/en/insights/publications/2026/7/eu-ai-act-commission-confirms-transparency-code-of-practice-as-adequate-and-publishes-final-version-of-its-guidelines-on-transparency-obligations) · [V] [NY GBL §396-b](https://www.nysenate.gov/legislation/laws/GBS/396-B) · [V] [MoFo on digital avatars](https://www.mofo.com/resources/insights/250922-digital-avatars-deep-dive-series-navigating) · [V] [MoFo on California SB 1000](https://www.mofo.com/resources/insights/261001-california-revamps-ai-transparency-requirements) · [V] [Holland & Knight on the FTC](https://www.hklaw.com/en/insights/publications/2026/08/a-look-at-the-ftcs-current-approach-to-ai-regulation) · [V] [Nishith Desai on India's rules](https://www.nishithdesai.com/research-and-articles/hotline/technology-law-analysis/deepfakes-disclosure-and-due-diligence-unpacking-indias-sgi-amendments-15532) · [V] [Meta ads labels](https://about.fb.com/news/2025/02/gen-ai-transparency-metas-ads-products/) · [V] [TikTok ads policy](https://ads.tiktok.com/help/article/tiktok-ads-policy-misleading-and-false-content) · [V] [Google Merchant Center AI content](https://support.google.com/merchants/answer/14743464?hl=en) · [V] [Quartz on Amazon's rule](https://qz.com/amazon-sellers-label-ai-generated-people-product-images-072426) · [V] [Digital Commerce 360 on Etsy](https://www.digitalcommerce360.com/2026/10/26/etsy-ai-policy/amp/) · [V] [Shopify AUP](https://shopify.com/legal/aup) · [S] [YouTube disclosure help](https://support.google.com/youtube/answer/14328491) · not opened (failed): eWeek on Amazon; Meta's help-centre page on ad labels.
