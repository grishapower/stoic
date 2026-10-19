/**
 * Footsteps: short procedural one-shots (6–10 nodes each, cleaned up on end).
 *
 *  - gravel: heel + toe crunch (granular "crunch" buffer, band-passed) + a soft weight thump
 *  - stone:  dull low-passed tap + tiny low "weight" sine + faint sandal scuff
 *  - grass:  two soft band-passed swishes + muffled thud
 *  - wood:   hollow knock (pitched sine) + two narrow resonances
 *
 * Every step varies in level, filter frequencies, heel–toe spacing and source
 * offset. Seneca's steps are positional (2 alternating HRTF panners); the
 * player's are non-positional, quieter, alternating slightly left/right.
 */
import type { SoundBank } from './bank'
import type { FootstepsApi, Surface, Vec3Like } from './contract'
import { createPanner, placePanner } from './spatial'
import { clamp, dbToGain, disposeOnEnded, makeFilter, makeGain, rand, teardown } from './synth'

/* ------------------------------------------------------------- tuning */

const PLAYER_LEVEL = 0.2
const SENECA_LEVEL = 0.45
const SENECA_REF = 1.5
const SENECA_ROLLOFF = 1.2
/** Player feet: alternating tiny stereo offset. */
const PLAYER_FOOT_PAN = 0.08
const SURFACE_TRIM: Record<Surface, number> = { gravel: 1, stone: 0.75, grass: 0.6, wood: 0.85, leaves: 0.9, fruit: 0.8, drip: 0.45 }
/** Interaction sounds placed in the world (fruit picked / landing). */
const WORLD_LEVEL = 0.5
/** Random level variation per step (± dB). */
const LEVEL_JITTER_DB = 2
/** All sources of a step stop by this time after onset (s). */
const STEP_TAIL = 0.4
/** RMS of the source noise buffers (see bank/synth normalisation). */
const WHITE_RMS = 0.2
const CRUNCH_RMS = 0.15

/* ------------------------------------------------------------- synthesis helpers */

interface HitOptions {
  type: BiquadFilterType
  freq: number
  q: number
  /** Desired RMS of the filtered burst at the envelope peak. */
  rms: number
  attack: number
  /** Exponential decay time constant. */
  tc: number
}

/** Rough RMS fraction of broadband noise that passes a filter (for level compensation). */
function passFraction(type: BiquadFilterType, freq: number, q: number, sr: number): number {
  const ny = sr / 2
  const bw = type === 'lowpass' ? freq : type === 'highpass' ? ny - freq : freq / Math.max(0.1, q)
  return Math.sqrt(clamp(bw / ny, 0.002, 1))
}

class StepBuilder {
  readonly nodes: AudioNode[] = []
  private readonly sources: AudioScheduledSourceNode[] = []
  private readonly ctx: BaseAudioContext
  private readonly dest: AudioNode
  private readonly t0: number

  constructor(ctx: BaseAudioContext, dest: AudioNode, t0: number) {
    this.ctx = ctx
    this.dest = dest
    this.t0 = t0
  }

  noise(buf: AudioBuffer, srcRms: number, at: number, o: HitOptions, rate = 1): void {
    const ctx = this.ctx
    const t = this.t0 + at
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.playbackRate.value = rate
    const f = makeFilter(ctx, o.type, o.freq, o.q)
    const g = makeGain(ctx, 0)
    const peak = o.rms / (srcRms * passFraction(o.type, o.freq, o.q, ctx.sampleRate))
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(peak, t + o.attack)
    g.gain.setTargetAtTime(0, t + o.attack, o.tc)
    src.connect(f).connect(g).connect(this.dest)
    src.start(t, Math.random() * Math.max(0, buf.duration - STEP_TAIL - 0.05))
    this.nodes.push(src, f, g)
    this.sources.push(src)
  }

