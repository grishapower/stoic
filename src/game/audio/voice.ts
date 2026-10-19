/**
 * Seneca's voice: spatialised (HRTF) with a small non-positional "presence"
 * send so the letter stays intelligible at any distance. Decodes and caches
 * clips; when a clip has no audio (or fails to load, or audio is locked) it
 * runs "silently" on a timer so cue/ended events still fire with the
 * manifest timings and the game never stalls.
 *
 * Graph:  source → fade → EQ (HPF, warm shelf, de-harsh) ─┬→ panner → spatial ─┬→ voice bus
 *                                                          └→ presence ─────────┘
 */
import { getClip } from '../../data/narration'
import type { VoiceClip } from '../../data/narration'
import type { Vec3Like, VoiceCueEvent, VoicePlayerApi } from './contract'
import { createPanner, SmoothedEmitter } from './spatial'
import { makeFilter, makeGain, teardown } from './synth'

/* ------------------------------------------------------------- tuning */

/** Distance at which the spatial path is at full level (m). */
const REF_DISTANCE = 2.5
/** Gentle inverse rolloff: −10 dB at 10 m, −15 dB at 20 m (relative to ref). */
const ROLLOFF = 0.7
/** Spatial path gain. */
const SPATIAL_GAIN = 1.0
/** Non-positional presence send (≈ −15 dB): keeps the letter audible when far/behind. */
const PRESENCE_SEND = 0.18
/** EQ: rumble cut, slight warmth, tame TTS harshness. */
const EQ_HIGHPASS_HZ = 85
const EQ_WARM_HZ = 240
const EQ_WARM_DB = 1.5
const EQ_DEHARSH_HZ = 6800
const EQ_DEHARSH_DB = -2
const EQ_DEHARSH_Q = 0.8
/** Position glide time constant (s). */
const POSITION_TC = 0.06
/** Pause fade (time constant; ×4 ≈ 250 ms to −36 dB). */
const PAUSE_FADE_TC = 0.06
const STOP_FADE_TC = 0.08
/** Fade-in when resuming / starting mid-clip (s). Clean starts use a tiny one. */
const RESUME_FADE_IN = 0.12
const START_FADE_IN = 0.008
/** Lead-in before a cue when resuming or starting `fromCue` (s). */
const CUE_LEAD = 0.15
/** Cue polling interval (ms) ≈ 30 Hz. */
const POLL_MS = 33
/** Decoded clip cache size (≈ 1 MB per 5 s of mono 48 kHz). */
const MAX_CACHED_CLIPS = 20
/** If the context stays suspended this long mid-clip, finish the clip on the silent timer (s). */
const SUSPEND_WATCHDOG = 3

/* ------------------------------------------------------------- helpers */

type Mode = 'none' | 'loading' | 'buffer' | 'silent'

function perfNow(): number {
  return performance.now() / 1000
}

function cueAt(clip: VoiceClip, pos: number): number {
  const cues = clip.cues
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i]
    if (pos >= c.start && pos < c.end) return c.index
  }
  return -1
}

function cueStart(clip: VoiceClip, index: number): number {
  for (const c of clip.cues) if (c.index === index) return c.start
  return 0
}

function silentDuration(clip: VoiceClip): number {
  let d = clip.duration
  for (const c of clip.cues) if (c.end > d) d = c.end
  return Math.max(0.05, d)
}

function decode(ctx: BaseAudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise<AudioBuffer>((resolve, reject) => {
    try {
      // Callback form for old Safari; promise form everywhere else.
      const r: Promise<AudioBuffer> | undefined = ctx.decodeAudioData(data, resolve, (e) => reject(e))
      if (r) r.then(resolve, reject)
    } catch (e) {
      reject(e)
    }
  })
}

function urlFor(file: string): string {
  return import.meta.env.BASE_URL + file.replace(/^\/+/, '')
}

/* ------------------------------------------------------------- player */

export class VoicePlayer implements VoicePlayerApi {
  /** Engine hook: called when the voice starts/stops sounding (ducking). */
  onActivity: ((speaking: boolean) => void) | null = null

  private ctx: AudioContext | null = null
  private input: GainNode | null = null
  private panner: PannerNode | null = null
  private graph: AudioNode[] = []
  private readonly emitter = new SmoothedEmitter(POSITION_TC)

