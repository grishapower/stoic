/**
 * Ambient-life sounds, triggered by the life simulation (src/game/life):
 *
 *  - dove:    a rock dove's soft "oo-roo-coo" (one PeriodicWave oscillator, a
 *             throaty ~27 Hz tremolo, low-passed), positional
 *  - flutter: wing claps of doves taking off — per bird one noise stream
 *             (band-passed claps + low "whomp"), beats slowing as it gains speed
 *  - gull:    a distant "kyow"/laughing call (rich harmonic wave with a rasp,
 *             band-passed, air absorption by distance); very soft
 *  - hives:   a continuous swarm hum (detuned saws, band-passed, slow swell),
 *             built only while the listener is near
 *
 * Everything goes to the ambience input (fades in after unlock, ducks under
 * the voice). One-shot nodes are disconnected when they end. Every public
 * call is a safe no-op before unlock.
 */
import type { SoundBank } from './bank'
import type { LifeAudioApi, Vec3Like } from './contract'
import { copyVec, createPanner, distanceTo, placePanner, type ListenerState } from './spatial'
import { clamp, disposeOnEnded, lerp, makeFilter, makeGain, rand, setParam, smoothstep, teardown } from './synth'

/* ------------------------------------------------------------- tuning */

/** Dove coo: peak level at the reference distance, panner, range and min gap (s). */
const DOVE_LEVEL = 0.05
const DOVE_REF = 3
const DOVE_ROLLOFF = 1.1
const DOVE_RANGE = 40
const DOVE_MIN_GAP = 1.2
/** Take-off flutter. */
const FLUTTER_LEVEL = 0.3
const FLUTTER_REF = 2
const FLUTTER_ROLLOFF = 1.2
const FLUTTER_RANGE = 35
const FLUTTER_MAX_STREAMS = 4
const FLUTTER_BEATS: [number, number] = [8, 12]
/** Gull cries: far calls are very soft; a passing gull is a little louder. */
const GULL_LEVEL = 0.06
const GULL_NEAR_TRIM = 0.7
const GULL_REF = 25
const GULL_ROLLOFF = 1
const GULL_MIN_GAP = 3
/** Hive hum: level at the reference distance; built within HUM_ON m, removed beyond HUM_OFF. */
const HUM_LEVEL = 0.22
const HUM_REF = 1.2
const HUM_ROLLOFF = 1.4
const HUM_ON = 22
const HUM_OFF = 28
/** Extra fade so the hum is only a close-up detail (m). */
const HUM_FADE: [number, number] = [16, 5]
const HUM_FREQS = [198, 205, 216, 231]
/** RMS of the bank's white noise. */
const WHITE_RMS = 0.2

/* ------------------------------------------------------------- helpers */

/** One pitched note on a shared oscillator/envelope; pitch jumps happen at zero level. */
function note(o: OscillatorNode, g: GainNode, t: number, dur: number, f0: number, f1: number, peak: number, att: number, rel: number): void {
  o.frequency.setValueAtTime(f0, t)
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur)
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(peak, t + att)
  g.gain.linearRampToValueAtTime(peak * 0.8, t + Math.max(att + 0.001, dur - rel))
  g.gain.linearRampToValueAtTime(0, t + dur)
}

class PannerPool {
  readonly nodes: PannerNode[]
  private next = 0

  constructor(ctx: BaseAudioContext, out: AudioNode, n: number, ref: number, rolloff: number) {
    this.nodes = []
    for (let i = 0; i < n; i++) {
      const p = createPanner(ctx, { refDistance: ref, rolloff })
      p.connect(out)
      this.nodes.push(p)
    }
  }

  take(p: Vec3Like, now: number): PannerNode {
    const node = this.nodes[this.next]
    this.next = (this.next + 1) % this.nodes.length
    placePanner(node, p.x, p.y, p.z, now, 0)
    return node
  }
}

interface Hum {
  hive: Vec3Like
  panner: PannerNode
  fade: GainNode
  nodes: AudioNode[]
  sources: AudioScheduledSourceNode[]
}

/* ------------------------------------------------------------- runtime */

class LifeRuntime {
  private readonly ctx: BaseAudioContext
  private readonly bank: SoundBank
  private readonly out: AudioNode
  private readonly listener: ListenerState
  private readonly doves: PannerPool
  private readonly wings: PannerPool
  private readonly gulls: PannerPool
  private readonly cooWave: PeriodicWave
  private readonly gullWave: PeriodicWave
  private hives: Vec3Like[] = []
  private readonly hums: (Hum | null)[] = []
  private nextCoo = 0
  private nextGull = 0
  private flutterBusy: number[] = []