  tone(at: number, f0: number, f1: number, peak: number, tc: number): void {
    const ctx = this.ctx
    const t = this.t0 + at
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(f0, t)
    o.frequency.exponentialRampToValueAtTime(f1, t + tc * 3)
    const g = makeGain(ctx, 0)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(peak, t + 0.003)
    g.gain.setTargetAtTime(0, t + 0.003, tc)
    o.connect(g).connect(this.dest)
    o.start(t)
    this.nodes.push(o, g)
    this.sources.push(o)
  }

  /** Stop everything together; clean up when the last one ends. */
  finish(extra: AudioNode[]): void {
    const stopAt = this.t0 + STEP_TAIL
    for (const s of this.sources) s.stop(stopAt)
    const last = this.sources[this.sources.length - 1]
    if (last) disposeOnEnded(last, [...this.nodes, ...extra])
    else teardown(extra) // unknown surface: nothing was scheduled
  }
}

function buildSurface(b: StepBuilder, bank: SoundBank, surface: Surface): void {
  switch (surface) {
    case 'gravel': {
      const toe = rand(0.05, 0.09)
      b.noise(bank.crunch, CRUNCH_RMS, 0, { type: 'bandpass', freq: rand(1400, 2200), q: 0.9, rms: 0.12, attack: 0.004, tc: 0.035 }, rand(0.9, 1.1))
      b.noise(bank.crunch, CRUNCH_RMS, toe, { type: 'bandpass', freq: rand(1700, 2600), q: 0.9, rms: 0.09, attack: 0.006, tc: 0.05 }, rand(0.9, 1.1))
      b.noise(bank.white, WHITE_RMS, 0, { type: 'lowpass', freq: rand(220, 300), q: 0.7, rms: 0.06, attack: 0.003, tc: 0.02 })
      break
    }
    case 'stone': {
      b.noise(bank.white, WHITE_RMS, 0, { type: 'lowpass', freq: rand(600, 900), q: 0.8, rms: 0.1, attack: 0.002, tc: 0.015 })
      b.tone(0, rand(95, 115), 75, 0.12, 0.02)
      b.noise(bank.white, WHITE_RMS, rand(0.04, 0.07), { type: 'highpass', freq: 2500, q: 0.7, rms: 0.02, attack: 0.012, tc: 0.03 })
      break
    }
    case 'grass': {
      b.noise(bank.white, WHITE_RMS, 0, { type: 'bandpass', freq: rand(2500, 3500), q: 0.6, rms: 0.05, attack: 0.025, tc: 0.05 })
      b.noise(bank.white, WHITE_RMS, rand(0.06, 0.1), { type: 'bandpass', freq: rand(1800, 2600), q: 0.6, rms: 0.035, attack: 0.02, tc: 0.06 })
      b.noise(bank.white, WHITE_RMS, 0, { type: 'lowpass', freq: 180, q: 0.7, rms: 0.04, attack: 0.005, tc: 0.03 })
      break
    }
    case 'leaves': {
      // Picking fruit: a short rustle of leaves and the stem's tiny snap.
      b.noise(bank.white, WHITE_RMS, 0, { type: 'bandpass', freq: rand(3200, 4800), q: 0.8, rms: 0.05, attack: 0.03, tc: 0.07 })
      b.noise(bank.white, WHITE_RMS, rand(0.07, 0.11), { type: 'bandpass', freq: rand(2400, 3600), q: 0.8, rms: 0.04, attack: 0.025, tc: 0.08 })
      b.noise(bank.white, WHITE_RMS, rand(0.13, 0.17), { type: 'highpass', freq: 3000, q: 0.7, rms: 0.05, attack: 0.001, tc: 0.006 })
      break
    }
    case 'fruit': {
      // A ripe fruit landing on soil/grass: soft low thump.
      b.tone(0, rand(150, 175), 70, 0.16, 0.035)
      b.noise(bank.white, WHITE_RMS, 0, { type: 'lowpass', freq: rand(450, 600), q: 0.7, rms: 0.06, attack: 0.002, tc: 0.025 })
      break
    }
    case 'drip': {
      // Water clock: a drop into the bowl — a tiny rising "plink" and a wet tick.
      const f = rand(1050, 1350)
      b.tone(0, f, f * 1.9, 0.07, 0.012)
      b.noise(bank.white, WHITE_RMS, 0, { type: 'highpass', freq: 3500, q: 0.7, rms: 0.015, attack: 0.001, tc: 0.004 })
      break
    }
    case 'wood': {
      const f = rand(170, 210)
      b.tone(0, f, f * 0.85, 0.15, 0.04)
      b.noise(bank.white, WHITE_RMS, 0, { type: 'bandpass', freq: rand(480, 560), q: 5, rms: 0.08, attack: 0.002, tc: 0.03 })
      b.noise(bank.white, WHITE_RMS, 0, { type: 'bandpass', freq: rand(1150, 1350), q: 6, rms: 0.03, attack: 0.002, tc: 0.02 })
      b.noise(bank.white, WHITE_RMS, rand(0.06, 0.09), { type: 'lowpass', freq: 900, q: 0.7, rms: 0.035, attack: 0.002, tc: 0.012 })
      break
    }
  }
}

