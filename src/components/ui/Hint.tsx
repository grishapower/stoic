import { useEffect } from 'react'
import { useGame } from '../../game/store'
import { KeyedText } from './controls'
import { usePresence, useRetained } from './presence'

const HINT_MS = 6000

/** Small bottom-left hint; clears itself after a few seconds. */
export function Hint() {
  const hint = useGame((s) => s.hint)
  const clearHint = useGame((s) => s.clearHint)
  const blocked = useGame((s) => s.phase === 'title' || s.overlay !== null || s.endingVisible)

  useEffect(() => {
    if (!hint) return
    const id = hint.id
    const t = window.setTimeout(() => clearHint(id), HINT_MS)
    return () => window.clearTimeout(t)
  }, [hint, clearHint])

  const text = useRetained(hint?.text ?? null)
  const p = usePresence(hint !== null && !blocked, 800)
  if (!p.mounted || !text) return null
  return (
    <div className="ui-hint" data-state={p.state} role="status">
      <KeyedText text={text} />
    </div>
  )
}
