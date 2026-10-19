/**
 * Sea below the cliffs: a few positional emitters along the shoreline, each
 * with irregular swells (6–12 s): a low rumble that rises and falls, then a
 * delayed foam hiss whose brightness recedes as the wash draws back.
 *
 * Per emitter:
 *   brown → LPF 260 → rumble env ─┐
 *   pink  → HPF 650 → LPF (swept) → foam env ─┴→ distance gain → air LPF → panner → out
 *
 * Besides the inverse law, distance adds extra attenuation and a lowpass
 * (cliff occlusion + air), so the sea is a faint low murmur in the garden and
 * clear, bright and wide at the terrace.
 */
import type { SoundBank } from './bank'
import type { Vec3Like } from './contract'
import { createPanner, distanceTo, placePanner, type ListenerState } from './spatial'
import { chance, lerp, loopSource, makeFilter, makeGain, rand, randRange, setParam, smoothstep, teardown } from './synth'

/* ------------------------------------------------------------- tuning */

const MAX_EMITTERS = 4
const REF_DISTANCE = 25
const ROLLOFF = 1
/** Broad distant source: equal-power panning is cheaper and sounds wider than HRTF here. */
const PANNING: PanningModelType = 'equalpower'
/** Extra distance shaping (m): gain → FAR_GAIN and air LPF → LPF_FAR between these. */
const FAR_START = 45
const FAR_END = 120
const FAR_GAIN = 0.4
const LPF_NEAR = 9000
const LPF_FAR = 1300

/** Constant floor so the sea never fully stops. */
const RUMBLE_FLOOR = 0.12
const FOAM_FLOOR = 0.03
const RUMBLE_LPF_HZ = 260
const FOAM_HPF_HZ = 650

const WAVE_PERIOD: [number, number] = [6, 12]
const WAVE_AMP: [number, number] = [0.55, 1]
/** Occasional bigger "set" wave. */
const SET_WAVE_CHANCE = 0.15
const SET_WAVE_BOOST = 1.3

const RUMBLE_PEAK = 0.35
const RUMBLE_RISE_TC = 0.9
const RUMBLE_RISE: [number, number] = [1.8, 2.6]
const RUMBLE_DECAY_TC = 1.5

const FOAM_PEAK = 0.36
const FOAM_DELAY: [number, number] = [1.3, 1.9]
const FOAM_RISE_TC = 0.25
const FOAM_HOLD: [number, number] = [0.5, 0.9]
const FOAM_DECAY_TC: [number, number] = [1.4, 2.2]
const FOAM_LPF_BRIGHT = 5500
const FOAM_LPF_DARK = 1600

const LOOKAHEAD = 0.5

/* ------------------------------------------------------------- helpers */

function spreadPick(points: readonly Vec3Like[], k: number): Vec3Like[] {
  if (points.length <= k) return points.slice()
  const chosen: Vec3Like[] = [points[0]]
  while (chosen.length < k) {
    let best = points[0]
    let bestD = -1
    for (const p of points) {
      let dmin = Infinity
      for (const c of chosen) dmin = Math.min(dmin, distanceTo(c, p.x, p.y, p.z))
      if (dmin > bestD) {
        bestD = dmin
        best = p
      }
    }
    chosen.push(best)
  }
  return chosen
}

/* ------------------------------------------------------------- system */

interface Emitter {
  pos: Vec3Like
  panner: PannerNode
  dist: GainNode
  air: BiquadFilterNode
  rumble: GainNode
  foam: GainNode
  foamLp: BiquadFilterNode
  nextWave: number
}

export class Sea {
  private readonly ctx: BaseAudioContext
  private readonly bank: SoundBank
  private readonly out: AudioNode
  private emitters: Emitter[] = []
  private nodes: AudioNode[] = []

  constructor(ctx: BaseAudioContext, bank: SoundBank, out: AudioNode, points: readonly Vec3Like[]) {
    this.ctx = ctx
    this.bank = bank
    this.out = out
    this.setPoints(points)
  }

