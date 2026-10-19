import { Vector3 } from 'three'
import { beforeEach, describe, expect, it } from 'vitest'
import { FRUIT_RADIUS, fruits, pickFruit, resetFruits, updateFruits } from '../game/interaction/fruits'
import { REACH, hand, resetHand, updateHand, type HandInput } from '../game/interaction/hand'
import { CITRUS_TREES, FRUIT_HOMES } from '../game/world/citrus'
import { groundHeight } from '../game/world/ground'
import { nearestOnPath } from '../game/world/path'
import { insideEstate } from '../game/world/vegetation'

function input(origin: Vector3, target: Vector3, over: Partial<HandInput> = {}): HandInput {
  return {
    origin,
    direction: target.clone().sub(origin).normalize(),
    grab: false,
    release: false,
    inspect: false,
    handVelocity: new Vector3(),
    handPosition: origin.clone().add(new Vector3(0.2, -0.22, -0.42)),
    ...over,
  }
}

describe('citrus trees', () => {
  it('stand inside the estate and off the walking path', () => {
    for (const t of CITRUS_TREES) {
      expect(insideEstate(t.x, t.z), `tree ${t.id}`).toBe(true)
      // Peristyle trees stand behind the bed hedges, so they may be a little closer.
      const hedged = Math.hypot(t.x, t.z - 30) < 6
      expect(nearestOnPath(t.x, t.z).d, `tree ${t.id} on the path`).toBeGreaterThan(hedged ? 1.9 : 2.2)
    }
  })

  it('carry plenty of fruit at a height a standing person can reach', () => {
    expect(FRUIT_HOMES.length).toBeGreaterThan(120)
    for (const h of FRUIT_HOMES) {
      const t = CITRUS_TREES[h.treeId]
      const above = h.y - t.y
      expect(above).toBeGreaterThan(0.6)
      expect(above).toBeLessThan(3.4)
    }
  })

  it('can be picked from the fountain path in the peristyle (beds are hedged)', () => {
    const gardenTrees = CITRUS_TREES.filter((t) => Math.hypot(t.x, t.z - 30) < 6)
    expect(gardenTrees).toHaveLength(4)
    for (const t of gardenTrees) {
      // Stand on the fountain ring path (r = 2.7) on the tree's side.
      const a = Math.atan2(t.z - 30, t.x)
      const sx = Math.cos(a) * 2.7
      const sz = 30 + Math.sin(a) * 2.7
      const eye = new Vector3(sx, groundHeight(sx, sz) + 1.62, sz)
      const reachable = FRUIT_HOMES.filter((h) => h.treeId === t.id && eye.distanceTo(new Vector3(h.x, h.y, h.z)) < REACH)
      expect(reachable.length, `garden tree ${t.id}`).toBeGreaterThanOrEqual(4)
    }
  })
})

describe('orchard & potted citrus', () => {
  it('keep fruit within reach from the canopy edge where the player can stand', () => {
    const open = CITRUS_TREES.filter((t) => Math.hypot(t.x, t.z - 30) >= 6)
    for (const t of open) {
      const standR = (t.potted ? 0.5 : 0.85 * t.scale) + 0.35
      let best = 0
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const sx = t.x + Math.cos(a) * standR
        const sz = t.z + Math.sin(a) * standR
        const eye = new Vector3(sx, groundHeight(sx, sz) + 1.62, sz)
        const n = FRUIT_HOMES.filter((h) => h.treeId === t.id && eye.distanceTo(new Vector3(h.x, h.y, h.z)) < REACH).length
        best = Math.max(best, n)
      }
      expect(best, `tree ${t.id}`).toBeGreaterThanOrEqual(4)
    }
  })
})

describe('hand & fruit', () => {
  beforeEach(() => {
    resetFruits()
    resetHand()
  })

  it('aims at the fruit under the crosshair and offers to pick it', () => {
    const f = fruits[10]
    const eye = f.pos.clone().add(new Vector3(1.2, 0.2, 0.4))
    expect(pickFruit(eye, f.pos.clone().sub(eye).normalize(), REACH)?.id).toBe(f.id)
    updateHand(1 / 60, input(eye, f.pos))
    expect(hand.target?.id).toBe(f.id)
    expect(hand.prompt).toMatch(/^E — сорвать /)
  })

  it('does not reach fruit beyond arm length', () => {
    const f = fruits[5]
    const eye = f.pos.clone().add(new Vector3(0, 0, REACH + 0.6))
    updateHand(1 / 60, input(eye, f.pos))
    expect(hand.target).toBeNull()
  })

  it('picks, holds, tosses, and the fruit comes to rest on the ground', () => {
    const f = fruits[20]
    const eye = f.pos.clone().add(new Vector3(0.9, 0.3, 0.6))
    updateHand(1 / 60, input(eye, f.pos, { grab: true }))
    expect(hand.held?.id).toBe(f.id)
    expect(hand.usedGrab).toBe(true)
    expect(f.state).toBe('held')
    updateHand(1 / 60, input(eye, f.pos, { release: true }))
    expect(hand.held).toBeNull()
    expect(f.state).toBe('falling')
    for (let i = 0; i < 60 * 8; i++) updateFruits(1 / 60)
    expect(f.state).toBe('ground')
    expect(f.pos.y).toBeCloseTo(groundHeight(f.pos.x, f.pos.z) + FRUIT_RADIUS * 0.9, 2)
    // …and it can be picked up again.
    const eye2 = f.pos.clone().add(new Vector3(0.3, 1.5, 0.3))
    updateHand(1 / 60, input(eye2, f.pos))
    expect(hand.prompt).toMatch(/^E — поднять /)
  })

  it('puts every fruit back on its tree for a new walk', () => {
    const f = fruits[3]
    updateHand(1 / 60, input(f.pos.clone().add(new Vector3(1, 0, 0)), f.pos, { grab: true }))
    resetFruits()
    expect(fruits.every((x) => x.state === 'tree' && x.pos.equals(x.home))).toBe(true)
  })
})
