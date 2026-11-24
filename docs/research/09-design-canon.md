# 09 — Design canon: what makes each archetype look right, in our parameters

Research date: 2026-11-23. Five research passes, then a skeptic pass that checked every number against the schema, the kernel and the production research; this is the corrected consolidation. Build brief: [`docs/plans/design-intelligence.md`](../plans/design-intelligence.md).

**How to read the evidence.** `[S]` sourced from a search summary this session (no page could be fetched). `[R]` already in `01-cad.md`, `02-production.md` or `06-freeform.md`. `[K]` read from, or measured on, the kernel by the skeptics. `[D]` derived by arithmetic. `[EJ-h/m/l]` expert judgement with high, medium or low confidence. Most proportions are expert judgement: the trade publishes ranges, not ratios. A correction wins over the research when it is high-confidence or about manufacturability; otherwise the range is widened and the disagreement noted.

**Conventions.** Millimetres, as modelled in CAD: polishing removes 0.05–0.1 from prongs and 0.1–0.2 from walls `[R]`, so finished figures are lower. W = centre `gem.width`; Ø = melee diameter; ID = ring inner diameter (US 6 = 16.5); H = pendant body height; e = `placement.elevation`, which is finger-to-culet `[K]`. Variants are delicate / classic / bold; a piece should sit in one.

**Alloy modifier** `[EJ-m]`: pt950 and 14k use the table values. 18k: prongs +0.05–0.1, thin bands +0.1. Sterling: prongs +0.1–0.2, shank ≥ 1.8 thick. 22k, 24k and fine silver: prongs and bezel walls +0.2, bezel preferred, no shared-prong or micro-pavé. Titanium cannot be sized or cast conventionally.

## 1. Rings and bridal

### Solitaire

| Rule | Parameter | Value | Src |
|---|---|---|---|
| Band width | `ringShank.widthTop` | Near-absolute: delicate 1.5–1.8 (W ≤ 6.5; flagged below the 1.8 guideline), classic 1.8–2.2, bold 2.5–3.0. Default clamp(0.30·W, 1.8, 2.4); ≥ 2.0 for W ≥ 8. Lint below max(1.5, min(0.20·W, 2.0)) or above max(0.45·W, 2.6) | [S] thin < 2, thick > 2.3; [R]; [EJ-h] |
| Band thickness | `thicknessBottom` / `thicknessTop` | 1.5–1.8 / bottom + 0.1…0.3. Width < 2.0 under a head: thickness ≥ max(1.5, width − 0.1). 1.3 only for plain stacking bands (kernel warns below 1.5) | [R][K] |
| Elevation class | `gem.placement.elevation` | Low 0.8–1.2 (0.5 under a bezel), `basket` or `bezel` only; classic `thicknessTop` + 0.2…0.8 (≈ 1.9–2.8); high `thicknessTop` + 1.2…2.2 (≈ 3.0–4.0). Lint > 4.0 unless W ≥ 9 | [K]; [EJ-m] |
| Table height | derived | e + `depthPct`·W (round 0.615, emerald 0.65, princess 0.72). 1 ct: low ≈ 5, classic 6–7, high 7–8. Everyday ≤ 7, cocktail ≤ 10.5; lint above 0.62·W + 4.2 | [D]; [EJ-m] |
| Prong wire | `setting.prongDiameter` | max(0.80, 0.10·W + 0.35): 5 → 0.85, 6.5 → 1.0, 8 → 1.15, 10 → 1.35. Six prongs × 0.88 and −0.1 inside a halo, before the clamp. `double` tips ≥ 1.3. Lint heavy above max(0.18·W, 1.0) | [R] floor; [K]; [EJ-h] |
| Prong count, round | `setting.prongCount` | Default 4 below 7.4, 6 from 7.4; either is acceptable from ≈ 4.5 up. Lint only when count × wire > 0.35 × girdle circumference | [S] GIA, Whiteflash |
| Claw positions | `prongSpin` | 4 → 45 or 0; 6 → 30 or 0; 3 → 30 or 90 (the default 45 is asymmetric for 6 and 3). Ignored for cuts with points | [K] |
| Tip | `prongTip` | `claw` modern, `round` traditional, `double` vintage, `tab` step-cut corners. V-claws are automatic on every point; lint when `prongCount` < number of points | [K] |
| Head style | `setting.style`, `rails` | `basket`, `rails` ≥ 1 when W ≥ 4.5 or free prong length (e + pavilion + 0.4 − `thicknessTop`) > 3 × wire; `rails` 2 above ≈ 5 mm of free length. `prong` builds bare claws `[K]`: keep it for W < 4.5 or claws rising < 3 | [R] 3× rule; [K] |
| Head taper | `setting.taper` | Round 0.40–0.55 (base 45–60 % of W); step cuts and cushions 0.20–0.30 (base 70–80 %) | [K]; [EJ-m] |
| Cathedral | `shoulderHeight` | ≤ (e + 0.44·W − `thicknessTop`) − 0.8: ≈ 1.7–2.6 for a classic 1 ct; needs e ≥ `thicknessTop` + 1.0. A second check allowed 0.5 more (the arch peaks off-centre); lint on evaluated peak Z | [K]; disagreement noted |
| Split shank | `splitGap`, `widthTop` | Gap 0.25–0.45·W; `widthTop` 2.0–4.0 (each strand = max(0.6·`widthTop`, 0.9)) | [K]; [EJ-m] |
| Profile, base | `profile`, `baseShape` | `court` default; `knifeEdge` 1.8–2.2 wide and ≥ 1.8 thick; `flat`/`flatCourt` under walled rows; `euro` when W ≥ 8 or halo outline ≥ 11 | [EJ-m] |

