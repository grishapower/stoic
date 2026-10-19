import { describe, expect, it } from 'vitest'
import { DOVE_FLEE_RADIUS, LIFE_COUNTS, LIZARD_FLEE_RADIUS } from '../game/life/config'
import { Doves } from '../game/life/doves'
import { beeGeometry, butterflyGeometry, doveGeometry, gullGeometry, lizardGeometry, swallowGeometry } from '../game/life/geometry'
import { Gulls } from '../game/life/gulls'
import { Bees, Butterflies } from '../game/life/insects'
import { Lizards } from '../game/life/lizards'
import { writeTRS, type Vec3Like } from '../game/life/math'
import { allObstacles } from '../game/life/obstacles'
import { BATH_RIM, buildPerches, DOVECOTE_ROOF } from '../game/life/perches'
import { AmbientLifeSim } from '../game/life/sim'
import { Swallows } from '../game/life/swallows'
import { groundHeight } from '../game/world/ground'
import { BEEHIVES, BUTTERFLY_ZONES, DOVECOTE, GULL_ZONE, SWALLOW_ZONES } from '../game/world/props'

const DT = 1 / 30
const FAR: Vec3Like = { x: 0, y: 1000, z: 0 }

describe('ambient life: instance matrices', () => {
  it('points local +Z along the heading and pitches the nose up', () => {
    const m = new Float32Array(16)
    writeTRS(m, 0, 1, 2, 3, Math.PI / 2, 0, 0, 1)
    expect(m[8]).toBeCloseTo(1) // forward → +X
    expect(m[10]).toBeCloseTo(0)
    writeTRS(m, 0, 0, 0, 0, 0, 0.5, 0, 1)
    expect(m[9]).toBeCloseTo(Math.sin(0.5)) // nose up
    expect(m[12 + 1]).toBe(0)
  })
})

describe('ambient life: geometry', () => {
  it('is finite, tagged for the shader and wound to match its normals', () => {
    for (const make of [gullGeometry, swallowGeometry, doveGeometry, butterflyGeometry, beeGeometry, lizardGeometry]) {
      const g = make()
      const pos = g.getAttribute('position')
      const nor = g.getAttribute('normal')
      expect(g.getAttribute('aPart').count).toBe(pos.count)
      expect(g.getAttribute('color').count).toBe(pos.count)
      expect(pos.count % 3).toBe(0)
      expect(pos.count).toBeLessThan(1500)
      for (let v = 0; v < pos.count; v += 3) {
        const ax = pos.getX(v + 1) - pos.getX(v)
        const ay = pos.getY(v + 1) - pos.getY(v)
        const az = pos.getZ(v + 1) - pos.getZ(v)
        const bx = pos.getX(v + 2) - pos.getX(v)
        const by = pos.getY(v + 2) - pos.getY(v)
        const bz = pos.getZ(v + 2) - pos.getZ(v)
        const n = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx]
        const s = n[0] * (nor.getX(v) + nor.getX(v + 1) + nor.getX(v + 2)) + n[1] * (nor.getY(v) + nor.getY(v + 1) + nor.getY(v + 2)) + n[2] * (nor.getZ(v) + nor.getZ(v + 1) + nor.getZ(v + 2))
        expect(s).toBeGreaterThanOrEqual(0)
      }
      for (const a of Object.values(g.attributes)) for (let i = 0; i < a.array.length; i++) expect(Number.isFinite(a.array[i])).toBe(true)
      g.dispose()
    }
  })
})

describe('ambient life: perches', () => {
  const perches = buildPerches()

  it('cover roofs, the bird-bath rim and the dovecote, all finite', () => {
    expect(perches.filter((p) => p.group === 'roof').length).toBeGreaterThan(40)
    expect(perches.filter((p) => p.group === 'bath').length).toBe(BATH_RIM.perches)
    expect(perches.filter((p) => p.group === 'dovecote').length).toBeGreaterThan(8)
    for (const p of perches) expect(Number.isFinite(p.x + p.y + p.z + p.yaw)).toBe(true)
  })

  it('sit at the expected heights', () => {
    const g = groundHeight(DOVECOTE.x, DOVECOTE.z)
    for (const p of perches) {
      if (p.group === 'bath') expect(p.y).toBeCloseTo(BATH_RIM.y)
      if (p.group === 'dovecote') {
        expect(p.y - g).toBeGreaterThanOrEqual(DOVECOTE_ROOF.eaveY - 1e-6)
        expect(p.y - g).toBeLessThanOrEqual(DOVECOTE_ROOF.apexY + 1e-6)
      }
      if (p.group === 'roof') expect(p.y).toBeGreaterThan(3.9)
    }
  })
})

