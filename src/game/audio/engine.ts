/**
 * Audio engine (singleton `audio`): one lazily created AudioContext, the bus
 * graph, listener, a 10 Hz control tick and the four sub-systems.
 *
 *   voice ─────────────────────────────→ voiceBus ─┐
 *   ambience → fade-in → voice duck ───→ ambBus ───┤
 *   footsteps → sfx ───────────────────↗           ├→ master → menu LPF → menu gain → compressor → makeup⁻¹ → soft-clip limiter → out
 *   music ─────────────────────────────→ musicBus ─┘
 *
 * Before unlock() every call is safe: settings/config are remembered and
 * applied on unlock; the voice runs on silent timers so the director never stalls.
 * See docs/audio/engine.md for levels and tuning.
 */
import { Ambience } from './ambience'
import { SoundBank } from './bank'
import type { AudioEngineApi, BusName, Vec3Like } from './contract'
import { Footsteps } from './footsteps'
import { LifeAudio } from './life'
import { Music } from './music'
import { ListenerDriver, type ListenerState } from './spatial'
import { clamp, dbToGain, gainToDb, makeFilter, makeGain, setParam, softClipCurve, teardown } from './synth'
import { VoicePlayer } from './voice'

/* ------------------------------------------------------------- tuning */

/** Defaults match the settings store; the store overrides them via setBusVolume. */
const DEFAULT_VOLUMES: Record<BusName, number> = { master: 0.9, voice: 1, ambience: 0.75, music: 0.35 }
/** Internal trims on top of the user volumes (dB). */
const VOICE_TRIM_DB = 0
const AMBIENCE_TRIM_DB = 0
const MUSIC_TRIM_DB = 0
/** Footsteps relative to the ambience bus (dB). */
const SFX_TRIM_DB = 0
const VOLUME_TC = 0.08
/** Ambience dips slightly while Seneca speaks (dB). */
const AMBIENCE_VOICE_DUCK_DB = -2
const DUCK_ATTACK_TC = 0.4
const DUCK_RELEASE_TC = 1.2
/** Ambience fades in after unlock (s). */
const AMBIENCE_FADE_IN = 3
/** Pause-menu muffle. */
const MUFFLE_LPF_HZ = 900
const MUFFLE_DB = -8
const MUFFLE_TC = 0.15
/** Lowpass Q is in dB in Web Audio: −3.01 dB = Butterworth (no resonance). */
const FLAT_Q_DB = -3.01
/** Gentle glue compressor. Its automatic makeup gain is measured offline and cancelled. */
const COMP = { threshold: -12, knee: 8, ratio: 2.5, attack: 0.012, release: 0.3 }
const COMP_MAKEUP_ESTIMATE_DB = 3
/** Safety soft clipper: linear below LIMIT_KNEE (−3 dBFS), saturates to LIMIT_CEILING. */
const LIMIT_KNEE = 0.7
const LIMIT_CEILING = 0.98
const LIMIT_RANGE = 2
/** 'balanced' gives the audio thread more headroom (many HRTF panners); steps stay well in sync. */
const LATENCY_HINT: AudioContextLatencyCategory = 'balanced'
const TICK_MS = 100
const STAGE_SPACING_MS = 40
const RESUME_TIMEOUT_MS = 2500

/* ------------------------------------------------------------- helpers */

interface Graph {
  voiceBus: GainNode
  ambIn: GainNode
  ambDuck: GainNode
  ambienceBus: GainNode
  sfx: GainNode
  musicBus: GainNode
  master: GainNode
  muffleLp: BiquadFilterNode
  muffleGain: GainNode
  comp: DynamicsCompressorNode
  makeup: GainNode
  out: GainNode
  all: AudioNode[]
}

type Ctor<T> = new (...args: never[]) => T

function audioContextCtor(): (new (opts?: AudioContextOptions) => AudioContext) | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { AudioContext?: Ctor<AudioContext>; webkitAudioContext?: Ctor<AudioContext> }
  return (w.AudioContext ?? w.webkitAudioContext ?? null) as (new (opts?: AudioContextOptions) => AudioContext) | null
}

function offlineCtor(): (new (channels: number, length: number, sampleRate: number) => OfflineAudioContext) | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { OfflineAudioContext?: Ctor<OfflineAudioContext>; webkitOfflineAudioContext?: Ctor<OfflineAudioContext> }
  return (w.OfflineAudioContext ?? w.webkitOfflineAudioContext ?? null) as
    | (new (channels: number, length: number, sampleRate: number) => OfflineAudioContext)
    | null
}

