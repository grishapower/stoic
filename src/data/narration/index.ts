import scriptJson from './script.json'
import manifestJson from '../generated/voice-manifest.json'
import type { NarrationScript, ScriptLine, VoiceClip, VoiceManifest } from './types'

export const script = scriptJson as NarrationScript
export const voiceManifest = manifestJson as VoiceManifest

const linesById = new Map<string, ScriptLine>(script.lines.map((l) => [l.id, l]))

export function getLine(id: string): ScriptLine {
  const line = linesById.get(id)
  if (!line) throw new Error(`Unknown narration line: ${id}`)
  return line
}

export function lineText(line: ScriptLine): string {
  return line.cues.map((c) => c.text).join(' ')
}

export const letterLines: ScriptLine[] = script.lines.filter((l) => l.kind === 'letter')

/** Average speaking rate used for silent (no-audio) fallback timing, characters per second. */
const FALLBACK_CPS = 12

/**
 * Returns the voice clip for a line. If no audio was generated yet, returns a
 * synthetic silent clip with estimated cue timings so subtitles still work.
 */
export function getClip(id: string): VoiceClip {
  const clip = voiceManifest.clips[id]
  if (clip) return clip
  const line = getLine(id)
  let t = 0
  const cues = line.cues.map((c, index) => {
    const start = t
    const end = start + Math.max(1.2, c.text.length / FALLBACK_CPS)
    t = end + c.pause
    return { index, text: c.text, start, end }
  })
  return {
    id,
    kind: line.kind,
    block: line.block,
    file: '',
    duration: t,
    text: lineText(line),
    ttsText: '',
    emotion: line.emotion.ru,
    routeAnchor: line.routeAnchor,
    cues,
    provider: 'none',
    voice: '',
    model: '',
    hash: '',
    generatedAt: '',
  }
}

export type { ScriptLine, VoiceClip, VoiceManifest } from './types'
