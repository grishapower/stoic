import type { ReactNode } from 'react'
import { useGame } from '../../game/store'
import { usePresence, useRetained } from './presence'
import { useUi } from './uiState'

/** Tiny bottom-centre status: "reading paused" indicator and short toasts. */
export function StatusLine() {
  const paused = useGame((s) => s.narration.userPaused && s.phase !== 'title' && !s.endingVisible)
  const flash = useUi((s) => s.flash)
  const flashText = useRetained(flash?.text ?? null)

  return (
    <div className="ui-status" role="status">
      <StatusItem visible={paused}>
        чтение на паузе <span aria-hidden="true">·</span> Пробел
      </StatusItem>
      <StatusItem visible={flash !== null}>
        {flashText}
      </StatusItem>
    </div>
  )
}

function StatusItem({ visible, children }: { visible: boolean; children: ReactNode }) {
  const p = usePresence(visible, 500)
  if (!p.mounted) return null
  return (
    <span className="ui-status__item" data-state={p.state}>
      {children}
    </span>
  )
}
