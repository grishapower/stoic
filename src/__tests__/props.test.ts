import { describe, expect, it } from 'vitest'
import { CITRUS_TREES } from '../game/world/citrus'
import { buildFlowers } from '../game/world/flowers'
import { PATH_HALF_WIDTH } from '../game/world/layout'
import { nearestOnPath } from '../game/world/path'
import {
  AEDICULA,
  ALLEY_HERMS,
  AMPHORAE,
  BEEHIVES,
  BIRD_BATH,
  DOVECOTE,
  EROS_STATUE,
  studyPlaced,
  WOODEN_BENCH,
} from '../game/world/props'
import { CYPRESSES, OLIVES, PINES, insideEstate } from '../game/world/vegetation'

const placed: [string, number, number, number][] = [
  ['bird bath', BIRD_BATH.x, BIRD_BATH.z, 0.45],
  ['eros', EROS_STATUE.x, EROS_STATUE.z, 0.5],
  ['aedicula', AEDICULA.x, AEDICULA.z, 0.65],
  ['bench', WOODEN_BENCH.x, WOODEN_BENCH.z, 0.8],
  ['dovecote', DOVECOTE.x, DOVECOTE.z, 1.4],
  ['beehives', BEEHIVES.x, BEEHIVES.z, 0.9],
  ...ALLEY_HERMS.map((h, i): [string, number, number, number] => [`herm ${i}`, h.x, h.z, 0.35]),
  ...AMPHORAE.map((a, i): [string, number, number, number] => [`amphora ${i}`, a.x, a.z, 0.2]),
  ...(['clepsydra', 'bustColumn', 'basket', 'jug'] as const).map((k): [string, number, number, number] => {
    const p = studyPlaced(k)
    return [k, p.x, p.z, 0.25]
  }),
]

describe('world-fill props', () => {
  it('stand inside the estate, off the walking path', () => {
    for (const [name, x, z, r] of placed) {
      expect(insideEstate(x, z), name).toBe(true)
      expect(nearestOnPath(x, z).d - r, name).toBeGreaterThan(PATH_HALF_WIDTH - 0.6)
    }
  })

  it('do not stand inside trees', () => {
    const trees = [
      ...CYPRESSES.map((t) => [t.x, t.z, 0.6 * t.scale] as const),
      ...OLIVES.map((t) => [t.x, t.z, 0.5 * t.scale] as const),
      ...PINES.map((t) => [t.x, t.z, 0.5] as const),
      ...CITRUS_TREES.map((t) => [t.x, t.z, t.potted ? 0.4 : 0.9 * t.scale] as const),
    ]
    for (const [name, x, z, r] of placed) {
      for (const [tx, tz, tr] of trees) expect(Math.hypot(tx - x, tz - z), `${name} vs tree at ${tx.toFixed(1)},${tz.toFixed(1)}`).toBeGreaterThan(r + tr)
    }
  })

  it('grow flowers in every quality and keep them off the path', () => {
    const all = buildFlowers('high')
    expect(all.length).toBeGreaterThan(500)
    expect(buildFlowers('low').length).toBeLessThan(all.length)
    for (const f of all) {
      expect(Number.isFinite(f.y)).toBe(true)
      // Peristyle beds have their own paths; outside them flowers keep off the route.
      if (f.z < 15) expect(nearestOnPath(f.x, f.z).d).toBeGreaterThan(PATH_HALF_WIDTH)
    }
  })
})