  private clip: VoiceClip | null = null
  private _state: 'idle' | 'playing' | 'paused' = 'idle'
  private _cue = -1
  private mode: Mode = 'none'
  private token = 0
  private clockCtx = false
  private clockBase = 0
  private heldPos = 0
  private duration = 0
  /** Don't report cue changes before this clip position (resume lead-in). */
  private holdCuesUntil = -1
  private suspendedSince = -1
  private active: { src: AudioBufferSourceNode; gain: GainNode } | null = null
  private pollId: ReturnType<typeof setInterval> | null = null
  private speaking = false

  private readonly buffers = new Map<string, AudioBuffer>()
  private readonly pending = new Map<string, Promise<AudioBuffer | null>>()
  private readonly bytes = new Map<string, Promise<ArrayBuffer | null>>()
  private readonly failed = new Set<string>()
  private readonly cueSubs = new Set<(e: VoiceCueEvent) => void>()
  private readonly endSubs = new Set<(clipId: string) => void>()

  /* ------------------------------------------------ public read-only */

  get state(): 'idle' | 'playing' | 'paused' {
    return this._state
  }

  get currentClipId(): string | null {
    return this.clip ? this.clip.id : null
  }

  get currentCue(): number {
    return this._cue
  }

  get position(): number {
    if (this._state === 'playing' && (this.mode === 'buffer' || this.mode === 'silent')) {
      const p = this.now() - this.clockBase
      return p < 0 ? 0 : p > this.duration ? this.duration : p
    }
    return this.heldPos
  }

  /* ------------------------------------------------ engine wiring */

  attach(ctx: AudioContext, out: AudioNode): void {
    this.detach()
    this.ctx = ctx
    const input = makeGain(ctx, 1)
    const hp = makeFilter(ctx, 'highpass', EQ_HIGHPASS_HZ, 0.7)
    const warm = makeFilter(ctx, 'lowshelf', EQ_WARM_HZ, 0.7, EQ_WARM_DB)
    const deharsh = makeFilter(ctx, 'peaking', EQ_DEHARSH_HZ, EQ_DEHARSH_Q, EQ_DEHARSH_DB)
    const panner = createPanner(ctx, { refDistance: REF_DISTANCE, rolloff: ROLLOFF })
    const spatial = makeGain(ctx, SPATIAL_GAIN)
    const presence = makeGain(ctx, PRESENCE_SEND)
    input.connect(hp).connect(warm).connect(deharsh)
    deharsh.connect(panner).connect(spatial).connect(out)
    deharsh.connect(presence).connect(out)
    this.input = input
    this.panner = panner
    this.graph = [input, hp, warm, deharsh, panner, spatial, presence]
    this.emitter.reset()
    this.emitter.apply(panner, ctx.currentTime)
  }

  /** Engine is closing the context: drop audio nodes, keep logical state consistent. */
  detach(): void {
    if (!this.ctx) return
    const audible = this._state === 'playing' && (this.mode === 'buffer' || this.mode === 'loading')
    const pos = this.position
    this.releaseActive(0.01)
    this.ctx = null
    if (audible) {
      // Continue the current clip silently so the director isn't left waiting.
      this.token++
      this.stopPoll()
      this.startSilent(pos)
    }
    teardown(this.graph)
    this.graph = []
    this.input = null
    this.panner = null
    this.buffers.clear()
    this.pending.clear()
  }

  setSourcePosition(p: Vec3Like): void {
    try {
      this.emitter.set(p)
      if (this.panner && this.ctx) this.emitter.apply(this.panner, this.ctx.currentTime)
    } catch {
      /* never throw into the game loop */
    }
  }

  onCue(cb: (e: VoiceCueEvent) => void): () => void {
    this.cueSubs.add(cb)
    return () => {
      this.cueSubs.delete(cb)
    }
  }

  onEnded(cb: (clipId: string) => void): () => void {
    this.endSubs.add(cb)
    return () => {
      this.endSubs.delete(cb)
    }
  }

  /* ------------------------------------------------ loading */

  async preload(clipIds: string[]): Promise<void> {
    const tasks: Promise<unknown>[] = []
    for (const id of clipIds) {
      try {
        const clip = getClip(id)
        if (!clip.file || this.failed.has(clip.file)) continue
        tasks.push(this.ctx ? this.load(clip.file) : this.fetchBytes(clip.file))
      } catch {
        /* unknown id: ignore */
      }
    }
    await Promise.all(tasks)
  }

  private fetchBytes(file: string): Promise<ArrayBuffer | null> {
    let p = this.bytes.get(file)
    if (!p) {
      p = fetch(urlFor(file))
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .catch(() => null)
      this.bytes.set(file, p)
    }
    return p
  }

