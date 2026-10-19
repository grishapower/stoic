import { useGame } from '../../game/store'
import { JournalView } from './JournalView'
import { LetterReader } from './LetterReader'
import { PauseMenu } from './PauseMenu'
import { usePresence, useRetained } from './presence'
import { ReflectionEditor } from './ReflectionEditor'

/** One shared backdrop (blocks the canvas) with cross-fading modal panels on top. */
export function ModalHost() {
  const overlay = useGame((s) => s.overlay)
  const tone = useRetained(overlay)
  const backdrop = usePresence(overlay !== null, 500)
  return (
    <>
      {backdrop.mounted && (
        <div className="ui-backdrop" data-state={backdrop.state} data-tone={tone ?? undefined} aria-hidden="true" />
      )}
      <PauseMenu visible={overlay === 'pause'} />
      <LetterReader visible={overlay === 'letter'} />
      <JournalView visible={overlay === 'journal'} />
      <ReflectionEditor visible={overlay === 'reflection-editor'} />
    </>
  )
}
