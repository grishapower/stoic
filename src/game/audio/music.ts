/**
 * Music: extremely quiet and sparse. Lyre-like plucks (Karplus–Strong strings
 * pre-rendered into AudioBuffers) in D dorian, phrases of 2–5 notes separated
 * by long silences, over a very soft breathing drone (D2–A2–D3 plus a slowly
 * changing modal colour tone). No beat, no pulse.
 *
 *   plucks → stereo pan → pluck bus → body EQ ─┬→ dry ──────────────┐
 *                                              └→ send → convolver ─┤
 *   pad oscillators → LPF → pad gain (breath LFO) ─┬────────────────┤→ out (enable fade × intensity × voice duck) → music bus
 *                                                  └→ send ─────────┘
 */
import type { MusicApi } from './contract'
import {
  chance,
  clamp,
  dbToGain,
  disposeOnEnded,
  lerp,
  makeFilter,
  makeGain,
  midiToHz,
  pick,
  pluckBuffer,
  rand,
  randRange,
  reverbImpulse,
  setParam,
  teardown,
} from './synth'

/* ------------------------------------------------------------- tuning */

/** D dorian, D3..D5. */
const SCALE_MIDI = [50, 52, 53, 55, 57, 59, 60, 62, 64, 65, 67, 69, 71, 72, 74]
/** Pitch classes phrases like to rest on (D, A). */
const STABLE_PCS = [2, 9]
/** Phrases start around here (A3..A4). */
const START_RANGE: [number, number] = [57, 69]
const CENTER_MIDI = 62

const PLUCK_SECONDS = 4.5
const PLUCK_T60_LOW = 3.4
const PLUCK_T60_HIGH = 1.6
const PLUCK_BRIGHTNESS = 0.5
const PLUCK_POSITION = 0.17
const PLUCK_GAIN = 0.4
const VELOCITY: [number, number] = [0.6, 1]
const PAN_SPREAD = 0.35
const DYAD_CHANCE = 0.3

/** Overall music level at intensity 1 (before the music bus). */
const OUT_LEVEL = 0.7
/** Level fraction at intensity 0. */
const INTENSITY_FLOOR = 0.3
/** Automatic duck while Seneca speaks. */
const VOICE_DUCK_DB = -5
/** Linear fade-in after setEnabled(true), s (≥ 10 s by design). */
const FADE_IN_SECONDS = 12
const FADE_OUT_TC = 2
const LEVEL_TC = 1.5

const FIRST_PHRASE_DELAY: [number, number] = [7, 13]
const PHRASE_GAP: [number, number] = [10, 24]
const MIN_GAP = 6
const NOTE_IOI: [number, number] = [0.55, 1.35]
const PHRASE_NOTES: [number, number] = [2, 5]
/** While the voice is active, phrases are postponed with this probability. */
const VOICE_POSTPONE = 0.5

const BODY_HPF_HZ = 90
const BODY_PEAK_HZ = 320
const BODY_PEAK_DB = 2.5
const BODY_PEAK_Q = 1.1
const BODY_LPF_HZ = 3400
const REVERB_SECONDS = 3.2
const REVERB_SEND = 0.4
const DRY = 0.75

const PAD_LEVEL = 0.05
const PAD_LPF_HZ = 520
const PAD_BREATH_PERIOD = 55
const PAD_BREATH_DEPTH = 0.3
const PAD_SEND = 0.3
/** Drone partials: [midi, type, gain, detune cents]. */
const PAD_PARTIALS: readonly [number, OscillatorType, number, number][] = [
  [38, 'sine', 0.5, 0],
  [45, 'sine', 0.35, 0],
  [50, 'triangle', 0.15, 4],
]
/** Modal colour tones (F3, E3, G3, C4, A3) that slowly cross-fade. */
const PAD_COLOR_MIDI = [53, 52, 55, 60, 57]
const PAD_COLOR_LEVEL = 0.2
const PAD_COLOR_EVERY: [number, number] = [25, 55]
const PAD_COLOR_TC = 4
/** Stop the drone oscillators this long after disable (s). */
const PAD_STOP_AFTER = 15
/** Render the plucks in the background this long after unlock (ms) if not enabled earlier. */
const RENDER_IDLE_DELAY_MS = 8000

const LOOKAHEAD = 0.3

/* ------------------------------------------------------------- runtime */

interface Pad {
  nodes: AudioNode[]
  oscs: OscillatorNode[]
  color: [OscillatorNode, OscillatorNode]
  colorGain: [GainNode, GainNode]
  active: number
  nextColor: number
}

