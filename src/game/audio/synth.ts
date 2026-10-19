/**
 * Synthesis toolkit: math helpers, a seeded PRNG, procedural sample buffers
 * (noise beds, water bubbles, leaf rustle, gravel crunch, insects), Karplus–Strong
 * plucks, a synthetic reverb impulse and small node utilities.
 *
 * Everything here is plain JS writing into AudioBuffers; it is called once at
 * unlock (or lazily) and never per frame.
 */

/* ------------------------------------------------------------------ math */

export const TAU = Math.PI * 2

export type Rng = () => number

/** Small, fast, seedable PRNG (deterministic buffers between sessions). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20)
}

export function gainToDb(g: number): number {
  return 20 * Math.log10(Math.max(g, 1e-9))
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Hermite smoothstep; edges may be descending (e.g. smoothstep(30, 16, d) = 1 near, 0 far). */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

export function rand(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

/** Log-uniform random (good for frequencies). */
export function logRand(min: number, max: number): number {
  return min * Math.pow(max / min, Math.random())
}

export function randRange(r: readonly [number, number]): number {
  return rand(r[0], r[1])
}

export function chance(p: number): boolean {
  return Math.random() < p
}

export function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length) % items.length]
}

export function midiToHz(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12)
}

/* ------------------------------------------------------- buffer helpers */

/**
 * Where buffers are created. A BaseAudioContext satisfies it; SoundBank passes a
 * wrapper with a lower sampleRate (procedural textures need < 12 kHz).
 */
export interface BufferTarget {
  readonly sampleRate: number
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer
}

function rms(d: Float32Array): number {
  let s = 0
  for (let i = 0; i < d.length; i++) s += d[i] * d[i]
  return Math.sqrt(s / Math.max(1, d.length))
}

function peakOf(d: Float32Array): number {
  let p = 0
  for (let i = 0; i < d.length; i++) {
    const a = Math.abs(d[i])
    if (a > p) p = a
  }
  return p
}

function removeMean(d: Float32Array): void {
  let s = 0
  for (let i = 0; i < d.length; i++) s += d[i]
  const m = s / Math.max(1, d.length)
  for (let i = 0; i < d.length; i++) d[i] -= m
}

/** Scale to a target RMS, but never let the peak exceed `maxPeak`. */
function normalize(d: Float32Array, targetRms: number, maxPeak = 0.95): void {
  const r = rms(d)
  if (r < 1e-9) return
  let g = targetRms / r
  const p = peakOf(d)
  if (p * g > maxPeak) g = maxPeak / p
  for (let i = 0; i < d.length; i++) d[i] *= g
}

function normalizePeak(d: Float32Array, target: number): void {
  const p = peakOf(d)
  if (p < 1e-9) return
  const g = target / p
  for (let i = 0; i < d.length; i++) d[i] *= g
}

/**
 * Write `src` (length = len + fade) into `dst` (length = len) so that it loops
 * seamlessly: the extra tail is equal-power crossfaded into the head.
 */
function loopify(src: Float32Array, dst: Float32Array, fade: number): void {
  const len = dst.length
  for (let i = 0; i < len; i++) dst[i] = src[i]
  for (let i = 0; i < fade; i++) {
    const x = (i / fade) * (Math.PI / 2)
    dst[i] = src[i] * Math.sin(x) + src[len + i] * Math.cos(x)
  }
}

/**
 * Sparse textures (bubbles, grains, clicks) have a high crest factor. Buffers are
 * float, so let peaks exceed full scale and keep the RMS target exact; the
 * gains downstream are far below unity.
 */
const SPARSE_MAX_PEAK = 4

/** Generate `seconds` of loopable mono audio with `gen`, normalised to `targetRms`. */
function loopBuffer(
  ctx: BufferTarget,
  seconds: number,
  targetRms: number,
  gen: (out: Float32Array, sr: number) => void,
  fadeSeconds = 0.2,
  maxPeak = 0.95,
): AudioBuffer {
  const sr = ctx.sampleRate
  const len = Math.max(1, Math.floor(seconds * sr))
  const fade = Math.min(Math.floor(fadeSeconds * sr), len - 1)
  const tmp = new Float32Array(len + fade)
  gen(tmp, sr)
  removeMean(tmp)
  const buf = ctx.createBuffer(1, len, sr)
  const out = buf.getChannelData(0)
  loopify(tmp, out, fade)
  normalize(out, targetRms, maxPeak)
  return buf
}

