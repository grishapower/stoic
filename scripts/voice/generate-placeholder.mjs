#!/usr/bin/env node
// Free offline placeholder voice for Seneca via Piper (ru_RU-denis-medium).
//
//   npm run voice:placeholder                    # generate changed / missing lines
//   npm run voice:placeholder -- --force         # regenerate everything
//   npm run voice:placeholder -- --only=L01,L02
//   options: --voice=denis|dmitri   --pitch-offset=<semitones>   --takes=N
//            --asr-model=large-v3-turbo|small   --asr-isolated (one Whisper window
//            per take: slower, matches voice:verify on short lines)   --keep-temp   --dry-run
//
// Per cue: Piper (per-emotion tempo/noise; N takes, best one picked by ASR when
// faster-whisper is installed) → tape-style pitch-down (asetrate; the tempo
// change is pre-compensated in length_scale, so no atempo artefacts) → warmth
// EQ → edge trim. Per line: cues + exact pauses, 0.10 s lead-in, 0.25 s tail →
// −18 LUFS integrated, true peak ≤ −1.5 dBTP → MP3 (LAME VBR V1 ≈ 96 kbps) mono 44.1 kHz.

import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AUDIO_DIR,
  AUDIO_REL_DIR,
  DEFAULT_ASR_MODEL,
  TOOLS_DIR,
  WHISPER_DIR,
  applyStressFixes,
  asrAvailable,
  blockTotals,
  cueTts,
  displayText,
  ffprobeDuration,
  jitter,
  loadScript,
  mapLimit,
  onlyFilter,
  parseArgs,
  readManifest,
  refreshDisplayFields,
  round3,
  run,
  runPy,
  scoreTranscript,
  sha1,
  writeManifest,
} from './lib.mjs'

/** Bump when the DSP chain changes so cached clips get regenerated. */
const PIPELINE_VERSION = 'piper-pp-5'

const SR = 44100
const LEAD_IN = 0.1
const TAIL = 0.25
const TARGET_LUFS = -18
const TRUE_PEAK_MAX = -1.5
// LAME VBR V1 averages ≈ 95–100 kbps on this mono speech. LAME's CBR/ABR modes
// apply a flat 0.95 scale (−0.45 dB), which would break the loudness target.
const MP3_QUALITY = '1'

/**
 * Per-emotion delivery. L = effective tempo (Piper length_scale after the
 * pitch-shift compensation; >1 = slower), ns / nw = Piper noise / duration
 * noise, st = pitch shift in semitones. denis measures ≈150–160 Hz median on
 * clause-length cues; ≈ −3.3 st lands the clips around 125–130 Hz (verified with
 * `npm run voice:verify`; −2.8 st gave 134 Hz).
 */