Prongs by shape: princess, asscher, emerald, radiant, cushion 4; oval 4, or 6 from 9 long; pear 5–6 (3 below 6 long); marquise 6; heart 3–5; trillion 3 `[R][K]`.

### Halo

| Rule | Parameter | Value | Src |
|---|---|---|---|
| Melee size | `halo.stoneWidth` | snapToMelee(clamp(0.10·W + 0.60, 1.0, 2.0)): 5 → 1.1, 6.5 → 1.25, 8 → 1.4, 10 → 1.6. Use the node only up to 1.7 (it bead-sets) | [S] 1.2 on 1.6 ct; [K] |
| Outline | derived | W + 2·(`offset` + rows·Ø + (rows − 1)·`gap` + 0.25): a single row adds ≈ 3.0–3.8. Target 1.40–1.60·W for W 6–9; lint > 1.70·W, or > 1.80·W below W 6 | [K]; [EJ-m] |
| Gap to centre | `halo.offset` | The kernel does not index stones round the claws: ≥ max(0.30, wire − 0.5) with claws, ≥ `wall` + 0.2 with a bezel. Use 0.8 claws inside a halo for W ≤ 7. Lint > 0.60 unless a floating halo (0.6–1.0) is declared | [K] measured |
| Seat height | `halo.drop` | 0.3–0.6, never negative | [EJ-h] |
| Double halo | `halo.rows` | 2 only if W ≥ 6; outline ≤ 2.0·W | [EJ-m] |
| Melee zones | `halo.stoneWidth`, `gemRow.stoneWidth` | Adjacent zones differ by ≤ 0.1 or ≥ 0.4 | [S] GIA, Design with melee |

A **hidden halo cannot be built**: `offset` ≥ 0.05 and tables face up, so `drop` 1.5–2.5 makes a visible skirt `[K]`. Record it as an open question and a maker note.

### Three-stone

- **Side size:** classic 0.70–0.80·W (⅓–½ of the centre's carat each; 0.79 is exactly half), centre-dominant 0.55–0.65·W (⅙–¼ each; the recipe's 0.62 is "1 ct + 2 × 0.25 ct") `[S][D]`. Pear sides 0.45–0.55·W at `lw` 1.4–1.6 `[EJ-m]`.
- **Heights:** side `elevation` must be higher than the centre's. e_side = (ID/2 + e_c + d_c·W − drop)/cos θ − ID/2 − d_s·W_side with drop 0.3–0.9, ≈ centre + 1.4…2.0 on US 6. Lint on evaluated table drop (0.3–1.5), never on `elevation` `[K]` measured.
- **Spacing:** plan-view girdle gap 0.15–0.30 only with no claw between the stones (`prongSpin` 45); otherwise ≥ 0.5–0.7. Solve `placement.angle` (≈ 25–28° on US 6) `[K]`.
- **Pairing:** step with step, brilliant with brilliant; the classic exception, tapered baguettes, **is not in `GEM_CUTS`** (nor trapezoid, half-moon). Stand-in: straight `baguette`, width 0.40–0.45·W, `lw` 1.5–1.7, `spin` 90, declared as a stand-in.

