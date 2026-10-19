import { useId } from 'react'
import { useGame, type Quality } from '../../game/store'
import { ChoiceRow, RangeRow, SwitchRow } from './controls'

const pct = (v: number) => `${Math.round(v * 100)}%`
const times = (v: number) =>
  `${v.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}×`
const degrees = (v: number) => `${Math.round(v)}°`

const SUBTITLE_SIZES = [
  { value: 'normal', label: 'Обычный' },
  { value: 'large', label: 'Крупный' },
] as const

const QUALITIES: readonly { value: Quality; label: string }[] = [
  { value: 'low', label: 'Низкое' },
  { value: 'medium', label: 'Среднее' },
  { value: 'high', label: 'Высокое' },
]

/** Sound, subtitles, camera and graphics settings. Used on the title screen and in the pause menu. */
export function SettingsPanel() {
  const s = useGame((g) => g.settings)
  const update = useGame((g) => g.updateSettings)
  const voicePlaceholder = useGame((g) => g.voicePlaceholder)
  const xrSupported = useGame((g) => g.xrSupported)
  const uid = useId()

  return (
    <div className="ui-settings">
      <section className="ui-settings__group" aria-labelledby={`${uid}-sound`}>
        <h3 className="ui-settings__heading" id={`${uid}-sound`}>
          Звук
        </h3>
        <RangeRow
          label="Общая громкость"
          value={s.masterVolume}
          min={0}
          max={1}
          step={0.01}
          format={pct}
          onChange={(v) => update({ masterVolume: v })}
        />
        <RangeRow
          label="Голос"
          value={s.voiceVolume}
          min={0}
          max={1}
          step={0.01}
          format={pct}
          onChange={(v) => update({ voiceVolume: v })}
        />
        <RangeRow
          label="Окружение"
          value={s.ambienceVolume}
          min={0}
          max={1}
          step={0.01}
          format={pct}
          onChange={(v) => update({ ambienceVolume: v })}
        />
        <SwitchRow label="Музыка" checked={s.musicEnabled} onChange={(v) => update({ musicEnabled: v })} />
        <RangeRow
          label="Громкость музыки"
          value={s.musicVolume}
          min={0}
          max={1}
          step={0.01}
          format={pct}
          disabled={!s.musicEnabled}
          onChange={(v) => update({ musicVolume: v })}
        />
        {voicePlaceholder && (
          <p className="ui-note">
            Озвучка: временный синтезированный голос (заглушка), финальная озвучка ещё не записана.
          </p>
        )}
      </section>

      <div className="ui-settings__col">
        <section className="ui-settings__group" aria-labelledby={`${uid}-subs`}>
          <h3 className="ui-settings__heading" id={`${uid}-subs`}>
            Субтитры
          </h3>
          <SwitchRow label="Субтитры" checked={s.subtitles} onChange={(v) => update({ subtitles: v })} />
          <ChoiceRow
            label="Размер"
            value={s.subtitleSize}
            options={SUBTITLE_SIZES}
            onChange={(v) => update({ subtitleSize: v })}
          />
        </section>

        <section className="ui-settings__group" aria-labelledby={`${uid}-camera`}>
          <h3 className="ui-settings__heading" id={`${uid}-camera`}>
            Камера и мышь
          </h3>
          <RangeRow
            label="Чувствительность мыши"
            value={s.mouseSensitivity}
            min={0.2}
            max={2}
            step={0.05}
            format={times}
            onChange={(v) => update({ mouseSensitivity: v })}
          />
          <SwitchRow label="Инверсия оси Y" checked={s.invertY} onChange={(v) => update({ invertY: v })} />
          <SwitchRow label="Покачивание камеры" checked={s.headBob} onChange={(v) => update({ headBob: v })} />
          <RangeRow
            label="Поле зрения"
            value={s.fov}
            min={50}
            max={80}
            step={1}
            format={degrees}
            onChange={(v) => update({ fov: v })}
          />
        </section>

        <section className="ui-settings__group" aria-labelledby={`${uid}-gfx`}>
          <h3 className="ui-settings__heading" id={`${uid}-gfx`}>
            Изображение
          </h3>
          <ChoiceRow
            label="Качество графики"
            value={s.quality}
            options={QUALITIES}
            onChange={(v) => update({ quality: v })}
          />
        </section>

        {xrSupported && (
          <section className="ui-settings__group" aria-labelledby={`${uid}-vr`}>
            <h3 className="ui-settings__heading" id={`${uid}-vr`}>
              VR
            </h3>
            <SwitchRow label="Затемнять края при движении" checked={s.vrVignette} onChange={(v) => update({ vrVignette: v })} />
            <SwitchRow label="Играю сидя" checked={s.vrSeated} onChange={(v) => update({ vrSeated: v })} />
          </section>
        )}
      </div>
    </div>
  )
}