class MusicRuntime {
  private readonly ctx: BaseAudioContext
  private readonly out: GainNode
  private readonly pluckBus: GainNode
  private readonly send: GainNode
  private readonly convolver: ConvolverNode
  private readonly nodes: AudioNode[]
  private readonly buffers = new Map<number, AudioBuffer>()
  private renderQueue: number[] = []
  private renderTimer: ReturnType<typeof setTimeout> | null = null
  private ready = false
  private rendering = false
  private disposed = false

  private enabled = false
  private intensity = 0.5
  private voiceActive = false
  private fadeInEnd = 0
  private nextPhrase = Infinity
  private disabledAt = 0
  private pad: Pad | null = null

  constructor(ctx: BaseAudioContext, dest: AudioNode) {
    this.ctx = ctx
    this.out = makeGain(ctx, 0)
    this.out.connect(dest)
    this.pluckBus = makeGain(ctx, 1)
    const hp = makeFilter(ctx, 'highpass', BODY_HPF_HZ, 0.7)
    const body = makeFilter(ctx, 'peaking', BODY_PEAK_HZ, BODY_PEAK_Q, BODY_PEAK_DB)
    const lp = makeFilter(ctx, 'lowpass', BODY_LPF_HZ, 0.5)
    const dry = makeGain(ctx, DRY)
    this.send = makeGain(ctx, REVERB_SEND)
    this.convolver = ctx.createConvolver()
    this.pluckBus.connect(hp).connect(body).connect(lp)
    lp.connect(dry).connect(this.out)
    lp.connect(this.send)
    this.send.connect(this.convolver).connect(this.out)
    this.nodes = [this.out, this.pluckBus, hp, body, lp, dry, this.send, this.convolver]
    this.renderTimer = setTimeout(() => this.beginRender(), RENDER_IDLE_DELAY_MS)
  }

  /* ------------------------------------------------ rendering (background) */

  private beginRender(): void {
    if (this.disposed || this.ready || this.rendering) return
    this.rendering = true
    if (this.renderTimer !== null) clearTimeout(this.renderTimer)
    this.renderTimer = null
    this.renderQueue = [-1, ...SCALE_MIDI] // -1 = reverb impulse
    this.renderStep()
  }

  private renderStep(): void {
    if (this.disposed) return
    const item = this.renderQueue.shift()
    if (item === undefined) {
      this.ready = true
      return
    }
    try {
      if (item < 0) {
        this.convolver.buffer = reverbImpulse(this.ctx, REVERB_SECONDS, 4242)
      } else {
        const x = clamp((item - SCALE_MIDI[0]) / (SCALE_MIDI[SCALE_MIDI.length - 1] - SCALE_MIDI[0]), 0, 1)
        this.buffers.set(
          item,
          pluckBuffer(this.ctx, midiToHz(item), {
            seconds: PLUCK_SECONDS,
            t60: lerp(PLUCK_T60_LOW, PLUCK_T60_HIGH, x),
            brightness: PLUCK_BRIGHTNESS,
            position: PLUCK_POSITION,
            seed: 9000 + item,
          }),
        )
      }
    } catch {
      /* skip this note */
    }
    this.renderTimer = setTimeout(() => this.renderStep(), 0)
  }

  /* ------------------------------------------------ control */

  setEnabled(on: boolean): void {
    if (on === this.enabled) return
    this.enabled = on
    const now = this.ctx.currentTime
    const g = this.out.gain
    if (on) {
      this.beginRender()
      if (!this.pad) this.startPad(now)
      g.cancelScheduledValues(now)
      g.setValueAtTime(g.value, now)
      g.linearRampToValueAtTime(this.targetLevel(), now + FADE_IN_SECONDS)
      this.fadeInEnd = now + FADE_IN_SECONDS
      this.nextPhrase = now + randRange(FIRST_PHRASE_DELAY)
    } else {
      g.cancelScheduledValues(now)
      g.setValueAtTime(g.value, now)
      g.setTargetAtTime(0, now, FADE_OUT_TC)
      this.fadeInEnd = 0
      this.disabledAt = now
      this.nextPhrase = Infinity
    }
  }

  setIntensity(v: number): void {
    const next = clamp(v, 0, 1)
    if (Math.abs(next - this.intensity) < 1e-3) return
    this.intensity = next
    this.applyLevel()
  }

