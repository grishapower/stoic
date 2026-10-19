import type { Quality } from '../store'

/**
 * Rendering budget per quality level — the single place to tune draw
 * distances, LOD radii and shadows. 'low' is the standalone-VR preset
 * (auto-selected in the Quest browser): ≤ ~0.9 M triangles and ≤ ~150 draw
 * calls per eye including the shadow pass. Instance *counts* for scattered
 * things live next to their placement code: grass below, flowers in
 * world/flowers.ts (COUNT_SCALE), CC0 scatter in world/scatter.ts
 * (SCATTER_SCALE), creatures in life/config.ts (LIFE_COUNTS). The canvas DPR
 * is in App.tsx.
 *
 * Distances are metres from the camera.
 */
export interface QualityProfile {
  /** Sun shadow: half-size of the orthographic frustum, map size, re-render every N frames. */
  shadowHalf: number
  shadowMap: number
  shadowEvery: number
  /** Re-bake the sky's IBL environment every this many degrees of sun elevation. */
  envStepDeg: number
  /**
   * Trees: leaf cards + full canopy closer than `treeDetail`, solid far LOD beyond; shadows closer than
   * `treeShadow` (a shorter shadow radius than the detail radius costs an extra draw call per variant).
   */
  treeDetail: number
  treeShadow: number
  /** Shrubs (myrtle, rosemary, oleander): same, plus a cut-off for the far LOD. */
  shrubDetail: number
  shrubShadow: number
  shrubFar: number
  /** Cypress and citrus: draw the trunk inside the canopy core mesh in a flat bark tone (one draw call less per variant). */
  mergeNearTrunks: boolean
  /**
   * Far LOD in a lighter material (dense leaf texture in the leaves' tone) instead of the dark distant-canopy one —
   * needed when the far LOD starts only a few metres away.
   */
  farLit: boolean
  /** Near / far LOD use only this many shape variants per tree species and per shrub kind (fewer draw calls; citrus keeps all). */
  treeVariants: number
  shrubVariants: number
  farVariants: number
  /** Dry grass and the peristyle lawn: blade counts, segments per blade, fade-out band. */
  grass: { count: number; lawn: number; segments: number; fade: [number, number] }
  /** Flowers shrink away over this band (and their chunks are culled beyond it). */
  flowerFade: [number, number]
  /**
   * CC0 plants along the walk: drawn closer than `plantFar`, shadows closer than `plantShadow`; do the cove's rocks cast
   * shadows; the cove (rocks, jetty, ice plant) is drawn up to `coveFar` (it is only looked at from the terrace).
   */
  scatter: { plantFar: number; plantShadow: number; rockShadow: boolean; maxVariants: number; coveFar: number }
  /** Citrus fruit: full model closer than this, a light sphere beyond. */
  fruitDetail: number
  /** GLB props: hidden beyond min(maxFar, max(minFar, size × farPerMetre)); shadows only within `shadow` and for props larger than `minShadowSize`. */
  props: { farPerMetre: number; minFar: number; maxFar: number; shadow: number; minShadowSize: number }
  /** Boats on the bay: Meshy models (true) or the light procedural boats. */
  bayModels: boolean
}

export const QUALITY: Record<Quality, QualityProfile> = {
  high: {
    shadowHalf: 40,
    shadowMap: 2048,
    shadowEvery: 1,
    envStepDeg: 0.5,
    treeDetail: 75,
    treeShadow: 75,
    shrubDetail: 75,
    shrubShadow: 75,
    shrubFar: 400,
    mergeNearTrunks: false,
    farLit: false,
    treeVariants: 3,
    shrubVariants: 2,
    farVariants: 2,
    grass: { count: 65000, lawn: 16000, segments: 3, fade: [26, 42] },
    flowerFade: [32, 48],
    scatter: { plantFar: 100, plantShadow: 40, rockShadow: true, maxVariants: 5, coveFar: Infinity },
    fruitDetail: 7,
    props: { farPerMetre: 160, minFar: 35, maxFar: Infinity, shadow: 45, minShadowSize: 0.2 },
    bayModels: true,
  },
  medium: {
    shadowHalf: 32,
    shadowMap: 2048,
    shadowEvery: 1,
    envStepDeg: 1,
    treeDetail: 50,
    treeShadow: 50,
    shrubDetail: 28,
    shrubShadow: 28,
    shrubFar: 160,
    mergeNearTrunks: false,
    farLit: true,
    treeVariants: 3,
    shrubVariants: 2,
    farVariants: 1,
    grass: { count: 38000, lawn: 9000, segments: 3, fade: [20, 32] },
    flowerFade: [24, 36],
    scatter: { plantFar: 42, plantShadow: 18, rockShadow: true, maxVariants: 3, coveFar: 160 },
    fruitDetail: 4,
    props: { farPerMetre: 100, minFar: 22, maxFar: 220, shadow: 30, minShadowSize: 0.4 },
    bayModels: true,
  },
  low: {
    shadowHalf: 22,
    shadowMap: 1024,
    shadowEvery: 2,
    envStepDeg: 2.5,
    treeDetail: 24,
    treeShadow: 22,
    shrubDetail: 12,
    shrubShadow: 0,
    shrubFar: 70,
    mergeNearTrunks: true,
    farLit: true,
    treeVariants: 2,
    shrubVariants: 1,
    farVariants: 1,
    grass: { count: 18000, lawn: 5000, segments: 2, fade: [12, 19] },
    flowerFade: [13, 20],
    scatter: { plantFar: 20, plantShadow: 0, rockShadow: false, maxVariants: 2, coveFar: 55 },
    fruitDetail: 1.8,
    props: { farPerMetre: 22, minFar: 10, maxFar: 70, shadow: 14, minShadowSize: 0.7 },
    bayModels: false,
  },
}
