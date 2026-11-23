# 04 — Ideate (reference search + AI ideation) and Brand Models

Research date: 2026-11-23. Scope: (A) the Ideate stage, (B) brand models and on-model jewelry imagery.

**Confidence note.** This session could search the web but could not open vendor pages directly (ai.google.dev, developers.openai.com, brave.com, developers.pinterest.com and arxiv.org are outside the sandbox allowlist). Prices, limits and model IDs below are therefore taken from search-result extracts, many of them secondary. Anything marked **(verify)** must be checked against the vendor page before it is hard-coded. Nothing here is legal advice.

---

## Part A — Ideate

### 1. Reference search: what is actually available

| Source | Capability | Price / limits | Display + AI-use position |
|---|---|---|---|
| **Brave Search API** | Independent index; dedicated image endpoint `/res/v1/images/search` ([Brave](https://brave.com/search/api/)) | ~$5 per 1k queries, metered; the free tier was reportedly dropped in Feb 2026 ([Implicator](https://www.implicator.ai/brave-drops-free-search-api-tier-puts-all-developers-on-metered-billing.md)) **(verify)** | Storing results or using them to train/tune needs a plan with explicit storage rights (custom order form). Treat results as transient. |
| **Google Programmable Search JSON API** | Was the only official Google Images route | Closed to new customers since Jan 2026; shuts down **1 Jan 2027**, no whole-web replacement ([Firecrawl](https://www.firecrawl.dev/blog/google-search-json-api-alternative)) | Do not build on it. |
| **Bing Search APIs** | — | Retired 11 Aug 2025 ([Microsoft](https://learn.microsoft.com/en-us/lifecycle/announcements/bing-search-api-retirement)) | Gone. |
| **SerpApi / Serper / SearchApi** | Scraped Google Images, Google Lens (reverse image), some Pinterest engines | SerpApi $25/1k entry, falling with volume ([honeyb](https://www.honeyb.ai/blog/serpapi-pricing)); Serper ~$0.30–1.00/1k prepaid ([costbench](https://costbench.com/compare/serpapi-vs-serper/)) **(verify)** | These are scrapers of Google, not licensees. Legal status is contested (below). |
| **Exa / Tavily / Perplexity Search** | Text-first agent search. Tavily returns source-linked images via `include_images` ([Tavily](https://www.tavily.com/blog/better-image-retrieval)); no evidence found of image results from Perplexity Search | ~$5–8 per 1k ([Linkup benchmark](https://www.linkup.so/blog/cheapest-ai-search-api-benchmark)) | Good for the agent's textual research (trend reports, maker histories), weak as an image engine. |
| **Pinterest API v5** | OAuth access to the *user's own* boards and pins. Public search (`/search/partner/pins`) is beta and not open to all apps ([Pinterest](https://developers.pinterest.com/docs/api/v5/search_partner_pins/)) | Trial vs Standard tiers; Standard needs a video demo and manual review ([access tiers](https://developers.pinterest.com/docs/key-concepts/access-tiers/)) | Very restrictive, see below. |
| **Unsplash / Pexels** | Stock photo search | Free keys, rate-limited | Attribution required on display; Pexels bars collecting content via the API to train or develop ML models ([Pexels](https://help.pexels.com/hc/de-de/articles/900005880463)); Unsplash's API guidelines list AI training among restricted uses ([Unsplash](https://help.unsplash.com/api-guidelines/guideline-high-quality-authentic-experiences)) **(verify wording)** |
| **The Met** | Collection API, no key; `isPublicDomain` marks CC0 images ([Met](https://www.metmuseum.org/perspectives/met-collection-api-2)) | Free | CC0: display, store, embed, feed to AI. |
| **Art Institute of Chicago / Cleveland Museum of Art** | Public APIs, CC0 image sets ([AIC](https://www.artic.edu/open-access/open-access-images), [CMA](https://www.clevelandart.org/articles/introducing-open-access)) | Free | CC0. |
| **Smithsonian Open Access** (includes Cooper Hewitt objects) | Search API, key from api.data.gov ([field report](https://www.navigating.art/education/open-access-2026)) | Free | CC0 subset. Cooper Hewitt's own legacy API status is unclear; use the Smithsonian endpoint. |
| **Rijksmuseum** | New key-less data services at data.rijksmuseum.nl; the old `/api` is gone ([field report](https://www.navigating.art/education/open-access-2026)) **(verify)** | Free | Public-domain works reusable. |
| **Europeana** | Aggregator with a `reusability=open` filter; free key ([Europeana](https://pro.europeana.eu/blog/can-i-use-it)) | Free | Per-item rights statements; filter to open. |
| **V&A** | API v2 with IIIF images ([V&A](https://developers.vam.ac.uk/)) | Free | Images are **non-commercial** under V&A terms ([terms](https://www.vam.ac.uk/info/va-websites-terms-conditions/)); display with credit, do not use as AI references in commercial work. |
| **British Museum** | No public API confirmed; images CC BY-NC-SA 4.0 ([BM](https://www.britishmuseum.org/about_this_site/terms_of_use/copyright_and_permissions.aspx)) | — | Link-out only. |
| **Auction archives** | No public APIs found for the major houses (not exhaustively verified) | — | User-pasted URLs only. |

**Pinterest, specifically.** The Developer Guidelines say an app may not store information obtained through the API ("call the API each time"), may not use automated scraping, and may not use Pinterest materials to train or develop AI/ML models without express permission ([Developer Guidelines](https://policy.pinterest.com/en/developer-guidelines)). The Developer & API Terms add a ban on replicating Pinterest's visual design, layout or user experience ([terms](https://developers.pinterest.com/terms/)). A revised consumer ToS took effect 12 Nov 2026 and gives contractual force to Pinterest's GenAI acceptable-use guidelines ([PPC Land](https://ppc.land/pinterest-users-who-abuse-ai-tools-can-lose-accounts-from-november-12/)). Consequence: Pinterest can be a *live, linked* source (user connects their account, Pavé stores pin IDs and re-fetches), not a corpus Pavé copies, embeds at scale or feeds to models by default.

**Scraping Google or Pinterest directly: the legal position.**

- *hiQ v. LinkedIn*: scraping public pages is not a CFAA violation, but LinkedIn then won on breach of contract and hiQ accepted a $500k judgment and a permanent injunction ([ZwillGen](https://www.zwillgen.com/alternative-data/hiq-v-linkedin-wrapped-up-web-scraping-lessons-learned/)).
- *Meta v. Bright Data* (Jan 2024): logged-off scraping of public data did not breach Meta's terms; the ruling is confined to Meta's contract wording ([Quinn Emanuel](https://www.quinnemanuel.com/the-firm/news-events/client-alert-what-does-the-meta-v-bright-data-summary-judgment-ruling-mean-for-web-scraping/)).
- *X v. Bright Data* (May 2024): state-law scraping claims held preempted by the Copyright Act ([Skadden](https://www.skadden.com/insights/publications/2024/05/district-court-adopts-broad-view)).
- *Google v. SerpApi*: Google's DMCA anti-circumvention claims were dismissed in July 2026; commentators stress this is not a ruling that scraping is lawful ([Search Engine Land](https://searchengineland.com/google-loses-key-dmca-claims-against-serpapi-in-scraping-lawsuit-483185)).
- *Reddit v. SerpApi and Perplexity*: eleven days later a different court let Reddit's DMCA circumvention claims proceed ([Loeb](https://www.loeb.com/en/insights/publications/2026/08/reddit-v-serpapi-llc)).

Net: the criminal-hacking risk of public scraping is low, but contract risk (wherever Pavé or its user has accepted terms, which a Pinterest developer app has), copyright risk (jewelry photos are copyrighted works, and copying them into a store and into model inputs is not the same as showing a search thumbnail) and unsettled DMCA §1201 risk all remain. Pavé should not ship a scraper.

**Compliant design.**

1. **Licensed meta-search**: Brave image search for the open web plus the open-access museum adapters, results held transiently.
2. **User-directed capture**: paste a URL, drag in an image, or use a browser-extension clipper. The user chooses the item; Pavé records `sourceUrl`, page title, author/credit, licence, capture time and a content hash.
3. **Connected accounts**: Pinterest via OAuth as live embeds (IDs only, official embed for display).
4. **Rights tier on every reference**: `open` (CC0/PD), `licensed` (stock, with attribution), `user-asserted` (uploads), `view-only` (Pinterest, NC museums, unknown web). Only the first three are eligible as AI reference inputs by default; `view-only` items can be pinned and seen but need an explicit user override, which is logged.
5. SERP scrapers ship only as an optional community adapter, disabled by default, with the user's own key.

### 2. Visual similarity and organisation

| Model | Access | Dims | Notes |
|---|---|---|---|
| **SigLIP 2** | Open weights | 768–1536 | The open default for image-text similarity ([Eden AI](https://www.edenai.co/post/best-multimodal-embeddings-apis)); no per-call cost, no data egress. |
| **OpenCLIP** | Open weights | varies | Older baseline; licence varies by checkpoint. |
| **Gemini Embedding 2** | API, GA Apr 2026 (`gemini-embedding-2`) | 3072, Matryoshka-truncatable | Text, image, video, audio in one space ([Vertex docs](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/embedding-2)); ~$0.20/M text tokens, image higher **(verify)**. |
| **Voyage multimodal-3.5** | API | 2048/1024/512/256 | Top of Google's own comparison table; priced per pixel ([Gemini Embedding 2 paper](https://arxiv.org/pdf/2605.27295)). |
| **Cohere Embed v4** | API | up to 1536 | ~$0.47/M image tokens **(verify)**. |
| **Jina v4 / CLIP v2** | API or weights | up to 2048 | Open weights carry non-commercial terms (from prior knowledge, verify). |

- **Store** in Postgres with pgvector, HNSW index, cosine distance. Keep `model` and `dims` columns on every vector, since spaces are not comparable across models. Truncate Matryoshka vectors to 768 or 1024; pgvector's indexed `vector` type is capped at 2,000 dimensions (prior knowledge).
- **"More like this"** is a nearest-neighbour query on the image vector; "more like this, but rose gold" is the image vector combined with a text vector in the same space.
- **Auto-tagging**: one Claude vision call per pinned reference with a fixed schema: `type`, `style`/`era`, `metal`, `metalColour`, `stones[{kind, cut, count}]`, `setting` (prong, bezel, pavé, channel…), `motifs`, `finish`, `confidence`. Use a controlled vocabulary so tags are filterable.
- **Moodboards**: cluster board vectors (HDBSCAN or k-means), then have Claude name each cluster from its tags.
- **Palette**: k-means in OKLab on the jewelry mask only, reported separately for metal and stones so the background does not dominate.

### 3. Image generation for concepts (November 2026)

| Model | API | Reference images | Edit / inpaint | ~Price per image | Jewelry notes | Provenance / licence |
|---|---|---|---|---|---|---|
| **Nano Banana 2.1** (`gemini-nano-banana-2.1`, GA 6 Oct 2026) | Gemini API, Vertex | 14 (≈10 object + 4 character) | Conversational edit | $0.034 at 1K, $0.050 at 2K; batch half ([llm-stats](https://llm-stats.com/blog/research/nano-banana-2-1-launch), [benchlm](https://benchlm.ai/media-pricing/nano-banana)) **(verify)** | Cheap fan-out with real multi-reference | SynthID; C2PA on Vertex |
| **Nano Banana Pro** (`gemini-3-pro-image`) | Gemini API, Vertex | 14, up to 5 people | Conversational edit, 4K | $0.134 at 1K/2K, $0.24 at 4K ([benchlm](https://benchlm.ai/media-pricing/nano-banana)) | Most often rated best at holding a photoreal identity ([test](https://tinytiny.tools/en/blog/how-to-make-consistent-ai-characters)) | SynthID + C2PA ([Google](https://blog.google/technology/ai/ai-image-verification-gemini-app/)) |
| **GPT Image 2.6** Flare / Sunburst (4 Nov 2026) | OpenAI API | 16 per request ([apiyi](https://docs.apiyi.com/en/api-capabilities/gpt-image-2/overview.md)) | Masks, plus region "markup" in the API; Sunburst adds SVG export ([OpenAI community](https://community.openai.com/t/images-upgraded-introducing-chatgpt-images-2-6/1412901)) | Token-priced, roughly $0.006–0.21 at 1024² by quality ([2.5 model page](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst)) **(verify IDs and price)** | Strongest at labelled sheets, layouts, text | C2PA; SynthID being added ([OpenAI](https://openai.com/index/advancing-content-provenance/)) |
| **FLUX.2** [pro] / [max] / [flex] | BFL, fal, Replicate, Together | 8 via API (9 MP total), 10 in playground ([BFL](https://help.bfl.ai/articles/6944273991-what-are-the-flux-2-technical-specifications)) | Edit endpoints | [pro] $0.03 generate, $0.045 edit; [max] ~$0.07 ([Flowith](https://flowith.io/blog/flux-2-pro-pricing-2026-dev-vs-pro-vs-schnell-api/)) | Best raw photorealism and metal texture; LoRA path | C2PA embedded ([BFL](https://help.bfl.ai/articles/3705384267-c2pa-in-flux-generated-images)). [klein] 4B is Apache-2.0; [dev] and klein 9B are non-commercial |
| **Seedream 5.0** Pro / Flash | BytePlus, aggregators | 10–14 | Edit | ~$0.045 ([Rundown](https://www.therundown.ai/tools/seedream-5-0-pro)) **(verify)** | Value batches | ByteDance terms; check data residency |
| **Ideogram 4.0** | API | Character reference endpoint | Edit | $0.03 / $0.06 / $0.10 ([Ideogram](https://ideogram.ai/models/4.0/)) | Typography on packaging and lookbooks | Open weights are non-commercial |
| **Recraft V4.1** | API | Style from 1–10 refs | — | $0.035 raster, $0.08 vector ([Recraft](https://www.recraft.ai/docs/api-reference/models/overview)) | Native **SVG**: line diagrams | Commercial |
| **Midjourney V8.x** | No public API; automation barred by ToS ([guide](https://www.aifreeapi.com/en/posts/midjourney-api-guide.md)) | — | — | Subscription | Aesthetic leader, unusable in a pipeline | Unofficial "APIs" breach ToS |
| **Stable Diffusion 3.5** | Open weights | via adapters | via ControlNet | Self-host | Superseded in quality | Stability Community License (prior knowledge) |

FLUX.1 Kontext is superseded by FLUX.2's native multi-reference editing; its current availability was not confirmed. Aggregators (fal.ai, Replicate) are useful as one key for many models and for open-source pipelines, at a small markup.

**Recommendation.** Default: **Nano Banana 2.1** for exploration (a 12-image fan-out costs about $0.40), escalating to **Nano Banana Pro** for hero frames and identity-critical work. Fallback: **FLUX.2 [pro]** direct from BFL (different vendor, different failure modes, a self-hostable sibling for users who cannot send designs to a cloud). Specialist: **GPT Image 2.6** for annotated concept sheets and masked edits; **Recraft V4.1 Vector** for clean SVG outlines.

**Prompt patterns that work for jewelry.**

- *Concept sheet*: "One ring, shown as front, side, top and three-quarter views on a single sheet, identical design in every view, pure white background, soft studio light, no hands, no props, no text." Then name the invariants explicitly: stone count, cut, setting type, shank profile, metal.
- *Technical sketch*: "Orthographic line drawing, uniform black line weight, no shading, no perspective, front and side elevations aligned on a shared baseline." Ask for dimension leaders only from a model that renders text reliably.
- *Rough diagram*: do not rely on pixels for dimensions. Have Claude emit a structured spec (parameters in mm) and draw the dimensioned SVG deterministically from it; use the image model only for the look. A generated image is a picture of a ring, not a measurement of one.
- Attach references with roles: "image 1 = silhouette, image 2 = stone and setting, image 3 = finish". Models follow labelled roles far better than a bare pile of images.
- State counts as numerals and repeat them; then verify them with a vision check, because every current model miscounts small stones.

### 4. UX patterns worth borrowing

| Tool | Pattern to borrow |
|---|---|
| Pinterest | One-gesture save; "more like this" on every tile. Do not clone its layout (API terms). |
| Cosmos | Quiet, ad-free, image-first; AI used for search and clustering, plus a setting to blur or hide AI-generated images ([Fast Company](https://www.fastcompany.com/91476491/cosmos-the-hit-pinterest-alternative-mulls-what-ai-should-be-for)). |
| Are.na | Blocks that live in several channels at once; source always kept; boards for thinking, not for likes. |
| Milanote / FigJam | Free canvas for arranging, notes beside images, arrows. |
| Krea / Visual Electric | Generation happens on the same surface as the references; variations fan out beside their parent. |
| Midjourney web | Drag an image into the prompt bar as a typed reference (style / subject); grid of four; vary and upscale in place. |
| Perplexity / Notion AI | Every AI statement carries its sources; ask a question of a collection. |

For Pavé: a masonry **library** for gathering and a free **canvas** per brief for arranging, as two views of the same items. "Pin to brief" promotes a reference into the design brief. Dragging references into the prompt assigns them roles. Every generated idea stores the IDs of the references, prompt, model and seed that produced it, so lineage ("this concept came from these three pins") is a graph the user can walk in both directions. AI-generated tiles are visibly marked and filterable.

---

## Part B — Brand models and on-model imagery

### 5. A consistent synthetic model

| Method | How | Consistency | Trade-off |
|---|---|---|---|
| **Reference-conditioned generation** (Nano Banana Pro, FLUX.2, GPT Image 2.6, Seedream 5) | Pass 3–6 canonical portraits with each request | Good and improving; Google documents character consistency as an imperfect, known limit | No training, portable across vendors. Start here. |
| **Identity LoRA** (FLUX.2 on fal/Replicate or self-hosted) | Train on 20–40 curated images | Highest for high volume | Ties the identity to one model family; retrain on upgrades. |
| **Adapter lineage** (InstantID, PuLID, IP-Adapter-FaceID) | Face-embedding injection | Good faces, weaker bodies and hands | Depends on InsightFace models whose weights are non-commercial (prior knowledge, verify). Avoid in the default path. |
| **Higgsfield Soul ID** | Train from 20–80 photos | "Clearly the same person", not pixel-identical ([Higgsfield](https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-create-and-use-a-soul-id-character)) | Not exportable; lock-in. |
| **Fashion "AI model" products** (Botika, Lalaland, Claid, WeShop, FASHN, Photoroom) | Hosted catalogues of synthetic models | Fine for apparel | Jewelry and accessories are a documented weak case ([roundup](https://fashiolabs.com/blog/12-best-ai-tools-for-fashion-brands-2026)). |

**Model card** (a versioned record per brand model):

- **Identity**: name, a written description, apparent age range, skin tone (Monk scale), undertone, hair, eye colour, distinguishing marks.
- **Body measurements that jewelry needs**: ring size per finger, wrist circumference, neck circumference, ear type and piercing positions, hand length. These are the scale anchors for section 6.
- **Canonical set**, approved by a human and then frozen: face front, three-quarter and profile; both hands, back and palm; neck and décolleté; each ear; full body. Neutral light, neutral background.
- **Generation recipe**: provider, model version, prompts, seeds, the reference subset to send per shot type (hand shots get the hand references, not the face).
- **Provenance and consent**: a statement that the identity is synthetic, the result of a likeness check, who approved it, licence terms of the generating model.
- **Drift control**: every new image is compared with the canonical set (face-embedding similarity plus a Claude check on marks and skin tone) before it is accepted.

### 6. Putting the real piece on the model

**Why this is hard.** Reviewers and vendors agree that on-model jewelry is the weakest use case for generative tools: extra prongs, changed settings, simplified bands, shifted proportions ([FormaNova test](https://formanova.ai/blog/ai-jewelry-photography-comparison/), [Lumesa](https://www.lumesa.ai/post/9-best-ai-jewelry-photography-platforms-in-2026); both are vendors). No independent benchmark with measured error rates was found.

**What exists.**

- *Research*: "Shining Yourself" (CVPR 2025) is the first diffusion try-on for rings, bracelets, earrings and necklaces ([arXiv](https://arxiv.org/abs/2503.16065)). **JewelTry** (Sept 2026) is mask-free and scale-aware, and introduces JVTO-Bench with real product-scale annotations ([arXiv](https://arxiv.org/abs/2609.16626v1)). Scale is now recognised as its own metric, which supports our concern.
- *General try-on*: FASHN Try-On Max (broader item types, 4K, about $0.075 per credit), Kling Kolors, Google Vertex VTO; IDM-VTON is CC BY-NC-SA and unusable commercially ([fal roundup](https://fal.ai/learn/tools/best-virtual-try-on-apis-2026)). All are built for garments.
- *AR vendors* (Perfect Corp, mirrAR, Camweara, Tangiblee, GlamAR): real-time tracking with a 3D asset. They prove that render-over-tracked-anatomy works, but they are closed SDKs aimed at shopper engagement, not editorial stills ([overview](https://glamar.io/blog/ar-ring-try-on-software-sdk)).

**The provisional plan, challenged.** Fit landmarks or a mesh to the generated photo, pose the CAD, render with estimated light, composite, harmonise, verify. Building blocks exist: MediaPipe landmarkers for a fast first pass; MANO fits from WiLoR or HaMeR for a hand mesh ([WiLoR](https://arxiv.org/html/2409.12259)); Depth Anything 3 has a metric variant under Apache-2.0 ([DA3](https://arxiv.org/pdf/2511.10647v1)); DiffusionLight-Turbo estimates an HDR environment map from one image in about 30 seconds ([arXiv](https://arxiv.org/abs/2507.01305v2)). Weak points:

1. **Fitting error lands exactly where the eye looks.** A 2-degree error in finger axis or a 5% error in finger width reads as a floating or sunken ring. Landmarks give joints, not finger girth; girth has to come from a segmentation mask or mesh.
2. **A generated photo has no absolute scale.** The fix is to let the model card supply it: the finger is a known ring size, so the CAD at that size must fit that finger, and millimetres-per-pixel follows from the measured finger width.
3. **Gemstones are lighting-critical.** A low-resolution estimated environment makes diamonds look dead. Use the estimate for light direction and colour, then light the render with a high-resolution studio HDRI rotated and tinted to match.
4. **Contact.** Skin compresses under a ring; hair crosses earrings; chains drape over collarbones. Rigid pieces (rings, studs, bangles) are tractable; chains need a rope simulation against a body mesh and are a later milestone.
5. **The harmonisation pass can undo the fidelity** it was meant to preserve.

**Refinement: build the scene jewelry-first.** Instead of reverse-engineering geometry from a generated photo, own the geometry from the start. Pose a MANO hand (or SMPL-X bust, or FLAME head) scaled to the model card's measurements, place the CAD on it in 3D, and render the jewelry with a shadow and occlusion pass plus depth and normals for the body proxy. Then ask the image model to paint the brand model *around* the locked render, using the proxy as a pose and depth guide and the model card's references for identity. Scale and contact are correct by construction, and no landmark fit is needed. In both variants apply a **pixel lock**: after any generative pass, the original jewelry render is pasted back inside its mask, and the generative model is only allowed to change a thin contact band (shadow, skin, stray hair). The fit-to-photo route stays as a second mode for when a user brings an existing photograph.

**Verification.** Deterministic first: with pixel lock, structural similarity inside the mask should be near-perfect, and a failure means the pipeline broke. Then a Claude vision comparison of the CAD render crop against the final crop for stone count and shape, setting type, metal colour, plausible scale against the hand, and anatomy (finger count, ear shape). Fail closed: an image that does not pass is not exported as "on-model".

**Staged plan.**

| Stage | Method | Output claim |
|---|---|---|
| **v1** | Generative insertion: multi-view CAD renders (4–6 views, white background) plus model-card references into Nano Banana Pro or FLUX.2; automatic verification; regenerate on failure | "Concept visualisation", never "product photo" |
| **v1.5** | Same, plus pixel lock for rings: render the CAD at the pose the generator produced, paste over | Faithful stones, approximate fit |
| **v2** | Jewelry-first 3D scene (rings, studs, bangles), locked render, generative person and contact band | Product-accurate on-model stills |
| **v3** | Chains and pendants with drape simulation; fit-to-photo mode; short video | — |

### 7. Legal and ethical requirements to design in

- **Likeness.** No real person's likeness without documented rights. Brand models are generated from text and synthetic references only; uploads of real faces as identity references require a consent attestation. Run a similarity check against the result before a model card is approved, since generators can drift towards recognisable faces. Several US states now regulate digital replicas of real people; get counsel before offering "digital twin of our real model".
- **EU AI Act Article 50** applied from **2 Aug 2026** and was not delayed by the Digital Omnibus. Providers of systems already on the market have until **2 Dec 2026** for machine-readable marking; a code of practice on marking and labelling was finalised in June 2026 ([Jones Walker](https://www.joneswalker.com/en/insights/blogs/ai-law-blog/yes-august-2-still-matters-the-eu-approved-a-high-risk-ai-delay-but-most-trans.html), [ActuIA](https://www.actuia.com/en/news/ai-act-obligations-in-force-and-delays-under-omnibus-2026-1744/), [guide](https://artificialintelligenceact.eu/transparency-rules-article-50/)). Pavé's exports must carry machine-readable marks and offer a visible label.
- **New York GBL §396-b** (in force 9 June 2026): ads with a "synthetic performer" need a conspicuous disclosure; $1,000 first violation, $5,000 after ([Crowell](https://www.crowell.com/en/insights/client-alerts/synthetic-performers-real-consequences-implications-of-trailblazing-new-york-ai-ad-law)). A brand model in an ad is squarely this.
- **California AI Transparency Act** (operative Aug 2026) puts disclosure and provenance duties on large generative-AI providers, with platform duties phasing in from 2027 ([MoFo](https://www.mofo.com/resources/insights/261001-california-revamps-ai-transparency-requirements)).
- **FTC**: no rule requires disclosure merely because AI was used, but deception rules apply in full; an image implying a real customer, or misrepresenting the product, is actionable ([Coblentz](https://www.coblentzlaw.com/news/genai-in-advertising-and-influencer-marketing-the-legal-framework-2026-update/)). An inaccurate on-model image of a ring is a product-misrepresentation risk regardless of AI labels.
- **Ad platforms**: Meta, TikTok and Google rules differ and sources conflict; TikTok is the clearest in requiring a label on realistic AI content ([comparison](https://novoads.ai/en/blog/ai-ad-label-rules-2026)) **(verify per platform)**.
- **Provenance**: Google outputs carry SynthID (and C2PA on Vertex), OpenAI and BFL embed C2PA. Metadata is stripped by re-encoding and most upload paths, so Pavé should re-sign its own exports with a C2PA manifest that lists ingredients (CAD render, model card, generator) and keep a server-side provenance record.
- **Diversity.** Levi's (2023) and Guess in Vogue (2025) drew backlash for presenting synthetic models as a diversity measure while real models lost work ([NBC](https://www.nbcnews.com/business/business-news/ai-models-levis-controversy-backlash-rcna77280), [TechCrunch](https://techcrunch.com/2025/08/03/the-uproar-over-vogues-ai-generated-ad-isnt-just-about-fashion)). Do not market the feature as diversity. Do make skin tone, age and hand type explicit model-card fields, and test jewelry rendering across the full skin-tone range, since metal colour and contact shadows fail differently on each.
- **Model licences**: keep non-commercial weights (FLUX.2 [dev], klein 9B, Ideogram open weights, IDM-VTON, InsightFace models) out of default paths. Record the generating model and its terms on every asset.

---

## Decisions for Pavé

- **Search default**: Brave image search + open-access museum adapters (Met, AIC, Cleveland, Smithsonian, Rijksmuseum, Europeana). Stock (Unsplash, Pexels) optional. Tavily or Exa for the agent's text research.
- **No scraping** of Google or Pinterest in core. Google's official API dies 1 Jan 2027. SERP scrapers are an off-by-default community adapter. Pinterest is OAuth-connected, live-fetched, IDs only, and `view-only`.
- **Capture is user-directed**: paste URL, upload, clipper. Every reference keeps source URL, credit, licence, rights tier, hash and timestamp, permanently.
- **Rights tier gates AI use**: `open`, `licensed`, `user-asserted` may be sent to models; `view-only` needs a logged override.
- **Embeddings**: Gemini Embedding 2 truncated to 768 dims as the hosted default; SigLIP 2 self-hosted for local installs. pgvector with HNSW.
- **Tagging, clustering names, verification**: Claude vision with fixed schemas.
- **Image generation**: Nano Banana 2.1 (explore) and Nano Banana Pro (hero, identity); FLUX.2 [pro] fallback; GPT Image 2.6 for annotated sheets; Recraft vector for outlines. No Midjourney.
- **Dimensions never come from pixels**: diagrams with measurements are drawn from Claude's structured spec.
- **Brand models**: reference-conditioned first, LoRA only on demand; versioned model card with jewelry-relevant measurements and a frozen canonical set.
- **On-model**: v1 generative with multi-view CAD references and a fail-closed verifier, labelled "concept"; v2 jewelry-first 3D scene with pixel lock for product-accurate stills.
- **Compliance built in**: AI label on by default for exports, C2PA re-signing, provenance log, likeness check, consent attestation for any real-person input.

```ts
type RightsTier = 'open' | 'licensed' | 'user-asserted' | 'view-only';

interface ReferenceHit {
  provider: string; sourceUrl: string; imageUrl: string; thumbUrl?: string;
  title?: string; credit?: string; licence?: string; rights: RightsTier;
  mayStore: boolean; mayUseAsAiInput: boolean;
}
interface SearchProvider {
  id: string;
  capabilities: { image: boolean; reverseImage: boolean; text: boolean };
  search(q: { text?: string; imageUrl?: string; limit?: number; cursor?: string;
              filters?: { openAccessOnly?: boolean } }): Promise<{ hits: ReferenceHit[]; next?: string }>;
}

interface ImageRef { bytes: Uint8Array; mime: string; role: 'subject' | 'style' | 'identity' | 'layout' | 'product'; note?: string }
interface ImageGenProvider {
  id: string;
  limits: { maxRefs: number; maxPixels: number; supportsMask: boolean; supportsVector: boolean };
  generate(req: { prompt: string; refs?: ImageRef[]; mask?: Uint8Array; base?: Uint8Array;
                  size?: { w: number; h: number }; n?: number; seed?: number;
                  tier?: 'explore' | 'hero' }): Promise<GeneratedImage[]>;
}
interface GeneratedImage {
  bytes: Uint8Array; mime: string; model: string; seed?: number; costUsd?: number;
  provenance: { c2pa: boolean; synthId: boolean }; refIds: string[];
}

interface EmbeddingProvider {
  id: string; model: string; dims: number;
  embedImages(images: Uint8Array[]): Promise<Float32Array[]>;
  embedTexts(texts: string[]): Promise<Float32Array[]>;
}
```

**Environment variables**: `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `BFL_API_KEY`, `OPENAI_API_KEY` (optional), `FAL_KEY` (optional), `RECRAFT_API_KEY` (optional), `BRAVE_SEARCH_API_KEY`, `SMITHSONIAN_API_KEY`, `EUROPEANA_API_KEY`, `UNSPLASH_ACCESS_KEY` and `PEXELS_API_KEY` (optional), `PINTEREST_APP_ID` and `PINTEREST_APP_SECRET` (optional), `TAVILY_API_KEY` (optional), `DATABASE_URL` (Postgres with pgvector), `PAVE_EMBEDDING_PROVIDER` (`gemini` or `siglip2`), `PAVE_IMAGE_PROVIDER_DEFAULT`, `PAVE_IMAGE_PROVIDER_FALLBACK`, `PAVE_C2PA_SIGNING_KEY`.

**Open items to verify before implementation**: exact Brave plan terms for transient display and AI grounding; current Gemini and OpenAI image model IDs and prices; whether the Gemini API (not only Vertex) embeds C2PA; Pinterest embed rules for display; platform ad-label policies; licence of any face-similarity model used for drift checks.