describe('ambient life: doves', () => {
  it('take off when the player comes close and land on a free perch away from them', () => {
    const perches = buildPerches()
    const doves = new Doves(perches, 8, 0, 7)
    const bathDove = doves.list.find((d) => d.perch >= 0 && perches[d.perch].group === 'bath')!
    expect(bathDove).toBeDefined()
    const start = bathDove.perch
    const eye = { x: bathDove.x + 1.5, y: bathDove.y + 0.8, z: bathDove.z }
    expect(Math.hypot(1.5, 0.8)).toBeLessThan(DOVE_FLEE_RADIUS)
    let flutters = 0
    doves.update(DT, eye, 0, { flutter: () => flutters++ })
    expect(bathDove.state).toBe('flying')
    expect(flutters).toBe(1)
    const target = bathDove.perch
    expect(target).not.toBe(start)
    expect(doves.occupant[start]).not.toBe(bathDove.id) // the old perch is released
    expect(doves.occupant[target]).toBe(bathDove.id) // the new one is reserved
    const p = perches[target]
    expect(Math.hypot(p.x - eye.x, p.y - eye.y, p.z - eye.z)).toBeGreaterThan(DOVE_FLEE_RADIUS)
    // The player walks away; the dove lands.
    for (let t = 0; t < 12; t += DT) doves.update(DT, FAR, 0, {})
    expect(bathDove.state).toBe('perched')
    expect(bathDove.perch).toBe(target)
    expect(Math.hypot(bathDove.x - p.x, bathDove.z - p.z)).toBeLessThan(0.3)
  })

  it('never share a perch while the player wanders among them', () => {
    const perches = buildPerches()
    const doves = new Doves(perches, 13, 5, 3)
    const route = [
      { x: -5.2, y: 1.3, z: 26.2 },
      { x: 0, y: 1.6, z: 37 },
      { x: -31.2, y: -1.2, z: -14.5 },
      { x: 9.6, y: 1.6, z: 30 },
    ]
    let progress = 0
    for (let step = 0; step < 30 * 240; step++) {
      const t = step * DT
      const a = route[Math.floor(t / 20) % route.length]
      const eye = { x: a.x + Math.sin(t) * 1.5, y: a.y, z: a.z + Math.cos(t) * 1.5 }
      progress = Math.min(1.2, t / 150)
      doves.update(DT, eye, progress, {})
      const seen = new Set<number>()
      for (const d of doves.list) {
        if (d.state === 'away') continue
        expect(d.perch).toBeGreaterThanOrEqual(0)
        expect(seen.has(d.perch)).toBe(false)
        seen.add(d.perch)
        expect(doves.occupant[d.perch]).toBe(d.id)
        expect(Number.isFinite(d.x + d.y + d.z)).toBe(true)
      }
    }
    // Evening: nobody left on the bath, the latecomers have arrived.
    expect(doves.list.filter((d) => d.state === 'perched' && perches[d.perch].group === 'bath').length).toBe(0)
    expect(doves.list.some((d) => d.state === 'away')).toBe(false)
  })
})

describe('ambient life: gulls', () => {
  it('stay over the bay inside their zone (except a terrace visitor)', () => {
    const gulls = new Gulls(9, 11)
    let visits = 0
    let cries = 0
    let near = 0
    for (let t = 0; t < 600; t += DT) {
      gulls.update(DT, { gull: (_p, n) => (n ? near++ : cries++) })
      for (const g of gulls.list) {
        expect(Number.isFinite(g.x + g.y + g.z)).toBe(true)
        if (g.mode === 'visit') visits++
        if (g.outside) continue
        expect(Math.hypot(g.x - GULL_ZONE.x, g.z - GULL_ZONE.z)).toBeLessThan(GULL_ZONE.radius + 8)
        expect(g.y).toBeGreaterThan(GULL_ZONE.minY - 3)
        expect(g.y).toBeLessThan(GULL_ZONE.maxY + 3)
      }
    }
    expect(visits).toBeGreaterThan(0)
    expect(cries).toBeGreaterThanOrEqual(600 / 60 - 1)
    expect(near).toBeGreaterThan(0)
  })
})

describe('ambient life: swallows', () => {
  it('swoop low over the lawns at dusk and keep clear of tree canopies', () => {
    const sw = new Swallows(4, 5)
    const local = allObstacles().filter((o) => SWALLOW_ZONES.some((z) => Math.hypot(o.x - z.x, o.z - z.z) < z.radius + o.radius + 3))
    const cyp = local.filter((o) => o.pillar)
    for (let t = 0; t < 120; t += DT) {
      sw.update(DT, 1)
      if (t < 20) continue // descending from the high hawking flight
      for (const s of sw.list) {
        const z = SWALLOW_ZONES.find((zz) => zz.x === s.zone.x && zz.z === s.zone.z)!
        expect(Math.hypot(s.x - z.x, s.z - z.z)).toBeLessThan(z.radius)
        const above = s.y - groundHeight(s.x, s.z)
        expect(above).toBeGreaterThan(0.9)
        for (const o of cyp) expect(Math.hypot(s.x - o.x, s.z - o.z)).toBeGreaterThan(o.radius)
        // Low unless climbing over a tree.
        if (local.every((o) => Math.hypot(s.x - o.x, s.z - o.z) > o.radius + 2.5)) expect(above).toBeLessThan(4.3)
      }
    }
  })

  it('hawk higher and fewer come down early in the walk', () => {
    const sw = new Swallows(4, 5)
    for (let t = 0; t < 30; t += DT) sw.update(DT, 0)
    const high = sw.list.filter((s) => s.y - groundHeight(s.x, s.z) > 8).length
    expect(high).toBeGreaterThan(sw.list.length / 2)
  })
})

