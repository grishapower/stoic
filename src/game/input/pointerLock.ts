import { game } from '../store'

/**
 * Pointer lock helpers. The lock target is the document body so UI overlays
 * do not interfere. Browsers refuse a re-lock for ~1 s after the user pressed
 * Esc; failures are swallowed and the UI shows "click to continue".
 */

let installed = false

export function installPointerLockListeners() {
  if (installed) return
  installed = true
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement != null
    game().setPointerLocked(locked)
    // Losing the lock while walking (Esc) opens the pause menu.
    if (!locked) {
      const s = game()
      if (!s.xrPresenting && s.phase !== 'title' && s.overlay === null && !s.reflectionPromptVisible && !s.endingVisible) {
        s.setOverlay('pause')
      }
    }
  })
  document.addEventListener('pointerlockerror', () => game().setPointerLocked(false))
}

export function lockPointer() {
  installPointerLockListeners()
  // In the headset there is no mouse to capture.
  if (document.pointerLockElement || game().xrPresenting) return
  try {
    const p = document.body.requestPointerLock() as unknown as Promise<void> | undefined
    if (p && typeof p.catch === 'function') p.catch(() => game().setPointerLocked(false))
  } catch {
    game().setPointerLocked(false)
  }
}

export function unlockPointer() {
  if (document.pointerLockElement) document.exitPointerLock()
}