  private load(file: string): Promise<AudioBuffer | null> {
    const cached = this.buffers.get(file)
    if (cached) {
      this.buffers.delete(file)
      this.buffers.set(file, cached) // LRU bump
      return Promise.resolve(cached)
    }
    const inflight = this.pending.get(file)
    if (inflight) return inflight
    const ctx = this.ctx
    if (!ctx || this.failed.has(file)) return Promise.resolve(null)
    const p = this.fetchBytes(file)
      .then((data) => {
        // decodeAudioData detaches the ArrayBuffer: never reuse these bytes.
        this.bytes.delete(file)
        return data ? decode(ctx, data) : null
      })
      .catch(() => null)
      .then((buf) => {
        if (this.ctx !== ctx) return null
        this.pending.delete(file)
        if (buf) this.cache(file, buf)
        else this.failed.add(file)
        return buf
      })
    this.pending.set(file, p)
    return p
  }

  private cache(file: string, buf: AudioBuffer): void {
    this.buffers.set(file, buf)
    if (this.buffers.size <= MAX_CACHED_CLIPS) return
    const keep = this.clip?.file
    for (const k of this.buffers.keys()) {
      if (this.buffers.size <= MAX_CACHED_CLIPS) break
      if (k !== keep && k !== file) this.buffers.delete(k)
    }
  }

  /* ------------------------------------------------ transport */

  play(clipId: string, opts?: { fromCue?: number }): void {
    try {
      const clip = getClip(clipId)
      const prev = this.clip
      const prevCue = this._cue
      this.halt(STOP_FADE_TC)
      this.token++
      this.clip = clip
      this._cue = -1
      this._state = 'playing'
      const from = opts?.fromCue
      const offset = from !== undefined && from > 0 ? Math.max(0, cueStart(clip, from) - CUE_LEAD) : 0
      // Don't flash the previous cue during the lead-in.
      this.holdCuesUntil = offset > 0 && from !== undefined ? cueStart(clip, from) : -1
      if (prev && prevCue !== -1) this.emitCue(prev.id, -1)
      this.startAt(offset, offset > 0 ? RESUME_FADE_IN : START_FADE_IN)
      this.updateActivity()
    } catch {
      /* unknown clip etc. — never throw into the game */
    }
  }

  pause(): void {
    try {
      const clip = this.clip
      if (this._state !== 'playing' || !clip) return
      const pos = this.position
      if (this.holdCuesUntil > pos) {
        // Paused during a lead-in: keep the same restart point and hold.
        this.heldPos = Math.max(0, this.holdCuesUntil - CUE_LEAD)
      } else {
        const active = cueAt(clip, pos)
        this.heldPos = active >= 0 ? Math.max(0, cueStart(clip, active) - CUE_LEAD) : pos
        this.holdCuesUntil = active >= 0 ? cueStart(clip, active) : -1
      }
      this.halt(PAUSE_FADE_TC)
      this.token++
      this.mode = 'none'
      this._state = 'paused'
      this.updateActivity()
    } catch {
      /* ignore */
    }
  }

  resume(): void {
    try {
      if (this._state !== 'paused' || !this.clip) return
      this.token++
      this._state = 'playing'
      this.startAt(this.heldPos, RESUME_FADE_IN)
      this.updateActivity()
    } catch {
      /* ignore */
    }
  }

  stop(): void {
    try {
      const clip = this.clip
      const hadCue = this._cue !== -1
      this.halt(STOP_FADE_TC)
      this.token++
      this.clip = null
      this.mode = 'none'
      this._state = 'idle'
      this._cue = -1
      this.heldPos = 0
      this.updateActivity()
      if (clip && hadCue) this.emitCue(clip.id, -1)
    } catch {
      /* ignore */
    }
  }

  /* ------------------------------------------------ internals */

  private now(): number {
    return this.clockCtx && this.ctx ? this.ctx.currentTime : perfNow()
  }

  private startAt(offset: number, fadeIn: number): void {
    const clip = this.clip
    if (!clip) return
    this.heldPos = offset
    const ctx = this.ctx
    if (!clip.file || !ctx || ctx.state !== 'running' || this.failed.has(clip.file)) {
      this.startSilent(offset)
      return
    }
    const cached = this.buffers.get(clip.file)
    if (cached) {
      this.startBuffer(cached, offset, fadeIn)
      return
    }
    this.mode = 'loading'
    this.stopPoll()
    const token = this.token
    void this.load(clip.file).then((buf) => {
      if (token !== this.token || this._state !== 'playing' || this.mode !== 'loading') return
      try {
        if (buf && this.ctx && this.ctx.state === 'running') this.startBuffer(buf, this.heldPos, fadeIn)
        else this.startSilent(this.heldPos)
      } catch {
        this.startSilent(this.heldPos)
      }
    })
  }