### Rows, eternity, plain bands

| Rule | Parameter | Value | Src |
|---|---|---|---|
| Walled pavé, channel | `gemRow.stoneWidth` | ≤ `widthTop` − 0.8, prefer − 1.0 (band 2.0 → 1.0–1.2; 2.4 → 1.4–1.6; 3.0 → 2.0–2.2), on `flat`/`flatCourt` | [R] GIA 0.5, Stuller 0.4; [K] |
| Shared prong | `stoneWidth` | ≤ `widthTop` − 0.4. French/U-cut is not expressible: use this and say so | [K] |
| Rows | `gemRow.rows` | Width ≥ rows·Ø + (rows − 1)·gap + 0.8: one row below 3.0, two at 3.0–4.0, three from 4.1 | [K] |
| Metal under stones | `thicknessTop` | ≥ max(1.5, 0.6·Ø + 0.6); shared prong max(1.5, 0.35·Ø + 0.6) | [K]; [EJ-h] |
| Coverage | `gemRow.coverage` | Half 150–180 (sizes ± 1–1.5), three-quarter 240–270 (± 0.5), full 360. Lint > 270 on a non-eternity | [EJ-h] |
| Gap | `gemRow.gap` | Pavé 0.10–0.25 (0.15; ≥ 0.20 with beads); channel 0.05–0.10, never 0; bar 0.5–0.7 | [R][K] |
| Clear of the head | `skipCenter` | 2·asin(((1 − taper)(W/2 + 0.35) + wire/2 + 0.3)/(ID/2 + `thicknessTop`)): ≈ 36° at 1 ct, 49° at 3 ct, 48° for a 1 ct bezel | [D] |
| Graduation | `graduateTo` | `stoneWidth` − 0.3…0.5; never exactly 1.5 (read as unset) | [R][K] |
| Eternity scale | `stoneWidth` | 1.3–1.5 / 1.8–2.2 / 2.7–3.0 / 3.5–4.0. Counts come from the evaluation (US 6: Ø 1.5 ≈ 36, 2.0 ≈ 28–29, 3.0 ≈ 20, 4.0 ≈ 16) | [K] |
| Plain band | width × thickness | Stacking 1.5–2.0 × 1.3–1.6; women's 2–3 × 1.5–1.8; men's: thickness ≈ 1.6 + 0.1·width (4 → 2.0, 6 → 2.2, 8 → 2.4), floor 1.5. Width/ID 0.22 slim, 0.30 classic, 0.38–0.40 bold, lint > 0.42 | [S] With Clarity, Manly Bands; [K] masses |
| Fit, pair | — | Flat or D interiors ≥ 6 wide wear ¼–½ tight; court roughly cancels. A wedding band sits within ± 0.3 width and ± 0.2 thickness of its engagement shank | [S]; [EJ-m] |

### Bezel, east-west, toi-et-moi, stones

- **Bezel:** `setting.wall` 0.50–0.60 for W ≤ 5, 0.60–0.80 for 5–7, 0.7–1.0 above. Never below 0.45, a kernel error `[K][R]`. The half-bezel arc is fixed at 110° a side.
- **East-west:** `spin` 90, low elevation, band 1.8–2.5, length ≤ 0.65·ID. **Toi-et-moi:** contrasting shapes of near-equal face-up area, gap 0.3–0.8; no bypass shank exists `[EJ-m]`.
- **L:W defaults, not lints** `[S]` GIA, PriceScope: oval 1.35–1.50, pear 1.50–1.75, marquise 1.75–2.25, emerald 1.35–1.50, cushion 1.00–1.09 or 1.15–1.25, radiant 1.00–1.05 or 1.25–1.40.
- **Scale to hand** `[EJ-m]`: W/ID 0.30–0.38 / 0.38–0.48 / 0.50–0.65; whole head ≤ 0.80·ID.
- **Colour** `[EJ-h]`: white head for colourless stones (two nodes for two-tone), rhodium on white gold, melee within two colour grades of the centre.
- **Wearability class**, to add to `GEM_MATERIALS`. Poor (emerald, opal, tanzanite, pearl, turquoise, peridot): warn on an open prong head on a ring; never flush, channel, bar or pavé. Fair (quartz, garnet, tourmaline, onyx, morganite, aquamarine, topaz): note only. Flush and pavé need Mohs ≥ 8. Pearls are peg-and-cup mounted: a bezel cup at ≥ 0.45 plus a maker note `[S]` GIA framework; `[EJ-h]`.

