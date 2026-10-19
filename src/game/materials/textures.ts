import {
  LinearSRGBColorSpace,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
  TextureLoader,
} from 'three'

/**
 * PBR texture sets fetched by scripts/assets/fetch-textures.mjs (Poly Haven, CC0).
 * The manifest lives in src/data/generated/textures.json. Every slot is optional:
 * missing files resolve to null and materials fall back to flat colours.
 */

export type TextureSlot =
  | 'ground-meadow'
  | 'ground-garden'
  | 'path-gravel'
  | 'paving-stone'
  | 'plaster-wall'
  | 'roof-tiles'
  | 'marble'
  | 'rock-cliff'
  | 'wood-weathered'
  | 'bark'
  | 'brick-roman'

export interface TextureSet {
  map: Texture | null
  normalMap: Texture | null
  /** Packed AO (r) / roughness (g) / metalness (b). */
  arm: Texture | null
  /** Roughness only (used when no ARM map is available). */
  rough: Texture | null
}

interface ManifestEntry {
  files?: Partial<Record<'color' | 'normal' | 'arm' | 'rough', string>>
}

const manifestModules = import.meta.glob('../../data/generated/textures.json', { eager: true, import: 'default' })
const manifest = (Object.values(manifestModules)[0] ?? {}) as Record<string, ManifestEntry>

const loader = new TextureLoader()
const cache = new Map<string, Promise<Texture | null>>()

function loadOne(url: string | undefined, color: boolean): Promise<Texture | null> {
  if (!url) return Promise.resolve(null)
  const key = `${url}|${color}`
  let p = cache.get(key)
  if (!p) {
    p = new Promise((resolve) => {
      loader.load(
        import.meta.env.BASE_URL + url,
        (tex) => {
          tex.wrapS = tex.wrapT = RepeatWrapping
          tex.colorSpace = color ? SRGBColorSpace : NoColorSpace
          tex.anisotropy = 8
          resolve(tex)
        },
        undefined,
        () => resolve(null),
      )
    })
    cache.set(key, p)
  }
  return p
}

const setCache = new Map<TextureSlot, Promise<TextureSet>>()

export function loadTextureSet(slot: TextureSlot): Promise<TextureSet> {
  let p = setCache.get(slot)
  if (!p) {
    const f = manifest[slot]?.files ?? {}
    p = Promise.all([loadOne(f.color, true), loadOne(f.normal, false), loadOne(f.arm, false), loadOne(f.rough, false)]).then(
      ([map, normalMap, arm, rough]) => ({ map, normalMap, arm, rough }),
    )
    setCache.set(slot, p)
  }
  return p
}

export function loadAllTextureSets(slots: TextureSlot[]): Promise<Record<TextureSlot, TextureSet>> {
  return Promise.all(slots.map((s) => loadTextureSet(s))).then((sets) => {
    const out = {} as Record<TextureSlot, TextureSet>
    slots.forEach((s, i) => (out[s] = sets[i]))
    return out
  })
}

const waterManifest = manifest['water'] as (ManifestEntry & { file?: string }) | undefined

export function loadWaterNormals(): Promise<Texture | null> {
  const url = waterManifest?.file ?? waterManifest?.files?.normal ?? 'assets/textures/water/waternormals.jpg'
  return loadOne(url, false).then((t) => {
    if (t) t.colorSpace = LinearSRGBColorSpace
    return t
  })
}

/** Clone a texture with its own repeat so different meshes can tile differently. */
export function withRepeat(tex: Texture | null, rx: number, ry = rx): Texture | null {
  if (!tex) return null
  const t = tex.clone()
  t.repeat.set(rx, ry)
  t.needsUpdate = true
  return t
}
