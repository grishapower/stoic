import { Vector3 } from 'three'

/**
 * Mutable per-frame state shared between systems (player, Seneca, director,
 * audio). Never put this in React state.
 */

export type SenecaMode = 'idle' | 'greeting' | 'walking' | 'waiting' | 'contemplating' | 'seated' | 'ending'

export const runtime = {
  time: 0,
  player: {
    pos: new Vector3(),
    /** Eye position (camera). */
    eye: new Vector3(),
    yaw: 0,
    pitch: 0,
    /** Horizontal speed m/s. */
    speed: 0,
    /** Seconds since the player last moved. */
    idleTime: 0,
  },
  seneca: {
    pos: new Vector3(),
    /** Head (voice source) position. */
    head: new Vector3(),
    yaw: 0,
    /** Arc length along the route. */
    routeS: 0,
    speed: 0,
    mode: 'idle' as SenecaMode,
    talking: false,
  },
}

export type Runtime = typeof runtime
