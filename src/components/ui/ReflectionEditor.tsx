import { useEffect, useId, useRef, type KeyboardEvent } from 'react'
import { add, DEFAULT_PROMPT, useJournal } from '../../game/journal'
import { usePresence, type PresenceState } from './presence'
import { back, flash, useUi } from './uiState'

export function ReflectionEditor({ visible }: { visible: boolean }) {
  const p = usePresence(visible, 450)
  if (!p.mounted) return null
  return <EditorSheet state={p.state} exiting={p.exiting} />
}

function EditorSheet({ state, exiting }: { state: PresenceState; exiting: boolean }) {
  const draft = useUi((s) => s.draft)
  const persistent = useJournal((s) => s.persistent)
  const uid = useId()
  const areaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const area = areaRef.current
    if (!area) return
    area.focus({ preventScroll: true })
    const end = area.value.length
    area.setSelectionRange(end, end)
  }, [])

  const save = () => {
    const entry = add(useUi.getState().draft, DEFAULT_PROMPT)
    if (entry) {
      useUi.setState({ draft: '' })
      flash('Записано в журнал')
    }
    back('reflection-editor')
  }

  const discard = () => {
    useUi.setState({ draft: '' })
    back('reflection-editor')
  }

  // Keys typed here must never reach the game or the global UI shortcuts.
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation()
    if (e.key === 'Escape') {
      // The draft is kept in memory; Esc simply steps back.
      e.preventDefault()
      back('reflection-editor')
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      save()
    }
  }

  return (
    <div className="ui-modal" data-state={state} inert={exiting}>
      <div
        className="ui-panel ui-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${uid}-q`}
      >
        <p className="ui-eyebrow">Журнал размышлений</p>
        <h2 className="ui-editor__question" id={`${uid}-q`}>
          {DEFAULT_PROMPT}
        </h2>
        <textarea
          ref={areaRef}
          className="ui-editor__area"
          value={draft}
          onChange={(e) => useUi.setState({ draft: e.currentTarget.value })}
          onKeyDown={onKeyDown}
          placeholder="Можно начать с одного слова…"
          aria-labelledby={`${uid}-q`}
          aria-describedby={`${uid}-note`}
          spellCheck
          lang="ru"
          rows={8}
          maxLength={20000}
        />
        <div className="ui-editor__footer">
          <p className="ui-note" id={`${uid}-note`}>
            Записи хранятся только в этом браузере и никуда не отправляются.
            {!persistent && ' Сейчас хранилище браузера недоступно — запись сохранится лишь до закрытия вкладки.'}
          </p>
          <div className="ui-editor__actions">
            <button type="button" className="ui-link" onClick={discard}>
              Не сохранять
            </button>
            <button type="button" className="ui-btn ui-btn--small" onClick={save}>
              Сохранить в журнал
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