/** Read state as a plain string (Safari adds 'interrupted'; avoids TS narrowing quirks). */
function stateOf(ctx: BaseAudioContext): string {
  return ctx.state
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function applyComp(c: DynamicsCompressorNode): void {
  c.threshold.value = COMP.threshold
  c.knee.value = COMP.knee
  c.ratio.value = COMP.ratio
  c.attack.value = COMP.attack
  c.release.value = COMP.release
}

function renderOffline(off: OfflineAudioContext): Promise<AudioBuffer> {
  return new Promise<AudioBuffer>((resolve, reject) => {
    off.oncomplete = (e) => resolve(e.renderedBuffer)
    try {
      const p: Promise<AudioBuffer> | undefined = off.startRendering()
      if (p) p.then(resolve, reject)
    } catch (e) {
      reject(e)
    }
  })
}

/**
 * DynamicsCompressorNode applies an automatic makeup gain (spec: (1/fullRangeGain)^0.6).
 * Measure it with a quiet constant signal so the mix stays at unity below threshold.
 */
async function measureCompressorMakeup(): Promise<number | null> {
  const Off = offlineCtor()
  if (!Off) return null
  const sr = 22050
  const len = Math.floor(sr * 0.4)
  const off = new Off(1, len, sr)
  const buf = off.createBuffer(1, len, sr)
  buf.getChannelData(0).fill(0.01)
  const src = off.createBufferSource()
  src.buffer = buf
  const comp = off.createDynamicsCompressor()
  applyComp(comp)
  src.connect(comp).connect(off.destination)
  src.start(0)
  const out = await renderOffline(off)
  const m = out.getChannelData(0)[len - 1] / 0.01
  return Number.isFinite(m) && m >= 0.99 && m < 8 ? m : null
}

/* ------------------------------------------------------------- engine */

interface BusLevel {
  rmsDb: number
  peakDb: number
}

class AudioEngine implements AudioEngineApi {
  readonly voice = new VoicePlayer()
  readonly ambience = new Ambience()
  readonly music = new Music()
  readonly footsteps = new Footsteps()
  readonly life = new LifeAudio()

  private ctx: AudioContext | null = null
  private graph: Graph | null = null
  private driver: ListenerDriver | null = null
  private readonly volumes: Record<BusName, number> = { ...DEFAULT_VOLUMES }
  private muffled = false
  private speaking = false
  private readonly listener: ListenerState = { x: 0, y: 0, z: 0, valid: false }
  private fx = 0
  private fy = 0
  private fz = -1
  private ux = 0
  private uy = 1
  private uz = 0
  private tickId: ReturnType<typeof setInterval> | null = null
  private stageTimer: ReturnType<typeof setTimeout> | null = null
  private unlocking: Promise<void> | null = null
  private generation = 0
  private listening = false
  private makeupDb = COMP_MAKEUP_ESTIMATE_DB
  private analysers: { name: string; node: AnalyserNode }[] | null = null
  private scratch: Float32Array<ArrayBuffer> | null = null

  constructor() {
    this.voice.onActivity = (speaking) => this.onVoiceActivity(speaking)
  }

  get ready(): boolean {
    return this.ctx !== null && stateOf(this.ctx) === 'running'
  }

  /* ------------------------------------------------ lifecycle */

  unlock(): Promise<void> {
    try {
      if (this.unlocking) return this.unlocking
      const existing = this.ctx
      if (existing) {
        if (stateOf(existing) === 'running') return Promise.resolve()
        return this.waitRunning(existing, existing.resume().catch(() => undefined))
      }
      const Ctx = audioContextCtor()
      if (!Ctx) return Promise.reject(new Error('Web Audio is not supported'))
      const ctx = new Ctx({ latencyHint: LATENCY_HINT })
      this.ctx = ctx
      // resume() must be called synchronously inside the user gesture (Safari/iOS).
      const resumed = stateOf(ctx) === 'running' ? Promise.resolve() : ctx.resume().catch(() => undefined)
      this.primeOutput(ctx)
      this.build(ctx)
      const p = this.waitRunning(ctx, resumed).finally(() => {
        this.unlocking = null
      })
      this.unlocking = p
      return p
    } catch (e) {
      // Half-built graph: drop it so a later unlock() can start clean.
      if (!this.graph && this.ctx) this.dispose()
      return Promise.reject(e instanceof Error ? e : new Error('Audio unlock failed'))
    }
  }

  private async waitRunning(ctx: AudioContext, resumed: Promise<unknown>): Promise<void> {
    if (stateOf(ctx) !== 'running') await Promise.race([resumed, delay(RESUME_TIMEOUT_MS)])
    if (stateOf(ctx) !== 'running') throw new Error('AudioContext is not running')
  }

  /** Old iOS unlock trick: play one silent sample inside the gesture. */
  private primeOutput(ctx: AudioContext): void {
    try {
      const b = ctx.createBuffer(1, 1, ctx.sampleRate)
      const s = ctx.createBufferSource()
      s.buffer = b
      s.connect(ctx.destination)
      s.onended = () => s.disconnect()
      s.start(0)
    } catch {
      /* ignore */
    }
  }

  private build(ctx: AudioContext): void {
    const gen = ++this.generation
    const now = ctx.currentTime
    const v = this.volumes

    const master = makeGain(ctx, v.master)
    const muffleLp = makeFilter(ctx, 'lowpass', this.muffled ? MUFFLE_LPF_HZ : this.openLpf(ctx), FLAT_Q_DB)
    const muffleGain = makeGain(ctx, this.muffled ? dbToGain(MUFFLE_DB) : 1)
    const comp = ctx.createDynamicsCompressor()
    applyComp(comp)
    const makeup = makeGain(ctx, dbToGain(-this.makeupDb))
    const limitPre = makeGain(ctx, 1 / LIMIT_RANGE)
    const shaper = ctx.createWaveShaper()
    shaper.curve = softClipCurve(LIMIT_KNEE, LIMIT_CEILING, LIMIT_RANGE)
    shaper.oversample = '2x'
    const out = makeGain(ctx, LIMIT_RANGE)
    master.connect(muffleLp).connect(muffleGain).connect(comp).connect(makeup).connect(limitPre).connect(shaper).connect(out).connect(ctx.destination)

    const voiceBus = makeGain(ctx, this.busGain('voice'))
    voiceBus.connect(master)
    const ambienceBus = makeGain(ctx, this.busGain('ambience'))
    ambienceBus.connect(master)
    const ambDuck = makeGain(ctx, this.speaking ? dbToGain(AMBIENCE_VOICE_DUCK_DB) : 1)
    ambDuck.connect(ambienceBus)
    const ambIn = makeGain(ctx, 0)
    ambIn.gain.setValueAtTime(0, now)
    ambIn.gain.linearRampToValueAtTime(1, now + AMBIENCE_FADE_IN)
    ambIn.connect(ambDuck)
    const sfx = makeGain(ctx, dbToGain(SFX_TRIM_DB))
    sfx.connect(ambienceBus)
    const musicBus = makeGain(ctx, this.busGain('music'))
    musicBus.connect(master)

    this.graph = {
      voiceBus,
      ambIn,
      ambDuck,
      ambienceBus,
      sfx,
      musicBus,
      master,
      muffleLp,
      muffleGain,
      comp,
      makeup,
      out,
      all: [master, muffleLp, muffleGain, comp, makeup, limitPre, shaper, out, voiceBus, ambienceBus, ambDuck, ambIn, sfx, musicBus],
    }

    this.driver = new ListenerDriver(ctx.listener)
    if (this.listener.valid) this.pushListener(ctx)

    const bank = new SoundBank(ctx)
    this.voice.attach(ctx, voiceBus)
    this.music.attach(ctx, musicBus)
    this.footsteps.attach(ctx, bank, sfx)
    const stages = this.ambience.attach(ctx, bank, ambIn, this.listener)
    // Pre-render the gravel crunch so the first footstep doesn't hitch.
    stages.push(...bank.warm(['crunch']))
    // Ambient-life sounds (doves, wings, gulls, hive hum) after the ambience layers.
    stages.push(() => this.life.attach(ctx, bank, ambIn, this.listener))
    this.runStages(gen, stages)

    this.tickId = setInterval(this.tick, TICK_MS)
    this.installListeners(ctx)
    void measureCompressorMakeup()
      .then((m) => {
        if (m === null || gen !== this.generation || !this.graph) return
        this.makeupDb = gainToDb(m)
        setParam(this.graph.makeup.gain, 1 / m, ctx.currentTime, 0.05)
      })
      .catch(() => undefined)
  }

  /** Run init stages a few frames apart so unlock never causes a long hitch. */
  private runStages(gen: number, stages: (() => void)[]): void {
    let i = 0
    const next = (): void => {
      this.stageTimer = null
      if (gen !== this.generation) return
      const stage = stages[i++]
      if (!stage) return
      try {
        stage()
      } catch {
        /* a failed stage only loses that layer */
      }
      this.stageTimer = setTimeout(next, STAGE_SPACING_MS)
    }
    this.stageTimer = setTimeout(next, 0)
  }

  private readonly tick = (): void => {
    const ctx = this.ctx
    if (!ctx) return
    const now = ctx.currentTime
    try {
      this.ambience.update(now)
    } catch {
      /* keep ticking */
    }
    try {
      this.music.update(now)
    } catch {
      /* keep ticking */
    }
    try {
      this.life.update(now)
    } catch {
      /* keep ticking */
    }
  }

  /* ------------------------------------------------ gesture / interruption recovery */

  private readonly onGesture = (): void => {
    const ctx = this.ctx
    if (!ctx) return
    const s = stateOf(ctx)
    if (s !== 'running' && s !== 'closed') ctx.resume().catch(() => undefined)
  }

  private readonly onVisibility = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') this.onGesture()
  }

  private installListeners(ctx: AudioContext): void {
    ctx.onstatechange = () => {
      // Safari 'interrupted' / unexpected 'suspended': try to come back; gestures retry too.
      const s = stateOf(ctx)
      if ((s === 'suspended' || s === 'interrupted') && typeof document !== 'undefined' && document.visibilityState === 'visible') {
        ctx.resume().catch(() => undefined)
      }
    }
    if (this.listening || typeof window === 'undefined') return
    this.listening = true
    const opts: AddEventListenerOptions = { capture: true, passive: true }
    window.addEventListener('pointerdown', this.onGesture, opts)
    window.addEventListener('keydown', this.onGesture, opts)
    window.addEventListener('touchend', this.onGesture, opts)
    document.addEventListener('visibilitychange', this.onVisibility)
  }

  private removeListeners(): void {
    if (!this.listening || typeof window === 'undefined') return
    this.listening = false
    window.removeEventListener('pointerdown', this.onGesture, true)
    window.removeEventListener('keydown', this.onGesture, true)
    window.removeEventListener('touchend', this.onGesture, true)
    document.removeEventListener('visibilitychange', this.onVisibility)
  }

  dispose(): void {
    this.generation++
    if (this.tickId !== null) clearInterval(this.tickId)
    if (this.stageTimer !== null) clearTimeout(this.stageTimer)
    this.tickId = null
    this.stageTimer = null
    this.removeListeners()
    const safe = (fn: () => void): void => {
      try {
        fn()
      } catch {
        /* ignore */
      }
    }
    safe(() => this.voice.detach())
    safe(() => this.ambience.detach())
    safe(() => this.music.detach())
    safe(() => this.footsteps.detach())
    safe(() => this.life.detach())
    if (this.graph) safe(() => teardown(this.graph?.all ?? []))
    if (this.analysers) safe(() => teardown((this.analysers ?? []).map((a) => a.node)))
    const ctx = this.ctx
    if (ctx) {
      ctx.onstatechange = null
      safe(() => void ctx.close().catch(() => undefined))
    }
    this.ctx = null
    this.graph = null
    this.driver = null
    this.analysers = null
    this.unlocking = null
  }

  /* ------------------------------------------------ mix */

  private busGain(bus: BusName): number {
    const v = this.volumes[bus]
    switch (bus) {
      case 'master':
        return v
      case 'voice':
        return v * dbToGain(VOICE_TRIM_DB)
      case 'ambience':
        return v * dbToGain(AMBIENCE_TRIM_DB)
      case 'music':
        return v * dbToGain(MUSIC_TRIM_DB)
    }
  }

  setBusVolume(bus: BusName, v: number): void {
    try {
      if (!Number.isFinite(v) || !(bus in this.volumes)) return
      this.volumes[bus] = clamp(v, 0, 1)
      const g = this.graph
      const ctx = this.ctx
      if (!g || !ctx) return
      const node = bus === 'master' ? g.master : bus === 'voice' ? g.voiceBus : bus === 'ambience' ? g.ambienceBus : g.musicBus
      setParam(node.gain, this.busGain(bus), ctx.currentTime, VOLUME_TC)
    } catch {
      /* ignore */
    }
  }

  setMenuMuffle(on: boolean): void {
    try {
      this.muffled = !!on
      const g = this.graph
      const ctx = this.ctx
      if (!g || !ctx) return
      const now = ctx.currentTime
      setParam(g.muffleLp.frequency, this.muffled ? MUFFLE_LPF_HZ : this.openLpf(ctx), now, MUFFLE_TC)
      setParam(g.muffleGain.gain, this.muffled ? dbToGain(MUFFLE_DB) : 1, now, MUFFLE_TC)
    } catch {
      /* ignore */
    }
  }

  private openLpf(ctx: BaseAudioContext): number {
    return Math.min(20000, ctx.sampleRate / 2 - 200)
  }

  private onVoiceActivity(speaking: boolean): void {
    this.speaking = speaking
    this.music.setVoiceActive(speaking)
    const g = this.graph
    const ctx = this.ctx
    if (!g || !ctx) return
    setParam(g.ambDuck.gain, speaking ? dbToGain(AMBIENCE_VOICE_DUCK_DB) : 1, ctx.currentTime, speaking ? DUCK_ATTACK_TC : DUCK_RELEASE_TC)
  }

  /* ------------------------------------------------ listener (per frame, allocation-free) */

  updateListener(position: Vec3Like, forward: Vec3Like, up: Vec3Like): void {
    try {
      if (!Number.isFinite(position.x + position.y + position.z + forward.x + forward.y + forward.z + up.x + up.y + up.z)) return
      const l = this.listener
      l.x = position.x
      l.y = position.y
      l.z = position.z
      l.valid = true
      this.fx = forward.x
      this.fy = forward.y
      this.fz = forward.z
      this.ux = up.x
      this.uy = up.y
      this.uz = up.z
      if (this.ctx) this.pushListener(this.ctx)
    } catch {
      /* never throw into the game loop */
    }
  }

  private pushListener(ctx: AudioContext): void {
    const l = this.listener
    this.driver?.update(l.x, l.y, l.z, this.fx, this.fy, this.fz, this.ux, this.uy, this.uz, ctx.currentTime)
  }

  /* ------------------------------------------------ debug */

  /** Momentary RMS/peak per bus (dBFS) over the last ~43 ms. Creates analysers on first use. */
  levels(): Record<string, BusLevel> | null {
    const g = this.graph
    const ctx = this.ctx
    if (!g || !ctx) return null
    if (!this.analysers) {
      const taps: [string, AudioNode][] = [
        ['voice', g.voiceBus],
        ['ambience', g.ambienceBus],
        ['music', g.musicBus],
        ['output', g.out],
      ]
      this.analysers = taps.map(([name, node]) => {
        const a = ctx.createAnalyser()
        a.fftSize = 2048
        node.connect(a)
        return { name, node: a }
      })
      this.scratch = new Float32Array(2048)
    }
    const res: Record<string, BusLevel> = {}
    const buf = this.scratch ?? new Float32Array(2048)
    for (const { name, node } of this.analysers) {
      node.getFloatTimeDomainData(buf)
      let s = 0
      let p = 0
      for (let i = 0; i < buf.length; i++) {
        const x = buf[i]
        s += x * x
        const a = Math.abs(x)
        if (a > p) p = a
      }
      res[name] = { rmsDb: Math.round(gainToDb(Math.sqrt(s / buf.length)) * 10) / 10, peakDb: Math.round(gainToDb(p) * 10) / 10 }
    }
    return res
  }

  /** Small state snapshot for debugging. */
  debugState(): Record<string, unknown> {
    return {
      context: this.ctx ? stateOf(this.ctx) : 'none',
      sampleRate: this.ctx?.sampleRate ?? 0,
      volumes: { ...this.volumes },
      muffled: this.muffled,
      compressorMakeupDb: Math.round(this.makeupDb * 10) / 10,
      voice: { state: this.voice.state, clip: this.voice.currentClipId, cue: this.voice.currentCue, position: this.voice.position },
      listener: { ...this.listener },
    }
  }
}

const engine = new AudioEngine()

/** The one audio engine. */
export const audio: AudioEngineApi = engine

/**
 * Dev helper: momentary bus levels in dBFS (RMS and peak over ~43 ms) plus a
 * state snapshot. In dev builds also available as `window.__senecaAudio`.
 */
export function debugAudioLevels(): { levels: Record<string, BusLevel> | null; state: Record<string, unknown> } {
  return { levels: engine.levels(), state: engine.debugState() }
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __senecaAudio?: unknown }).__senecaAudio = { audio, debugAudioLevels }
}

// Dev: when this module is hot-replaced, close the old context (no doubled audio).
if (import.meta.hot) import.meta.hot.dispose(() => engine.dispose())
