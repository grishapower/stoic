import { useEffect, useId, useRef, useState } from 'react'
import { script } from '../../data/narration'
import { closeOverlay, finishWalk, restartWalk, showEnding } from '../../game/session'
import { useGame } from '../../game/store'
import { resumeInVR } from '../../game/xr/xrSession'
import { ConfirmAction } from './controls'
import { ControlsList } from './ControlsList'
import { currentBlock, roman } from './letterText'
import { usePresence, type PresenceState } from './presence'
import { SettingsPanel } from './SettingsPanel'
import { openFrom } from './uiState'

type Tab = 'settings' | 'controls'

export function PauseMenu({ visible }: { visible: boolean }) {
  const p = usePresence(visible, 450)
  if (!p.mounted) return null
  return <PausePanel state={p.state} exiting={p.exiting} />
}

function PausePanel({ state, exiting }: { state: PresenceState; exiting: boolean }) {
  const phase = useGame((s) => s.phase)
  const xrSupported = useGame((s) => s.xrSupported)
  const lineId = useGame((s) => s.narration.lineId)
  const heard = useGame((s) => s.narration.heard)
  const [tab, setTab] = useState<Tab>('settings')
  const uid = useId()
  const continueRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    continueRef.current?.focus({ preventScroll: true })
  }, [])

  const block = currentBlock(lineId, heard)
  const pastGreeting = phase !== 'title' && phase !== 'arrival' && phase !== 'greeting'

  return (
    <div className="ui-modal" data-state={state} inert={exiting}>
      <div className="ui-panel ui-pause" role="dialog" aria-modal="true" aria-labelledby={`${uid}-title`}>
        <div className="ui-pause__main">
          <p className="ui-eyebrow">Пауза</p>
          <h2 className="ui-pause__title" id={`${uid}-title`}>
            {script.meta.titleRu}
          </h2>
          {block && (
            <p className="ui-pause__context">
              <span className="ui-numeral">{roman(block.n)}</span> {block.titleRu}
            </p>
          )}

          <nav className="ui-pause__menu" aria-label="Меню прогулки">
            <button ref={continueRef} type="button" className="ui-menu-item" onClick={() => closeOverlay()}>
              Продолжить
            </button>
            {xrSupported && (
              <button type="button" className="ui-menu-item" onClick={() => void resumeInVR()}>
                Продолжить в VR
              </button>
            )}
            <button type="button" className="ui-menu-item" onClick={() => openFrom('letter', 'pause')}>
              Полный текст письма
            </button>
            <button type="button" className="ui-menu-item" onClick={() => openFrom('journal', 'pause')}>
              Журнал размышлений
            </button>
            <ConfirmAction
              className="ui-menu-item"
              confirmClassName="ui-confirm--menu"
              label="Начать прогулку заново"
              question="Начать прогулку с начала? Текущая прогулка прервётся."
              confirmLabel="Начать заново"
              onConfirm={() => restartWalk()}
            />
            {pastGreeting ? (
              <button type="button" className="ui-menu-item ui-menu-item--quiet" onClick={() => showEnding()}>
                Завершить прогулку
              </button>
            ) : (
              <ConfirmAction
                className="ui-menu-item ui-menu-item--quiet"
                confirmClassName="ui-confirm--menu"
                label="Завершить прогулку"
                question="Вернуться к титульному экрану?"
                confirmLabel="Вернуться"
                onConfirm={() => finishWalk()}
              />
            )}
          </nav>
        </div>

        <div className="ui-pause__side">
          <div className="ui-tabs" role="tablist" aria-label="Параметры">
            <button
              type="button"
              role="tab"
              id={`${uid}-tab-settings`}
              aria-selected={tab === 'settings'}
              aria-controls={`${uid}-panel`}
              className="ui-tab"
              onClick={() => setTab('settings')}
            >
              Настройки
            </button>
            <button
              type="button"
              role="tab"
              id={`${uid}-tab-controls`}
              aria-selected={tab === 'controls'}
              aria-controls={`${uid}-panel`}
              className="ui-tab"
              onClick={() => setTab('controls')}
            >
              Управление
            </button>
          </div>
          <div
            className="ui-pause__tabpanel"
            role="tabpanel"
            id={`${uid}-panel`}
            aria-labelledby={`${uid}-tab-${tab}`}
            key={tab}
          >
            {tab === 'settings' ? <SettingsPanel /> : <ControlsList />}
          </div>
        </div>
      </div>
    </div>
  )
}
