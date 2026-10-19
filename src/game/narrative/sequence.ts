import type { SenecaMode } from '../runtime'
import type { Phase } from '../store'
import type { StationId } from '../world/layout'

/**
 * The walk as a declarative sequence. The director executes steps in order;
 * each letter block is spoken while Seneca walks the section of the route
 * between two stations.
 */
export type Step =
  | { t: 'phase'; phase: Phase }
  | { t: 'mode'; mode: SenecaMode }
  | { t: 'music'; on: boolean }
  /** Let Seneca walk up to a station (non-blocking). */
  | { t: 'allow'; station: StationId }
  /** Block until Seneca has reached a station. */
  | { t: 'arrive'; station: StationId }
  /** Natural silence (only counts while the player is with Seneca). */
  | { t: 'pause'; seconds: number }
  | { t: 'line'; id: string }

const line = (id: string): Step => ({ t: 'line', id })

export const SEQUENCE: Step[] = [
  // Scene 1 — greeting by the fountain.
  { t: 'phase', phase: 'greeting' },
  { t: 'mode', mode: 'greeting' },
  { t: 'pause', seconds: 0.6 },
  line('A-greet-1'),
  line('A-greet-2'),
  // Scene 2 — the walk.
  { t: 'phase', phase: 'walk' },
  { t: 'mode', mode: 'walking' },
  { t: 'allow', station: 'alley' },
  { t: 'music', on: true },
  { t: 'pause', seconds: 3 },
  // Bridge into the letter ("listen as if it were written to you too").
  line('A-letter'),
  // Block 1 — time slips away (garden → cypress alley).
  line('L01'),
  line('L02'),
  line('L03'),
  line('L04'),
  line('L05'),
  // Block 2 — every day matters (cypress alley).
  { t: 'allow', station: 'grove' },
  line('L06'),
  line('L07'),
  line('L08'),
  line('L09'),
  // Block 3 — time as our only possession (olive grove → viewpoint).
  { t: 'allow', station: 'viewpoint' },
  line('L10'),
  line('L11'),
  line('L12'),
  { t: 'arrive', station: 'viewpoint' },
  { t: 'mode', mode: 'contemplating' },
  { t: 'pause', seconds: 4 },
  line('A-sea'),
  { t: 'pause', seconds: 2 },
  // Quiet walk to the pergola.
  { t: 'mode', mode: 'walking' },
  { t: 'allow', station: 'pergola' },
  { t: 'arrive', station: 'pergola' },
  line('A-table'),
  // Block 4 — Seneca's confession (pergola → terrace).
  { t: 'allow', station: 'terrace' },
  line('L13'),
  line('L14'),
  line('L15'),
  line('L16'),
  { t: 'arrive', station: 'terrace' },
  // Scene 3 — the terrace.
  { t: 'phase', phase: 'terrace' },
  { t: 'mode', mode: 'contemplating' },
  line('A-terrace'),
  // Block 5 — conclusion.
  line('L17'),
  line('L18'),
  line('L19'),
  line('L20'),
  { t: 'phase', phase: 'silence' },
  { t: 'pause', seconds: 9 },
  { t: 'phase', phase: 'reflection' },
]