/* ---------------------------------------------------------------- noise */

export type NoiseColor = 'white' | 'pink' | 'brown'

/** Corner of the leaky brown-noise integrator: flat below, −6 dB/oct above (energy sits where wind/surf use it). */
const BROWN_CORNER_HZ = 50

function genNoise(color: NoiseColor, out: Float32Array, rng: Rng, sr: number): void {
  if (color === 'white') {
    for (let i = 0; i < out.length; i++) out[i] = rng() * 2 - 1
  } else if (color === 'pink') {
    // Paul Kellet's refined pink filter.
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0
    for (let i = 0; i < out.length; i++) {
      const w = rng() * 2 - 1
      b0 = 0.99886 * b0 + w * 0.0555179
      b1 = 0.99332 * b1 + w * 0.0750759
      b2 = 0.969 * b2 + w * 0.153852
      b3 = 0.8665 * b3 + w * 0.3104856
      b4 = 0.55 * b4 + w * 0.5329522
      b5 = -0.7616 * b5 - w * 0.016898
      out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362
      b6 = w * 0.115926
    }
  } else {
    const leak = Math.exp((-TAU * BROWN_CORNER_HZ) / sr)
    let y = 0
    for (let i = 0; i < out.length; i++) {
      y = leak * y + (rng() * 2 - 1) * 0.1
      out[i] = y
    }
  }
}

/** Loopable mono noise, RMS-normalised (default 0.2 ≈ −14 dBFS). */
export function noiseBuffer(ctx: BufferTarget, color: NoiseColor, seconds: number, seed: number, targetRms = 0.2): AudioBuffer {
  const rng = mulberry32(seed)
  return loopBuffer(ctx, seconds, targetRms, (out, sr) => genNoise(color, out, rng, sr), 0.3)
}

/** Loopable smooth random control signal in −1..1 (cosine-interpolated points at `rateHz`). */
export function smoothRandomBuffer(ctx: BufferTarget, seconds: number, rateHz: number, seed: number): AudioBuffer {
  const rng = mulberry32(seed)
  const buf = loopBuffer(
    ctx,
    seconds,
    0.5,
    (out, sr) => {
      const step = Math.max(2, Math.floor(sr / rateHz))
      let a = rng() * 2 - 1
      let b = rng() * 2 - 1
      let k = 0
      for (let i = 0; i < out.length; i++) {
        if (k >= step) {
          k = 0
          a = b
          b = rng() * 2 - 1
        }
        const x = (1 - Math.cos((k / step) * Math.PI)) * 0.5
        out[i] = a + (b - a) * x
        k++
      }
    },
    0.3,
  )
  // Rescale to peak 1 so it can drive gain params with a known depth.
  normalizePeak(buf.getChannelData(0), 1)
  return buf
}

/* ---------------------------------------------------------------- water */

export interface WaterOptions {
  seconds: number
  /** Mean bubbles per second. */
  rate: number
  fMin: number
  fMax: number
  seed: number
}

/** Pitch rise factor of a bubble (van den Doel: σ = ξ·d, ξ ≈ 0.1). */
const BUBBLE_RISE = 0.1
const BUBBLE_MAX_SECONDS = 0.06

/**
 * Babbling water: a Poisson field of Minnaert bubbles (damped sines with a
 * slight upward chirp), clustered by a slowly changing rate.
 */