## 2. Pendants, chains and hip-hop

Tiers follow `06-freeform.md`: micro 25–38, small 38–64, mid 64–76, standard 76–102, XL ≥ 102. Interpolate on H; do not look up by tier. All `[D]` or `[EJ-m]`, anchored on two listings `[S]`: a 14K initial at ≈ 25 g with 4 ct, a 70 mm custom at 85 g.

| Rule | Parameter | Value |
|---|---|---|
| Thickness | `vectorBody.thickness` | ≈ 1.5 + 0.055·H ± 25 % (3.2 at 30, 4.4 at 52, 5.6 at 75, 7.8 at 115). Lint below max(2.5, 1 + 0.035·H) `[K]` masses |
| Metal under stones | any pavé host | ≥ 0.65·`sizeMax` + 0.8, from the recessed field floor (recess = min(max(0.8·border, 0.3), 0.6, thickness/3)). The kernel's 0.4 floor silently drops stones `[K]` |
| Fill stone | `pave.sizeMax` | The kernel packs largest-first, so this is the bulk stone: clamp(0.02·H, 1.0, 2.0); micro 1.0–1.2, mid 1.3–1.5, XL 1.5–2.0. Lint above max(1.3, 3 % of H), or 2.0 when H < 60 `[K]` |
| Spread | `sizeMax`/`sizeMin` | 1.3–1.8 with `sizeMin` 0.8–1.2; lint > 2.0 |
| Gap | `pave.gap` | clamp(0.15·d, 0.15, 0.25), default 0.20; lint above max(0.25, 0.2·`sizeMax`) `[R]` |
| Edge | `pave.margin`, `vectorBody.border` | border + margin ≥ 0.5, never < 0.4. With a rim ≥ 0.6: margin 0.15–0.35. Rim 0.7–1.0 × `sizeMax` (0.8–1.2 mid, 1.2–2.0 standard, 2–3 XL) `[R]` |
| Ice level | `pave.coverage` | 1.0 on every field. Accents are a separate `pave` node; below 1 shrinks the field from its edges `[K]` |
| Density | report | Stones/cm² = 100/(0.866·(d + gap)²): 80 at 1.0, 51 at 1.3, 40 at 1.5, 24 at 2.0. Carats/cm² ≈ 0.43·d·(d/(d + gap))². Lint sparse below 85 % of the lattice count `[D]` |
| Iced strokes | outline | n rows need d + (n − 1)·0.866·(d + gap) + 2·(margin + border): 2.0 / 3.3 / 4.6 at 1.3. One or two clean rows are right on script; lint only partial rows `[D]` |
| Depth | stacked bodies | 2–4 levels, steps 0.8–1.5; iced plates ≥ 1.6. Never union levels of different tones `[K]` |
| Mass | report | Silhouette area × 1.5–3.5 solid-equivalent × density. `vectorBody` cannot be scooped, so compare it with the solid figure, not listings `[K]` |
| Size limits | — | Above 70 exceeds the default caster envelope (`piece.large`); sculpts take `flatBack` 0.35 |

**Bail and chain.**