  constructor(ctx: BaseAudioContext, bank: SoundBank, out: AudioNode, listener: ListenerState) {
    this.ctx = ctx
    this.bank = bank
    this.out = out
    this.listener = listener
    this.doves = new PannerPool(ctx, out, 2, DOVE_REF, DOVE_ROLLOFF)
    this.wings = new PannerPool(ctx, out, 2, FLUTTER_REF, FLUTTER_ROLLOFF)
    this.gulls = new PannerPool(ctx, out, 2, GULL_REF, GULL_ROLLOFF)
    this.cooWave = ctx.createPeriodicWave(new Float32Array(6), new Float32Array([0, 1, 0.38, 0.14, 0.06, 0.02]))
    this.gullWave = ctx.createPeriodicWave(new Float32Array(9), new Float32Array([0, 1, 0.75, 0.55, 0.42, 0.3, 0.2, 0.14, 0.09]))
    this.flutterBusy = new Array(FLUTTER_MAX_STREAMS).fill(0)
  }

  private far(p: Vec3Like, range: number): boolean {
    const l = this.listener
    return l.valid && distanceTo(p, l.x, l.y, l.z) > range
  }

  /* ---------------- dove coo */

  dove(p: Vec3Like): void {
    const ctx = this.ctx
    const now = ctx.currentTime
    if (now < this.nextCoo || this.far(p, DOVE_RANGE)) return
    this.nextCoo = now + DOVE_MIN_GAP
    const t = now + 0.03
    const k = rand(0.93, 1.07)
    const osc = ctx.createOscillator()
    osc.setPeriodicWave(this.cooWave)
    const env = makeGain(ctx, 0)
    // Throaty tremolo: gain = 0.75 ± 0.25 at ~27 Hz.
    const trem = makeGain(ctx, 0.75)
    const lfo = ctx.createOscillator()
    lfo.frequency.value = rand(24, 30)
    const depth = makeGain(ctx, 0.25)
    lfo.connect(depth).connect(trem.gain)
    const lp = makeFilter(ctx, 'lowpass', 1100, 0.7)
    const level = makeGain(ctx, DOVE_LEVEL * rand(0.8, 1.1))
    osc.connect(env).connect(trem).connect(lp).connect(level).connect(this.doves.take(p, now))
    let s = t
    note(osc, env, s, 0.22, 400 * k, 435 * k, 0.6, 0.04, 0.06)
    s += 0.3
    note(osc, env, s, 0.5, 475 * k, 410 * k, 1, 0.05, 0.12)
    s += 0.6
    note(osc, env, s, 0.4, 415 * k, 350 * k, 0.7, 0.05, 0.14)
    s += 0.45
    osc.start(t)
    lfo.start(t)
    osc.stop(s)
    lfo.stop(s)
    disposeOnEnded(osc, [osc, env, trem, lfo, depth, lp, level])
  }

  /* ---------------- take-off flutter */

  flutter(p: Vec3Like, n: number): void {
    const ctx = this.ctx
    const now = ctx.currentTime
    if (this.far(p, FLUTTER_RANGE)) return
    const streams = clamp(Math.round(n), 1, FLUTTER_MAX_STREAMS)
    let panner: PannerNode | null = null
    let started = 0
    for (let i = 0; i < this.flutterBusy.length && started < streams; i++) {
      if (this.flutterBusy[i] > now) continue
      const t0 = now + 0.01 + started * rand(0.04, 0.16)
      this.flutterBusy[i] = t0 + 1.4
      panner ??= this.wings.take(p, now)
      this.flutterStream(panner, t0, started === 0 ? 1 : rand(0.6, 0.9))
      started++
    }
  }

