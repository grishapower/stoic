/**
 * Birds: a handful of individual birds, each with its own species, voice
 * (pitch/tempo), perch and HRTF panner. Phrases are synthesised with one
 * oscillator (custom PeriodicWave timbre) + one envelope gain per phrase; all
 * pitch jumps happen while the envelope is at zero, so there are no clicks.
 *
 * Species (loosely modelled on Mediterranean garden birds):
 *  - whistler: blackbird-like fluty phrases from a small personal repertoire, sometimes a high twitter coda
 *  - trill:    serin/wren-like rapid trill of tiny down-sweeps with a swell
 *  - chirp:    sparrow/finch chirp triplets (up-down "chip")
 *  - tit:      great-tit "tee-cher" pairs
 *  - dove:     collared dove "coo-COO-coo", distant
 *
 * Density follows timeOfDay: at 1 (sunset) only the first DUSK_ACTIVE birds sing, with longer gaps.
 */
import type { Vec3Like } from './contract'
import { createPanner, distanceTo, placePanner, type ListenerState } from './spatial'
import { chance, clamp, disposeOnEnded, lerp, makeGain, pick, rand, randRange, TAU, teardown } from './synth'

/* ------------------------------------------------------------- tuning */

type SpeciesId = 'whistler' | 'trill' | 'chirp' | 'tit' | 'dove'

/** Order matters: at dusk only the first DUSK_ACTIVE keep singing. */
const FLOCK: readonly SpeciesId[] = ['whistler', 'dove', 'chirp', 'trill', 'whistler', 'tit']
const DUSK_ACTIVE = 2
const REF_DISTANCE = 5
const ROLLOFF = 1
/** Perch choice: distance window and preference radius (m). */
const PERCH_MIN = 4
const PERCH_MAX = 45
const PERCH_PREF = 18
const DOVE_MIN = 16
const DOVE_MAX = 70
/** Fallback perches (no config yet): ring around the listener. */
const FALLBACK_DIST: [number, number] = [8, 28]
const FALLBACK_HEIGHT: [number, number] = [2.5, 7]
/** Relocation: every so often, or when the listener walked away. */
const RELOCATE_EVERY: [number, number] = [25, 70]
const RELOCATE_IF_FARTHER = 55
/** First phrase after unlock (s) — birds are the first thing you hear. */
const FIRST_DELAY: [number, number] = [0.6, 4.5]
/** Rest between phrases (s) and occasional longer rests. */
const INTERVAL: [number, number] = [3, 15]
const LONG_REST_CHANCE = 0.22
const LONG_REST: [number, number] = [14, 30]
/** Intervals are multiplied by 1 + DUSK_SLOWDOWN · timeOfDay. */
const DUSK_SLOWDOWN = 1.6
/** Peak oscillator level at ref distance per species (linear). */
const LEVEL: Record<SpeciesId, number> = {
  whistler: 0.085,
  trill: 0.045,
  chirp: 0.055,
  tit: 0.05,
  dove: 0.075,
}
const LOOKAHEAD = 0.25

/* ------------------------------------------------------------- types */

interface Individual {
  /** Pitch multiplier (±8 %). */
  pitch: number
  /** Tempo multiplier (±10 %). */
  tempo: number
  /** Whistler repertoire: motifs of [freq, glideRatio, duration]. */
  motifs: [number, number, number][][]
}

interface Bird {
  species: SpeciesId
  ind: Individual
  panner: PannerNode
  input: GainNode
  pos: Vec3Like
  perch: number
  nextPhrase: number
  busyUntil: number
  relocateAt: number
}

type Waves = Record<'flute' | 'chip' | 'coo', PeriodicWave>

/* ------------------------------------------------------------- phrase primitives */

/**
 * One note on a shared oscillator/envelope. Frequency is set at `t` (while the
 * envelope is at zero) and glides exponentially to f1 by the end.
 */