export function waterBuffer(ctx: BufferTarget, o: WaterOptions): AudioBuffer {
  const rng = mulberry32(o.seed)
  return loopBuffer(
    ctx,
    o.seconds,
    0.15,
    (out, sr) => {
      const total = out.length / sr
      const atk = Math.max(1, Math.floor(0.0004 * sr))
      const maxN = Math.floor(BUBBLE_MAX_SECONDS * sr)
      let t = 0
      let mult = 1
      let multUntil = 0
      while (t < total) {
        if (t >= multUntil) {
          mult = 0.3 + rng() * 1.4
          multUntil = t + 0.15 + rng() * 0.45
        }
        t += -Math.log(1 - rng() * 0.999) / (o.rate * mult)
        const f0 = o.fMin * Math.pow(o.fMax / o.fMin, rng())
        const r = 3 / f0 // bubble radius, m
        const d = 0.13 / r + 0.0072 * Math.pow(r, -1.5) // damping, 1/s
        const sigma = BUBBLE_RISE * d
        const amp = Math.pow(rng(), 2.2) * Math.sqrt(o.fMin / f0)
        const n = Math.min(maxN, Math.floor((5 / d) * sr))
        const i0 = Math.floor(t * sr)
        let phase = 0
        for (let k = 0; k < n; k++) {
          const idx = i0 + k
          if (idx >= out.length) break
          const tt = k / sr
          phase += (TAU * f0 * (1 + sigma * tt)) / sr
          const env = Math.exp(-d * tt) * (k < atk ? k / atk : 1)
          out[idx] += amp * env * Math.sin(phase)
        }
      }
    },
    0.25,
    SPARSE_MAX_PEAK,
  )
}

/* ---------------------------------------------------------------- grains */

export interface GrainOptions {
  seconds: number
  /** Mean grains per second. */
  rate: number
  /** Grain length range, seconds. */
  minLen: number
  maxLen: number
  /** Exponent on uniform amplitude (higher → sparser loud grains). */
  ampPower: number
  /** Clustering: rate multiplier is re-drawn every `clusterMin..clusterMax` seconds in [0.1, 2.2]. */
  clusterMin: number
  clusterMax: number
  /** Fraction of grains that are tiny resonant "clicks" (pebbles, twigs). */
  clickChance: number
  clickFMin: number
  clickFMax: number
  /** Continuous soft hiss under the grains (relative). */
  hiss: number
  seed: number
}

/** Granular noise texture: leaf rustle, gravel crunch. */
export function grainBuffer(ctx: BufferTarget, o: GrainOptions): AudioBuffer {
  const rng = mulberry32(o.seed)
  return loopBuffer(
    ctx,
    o.seconds,
    0.15,
    (out, sr) => {
      const total = out.length / sr
      let t = 0
      let mult = 1
      let multUntil = 0
      while (t < total) {
        if (t >= multUntil) {
          mult = 0.1 + Math.pow(rng(), 1.5) * 2.1
          multUntil = t + o.clusterMin + rng() * (o.clusterMax - o.clusterMin)
        }
        t += -Math.log(1 - rng() * 0.999) / (o.rate * mult)
        const i0 = Math.floor(t * sr)
        const amp = Math.pow(rng(), o.ampPower) * (rng() < 0.5 ? -1 : 1)
        if (rng() < o.clickChance) {
          const f = o.clickFMin + rng() * (o.clickFMax - o.clickFMin)
          const tau = 0.0004 + rng() * 0.0008
          const n = Math.floor(tau * 5 * sr)
          for (let k = 0; k < n && i0 + k < out.length; k++) {
            out[i0 + k] += amp * Math.exp(-k / (tau * sr)) * Math.sin((TAU * f * k) / sr)
          }
        } else {
          const len = Math.max(2, Math.floor((o.minLen + rng() * (o.maxLen - o.minLen)) * sr))
          const tau = len / 3
          for (let k = 0; k < len && i0 + k < out.length; k++) {
            out[i0 + k] += amp * Math.exp(-k / tau) * (rng() * 2 - 1)
          }
        }
      }
      if (o.hiss > 0) for (let i = 0; i < out.length; i++) out[i] += (rng() * 2 - 1) * o.hiss * 0.1
    },
    0.15,
    SPARSE_MAX_PEAK,
  )
}

/* ---------------------------------------------------------------- insects */

