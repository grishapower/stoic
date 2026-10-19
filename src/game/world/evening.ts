import { smoothstep } from './noise'

/**
 * "Time is visible": one schedule derived from the walk's progress
 * (0 = arrival … 1 = end of the letter … >1 = silence / free roam).
 * Everything that marks the evening reads from here.
 */
export interface EveningState {
  /** Windows lighting up in the harbour town across the bay (0..1). */
  harbourLights: number
  /** Fire on the lighthouse (0..1). */
  lighthouse: number
  /** Lamps in the villa grounds (study lamp, lanterns). The shrine lamp is always lit. */
  lamps: number
  /** Boats returning to the harbour: 0 = out at sea, 1 = home. */
  boatsHome: number
  /** Doves/swallows settling for the night (0..1). */
  settling: number
}

const state: EveningState = { harbourLights: 0, lighthouse: 0, lamps: 0, boatsHome: 0, settling: 0 }

export function evening(progress: number): EveningState {
  state.harbourLights = smoothstep(0.45, 1.05, progress)
  state.lighthouse = smoothstep(0.62, 0.98, progress)
  state.lamps = smoothstep(0.55, 1.0, progress)
  state.boatsHome = Math.min(1, Math.max(0, progress) * 0.92)
  state.settling = smoothstep(0.85, 1.4, progress)
  return state
}
