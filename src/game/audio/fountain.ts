/**
 * Peristyle fountain: a gentle trickle, positional.
 *
 *   waterA (bubbles, 7.1 s loop) ──────────────┐
 *   waterB (bubbles, 5.3 s loop, rate 0.94) ───┤
 *   white → HPF → BPF ~1.7 kHz → flutter AM ───┼→ sum → range fade → panner (HRTF) → out
 *   droplet plinks (sine blips, scheduled) ────┘
 *
 * The bubble loops are a field of Minnaert bubbles (see synth.waterBuffer); two
 * loops of different lengths never repeat audibly. The splash noise is
 * amplitude-modulated by a smooth random ~14 Hz signal for a lively flutter.
 */
import type { SoundBank } from './bank'
import type { Vec3Like } from './contract'
import { createPanner, distanceTo, placePanner, type ListenerState } from './spatial'
import { disposeOnEnded, loopSource, makeFilter, makeGain, rand, randRange, setParam, smoothstep, teardown } from './synth'

/* ------------------------------------------------------------- tuning */

const REF_DISTANCE = 4
const ROLLOFF = 1
/** Extra fade so the fountain is gone by FADE_END (inverse law alone never reaches 0). */
const FADE_START = 16
const FADE_END = 30
/** Added to the configured fountain height (0 = use the y passed to configure), m. */
const HEIGHT_OFFSET = 0

const BUBBLES_A_LEVEL = 0.13
const BUBBLES_B_LEVEL = 0.09
const SPLASH_LEVEL = 0.3
const SPLASH_HPF_HZ = 400
const SPLASH_BPF_HZ = 1700
const SPLASH_Q = 0.7
/** Flutter AM: gain = BASE + DEPTH · smoothRandom(t). */
const FLUTTER_BASE = 0.65
const FLUTTER_DEPTH = 0.35

/** Droplet plinks: mean rate (per s), frequency, glide ratio, glide time, decay, level. */
const PLINK_RATE = 0.9
const PLINK_FREQ: [number, number] = [1100, 2600]
/** > 1 = rising "bloop" (physical bubble resonance), < 1 = falling blip. */
const PLINK_GLIDE: [number, number] = [1.25, 1.7]
const PLINK_GLIDE_TIME: [number, number] = [0.025, 0.06]
const PLINK_DECAY_TC: [number, number] = [0.01, 0.03]
const PLINK_LEVEL: [number, number] = [0.012, 0.04]
/** Scheduler lookahead (s). */
const LOOKAHEAD = 0.3

/* ------------------------------------------------------------- system */

export class Fountain {
  private readonly ctx: BaseAudioContext
  private readonly nodes: AudioNode[]
  private readonly sum: GainNode
  private readonly range: GainNode
  private readonly panner: PannerNode
  private pos: Vec3Like
  private nextPlink: number

  constructor(ctx: BaseAudioContext, bank: SoundBank, out: AudioNode, at: Vec3Like) {
    this.ctx = ctx
    this.pos = { x: at.x, y: at.y + HEIGHT_OFFSET, z: at.z }
    this.sum = makeGain(ctx, 1)
    this.range = makeGain(ctx, 0)
    this.panner = createPanner(ctx, { refDistance: REF_DISTANCE, rolloff: ROLLOFF }, this.pos)
    this.sum.connect(this.range).connect(this.panner).connect(out)

    const wa = loopSource(ctx, bank.waterA)
    const wag = makeGain(ctx, BUBBLES_A_LEVEL)
    wa.connect(wag).connect(this.sum)
    const wb = loopSource(ctx, bank.waterB, 0.94)
    const wbg = makeGain(ctx, BUBBLES_B_LEVEL)
    wb.connect(wbg).connect(this.sum)

    const noise = loopSource(ctx, bank.white)
    const hp = makeFilter(ctx, 'highpass', SPLASH_HPF_HZ, 0.7)
    const bp = makeFilter(ctx, 'bandpass', SPLASH_BPF_HZ, SPLASH_Q)
    const am = makeGain(ctx, FLUTTER_BASE)
    const sg = makeGain(ctx, SPLASH_LEVEL)
    noise.connect(hp).connect(bp).connect(am).connect(sg).connect(this.sum)
    const flutter = loopSource(ctx, bank.flutter)
    const depth = makeGain(ctx, FLUTTER_DEPTH)
    flutter.connect(depth).connect(am.gain)

    this.nodes = [wa, wag, wb, wbg, noise, hp, bp, am, sg, flutter, depth, this.sum, this.range, this.panner]
    this.nextPlink = ctx.currentTime + rand(0.5, 2)
  }

  setPosition(at: Vec3Like): void {
    this.pos = { x: at.x, y: at.y + HEIGHT_OFFSET, z: at.z }
    placePanner(this.panner, this.pos.x, this.pos.y, this.pos.z, this.ctx.currentTime, 0)
  }

  update(now: number, listener: ListenerState): void {
    const d = listener.valid ? distanceTo(this.pos, listener.x, listener.y, listener.z) : FADE_START
    const fade = smoothstep(FADE_END, FADE_START, d)
    setParam(this.range.gain, fade, now, 0.3)
    if (fade <= 0.001) {
      this.nextPlink = Math.max(this.nextPlink, now + 0.5)
      return
    }
    while (this.nextPlink < now + LOOKAHEAD) {
      const t = Math.max(this.nextPlink, now + 0.02)
      this.plink(t)
      this.nextPlink = t - Math.log(1 - Math.random() * 0.999) / PLINK_RATE
    }
  }

  /** A single droplet: sine with a fast pitch glide and an exponential decay. */
  private plink(t: number): void {
    const ctx = this.ctx
    const osc = ctx.createOscillator()
    const env = ctx.createGain()
    const f0 = randRange(PLINK_FREQ)
    const glideT = randRange(PLINK_GLIDE_TIME)
    const tc = randRange(PLINK_DECAY_TC)
    osc.frequency.setValueAtTime(f0, t)
    osc.frequency.exponentialRampToValueAtTime(f0 * randRange(PLINK_GLIDE), t + glideT)
    env.gain.value = 0
    env.gain.setValueAtTime(0, t)
    env.gain.linearRampToValueAtTime(randRange(PLINK_LEVEL), t + 0.002)
    env.gain.setTargetAtTime(0, t + 0.002, tc)
    osc.connect(env).connect(this.sum)
    osc.start(t)
    osc.stop(t + 0.002 + tc * 8)
    disposeOnEnded(osc, [osc, env])
  }

  dispose(): void {
    teardown(this.nodes)
  }
}