/* ------------------------------------------------------------- runtime */

class FootstepsRuntime {
  private readonly ctx: BaseAudioContext
  private readonly bank: SoundBank
  private readonly nodes: AudioNode[]
  private readonly senecaPanners: PannerNode[]
  private readonly playerFeet: StereoPannerNode[]
  private nextPanner = 0
  private nextFoot = 0

  constructor(ctx: BaseAudioContext, bank: SoundBank, out: AudioNode) {
    this.ctx = ctx
    this.bank = bank
    this.senecaPanners = [0, 1].map(() => {
      const p = createPanner(ctx, { refDistance: SENECA_REF, rolloff: SENECA_ROLLOFF })
      p.connect(out)
      return p
    })
    this.playerFeet = [-PLAYER_FOOT_PAN, PLAYER_FOOT_PAN].map((v) => {
      const s = ctx.createStereoPanner()
      s.pan.value = v
      s.connect(out)
      return s
    })
    this.nodes = [...this.senecaPanners, ...this.playerFeet]
  }

  step(p: Vec3Like, surface: Surface, who: 'player' | 'seneca' | 'world', intensity: number): void {
    const ctx = this.ctx
    const now = ctx.currentTime
    let dest: AudioNode
    if (who === 'seneca' || who === 'world') {
      const panner = this.senecaPanners[this.nextPanner]
      this.nextPanner = (this.nextPanner + 1) % this.senecaPanners.length
      placePanner(panner, p.x, p.y, p.z, now, 0)
      dest = panner
    } else {
      dest = this.playerFeet[this.nextFoot]
      this.nextFoot = (this.nextFoot + 1) % this.playerFeet.length
    }
    const level =
      (who === 'seneca' ? SENECA_LEVEL : who === 'world' ? WORLD_LEVEL : PLAYER_LEVEL) *
      (SURFACE_TRIM[surface] ?? 1) *
      clamp(intensity, 0, 1.5) *
      dbToGain(rand(-LEVEL_JITTER_DB, LEVEL_JITTER_DB))
    const g = makeGain(ctx, level)
    g.connect(dest)
    const b = new StepBuilder(ctx, g, now + 0.005)
    buildSurface(b, this.bank, surface)
    b.finish([g])
  }

  dispose(): void {
    teardown(this.nodes)
  }
}

/* ------------------------------------------------------------- facade */

export class Footsteps implements FootstepsApi {
  private rt: FootstepsRuntime | null = null

  step(p: Vec3Like, surface: Surface, who: 'player' | 'seneca' | 'world', intensity = 1): void {
    try {
      if (!this.rt || !Number.isFinite(intensity) || intensity <= 0) return
      this.rt.step(p, surface, who, intensity)
    } catch {
      /* never throw into the game loop */
    }
  }

  attach(ctx: BaseAudioContext, bank: SoundBank, out: AudioNode): void {
    this.detach()
    this.rt = new FootstepsRuntime(ctx, bank, out)
  }

  detach(): void {
    this.rt?.dispose()
    this.rt = null
  }
}
