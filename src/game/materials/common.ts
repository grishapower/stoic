import { CanvasTexture, DataTexture, RepeatWrapping, RGBAFormat, SRGBColorSpace, Texture, UnsignedByteType } from 'three'

/** Shared uniforms animated by the game loop (wind, time). */
export const globalUniforms = {
  uTime: { value: 0 },
  /** 0..1 slow-varying wind strength. */
  uWind: { value: 0.45 },
}

let white: DataTexture | null = null
/** 1×1 white texture used when a texture is missing. */
export function whiteTexture(): Texture {
  if (!white) {
    white = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, RGBAFormat, UnsignedByteType)
    white.wrapS = white.wrapT = RepeatWrapping
    white.needsUpdate = true
  }
  return white
}

let flatNormal: DataTexture | null = null
export function flatNormalTexture(): Texture {
  if (!flatNormal) {
    flatNormal = new DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1, RGBAFormat, UnsignedByteType)
    flatNormal.wrapS = flatNormal.wrapT = RepeatWrapping
    flatNormal.needsUpdate = true
  }
  return flatNormal
}

/** GLSL: wind sway displacement for foliage, applied to `transformed` in object space with world position input. */
export const WIND_GLSL = /* glsl */ `
uniform float uTime;
uniform float uWind;
vec3 windOffset(vec3 wp, float flex) {
  float t = uTime;
  float gust = 0.55 + 0.45 * sin(t * 0.21 + wp.x * 0.013) * sin(t * 0.13 + wp.z * 0.017);
  float s = uWind * gust * flex;
  float a = sin(t * 1.25 + wp.x * 0.35 + wp.z * 0.21) * 0.6 + sin(t * 2.7 + wp.y * 1.3 + wp.x * 0.9) * 0.25;
  float b = cos(t * 1.05 + wp.z * 0.31 + wp.x * 0.17) * 0.5;
  return vec3(a, 0.0, b) * s;
}
`

/**
 * Painted Roman wall (Pompeian style): black dado, red panels framed by ochre
 * lines, white frieze. Height 1 = full wall height; tiles horizontally every 4 m.
 */
export function createFrescoTexture(): CanvasTexture {
  const w = 1024
  const h = 1024
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  // Wall height ≈ 4.2 m mapped to canvas height; 4 m width.
  const y = (m: number) => h - (m / 4.2) * h
  // Upper frieze — warm white.
  g.fillStyle = '#e9dcc2'
  g.fillRect(0, 0, w, h)
  // Main zone — Pompeian red.
  g.fillStyle = '#8f2e22'
  g.fillRect(0, y(3.1), w, y(0.95) - y(3.1))
  // Dado — black.
  g.fillStyle = '#1e1a17'
  g.fillRect(0, y(0.95), w, h - y(0.95))
  // Thin plinth stripe.
  g.fillStyle = '#6b2a20'
  g.fillRect(0, y(0.18), w, y(0.12) - y(0.18))
  // Panels in the red zone: inner frames.
  const panelW = w / 2
  for (let i = 0; i < 2; i++) {
    const x0 = i * panelW
    g.strokeStyle = '#c9a25a'
    g.lineWidth = 3
    g.strokeRect(x0 + 34, y(3.0) + 6, panelW - 68, y(1.05) - y(3.0) - 12)
    g.strokeStyle = 'rgba(240,220,170,0.55)'
    g.lineWidth = 1.5
    g.strokeRect(x0 + 46, y(3.0) + 18, panelW - 92, y(1.05) - y(3.0) - 36)
    // Narrow black separators between panels.
    g.fillStyle = '#231c18'
    g.fillRect(x0 - 10, y(3.1), 20, y(0.95) - y(3.1))
    // Tiny floating vignette motif.
    g.fillStyle = 'rgba(214,190,140,0.75)'
    g.beginPath()
    g.ellipse(x0 + panelW / 2, y(2.05), 18, 10, 0, 0, Math.PI * 2)
    g.fill()
    g.fillRect(x0 + panelW / 2 - 1, y(2.3), 2, y(1.8) - y(2.3))
  }
  // Frieze band with a simple meander-ish rhythm.
  g.fillStyle = '#b8894a'
  g.fillRect(0, y(3.25), w, 6)
  g.fillRect(0, y(3.6), w, 4)
  for (let x = 0; x < w; x += 32) {
    g.fillStyle = x % 64 === 0 ? '#7a3a28' : '#c9a25a'
    g.fillRect(x + 8, y(3.55), 14, y(3.3) - y(3.55))
  }
  // Dado: faux marble veining.
  g.globalAlpha = 0.18
  g.strokeStyle = '#a89070'
  for (let i = 0; i < 40; i++) {
    g.beginPath()
    const sx = Math.random() * w
    g.moveTo(sx, y(0.9))
    g.bezierCurveTo(sx + 40, y(0.6), sx - 30, y(0.4), sx + 20, y(0.2))
    g.stroke()
  }
  g.globalAlpha = 1
  // Weathering: subtle mottling.
  const img = g.getImageData(0, 0, w, h)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 18
    d[i] = Math.max(0, Math.min(255, d[i] + n))
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n))
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n))
  }
  g.putImageData(img, 0, 0)
  const tex = new CanvasTexture(c)
  tex.colorSpace = SRGBColorSpace
  tex.wrapS = RepeatWrapping
  tex.anisotropy = 8
  return tex
}