  private flutterStream(dest: AudioNode, t0: number, gain: number): void {
    const ctx = this.ctx
    const buf = this.bank.white
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.loop = true
    const bp = makeFilter(ctx, 'bandpass', rand(950, 1500), 0.9)
    const lp = makeFilter(ctx, 'lowpass', 380, 0.7)
    const hi = makeGain(ctx, 0)
    const lo = makeGain(ctx, 0)
    const level = makeGain(ctx, (FLUTTER_LEVEL * gain) / WHITE_RMS)
    src.connect(bp).connect(hi).connect(level)
    src.connect(lp).connect(lo).connect(level)
    level.connect(dest)
    // Beats: fast and loud at take-off, slowing and softening as the bird climbs away.
    const beats = Math.round(rand(FLUTTER_BEATS[0], FLUTTER_BEATS[1]))
    let t = t0
    let gap = rand(0.062, 0.078)
    let a = 1
    for (let i = 0; i < beats; i++) {
      hi.gain.setValueAtTime(0, t)
      hi.gain.linearRampToValueAtTime(0.32 * a, t + 0.004)
      hi.gain.setTargetAtTime(0, t + 0.004, 0.016)
      lo.gain.setValueAtTime(0, t)
      lo.gain.linearRampToValueAtTime(0.9 * a, t + 0.006)
      lo.gain.setTargetAtTime(0, t + 0.006, 0.028)
      t += gap * rand(0.92, 1.08)
      gap *= 1.07
      a *= 0.86
    }
    src.start(t0, Math.random() * Math.max(0, buf.duration - 2))
    src.stop(t + 0.2)
    disposeOnEnded(src, [src, bp, lp, hi, lo, level])
  }

  /* ---------------- gull cry */

  gull(p: Vec3Like, near: boolean): void {
    const ctx = this.ctx
    const now = ctx.currentTime
    if (now < this.nextGull) return
    this.nextGull = now + GULL_MIN_GAP
    const l = this.listener
    const d = l.valid ? distanceTo(p, l.x, l.y, l.z) : 120
    const t0 = now + 0.05
    const k = rand(0.92, 1.08)
    const osc = ctx.createOscillator()
    osc.setPeriodicWave(this.gullWave)
    const env = makeGain(ctx, 0)
    // Rasp: fast amplitude roughness (gain 0.7 ± 0.3 at 60–80 Hz).
    const rasp = makeGain(ctx, 0.7)
    const lfo = ctx.createOscillator()
    lfo.type = 'triangle'
    lfo.frequency.value = rand(60, 80)
    const depth = makeGain(ctx, 0.3)
    lfo.connect(depth).connect(rasp.gain)
    const bp = makeFilter(ctx, 'bandpass', 1500, 0.8)
    const air = makeFilter(ctx, 'lowpass', lerp(7000, 2000, smoothstep(30, 180, d)), 0.7)
    const level = makeGain(ctx, GULL_LEVEL * (near ? GULL_NEAR_TRIM : 1) * rand(0.8, 1.1))
    osc.connect(env).connect(rasp).connect(bp).connect(air).connect(level).connect(this.gulls.take(p, now))
    let t = t0
    if (Math.random() < 0.65) {
      // "kyow … kyow": rising then falling notes.
      const n = 2 + Math.floor(Math.random() * 3)
      for (let i = 0; i < n; i++) {
        const dur = rand(0.22, 0.32)
        const f0 = 1050 * k
        osc.frequency.setValueAtTime(f0, t)
        osc.frequency.exponentialRampToValueAtTime(1350 * k, t + dur * 0.25)
        osc.frequency.exponentialRampToValueAtTime(820 * k, t + dur)
        const peak = i === 0 ? 1 : rand(0.75, 0.95)
        env.gain.setValueAtTime(0, t)
        env.gain.linearRampToValueAtTime(peak, t + 0.025)
        env.gain.linearRampToValueAtTime(peak * 0.7, t + dur - 0.05)
        env.gain.linearRampToValueAtTime(0, t + dur)
        t += dur + rand(0.12, 0.2)
      }
    } else {
      // Laughing "ha-ha-ha".
      const n = 4 + Math.floor(Math.random() * 4)
      for (let i = 0; i < n; i++) {
        const dur = rand(0.1, 0.13)
        note(osc, env, t, dur, 920 * k, 780 * k, 0.85 - i * 0.05, 0.015, 0.03)
        t += dur + rand(0.06, 0.09)
      }
    }
    osc.start(t0)
    lfo.start(t0)
    osc.stop(t + 0.05)
    lfo.stop(t + 0.05)
    disposeOnEnded(osc, [osc, env, rasp, lfo, depth, bp, air, level])
  }

  /* ---------------- hive hum */

  setHives(hives: readonly Vec3Like[]): void {
    for (let i = 0; i < this.hums.length; i++) this.stopHum(i)
    this.hives = hives.map(copyVec)
    this.hums.length = 0
    for (let i = 0; i < this.hives.length; i++) this.hums.push(null)
  }

