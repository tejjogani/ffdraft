/**
 * Design-for-manufacture thresholds the kernel checks while it builds, in millimetres.
 *
 * These are the defaults of a Stuller-like manufacturer profile; `src/dfm` layers editable
 * profiles and whole-piece analysis (wall thickness, openings) on top. Sources are the tables
 * in docs/research/01-cad.md §2 and docs/research/02-production.md §3 / "DFM checks".
 */
export const RULES = {
  /** Daily-wear shank thickness (01-cad §2: ≥ 1.5 mm, 1.3 mm absolute floor). */
  shankThickness: { warn: 1.5, error: 1.0 },
  /** Solitaire shank width (01-cad §2: ≥ 1.8–2.0 mm; below 1.5 mm bands bend). */
  shankWidth: { warn: 1.5 },
  /** Cast claws: ≥ 0.8 mm for long unsupported prongs, 0.45 mm absolute (02-production §3). */
  prongDiameter: { warn: 0.8, error: 0.45 },
  /** Centre-stone prong wire: ≈ 0.08·d + 0.3 mm (01-cad §2). */
  prongForStone: (stoneWidth: number): number => 0.08 * stoneWidth + 0.3,
  /** Accent-stone prongs by stone size (JewelCraft presets, 01-cad §2). */
  accentProng: (stoneWidth: number): number =>
    stoneWidth >= 2.5 ? 0.8 : stoneWidth >= 1.7 ? 0.7 : stoneWidth >= 1.5 ? 0.6 : stoneWidth >= 1.2 ? 0.5 : 0.45,
  /** Bezel wall: Stuller's minimum (02-production "DFM checks": below 0.45 mm is an error). */
  bezelWall: { error: 0.45 },
  /** Channel wall beside melee (Stuller ≥ 0.40 mm). */
  channelWall: 0.4,
  /** Prong overlap onto the stone: 0.15 mm or 15 % of the prong wire (Stuller spec sheet). */
  prongOverlap: (prongDiameter: number): number => Math.max(0.15, prongDiameter * 0.15),
  /** Seat cutters are cut at 98 % of the girdle; the setter opens the seat (Stuller). */
  seatScale: 0.98,
  /** Drill hole under a pavé stone ≈ 0.6 × its diameter (JewelCraft 0.66, RhinoArtisan 0.55). */
  seatHole: 0.6,
  /** Pavé beads: 0.4–0.5 mm, ≈ 30 % of the stone, never below 0.3 mm (Stuller; 01-cad §2). */
  beadDiameter: (stoneWidth: number): number => Math.min(0.5, Math.max(0.3, stoneWidth * 0.3)),
  /** Metal that must stay between a culet and the finger (01-cad §2: 0.2–0.3 mm). */
  culetClearance: 0.2,
  /**
   * Least metal either side of a stone set into a band. Below this the stone is effectively
   * wider than its band; the 0.5 mm pavé border of GIA's guidance is a `src/dfm` check.
   */
  stoneBorder: 0.2,
  /** Engraving: recess ≤ 0.5 mm deep (02-production §3). */
  engravingDepth: { max: 0.5 },
} as const