const PRESETS = {
  // reflective / quiet: slower, lower, steadier
  reflective: { L: 1.25, ns: 0.62, nw: 0.76, st: -3.4 },
  'quiet-regret': { L: 1.27, ns: 0.58, nw: 0.7, st: -3.6 },
  'simple-truth': { L: 1.27, ns: 0.58, nw: 0.7, st: -3.6 },
  'rhetorical-sadness': { L: 1.22, ns: 0.62, nw: 0.76, st: -3.4 },
  finitude: { L: 1.25, ns: 0.6, nw: 0.72, st: -3.5 },
  'honest-admission': { L: 1.24, ns: 0.6, nw: 0.74, st: -3.4 },
  'warm-closing': { L: 1.24, ns: 0.62, nw: 0.74, st: -3.4 },
  calm: { L: 1.2, ns: 0.6, nw: 0.74, st: -3.4 },
  resume: { L: 1.2, ns: 0.62, nw: 0.8, st: -3.3 },
  'quiet-delight': { L: 1.22, ns: 0.64, nw: 0.78, st: -3.3 },
  // warm / encouraging / wry: a little quicker and brighter
  'warm-opening': { L: 1.14, ns: 0.66, nw: 0.8, st: -3.2 },
  'gentle-exhortation': { L: 1.14, ns: 0.66, nw: 0.8, st: -3.2 },
  'restrained-joy': { L: 1.09, ns: 0.7, nw: 0.82, st: -3.0 },
  'warm-greeting': { L: 1.1, ns: 0.68, nw: 0.82, st: -3.1 },
  invitation: { L: 1.1, ns: 0.68, nw: 0.82, st: -3.1 },
  patient: { L: 1.14, ns: 0.64, nw: 0.8, st: -3.2 },
  'patient-amused': { L: 1.1, ns: 0.68, nw: 0.82, st: -3.1 },
  'self-irony': { L: 1.12, ns: 0.68, nw: 0.82, st: -3.1 },
  'dry-humor': { L: 1.12, ns: 0.66, nw: 0.8, st: -3.2 },
  sincere: { L: 1.2, ns: 0.64, nw: 0.78, st: -3.3 },
  'thoughtful-irony': { L: 1.16, ns: 0.66, nw: 0.8, st: -3.3 },
  'irony-to-sincerity': { L: 1.15, ns: 0.66, nw: 0.8, st: -3.3 },
  'wry-sigh': { L: 1.16, ns: 0.64, nw: 0.78, st: -3.3 },
}
const DEFAULT_PRESET = { L: 1.16, ns: 0.64, nw: 0.78, st: -3.3 }

const VOICES = {
  denis: 'ru_RU-denis-medium.onnx',
  dmitri: 'ru_RU-dmitri-medium.onnx',
}

/**
 * Warmth / de-harsh chain applied after the pitch shift (44.1 kHz):
 * rumble cut, low-mid body, slight boxiness trim, presence de-harsh, soft top.
 */
const EQ_CHAIN = [
  'highpass=f=70:poles=2',
  'equalizer=f=190:t=o:w=1.3:g=2.5',
  'equalizer=f=480:t=o:w=1.0:g=-1.0',
  'equalizer=f=3300:t=o:w=1.1:g=-2.0',
  'highshelf=f=6500:g=-3.0',
  'lowpass=f=9800:poles=2',
].join(',')

/**
 * Piper-only phoneme overrides (raw espeak phonemes in [[…]], supported by
 * piper-tts). Each fixed a consistent ASR failure across takes (verified 4/4):
 * Piper clips a cue-initial /ʂ/ ("Что же" heard as "Кто же") and blurs a
 * cue-initial "Ведь," ("Весь"). Affects only the placeholder audio.
 */
const PIPER_PHONEME_FIXES = [
  { re: /^Что же(?=[\s,])/u, to: '[[ʃːtˈoʒy]]', note: 'cue-initial «Что же» → lengthened /ʂ/' },
  { re: /^Ведь,/u, to: '[[vʲˈetʲ]],', note: 'cue-initial «Ведь,» as raw phonemes' },
]

function applyPhonemeFixes(text) {
  let out = text
  const applied = []
  for (const f of PIPER_PHONEME_FIXES) {
    if (f.re.test(out)) {
      out = out.replace(f.re, f.to)
      applied.push(f.note)
    }
  }
  return { text: out, applied }
}

function cueSettings(line, cueIndex, pitchOffset) {
  const p = PRESETS[line.emotion.key] ?? DEFAULT_PRESET
  const last = cueIndex === line.cues.length - 1
  // Small deterministic per-cue variation so consecutive cues don't sound cloned.
  const st = p.st + pitchOffset + 0.25 * jitter(`${line.id}:${cueIndex}:pitch`)
  const tempo = p.L * (1 + 0.02 * jitter(`${line.id}:${cueIndex}:tempo`)) * (last && line.cues.length > 1 ? 1.03 : 1)
  const factor = 2 ** (st / 12) // < 1: lower pitch and slower playback
  return {
    semitones: Math.round(st * 100) / 100,
    tempo: Math.round(tempo * 1000) / 1000,
    // Resampling by `factor` slows speech by 1/factor, so pre-shorten Piper output.
    lengthScale: Math.round(tempo * factor * 1000) / 1000,
    noiseScale: p.ns,
    noiseWScale: p.nw,
    sentenceGap: Math.round(0.26 * p.L * 1000) / 1000,
  }
}

