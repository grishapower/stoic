import { useState } from 'react'
import { DEFAULT_PROMPT } from '../../game/journal'
import { restartWalk, showEnding, stayInSilence } from '../../game/session'
import { useGame } from '../../game/store'
import { usePresence } from './presence'
import { openFrom } from './uiState'

/** The quiet question after the letter, low on the screen. */
export function ReflectionPrompt() {
  const visible = useGame((s) => s.reflectionPromptVisible && s.overlay === null && !s.endingVisible)
  const promptVisible = useGame((s) => s.reflectionPromptVisible)
  const overlayOpen = useGame((s) => s.overlay !== null)
  const p = usePresence(visible, 1000)

  // The first appearance is slow (~2 s); coming back from the letter or editor is quicker.
  const [returning, setReturning] = useState(false)
  if (promptVisible && overlayOpen && !returning) setReturning(true)
  if (!promptVisible && returning) setReturning(false)

  if (!p.mounted) return null
  return (
    <div className="ui-reflect" data-state={p.state} data-quick={returning || undefined} inert={p.exiting}>
      <div className="ui-reflect__shade" aria-hidden="true" />
      <div className="ui-reflect__body" role="region" aria-label="Размышление">
        <p className="ui-reflect__question">{DEFAULT_PROMPT}</p>
        <div className="ui-reflect__actions">
          <button type="button" className="ui-link" onClick={() => stayInSilence()}>
            Остаться в тишине
          </button>
          <button type="button" className="ui-link" onClick={() => openFrom('letter', null)}>
            Прочитать письмо
          </button>
          <button type="button" className="ui-link" onClick={() => openFrom('reflection-editor', null)}>
            Записать мысли
          </button>
          <button type="button" className="ui-link" onClick={() => restartWalk()}>
            Пройти прогулку заново
          </button>
        </div>
        <button type="button" className="ui-link ui-link--faint ui-reflect__end" onClick={() => showEnding()}>
          Завершить прогулку
        </button>
      </div>
    </div>
  )
}
