import { script } from '../../data/narration'
import { finishWalk, stayInWorld } from '../../game/session'
import { useGame } from '../../game/store'
import { usePresence } from './presence'

/** Minimal closing inscription. No scores, no credits. */
export function EndingOverlay() {
  const visible = useGame((s) => s.endingVisible)
  const p = usePresence(visible, 1600)
  if (!p.mounted) return null
  return (
    <div className="ui-ending" data-state={p.state} inert={p.exiting}>
      <div className="ui-ending__veil" aria-hidden="true" />
      <div className="ui-ending__content">
        <h1 className="ui-ending__inscription">{script.meta.titleRu}</h1>
        <span className="ui-ending__rule" aria-hidden="true" />
        <p className="ui-ending__latin" lang="la">
          {script.meta.latinTitle}
        </p>
        <div className="ui-ending__actions">
          <button type="button" className="ui-link" onClick={() => finishWalk()}>
            Завершить прогулку
          </button>
          <button type="button" className="ui-link" onClick={() => stayInWorld()}>
            Остаться в мире
          </button>
        </div>
      </div>
    </div>
  )
}
