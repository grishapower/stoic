import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CanvasTexture, Group, Mesh, MeshBasicMaterial, PlaneGeometry, ShaderMaterial, SRGBColorSpace, Vector3 } from 'three'
import { letterLines, lineText, script } from '../../data/narration'
import { DEFAULT_PROMPT } from '../journal'
import { closeOverlay, finishWalk, openOverlay, restartWalk, showEnding, stayInSilence, stayInWorld } from '../session'
import { useGame } from '../store'
import { exitVR } from './xrSession'
import { SIDES, uiRay, xr } from './xrState'

/**
 * What the DOM UI shows on a monitor, drawn in the headset: subtitles and the
 * current prompt on a card that lazily follows the gaze, and the end-of-walk
 * choices as a panel whose buttons are clicked with the pointing ray
 * (trigger, or a pinch with tracked hands).
 */

const PX = 1000 // canvas pixels per metre
const FONT_TEXT = "'Spectral', Georgia, serif"
const FONT_UI = "'Inter Variable', 'Inter', system-ui, sans-serif"
const FONT_TITLE = "'Cormorant Garamond', Garamond, serif"

interface Card {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  tex: CanvasTexture
  mat: MeshBasicMaterial
  geo: PlaneGeometry
  w: number
  h: number
}

function makeCard(w: number, h: number): Card {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w * PX)
  canvas.height = Math.round(h * PX)
  const ctx = canvas.getContext('2d')!
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 4
  // Always readable: drawn over the world, untouched by fog and tone mapping.
  const mat = new MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false })
  return { canvas, ctx, tex, mat, geo: new PlaneGeometry(w, h), w, h }
}

function disposeCard(c: Card) {
  c.tex.dispose()
  c.mat.dispose()
  c.geo.dispose()
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const test = line ? `${line} ${w}` : w
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line)
      line = w
    } else line = test
  }
  if (line) lines.push(line)
  return lines
}

/** Text block centred on a soft dark plate; returns false when there is nothing to show. */
function drawPlate(c: Card, lines: { text: string; font: string; color: string; size: number }[]) {
  const { ctx, canvas } = c
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  const items = lines.filter((l) => l.text)
  if (!items.length) {
    c.tex.needsUpdate = true
    return false
  }
  const pad = 34
  const rows: { s: string; font: string; color: string; size: number }[] = []
  for (const l of items) {
    ctx.font = `${l.size}px ${l.font}`
    for (const s of wrap(ctx, l.text, canvas.width - pad * 2 - 40)) rows.push({ s, font: l.font, color: l.color, size: l.size })
  }
  const lineH = (r: { size: number }) => r.size * 1.32
  const total = rows.reduce((acc, r) => acc + lineH(r), 0)
  let wMax = 0
  for (const r of rows) {
    ctx.font = `${r.size}px ${r.font}`
    wMax = Math.max(wMax, ctx.measureText(r.s).width)
  }
  const bw = Math.min(canvas.width, wMax + pad * 2)
  const bh = Math.min(canvas.height, total + pad * 1.4)
  const x0 = (canvas.width - bw) / 2
  const y0 = canvas.height - bh
  roundRect(ctx, x0, y0, bw, bh, 26)
  ctx.fillStyle = 'rgba(16, 12, 9, 0.52)'
  ctx.fill()
  let y = y0 + pad * 0.7
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (const r of rows) {
    ctx.font = `${r.size}px ${r.font}`
    ctx.fillStyle = r.color
    ctx.fillText(r.s, canvas.width / 2, y + (lineH(r) - r.size) / 2)
    y += lineH(r)
  }
  c.tex.needsUpdate = true
  return true
}

/** "E — присесть" → "A — присесть" in the headset. */
function vrPrompt(p: string | null): string | null {
  if (!p) return null
  const hands = SIDES.every((s) => !xr.hands[s].connected || xr.hands[s].kind === 'hand')
  return p.replace(/^E\s—\s/, hands ? '' : 'A — ')
}

const head = new Vector3()
const fwd = new Vector3()
const goal = new Vector3()

/* ------------------------------------------------------------ Subtitles + prompt */

