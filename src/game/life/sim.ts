import type { Quality } from '../store'
import { LIFE_COUNTS, LIFE_SEED } from './config'
import { Doves, type DoveEvents } from './doves'
import { Gulls, type GullEvents } from './gulls'
import { Bees, Butterflies } from './insects'
import { Lizards } from './lizards'
import { createBuffers, type InstanceBuffers, type Vec3Like } from './math'
import { buildPerches } from './perches'
import { Swallows } from './swallows'

/**
 * The whole ambient-life simulation (pure TS, no three.js): six systems, each
 * writing straight into the instance buffers that the R3F wrapper hands to
 * the GPU. One `update` per frame; no allocations in the hot path.
 */

export type LifeKind = 'gulls' | 'swallows' | 'doves' | 'butterflies' | 'bees' | 'lizards'
export const LIFE_KINDS: readonly LifeKind[] = ['gulls', 'swallows', 'doves', 'butterflies', 'bees', 'lizards']

export interface LifeEvents extends DoveEvents, GullEvents {}

export interface LifeInput {
  /** The player's eye (doves) — 3D. */
  eye: Vec3Like
  /** The player's feet (lizards). */
  feet: Vec3Like
  /** Walk progress 0..1 (and beyond, after the letter). */
  progress: number
}

export class AmbientLifeSim {
  readonly gulls: Gulls
  readonly swallows: Swallows
  readonly doves: Doves
  readonly butterflies: Butterflies
  readonly bees: Bees
  readonly lizards: Lizards
  readonly buffers: Record<LifeKind, InstanceBuffers>

  constructor(quality: Quality, seed = LIFE_SEED) {
    const c = LIFE_COUNTS[quality]
    this.gulls = new Gulls(c.gulls, seed + 1)
    this.swallows = new Swallows(c.swallowsPerZone, seed + 2)
    this.doves = new Doves(buildPerches(), c.doves, c.eveningDoves, seed + 3)
    this.butterflies = new Butterflies(c.butterfliesPerZone, seed + 4)
    this.bees = new Bees(c.hiveBees, c.flowerBees, c.commuterBees, seed + 5)
    this.lizards = new Lizards(seed + 6)
    this.buffers = {
      gulls: createBuffers(this.gulls.count),
      swallows: createBuffers(this.swallows.count),
      doves: createBuffers(this.doves.count),
      butterflies: createBuffers(this.butterflies.count),
      bees: createBuffers(this.bees.count),
      lizards: createBuffers(this.lizards.count),
    }
    this.gulls.writeColors(this.buffers.gulls)
    this.swallows.writeColors(this.buffers.swallows)
    this.doves.writeColors(this.buffers.doves)
    this.butterflies.writeColors(this.buffers.butterflies)
    this.bees.writeColors(this.buffers.bees)
    this.lizards.writeColors(this.buffers.lizards)
    this.write()
  }

  update(dt: number, input: LifeInput, events: LifeEvents): void {
    if (!(dt > 0)) return
    const step = Math.min(dt, 0.1)
    this.gulls.update(step, events)
    this.swallows.update(step, input.progress)
    this.doves.update(step, input.eye, input.progress, events)
    this.butterflies.update(step)
    this.bees.update(step)
    this.lizards.update(step, input.feet)
    this.write()
  }

  private write(): void {
    this.gulls.write(this.buffers.gulls)
    this.swallows.write(this.buffers.swallows)
    this.doves.write(this.buffers.doves)
    this.butterflies.write(this.buffers.butterflies)
    this.bees.write(this.buffers.bees)
    this.lizards.write(this.buffers.lizards)
  }
}