- `bail.opening` ≥ `linkWidth` + 1.5 (kernel error below), typically max(1.3·`linkWidth`, + 2), and ≥ clasp + 0.5 `[K]`; `[EJ-m]`. Round chains (rope, box, tennis) want `tube` or `ring`.
- Bail outer height 15–22 % of H for bodies ≥ 15, lint < 12 %; on a solitaire 60–100 % of stone width. An iced bail needs `wire` ≥ 0.65·Ø + 0.8 `[EJ-m]`.
- Chain width by style: Cuban/curb 8–16 % of H (lint < 6 or > 20); rope/box 5–10 %; tennis 3–5 mm stones up to H 100, no mass rule. Solid chain mass 0.5–1.5 × pendant, lint < 0.3 × `[S]` GLD, IceCartel; `[K]`.
- Figaro 3–5 carries crosses and medallions to ≈ 45, not iced pendants ≥ 50 `[EJ-m]`. Men's lengths: 559 default, 508 collarbone, 610 mid-chest, 660–762 statement `[S]`.
- Fine pendants: `linkWidth` = clamp(0.18·W, 0.9, 2.0); opening + 1.5…2.5; ≤ 3 g on 0.9–1.1 chain, 3–8 g on 1.3–1.8, 15–40 g on ≥ 3 `[EJ-l]`.
- Length names `[S]`: choker 356–406, princess 432–483, matinee 508–660, opera 661–900 (schema maximum).

**Chains.**

- Cuban `linkWidth`: 2–4 subtle, 5–7 everyday, 8–10 statement, 11–14 bold, 15+ centrepiece `[S]`.
- Cuban mass ≈ 0.23·w²·L·density `[D]` (four listings ± 8 %). The kernel's link weighs ≈ 0.29: check the report against that until it is calibrated `[K]`. `wire` ≤ 0.30·`linkWidth`.
- Tennis: `linkWidth` = stone + 0.4, `wire` 0.7–0.8. Kernel pitch is stone + 0.7: 137 stones / 13.9 ct for 3 mm at 508, 48 / 4.8 ct at 178; the trade pitch (+ 0.3) gives ≈ 10 % more. Quote from the report `[K]`.
- Tennis stones: 1.7–2.2 delicate, 2.7–3.3 classic, 3.8–4.5 bold; hip-hop "N mm tennis" names the link. Bracelet length: wrist + 13–25 (165 / 178 / 190; men 203–216) `[S]`.

**Conventions** `[EJ-m]`. Yellow gold with white stones is the classic, valid without rhodium. "All ice" is rhodium-plated white gold; two-tone means separate nodes per tone. CZ belongs on silver, vermeil or brass, at any size. Grillz come from a dental scan as a `meshBody` only, wall 0.8.

## 3. Earrings and bracelets

| Type | Numbers | Src |
|---|---|---|
| Studs, per ear | 3–4 delicate; 4.5–5.2 classic (1 ct for the pair, the usual default); 5.8–6.5 statement and the hip-hop standard; 7.4–8.2 bold. Retail carats are pair totals; `StoneSpec.carat` is per stone | [S] Blue Nile, Brilliant Earth, AJLuxe |
| Stud head | `basket`, wire max(0.6, 0.08·W + 0.3); three-claw martini only to 6.5 with wire ≥ 0.9; bezel `wall` 0.5. Screw backs from ≈ 1 ct each (not in `finding.type`) | [R][K]; [EJ-m] |
| Post | `finding.wire` 0.8–0.9, `length` 10 (9.5–11) | [R] |
| Hoops, solid `pipe` | Inner Ø 6.5–10 → wire ≤ 3.0; 12–20 → ≤ 2.5; 25–40 → ≤ 2.0; 45–60 → ≤ 1.5. Thicker hoops are hollow tube, which we cannot model | [D] 14k, 4 g |
| Mass per ear | ≤ 2 g unnoticed, 3–4 all-day, 5–7 occasion, ≥ 8 heavy. Per ear = (`metalMassG` + 0.2·`caratTotal`)/2 for a mirrored pair | [S] Ganoksin threads; [K] |
| Jhumka | `revolve` shell, wall 0.7–0.8: a 22k dome is ≈ 2.5 g at Ø 12, 4.6 g at 16 | [D] |
| Bangles | Slip-on inner Ø 57–60 / 62–65 / 67–70 (Indian 2-4 = 57.2 … 2-12 = 69.9), sized from the hand. Hinged ovals 57–60 × 43–48 and 62–65 × 50–52, from the wrist. Round wire ≥ 2.0 | [S] retailer charts |

## 4. Men's and signets