function FollowCard({ hidden }: { hidden: boolean }) {
  const presenting = useGame((s) => s.xrPresenting)
  const subsOn = useGame((s) => s.settings.subtitles)
  const big = useGame((s) => s.settings.subtitleSize === 'large')
  const cue = useGame((s) => s.narration.cueText)
  const paused = useGame((s) => s.narration.userPaused)
  const prompt = useGame((s) => s.interactPrompt)
  const phase = useGame((s) => s.phase)
  const [fontsReady, setFontsReady] = useState(false)
  const [onboarding, setOnboarding] = useState(true)
  const group = useRef<Group>(null)
  const card = useMemo(() => makeCard(1.4, 0.42), [])
  useEffect(() => () => disposeCard(card), [card])
  useEffect(() => {
    void Promise.all([document.fonts.load(`48px ${FONT_TEXT}`), document.fonts.load(`32px ${FONT_UI}`)]).then(() => setFontsReady(true))
  }, [])
  useEffect(() => {
    if (!presenting) return
    const sub = subsOn && phase !== 'title' ? cue : null
    const hands = SIDES.every((sd) => !xr.hands[sd].connected || xr.hands[sd].kind === 'hand')
    const intro = hands
      ? 'Сведите пальцы у плода, чтобы сорвать его · разожмите, чтобы отпустить'
      : 'Левый стик — идти · правый — поворот · хват — сорвать плод · B / Y — пауза'
    const status = paused ? 'Чтение на паузе · B / Y — продолжить' : (vrPrompt(prompt) ?? (onboarding ? intro : null))
    drawPlate(card, [
      { text: sub ?? '', font: FONT_TEXT, color: '#f6efe2', size: big ? 54 : 46 },
      { text: status ?? '', font: FONT_UI, color: '#e9d9b8', size: 30 },
    ])
  }, [card, presenting, subsOn, big, cue, paused, prompt, phase, fontsReady, onboarding])
  // The card mounts with each session (XRHud renders nothing outside VR): a short intro, then quiet.
  useEffect(() => {
    const t = setTimeout(() => setOnboarding(false), 14000)
    return () => clearTimeout(t)
  }, [])

  // Lazy follow: stays put while the gaze wanders a little, glides back when it wanders off.
  const init = useRef(false)
  useFrame((_, dt) => {
    const g = group.current
    if (!g) return
    g.visible = xr.presenting && !hidden
    if (!xr.presenting) {
      init.current = false
      return
    }
    head.copy(xr.head)
    fwd.set(0, 0, -1).applyQuaternion(xr.headQuat)
    fwd.y = 0
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1)
    fwd.normalize()
    goal.copy(head).addScaledVector(fwd, 1.6)
    goal.y = head.y - 0.42
    if (!init.current) {
      g.position.copy(goal)
      init.current = true
    }
    const off = g.position.distanceTo(goal)
    const k = 1 - Math.exp(-dt * (off > 0.55 ? 4 : off > 0.12 ? 1.2 : 0))
    g.position.lerp(goal, k)
    g.lookAt(head.x, g.position.y + 0.25, head.z)
  }, -0.85)

  return (
    <group ref={group} visible={false}>
      <mesh geometry={card.geo} material={card.mat} renderOrder={20} />
    </group>
  )
}

/* ------------------------------------------------------------ Comfort vignette */

function setAmount(mat: ShaderMaterial, v: number) {
  mat.uniforms.uAmount.value = v
}

/** Head-locked soft dark ring that closes in while the stick glides the player. */
function Vignette() {
  const camera = useThree((s) => s.camera)
  const enabled = useGame((s) => s.settings.vrVignette)
  const res = useMemo(() => {
    const geo = new PlaneGeometry(1.2, 1.2)
    const mat = new ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: { uAmount: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader:
        'uniform float uAmount; varying vec2 vUv; void main(){ float r = length(vUv - 0.5) * 2.0; float inner = mix(1.2, 0.42, uAmount); float a = smoothstep(inner, inner + 0.38, r) * uAmount; gl_FragColor = vec4(0.02, 0.015, 0.01, a); }',
    })
    return { geo, mat }
  }, [])
  const mesh = useRef<Mesh>(null)
  useEffect(() => {
    const m = mesh.current
    if (!m) return
    camera.add(m)
    return () => void camera.remove(m)
  }, [camera])
  useEffect(
    () => () => {
      res.geo.dispose()
      res.mat.dispose()
    },
    [res],
  )
  useFrame(() => {
    const amount = enabled && xr.presenting ? xr.gliding * 0.85 : 0
    setAmount(res.mat, amount)
    if (mesh.current) mesh.current.visible = amount > 0.01
  }, -0.85)
  return <mesh ref={mesh} geometry={res.geo} material={res.mat} position={[0, 0, -0.2]} renderOrder={40} visible={false} frustumCulled={false} />
}

