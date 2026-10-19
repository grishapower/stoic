#!/usr/bin/env node
// QA for generated voice clips (placeholder or ElevenLabs).
//
//   npm run voice:verify                         # full QA incl. ASR when available
//   npm run voice:verify -- --no-asr             # structure + audio checks only
//   npm run voice:verify -- --only=L01,L02  --asr-model=small
//
// Checks: manifest covers script.json, files exist, durations match, cue
// timings monotonic and inside the clip, cue texts in sync, loudness / true
// peak / clipping, edge silences, F0 stats, and (optional) faster-whisper ASR:
// WER vs the displayed text, cut final word, speech outside cue windows.
// Writes docs/audio/voice-qa.md. Exit code 1 on errors (not on ASR flags).

import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import {
  DEFAULT_ASR_MODEL,
  DOCS_AUDIO_DIR,
  PUBLIC_DIR,
  ROOT,
  VENV_PYTHON,
  WHISPER_DIR,
  asrAvailable,
  blockTotals,
  displayText,
  ffmpegLoudness,
  ffprobeDuration,
  loadScript,
  mapLimit,
  onlyFilter,
  parseArgs,
  readManifest,
  run,
  runPy,
  scoreTranscript,
} from './lib.mjs'

const LIMITS = {
  durationTolerance: 0.06, // s, manifest vs decoded file
  lufsTarget: -18,
  lufsTolerance: 1.0, // LU (warn)
  truePeakWarn: -1.5, // dBTP
  truePeakError: -0.5,
  samplePeakError: -0.1, // dBFS ≈ clipping
  leadMin: 0.03,
  leadMax: 0.6,
  tailMin: 0.08,
  tailMax: 1.2,
  werFlag: 0.25,
  f0Low: 105,
  f0High: 145,
}

/** Edge silences and sample peak via ffmpeg (no Python needed). */
async function edgeStats(file, duration) {
  const { stderr } = await run('ffmpeg', [
    '-hide_banner', '-nostats', '-i', file,
    '-af', 'silencedetect=n=-50dB:d=0.02,astats=metadata=0:measure_perchannel=Peak_level+Number_of_samples',
    '-f', 'null', '-',
  ])
  const starts = [...stderr.matchAll(/silence_start: (-?[\d.]+)/g)].map((m) => Number(m[1]))
  const ends = [...stderr.matchAll(/silence_end: (-?[\d.]+)/g)].map((m) => Number(m[1]))
  const lead = starts.length && starts[0] <= 0.001 ? (ends[0] ?? duration) : 0
  // A trailing silence has a start but no matching end (or ends at EOF).
  let tail = 0
  if (starts.length > ends.length) tail = duration - starts.at(-1)
  else if (starts.length && Math.abs(ends.at(-1) - duration) < 0.03) tail = duration - starts.at(-1)
  const peak = stderr.match(/Peak level dB: (-?[\d.]+|-inf)/)
  return { lead, tail: Math.max(0, tail), samplePeak: peak ? Number.parseFloat(peak[1]) : Number.NaN }
}

const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—')

