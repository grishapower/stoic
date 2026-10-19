import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getLine, letterLines, script, voiceManifest } from '../data/narration'
import { SEQUENCE } from '../game/narrative/sequence'

const ROOT = resolve(__dirname, '../..')

describe('narration data', () => {
  it('contains the complete letter (20 fragments, §1–§5, salutation to Vale)', () => {
    expect(letterLines).toHaveLength(20)
    expect(letterLines[0].latin).toBe('Seneca Lucilio suo salutem.')
    expect(letterLines[letterLines.length - 1].latin).toBe('Vale.')
    const blocks = new Set(letterLines.map((l) => l.block))
    expect([...blocks]).toEqual(['b1', 'b2', 'b3', 'b4', 'b5'])
  })

  it('keeps TTS spellings identical to the displayed subtitles (except stress marks)', () => {
    for (const line of script.lines) {
      for (const cue of line.cues) {
        expect(cue.text).not.toMatch(/́/)
        expect(cue.text).not.toMatch(/\[[^\]]+\]/)
        if (cue.tts) expect(cue.tts.replace(/́/g, '')).toBe(cue.text)
      }
    }
  })

  it('separates authored lines from the letter', () => {
    for (const line of script.lines) {
      if (line.kind === 'authored') {
        expect(line.block).toBeNull()
        expect(line.latin).toBeUndefined()
        expect(line.id.startsWith('A-')).toBe(true)
      } else {
        expect(line.latin).toBeTruthy()
      }
    }
  })

  it('plays every letter line exactly once, in order, in the walk sequence', () => {
    const seqLetter = SEQUENCE.filter((s) => s.t === 'line').map((s) => (s as { id: string }).id).filter((id) => id.startsWith('L'))
    expect(seqLetter).toEqual(letterLines.map((l) => l.id))
    for (const s of SEQUENCE) if (s.t === 'line') expect(() => getLine(s.id)).not.toThrow()
  })
})

describe('voice manifest', () => {
  it('has a clip for every scripted line with matching text and sane cue timings', () => {
    for (const line of script.lines) {
      const clip = voiceManifest.clips[line.id]
      expect(clip, line.id).toBeDefined()
      expect(clip.text).toBe(line.cues.map((c) => c.text).join(' '))
      expect(clip.cues).toHaveLength(line.cues.length)
      let prev = 0
      for (const cue of clip.cues) {
        expect(cue.start).toBeGreaterThanOrEqual(prev - 1e-6)
        expect(cue.end).toBeGreaterThan(cue.start)
        expect(cue.end).toBeLessThanOrEqual(clip.duration + 1e-6)
        prev = cue.end
      }
    }
  })

  it('points to audio files that exist in public/', () => {
    for (const clip of Object.values(voiceManifest.clips)) {
      if (!clip.file) continue
      expect(existsSync(resolve(ROOT, 'public', clip.file)), clip.file).toBe(true)
    }
  })

  it('is honest about placeholder audio', () => {
    if (voiceManifest.provider !== 'elevenlabs') expect(voiceManifest.placeholder).toBe(true)
  })
})

describe('secrets', () => {
  it('never reads API keys through Vite client env', () => {
    const files = ['src/game/audio/engine.ts', 'src/data/narration/index.ts', 'src/game/scenes/Props.tsx']
    for (const f of files) {
      const src = readFileSync(resolve(ROOT, f), 'utf8')
      expect(src).not.toMatch(/VITE_[A-Z_]*KEY/)
      expect(src).not.toMatch(/msy_/)
    }
  })
})