  private startBuffer(buf: AudioBuffer, offset: number, fadeIn: number): void {
    const ctx = this.ctx
    const input = this.input
    if (!ctx || !input) {
      this.startSilent(offset)
      return
    }
    if (offset >= buf.duration) {
      this.startSilent(offset)
      return
    }
    const t = ctx.currentTime + 0.02
    const src = ctx.createBufferSource()
    src.buffer = buf
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(1, t + fadeIn)
    src.connect(g).connect(input)
    src.start(t, offset)
    const entry = { src, gain: g }
    src.onended = () => {
      src.onended = null
      try {
        src.disconnect()
        g.disconnect()
      } catch {
        /* ignore */
      }
      if (this.active === entry) this.active = null
    }
    this.active = entry
    this.mode = 'buffer'
    this.clockCtx = true
    this.clockBase = t - offset
    this.duration = buf.duration
    this.suspendedSince = -1
    this.startPoll()
  }

  private startSilent(offset: number): void {
    const clip = this.clip
    if (!clip) return
    this.mode = 'silent'
    this.clockCtx = false
    this.duration = silentDuration(clip)
    this.clockBase = perfNow() - offset
    this.startPoll()
  }

  /** Fade out and release the active source; stops polling. No events. */
  private halt(tc: number): void {
    this.stopPoll()
    this.releaseActive(tc)
  }

  private releaseActive(tc: number): void {
    const a = this.active
    this.active = null
    const ctx = this.ctx
    if (!a || !ctx) return
    try {
      const t = ctx.currentTime
      const p = a.gain.gain
      p.cancelScheduledValues(t)
      p.setValueAtTime(p.value, t)
      p.setTargetAtTime(0, t, tc)
      a.src.stop(t + tc * 5 + 0.02)
    } catch {
      teardown([a.src, a.gain])
    }
  }

  private startPoll(): void {
    if (this.pollId !== null) return
    this.pollId = setInterval(this.poll, POLL_MS)
  }

  private stopPoll(): void {
    if (this.pollId === null) return
    clearInterval(this.pollId)
    this.pollId = null
  }

  private readonly poll = (): void => {
    try {
      const clip = this.clip
      if (this._state !== 'playing' || !clip) {
        this.stopPoll()
        return
      }
      if (this.mode === 'buffer' && this.ctx && this.ctx.state !== 'running') {
        // Context suspended mid-clip (interrupted / blocked): don't stall forever.
        const wall = perfNow()
        if (this.suspendedSince < 0) this.suspendedSince = wall
        else if (wall - this.suspendedSince > SUSPEND_WATCHDOG) {
          const pos = this.position
          this.halt(0.01)
          this.startSilent(pos)
        }
        return
      }
      this.suspendedSince = -1
      const pos = this.position
      if (pos >= this.holdCuesUntil) {
        this.holdCuesUntil = -1
        const idx = cueAt(clip, pos)
        if (idx !== this._cue) {
          this._cue = idx
          this.emitCue(clip.id, idx)
          if (this.clip !== clip || this._state !== 'playing') return // a listener changed the transport
        }
      }
      if (pos >= this.duration - 0.005) this.finish(clip)
    } catch {
      /* never throw from a timer */
    }
  }

  private finish(clip: VoiceClip): void {
    const hadCue = this._cue !== -1
    this.stopPoll()
    this.active = null // source ends by itself
    this.token++
    this.clip = null
    this.mode = 'none'
    this._state = 'idle'
    this._cue = -1
    this.heldPos = 0
    this.updateActivity()
    if (hadCue) this.emitCue(clip.id, -1)
    for (const cb of [...this.endSubs]) {
      try {
        cb(clip.id)
      } catch {
        /* listener errors stay contained */
      }
    }
  }

  private emitCue(clipId: string, cueIndex: number): void {
    const e: VoiceCueEvent = { clipId, cueIndex }
    for (const cb of [...this.cueSubs]) {
      try {
        cb(e)
      } catch {
        /* listener errors stay contained */
      }
    }
  }

  private updateActivity(): void {
    const speaking = this._state === 'playing'
    if (speaking === this.speaking) return
    this.speaking = speaking
    try {
      this.onActivity?.(speaking)
    } catch {
      /* ignore */
    }
  }
}
