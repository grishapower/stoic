import { useGame } from '../../game/store'

const CONTROLS: readonly [string, string][] = [
  ['WASD', 'идти'],
  ['Мышь', 'смотреть'],
  ['Shift', 'идти чуть быстрее'],
  ['E', 'взаимодействие · сорвать плод'],
  ['R', 'рассмотреть плод в руке'],
  ['Q', 'отпустить плод'],
  ['Пробел', 'пауза / продолжение чтения'],
  ['T', 'субтитры'],
  ['L', 'письмо'],
  ['Esc', 'меню'],
]

/** In the headset (controllers / tracked hands). */
const VR_CONTROLS: readonly [string, string][] = [
  ['Левый стик', 'идти (туда, куда смотрите)'],
  ['Правый стик', 'поворот на 30°'],
  ['Хват · сжать руку', 'сорвать или поднять плод; разжать — отпустить, взмах — бросить'],
  ['Курок · щипок', 'притянуть плод, на который указывает луч; кнопки на панелях'],
  ['A / X', 'взаимодействие (присесть на скамью)'],
  ['B / Y', 'пауза / продолжение чтения'],
]

function Rows({ rows, wide }: { rows: readonly [string, string][]; wide?: boolean }) {
  return (
    <>
      {rows.map(([key, action]) => (
        <div className={wide ? 'ui-controls__row ui-controls__row--wide' : 'ui-controls__row'} key={key}>
          <dt>
            <kbd className="ui-kbd">{key}</kbd>
          </dt>
          <dd>{action}</dd>
        </div>
      ))}
    </>
  )
}

export function ControlsList() {
  const xrSupported = useGame((s) => s.xrSupported)
  return (
    <dl className="ui-controls">
      <Rows rows={CONTROLS} />
      {xrSupported && (
        <>
          <div className="ui-controls__row ui-controls__row--head">
            <dt />
            <dd>В шлеме VR</dd>
          </div>
          <Rows rows={VR_CONTROLS} wide />
        </>
      )}
    </dl>
  )
}