function note(o: OscillatorNode, g: GainNode, t: number, dur: number, f0: number, f1: number, peak: number, att: number, rel: number): void {
  o.frequency.setValueAtTime(f0, t)
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur)
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(peak, t + att)
  g.gain.linearRampToValueAtTime(peak * 0.8, t + Math.max(att + 0.001, dur - rel))
  g.gain.linearRampToValueAtTime(0, t + dur)
}

function makeIndividual(species: SpeciesId): Individual {
  const pitch = rand(0.92, 1.08)
  const motifs: [number, number, number][][] = []
  if (species === 'whistler') {
    for (let m = 0; m < 3; m++) {
      const n = Math.floor(rand(3, 6))
      const motif: [number, number, number][] = []
      for (let i = 0; i < n; i++) motif.push([rand(1500, 3100) * pitch, rand(0.82, 1.22), rand(0.09, 0.3)])
      motifs.push(motif)
    }
  }
  return { pitch, tempo: rand(0.9, 1.1), motifs }
}

/** Schedules a phrase at t; returns its duration (s). */
function phrase(species: SpeciesId, o: OscillatorNode, g: GainNode, t0: number, ind: Individual, level: number): number {
  const p = ind.pitch
  const k = 1 / ind.tempo
  let t = t0
  switch (species) {
    case 'whistler': {
      const motif = pick(ind.motifs)
      for (let i = 0; i < motif.length; i++) {
        const [f, glide, d] = motif[i]
        // Small variation each time it's sung.
        const fv = f * rand(0.97, 1.03)
        const dur = d * k * rand(0.9, 1.1)
        const amp = level * (i === 0 ? 0.8 : rand(0.75, 1))
        note(o, g, t, dur, fv, fv * glide, amp, 0.015, 0.03)
        t += dur + rand(0.03, 0.09) * k
      }
      if (chance(0.5)) {
        // High, soft twitter coda.
        t += 0.05
        const n = Math.floor(rand(3, 7))
        for (let i = 0; i < n; i++) {
          const f = rand(4500, 6500) * p
          const dur = rand(0.025, 0.04) * k
          note(o, g, t, dur, f, f * rand(0.7, 0.85), level * 0.35, 0.004, 0.01)
          t += dur + rand(0.015, 0.03) * k
        }
      }
      break
    }
    case 'trill': {
      const total = rand(0.6, 1.3) * k
      const rate = rand(14, 20) / k
      const n = Math.max(4, Math.floor(total * rate))
      const top = 5200 * p
      const drift = rand(0.9, 1.1)
      for (let i = 0; i < n; i++) {
        const x = i / (n - 1)
        const dr = lerp(1, drift, x)
        const dur = 0.6 / rate
        const swell = Math.pow(Math.sin(Math.PI * (i + 0.5) / n), 0.7)
        note(o, g, t, dur, top * dr, top * 0.72 * dr, level * (0.35 + 0.65 * swell), 0.004, 0.008)
        t += 1 / rate
      }
      break
    }
    case 'chirp': {
      const reps = chance(0.25) ? 2 : 1
      for (let r = 0; r < reps; r++) {
        const n = chance(0.7) ? 3 : chance(0.5) ? 2 : 4
        for (let i = 0; i < n; i++) {
          const dur = rand(0.05, 0.075) * k
          const fa = 2900 * p * rand(0.96, 1.04)
          // Up then down: two ramps inside one note.
          o.frequency.setValueAtTime(fa, t)
          o.frequency.exponentialRampToValueAtTime(fa * 1.48, t + dur * 0.35)
          o.frequency.exponentialRampToValueAtTime(fa * 1.12, t + dur)
          const amp = level * rand(0.8, 1)
          g.gain.setValueAtTime(0, t)
          g.gain.linearRampToValueAtTime(amp, t + 0.006)
          g.gain.linearRampToValueAtTime(amp * 0.7, t + dur - 0.012)
          g.gain.linearRampToValueAtTime(0, t + dur)
          t += dur + rand(0.07, 0.1) * k
        }
        t += rand(0.35, 0.6) * k
      }
      break
    }
    case 'tit': {
      const pairs = Math.floor(rand(3, 6))
      const period = rand(0.3, 0.36) * k
      for (let i = 0; i < pairs; i++) {
        const s = t + i * period
        note(o, g, s, 0.08 * k, 5100 * p, 5300 * p, level, 0.008, 0.015)
        note(o, g, s + 0.12 * k, 0.1 * k, 3800 * p, 3600 * p, level * 0.85, 0.008, 0.02)
      }
      t += pairs * period
      break
    }
    case 'dove': {
      const reps = Math.floor(rand(2, 5))
      for (let r = 0; r < reps; r++) {
        note(o, g, t, 0.22 * k, 520 * p, 500 * p, level * 0.7, 0.04, 0.06)
        t += 0.22 * k + 0.12 * k
        note(o, g, t, 0.55 * k, 560 * p, 520 * p, level, 0.05, 0.1)
        t += 0.55 * k + 0.18 * k
        note(o, g, t, 0.32 * k, 500 * p, 470 * p, level * 0.75, 0.04, 0.08)
        t += 0.32 * k + rand(1.1, 1.4) * k
      }
      break
    }
  }
  return t - t0
}