| Rule | Parameter | Value | Src |
|---|---|---|---|
| Signet face | `widthTop`, `relief.width/height` | Across the finger 0.65–0.80·ID; along it 0.80–0.87 of that. Stock 11 × 9, 12 × 10 to 13 × 11, 14 × 12, 16 × 13 | [S] AJLuxe, Asprey, Deakin & Francis |
| Taper, plate | `widthBottom`, `thicknessTop` | Base 0.28–0.40 × top (3.5–5); plate 2.2–3.0, base 1.5–2.0; 14 × 12 at US 10 ≈ 15–25 g | [S] 3.6, 2.6, 21 g |
| Engraving | `engraving.depth`, `relief` | Cast-in 0.25–0.5, stroke ≥ 0.3, depth ≤ width. Lines of 0.1–0.2 are post-polish work: a production note. Seals 0.6–1.0 as `relief` + `invert`, cut after casting, ≥ 1.2 of plate left | [R][K] |
| Flush stone | `gem.width` | ≤ (`thicknessTop` − 0.2)/0.615: 3.2 in a 2.2 plate, 4.5 in 3.0; Mohs ≥ 8. Larger: a proud `bezel` | [D][K] |
| Championship ring | separate face body | Face 20–28 (1.0–1.35·ID), rise 6–10, base 7–9 × 2.0–2.5, 40–75 g. `widthTop` stops at 14 | [S] Joy Jewelers, Avianne |
| Men's band | see §1 | 14K, US 10: 4 mm ≈ 5–6 g, 6 mm ≈ 8–10 g, 8 mm ≈ 12–15 g | [D][K] |

## 5. Style vocabularies

**What the schema cannot express** (say so; never fake it): milgrain (leave a 0.5–0.7 rail, "milgrain by maker"), enamel, filigree and hand engraving, antique and fancy cuts (old European, rose, tapered baguette, trapezoid, half-moon, polki), hidden halo, French/U-cut pavé, hollow tube, a scooped `vectorBody` back, per-region plating, pavé on chain links, bezel tennis, jade and carved stone, 21k, screw backs, hinges and box clasps, and chain styles beyond the seven (franco, herringbone, snake, paperclip).

| Style | Reads right when | Recipe (corrected) |
|---|---|---|
| **Art Deco** [S] GIA | Bilateral symmetry, step cuts, white metal, colour contrast | `emerald` (`lw` 1.4) or `asscher`; `tab`/`double` tips or `bezel` 0.6–0.7; princess sapphire or ruby halo 1.3–1.7, `gap` 0.10–0.12; baguette sides 0.55–0.70 of centre length; `flat` band 2.3–3.0 with channel stones ≤ width − 0.8; pt950 |
| **Edwardian** [S] Lang, GIA | White-on-white lace, knife-edge wires | pt950; round 5–6.5 in `bezel` 0.55 or six claws 0.8–0.9; `knifeEdge` 1.8–2.2; lace `pipe` 0.7 wide only ≥ 1.0 deep with spans ≤ 8; pear drops on 1.0 cable |
| **Victorian** [EJ-h] | Warm gold, sentiment, clusters | 18k yellow, 14k rose; daisy = 8 petals at 0.62 × centre or 6 at ≈ 1.0, each petal a `gem` + `setting` in a polar `pattern`; half hoop shared-prong 3.5 → 2.5 on a 3.9–4.1 band |
| **Art Nouveau** [S] | One asymmetric whiplash line; artistry over stone | Never `mirror`; half-round `pipe` 1.8 with tip = width·(1 − taper) ≥ 0.6 (taper thins both ends); cabochons in `bezel`; satin. Without enamel it is "Nouveau line" only |
| **Retro** [S] Lang, Macklowe | Big, bi-colour, sculptural | Rose and yellow nodes; band 6–10 × 2.5; emerald-cut aquamarine or citrine 10–14, wire 1.3–2.0; scrolls 3–6 wide; low bezel above 12 |
| **Mid-century** [EJ-m] | Sprays, textured gold starbursts | Marquise `lw` 1.9–2.1; polar rays 0.8–1.2 with taper ≤ 0.3 |
| **Minimal** [EJ-h] | Proportion and weight are the design | Band 1.8–2.0 or a 5–8 "cigar"; `bezel` 0.5–0.7 or four claws 0.9–1.1 on 6.5; low; one finish; no halo |
| **Organic** [EJ-m] | Soft mass, hand-made | `meshBody` or `pipe`; pillow `bevelSize` 0.4–0.6 × thickness leaving ≥ 0.8 edge; matte or hammered; section ≥ 1.2 |
| **Vintage-revival** [EJ-h] | Small halo, fine pavé, cathedral | Centre 6–7.5; halo as §1; pavé ≤ width − 0.8, `coverage` 120–180 |
| **Celestial / nature** [EJ-m] | Alternation reads botanical | Star `thickness` ≥ 0.65·stone + 0.4; six petals at 0.85–1.0 × centre, five at 1.3–1.4; leaves at ± 30–45° |
| **Maximalist** [EJ-m] | Scale, held steady | Centre ≥ 10; `widthTop` 4–8 plain or 2.5–4 split; wire 1.3–1.8; `euro` base |
| **Iced-out**, **heritage signet** | §2, §4 | — |

