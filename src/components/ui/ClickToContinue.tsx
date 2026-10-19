import { recapturePointer } from '../../game/session'
import { useGame } from '../../game/store'
import { useDelayedFlag, usePresence } from './presence'

/**
 * Shown in-game when nothing is open but the mouse is free (e.g. after closing
 * a menu with Esc, which browsers do not allow to re-capture the pointer).
 */
export function ClickToContinue() {
  const needed = useGame(
    (s) =>
      s.phase !== 'title' &&
      s.overlay === null &&
      !s.reflectionPromptVisible &&
      !s.endingVisible &&
      !s.pointerLocked &&
      !s.contextLost,
  )
  // Small delay: the lock usually arrives a moment after a click, no need to flash.
  const visible = useDelayedFlag(needed, 350)
  const p = usePresence(visible, 500)
  if (!p.mounted) return null
  return (
    <button
      type="button"
      className="ui-continue"
      data-state={p.state}
      inert={p.exiting}
      onClick={() => recapturePointer()}
    >
      <span className="ui-continue__text">Нажмите, чтобы продолжить</span>
      <span className="ui-continue__sub">Esc — меню</span>
    </button>
  )
}