  setVoiceActive(active: boolean): void {
    if (active === this.voiceActive) return
    this.voiceActive = active
    this.applyLevel()
  }

  private targetLevel(): number {
    return OUT_LEVEL * lerp(INTENSITY_FLOOR, 1, this.intensity) * (this.voiceActive ? dbToGain(VOICE_DUCK_DB) : 1)
  }

  private applyLevel(): void {
    const now = this.ctx.currentTime
    // During the fade-in, the ramp owns the param; update() applies changes afterwards.
    if (!this.enabled || now < this.fadeInEnd) return
    setParam(this.out.gain, this.targetLevel(), now, LEVEL_TC)
  }

  update(now: number): void {
    if (this.fadeInEnd > 0 && now >= this.fadeInEnd) {
      this.fadeInEnd = 0
      this.applyLevel()
    }
    if (this.pad) {
      if (!this.enabled && now > this.disabledAt + PAD_STOP_AFTER) this.stopPad()
      else this.updatePad(now)
    }
    if (!this.enabled || !this.ready || now + LOOKAHEAD < this.nextPhrase) return
    if (this.voiceActive && chance(VOICE_POSTPONE)) {
      this.nextPhrase = now + rand(3, 6)
      return
    }
    const t = Math.max(this.nextPhrase, now + 0.05)
    const dur = this.phrase(t)
    const sparse = lerp(1.6, 0.6, this.intensity)
    this.nextPhrase = t + dur + Math.max(MIN_GAP, randRange(PHRASE_GAP) * sparse)
  }

  /* ------------------------------------------------ phrases */

  private phrase(t0: number): number {
    const n = Math.round(randRange(PHRASE_NOTES) + this.intensity * 0.6)
    const starts = SCALE_MIDI.map((m, i) => (m >= START_RANGE[0] && m <= START_RANGE[1] && STABLE_PCS.includes(m % 12) ? i : -1)).filter((i) => i >= 0)
    let idx = starts.length > 0 ? pick(starts) : 7
    let t = t0
    for (let i = 0; i < n; i++) {
      const last = i === n - 1
      if (last && chance(0.7)) idx = this.nearestStable(idx)
      const midi = SCALE_MIDI[idx]
      const vel = randRange(VELOCITY) * (last ? 0.85 : 1)
      this.pluck(midi, t, vel)
      if (last && chance(DYAD_CHANCE)) {
        const below = this.buffers.has(midi - 12) ? midi - 12 : midi - 7
        this.pluck(below, t + rand(0.025, 0.06), vel * 0.6)
      }
      if (last) break
      t += randRange(NOTE_IOI)
      idx = this.step(idx)
    }
    return t - t0 + PLUCK_SECONDS * 0.6
  }

  /** Mostly stepwise motion with a gentle pull toward the centre. */
  private step(idx: number): number {
    const r = Math.random()
    const size = r < 0.45 ? 1 : r < 0.75 ? 2 : r < 0.88 ? 0 : chance(0.5) ? 3 : 4
    const towardCenter = SCALE_MIDI[idx] > CENTER_MIDI + 4 ? -1 : SCALE_MIDI[idx] < CENTER_MIDI - 4 ? 1 : 0
    const dir = towardCenter !== 0 && chance(0.7) ? towardCenter : chance(0.5) ? 1 : -1
    return clamp(idx + dir * size, 0, SCALE_MIDI.length - 1)
  }

