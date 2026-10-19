import { useGame } from '../../game/store'
import { KeyedText } from './controls'
import { usePresence, useRetained } from './presence'

/** Quiet prompt slightly below the centre, e.g. "E — сесть на скамью". */
export function InteractPrompt() {
  const prompt = useGame((s) => s.interactPrompt)
  const blocked = useGame((s) => s.phase === 'title' || s.overlay !== null || s.endingVisible)
  const text = useRetained(prompt)
  const p = usePresence(prompt !== null && !blocked, 450)
  if (!p.mounted || !text) return null
  return (
    <div className="ui-interact" data-state={p.state}>
      <KeyedText text={text} />
    </div>
  )
}
