/**
 * Narration data model.
 *
 * `script.json` is the single source of truth for everything Seneca says:
 * the letter (kind = "letter", our own working translation from Latin) and
 * authored lines (kind = "authored", developer-written, NOT from the letter).
 *
 * The voice pipeline (scripts/voice/*) reads script.json and writes audio files
 * plus `src/data/generated/voice-manifest.json` (see VoiceManifest below).
 */

export type LineKind = 'letter' | 'authored'

export type BlockId = 'b1' | 'b2' | 'b3' | 'b4' | 'b5'

/** Where on the walk a line is meant to be spoken. Matches station/section ids in world/layout.ts. */
export type RouteAnchor =
  | 'garden'
  | 'cypress-alley'
  | 'olive-grove'
  | 'viewpoint'
  | 'pergola'
  | 'terrace'
  | 'any'

export type Gesture =
  | 'none'
  | 'open-hand'
  | 'count'
  | 'chest'
  | 'grasp'
  | 'shrug'
  | 'point-back'
  | 'toward-sea'
  | 'toward-table'
  | 'welcome'
  | 'scroll-read'
  | 'scroll-show'
  | 'scroll-close'

export type LookTarget = 'player' | 'path' | 'sea' | 'back' | 'scroll' | 'trees' | 'table'

export interface ScriptCue {
  /** Exact displayed subtitle text. */
  text: string
  /** Optional TTS-only spelling (stress marks U+0301 etc). Never displayed. */
  tts?: string
  /** Silence after this cue, seconds (placeholder pipeline inserts it; ElevenLabs uses it as a hint). */
  pause: number
}

export interface ScriptLine {
  id: string
  kind: LineKind
  block: BlockId | null
  routeAnchor: RouteAnchor
  /** Latin original for letter lines. */
  latin?: string
  cues: ScriptCue[]
  emotion: { key: string; ru: string }
  /** Voice direction for a human actor / expressive TTS. */
  direction: string
  /** ElevenLabs v3 audio tags prefix, e.g. "[thoughtful]". Stripped from anything displayed. */
  v3Tags: string
  gesture: Gesture
  look: LookTarget
  /** Natural silence after the line before the next one may start, seconds. */
  postPause: number
  /** Chosen ElevenLabs take (seed offset) when the default one was rejected in QA. */
  take?: number
}

export interface ScriptBlock {
  id: BlockId
  n: number
  titleRu: string
  latinRef: string
  routeAnchor: RouteAnchor
}

export interface NarrationScript {
  meta: {
    letterId: string
    titleRu: string
    latinTitle: string
    translation: {
      label: string
      note: string
      latinSource: string
      englishCheck: string
      russianReference: string
    }
    authoredNote: string
  }
  blocks: ScriptBlock[]
  lines: ScriptLine[]
}

/* ------------------------------------------------------------------------ */
/* Generated voice manifest (written by scripts/voice/*, read by the game). */
/* ------------------------------------------------------------------------ */

export interface VoiceCueTiming {
  /** Index into ScriptLine.cues */
  index: number
  text: string
  /** Seconds from clip start. */
  start: number
  end: number
}

export type VoiceProvider = 'piper-placeholder' | 'elevenlabs' | 'none'

export interface VoiceClip {
  id: string
  kind: LineKind
  block: BlockId | null
  /** URL path relative to the site root, e.g. "assets/audio/voice/L02.mp3". */
  file: string
  /** Seconds. */
  duration: number
  /** Exact displayed text (cues joined by a space). */
  text: string
  /** Exact text sent to the TTS engine (may include tags / stress marks). */
  ttsText: string
  emotion: string
  routeAnchor: RouteAnchor
  cues: VoiceCueTiming[]
  provider: VoiceProvider
  voice: string
  model: string
  /** sha1 of ttsText + generation settings; lets the scripts skip unchanged lines. */
  hash: string
  generatedAt: string
}

export interface VoiceManifest {
  version: 1
  provider: VoiceProvider
  /** True when the audio is a temporary stand-in (must be shown honestly in the UI). */
  placeholder: boolean
  generatedAt: string
  clips: Record<string, VoiceClip>
}
