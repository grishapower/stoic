import type { Quality } from '../store'

/**
 * Ambient-life tunables: how many creatures per quality level and the
 * player-reaction radii. Per-species motion constants live at the top of each
 * system module (gulls.ts, swallows.ts, doves.ts, insects.ts, lizards.ts).
 */

export interface LifeCounts {
  gulls: number
  swallowsPerZone: number
  /** Doves present from the start. */
  doves: number
  /** Extra doves that fly in to roost once the letter is over (progress ≥ 1). */
  eveningDoves: number
  butterfliesPerZone: number
  /** The swarm around the hives. */
  hiveBees: number
  /** Bees hovering over the flower zones. */
  flowerBees: number
  /** Bees commuting hive ↔ flowers. */
  commuterBees: number
}

export const LIFE_COUNTS: Record<Quality, LifeCounts> = {
  low: { gulls: 5, swallowsPerZone: 2, doves: 7, eveningDoves: 2, butterfliesPerZone: 2, hiveBees: 12, flowerBees: 3, commuterBees: 1 },
  medium: { gulls: 7, swallowsPerZone: 3, doves: 10, eveningDoves: 4, butterfliesPerZone: 3, hiveBees: 20, flowerBees: 5, commuterBees: 2 },
  high: { gulls: 9, swallowsPerZone: 4, doves: 13, eveningDoves: 5, butterfliesPerZone: 4, hiveBees: 28, flowerBees: 8, commuterBees: 3 },
}

/** Doves take off when the player's eye comes this close (m, 3D). */
export const DOVE_FLEE_RADIUS = 3.5
/** Lizards dart away when the player is this close (m, 3D from the feet). */
export const LIZARD_FLEE_RADIUS = 2.5

/** Seed for every deterministic choice in the life systems. */
export const LIFE_SEED = 1717
