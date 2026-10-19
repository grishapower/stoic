import { create } from 'zustand'
import { closeOverlay, openOverlay } from '../../game/session'
import { useGame, type Overlay } from '../../game/store'

/**
 * UI-only state that the game does not need to know about: where each overlay
 * returns to, the title sub-panel, the unsaved reflection draft, small toasts.
 */

export type ModalOverlay = Exclude<Overlay, null>
export type TitlePanel = 'settings' | 'controls' | null

export interface UiState {
  titlePanel: TitlePanel
  /** Where each overlay goes back to when closed (null = back to the world). */
  returnTo: Partial<Record<ModalOverlay, Overlay>>
  /** Unsaved reflection text; kept in memory until saved or discarded. */
  draft: string
  /** Letter reader: show the Latin original next to the translation. */
  letterLatin: boolean
  /** Short status toast (e.g. "Субтитры выключены"). */
  flash: { id: number; text: string } | null
}

export const useUi = create<UiState>(() => ({
  titlePanel: null,
  returnTo: {},
  draft: '',
  letterLatin: false,
  flash: null,
}))

let navigating = false
let externalPauseAt = -Infinity

// Overlays opened by someone else (pointer-lock loss, the director, the lead)
// always return straight to the world.
useGame.subscribe((s, prev) => {
  if (s.phase !== prev.phase && s.phase === 'title') useUi.setState({ titlePanel: null })
  if (s.overlay === prev.overlay || navigating) return
  const overlay = s.overlay
  if (overlay === 'pause') externalPauseAt = performance.now()
  if (overlay) useUi.setState((u) => ({ returnTo: { ...u.returnTo, [overlay]: null } }))
})

/** Opens `target` and remembers where closing it should lead. */
export function openFrom(target: ModalOverlay, from: Overlay) {
  useUi.setState((u) => ({ returnTo: { ...u.returnTo, [target]: from === target ? null : from } }))
  navigating = true
  try {
    openOverlay(target)
  } finally {
    navigating = false
  }
}

/** Closes `from` and returns to its previous context (another overlay or the world). */
export function back(from: ModalOverlay) {
  const { returnTo } = useUi.getState()
  const to = returnTo[from] ?? null
  if (to && to !== from) openFrom(to, returnTo[to] ?? null)
  else closeOverlay()
}

/** Milliseconds since the pause menu was opened by something other than the UI (e.g. Esc releasing the lock). */
export function msSinceExternalPause(): number {
  return performance.now() - externalPauseAt
}

export function setTitlePanel(titlePanel: TitlePanel) {
  useUi.setState({ titlePanel })
}

let flashSeq = 0
export function flash(text: string, ms = 1900) {
  const id = ++flashSeq
  useUi.setState({ flash: { id, text } })
  window.setTimeout(() => {
    if (useUi.getState().flash?.id === id) useUi.setState({ flash: null })
  }, ms)
}
