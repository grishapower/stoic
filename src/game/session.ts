import { audio } from './audio/engine'
import { lockPointer, unlockPointer } from './input/pointerLock'
import { game, type Overlay } from './store'

/**
 * High-level commands used by the UI. Each one that needs browser permissions
 * (audio, pointer lock) must be called directly from a click/key handler.
 */

/** Title screen → garden. Unlocks audio and captures the mouse (user gesture required). */
export async function beginWalk() {
  const s = game()
  s.resetRun()
  s.setOverlay(null)
  s.setPhase('arrival')
  lockPointer()
  try {
    await audio.unlock()
    game().setAudioReady(true)
  } catch {
    game().setAudioReady(false)
  }
}

/** Open a modal overlay (frees the mouse). */
export function openOverlay(overlay: Exclude<Overlay, null>) {
  game().setOverlay(overlay)
  audio.setMenuMuffle(overlay === 'pause')
  unlockPointer()
}

/** Close any overlay and return to walking (user gesture required for the lock). */
export function closeOverlay() {
  const s = game()
  s.setOverlay(null)
  audio.setMenuMuffle(false)
  if (s.phase !== 'title' && !s.reflectionPromptVisible && !s.endingVisible) lockPointer()
}

/** Re-capture the mouse after a failed/lost lock ("click to continue"). */
export function recapturePointer() {
  lockPointer()
}

export function toggleNarrationPause() {
  game().toggleNarrationPause()
}

export function toggleSubtitles() {
  game().toggleSubtitles()
}

/** Start the walk again from the garden. */
export function restartWalk() {
  const s = game()
  s.resetRun()
  s.setOverlay(null)
  s.setPhase('arrival')
  audio.setMenuMuffle(false)
  lockPointer()
}

/** Reflection prompt: dismiss it and simply stay in silence. */
export function stayInSilence() {
  const s = game()
  s.setReflectionPromptVisible(false)
  lockPointer()
}

/** Ending inscription: keep wandering the world. */
export function stayInWorld() {
  const s = game()
  s.setEndingVisible(false)
  s.setReflectionPromptVisible(false)
  s.setOverlay(null)
  s.setPhase('free')
  lockPointer()
}

/** Show the ending inscription «Письмо I. О времени». */
export function showEnding() {
  const s = game()
  s.setReflectionPromptVisible(false)
  s.setOverlay(null)
  s.setEndingVisible(true)
  s.setPhase('ending')
  unlockPointer()
}

/** Ending → fade out → title screen. */
export function finishWalk() {
  const s = game()
  s.setEndingVisible(false)
  s.setOverlay(null)
  s.setPhase('title')
  unlockPointer()
}
