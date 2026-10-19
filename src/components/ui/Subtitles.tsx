import { useEffect, useState } from 'react'
import { useGame } from '../../game/store'

interface CueItem {
  key: number
  text: string
  leaving: boolean
}

/** Matches the `ui-sub-out` animation in ui.css. */
const LEAVE_MS = 420

/** Bottom-centre subtitles; the previous cue fades out briefly under the new one. */
export function Subtitles() {
  const enabled = useGame((s) => s.settings.subtitles)
  const size = useGame((s) => s.settings.subtitleSize)
  const cueText = useGame((s) => s.narration.cueText)
  const inGame = useGame((s) => s.phase !== 'title')
  const text = enabled && inGame && cueText ? cueText : null

  const [items, setItems] = useState<CueItem[]>([])
  const [prevText, setPrevText] = useState<string | null>(null)
  const [seq, setSeq] = useState(0)

  // Derive the cue list when the text changes (current → leaving, new → entering).
  if (text !== prevText) {
    setPrevText(text)
    const key = seq + 1
    setSeq(key)
    const leaving = items.filter((i) => !i.leaving).map((i) => ({ ...i, leaving: true }))
    setItems(text ? [...leaving, { key, text, leaving: false }] : leaving)
  }

  useEffect(() => {
    if (!items.some((i) => i.leaving)) return
    const t = window.setTimeout(() => setItems((prev) => prev.filter((i) => !i.leaving)), LEAVE_MS)
    return () => window.clearTimeout(t)
  }, [items])

  const active = items.some((i) => !i.leaving)

  return (
    <div className="ui-subs" data-size={size} aria-hidden={!active}>
      <div className="ui-subs__shade" data-on={active || undefined} />
      <div className="ui-subs__stack">
        {items.map((i) => (
          <p key={i.key} className="ui-subs__line" data-leaving={i.leaving || undefined}>
            {i.text}
          </p>
        ))}
      </div>
    </div>
  )
}