/* ------------------------------------------------------------ Choice panels */

interface Choice {
  label: string
  run: () => void
}

function ChoicePanel({ title, subtitle, body, choices }: { title: string; subtitle?: string; body?: string; choices: Choice[] }) {
  const group = useRef<Group>(null)
  const head0 = useRef(new Vector3())
  const readingRef = useRef(body !== undefined)
  const hovered = useRef<number[]>([-1, -1])
  const BW = 0.62
  const BH = 0.085
  const GAP = 0.022
  const top = useMemo(() => makeCard(body ? 1.3 : 1.2, body ? 0.86 : subtitle ? 0.34 : 0.24), [subtitle, body])
  const buttons = useMemo(() => choices.map(() => makeCard(BW, BH)), [choices])
  const meshes = useRef<(Mesh | null)[]>([])
  useEffect(
    () => () => {
      disposeCard(top)
      buttons.forEach(disposeCard)
    },
    [top, buttons],
  )
  useEffect(() => {
    void document.fonts.load(`64px ${FONT_TITLE}`).then(() => {
      drawPlate(top, [
        { text: title, font: FONT_TITLE, color: '#f6efe2', size: body ? 54 : 64 },
        { text: subtitle ?? '', font: FONT_TEXT, color: '#d8c8a8', size: 34 },
        { text: body ?? '', font: FONT_TEXT, color: '#efe5d2', size: 34 },
      ])
      choices.forEach((c, i) => {
        const card = buttons[i]
        const { ctx, canvas } = card
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        roundRect(ctx, 4, 4, canvas.width - 8, canvas.height - 8, 30)
        ctx.fillStyle = 'rgba(24, 18, 12, 0.72)'
        ctx.fill()
        ctx.strokeStyle = 'rgba(233, 217, 184, 0.55)'
        ctx.lineWidth = 3
        ctx.stroke()
        ctx.font = `34px ${FONT_UI}`
        ctx.fillStyle = '#f2e6cc'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(c.label, canvas.width / 2, canvas.height / 2 + 2)
        card.tex.needsUpdate = true
      })
    })
  }, [top, buttons, title, subtitle, body, choices])

  // Placed once in front of the player at eye height; the buttons answer the pointing rays.
  useEffect(() => {
    const g = group.current
    if (!g) return
    head0.current.copy(xr.head)
    fwd.set(0, 0, -1).applyQuaternion(xr.headQuat)
    fwd.y = 0
    fwd.normalize()
    // A page of text sits further and lower than a short question.
    const reading = readingRef.current
    g.position.copy(xr.head).addScaledVector(fwd, reading ? 1.5 : 1.25)
    g.position.y = xr.head.y - (reading ? 0.45 : 0.12)
    g.lookAt(xr.head.x, g.position.y, xr.head.z)
    g.scale.setScalar(reading ? 1.0 : 1.3)
    // Placed once, when the panel opens.
  }, [])

  const local = useMemo(() => new Vector3(), [])
  const o = useMemo(() => new Vector3(), [])
  const d = useMemo(() => new Vector3(), [])
  const n = useMemo(() => new Vector3(), [])
  useFrame(() => {
    const g = group.current
    if (!g || !xr.presenting) return
    g.updateMatrixWorld()
    n.set(0, 0, 1).applyQuaternion(g.quaternion)
    SIDES.forEach((side, k) => {
      const h = xr.hands[side]
      uiRay[side] = 0
      hovered.current[k] = -1
      if (!h.connected) return
      o.copy(h.rayOrigin)
      d.copy(h.rayDir)
      const denom = d.dot(n)
      if (Math.abs(denom) < 1e-4) return
      const t = local.copy(g.position).sub(o).dot(n) / denom
      if (t <= 0 || t > 6) return
      local.copy(o).addScaledVector(d, t)
      g.worldToLocal(local)
      choices.forEach((_, i) => {
        const by = -0.06 - i * (BH + GAP)
        if (Math.abs(local.x) < BW / 2 && Math.abs(local.y - by) < BH / 2) {
          hovered.current[k] = i
          uiRay[side] = t
        }
      })
      if (hovered.current[k] >= 0 && h.selectPressed) {
        h.pulse(0.3, 25)
        choices[hovered.current[k]].run()
      }
    })
    meshes.current.forEach((m, i) => {
      if (!m) return
      const hot = hovered.current.includes(i)
      m.scale.setScalar(hot ? 1.05 : 1)
      ;(m.material as MeshBasicMaterial).opacity = hot ? 1 : 0.86
    })
  }, -0.9)
  useEffect(
    () => () => {
      uiRay.left = 0
      uiRay.right = 0
    },
    [],
  )

  return (
    <group ref={group}>
      <mesh geometry={top.geo} material={top.mat} position={[0, 0.06 + top.h / 2, 0]} renderOrder={21} />
      {choices.map((c, i) => (
        <mesh
          key={c.label}
          ref={(m) => void (meshes.current[i] = m)}
          geometry={buttons[i].geo}
          material={buttons[i].mat}
          position={[0, -0.06 - i * (BH + GAP), 0]}
          renderOrder={22}
        />
      ))}
    </group>
  )
}

