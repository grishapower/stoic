import { create } from 'zustand'

/**
 * Shared UI/game state. Only low-frequency data lives here (phase changes,
 * subtitles, settings, overlays). Per-frame data (positions etc.) lives in
 * `runtime.ts` to avoid React re-renders.
 */

export type Phase =
  | 'title' // title screen over the live scene
  | 'arrival' // player walks in the garden, Seneca waits by the fountain
  | 'greeting' // Seneca greets and invites to walk
  | 'walk' // letter blocks 1–4 while walking
  | 'terrace' // arrival at the terrace, block 5
  | 'silence' // natural silence after the letter
  | 'reflection' // gentle prompt "На что я трачу своё время?"
  | 'ending' // inscription «Письмо I. О времени»
  | 'free' // player chose to stay in the world

export type Overlay = null | 'pause' | 'letter' | 'journal' | 'reflection-editor'

export type Quality = 'low' | 'medium' | 'high'

export interface Settings {
  masterVolume: number
  voiceVolume: number
  ambienceVolume: number
  musicVolume: number
  musicEnabled: boolean
  subtitles: boolean
  subtitleSize: 'normal' | 'large'
  mouseSensitivity: number // 0.2 .. 2
  invertY: boolean
  headBob: boolean
  quality: Quality
  fov: number
  /** VR: darken the edges of the view while gliding with the stick (motion comfort). */
  vrVignette: boolean
  /** VR: playing seated — raise the eye to standing height. */
  vrSeated: boolean
  /** VR: right-stick turning — smooth or in 30° steps. */
  vrTurn: 'smooth' | 'snap'
}

export interface NarrationUi {
  /** Line currently being spoken (or held mid-way when paused). */
  lineId: string | null
  cueIndex: number
  /** Subtitle text to display now (null = nothing). */
  cueText: string | null
  /** The player paused the reading (Space / menu). */
  userPaused: boolean
  /** Seneca is holding the reading because the player is far away. */
  waitingForPlayer: boolean
  /** Lines of the letter already heard (ids), for the reader overlay. */
  heard: string[]
}

export const DEFAULT_SETTINGS: Settings = {
  masterVolume: 0.9,
  voiceVolume: 1,
  ambienceVolume: 0.75,
  musicVolume: 0.35,
  musicEnabled: true,
  subtitles: true,
  subtitleSize: 'normal',
  mouseSensitivity: 1,
  invertY: false,
  headBob: true,
  quality: 'high',
  fov: 62,
  vrVignette: true,
  vrSeated: false,
  vrTurn: 'smooth',
}

const SETTINGS_KEY = 'seneca.settings.v1'

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {
    /* storage unavailable — settings stay in memory */
  }
}

export type HintId = 'move' | 'look' | 'narration-pause' | 'subtitles' | 'interact' | 'sit' | 'menu'

export interface GameStore {
  phase: Phase
  /** Increments on every (re)start so systems can reset. */
  runId: number
  overlay: Overlay
  pointerLocked: boolean
  audioReady: boolean
  /** True while the voice is a temporary stand-in (shown honestly in settings). */
  voicePlaceholder: boolean
  narration: NarrationUi
  /** Interaction prompt near an interactive object, e.g. "E — прочитать письмо". */
  interactPrompt: string | null
  hint: { id: HintId; text: string } | null
  seenHints: Partial<Record<HintId, boolean>>
  reflectionPromptVisible: boolean
  endingVisible: boolean
  /** Full-screen fade 0..1 (used for transitions). */
  fade: number
  /** 0..1 progress through the walk, drives the sun. */
  progress: number
  playerSeated: boolean
  contextLost: boolean
  /** WebXR immersive-vr is available (show the «В VR» button). */
  xrSupported: boolean
  /** An immersive VR session is running (the DOM UI is not visible in the headset). */
  xrPresenting: boolean
  loading: { done: boolean; label: string }
  settings: Settings

