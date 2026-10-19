/** Small deterministic noise helpers (no dependencies, cheap enough for per-frame use). */

export function hash2(x: number, y: number): number {
  // Integer hash -> [0, 1)
  let h = (x | 0) * 374761393 + (y | 0) * 668265263
  h = (h ^ (h >>> 13)) * 1274126177
  h = h ^ (h >>> 16)
  return (h >>> 0) / 4294967296
}

function smooth(t: number) {
  return t * t * (3 - 2 * t)
}

/** Value noise in [-1, 1]. */
export function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const a = hash2(xi, yi)
  const b = hash2(xi + 1, yi)
  const c = hash2(xi, yi + 1)
  const d = hash2(xi + 1, yi + 1)
  const u = smooth(xf)
  const v = smooth(yf)
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1
}

/** Fractal value noise in roughly [-1, 1]. */
export function fbm(x: number, y: number, octaves = 4): number {
  let sum = 0
  let amp = 0.5
  let freq = 1
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, y * freq) * amp
    norm += amp
    amp *= 0.5
    freq *= 2.03
  }
  return sum / norm
}

/** Mulberry32 seeded PRNG. */
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v
}

export function smoothstep(e0: number, e1: number, x: number) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

/** Frame-rate independent exponential smoothing factor. */
export function damp(lambda: number, dt: number) {
  return 1 - Math.exp(-lambda * dt)
}
