/**
 * Wind: a slow random "wind strength" model (0..1) shared by every system
 * that should breathe with the gusts (leaves), plus the non-positional wind bed.
 *
 * Bed graph (stereo, decorrelated L/R):
 *   brownL/R → merger → HPF 45 → LPF (drifts 240–950 Hz with strength) → bed gain ─┐
 *   pinkL/R  → merger → BPF (650–1500 Hz, Q 0.6) → air gain (∝ w^1.5) ─────────────┴→ out
 */
import type { SoundBank } from './bank'
import { clamp, lerp, loopSource, makeFilter, makeGain, rand, randRange, setParam, smoothstep, TAU, teardown } from './synth'

/* ------------------------------------------------------------- tuning */

/** Average wind strength when not overridden (0..1). */
const WIND_BASE = 0.42
/** Evening calm: base strength is reduced by this fraction at timeOfDay = 1. */
const EVENING_CALM = 0.3
/** Slow meander amplitudes and periods (s). */
const MEANDER: readonly (readonly [number, number])[] = [
  [0.16, 31],
  [0.09, 13.7],
  [0.04, 5.3],
]
/** Gusts: gap between gusts, amplitude, attack, hold, release (s). */
const GUST_GAP: [number, number] = [6, 22]
const GUST_AMP: [number, number] = [0.15, 0.42]
const GUST_ATTACK: [number, number] = [1.4, 3.2]
const GUST_HOLD: [number, number] = [0.3, 1.8]
const GUST_RELEASE: [number, number] = [3, 7]

/** Brown-noise bed: gain at w = 1, and the fraction left at w = 0. */
const BED_LEVEL = 0.2
const BED_FLOOR = 0.35
const BED_HPF_HZ = 45
const BED_LPF_MIN = 240
const BED_LPF_MAX = 950
/** Airy pink-noise "whoosh" (∝ w^1.5). */
const AIR_LEVEL = 0.18
const AIR_BPF_MIN = 650
const AIR_BPF_MAX = 1500
const AIR_Q = 0.6
/** Param glide (s). */
const PARAM_TC = 0.4

/* ------------------------------------------------------------- model */

export class WindModel {
  /** Current strength 0..1 (updated by `update`). */
  value = WIND_BASE
  private override: number | null = null
  private evening = 0
  private readonly phases = MEANDER.map(() => rand(0, TAU))
  private gustStart = 0
  private gustAmp = 0
  private gustA = 1
  private gustH = 1
  private gustR = 1
  private nextGust: number

  constructor(now: number) {
    this.nextGust = now + rand(2, 7)
  }

  setOverride(v: number | null): void {
    this.override = v === null || !Number.isFinite(v) ? null : clamp(v, 0, 1)
  }

  setTimeOfDay(t: number): void {
    this.evening = clamp(t, 0, 1)
  }

  update(now: number): number {
    const base = this.override ?? WIND_BASE * (1 - EVENING_CALM * this.evening)
    let meander = 0
    for (let i = 0; i < MEANDER.length; i++) {
      const [amp, period] = MEANDER[i]
      meander += amp * Math.sin((TAU * now) / period + this.phases[i])
    }
    if (now >= this.nextGust) {
      this.gustStart = now
      this.gustAmp = randRange(GUST_AMP)
      this.gustA = randRange(GUST_ATTACK)
      this.gustH = randRange(GUST_HOLD)
      this.gustR = randRange(GUST_RELEASE)
      this.nextGust = now + this.gustA + this.gustH + this.gustR + randRange(GUST_GAP)
    }
    const g = now - this.gustStart
    let gust = 0
    if (g < this.gustA) gust = smoothstep(0, this.gustA, g)
    else if (g < this.gustA + this.gustH) gust = 1
    else gust = 1 - smoothstep(this.gustA + this.gustH, this.gustA + this.gustH + this.gustR, g)
    // Variation scales with the base so a calm override stays calm.
    const scale = 0.4 + 0.6 * base
    this.value = clamp(base + meander * scale + gust * this.gustAmp * scale, 0, 1)
    return this.value
  }
}

/* ------------------------------------------------------------- bed */

export class WindBed {
  private readonly nodes: AudioNode[]
  private readonly bedLp: BiquadFilterNode
  private readonly bedGain: GainNode
  private readonly airBp: BiquadFilterNode
  private readonly airGain: GainNode

  constructor(ctx: BaseAudioContext, bank: SoundBank, out: AudioNode) {
    const bL = loopSource(ctx, bank.brownA, rand(0.97, 1.03))
    const bR = loopSource(ctx, bank.brownB, rand(0.97, 1.03))
    const bMerge = ctx.createChannelMerger(2)
    bL.connect(bMerge, 0, 0)
    bR.connect(bMerge, 0, 1)
    const hp = makeFilter(ctx, 'highpass', BED_HPF_HZ, 0.7)
    this.bedLp = makeFilter(ctx, 'lowpass', BED_LPF_MIN, 0.5)
    this.bedGain = makeGain(ctx, BED_LEVEL * BED_FLOOR)
    bMerge.connect(hp).connect(this.bedLp).connect(this.bedGain).connect(out)

    const pL = loopSource(ctx, bank.pinkA, rand(0.97, 1.03))
    const pR = loopSource(ctx, bank.pinkB, rand(0.97, 1.03))
    const pMerge = ctx.createChannelMerger(2)
    pL.connect(pMerge, 0, 0)
    pR.connect(pMerge, 0, 1)
    this.airBp = makeFilter(ctx, 'bandpass', AIR_BPF_MIN, AIR_Q)
    this.airGain = makeGain(ctx, 0)
    pMerge.connect(this.airBp).connect(this.airGain).connect(out)

    this.nodes = [bL, bR, bMerge, hp, this.bedLp, this.bedGain, pL, pR, pMerge, this.airBp, this.airGain]
  }

  update(w: number, now: number): void {
    setParam(this.bedGain.gain, BED_LEVEL * lerp(BED_FLOOR, 1, w), now, PARAM_TC)
    setParam(this.bedLp.frequency, lerp(BED_LPF_MIN, BED_LPF_MAX, Math.pow(w, 1.3)), now, PARAM_TC)
    setParam(this.airGain.gain, AIR_LEVEL * Math.pow(w, 1.5), now, PARAM_TC)
    setParam(this.airBp.frequency, lerp(AIR_BPF_MIN, AIR_BPF_MAX, w), now, PARAM_TC)
  }

  dispose(): void {
    teardown(this.nodes)
  }
}