async function main() {
  const args = parseArgs()
  const script = await loadScript()
  const manifest = await readManifest()
  const only = onlyFilter(args)
  const lines = script.lines.filter((l) => !only || only.has(l.id))
  const useAsr = !args['no-asr'] && (await asrAvailable())
  const asrModel = typeof args['asr-model'] === 'string' ? args['asr-model'] : DEFAULT_ASR_MODEL

  const errors = []
  const warnings = []
  const flags = []
  const rows = []

  for (const id of Object.keys(manifest.clips)) {
    if (!script.lines.some((l) => l.id === id)) warnings.push(`${id}: in manifest but not in script.json`)
  }

  // Structural + audio checks.
  const present = []
  await mapLimit(lines, 6, async (line) => {
    const clip = manifest.clips[line.id]
    const row = { id: line.id, line, clip, issues: [] }
    rows.push(row)
    const err = (m) => {
      errors.push(`${line.id}: ${m}`)
      row.issues.push(`ERROR ${m}`)
    }
    const warn = (m) => {
      warnings.push(`${line.id}: ${m}`)
      row.issues.push(`warn ${m}`)
    }
    if (!clip) return err('missing from manifest')
    const file = join(PUBLIC_DIR, clip.file)
    if (clip.file.startsWith('/')) err('file path must not start with "/"')
    if (!existsSync(file)) return err(`file not found: ${clip.file}`)

    // Manifest vs script sync.
    if (clip.text !== displayText(line)) warn('clip.text differs from script.json (re-run the generator to refresh)')
    if (clip.kind !== line.kind || clip.block !== line.block || clip.routeAnchor !== line.routeAnchor) warn('kind/block/routeAnchor out of sync')
    const leaky = (t) => /[[\]]|\u0301/.test(t)
    if (leaky(clip.text) || clip.cues.some((c) => leaky(c.text))) err('display text contains tags or stress marks')
    if (clip.cues.length !== line.cues.length) err(`cue count ${clip.cues.length} ≠ script ${line.cues.length}`)

    // Duration.
    const probed = await ffprobeDuration(file)
    row.probed = probed
    if (!(Math.abs(probed - clip.duration) <= LIMITS.durationTolerance)) {
      err(`duration ${fmt(probed, 3)} s ≠ manifest ${fmt(clip.duration, 3)} s`)
    }

    // Cue timings.
    let prevEnd = 0
    clip.cues.forEach((c, i) => {
      if (c.index !== i) err(`cue ${i}: index ${c.index}`)
      if (line.cues[i] && c.text !== line.cues[i].text) warn(`cue ${i}: text out of sync with script.json`)
      if (!(c.start >= 0 && c.end > c.start)) err(`cue ${i}: bad range ${c.start}–${c.end}`)
      if (c.start < prevEnd - 1e-6) err(`cue ${i}: starts ${c.start} before previous end ${prevEnd}`)
      if (c.end > clip.duration + 0.01) err(`cue ${i}: ends ${c.end} after clip end ${clip.duration}`)
      if (c.end - c.start < 0.25) warn(`cue ${i}: very short (${fmt(c.end - c.start)} s)`)
      prevEnd = c.end
    })

    // Loudness, peaks, edges.
    const loud = await ffmpegLoudness(file)
    const edges = await edgeStats(file, probed)
    Object.assign(row, loud, edges)
    if (Math.abs(loud.lufs - LIMITS.lufsTarget) > LIMITS.lufsTolerance) warn(`loudness ${fmt(loud.lufs, 1)} LUFS (target ${LIMITS.lufsTarget})`)
    if (loud.truePeak > LIMITS.truePeakError) err(`true peak ${fmt(loud.truePeak, 1)} dBTP`)
    else if (loud.truePeak > LIMITS.truePeakWarn) warn(`true peak ${fmt(loud.truePeak, 1)} dBTP > ${LIMITS.truePeakWarn}`)
    if (edges.samplePeak > LIMITS.samplePeakError) err(`sample peak ${fmt(edges.samplePeak, 2)} dBFS (clipping)`)
    if (edges.lead < LIMITS.leadMin) warn(`leading silence ${fmt(edges.lead, 3)} s (onset may be clipped)`)
    if (edges.lead > LIMITS.leadMax) warn(`leading silence ${fmt(edges.lead, 3)} s (late start)`)
    if (edges.tail < LIMITS.tailMin) warn(`trailing silence ${fmt(edges.tail, 3)} s (ending may be cut)`)
    if (edges.tail > LIMITS.tailMax) warn(`trailing silence ${fmt(edges.tail, 3)} s`)
    const firstStart = clip.cues[0]?.start ?? 0
    if (Math.abs(firstStart - edges.lead) > 0.2) warn(`first cue starts at ${fmt(firstStart)} s but speech at ${fmt(edges.lead)} s`)
    present.push(row)
  })
  rows.sort((a, b) => script.lines.indexOf(a.line) - script.lines.indexOf(b.line))
  present.sort((a, b) => script.lines.indexOf(a.line) - script.lines.indexOf(b.line))

  const tmp = await mkdtemp(join(tmpdir(), 'seneca-verify-'))
  try {
    // F0 and sample-accurate stats (numpy helper; optional).
    if (existsSync(VENV_PYTHON) && present.length) {
      const an = await runPy('analyze', { files: present.map((r) => ({ id: r.id, file: join(PUBLIC_DIR, r.clip.file) })) }, tmp, { quiet: true })
      for (const r of present) {
        const a = an[r.id]
        r.f0 = a
        if (a.clippedSamples > 0) {
          errors.push(`${r.id}: ${a.clippedSamples} clipped samples`)
          r.issues.push(`ERROR ${a.clippedSamples} clipped samples`)
        }
      }
    }

    // ASR.
    if (useAsr && present.length) {
      console.log(`ASR (${asrModel}) on ${present.length} clip(s)…`)
      const asr = await runPy(
        'asr',
        { model: asrModel, downloadRoot: WHISPER_DIR, files: present.map((r) => ({ id: r.id, file: join(PUBLIC_DIR, r.clip.file) })) },
        tmp,
        { quiet: true },
      )
      for (const r of present) {
        const a = asr[r.id]
        const s = scoreTranscript(displayText(r.line), a.text)
        r.asr = s
        if (s.wer > LIMITS.werFlag) {
          flags.push(`${r.id}: WER ${fmt(s.wer)} (${s.diffs.join(' ')})`)
          r.issues.push(`FLAG WER ${fmt(s.wer)}`)
        }
        if (s.lastWordMissing) {
          flags.push(`${r.id}: last expected word «${displayText(r.line).split(/\s+/).at(-1)}» not recognised (cut word?)`)
          r.issues.push('FLAG last word missing')
        }
        // Speech outside every cue window hints at wrong cue timings.
        const stray = a.words.filter((w) => {
          const mid = (w.start + w.end) / 2
          return !r.clip.cues.some((c) => mid >= c.start - 0.2 && mid <= c.end + 0.2)
        })
        if (stray.length) {
          warnings.push(`${r.id}: ASR words outside cue windows: ${stray.map((w) => `${w.w}@${w.start}`).join(', ')}`)
          r.issues.push(`warn ${stray.length} word(s) outside cue windows`)
        }
      }
    }
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }

  // F0 summary.
  const f0s = present.map((r) => r.f0?.f0Median).filter(Number.isFinite).sort((a, b) => a - b)
  const f0Median = f0s.length ? f0s[Math.floor(f0s.length / 2)] : Number.NaN
  const asrRows = present.filter((r) => r.asr)
  const totalErr = asrRows.reduce((s, r) => s + r.asr.distance, 0)
  const totalWords = asrRows.reduce((s, r) => s + r.asr.refWords, 0)
  const corpusWer = totalWords ? totalErr / totalWords : Number.NaN

  // Report.
  const totals = blockTotals(manifest, { lines })
  const providers = [...new Set(present.map((r) => r.clip.provider))].join(', ') || 'none'
  const md = []
  md.push('# Voice QA report', '')
  md.push(`Generated by \`npm run voice:verify\` on ${new Date().toISOString()}.`, '')
  md.push(`- Clips checked: ${present.length}/${lines.length} (provider: ${providers}; manifest placeholder flag: ${manifest.placeholder})`)
  md.push(`- Errors: **${errors.length}**, ASR flags: **${flags.length}**, warnings: ${warnings.length}`)
  md.push(`- Total duration: ${fmt(present.reduce((s, r) => s + r.clip.duration, 0), 1)} s — by block: ${Object.entries(totals).map(([k, v]) => `${k} ${fmt(v, 1)} s`).join(', ')}`)
  if (f0s.length) {
    const outside = f0s.filter((f) => f < LIMITS.f0Low || f > LIMITS.f0High).length
    md.push(
      `- F0 median of clip medians: ${fmt(f0Median, 1)} Hz (clip medians ${fmt(f0s[0], 0)}–${fmt(f0s.at(-1), 0)} Hz; ${outside} outside ${LIMITS.f0Low}–${LIMITS.f0High} Hz; informational)`,
    )
  }
  if (asrRows.length) {
    md.push(`- ASR: faster-whisper \`${asrModel}\` (int8, CPU, language ru); corpus WER ${fmt(corpusWer, 3)}; clips with WER > ${LIMITS.werFlag}: ${asrRows.filter((r) => r.asr.wer > LIMITS.werFlag).length}`)
  } else {
    md.push('- ASR: skipped (faster-whisper not installed or --no-asr)')
  }
  md.push(
    `- Thresholds: duration ±${LIMITS.durationTolerance} s; loudness ${LIMITS.lufsTarget}±${LIMITS.lufsTolerance} LU; true peak ≤ ${LIMITS.truePeakWarn} dBTP (error > ${LIMITS.truePeakError}); lead ${LIMITS.leadMin}–${LIMITS.leadMax} s; tail ${LIMITS.tailMin}–${LIMITS.tailMax} s; WER flag > ${LIMITS.werFlag}`,
    '',
  )
  md.push('| Line | Dur, s | Cues | LUFS | TP, dBTP | Lead / tail, s | F0 med (p10–p90), Hz | WER | Status |')
  md.push('|---|---:|---:|---:|---:|---:|---:|---:|---|')
  for (const r of rows) {
    if (!r.clip) {
      md.push(`| ${r.id} | — | — | — | — | — | — | — | ${r.issues.join('; ')} |`)
      continue
    }
    const f0 = r.f0?.f0Median ? `${fmt(r.f0.f0Median, 0)} (${fmt(r.f0.f0P10, 0)}–${fmt(r.f0.f0P90, 0)})` : '—'
    const status = r.issues.length ? r.issues.join('; ') : 'ok'
    md.push(
      `| ${r.id} | ${fmt(r.clip.duration)} | ${r.clip.cues.length} | ${fmt(r.lufs, 1)} | ${fmt(r.truePeak, 1)} | ${fmt(r.lead)} / ${fmt(r.tail)} | ${f0} | ${r.asr ? fmt(r.asr.wer) : '—'} | ${status} |`,
    )
  }
  if (asrRows.some((r) => r.asr.distance > 0 || r.asr.removed.length)) {
    md.push('', '## ASR differences', '', 'Reference = displayed text, normalised (case, ё→е, punctuation). `a→b` substitution, `-a` missing, `+b` extra.', '')
    for (const r of asrRows) {
      if (!r.asr.distance && !r.asr.removed.length) continue
      md.push(`- **${r.id}** (WER ${fmt(r.asr.wer)}): ${r.asr.diffs.join(' ') || '—'}`)
      md.push(`  - heard: «${r.asr.hyp}»`)
      if (r.asr.removed.length) md.push(`  - ignored Whisper hallucination: «${r.asr.removed.join(' ')}»`)
    }
  }
  for (const [title, list] of [['Errors', errors], ['ASR flags', flags], ['Warnings', warnings]]) {
    md.push('', `## ${title}`, '')
    md.push(...(list.length ? list.map((m) => `- ${m}`) : ['- none']))
  }
  md.push('')
  await mkdir(DOCS_AUDIO_DIR, { recursive: true })
  const reportPath = join(DOCS_AUDIO_DIR, 'voice-qa.md')
  await writeFile(reportPath, md.join('\n'))

  // Console summary.
  for (const r of rows) {
    if (!r.clip) continue
    console.log(
      `${r.id.padEnd(11)} ${fmt(r.clip.duration).padStart(6)} s  ${fmt(r.lufs, 1).padStart(5)} LUFS  TP ${fmt(r.truePeak, 1).padStart(5)}  F0 ${fmt(r.f0?.f0Median, 0).padStart(4)}  WER ${r.asr ? fmt(r.asr.wer) : ' — '}  ${r.issues.join('; ')}`,
    )
  }
  console.log(`\nErrors ${errors.length}, ASR flags ${flags.length}, warnings ${warnings.length}${asrRows.length ? `, corpus WER ${fmt(corpusWer, 3)}` : ''}${f0s.length ? `, F0 median ${fmt(f0Median, 1)} Hz` : ''}`)
  console.log(`Report: ${relative(ROOT, reportPath)}`)
  if (errors.length) process.exit(1)
}

main().catch((e) => {
  console.error(e.message ?? e)
  process.exit(1)
})
