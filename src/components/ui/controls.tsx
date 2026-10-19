import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'

/* Accessible, custom-styled form rows (real inputs underneath). */

interface RangeRowProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
  disabled?: boolean
}

export function RangeRow({ label, value, min, max, step, format, onChange, disabled }: RangeRowProps) {
  const id = useId()
  const pct = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))
  const text = format(value)
  return (
    <div className="ui-row ui-row--range" data-disabled={disabled || undefined}>
      <label className="ui-row__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="ui-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={text}
        style={{ '--fill': `${pct}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
      />
      <output className="ui-row__value" htmlFor={id} aria-hidden="true">
        {text}
      </output>
    </div>
  )
}

interface SwitchRowProps {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}

export function SwitchRow({ label, checked, onChange }: SwitchRowProps) {
  const id = useId()
  return (
    <div className="ui-row ui-row--switch">
      <label className="ui-row__label" htmlFor={id}>
        {label}
      </label>
      <span className="ui-switch">
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={checked}
          onChange={(e) => onChange(e.currentTarget.checked)}
        />
        <span className="ui-switch__track" aria-hidden="true">
          <span className="ui-switch__thumb" />
        </span>
      </span>
      <span className="ui-row__value" aria-hidden="true">
        {checked ? 'вкл' : 'выкл'}
      </span>
    </div>
  )
}

interface ChoiceRowProps<T extends string> {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (v: T) => void
}

export function ChoiceRow<T extends string>({ label, value, options, onChange }: ChoiceRowProps<T>) {
  const name = useId()
  const labelId = `${name}-label`
  return (
    <div className="ui-row ui-row--choice">
      <span className="ui-row__label" id={labelId}>
        {label}
      </span>
      <div className="ui-choice" role="radiogroup" aria-labelledby={labelId}>
        {options.map((o) => (
          <label key={o.value} className="ui-choice__opt">
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
            />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

interface ConfirmActionProps {
  label: ReactNode
  question: string
  confirmLabel: string
  cancelLabel?: string
  onConfirm: () => void
  /** Class of the trigger button. */
  className?: string
  /** Class of the confirmation group. */
  confirmClassName?: string
}

/** A button that asks for an inline confirmation (never window.confirm). Esc cancels. */
export function ConfirmAction({
  label,
  question,
  confirmLabel,
  cancelLabel = 'Отмена',
  onConfirm,
  className,
  confirmClassName,
}: ConfirmActionProps) {
  const [asking, setAsking] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const wasAsking = useRef(false)

  useEffect(() => {
    if (asking) cancelRef.current?.focus({ preventScroll: true })
    else if (wasAsking.current) triggerRef.current?.focus({ preventScroll: true })
    wasAsking.current = asking
  }, [asking])

  if (!asking) {
    return (
      <button ref={triggerRef} type="button" className={className} onClick={() => setAsking(true)}>
        {label}
      </button>
    )
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setAsking(false)
    }
  }

  return (
    <div
      className={['ui-confirm', confirmClassName].filter(Boolean).join(' ')}
      role="group"
      aria-label={question}
      onKeyDown={onKeyDown}
    >
      <span className="ui-confirm__q">{question}</span>
      <span className="ui-confirm__actions">
        <button type="button" className="ui-link ui-link--accent" onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button ref={cancelRef} type="button" className="ui-link" onClick={() => setAsking(false)}>
          {cancelLabel}
        </button>
      </span>
    </div>
  )
}

const KEY_PAIR = /^(\S{1,12}(?:\s\S{1,6})?)\s+[—–]\s+(.+)$/

/** Renders "E — прочитать письмо" as a small key cap + label; other text stays plain. */
export function KeyedText({ text }: { text: string }) {
  const parts = text.split(' · ')
  return (
    <>
      {parts.map((part, i) => {
        const m = KEY_PAIR.exec(part)
        return (
          <span key={i} className="ui-keyed">
            {m ? (
              <>
                <kbd className="ui-kbd">{m[1]}</kbd>
                <span>{m[2]}</span>
              </>
            ) : (
              part
            )}
          </span>
        )
      })}
    </>
  )
}
