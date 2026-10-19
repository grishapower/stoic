import { useEffect, useId, useRef } from 'react'
import { useGame } from '../../game/store'
import { usePresence } from './presence'

/** WebGL context lost: calm notice with a manual restart. */
export function ContextLost() {
  const lost = useGame((s) => s.contextLost)
  const p = usePresence(lost, 500)
  if (!p.mounted) return null
  return <ContextLostPanel state={p.state} exiting={p.exiting} />
}

function ContextLostPanel({ state, exiting }: { state: 'in' | 'out'; exiting: boolean }) {
  const textId = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    buttonRef.current?.focus({ preventScroll: true })
  }, [])
  return (
    <div
      className="ui-context-lost"
      data-state={state}
      inert={exiting}
      role="alertdialog"
      aria-modal="true"
      aria-describedby={textId}
    >
      <div className="ui-context-lost__body">
        <p className="ui-context-lost__text" id={textId}>
          Графический контекст был потерян. Восстанавливаем сцену…
        </p>
        <button ref={buttonRef} type="button" className="ui-btn" onClick={() => window.location.reload()}>
          Перезапустить сцену
        </button>
      </div>
    </div>
  )
}