function linePlan(line, voiceName, pitchOffset) {
  const cues = line.cues.map((cue, i) => {
    const stress = applyStressFixes(cueTts(cue))
    const phon = applyPhonemeFixes(stress.text)
    const { text } = phon
    const applied = [...stress.applied, ...phon.applied]
    return { index: i, text, display: cue.text, applied, pause: cue.pause, settings: cueSettings(line, i, pitchOffset) }
  })
  const ttsText = cues.map((c) => c.text).join(' ')
  const hash = sha1({
    pipeline: PIPELINE_VERSION,
    voice: voiceName,
    eq: EQ_CHAIN,
    leadIn: LEAD_IN,
    tail: TAIL,
    lufs: TARGET_LUFS,
    tp: TRUE_PEAK_MAX,
    mp3: `V${MP3_QUALITY}`,
    cues: cues.map((c) => ({ t: c.text, p: c.pause, s: c.settings })),
  })
  return { line, cues, ttsText, hash }
}

/** Picks the best take per cue by ASR (lowest WER, no cut final word). */
async function pickTakes(todo, takes, tmp, asrModel, isolated) {
  // Take-major order: a packed Whisper window then holds different sentences
  // (Whisper tends to skip verbatim repeats inside one window).
  const files = []
  for (let k = 0; k < takes; k++) {
    for (const p of todo) {
      for (const c of p.cues) {
        files.push({ id: `${p.line.id}_${c.index}_t${k}`, file: join(tmp, `${p.line.id}_${c.index}_t${k}.f32`), rawSampleRate: SR })
      }
    }
  }
  console.log(`ASR (${asrModel}) on ${files.length} takes…`)
  const asr = await runPy('asr', { model: asrModel, downloadRoot: WHISPER_DIR, files, pack: !isolated }, tmp, { quiet: true })
  for (const p of todo) {
    for (const c of p.cues) {
      const scored = []
      for (let k = 0; k < takes; k++) {
        const s = scoreTranscript(c.display, asr[`${p.line.id}_${c.index}_t${k}`]?.text ?? '')
        scored.push({ k, s, score: s.wer + (s.lastWordMissing ? 0.5 : 0) })
      }
      scored.sort((a, b) => a.score - b.score || a.k - b.k)
      const best = scored[0]
      c.take = best.k
      c.asr = best.s
      const flag = best.s.wer > 0.25 || best.s.lastWordMissing ? '  <-- check' : ''
      console.log(
        `  ${`${p.line.id}#${c.index}`.padEnd(13)} take ${best.k}  WER ${best.s.wer.toFixed(2)} (takes: ${scored
          .map((x) => x.s.wer.toFixed(2))
          .join('/')})${best.s.diffs.length ? `  ${best.s.diffs.join(' ')}` : ''}${flag}`,
      )
    }
  }
}

async function main() {
  const args = parseArgs()
  const voiceName = typeof args.voice === 'string' ? args.voice : 'denis'
  if (!VOICES[voiceName]) throw new Error(`Unknown --voice=${voiceName} (denis|dmitri)`)
  const modelPath = join(TOOLS_DIR, 'piper-voices', VOICES[voiceName])
  if (!existsSync(modelPath)) throw new Error(`Piper voice not found: ${modelPath}`)
  const pitchOffset = args['pitch-offset'] ? Number(args['pitch-offset']) : 0
  if (!Number.isFinite(pitchOffset) || Math.abs(pitchOffset) > 4) throw new Error('--pitch-offset must be within ±4 semitones')

  const script = await loadScript()
  const manifest = await readManifest()
  const only = onlyFilter(args)
  if (only) {
    for (const id of only) if (!script.lines.some((l) => l.id === id)) throw new Error(`--only: unknown line ${id}`)
  }

  // Prune clips of lines that no longer exist in script.json.
  const ids = new Set(script.lines.map((l) => l.id))
  for (const id of Object.keys(manifest.clips)) {
    if (!ids.has(id)) {
      console.log(`prune ${id} (not in script.json)`)
      const f = join(AUDIO_DIR, `${id}.mp3`)
      if (existsSync(f) && manifest.clips[id].provider === 'piper-placeholder') await unlink(f)
      delete manifest.clips[id]
    }
  }

  const todo = []
  for (const line of script.lines) {
    const plan = linePlan(line, voiceName, pitchOffset)
    const clip = manifest.clips[line.id]
    if (only && !only.has(line.id)) {
      if (clip) manifest.clips[line.id] = refreshDisplayFields(clip, line)
      continue
    }
    if (clip?.provider === 'elevenlabs' && !args.force) {
      console.log(`keep ${line.id} (ElevenLabs clip; --force to replace with a placeholder)`)
      manifest.clips[line.id] = refreshDisplayFields(clip, line)
      continue
    }
    if (!args.force && clip && clip.hash === plan.hash && existsSync(join(AUDIO_DIR, `${line.id}.mp3`))) {
      manifest.clips[line.id] = refreshDisplayFields(clip, line)
      continue
    }
    todo.push(plan)
  }

  if (!todo.length) {
    console.log('All placeholder clips are up to date.')
    if (!args['dry-run']) await writeManifest(manifest, script)
    return
  }
  console.log(`Generating ${todo.length} line(s) with Piper/${voiceName}: ${todo.map((p) => p.line.id).join(', ')}`)
  for (const p of todo) {
    for (const c of p.cues) if (c.applied.length) console.log(`  ${p.line.id}#${c.index} pronunciation fix: ${c.applied.join('; ')}`)
  }
  if (args['dry-run']) {
    for (const p of todo) {
      console.log(`\n${p.line.id} [${p.line.emotion.key}]`)
      for (const c of p.cues) console.log(`  ${c.index}: tempo ${c.settings.tempo} pitch ${c.settings.semitones} st | ${c.text} (+${c.pause}s)`)
    }
    return
  }

  const hasAsr = await asrAvailable()
  const takes = args.takes ? Math.max(1, Math.min(6, Number.parseInt(args.takes, 10) || 1)) : hasAsr ? 3 : 1
  if (takes > 1 && !hasAsr) throw new Error('--takes > 1 needs faster-whisper in .tools/venv (see docs/audio/voice.md)')
  const asrModel = typeof args['asr-model'] === 'string' ? args['asr-model'] : DEFAULT_ASR_MODEL

  const tmp = await mkdtemp(join(tmpdir(), 'seneca-voice-'))
  try {
    await mkdir(AUDIO_DIR, { recursive: true })

    // 1) Piper synthesis: one process, N takes per cue (VITS sampling noise differs per take).
    const jobs = []
    const semitonesOf = new Map()
    for (const p of todo) {
      for (const c of p.cues) {
        for (let k = 0; k < takes; k++) {
          semitonesOf.set(`${p.line.id}_${c.index}_t${k}`, c.settings.semitones)
          jobs.push({
            id: `${p.line.id}_${c.index}_t${k}`,
            text: c.text,
            out: join(tmp, `${p.line.id}_${c.index}_t${k}.raw.wav`),
            lengthScale: c.settings.lengthScale,
            noiseScale: c.settings.noiseScale,
            noiseWScale: c.settings.noiseWScale,
            sentenceGap: c.settings.sentenceGap,
          })
        }
      }
    }
    const synth = await runPy('synth', { model: modelPath, jobs }, tmp)
    const piperSr = synth.sampleRate

    // 2) Pitch-down + EQ per take → raw float32 @ 44.1 kHz.
    await mapLimit(jobs, 6, async (job) => {
      const factor = 2 ** (semitonesOf.get(job.id) / 12)
      const af = [
        `asetrate=${Math.round(piperSr * factor)}`,
        `aresample=${SR}:filter_size=64:phase_shift=10:cutoff=0.96`,
        EQ_CHAIN,
      ].join(',')
      await run('ffmpeg', ['-v', 'error', '-y', '-i', job.out, '-af', af, '-ac', '1', '-f', 'f32le', job.out.replace(/\.raw\.wav$/, '.f32')])
    })

    // 3) Choose takes.
    if (takes > 1) await pickTakes(todo, takes, tmp, asrModel, Boolean(args['asr-isolated']))
    else for (const p of todo) for (const c of p.cues) c.take = 0

    // 4) Assemble lines: trim, exact pauses, loudness, true-peak limit.
    const assembled = await runPy(
      'assemble',
      {
        sampleRate: SR,
        targetLufs: TARGET_LUFS,
        truePeakMax: TRUE_PEAK_MAX,
        lines: todo.map((p) => ({
          id: p.line.id,
          leadIn: LEAD_IN,
          tail: TAIL,
          out: join(tmp, `${p.line.id}.final.f32`),
          cues: p.cues.map((c) => ({ file: join(tmp, `${p.line.id}_${c.index}_t${c.take}.f32`), pause: c.pause })),
        })),
      },
      tmp,
    )

    // 5) Encode MP3 and update the manifest.
    const now = new Date().toISOString()
    console.log('\nline         duration    loudness   true peak  peak reduction')
    await mapLimit(todo, 6, async (p) => {
      const { line } = p
      const a = assembled[line.id]
      const out = join(AUDIO_DIR, `${line.id}.mp3`)
      await run('ffmpeg', [
        '-v', 'error', '-y', '-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', join(tmp, `${line.id}.final.f32`),
        '-c:a', 'libmp3lame', '-q:a', MP3_QUALITY, '-ar', String(SR), '-ac', '1',
        '-map_metadata', '-1', '-id3v2_version', '0', '-write_id3v1', '0', out,
      ])
      const probed = await ffprobeDuration(out)
      if (Math.abs(probed - a.duration) > 0.05) {
        console.warn(`warn: ${line.id} mp3 duration ${probed.toFixed(3)} vs pcm ${a.duration.toFixed(3)}`)
      }
      manifest.clips[line.id] = {
        id: line.id,
        kind: line.kind,
        block: line.block,
        file: `${AUDIO_REL_DIR}/${line.id}.mp3`,
        duration: round3(a.duration),
        text: displayText(line),
        ttsText: p.ttsText,
        emotion: line.emotion.ru,
        routeAnchor: line.routeAnchor,
        cues: a.cues.map((c) => ({
          index: c.index,
          text: line.cues[c.index].text,
          start: round3(c.start),
          end: round3(c.end),
        })),
        provider: 'piper-placeholder',
        voice: `piper:${VOICES[voiceName].replace(/\.onnx$/, '')}`,
        model: 'piper-tts 1.8.0 (VITS, espeak-ng phonemes)',
        hash: p.hash,
        generatedAt: now,
      }
      console.log(`  ${line.id.padEnd(11)} ${a.duration.toFixed(2).padStart(6)} s  ${a.lufs.toFixed(1).padStart(6)} LUFS  ${a.truePeak.toFixed(1).padStart(5)} dBTP  limiter ${a.limitedDb.toFixed(1)} dB`)
    })

    const written = await writeManifest(manifest, script)
    const totals = blockTotals(written, script)
    console.log('\nDurations by block (s):', Object.entries(totals).map(([k, v]) => `${k}=${v.toFixed(1)}`).join('  '))
    console.log(`Manifest: ${Object.keys(written.clips).length}/${script.lines.length} clips, provider=${written.provider}`)
  } finally {
    if (args['keep-temp']) console.log(`temp kept: ${tmp}`)
    else await rm(tmp, { recursive: true, force: true })
  }
}

main().catch((e) => {
  console.error(e.message ?? e)
  process.exit(1)
})