**Cultural traditions** `[EJ-m]`, labelled "-inspired"; always ask region and occasion. South Asian bridal: kundan is the foil setting, polki the uncut diamonds `[S]`; we offer 22k, matte, closed bezels 0.6–0.9. Temple: 22k `relief` 0.8–1.5 with cabochons. Middle Eastern: calligraphy only as an SVG `vectorBody`. East Asian: 24k `relief` works; jade does not exist here.

## 6. Design principles, design read, critique

**Principles** `[EJ-h]`. One hero: the second-largest stone ≤ 0.85·W. One variant per piece. Unity: ≤ 2 metal colours, ≤ 2 finishes, one prong-tip family, a motif once or at least three times. Every view is designed, including profile and back.

**Reading a reference.** Fix scale from one anchor (ring size or stone size; else assume ID 16.5 or 19.8 and say so). Record ratios, not millimetres. Halo stones: Ø ≈ (π(W + 2·offset) − N·gap)/(N − π). Never infer what one view hides.

```ts
DesignRead = {
  source: 'userRef' | 'pastPiece' | 'exemplar' | 'ownDesign', viewsSeen: View[],
  scaleAnchor: 'ringSize' | 'stoneMm' | 'assumedFinger' | 'none',
  kind: PieceKind, archetype: Archetype, variant: 'delicate' | 'classic' | 'bold',
  silhouette: { topOutline, profile: 'low' | 'classic' | 'high', symmetry },
  ratios: { stoneToFinger?, bandToStone?, taperTopToBottom?, tableHeightToStone?, haloToStone?,
            sideToCenter?, prongToStone?, chainToPendant?, bailToPendant?, thicknessToHeight?,
            metalVisibleFraction? },                    // each { value, confidence 0–1 }
  centre?: { cut, lw, setting, prongCount?, prongTip?, orientation: 'NS' | 'EW' },
  stones: { role, cut, setting, count? }[], shank?: { profile, shoulder, split, coverageDeg? },
  metal: { colours, finishes, twoTone }, motifs: string[], styleTags: string[],
  mood: string[], distinctive: string[],                // ≤ 3 each
  notVisible: string[], uncertain: { field, why }[] }
```

Two reads diff field by field; a ratio more than 25 % off a reference the client did not ask to change is a finding.

**Rubric.** Kernel diagnostics and lints gate first. Score 5 / 3 / 1; any 1, or two 3s on criteria 1–4, triggers a fix.

| # | Criterion | Judged by | 5 | 1 |
|---|---|---|---|---|
| 1 | Focal hierarchy | vision | One element wins in a blink | Two equals, or the hero lost in metal |
| 2 | Proportion and body scale | numbers | Every ratio inside one variant | Any ratio outside all bands |
| 3 | Silhouette | vision | Recognisable at 64 px | Blobby or ambiguous |
| 4 | Fidelity to brief and references | both | Categoricals match, ratios ≤ 15 % | Different archetype, cut or prong count |
| 5 | Line and flow | vision | Shoulders run into the head | Head looks stuck on |
| 6 | Profile and under-gallery | vision | Considered from the side and below | Bare sticks or a solid block |
| 7 | Rhythm and stone layout | both | Even spacing, clean row ends | Ragged ends, bald patches |
| 8 | Unity | numbers | Meets the unity rule | Three or more vocabularies |
| 9 | Wearability | numbers | Height, mass and edges in class | Snag-prone, overweight |
| 10 | Durability and make | numbers | Above floors with polish allowance | Will not survive casting |

