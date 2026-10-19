import { suspend } from 'suspend-react'
import { ClampToEdgeWrapping, Color, DoubleSide, MeshStandardMaterial, RepeatWrapping, Vector2, type Texture } from 'three'
import { createFrescoTexture } from './common'
import { loadAllTextureSets, type TextureSet, type TextureSlot } from './textures'

/**
 * Shared architectural materials. Geometry UVs are in metres; each material
 * sets its texture repeat to 1 / tileSize.
 */

const SLOTS: TextureSlot[] = ['plaster-wall', 'paving-stone', 'roof-tiles', 'marble', 'wood-weathered', 'bark', 'brick-roman', 'rock-cliff']

export type ArchMaterialKey =
  | 'plaster'
  | 'plasterWarm'
  | 'fresco'
  | 'column'
  | 'paving'
  | 'pavingDark'
  | 'roof'
  | 'ceiling'
  | 'marble'
  | 'wood'
  | 'woodDark'
  | 'bark'
  | 'interior'
  | 'terracotta'
  | 'brick'
  | 'stone'
  | 'parchment'

function tiled(t: Texture | null, tile: number): Texture | null {
  if (!t) return null
  const c = t.clone()
  c.wrapS = c.wrapT = RepeatWrapping
  c.repeat.set(1 / tile, 1 / tile)
  c.needsUpdate = true
  return c
}

function pbr(set: TextureSet, tile: number, opts: { color: string; roughness?: number; normal?: number; vertexColors?: boolean; ao?: number }) {
  const m = new MeshStandardMaterial({
    color: new Color(opts.color),
    roughness: opts.roughness ?? 0.9,
    metalness: 0,
    vertexColors: opts.vertexColors ?? false,
  })
  m.map = tiled(set.map, tile)
  m.normalMap = tiled(set.normalMap, tile)
  if (m.normalMap) m.normalScale = new Vector2(opts.normal ?? 1, opts.normal ?? 1)
  const arm = tiled(set.arm, tile)
  if (arm) {
    m.roughnessMap = arm
    m.aoMap = arm
    m.aoMapIntensity = opts.ao ?? 0.7
  } else if (set.rough) {
    m.roughnessMap = tiled(set.rough, tile)
  }
  return m
}

export function createArchMaterials(sets: Record<TextureSlot, TextureSet>): Record<ArchMaterialKey, MeshStandardMaterial> {
  const plaster = pbr(sets['plaster-wall'], 2.6, { color: '#f1e6d2', roughness: 0.92, normal: 0.6, vertexColors: true })
  const plasterWarm = pbr(sets['plaster-wall'], 2.6, { color: '#e8cfa6', roughness: 0.92, normal: 0.6, vertexColors: true })

  const frescoTex = createFrescoTexture()
  frescoTex.wrapT = ClampToEdgeWrapping
  frescoTex.repeat.set(1 / 4, 1 / 4.2)
  const fresco = new MeshStandardMaterial({ map: frescoTex, roughness: 0.82, metalness: 0, vertexColors: true })
  fresco.normalMap = tiled(sets['plaster-wall'].normalMap, 2.6)
  fresco.normalScale = new Vector2(0.35, 0.35)

  // Columns: smooth lime stucco — keep only a faint normal detail, no stained albedo.
  const column = pbr(sets['plaster-wall'], 1.6, { color: '#efe4d1', roughness: 0.8, normal: 0.25, vertexColors: true })
  column.map = null
  const paving = pbr(sets['paving-stone'], 2.2, { color: '#e9dfcf', roughness: 0.9, normal: 0.9, vertexColors: true })
  const pavingDark = pbr(sets['paving-stone'], 2.2, { color: '#b9a48a', roughness: 0.92, normal: 0.9, vertexColors: true })
  const roof = pbr(sets['roof-tiles'], 1.8, { color: sets['roof-tiles'].map ? '#e2a882' : '#a8543a', roughness: 0.8, normal: 1.2, vertexColors: true })
  const ceiling = pbr(sets['wood-weathered'], 2.0, { color: '#8a6a4c', roughness: 0.85, vertexColors: true })
  ceiling.side = DoubleSide
  const marble = pbr(sets['marble'], 1.4, { color: '#f3ede2', roughness: 0.55, normal: 0.6, vertexColors: true })
  const wood = pbr(sets['wood-weathered'], 1.6, { color: '#b08a66', roughness: 0.85, vertexColors: true })
  const woodDark = pbr(sets['wood-weathered'], 1.6, { color: '#6e4e34', roughness: 0.85, vertexColors: true })
  const bark = pbr(sets['bark'], 1.2, { color: '#a59a8c', roughness: 0.95, normal: 1.4, vertexColors: true })
  const interior = new MeshStandardMaterial({ color: '#1b130d', roughness: 1, metalness: 0 })
  const terracotta = new MeshStandardMaterial({ color: '#b5643f', roughness: 0.85, metalness: 0, vertexColors: true })
  const brick = pbr(sets['brick-roman'], 1.2, { color: sets['brick-roman'].map ? '#ffffff' : '#a65a3e', roughness: 0.9, vertexColors: true })

  const stone = pbr(sets['rock-cliff'], 2.4, { color: '#d8cdbb', roughness: 0.95, normal: 1.2, vertexColors: true })
  const parchment = new MeshStandardMaterial({ color: '#e6d6b0', roughness: 0.8, metalness: 0, vertexColors: true })

  return { plaster, plasterWarm, fresco, column, paving, pavingDark, roof, ceiling, marble, wood, woodDark, bark, interior, terracotta, brick, stone, parchment }
}

let shared: Record<ArchMaterialKey, MeshStandardMaterial> | null = null

/** Suspends until textures are loaded; materials are shared app-wide. */
export function useArchMaterials(): Record<ArchMaterialKey, MeshStandardMaterial> {
  const sets = suspend(() => loadAllTextureSets(SLOTS), ['arch-textures'])
  if (!shared) shared = createArchMaterials(sets)
  return shared
}

/** Free GPU resources of the shared materials (called when the Canvas unmounts). */
export function disposeArchMaterials() {
  if (!shared) return
  for (const m of Object.values(shared)) {
    m.map?.dispose()
    m.normalMap?.dispose()
    m.roughnessMap?.dispose()
    m.dispose()
  }
  shared = null
}
