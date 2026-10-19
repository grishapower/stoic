/**
 * Trees: leaf rustle that breathes with the wind, plus soft insects at dusk.
 *
 *  - Distant canopy bed (non-positional stereo rustle) — "wind in the trees"
 *    is present from the first second, even before configure().
 *  - A small pool of positional rustle emitters that follow the listener: every
 *    second the pool is re-assigned to the nearest foliage centres (fade out →
 *    move → fade in), so a few panners cover any number of trees.
 *  - Insects (timeOfDay → 1): a distant cicada chorus and crickets — one
 *    distant, one riding a foliage emitter.
 *
 * Emitter: rustle → HPF → BPF → leaves (∝ wind²) → gate (swap fade) → panner (HRTF) → out
 */
import type { SoundBank } from './bank'
import type { Vec3Like } from './contract'
import { createPanner, nearestIndices, placePanner, type ListenerState } from './spatial'
import { clamp, lerp, loopSource, makeFilter, makeGain, rand, randRange, setParam, smoothstep, teardown } from './synth'

/* ------------------------------------------------------------- tuning */

const EMITTERS = 4
const REF_DISTANCE = 4
const ROLLOFF = 1.1
/** Added to the given foliage centre height (0 = use the y passed to configure, assumed canopy height), m. */
const CANOPY_LIFT = 0
const REASSIGN_EVERY = 1
const SWAP_FADE_TC = 0.35
const SWAP_TIME = 1.4

const LEAVES_LEVEL = 0.4
/** Fraction of LEAVES_LEVEL left in still air. */
const LEAVES_FLOOR = 0.18
const LEAVES_HPF_HZ = 900
const LEAVES_BPF: [number, number] = [2300, 3600]
const LEAVES_Q = 0.8

const DISTANT_LEVEL = 0.16
const DISTANT_BPF_HZ = 3200
const DISTANT_Q = 0.5

const CRICKET_LEVEL = 0.08
const CRICKET_DISTANT_LEVEL = 0.05
const CRICKET_LPF_HZ = 7000
/** timeOfDay window where crickets fade in. */
const CRICKET_FADE: [number, number] = [0.55, 0.95]

const CICADA_LEVEL = 0.03
const CICADA_BPF_HZ = 5200
const CICADA_Q = 1.2
const CICADA_FADE_IN: [number, number] = [0.25, 0.7]
/** Cicadas thin out to half right at sunset. */
const CICADA_FADE_OUT: [number, number] = [0.85, 1]
const CICADA_SWELL_EVERY: [number, number] = [4, 12]
const CICADA_SWELL_TC: [number, number] = [1.5, 4]
const CICADA_SWELL: [number, number] = [0.35, 1]

const PARAM_TC = 0.35
const TOD_TC = 3

/* ------------------------------------------------------------- types */

interface LeafEmitter {
  panner: PannerNode
  gate: GainNode
  leaves: GainNode
  bp: BiquadFilterNode
  bpScale: number
  nodes: AudioNode[]
  index: number
  pending: number
  swapAt: number
  cricket: GainNode | null
}

/* ------------------------------------------------------------- system */

export class Foliage {
  private readonly ctx: BaseAudioContext
  private readonly bank: SoundBank
  private readonly out: AudioNode
  private readonly bedNodes: AudioNode[] = []
  private readonly distantGain: GainNode
  private emitters: LeafEmitter[] = []
  private points: Vec3Like[] = []
  private readonly nearest = new Int32Array(EMITTERS)
  private nextAssign = 0
  private timeOfDay = 0

  private insectsReady = false
  private cicadaGain: GainNode | null = null
  private cricketDistantGain: GainNode | null = null
  private cicadaSwell = 0.6
  private cicadaSwellTc = 2
  private nextSwell = 0