const REFLECTION: Choice[] = [
  { label: 'Остаться в тишине', run: () => stayInSilence() },
  {
    label: 'Записать мысли (снять шлем)',
    run: () => {
      exitVR()
      openOverlay('reflection-editor')
    },
  },
  { label: 'Пройти прогулку заново', run: () => restartWalk() },
  { label: 'Завершить прогулку', run: () => showEnding() },
]

/** The letter, one block per page (the DOM reader is invisible in the headset). */
const LETTER_PAGES = script.blocks
  .map((b, i) => ({
    title: `${['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'][i] ?? i + 1}. ${b.titleRu}`,
    text: letterLines
      .filter((l) => l.block === b.id)
      .map((l) => lineText(l))
      .join(' '),
  }))
  .filter((p) => p.text)

function LetterPanel() {
  const [page, setPage] = useState(0)
  const choices = useMemo<Choice[]>(
    () => [
      { label: 'Дальше ›', run: () => setPage((p) => Math.min(LETTER_PAGES.length - 1, p + 1)) },
      { label: '‹ Назад', run: () => setPage((p) => Math.max(0, p - 1)) },
      { label: 'Закрыть письмо', run: () => closeOverlay() },
    ],
    [],
  )
  const pg = LETTER_PAGES[page]
  return <ChoicePanel title={pg.title} subtitle={`${page + 1} / ${LETTER_PAGES.length}`} body={pg.text} choices={choices} />
}

const ENDING: Choice[] = [
  { label: 'Остаться в этом мире', run: () => stayInWorld() },
  { label: 'Завершить', run: () => finishWalk() },
]

export function XRHud() {
  const presenting = useGame((s) => s.xrPresenting)
  const reflection = useGame((s) => s.reflectionPromptVisible && !s.endingVisible && s.overlay === null)
  const ending = useGame((s) => s.endingVisible)
  const letter = useGame((s) => s.overlay === 'letter')
  if (!presenting) return null
  return (
    <>
      <FollowCard hidden={reflection || ending || letter} />
      {letter && <LetterPanel key="letter" />}
      <Vignette />
      {reflection && <ChoicePanel key="reflection" title={DEFAULT_PROMPT} choices={REFLECTION} />}
      {ending && <ChoicePanel key="ending" title={script.meta.titleRu} subtitle={script.meta.latinTitle} choices={ENDING} />}
    </>
  )
}