function waveFor(species: SpeciesId, waves: Waves): PeriodicWave | null {
  if (species === 'whistler') return waves.flute
  if (species === 'dove') return waves.coo
  if (species === 'chirp') return waves.chip
  return null // trill, tit: pure sine
}

/* ------------------------------------------------------------- system */

export class Birds {
  private readonly ctx: BaseAudioContext
  private readonly birds: Bird[] = []
  private readonly waves: Waves
  private readonly nodes: AudioNode[] = []
  private perches: Vec3Like[] = []
  private timeOfDay = 0
  /** Birds were placed before the listener was known: re-place them once it is. */
  private placedBlind = true

  constructor(ctx: BaseAudioContext, out: AudioNode, listener: ListenerState) {
    this.ctx = ctx
    this.waves = {
      flute: ctx.createPeriodicWave(new Float32Array([0, 0, 0, 0]), new Float32Array([0, 1, 0.12, 0.03])),
      chip: ctx.createPeriodicWave(new Float32Array([0, 0, 0, 0]), new Float32Array([0, 1, 0.25, 0.08])),
      coo: ctx.createPeriodicWave(new Float32Array([0, 0, 0, 0]), new Float32Array([0, 1, 0.2, 0.05])),
    }
    const now = ctx.currentTime
    for (const species of FLOCK) {
      const panner = createPanner(ctx, { refDistance: REF_DISTANCE, rolloff: ROLLOFF })
      const input = makeGain(ctx, 1)
      input.connect(panner).connect(out)
      this.nodes.push(input, panner)
      const bird: Bird = {
        species,
        ind: makeIndividual(species),
        panner,
        input,
        pos: { x: 0, y: 0, z: 0 },
        perch: -1,
        nextPhrase: now + randRange(FIRST_DELAY) * (species === 'dove' ? 3 : 1),
        busyUntil: 0,
        relocateAt: 0,
      }
      this.relocate(bird, listener, now)
      this.birds.push(bird)
    }
    this.placedBlind = !listener.valid
  }

  setPerches(perches: readonly Vec3Like[], listener: ListenerState): void {
    this.perches = perches.map((p) => ({ x: p.x, y: p.y, z: p.z }))
    const now = this.ctx.currentTime
    for (const b of this.birds) {
      b.perch = -1
      // Move silently at the next opportunity.
      if (now >= b.busyUntil) this.relocate(b, listener, now)
      else b.relocateAt = b.busyUntil
    }
  }

  setTimeOfDay(t: number): void {
    this.timeOfDay = clamp(t, 0, 1)
  }

