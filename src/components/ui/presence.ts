import { useEffect, useState } from 'react'

export type PresenceState = 'in' | 'out'

export interface Presence {
  /** Render the element at all. */
  mounted: boolean
  /** 'in' once the enter transition should run, 'out' while entering/leaving. */
  state: PresenceState
  /** True while fading out (make the subtree inert). */
  exiting: boolean
}

/**
 * Keeps an element mounted while it fades out. CSS drives the transition via
 * `data-state="in" | "out"`; `exitMs` should match the longest exit transition.
 */
export function usePresence(visible: boolean, exitMs: number): Presence {
  const [mounted, setMounted] = useState(visible)
  const [shown, setShown] = useState(false)
  if (visible && !mounted) setMounted(true)

  useEffect(() => {
    if (visible) {
      // Two frames so the initial "out" styles are committed before "in".
      let r2 = 0
      const r1 = requestAnimationFrame(() => {
        r2 = requestAnimationFrame(() => setShown(true))
      })
      return () => {
        cancelAnimationFrame(r1)
        cancelAnimationFrame(r2)
      }
    }
    const t = window.setTimeout(() => {
      setMounted(false)
      setShown(false)
    }, exitMs)
    return () => window.clearTimeout(t)
  }, [visible, exitMs])

  const isMounted = mounted || visible
  return {
    mounted: isMounted,
    state: shown && visible ? 'in' : 'out',
    exiting: isMounted && !visible,
  }
}

/** Returns `value`, or the last non-null value while `value` is null (to render during fade-out). */
export function useRetained<T>(value: T | null): T | null {
  const [kept, setKept] = useState<T | null>(value)
  if (value !== null && value !== kept) setKept(value)
  return value ?? kept
}

/** True only after `flag` has stayed true for `delayMs` (avoids flashes during quick transitions). */
export function useDelayedFlag(flag: boolean, delayMs: number): boolean {
  const [on, setOn] = useState(false)
  if (!flag && on) setOn(false)
  useEffect(() => {
    if (!flag) return
    const t = window.setTimeout(() => setOn(true), delayMs)
    return () => window.clearTimeout(t)
  }, [flag, delayMs])
  return flag && on
}