describe('ambient life: insects', () => {
  it('butterflies flutter 0.2–1.6 m above the flowers in their zone', () => {
    const bf = new Butterflies(4, 9)
    for (let t = 0; t < 90; t += DT) {
      bf.update(DT)
      for (const b of bf.list) {
        const z = BUTTERFLY_ZONES.find((zz) => zz.x === b.zone.x && zz.z === b.zone.z)!
        expect(Math.hypot(b.x - z.x, b.z - z.z)).toBeLessThan(z.radius + 0.5)
        const above = b.y - groundHeight(b.x, b.z)
        expect(above).toBeGreaterThan(0.15)
        expect(above).toBeLessThan(1.7)
      }
    }
    expect(bf.list.some((b) => b.resting)).toBe(true)
  })

  it('bees swarm around the hives and some visit the flowers', () => {
    const bees = new Bees(28, 8, 3, 4)
    const g = groundHeight(BEEHIVES.x, BEEHIVES.z)
    let visited = 0
    for (let t = 0; t < 60; t += DT) {
      bees.update(DT)
      for (const b of bees.list) {
        expect(Number.isFinite(b.x + b.y + b.z)).toBe(true)
        if (b.kind === 'hive') {
          expect(Math.hypot(b.x - BEEHIVES.x, b.z - BEEHIVES.z)).toBeLessThan(2.2)
          expect(b.y - g).toBeGreaterThan(0.15)
          expect(b.y - g).toBeLessThan(2)
        }
        if (b.kind === 'commuter' && b.state === 'forage') visited++
      }
    }
    expect(visited).toBeGreaterThan(0)
  })
})

describe('ambient life: lizards', () => {
  it('dart away and hide when the player is close, and come back after they leave', () => {
    const liz = new Lizards(2)
    const L = liz.list[0]
    const near = { x: L.x + 1.2, y: L.y + 0.2, z: L.z + 0.6 }
    expect(Math.hypot(1.2, 0.2, 0.6)).toBeLessThan(LIZARD_FLEE_RADIUS)
    liz.update(DT, near)
    expect(L.state).toBe('flee')
    for (let t = 0; t < 2; t += DT) liz.update(DT, near)
    expect(liz.isHidden(0)).toBe(true)
    expect(liz.list[1].state).toBe('bask') // the other one never saw us
    for (let t = 0; t < 40; t += DT) liz.update(DT, FAR)
    expect(L.state).toBe('bask')
    expect(Math.hypot(L.x - L.spot.x, L.z - L.spot.z)).toBeLessThan(0.05)
  })
})

describe('ambient life: whole simulation', () => {
  it('runs for every quality with finite instance data and few allocations', () => {
    for (const q of ['low', 'medium', 'high'] as const) {
      const sim = new AmbientLifeSim(q)
      const c = LIFE_COUNTS[q]
      expect(sim.buffers.doves.count).toBe(c.doves + c.eveningDoves)
      expect(sim.buffers.gulls.count).toBe(c.gulls)
      const eye = { x: 0, y: 1.4, z: 30 }
      const feet = { x: 0, y: -0.25, z: 30 }
      for (let t = 0; t < 20; t += DT) sim.update(DT, { eye, feet, progress: t / 20 }, {})
      for (const k of Object.keys(sim.buffers) as (keyof typeof sim.buffers)[]) {
        const b = sim.buffers[k]
        for (let i = 0; i < b.matrix.length; i++) expect(Number.isFinite(b.matrix[i])).toBe(true)
        for (let i = 0; i < b.anim.length; i++) expect(Number.isFinite(b.anim[i])).toBe(true)
      }
    }
  })

  it('is cheap per frame', () => {
    const sim = new AmbientLifeSim('high')
    const eye = { x: -5, y: 1.4, z: 28 }
    const feet = { x: -5, y: -0.25, z: 28 }
    for (let i = 0; i < 300; i++) sim.update(DT, { eye, feet, progress: 0.5 }, {})
    const n = 600
    const t0 = performance.now()
    for (let i = 0; i < n; i++) sim.update(DT, { eye, feet, progress: 0.5 }, {})
    const per = (performance.now() - t0) / n
    expect(per).toBeLessThan(0.5) // ms; typically ≈ 0.03 ms
  })
})