**Failure modes of generated jewelry** (lint seeds; Rapaport `[S]` reports the same): fat prongs; a "lollipop" head; band and stone mismatch; a "tyre" halo; no hierarchy; a dead under-gallery; a row hitting the head; ragged pavé; illegible iced text; default scale (a hip-hop pendant left at 22 mm); an under-built bail; a front-only design.

**Directions.** Show 2–3. Each pair differs on at least two axes: silhouette, setting vocabulary, variant, profile, surface. Hold constant what the client fixed. Spread: faithful, refined, stretch. Name each in 2–4 words, no brands; give one sentence of rationale, three facts (grams, carats, height) and one trade-off, on identical renders `[EJ-h]`.

**Briefing.** Ask only what changes geometry or cost, at most three questions a turn: size, stone, metal, active hands, flush-fit band (bridal); face size and content (signet); artwork, height, ice level, stone tier, chain (iced). Never ask for prong wire, elevation, gaps or margins `[EJ-h]`.

## 7. Reference-grounded agent practice

| Finding | Decision |
|---|---|
| CADSmith `[S]`: kernel measurements plus an independent vision judge cut mean Chamfer 28.4 → 0.74 (18.2 without the judge). CADCodeVerify `[S]`: VLM critique alone ≈ 7 % | Numbers gate; pixels judge gestalt only |
| CADCodeVerify, UICrit `[S]`: exemplars and reference images each help (+ 55 % over zero-shot) | Retrieve k = 3 by archetype, similarity, then diversity |
| BlindTest `[S]`: 58.6 % on overlap and counting; Anthropic vision docs (fetched): counts are approximate | Never count or measure from pixels |
| Paper2Poster, Set-of-Mark `[S]`: zoomed regions and good/bad examples make critique reliable | `focusNodeIds`, `annotate`, anti-exemplars |
| CADSmith, MM-SY `[S]`: a judge that sees the author's opinion sides with it | Fresh-context critic, different model, two rounds |
| Verbalized Sampling `[S]`: asking for a set beats repeated single samples | One call, three directions, named defaults banned |
| MT-Bench, Anthropic evals guide (fetched): pairwise with order swap; code, model and human graders | Section 5 of the brief |

Loop constants (k = 3, MMR 0.7, two rounds) are `[EJ-m]` pending the ablations in the brief.

## Decisions for Pavé

- **The canon is data.** `@pave/canon` holds rules, style guides and exemplars with source and confidence; nothing here is hard-coded in prompts or recipes.
- **The kernel outranks the canon.** No canon default may trip a kernel warning; a test builds every exemplar and template to prove it. Canon lints are warnings and notes, never errors.
- **Absolute sizes with clamps, not bare ratios.** Ratios hold only near 1 ct or near 60 mm.
- **Lint derived quantities from the evaluation** (table drop, halo outline, stone count, mass per ear), not raw parameters.
- **Honest gaps.** The assistant names what it cannot build and offers the nearest stand-in plus a maker note.
- **Recipe fixes:** elevation from the head class, not 1.2; halo melee from W; `basket` from 4.5 mm; side elevation solved from table drop; `skipCenter` from the head; iced `sizeMax` from H, not 1.8. Keep the prong formula and the three-stone spacing constant.
- **Kernel and schema work this exposed:** index halo stones round claws and widen its 0.25 border; a cut-down pavé style; a hidden-halo mode; tapered baguette, trapezoid and half-moon cuts; `gemRow` on non-ring hosts; a `vectorBody` scoop; per-region plating; a size-aware `prong.small`; a diagnostic for low-set seats thinning the band; a wearability class on gem materials; Cuban mass calibration; screw-back and box-clasp findings.
- **Grounding:** design read before geometry, three directions before a build, numbers before pixels, an independent critic.

## Verification gaps

No source page was fetched; hosts to allow: `4cs.gia.edu`, `www.gia.edu`, `www.ganoksin.com`, `www.langantiques.com`, `www.ifandco.com`, `arxiv.org`. Cathedral limits and `skipCenter` angles were computed from kernel code, not run. Hip-hop proportions rest on retailer listings and judgement; cultural rows, hoop limits and pendant-mass bands are judgement. Confirm wall, bead and gap rules with a caster and a setter.
