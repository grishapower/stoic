import { useEffect, useId, useRef } from 'react'
import { script } from '../../data/narration'
import { useGame } from '../../game/store'
import { firstLetterLineId, lastLetterLineId, letterBlocks, roman } from './letterText'
import { usePresence, type PresenceState } from './presence'
import { back, useUi } from './uiState'

export function LetterReader({ visible }: { visible: boolean }) {
  const p = usePresence(visible, 450)
  if (!p.mounted) return null
  return <LetterSheet state={p.state} exiting={p.exiting} />
}

function LetterSheet({ state, exiting }: { state: PresenceState; exiting: boolean }) {
  const heard = useGame((s) => s.narration.heard)
  const currentLineId = useGame((s) => s.narration.lineId)
  const showLatin = useUi((s) => s.letterLatin)
  const fromPause = useUi((s) => s.returnTo.letter === 'pause')
  const uid = useId()
  const scrollRef = useRef<HTMLDivElement>(null)

  const heardSet = new Set(heard)
  const { meta } = script
  const t = meta.translation

  // On open: focus the page for keyboard scrolling and bring the line being read into view.
  useEffect(() => {
    const box = scrollRef.current
    if (!box) return
    box.focus({ preventScroll: true })
    const current = box.querySelector<HTMLElement>('[data-current]')
    if (current) {
      const offset = current.getBoundingClientRect().top - box.getBoundingClientRect().top
      box.scrollTop += offset - box.clientHeight * 0.32
    }
  }, [])

  return (
    <div className="ui-modal ui-modal--sheet" data-state={state} inert={exiting}>
      <div
        className="ui-letter"
        data-latin={showLatin || undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${uid}-title`}
      >
        <div className="ui-letter__scroll" ref={scrollRef} tabIndex={-1}>
          <div className="ui-letter__bar">
            <span className="ui-eyebrow" lang="la">
              {meta.latinTitle}
            </span>
            <div className="ui-letter__tools">
              <label className="ui-inline-switch">
                <span className="ui-switch">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={showLatin}
                    onChange={(e) => useUi.setState({ letterLatin: e.currentTarget.checked })}
                  />
                  <span className="ui-switch__track" aria-hidden="true">
                    <span className="ui-switch__thumb" />
                  </span>
                </span>
                <span>Показать латинский оригинал</span>
              </label>
              <button type="button" className="ui-link ui-link--close" onClick={() => back('letter')}>
                {fromPause ? 'Назад' : 'Закрыть'}
                <kbd className="ui-kbd ui-kbd--tiny" aria-hidden="true">
                  Esc
                </kbd>
              </button>
            </div>
          </div>

          <article className="ui-letter__page">
            <header className="ui-letter__head">
              <p className="ui-letter__byline">Луций Анней Сенека — Луцилию</p>
              <h1 className="ui-letter__title" id={`${uid}-title`}>
                {meta.titleRu}
              </h1>
              <p className="ui-letter__honest">Рабочий перевод с латинского · не является официальным изданием</p>
            </header>

            {letterBlocks.map(({ block, lines }) => (
              <section className="ui-letter__block" key={block.id} aria-labelledby={`${uid}-${block.id}`}>
                <h2 className="ui-letter__block-title" id={`${uid}-${block.id}`}>
                  <span className="ui-numeral">{roman(block.n)}</span>
                  <span className="ui-letter__block-name">{block.titleRu}</span>
                  <span className="ui-letter__ref">{block.latinRef}</span>
                </h2>
                {lines.map((line) => (
                  <div
                    key={line.id}
                    className="ui-letter__line"
                    data-heard={heardSet.has(line.id) || undefined}
                    data-current={line.id === currentLineId || undefined}
                    data-role={
                      line.id === firstLetterLineId
                        ? 'salutation'
                        : line.id === lastLetterLineId
                          ? 'valediction'
                          : undefined
                    }
                  >
                    <p className="ui-letter__ru">{line.ru}</p>
                    {showLatin && line.latin && (
                      <p className="ui-letter__la" lang="la">
                        {line.latin}
                      </p>
                    )}
                  </div>
                ))}
              </section>
            ))}

            <footer className="ui-letter__colophon">
              <span className="ui-rule" aria-hidden="true" />
              <p className="ui-letter__colophon-label">{t.label}</p>
              <p>{t.note}</p>
              <p>
                Реплики Сенеки вне письма — приветствие и короткие замечания по дороге — написаны авторами прототипа и
                не являются цитатами из Сенеки.
              </p>
              {heard.length > 0 && <p className="ui-letter__legend">Точкой на полях отмечены строки, уже прозвучавшие на прогулке.</p>}
              <ul className="ui-letter__sources">
                <li>
                  <a href={t.latinSource} target="_blank" rel="noopener noreferrer">
                    Латинский текст — Wikisource
                  </a>
                </li>
                <li>
                  <a href={t.englishCheck} target="_blank" rel="noopener noreferrer">
                    Английский перевод для сверки — Wikisource
                  </a>
                </li>
                <li>
                  <a href={t.russianReference} target="_blank" rel="noopener noreferrer">
                    Перевод С. А. Ошерова — библиографический ориентир
                  </a>
                </li>
              </ul>
            </footer>
          </article>
        </div>
      </div>
    </div>
  )
}
