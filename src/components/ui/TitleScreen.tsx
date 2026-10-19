import { useEffect, useId, useRef, type ReactNode } from 'react'
import { beginWalk } from '../../game/session'
import { beginWalkVR } from '../../game/xr/xrSession'
import { useGame } from '../../game/store'
import { ControlsList } from './ControlsList'
import { usePresence } from './presence'
import { SettingsPanel } from './SettingsPanel'
import { setTitlePanel, useUi, type TitlePanel } from './uiState'

/** Title over the live scene: name, letter, start, settings, controls. */
export function TitleScreen() {
  const visible = useGame((s) => s.phase === 'title')
  const p = usePresence(visible, 1400)
  if (!p.mounted) return null
  return (
    <div className="ui-title" data-state={p.state} inert={p.exiting}>
      <div className="ui-title__veil" aria-hidden="true" />
      <TitleContent />
      <footer className="ui-title__footer">Художественная реконструкция эпохи. Рабочий перевод с латинского.</footer>
    </div>
  )
}

function TitleContent() {
  const panel = useUi((s) => s.titlePanel)
  const loading = useGame((s) => s.loading)
  const xrSupported = useGame((s) => s.xrSupported)
  const settingsRef = useRef<HTMLButtonElement>(null)
  const controlsRef = useRef<HTMLButtonElement>(null)
  const prevPanel = useRef<TitlePanel>(panel)

  // Return focus to the button that opened a sub-panel.
  useEffect(() => {
    if (panel === null && prevPanel.current !== null) {
      const target = prevPanel.current === 'settings' ? settingsRef.current : controlsRef.current
      target?.focus({ preventScroll: true })
    }
    prevPanel.current = panel
  }, [panel])

  if (panel === 'settings') {
    return (
      <TitleSubPanel key="settings" title="Настройки">
        <SettingsPanel />
      </TitleSubPanel>
    )
  }
  if (panel === 'controls') {
    return (
      <TitleSubPanel key="controls" title="Управление" narrow>
        <ControlsList />
      </TitleSubPanel>
    )
  }

  return (
    <main className="ui-title__column">
      <h1 className="ui-title__name">Seneca</h1>
      <p className="ui-title__sub" lang="en">
        The Art of Time
      </p>
      <span className="ui-rule" aria-hidden="true" />
      <p className="ui-title__letter">Письмо I. О времени</p>
      <div className="ui-title__actions">
        {loading.done ? (
          <>
            <button type="button" className="ui-btn ui-btn--primary" onClick={() => void beginWalk()}>
              Начать прогулку
            </button>
            {xrSupported && (
              <button type="button" className="ui-btn" onClick={() => void beginWalkVR()}>
                Начать в VR
              </button>
            )}
          </>
        ) : (
          <p className="ui-loading" role="status">
            <span className="ui-loading__label">{loading.label || 'Подготовка сцены…'}</span>
            <span className="ui-loading__line" aria-hidden="true" />
          </p>
        )}
        <div className="ui-title__secondary">
          <button ref={settingsRef} type="button" className="ui-link" onClick={() => setTitlePanel('settings')}>
            Настройки
          </button>
          <button ref={controlsRef} type="button" className="ui-link" onClick={() => setTitlePanel('controls')}>
            Управление
          </button>
        </div>
      </div>
    </main>
  )
}

function TitleSubPanel({ title, narrow, children }: { title: string; narrow?: boolean; children: ReactNode }) {
  const headingId = useId()
  const backRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    backRef.current?.focus({ preventScroll: true })
  }, [])
  return (
    <section
      className="ui-panel ui-title__panel"
      data-narrow={narrow || undefined}
      aria-labelledby={headingId}
    >
      <header className="ui-panel__header">
        <h2 className="ui-panel__title" id={headingId}>
          {title}
        </h2>
        <button ref={backRef} type="button" className="ui-link" onClick={() => setTitlePanel(null)}>
          Назад
        </button>
      </header>
      <div className="ui-panel__body">{children}</div>
    </section>
  )
}