  update(now: number, listener: ListenerState): void {
    const active = Math.round(lerp(this.birds.length, DUSK_ACTIVE, this.timeOfDay))
    const reseat = this.placedBlind && listener.valid
    if (reseat) this.placedBlind = false
    for (let i = 0; i < this.birds.length; i++) {
      const b = this.birds[i]
      const idle = now >= b.busyUntil + 0.1
      if (idle && listener.valid && (reseat || now >= b.relocateAt || distanceTo(b.pos, listener.x, listener.y, listener.z) > RELOCATE_IF_FARTHER)) {
        this.relocate(b, listener, now)
      }
      if (b.nextPhrase > now + LOOKAHEAD) continue
      if (i >= active) {
        // Resting at dusk: check again later.
        b.nextPhrase = now + rand(5, 12)
        continue
      }
      const t = Math.max(b.nextPhrase, now + 0.03)
      const dur = this.sing(b, t)
      b.busyUntil = t + dur
      const slow = 1 + DUSK_SLOWDOWN * this.timeOfDay
      const gap = chance(LONG_REST_CHANCE) ? randRange(LONG_REST) : randRange(INTERVAL)
      b.nextPhrase = b.busyUntil + gap * slow
    }
  }

  private sing(b: Bird, t: number): number {
    const ctx = this.ctx
    const osc = ctx.createOscillator()
    const wave = waveFor(b.species, this.waves)
    if (wave) osc.setPeriodicWave(wave)
    else osc.type = 'sine'
    const env = ctx.createGain()
    env.gain.value = 0
    osc.connect(env).connect(b.input)
    const dur = phrase(b.species, osc, env, t, b.ind, LEVEL[b.species])
    osc.start(t)
    osc.stop(t + dur + 0.05)
    disposeOnEnded(osc, [osc, env])
    return dur
  }

  /** Choose a perch near the listener (weighted toward ~PERCH_PREF m) and jump the panner there. */
  private relocate(b: Bird, listener: ListenerState, now: number): void {
    b.relocateAt = now + randRange(RELOCATE_EVERY)
    const lx = listener.valid ? listener.x : 0
    const ly = listener.valid ? listener.y : 0
    const lz = listener.valid ? listener.z : 0
    const isDove = b.species === 'dove'
    const lo = isDove ? DOVE_MIN : PERCH_MIN
    const hi = isDove ? DOVE_MAX : PERCH_MAX
    let chosen = -1
    if (this.perches.length > 0) {
      let total = 0
      const weights: number[] = []
      for (let i = 0; i < this.perches.length; i++) {
        const d = distanceTo(this.perches[i], lx, ly, lz)
        const taken = this.birds.some((o) => o !== b && o.perch === i)
        const w = !taken && d >= lo && d <= hi ? (isDove ? 1 : 1 / (1 + (d / PERCH_PREF) ** 2)) : 0
        weights.push(w)
        total += w
      }
      if (total > 0) {
        let r = Math.random() * total
        for (let i = 0; i < weights.length; i++) {
          r -= weights[i]
          if (r <= 0) {
            chosen = i
            break
          }
        }
        if (chosen < 0) chosen = weights.length - 1
      } else {
        // Nothing in the window: take the nearest perch beyond the minimum distance.
        let best = Infinity
        for (let i = 0; i < this.perches.length; i++) {
          const d = distanceTo(this.perches[i], lx, ly, lz)
          if (d >= lo && d < best) {
            best = d
            chosen = i
          }
        }
      }
    }
    if (chosen >= 0) {
      const p = this.perches[chosen]
      b.pos = { x: p.x, y: p.y, z: p.z }
    } else {
      const a = rand(0, TAU)
      const d = isDove ? rand(25, 45) : randRange(FALLBACK_DIST)
      b.pos = { x: lx + Math.cos(a) * d, y: ly + randRange(FALLBACK_HEIGHT), z: lz + Math.sin(a) * d }
    }
    b.perch = chosen
    placePanner(b.panner, b.pos.x, b.pos.y, b.pos.z, now, 0)
  }

  dispose(): void {
    teardown(this.nodes)
  }
}