  constructor(ctx: BaseAudioContext, bank: SoundBank, out: AudioNode) {
    this.ctx = ctx
    this.bank = bank
    this.out = out
    const a = loopSource(ctx, bank.rustleA, rand(0.95, 1.05))
    const b = loopSource(ctx, bank.rustleB, rand(0.95, 1.05))
    const merge = ctx.createChannelMerger(2)
    a.connect(merge, 0, 0)
    b.connect(merge, 0, 1)
    const bp = makeFilter(ctx, 'bandpass', DISTANT_BPF_HZ, DISTANT_Q)
    this.distantGain = makeGain(ctx, 0)
    merge.connect(bp).connect(this.distantGain).connect(out)
    this.bedNodes.push(a, b, merge, bp, this.distantGain)
  }

  /** Foliage centres changed: rebuild the emitter pool. */
  setPoints(points: readonly Vec3Like[]): void {
    this.points = points.map((p) => ({ x: p.x, y: p.y + CANOPY_LIFT, z: p.z }))
    for (const e of this.emitters) teardown(e.nodes)
    this.emitters = []
    const n = Math.min(EMITTERS, this.points.length)
    for (let i = 0; i < n; i++) this.emitters.push(this.buildEmitter(i === n - 1 && this.insectsReady))
    this.nextAssign = 0
  }

  private buildEmitter(withCricket: boolean): LeafEmitter {
    const ctx = this.ctx
    const panner = createPanner(ctx, { refDistance: REF_DISTANCE, rolloff: ROLLOFF })
    const gate = makeGain(ctx, 0)
    gate.connect(panner).connect(this.out)
    const src = loopSource(ctx, Math.random() < 0.5 ? this.bank.rustleA : this.bank.rustleB, rand(0.9, 1.1))
    const hp = makeFilter(ctx, 'highpass', LEAVES_HPF_HZ, 0.6)
    const bpScale = rand(0.88, 1.12)
    const bp = makeFilter(ctx, 'bandpass', LEAVES_BPF[0] * bpScale, LEAVES_Q)
    const leaves = makeGain(ctx, 0)
    src.connect(hp).connect(bp).connect(leaves).connect(gate)
    const nodes: AudioNode[] = [panner, gate, src, hp, bp, leaves]
    let cricket: GainNode | null = null
    if (withCricket) cricket = this.attachCricket(gate, nodes)
    return { panner, gate, leaves, bp, bpScale, nodes, index: -1, pending: -1, swapAt: 0, cricket }
  }

  private attachCricket(dest: AudioNode, nodes: AudioNode[]): GainNode {
    const ctx = this.ctx
    const src = loopSource(ctx, this.bank.cricket, 0.94)
    const lp = makeFilter(ctx, 'lowpass', CRICKET_LPF_HZ, 0.5)
    const g = makeGain(ctx, 0)
    src.connect(lp).connect(g).connect(dest)
    nodes.push(src, lp, g)
    return g
  }

  /** Render insect buffers and start them (called a little after unlock). */
  enableInsects(): void {
    if (this.insectsReady) return
    const ctx = this.ctx
    // Distant cicada chorus (stereo, decorrelated).
    const c1 = loopSource(ctx, this.bank.cicada, 1)
    const c2 = loopSource(ctx, this.bank.cicada, 0.985)
    const merge = ctx.createChannelMerger(2)
    c1.connect(merge, 0, 0)
    c2.connect(merge, 0, 1)
    const bp = makeFilter(ctx, 'bandpass', CICADA_BPF_HZ, CICADA_Q)
    this.cicadaGain = makeGain(ctx, 0)
    merge.connect(bp).connect(this.cicadaGain).connect(this.out)
    // A distant cricket, off to one side.
    const cr = loopSource(ctx, this.bank.cricket, 1.07)
    const pan = ctx.createStereoPanner()
    pan.pan.value = rand(-0.6, -0.35)
    const lp = makeFilter(ctx, 'lowpass', CRICKET_LPF_HZ * 0.7, 0.5)
    this.cricketDistantGain = makeGain(ctx, 0)
    cr.connect(lp).connect(pan).connect(this.cricketDistantGain).connect(this.out)
    this.bedNodes.push(c1, c2, merge, bp, this.cicadaGain, cr, lp, pan, this.cricketDistantGain)
    // A nearer cricket riding the last foliage emitter.
    const last = this.emitters[this.emitters.length - 1]
    if (last && !last.cricket) last.cricket = this.attachCricket(last.gate, last.nodes)
    this.insectsReady = true
  }

