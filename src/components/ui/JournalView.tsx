import { useEffect, useId, useRef } from 'react'
import { clear, remove, useJournal } from '../../game/journal'
import { ConfirmAction } from './controls'
import { plural } from './letterText'
import { usePresence, type PresenceState } from './presence'
import { back, openFrom, useUi } from './uiState'

const dateFormat = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : dateFormat.format(d)
}

export function JournalView({ visible }: { visible: boolean }) {
  const p = usePresence(visible, 450)
  if (!p.mounted) return null
  return <JournalPanel state={p.state} exiting={p.exiting} />
}

function JournalPanel({ state, exiting }: { state: PresenceState; exiting: boolean }) {
  const entries = useJournal((s) => s.entries)
  const persistent = useJournal((s) => s.persistent)
  const fromPause = useUi((s) => s.returnTo.journal === 'pause')
  const uid = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const backRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    backRef.current?.focus({ preventScroll: true })
  }, [])

  // Deleting removes the focused button; keep focus inside the dialog.
  const refocus = () => requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }))

  return (
    <div className="ui-modal" data-state={state} inert={exiting}>
      <div
        ref={panelRef}
        tabIndex={-1}
        className="ui-panel ui-journal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${uid}-title`}
      >
        <header className="ui-panel__header">
          <div>
            <p className="ui-eyebrow">
              {entries.length > 0
                ? `${entries.length} ${plural(entries.length, ['запись', 'записи', 'записей'])}`
                : 'Пока без записей'}
            </p>
            <h2 className="ui-panel__title" id={`${uid}-title`}>
              Журнал размышлений
            </h2>
          </div>
          <div className="ui-panel__header-actions">
            <button type="button" className="ui-link" onClick={() => openFrom('reflection-editor', 'journal')}>
              Новая запись
            </button>
            <button ref={backRef} type="button" className="ui-link ui-link--close" onClick={() => back('journal')}>
              {fromPause ? 'Назад' : 'Закрыть'}
              <kbd className="ui-kbd ui-kbd--tiny" aria-hidden="true">
                Esc
              </kbd>
            </button>
          </div>
        </header>

        <div className="ui-journal__body">
          {entries.length === 0 ? (
            <div className="ui-journal__empty">
              <p className="ui-journal__empty-title">Здесь пока тихо.</p>
              <p>
                Когда захочется ответить себе на вопрос «На что я трачу своё время?», запись появится здесь. Писать
                не обязательно — можно просто подумать.
              </p>
            </div>
          ) : (
            <ol className="ui-journal__list">
              {entries.map((e) => (
                <li key={e.id} className="ui-journal__entry">
                  <div className="ui-journal__meta">
                    <time dateTime={e.createdAt}>{formatDate(e.createdAt)}</time>
                    <ConfirmAction
                      className="ui-link ui-link--faint"
                      label="Удалить"
                      question="Удалить эту запись?"
                      confirmLabel="Удалить"
                      cancelLabel="Оставить"
                      onConfirm={() => {
                        remove(e.id)
                        refocus()
                      }}
                    />
                  </div>
                  <p className="ui-journal__prompt">{e.prompt}</p>
                  <p className="ui-journal__text">{e.text}</p>
                </li>
              ))}
            </ol>
          )}
        </div>

        <footer className="ui-journal__footer">
          <p className="ui-note">
            Записи хранятся только в этом браузере и никуда не отправляются.
            {!persistent && ' Сейчас хранилище браузера недоступно — записи сохранятся лишь до закрытия вкладки.'}
          </p>
          {entries.length > 0 && (
            <ConfirmAction
              className="ui-link ui-link--faint"
              label="Удалить все записи"
              question="Удалить все записи без возможности восстановить?"
              confirmLabel="Удалить все"
              onConfirm={() => {
                clear()
                refocus()
              }}
            />
          )}
        </footer>
      </div>
    </div>
  )
}