  setPhase: (phase: Phase) => void
  setOverlay: (overlay: Overlay) => void
  setPointerLocked: (locked: boolean) => void
  setAudioReady: (ready: boolean) => void
  setVoicePlaceholder: (v: boolean) => void
  setNarration: (patch: Partial<NarrationUi>) => void
  markHeard: (lineId: string) => void
  toggleNarrationPause: () => void
  toggleSubtitles: () => void
  setInteractPrompt: (text: string | null) => void
  showHint: (id: HintId, text: string) => void
  clearHint: (id?: HintId) => void
  setReflectionPromptVisible: (v: boolean) => void
  setEndingVisible: (v: boolean) => void
  setFade: (v: number) => void
  setProgress: (v: number) => void
  setPlayerSeated: (v: boolean) => void
  setContextLost: (v: boolean) => void
  setXR: (patch: { xrSupported?: boolean; xrPresenting?: boolean }) => void
  setLoading: (patch: Partial<GameStore['loading']>) => void
  updateSettings: (patch: Partial<Settings>) => void
  resetRun: () => void
}

const initialNarration: NarrationUi = {
  lineId: null,
  cueIndex: -1,
  cueText: null,
  userPaused: false,
  waitingForPlayer: false,
  heard: [],
}

export const useGame = create<GameStore>((set, get) => ({
  phase: 'title',
  runId: 0,
  overlay: null,
  pointerLocked: false,
  audioReady: false,
  voicePlaceholder: true,
  narration: initialNarration,
  interactPrompt: null,
  hint: null,
  seenHints: {},
  reflectionPromptVisible: false,
  endingVisible: false,
  fade: 0,
  progress: 0,
  playerSeated: false,
  contextLost: false,
  xrSupported: false,
  xrPresenting: false,
  loading: { done: false, label: 'Подготовка сцены…' },
  settings: loadSettings(),

  setPhase: (phase) => set({ phase }),
  setOverlay: (overlay) => set({ overlay }),
  setPointerLocked: (pointerLocked) => set({ pointerLocked }),
  setAudioReady: (audioReady) => set({ audioReady }),
  setVoicePlaceholder: (voicePlaceholder) => set({ voicePlaceholder }),
  setNarration: (patch) => set({ narration: { ...get().narration, ...patch } }),
  markHeard: (lineId) => {
    const n = get().narration
    if (n.heard.includes(lineId)) return
    set({ narration: { ...n, heard: [...n.heard, lineId] } })
  },
  toggleNarrationPause: () => {
    const n = get().narration
    set({ narration: { ...n, userPaused: !n.userPaused } })
  },
  toggleSubtitles: () => get().updateSettings({ subtitles: !get().settings.subtitles }),
  setInteractPrompt: (interactPrompt) => {
    if (get().interactPrompt !== interactPrompt) set({ interactPrompt })
  },
  showHint: (id, text) => {
    if (get().seenHints[id]) return
    set({ hint: { id, text }, seenHints: { ...get().seenHints, [id]: true } })
  },
  clearHint: (id) => {
    const h = get().hint
    if (!h) return
    if (!id || h.id === id) set({ hint: null })
  },
  setReflectionPromptVisible: (reflectionPromptVisible) => set({ reflectionPromptVisible }),
  setEndingVisible: (endingVisible) => set({ endingVisible }),
  setFade: (fade) => set({ fade }),
  setProgress: (progress) => {
    if (Math.abs(get().progress - progress) > 0.002) set({ progress })
  },
  setPlayerSeated: (playerSeated) => set({ playerSeated }),
  setContextLost: (contextLost) => set({ contextLost }),
  setXR: (patch) => set(patch),
  setLoading: (patch) => set({ loading: { ...get().loading, ...patch } }),
  updateSettings: (patch) => {
    const settings = { ...get().settings, ...patch }
    saveSettings(settings)
    set({ settings })
  },
  resetRun: () =>
    set({
      runId: get().runId + 1,
      narration: initialNarration,
      interactPrompt: null,
      reflectionPromptVisible: false,
      endingVisible: false,
      progress: 0,
      playerSeated: false,
      hint: null,
      seenHints: {},
    }),
}))

/** Non-React access. */
export const game = () => useGame.getState()