  setTimeOfDay(t: number): void {
    this.timeOfDay = clamp(t, 0, 1)
  }

  update(now: number, wind: number, listener: ListenerState): void {
    const gust = lerp(LEAVES_FLOOR, 1, wind * wind)
    setParam(this.distantGain.gain, DISTANT_LEVEL * gust, now, PARAM_TC)

    if (this.emitters.length > 0 && listener.valid) {
      if (now >= this.nextAssign) {
        this.nextAssign = now + REASSIGN_EVERY
        this.assign(now, listener)
      }
      for (const e of this.emitters) {
        if (e.pending >= 0 && now >= e.swapAt) {
          const p = this.points[e.pending]
          placePanner(e.panner, p.x, p.y, p.z, now, 0)
          e.index = e.pending
          e.pending = -1
          setParam(e.gate.gain, 1, now, SWAP_FADE_TC)
        }
        setParam(e.leaves.gain, LEAVES_LEVEL * gust, now, PARAM_TC)
        setParam(e.bp.frequency, lerp(LEAVES_BPF[0], LEAVES_BPF[1], wind) * e.bpScale, now, PARAM_TC)
      }
    }

    if (this.insectsReady) {
      const t = this.timeOfDay
      const crickets = smoothstep(CRICKET_FADE[0], CRICKET_FADE[1], t)
      if (this.cricketDistantGain) setParam(this.cricketDistantGain.gain, CRICKET_DISTANT_LEVEL * crickets, now, TOD_TC)
      for (const e of this.emitters) if (e.cricket) setParam(e.cricket.gain, CRICKET_LEVEL * crickets, now, TOD_TC)
      if (now >= this.nextSwell) {
        this.nextSwell = now + randRange(CICADA_SWELL_EVERY)
        this.cicadaSwell = randRange(CICADA_SWELL)
        this.cicadaSwellTc = randRange(CICADA_SWELL_TC)
      }
      const cic = smoothstep(CICADA_FADE_IN[0], CICADA_FADE_IN[1], t) * (1 - 0.5 * smoothstep(CICADA_FADE_OUT[0], CICADA_FADE_OUT[1], t))
      if (this.cicadaGain) setParam(this.cicadaGain.gain, CICADA_LEVEL * cic * this.cicadaSwell, now, this.cicadaSwellTc)
    }
  }

  /** Point the emitter pool at the nearest foliage centres (swap with a fade). */
  private assign(now: number, l: ListenerState): void {
    const n = nearestIndices(this.points, l.x, l.y, l.z, this.emitters.length, this.nearest)
    for (let k = 0; k < n; k++) {
      const idx = this.nearest[k]
      if (idx < 0) continue
      let covered = false
      for (const e of this.emitters) {
        if (e.index === idx || e.pending === idx) {
          covered = true
          break
        }
      }
      if (covered) continue
      // Prefer an unassigned emitter, else one whose centre is no longer among the nearest.
      let target: LeafEmitter | null = null
      for (const e of this.emitters) {
        if (e.pending >= 0) continue
        if (e.index < 0) {
          target = e
          break
        }
        let stillNear = false
        for (let j = 0; j < n; j++) {
          if (this.nearest[j] === e.index) {
            stillNear = true
            break
          }
        }
        if (!stillNear) {
          target = e
          break
        }
      }
      if (!target) continue
      target.pending = idx
      if (target.index < 0) {
        target.swapAt = now // first placement: no fade-out needed
      } else {
        target.swapAt = now + SWAP_TIME
        setParam(target.gate.gain, 0, now, SWAP_FADE_TC)
      }
    }
  }

  dispose(): void {
    for (const e of this.emitters) teardown(e.nodes)
    this.emitters = []
    teardown(this.bedNodes)
  }
}
