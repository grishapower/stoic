import { useEffect } from 'react'
import { closeOverlay, toggleNarrationPause, toggleSubtitles } from '../../game/session'
import { game } from '../../game/store'
import { back, flash, msSinceExternalPause, openFrom, setTitlePanel, useUi } from './uiState'

const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color', 'file', 'image'])

/** Text entry fields own every key. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') return !NON_TEXT_INPUTS.has((target as HTMLInputElement).type)
  return false
}

/** Elements that Space activates natively (buttons, switches…). */
function isActivatable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.closest('button, a[href], input, label, summary, [role="button"], [role="switch"], [role="tab"]')) return true
  return false
}

/**
 * The single global UI shortcut listener. Uses `event.code`, so it works with
 * a Russian keyboard layout too. WASD / E / Shift belong to the player controller.
 */
export function useUiKeyboard() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return
      if (isTextEntry(e.target)) return
      const s = game()
      if (s.contextLost) return
      const inGame = s.phase !== 'title'

      switch (e.code) {
        case 'KeyT': {
          if (e.repeat) return
          toggleSubtitles()
          flash(game().settings.subtitles ? 'Субтитры включены' : 'Субтитры выключены')
          return
        }

        case 'Space': {
          if (!inGame || s.overlay !== null || s.endingVisible || s.reflectionPromptVisible) return
          if (isActivatable(e.target)) return
          e.preventDefault()
          if (e.repeat) return
          toggleNarrationPause()
          return
        }

        case 'KeyL': {
          if (!inGame || e.repeat) return
          if (s.overlay === 'letter') back('letter')
          else if (s.overlay === null) openFrom('letter', null)
          else if (s.overlay === 'pause') openFrom('letter', 'pause')
          return
        }

        case 'Escape': {
          if (e.repeat) return
          if (s.overlay === 'pause') {
            // The same Esc that released the pointer lock may arrive after the menu opened.
            if (msSinceExternalPause() < 350) return
            closeOverlay()
            return
          }
          if (s.overlay !== null) {
            back(s.overlay)
            return
          }
          if (!inGame) {
            if (useUi.getState().titlePanel !== null) setTitlePanel(null)
            return
          }
          // Mouse is free and nothing is open (click-to-continue, reflection, ending): open the menu.
          if (!s.pointerLocked) openFrom('pause', null)
          return
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
