import { useGame } from '../../game/store'

/** Warm near-black full-screen fade driven by `fade` (0..1). */
export function FadeLayer() {
  const fade = useGame((s) => s.fade)
  const opacity = Math.min(1, Math.max(0, fade))
  return <div className="ui-fade-layer" style={{ opacity }} data-on={opacity > 0 || undefined} aria-hidden="true" />
}