/** Field-cricket chirps: 3–4 sine pulses at ~4.6 kHz, repeating ~every 0.56 s. Periodic, no crossfade needed. */
export function cricketBuffer(ctx: BufferTarget, seed: number): AudioBuffer {
  const rng = mulberry32(seed)
  const sr = ctx.sampleRate
  const period = 0.56
  const chirps = 8
  const len = Math.floor(period * chirps * sr)
  const buf = ctx.createBuffer(1, len, sr)
  const out = buf.getChannelData(0)
  const carrier = 4600
  const pulseLen = 0.013
  const pulseGap = 0.021
  for (let c = 0; c < chirps; c++) {
    const pulses = rng() < 0.3 ? 4 : 3
    const amp = 0.8 + rng() * 0.2
    const start = c * period + 0.02 + rng() * 0.03
    for (let p = 0; p < pulses; p++) {
      const i0 = Math.floor((start + p * pulseGap) * sr)
      const n = Math.floor(pulseLen * sr)
      const pAmp = amp * (p === pulses - 1 ? 0.75 : 1)
      for (let k = 0; k < n && i0 + k < len; k++) {
        const w = Math.sin((Math.PI * k) / n)
        const ph = (TAU * carrier * k) / sr
        out[i0 + k] += pAmp * w * w * (Math.sin(ph) + 0.06 * Math.sin(2 * ph))
      }
    }
  }
  normalizePeak(out, 0.5)
  return buf
}

/** Cicada buzz: a dense train of tymbal clicks (damped 5–6 kHz resonances), stationary, loopable. */
export function cicadaBuffer(ctx: BufferTarget, seed: number): AudioBuffer {
  const rng = mulberry32(seed)
  return loopBuffer(
    ctx,
    3.3,
    0.15,
    (out, sr) => {
      const total = out.length / sr
      let t = 0
      let flutter = 1
      while (t < total) {
        t += 1 / (150 + rng() * 40)
        flutter = 0.85 * flutter + 0.15 * (0.55 + rng() * 0.45)
        const f = 4800 + rng() * 1400
        const tau = 0.0006 + rng() * 0.0004
        const i0 = Math.floor(t * sr)
        const n = Math.floor(tau * 5 * sr)
        for (let k = 0; k < n && i0 + k < out.length; k++) {
          out[i0 + k] += flutter * Math.exp(-k / (tau * sr)) * (Math.sin((TAU * f * k) / sr) + (rng() - 0.5) * 0.3)
        }
      }
    },
    0.1,
    SPARSE_MAX_PEAK,
  )
}

/* ---------------------------------------------------------------- plucks */

export interface PluckOptions {
  seconds: number
  /** Time to decay by 60 dB at the fundamental. */
  t60: number
  /** 0..1, excitation brightness (0 = very soft finger pluck). */
  brightness: number
  /** 0..0.5, relative pluck position along the string (comb colouring). */
  position: number
  seed: number
}

/**
 * Karplus–Strong string with a fractional-delay allpass for exact tuning, a
 * lowpassed noise excitation and a pluck-position comb. Mono, peak 0.5.
 */
export function pluckBuffer(ctx: BufferTarget, freq: number, o: PluckOptions): AudioBuffer {
  const sr = ctx.sampleRate
  const total = Math.max(1, Math.floor(o.seconds * sr))
  const buf = ctx.createBuffer(1, total, sr)
  const out = buf.getChannelData(0)
  const rng = mulberry32(o.seed)

  const N = sr / freq
  let D = Math.max(2, Math.floor(N - 0.5))
  let frac = N - 0.5 - D
  if (frac < 0.1 && D > 2) {
    D -= 1
    frac += 1
  }
  const C = (1 - frac) / (1 + frac)
  const loss = Math.cos((Math.PI * freq) / sr)
  const rho = Math.min(0.99995, Math.pow(0.001, 1 / (o.t60 * freq)) / loss)

  // Excitation.
  const raw = new Float32Array(D)
  const a = clamp(1 - o.brightness, 0, 0.95)
  let lp = 0
  for (let i = 0; i < D; i++) {
    lp = a * lp + (1 - a) * (rng() * 2 - 1)
    raw[i] = lp
  }
  const line = new Float32Array(D)
  const P = Math.max(1, Math.round(o.position * D))
  for (let i = 0; i < D; i++) line[i] = raw[i] - raw[(i + P) % D]
  removeMean(line)
  normalizePeak(line, 1)

  let idx = 0
  let prev = 0
  let apx = 0
  let apy = 0
  for (let n = 0; n < total; n++) {
    const cur = line[idx]
    out[n] = cur
    const avg = 0.5 * (cur + prev)
    prev = cur
    const ap = C * avg + apx - C * apy
    apx = avg
    apy = ap
    line[idx] = ap * rho
    idx++
    if (idx >= D) idx = 0
  }
  // Soften the first ms (no click) and fade the tail to exact silence.
  const atk = Math.floor(0.0015 * sr)
  for (let i = 0; i < atk && i < total; i++) out[i] *= i / atk
  const rel = Math.min(total, Math.floor(0.25 * sr))
  for (let i = 0; i < rel; i++) out[total - 1 - i] *= i / rel
  normalizePeak(out, 0.5)
  return buf
}