  private nearestStable(idx: number): number {
    let best = idx
    let bestD = Infinity
    for (let i = 0; i < SCALE_MIDI.length; i++) {
      if (!STABLE_PCS.includes(SCALE_MIDI[i] % 12)) continue
      const d = Math.abs(i - idx)
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    return best
  }

  private pluck(midi: number, t: number, vel: number): void {
    const buf = this.buffers.get(midi)
    if (!buf) return
    const ctx = this.ctx
    const src = ctx.createBufferSource()
    src.buffer = buf
    const g = makeGain(ctx, vel * PLUCK_GAIN)
    const pan = ctx.createStereoPanner()
    pan.pan.value = rand(-PAN_SPREAD, PAN_SPREAD)
    src.connect(g).connect(pan).connect(this.pluckBus)
    src.start(t)
    disposeOnEnded(src, [src, g, pan])
  }

  /* ------------------------------------------------ drone */

  private startPad(now: number): void {
    const ctx = this.ctx
    const lp = makeFilter(ctx, 'lowpass', PAD_LPF_HZ, 0.5)
    const padGain = makeGain(ctx, PAD_LEVEL * (1 - PAD_BREATH_DEPTH))
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 1 / PAD_BREATH_PERIOD
    const lfoDepth = makeGain(ctx, PAD_LEVEL * PAD_BREATH_DEPTH)
    lfo.connect(lfoDepth).connect(padGain.gain)
    const send = makeGain(ctx, PAD_SEND)
    lp.connect(padGain)
    padGain.connect(this.out)
    padGain.connect(send).connect(this.convolver)
    const nodes: AudioNode[] = [lp, padGain, lfo, lfoDepth, send]
    const oscs: OscillatorNode[] = [lfo]
    for (const [midi, type, gain, detune] of PAD_PARTIALS) {
      const o = ctx.createOscillator()
      o.type = type
      o.frequency.value = midiToHz(midi)
      o.detune.value = detune
      const g = makeGain(ctx, gain)
      o.connect(g).connect(lp)
      nodes.push(o, g)
      oscs.push(o)
    }
    const color: OscillatorNode[] = []
    const colorGain: GainNode[] = []
    for (let i = 0; i < 2; i++) {
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.value = midiToHz(PAD_COLOR_MIDI[0])
      const g = makeGain(ctx, 0)
      o.connect(g).connect(lp)
      nodes.push(o, g)
      oscs.push(o)
      color.push(o)
      colorGain.push(g)
    }
    for (const o of oscs) o.start(now)
    this.pad = {
      nodes,
      oscs,
      color: [color[0], color[1]],
      colorGain: [colorGain[0], colorGain[1]],
      active: 1,
      nextColor: now + rand(12, 20),
    }
  }

  private updatePad(now: number): void {
    const pad = this.pad
    if (!pad || !this.enabled || now < pad.nextColor) return
    pad.nextColor = now + randRange(PAD_COLOR_EVERY)
    const next = 1 - pad.active
    const current = pad.color[pad.active].frequency.value
    let midi = pick(PAD_COLOR_MIDI)
    if (Math.abs(midiToHz(midi) - current) < 1) midi = PAD_COLOR_MIDI[(PAD_COLOR_MIDI.indexOf(midi) + 1) % PAD_COLOR_MIDI.length]
    // The incoming voice is silent, so its pitch can jump.
    pad.color[next].frequency.setValueAtTime(midiToHz(midi), now)
    setParam(pad.colorGain[next].gain, PAD_COLOR_LEVEL, now, PAD_COLOR_TC)
    setParam(pad.colorGain[pad.active].gain, 0, now, PAD_COLOR_TC)
    pad.active = next
  }

  private stopPad(): void {
    if (!this.pad) return
    teardown(this.pad.nodes)
    this.pad = null
  }

  dispose(): void {
    this.disposed = true
    if (this.renderTimer !== null) clearTimeout(this.renderTimer)
    this.renderTimer = null
    this.stopPad()
    teardown(this.nodes)
    this.buffers.clear()
  }
}

/* ------------------------------------------------------------- facade */

export class Music implements MusicApi {
  private enabled = false
  private intensity = 0.5
  private voiceActive = false
  private rt: MusicRuntime | null = null

  setEnabled(enabled: boolean): void {
    if (!!enabled === this.enabled) return
    this.enabled = !!enabled
    try {
      this.rt?.setEnabled(this.enabled)
    } catch {
      /* ignore */
    }
  }

  /** Cheap to call every frame: only real changes touch the audio graph. */
  setIntensity(v: number): void {
    if (!Number.isFinite(v)) return
    const next = clamp(v, 0, 1)
    if (Math.abs(next - this.intensity) < 1e-3) return
    this.intensity = next
    try {
      this.rt?.setIntensity(this.intensity)
    } catch {
      /* ignore */
    }
  }

  /** Engine hook (voice ducking). */
  setVoiceActive(active: boolean): void {
    this.voiceActive = active
    try {
      this.rt?.setVoiceActive(active)
    } catch {
      /* ignore */
    }
  }

  attach(ctx: BaseAudioContext, dest: AudioNode): void {
    this.detach()
    const rt = new MusicRuntime(ctx, dest)
    rt.setIntensity(this.intensity)
    rt.setVoiceActive(this.voiceActive)
    rt.setEnabled(this.enabled)
    this.rt = rt
  }

  detach(): void {
    this.rt?.dispose()
    this.rt = null
  }

  update(now: number): void {
    this.rt?.update(now)
  }
}
