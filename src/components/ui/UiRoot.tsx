import '../../styles/fonts'
import '../../styles/tokens.css'
import '../../styles/ui.css'

import { useGame } from '../../game/store'
import { ClickToContinue } from './ClickToContinue'
import { ContextLost } from './ContextLost'
import { EndingOverlay } from './EndingOverlay'
import { FadeLayer } from './FadeLayer'
import { Hint } from './Hint'
import { InteractPrompt } from './InteractPrompt'
import { ModalHost } from './ModalHost'
import { ReflectionPrompt } from './ReflectionPrompt'
import { StatusLine } from './StatusLine'
import { Subtitles } from './Subtitles'
import { TitleScreen } from './TitleScreen'
import { useUiKeyboard } from './useUiKeyboard'

/**
 * The whole DOM UI, mounted above the R3F <Canvas>. The root ignores pointer
 * events; only interactive panels opt back in, so the canvas keeps its clicks.
 * Layers (bottom → top): HUD, reflection, fade, subtitles, title/ending,
 * click-to-continue, modal overlays, context-lost.
 */
export function UiRoot() {
  useUiKeyboard()
  const quality = useGame((s) => s.settings.quality)
  return (
    <div className="ui-root" lang="ru" data-quality={quality}>
      <Hint />
      <InteractPrompt />
      <ReflectionPrompt />
      <FadeLayer />
      <Subtitles />
      <StatusLine />
      <TitleScreen />
      <EndingOverlay />
      <ClickToContinue />
      <ModalHost />
      <ContextLost />
    </div>
  )
}

export default UiRoot