/* ---------------------------------------------------------------- reverb */

/** Stereo synthetic hall-ish IR: exponentially decaying noise that darkens over time. */
export function reverbImpulse(ctx: BufferTarget, seconds: number, seed: number): AudioBuffer {
  const sr = ctx.sampleRate
  const len = Math.floor(seconds * sr)
  const pre = Math.floor(0.012 * sr)
  const buf = ctx.createBuffer(2, len, sr)
  for (let ch = 0; ch < 2; ch++) {
    const rng = mulberry32(seed + ch * 7919)
    const d = buf.getChannelData(ch)
    let y = 0
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr
      const env = Math.exp((-6.9 * t) / seconds)
      const k = 0.15 + 0.75 * Math.min(1, t / seconds)
      y = k * y + (1 - k) * (rng() * 2 - 1)
      d[i] = y * env
    }
    // Fade-in over the first 8 ms avoids a hard onset.
    const fi = Math.floor(0.008 * sr)
    for (let i = 0; i < fi; i++) d[pre + i] *= i / fi
  }
  return buf
}

/* ---------------------------------------------------------------- limiter */

/**
 * Soft-clip curve for a WaveShaper used as a safety limiter. The curve spans an
 * input range of ±`range` (feed it through a 1/range pre-gain and a `range`
 * post-gain). Linear below `knee`, smoothly saturating to `ceiling`.
 */
export function softClipCurve(knee: number, ceiling: number, range: number, n = 4096): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(n)
  const span = ceiling - knee
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * range
    const ax = Math.abs(x)
    const y = ax <= knee ? ax : knee + span * Math.tanh((ax - knee) / span)
    curve[i] = (Math.sign(x) * y) / range
  }
  return curve
}

/* ---------------------------------------------------------------- nodes */

/** Disconnect `nodes` when `src` ends (keeps the graph clean for one-shot sounds). */
export function disposeOnEnded(src: AudioScheduledSourceNode, nodes: readonly AudioNode[]): void {
  src.onended = () => {
    src.onended = null
    for (const n of nodes) {
      try {
        n.disconnect()
      } catch {
        /* already disconnected */
      }
    }
  }
}

/** Start a looping buffer source at a random offset (decorrelates shared buffers). */
export function loopSource(ctx: BaseAudioContext, buffer: AudioBuffer, rate = 1): AudioBufferSourceNode {
  const src = ctx.createBufferSource()
  src.buffer = buffer
  src.loop = true
  src.playbackRate.value = rate
  src.start(ctx.currentTime, Math.random() * buffer.duration)
  return src
}

export function makeFilter(ctx: BaseAudioContext, type: BiquadFilterType, freq: number, q = 0.7071, gainDb = 0): BiquadFilterNode {
  const f = ctx.createBiquadFilter()
  f.type = type
  f.frequency.value = freq
  f.Q.value = q
  f.gain.value = gainDb
  return f
}

export function makeGain(ctx: BaseAudioContext, value: number): GainNode {
  const g = ctx.createGain()
  g.gain.value = value
  return g
}

/** Smoothly move a param toward `v` (tc ≤ 0 jumps). Ignores non-finite input. */
export function setParam(param: AudioParam, v: number, now: number, tc: number): void {
  if (!Number.isFinite(v)) return
  if (tc <= 0) {
    param.cancelScheduledValues(now)
    param.setValueAtTime(v, now)
  } else {
    param.setTargetAtTime(v, now, tc)
  }
}

/** Stop + disconnect a list of nodes, ignoring errors. */
export function teardown(nodes: readonly AudioNode[]): void {
  for (const n of nodes) {
    try {
      if (n instanceof AudioScheduledSourceNode) n.stop()
    } catch {
      /* not started / already stopped */
    }
    try {
      n.disconnect()
    } catch {
      /* already disconnected */
    }
  }
}