  /** Use up to MAX_EMITTERS shoreline points, spread out (farthest-point sampling; order-independent). */
  setPoints(points: readonly Vec3Like[]): void {
    const chosen = spreadPick(points, MAX_EMITTERS)
    const now = this.ctx.currentTime
    // Reuse emitters where possible; build or drop the rest.
    for (let i = 0; i < chosen.length; i++) {
      const p = { x: chosen[i].x, y: chosen[i].y, z: chosen[i].z }
      const em = this.emitters[i]
      if (em) {
        em.pos = p
        placePanner(em.panner, p.x, p.y, p.z, now, 0)
      } else {
        this.emitters.push(this.build(p, now + rand(0.3, 2) + i * rand(1.5, 3.5)))
      }
    }
    if (this.emitters.length > chosen.length) {
      // Rare (re-configure with fewer points): rebuild everything.
      teardown(this.nodes)
      this.nodes = []
      const keep = this.emitters.slice(0, chosen.length).map((e) => e.pos)
      this.emitters = []
      keep.forEach((p, i) => this.emitters.push(this.build(p, now + 0.5 + i * 2)))
    }
  }

  private build(pos: Vec3Like, firstWave: number): Emitter {
    const ctx = this.ctx
    const panner = createPanner(ctx, { refDistance: REF_DISTANCE, rolloff: ROLLOFF, model: PANNING }, pos)
    const air = makeFilter(ctx, 'lowpass', LPF_FAR, 0.5)
    const dist = makeGain(ctx, 0)
    dist.connect(air).connect(panner).connect(this.out)

    const brown = loopSource(ctx, Math.random() < 0.5 ? this.bank.brownA : this.bank.brownB, rand(0.9, 1.1))
    const rLp = makeFilter(ctx, 'lowpass', RUMBLE_LPF_HZ, 0.5)
    const rumble = makeGain(ctx, RUMBLE_FLOOR)
    brown.connect(rLp).connect(rumble).connect(dist)

    const pink = loopSource(ctx, Math.random() < 0.5 ? this.bank.pinkA : this.bank.pinkB, rand(0.9, 1.1))
    const fHp = makeFilter(ctx, 'highpass', FOAM_HPF_HZ, 0.6)
    const foamLp = makeFilter(ctx, 'lowpass', FOAM_LPF_DARK, 0.5)
    const foam = makeGain(ctx, FOAM_FLOOR)
    pink.connect(fHp).connect(foamLp).connect(foam).connect(dist)

    this.nodes.push(panner, air, dist, brown, rLp, rumble, pink, fHp, foamLp, foam)
    return { pos, panner, dist, air, rumble, foam, foamLp, nextWave: firstWave }
  }

  update(now: number, listener: ListenerState): void {
    for (const em of this.emitters) {
      const d = listener.valid ? distanceTo(em.pos, listener.x, listener.y, listener.z) : FAR_END
      const far = smoothstep(FAR_START, FAR_END, d)
      setParam(em.dist.gain, lerp(1, FAR_GAIN, far), now, 0.6)
      setParam(em.air.frequency, lerp(LPF_NEAR, LPF_FAR, far), now, 0.6)
      if (em.nextWave < now + LOOKAHEAD) {
        const t = Math.max(em.nextWave, now + 0.05)
        this.wave(em, t)
        em.nextWave = t + randRange(WAVE_PERIOD)
      }
    }
  }

  /** Schedule one swell starting at `t` (events are strictly time-ordered per param). */
  private wave(em: Emitter, t: number): void {
    const amp = randRange(WAVE_AMP) * (chance(SET_WAVE_CHANCE) ? SET_WAVE_BOOST : 1)
    const rise = randRange(RUMBLE_RISE)
    const r = em.rumble.gain
    r.setTargetAtTime(RUMBLE_FLOOR + RUMBLE_PEAK * amp, t, RUMBLE_RISE_TC)
    r.setTargetAtTime(RUMBLE_FLOOR, t + rise, RUMBLE_DECAY_TC)

    const fStart = t + randRange(FOAM_DELAY)
    const fHold = fStart + randRange(FOAM_HOLD)
    const fDecay = randRange(FOAM_DECAY_TC)
    const f = em.foam.gain
    f.setTargetAtTime(FOAM_FLOOR + FOAM_PEAK * amp, fStart, FOAM_RISE_TC)
    f.setTargetAtTime(FOAM_FLOOR, fHold, fDecay)
    const lp = em.foamLp.frequency
    lp.setTargetAtTime(FOAM_LPF_BRIGHT, fStart, FOAM_RISE_TC)
    lp.setTargetAtTime(FOAM_LPF_DARK, fHold, fDecay * 1.2)
  }

  dispose(): void {
    teardown(this.nodes)
    this.nodes = []
    this.emitters = []
  }
}
