import { Vector3 } from 'three'
import { seneca } from './characters/senecaController'
import { runtime } from './runtime'
import { game } from './store'

/**
 * Dev-only helpers exposed on window.__dbg (never in production builds):
 * camera override for screenshots, teleport, sequence skipping.
 */
export const debugFlags = { noHeadLook: false }

export const debugState = {
  camOverride: null as null | { pos: Vector3; target: Vector3 },
}

export function installDebug(extra: Record<string, unknown>) {
  if (!import.meta.env.DEV) return
  const w = window as unknown as { __dbg?: unknown }
  w.__dbg = {
    game,
    runtime,
    flags: debugFlags,
    seneca,
    ...extra,
    cam(x: number, y: number, z: number, tx: number, ty: number, tz: number) {
      debugState.camOverride = { pos: new Vector3(x, y, z), target: new Vector3(tx, ty, tz) }
    },
    hideUi(on = true) {
      document.body.classList.toggle('dbg-hide-ui', on)
    },
    freeCam() {
      debugState.camOverride = null
    },
    teleport(x: number, z: number, yaw = 0) {
      runtime.player.pos.set(x, runtime.player.pos.y, z)
      runtime.player.yaw = yaw
    },
  }
}