  private startHum(i: number): void {
    const ctx = this.ctx
    const now = ctx.currentTime
    const hive = this.hives[i]
    const panner = createPanner(ctx, { refDistance: HUM_REF, rolloff: HUM_ROLLOFF }, hive)
    const fade = makeGain(ctx, 0)
    const swell = makeGain(ctx, 1)
    const bp = makeFilter(ctx, 'bandpass', 450, 0.8)
    const lp = makeFilter(ctx, 'lowpass', 1800, 0.7)
    const sum = makeGain(ctx, 0.25)
    const nodes: AudioNode[] = [panner, fade, swell, bp, lp, sum]
    const sources: AudioScheduledSourceNode[] = []
    for (const f of HUM_FREQS) {
      const o = ctx.createOscillator()
      o.type = 'sawtooth'
      o.frequency.value = f * rand(0.985, 1.015)
      o.connect(sum)
      nodes.push(o)
      sources.push(o)
    }
    // One "passing bee" voice wobbles in pitch.
    const wob = ctx.createOscillator()
    wob.frequency.value = rand(4, 6)
    const wobDepth = makeGain(ctx, 7)
    wob.connect(wobDepth).connect((sources[1] as OscillatorNode).frequency)
    // Slow swell of the swarm.
    const lfo = ctx.createOscillator()
    lfo.frequency.value = rand(0.12, 0.2)
    const lfoDepth = makeGain(ctx, 0.22)
    lfo.connect(lfoDepth).connect(swell.gain)
    nodes.push(wob, wobDepth, lfo, lfoDepth)
    sources.push(wob, lfo)
    sum.connect(bp).connect(lp).connect(swell).connect(fade).connect(panner).connect(this.out)
    for (const s of sources) s.start(now)
    this.hums[i] = { hive, panner, fade, nodes, sources }
  }

  private stopHum(i: number): void {
    const h = this.hums[i]
    if (!h) return
    this.hums[i] = null
    const now = this.ctx.currentTime
    setParam(h.fade.gain, 0, now, 0.25)
    for (const s of h.sources) s.stop(now + 1.2)
    disposeOnEnded(h.sources[0], h.nodes)
  }

  update(now: number): void {
    const l = this.listener
    if (!l.valid) return
    for (let i = 0; i < this.hives.length; i++) {
      const d = distanceTo(this.hives[i], l.x, l.y, l.z)
      const h = this.hums[i]
      if (!h && d < HUM_ON) this.startHum(i)
      else if (h && d > HUM_OFF) this.stopHum(i)
      const live = this.hums[i]
      if (live) setParam(live.fade.gain, HUM_LEVEL * smoothstep(HUM_FADE[0], HUM_FADE[1], d), now, 0.4)
    }
  }

  dispose(): void {
    for (const h of this.hums) if (h) teardown(h.nodes)
    this.hums.length = 0
    teardown([...this.doves.nodes, ...this.wings.nodes, ...this.gulls.nodes])
  }
}

/* ------------------------------------------------------------- facade */

export class LifeAudio implements LifeAudioApi {
  private rt: LifeRuntime | null = null
  private hives: Vec3Like[] = []

  configure(opts: { beehives: Vec3Like[] }): void {
    try {
      this.hives = (opts.beehives ?? []).filter((p) => Number.isFinite(p.x + p.y + p.z)).map(copyVec)
      this.rt?.setHives(this.hives)
    } catch {
      /* malformed input: keep the previous config */
    }
  }

  dove(p: Vec3Like): void {
    try {
      if (this.rt && Number.isFinite(p.x + p.y + p.z)) this.rt.dove(p)
    } catch {
      /* never throw into the game loop */
    }
  }

  flutter(p: Vec3Like, n = 1): void {
    try {
      if (this.rt && Number.isFinite(p.x + p.y + p.z + n) && n > 0) this.rt.flutter(p, n)
    } catch {
      /* never throw into the game loop */
    }
  }

  gull(p: Vec3Like, near = false): void {
    try {
      if (this.rt && Number.isFinite(p.x + p.y + p.z)) this.rt.gull(p, near)
    } catch {
      /* never throw into the game loop */
    }
  }

  /* ------------------------------------------------ engine wiring */

  attach(ctx: BaseAudioContext, bank: SoundBank, out: AudioNode, listener: ListenerState): void {
    this.detach()
    this.rt = new LifeRuntime(ctx, bank, out, listener)
    this.rt.setHives(this.hives)
  }

  detach(): void {
    try {
      this.rt?.dispose()
    } catch {
      /* ignore */
    }
    this.rt = null
  }

  /** 10 Hz control tick (hive hum distance management). */
  update(now: number): void {
    this.rt?.update(now)
  }
}