/** Leaf-card atlas: many small leaves on a transparent background. */
export type LeafKind = 'olive' | 'pine' | 'shrub' | 'oleander' | 'cypress' | 'citrus'

export function createLeafTexture(kind: LeafKind, opaque = false): CanvasTexture {
  const s = 512
  const c = document.createElement('canvas')
  c.width = s
  c.height = s
  const g = c.getContext('2d')!
  g.clearRect(0, 0, s, s)
  const rnd = mulberry(kind.length * 977 + 13 + (opaque ? 5 : 0))
  const palette: Record<typeof kind, string[]> = {
    olive: ['#7f8f62', '#98a77f', '#6a7a52', '#aab497', '#5d6c48'],
    pine: ['#3f5530', '#4d6538', '#344828', '#5a7040'],
    shrub: ['#4f6a35', '#5f7a3e', '#3f5a2c', '#6d8748'],
    oleander: ['#4b6534', '#5b7640', '#3e5a2b'],
    cypress: ['#3b5230', '#4a6339', '#30452a', '#587048'],
    citrus: ['#2d5a27', '#3b6c31', '#21461e', '#4d7f3b', '#2f6229'],
  }
  const cols = palette[kind]
  if (opaque) {
    // Tileable dense foliage: dark base + leaves everywhere (wrapping at the edges).
    g.fillStyle = cols[2] ?? cols[0]
    g.fillRect(0, 0, s, s)
    for (let i = 0; i < 5200; i++) {
      const x = rnd() * s
      const y = rnd() * s
      g.fillStyle = cols[Math.floor(rnd() * cols.length)]
      for (const [ox, oy] of [[0, 0], [-s, 0], [s, 0], [0, -s], [0, s]]) {
        g.beginPath()
        g.ellipse(x + ox, y + oy, 3 + rnd() * 4, 2 + rnd() * 2, rnd() * Math.PI, 0, Math.PI * 2)
        g.fill()
      }
    }
    const t = new CanvasTexture(c)
    t.colorSpace = SRGBColorSpace
    t.anisotropy = 4
    return t
  }
  const count = kind === 'pine' ? 900 : kind === 'cypress' ? 1100 : 340
  for (let i = 0; i < count; i++) {
    // Keep leaves inside a soft circle so the card edge never shows.
    const a = rnd() * Math.PI * 2
    // Cypress sprays thin out toward the card edge so silhouettes stay feathery.
    const r = (kind === 'cypress' ? Math.pow(rnd(), 0.8) : Math.sqrt(rnd())) * s * 0.46
    const x = s / 2 + Math.cos(a) * r
    const y = s / 2 + Math.sin(a) * r
    g.save()
    g.translate(x, y)
    g.fillStyle = cols[Math.floor(rnd() * cols.length)]
    if (kind === 'pine') {
      g.rotate(a + (rnd() - 0.5) * 0.8)
      g.fillRect(0, -1, 26 + rnd() * 18, 2.2)
    } else if (kind === 'cypress') {
      g.rotate(rnd() * Math.PI)
      g.beginPath()
      g.ellipse(0, 0, 4 + rnd() * 4, 2.5 + rnd() * 2, 0, 0, Math.PI * 2)
      g.fill()
    } else {
      g.rotate(rnd() * Math.PI * 2)
      const len = kind === 'olive' ? 22 + rnd() * 10 : kind === 'citrus' ? 17 + rnd() * 8 : 16 + rnd() * 10
      const wid = kind === 'olive' ? 4 + rnd() * 2 : kind === 'citrus' ? 7 + rnd() * 3 : 6 + rnd() * 3
      g.beginPath()
      g.ellipse(0, 0, len, wid, 0, 0, Math.PI * 2)
      g.fill()
      // Lighter midrib/underside for olive silver.
      if (kind === 'olive' && rnd() < 0.5) {
        g.fillStyle = 'rgba(220,225,200,0.35)'
        g.beginPath()
        g.ellipse(0, 0, len * 0.8, wid * 0.35, 0, 0, Math.PI * 2)
        g.fill()
      }
    }
    g.restore()
  }
  if (kind === 'citrus') {
    // A few white blossoms (citrus flowers and fruits at the same time).
    for (let i = 0; i < 26; i++) {
      const a = rnd() * Math.PI * 2
      const r = Math.sqrt(rnd()) * s * 0.42
      g.fillStyle = rnd() < 0.5 ? '#fbf6ea' : '#f3ecd6'
      g.beginPath()
      g.arc(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r, 3 + rnd() * 2, 0, Math.PI * 2)
      g.fill()
    }
  }
  if (kind === 'oleander') {
    for (let i = 0; i < 70; i++) {
      const a = rnd() * Math.PI * 2
      const r = Math.sqrt(rnd()) * s * 0.42
      g.fillStyle = rnd() < 0.5 ? '#e7a3b7' : '#f2c4d0'
      g.beginPath()
      g.arc(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r, 6 + rnd() * 4, 0, Math.PI * 2)
      g.fill()
    }
  }
  const tex = new CanvasTexture(c)
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

function mulberry(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
