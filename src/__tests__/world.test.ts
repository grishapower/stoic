import { describe, expect, it } from 'vitest'
import { resolveCollisions } from '../game/world/colliders'
import { groundHeight } from '../game/world/ground'
import { PLAYER_SPAWN, ROUTE, STATIONS, TERRACE, TERRACE_Y } from '../game/world/layout'
import { PATH_LENGTH, ROUTE_POINT_S, nearestOnPath, pathPointAt } from '../game/world/path'
import { terrainHeight } from '../game/world/terrain'
import { insideEstate } from '../game/world/vegetation'

describe('route', () => {
  it('is a long, monotonic walk from the fountain to the terrace', () => {
    expect(PATH_LENGTH).toBeGreaterThan(100)
    for (let i = 1; i < ROUTE_POINT_S.length; i++) expect(ROUTE_POINT_S[i]).toBeGreaterThan(ROUTE_POINT_S[i - 1])
    expect(ROUTE_POINT_S[STATIONS.terrace]).toBeCloseTo(PATH_LENGTH, 0)
  })

  it('passes through every control point', () => {
    for (const [x, z] of ROUTE) expect(nearestOnPath(x, z).d).toBeLessThan(0.3)
  })

  it('is walkable: inside the estate and free of obstacles', () => {
    const p: [number, number] = [0, 0]
    for (let s = 0; s < PATH_LENGTH; s += 1) {
      pathPointAt(s, p)
      expect(insideEstate(p[0], p[1]), `s=${s}`).toBe(true)
      const pos = { x: p[0], z: p[1] }
      resolveCollisions(pos, 0.25)
      expect(Math.hypot(pos.x - p[0], pos.z - p[1]), `blocked at s=${s} (${p[0].toFixed(1)}, ${p[1].toFixed(1)})`).toBeLessThan(0.35)
    }
  })
})

describe('ground', () => {
  it('is finite everywhere around the estate', () => {
    for (let x = -90; x <= 90; x += 7) {
      for (let z = -100; z <= 90; z += 7) expect(Number.isFinite(terrainHeight(x, z))).toBe(true)
    }
  })

  it('has flat built floors', () => {
    expect(groundHeight(0, 33)).toBeCloseTo(-0.25) // sunken garden
    expect(groundHeight(0, 40)).toBeCloseTo(0) // portico
    expect(groundHeight(TERRACE.bench.x, TERRACE.bench.z + 2)).toBeCloseTo(TERRACE_Y)
  })

  it('spawns the player in the garden, on open ground', () => {
    const pos = { x: PLAYER_SPAWN.x, z: PLAYER_SPAWN.z }
    resolveCollisions(pos, 0.32)
    expect(pos.x).toBeCloseTo(PLAYER_SPAWN.x, 2)
    expect(pos.z).toBeCloseTo(PLAYER_SPAWN.z, 2)
  })
})

describe('collisions', () => {
  it('pushes the player out of a column', () => {
    const pos = { x: -1.5, z: 38 }
    resolveCollisions(pos, 0.32)
    expect(Math.hypot(pos.x + 1.5, pos.z - 38)).toBeGreaterThan(0.6)
  })

  it('keeps the player inside the estate (no walking off the cliff)', () => {
    const pos = { x: 0, z: -70 }
    resolveCollisions(pos, 0.32)
    expect(insideEstate(pos.x, pos.z)).toBe(true)
  })
})
