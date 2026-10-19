/**
 * Keyboard + mouse input state for the first-person controller.
 * UI shortcuts (T, Space, L, Esc) are handled by the UI layer; this module
 * tracks movement keys, E (interact) and mouse-look deltas.
 */

const down = new Set<string>()
/** Keys pressed since they were last consumed (non-repeat). */
const pressed = new Set<string>()
let mouseDX = 0
let mouseDY = 0
let interactQueued = false
let installed = false

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
}

export function installInput() {
  if (installed) return
  installed = true
  window.addEventListener('keydown', (e) => {
    if (isTyping(e)) return
    down.add(e.code)
    if (!e.repeat) pressed.add(e.code)
    if (e.code === 'KeyE' && !e.repeat) interactQueued = true
  })
  window.addEventListener('keyup', (e) => down.delete(e.code))
  window.addEventListener('blur', () => down.clear())
  document.addEventListener('mousemove', (e) => {
    if (!document.pointerLockElement) return
    // Ignore absurd spikes some browsers emit right after locking.
    if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return
    mouseDX += e.movementX
    mouseDY += e.movementY
  })
}

export const input = {
  key: (code: string) => down.has(code),
  /** Movement axes in [-1, 1]: x = strafe right, y = forward. */
  axes(): { x: number; y: number } {
    let x = 0
    let y = 0
    if (down.has('KeyW') || down.has('ArrowUp')) y += 1
    if (down.has('KeyS') || down.has('ArrowDown')) y -= 1
    if (down.has('KeyD') || down.has('ArrowRight')) x += 1
    if (down.has('KeyA') || down.has('ArrowLeft')) x -= 1
    return { x, y }
  },
  fast: () => down.has('ShiftLeft') || down.has('ShiftRight'),
  consumeMouse(): [number, number] {
    const d: [number, number] = [mouseDX, mouseDY]
    mouseDX = 0
    mouseDY = 0
    return d
  },
  consumeInteract(): boolean {
    const v = interactQueued
    interactQueued = false
    return v
  },
  /** Queue an "interact" from another device (VR: A/X button). */
  queueInteract() {
    interactQueued = true
  },
  /** E pressed this frame, without consuming it. */
  peekInteract(): boolean {
    return interactQueued
  },
  /** One-shot key press (e.g. 'KeyQ', 'KeyR'). */
  consumePress(code: string): boolean {
    const v = pressed.has(code)
    pressed.delete(code)
    return v
  },
  /** Drop unconsumed one-shot presses at the end of a frame. */
  endFrame() {
    pressed.clear()
  },
  clear() {
    down.clear()
    pressed.clear()
    mouseDX = mouseDY = 0
    interactQueued = false
  },
}
