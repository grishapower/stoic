#!/usr/bin/env node
// Production voice via ElevenLabs (default model eleven_v4).
//
//   npm run voice:elevenlabs                      # dry run when no API key
//   npm run voice:elevenlabs -- --dry-run         # print exact texts, chars, cost; no requests
//   npm run voice:elevenlabs -- --voices [--age=old|middle_aged] [--search=…]
//                                                 # browse the shared voice library (free GET)
//   npm run voice:elevenlabs -- --only=L01,L02 --max-chars=1500 --yes
//   options: --force  --model=eleven_v4  --stability=0.5  --similarity=0.8
//            --max-chars=6000  --skip-quota-check  --yes (no confirmation prompt)
//            --seed-offset=N (another take of the same text)  --no-cache
//
// Secrets: ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID / ELEVENLABS_MODEL from
// .env.local (process env overrides). The key is never printed. Never VITE_.
//
// Billing safety: nothing is sent in --dry-run; before generating, the planned
// characters are checked against --max-chars and the subscription quota, and
// raw API responses are cached in .tools/elevenlabs-cache so re-processing a
// line never costs twice.

import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { pathToFileURL } from 'node:url'
import {
  AUDIO_DIR,
  AUDIO_REL_DIR,
  STRESS_FIXES,
  TOOLS_DIR,
  VENV_PYTHON,
  blockTotals,
  displayText,
  ffprobeDuration,
  hasTags,
  loadEnvLocal,
  loadScript,
  normalizeForCompare,
  onlyFilter,
  parseArgs,
  readManifest,
  refreshDisplayFields,
  round3,
  run,
  runPy,
  sha1,
  stripStress,
  stripTags,
  writeManifest,
} from './lib.mjs'

const API = 'https://api.elevenlabs.io'
const PIPELINE_VERSION = 'el-1'
const PRICE_PER_1K = 0.08 // USD, API price for v4 / v3 / multilingual_v2 (docs/research/api-notes.md)
const OUTPUT_FORMAT = 'mp3_44100_128'
const SR = 44100
const LEAD_IN = 0.1
const TAIL = 0.25
const TARGET_LUFS = -18
const TRUE_PEAK_MAX = -1.5
const MP3_QUALITY = '1'
const CACHE_DIR = join(TOOLS_DIR, 'elevenlabs-cache')
const MODEL_CHAR_LIMIT = { eleven_v4: 10000, eleven_v3: 5000, eleven_multilingual_v2: 10000 }

/* -------------------------------------------------------------- text build */

/** Pause hint between cues. Tags are never displayed (stripped from subtitles). */
function pauseHint(seconds) {
  if (seconds >= 0.85) return ' [pause] '
  if (seconds >= 0.5) return ' [short pause] '
  return ' '
}

/** Exact text sent to ElevenLabs for a line: v3Tags + cues (with stress marks) + pause hints. */
export function buildTtsText(line) {
  let out = line.v3Tags ? `${line.v3Tags.trim()} ` : ''
  line.cues.forEach((cue, i) => {
    out += stripTags(cue.tts ?? cue.text)
    if (i < line.cues.length - 1) out += pauseHint(cue.pause)
  })
  return out.replace(/\s+/g, ' ').trim()
}

/** Ensures nothing but tags / stress marks separates the sent text from the subtitles. */
function validateLineText(line, ttsText) {
  const problems = []
  line.cues.forEach((c, i) => {
    if (hasTags(c.text)) problems.push(`cue ${i}: display text contains [ ]`)
    if (c.text.includes('\u0301')) problems.push(`cue ${i}: display text contains a stress mark`)
    if (c.tts && hasTags(c.tts)) problems.push(`cue ${i}: tts contains [tags] (put them in v3Tags)`)
  })
  const unmatched = ttsText.replace(/\[[^\]]*\]/g, '')
  if (/[[\]]/.test(unmatched)) problems.push('unbalanced [ ] in sent text')
  return problems
}

/** Advisory notes: respelled tts, words TTS engines tend to mis-stress. */
function stressAdvice(line, ttsText) {
  const out = []
  if (stripTags(stripStress(ttsText)) !== displayText(line)) {
    out.push('sent text (minus tags/stress marks) differs from the subtitles — intended respelling?')
  }
  line.cues.forEach((c, i) => {
    const t = c.tts ?? c.text
    for (const f of STRESS_FIXES) {
      f.re.lastIndex = 0
      if (f.re.test(t)) out.push(`cue ${i}: consider tts stress — ${f.note}`)
    }
  })
  return out
}

function voiceSettings(model, args) {
  const stability = args.stability ? Number(args.stability) : 0.5
  const similarity = args.similarity ? Number(args.similarity) : 0.8
  // v4 / v3 honour only stability + similarity; older models take the full set.
  if (/^eleven_v[34]/.test(model)) return { stability, similarity_boost: similarity }
  return { stability, similarity_boost: similarity, style: 0.15, use_speaker_boost: true, speed: 0.92 }
}

const seedFor = (lineId) => Number.parseInt(sha1(`seneca:${lineId}`).slice(0, 8), 16) // 0..2^32-1

/* -------------------------------------------------------------------- http */

export async function api(path, { key, method = 'GET', body, query } = {}) {
  const url = new URL(path, API)
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined || v === null || v === '') continue
    for (const item of Array.isArray(v) ? v : [v]) url.searchParams.append(k, String(item))
  }
  const headers = { Accept: 'application/json' }
  if (key) headers['xi-api-key'] = key
  if (body) headers['Content-Type'] = 'application/json'
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined })
    if (res.ok) return res
    const text = await res.text().catch(() => '')
    const retriable = res.status === 429 || res.status >= 500
    if (retriable && attempt < 4) {
      const wait = 1500 * 2 ** (attempt - 1)
      console.warn(`  ${method} ${url.pathname}: HTTP ${res.status}, retry in ${wait} ms`)
      await new Promise((r) => setTimeout(r, wait))
      continue
    }
    const err = new Error(`${method} ${url.pathname} → HTTP ${res.status}: ${text.slice(0, 500)}`)
    err.status = res.status
    err.body = text
    throw err
  }
}

/* --------------------------------------------------------------- alignment */

/**
 * Maps cue boundaries onto ElevenLabs character alignment by normalised text,
 * not raw indices: alignment may or may not contain tag characters, stress
 * marks, or normalised spellings. Returns [{start, end}] per cue (seconds).
 */
export function cueTimesFromAlignment(cueTexts, alignment) {
  const chars = alignment.characters
  const starts = alignment.character_start_times_seconds
  const ends = alignment.character_end_times_seconds
  // Alignment side: keep letters/digits outside [tags], normalised.
  const aNorm = []
  let depth = 0
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    if (ch === '[') depth++
    else if (ch === ']') depth = Math.max(0, depth - 1)
    else if (depth === 0) {
      const n = normalizeForCompare(ch).replace(/\s/g, '')
      for (const c of n) aNorm.push({ c, i })
    }
  }
  // Script side: concatenated cues, remembering cue ownership.
  const sNorm = []
  cueTexts.forEach((t, cue) => {
    for (const c of normalizeForCompare(t).replace(/\s/g, '')) sNorm.push({ c, cue })
  })
  // Character-level alignment (edit distance with backtrace).
  const n = sNorm.length
  const m = aNorm.length
  const W = m + 1
  const d = new Uint32Array((n + 1) * W)
  for (let i = 0; i <= n; i++) d[i * W] = i
  for (let j = 0; j <= m; j++) d[j] = j
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = sNorm[i - 1].c === aNorm[j - 1].c ? 0 : 1
      d[i * W + j] = Math.min(d[(i - 1) * W + j - 1] + cost, d[(i - 1) * W + j] + 1, d[i * W + j - 1] + 1)
    }
  }
  const match = new Array(n).fill(-1) // script char → alignment char index
  let i = n
  let j = m
  while (i > 0 && j > 0) {
    const cost = sNorm[i - 1].c === aNorm[j - 1].c ? 0 : 1
    if (d[i * W + j] === d[(i - 1) * W + j - 1] + cost) {
      match[i - 1] = aNorm[j - 1].i
      i--
      j--
    } else if (d[i * W + j] === d[(i - 1) * W + j] + 1) i--
    else j--
  }
  const quality = n ? 1 - d[n * W + m] / Math.max(n, m) : 0
  return {
    quality,
    cues: cueTexts.map((_, cue) => {
      const idx = sNorm.map((s, k) => (s.cue === cue ? match[k] : -1)).filter((k) => k >= 0)
      if (!idx.length) return null
      return { start: starts[Math.min(...idx)], end: ends[Math.max(...idx)] }
    }),
  }
}

/** Fallback when no alignment: split at long silences, else by character share. */
async function cueTimesFallback(file, cueTexts, pauses, duration) {
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'silencedetect=n=-45dB:d=0.25', '-f', 'null', '-'])
  const s = [...stderr.matchAll(/silence_start: ([\d.]+)/g)].map((x) => Number(x[1]))
  const e = [...stderr.matchAll(/silence_end: ([\d.]+)/g)].map((x) => Number(x[1]))
  const speechStart = s[0] === 0 ? (e[0] ?? 0) : 0
  const lastStart = s.length > e.length ? s.at(-1) : duration
  const inner = []
  for (let k = 0; k < Math.min(s.length, e.length); k++) if (s[k] > speechStart + 0.05 && e[k] < lastStart - 0.05) inner.push([s[k], e[k]])
  if (inner.length === cueTexts.length - 1) {
    return cueTexts.map((_, k) => ({ start: k ? inner[k - 1][1] : speechStart, end: k < inner.length ? inner[k][0] : lastStart }))
  }
  const lens = cueTexts.map((t) => t.length)
  const pauseSum = pauses.slice(0, -1).reduce((a, b) => a + b, 0)
  const speech = Math.max(0.1, lastStart - speechStart - pauseSum)
  const total = lens.reduce((a, b) => a + b, 0)
  let t = speechStart
  return lens.map((len, k) => {
    const start = t
    const end = start + (speech * len) / total
    t = end + (pauses[k] ?? 0)
    return { start, end }
  })
}

/* ------------------------------------------------------------------- modes */

async function listVoices(args, env) {
  const ages = typeof args.age === 'string' ? [args.age] : ['old', 'middle_aged']
  const seen = new Set()
  for (const age of ages) {
    const res = await api('/v1/shared-voices', {
      key: env.ELEVENLABS_API_KEY || undefined,
      query: {
        language: 'ru',
        gender: 'male',
        age,
        search: typeof args.search === 'string' ? args.search : undefined,
        page_size: 50,
        sort: 'usage_character_count_1y',
      },
    })
    const data = await res.json()
    console.log(`\n== shared voices: ru, male, age=${age} (${data.voices.length}${data.has_more ? '+' : ''}) ==`)
    for (const v of data.voices) {
      if (seen.has(v.voice_id)) continue
      seen.add(v.voice_id)
      const models = (v.verified_languages ?? []).filter((l) => l.language === 'ru').map((l) => l.model_id).join(',')
      console.log(
        `- ${v.name} | age ${v.age} | accent ${v.accent ?? '—'} | ${v.descriptive ?? ''} | use ${v.use_case ?? ''} | ` +
          `1y chars ${v.usage_character_count_1y ?? 0} | free users ${v.free_users_allowed ? 'yes' : 'no'}${v.rate && v.rate !== 1 ? ` | rate x${v.rate}` : ''}`,
      )
      console.log(`    voice_id ${v.voice_id}  owner ${v.public_owner_id}${models ? `  ru models: ${models}` : ''}`)
      if (v.description) console.log(`    ${v.description.replace(/\s+/g, ' ').slice(0, 200)}`)
      console.log(`    preview: ${v.preview_url ?? '—'}`)
    }
  }
  console.log(
    '\nPick: calm low-mid male, mature (age "old"/"middle_aged"), narrative/audiobook use, clean preview without music.\n' +
      'Add to your library (uses a voice slot): POST /v1/voices/add/{public_owner_id}/{voice_id} or the "Add" button,\n' +
      'then set ELEVENLABS_VOICE_ID in .env.local.',
  )
}

async function confirm(question) {
  if (!process.stdin.isTTY) return false
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question(`${question} [y/N] `)
  rl.close()
  return /^y(es)?$/i.test(answer.trim())
}

async function main() {
  const args = parseArgs()
  const env = { ...(await loadEnvLocal()) }
  for (const k of ['ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID', 'ELEVENLABS_MODEL']) if (process.env[k]) env[k] = process.env[k]
  const key = env.ELEVENLABS_API_KEY || ''
  const voiceId = env.ELEVENLABS_VOICE_ID || ''
  const model = typeof args.model === 'string' ? args.model : env.ELEVENLABS_MODEL || 'eleven_v4'

  if (args.voices) return listVoices(args, env)

  const script = await loadScript()
  const manifest = await readManifest()
  const only = onlyFilter(args)
  if (only) for (const id of only) if (!script.lines.some((l) => l.id === id)) throw new Error(`--only: unknown line ${id}`)
  const maxChars = args['max-chars'] ? Number(args['max-chars']) : 6000
  if (!Number.isFinite(maxChars) || maxChars <= 0) throw new Error('--max-chars must be a positive number')
  const seedOffset = args['seed-offset'] ? Number.parseInt(args['seed-offset'], 10) || 0 : 0
  const dryRun = Boolean(args['dry-run']) || !key || !voiceId
  const settings = voiceSettings(model, args)
  const charLimit = MODEL_CHAR_LIMIT[model] ?? 5000

  // Plan.
  const letters = script.lines.filter((l) => l.kind === 'letter')
  const plans = []
  let invalid = 0
  for (const line of script.lines) {
    const ttsText = buildTtsText(line)
    const problems = validateLineText(line, ttsText)
    if (ttsText.length > charLimit) problems.push(`text longer than the ${model} limit (${charLimit})`)
    if (problems.length) invalid++
    const li = letters.indexOf(line)
    // Request-stitching context for the continuous letter reading (not supported by eleven_v3).
    const context =
      line.kind === 'letter' && model !== 'eleven_v3'
        ? {
            previous_text: li > 0 ? displayText(letters[li - 1]) : undefined,
            next_text: li < letters.length - 1 ? displayText(letters[li + 1]) : undefined,
          }
        : {}
    // --seed-offset=N asks for another take; a chosen take is pinned per line in script.json ("take": N).
    const take = (line.take ?? 0) + seedOffset
    const seed = (seedFor(line.id) + take * 7919) % 2 ** 32
    const hash = sha1({ pipeline: PIPELINE_VERSION, model, voiceId, ttsText, settings, seed, format: OUTPUT_FORMAT, lufs: TARGET_LUFS })
    const clip = manifest.clips[line.id]
    const upToDate =
      clip?.provider === 'elevenlabs' && clip.hash === hash && existsSync(join(AUDIO_DIR, `${line.id}.mp3`))
    const selected = (!only || only.has(line.id)) && (args.force || !upToDate)
    const cacheBase = join(CACHE_DIR, `${line.id}-${hash.slice(0, 12)}`)
    const cached = !args['no-cache'] && existsSync(`${cacheBase}.mp3`) && existsSync(`${cacheBase}.json`)
    plans.push({ line, ttsText, problems, advice: stressAdvice(line, ttsText), context, seed, hash, selected, upToDate, cacheBase, cached })
  }
  const todo = plans.filter((p) => p.selected)
  // Cached responses are re-processed for free.
  const planned = todo.filter((p) => !p.cached).reduce((s, p) => s + p.ttsText.length, 0)
  const all = plans.reduce((s, p) => s + p.ttsText.length, 0)

  // Report.
  console.log(`ElevenLabs plan — model ${model}, voice ${voiceId ? `${voiceId.slice(0, 4)}…` : '(ELEVENLABS_VOICE_ID not set)'}, key ${key ? 'present' : 'absent'}`)
  console.log(`voice_settings ${JSON.stringify(settings)}, language_code ru, output ${OUTPUT_FORMAT}\n`)
  for (const p of plans) {
    const mark = p.selected ? (p.cached ? 'c' : '*') : p.upToDate ? '=' : ' '
    console.log(`${mark} ${p.line.id.padEnd(11)} ${String(p.ttsText.length).padStart(4)} chars  seed ${p.seed}`)
    console.log(`    ${p.ttsText}`)
    for (const pr of p.problems) console.log(`    !! ${pr}`)
    for (const a of p.advice) console.log(`    hint: ${a}`)
  }
  const usd = (c) => `$${((c / 1000) * PRICE_PER_1K).toFixed(2)}`
  console.log(`\n* = will be generated (${todo.filter((p) => !p.cached).length} lines), c = re-processed from cache, = = up to date`)
  console.log(`Planned: ${planned} chars ≈ ${usd(planned)}   |   whole script: ${all} chars ≈ ${usd(all)} (at $${PRICE_PER_1K}/1K chars)`)
  console.log(`Validation: ${invalid ? `${invalid} line(s) with problems` : 'ok — no tag or stress mark can reach the subtitles'}`)
  if (invalid) process.exitCode = 1

  if (dryRun) {
    if (!args['dry-run']) console.log('\nDry run: set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID in .env.local to generate.')
    return
  }
  if (invalid) throw new Error('Fix the text problems above before generating.')
  if (!todo.length) {
    console.log('Nothing to generate.')
    await writeManifest(manifest, script)
    return
  }

  // Budget guard (before any paid request).
  if (planned > maxChars) throw new Error(`Planned ${planned} chars exceed --max-chars=${maxChars}. Narrow with --only or raise the limit.`)
  if (planned > 0 && !args['skip-quota-check']) {
    const sub = await (await api('/v1/user/subscription', { key })).json()
    const remaining = sub.character_limit - sub.character_count
    console.log(`Quota: ${sub.character_count}/${sub.character_limit} used, ${remaining} remaining (tier ${sub.tier ?? '?'})`)
    if (planned > remaining) throw new Error(`Planned ${planned} chars exceed the remaining quota ${remaining}.`)
  }
  if (!args.yes && !(await confirm(`Generate ${todo.length} line(s), ${planned} chars ≈ ${usd(planned)}?`))) {
    console.log('Aborted (pass --yes to skip this prompt).')
    return
  }

  await mkdir(CACHE_DIR, { recursive: true })
  await mkdir(AUDIO_DIR, { recursive: true })
  const tmp = await mkdtemp(join(tmpdir(), 'seneca-el-'))
  let spentChars = 0
  try {
    for (const p of todo) {
      const { line } = p
      const { cacheBase } = p
      let alignment = null
      const rawMp3 = `${cacheBase}.mp3`
      if (p.cached) {
        alignment = JSON.parse(await readFile(`${cacheBase}.json`, 'utf8')).alignment
        console.log(`${line.id}: using cached response`)
      } else {
        const body = {
          text: p.ttsText,
          model_id: model,
          voice_settings: settings,
          seed: p.seed,
          ...(model.startsWith('eleven_multilingual_v2') ? {} : { language_code: 'ru' }),
          ...p.context,
        }
        let audio
        try {
          const res = await api(`/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps`, {
            key, method: 'POST', body, query: { output_format: OUTPUT_FORMAT },
          })
          const cost = res.headers.get('character-cost')
          const data = await res.json()
          audio = Buffer.from(data.audio_base64, 'base64')
          alignment = data.alignment ?? data.normalized_alignment ?? null
          spentChars += Number(cost ?? p.ttsText.length)
        } catch (e) {
          // Timestamps unsupported for this model → plain endpoint + estimated timings.
          if (!(e.status === 400 || e.status === 422) || !/timestamp|not support|model/i.test(e.body ?? '')) throw e
          console.warn(`${line.id}: with-timestamps rejected (${e.status}); falling back to plain TTS`)
          const res = await api(`/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
            key, method: 'POST', body, query: { output_format: OUTPUT_FORMAT },
          })
          audio = Buffer.from(await res.arrayBuffer())
          spentChars += Number(res.headers.get('character-cost') ?? p.ttsText.length)
        }
        await writeFile(rawMp3, audio)
        await writeFile(`${cacheBase}.json`, JSON.stringify({ lineId: line.id, ttsText: p.ttsText, model, alignment }, null, 1))
      }

      // Cue timings in the raw response.
      const cueTexts = line.cues.map((c) => c.text)
      const rawDuration = await ffprobeDuration(rawMp3)
      let rawCues
      if (alignment?.characters?.length) {
        const mapped = cueTimesFromAlignment(cueTexts, alignment)
        if (mapped.quality < 0.85) console.warn(`${line.id}: alignment match quality ${mapped.quality.toFixed(2)}`)
        rawCues = mapped.cues
      }
      if (!rawCues || rawCues.some((c) => !c)) {
        rawCues = await cueTimesFallback(rawMp3, cueTexts, line.cues.map((c) => c.pause), rawDuration)
      }

      // Loudness / edge processing, same targets as the placeholder (Python helper).
      const out = join(AUDIO_DIR, `${line.id}.mp3`)
      let duration
      let cues
      if (existsSync(VENV_PYTHON)) {
        const finalF32 = join(tmp, `${line.id}.f32`)
        const res = await runPy('assemble', {
          sampleRate: SR, targetLufs: TARGET_LUFS, truePeakMax: TRUE_PEAK_MAX,
          lines: [{ id: line.id, leadIn: LEAD_IN, tail: TAIL, out: finalF32, cues: [{ file: rawMp3, pause: 0 }] }],
        }, tmp, { quiet: true })
        const r = res[line.id]
        const shift = r.cues[0].start - r.cues[0].srcStart
        duration = r.duration
        cues = rawCues.map((c, index) => ({
          index,
          text: cueTexts[index],
          // The first subtitle appears with the first sound: a leading tag ([sighs]) can make the
          // model's alignment start the text late.
          start: round3(index === 0 ? r.cues[0].start : Math.max(r.cues[0].start, c.start + shift)),
          end: round3(Math.min(r.cues[0].end, c.end + shift)),
        }))
        await run('ffmpeg', [
          '-v', 'error', '-y', '-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', finalF32,
          '-c:a', 'libmp3lame', '-q:a', MP3_QUALITY, '-map_metadata', '-1', '-id3v2_version', '0', '-write_id3v1', '0', out,
        ])
      } else {
        console.warn(`${line.id}: Python helper missing — saving the raw response without loudness processing`)
        await writeFile(out, await readFile(rawMp3))
        duration = rawDuration
        cues = rawCues.map((c, index) => ({ index, text: cueTexts[index], start: round3(c.start), end: round3(c.end) }))
      }
      // Keep cues monotonic even if the model ran words together.
      for (let k = 1; k < cues.length; k++) if (cues[k].start < cues[k - 1].end) cues[k].start = cues[k - 1].end

      manifest.clips[line.id] = {
        id: line.id,
        kind: line.kind,
        block: line.block,
        file: `${AUDIO_REL_DIR}/${line.id}.mp3`,
        duration: round3(duration),
        text: displayText(line),
        ttsText: p.ttsText,
        emotion: line.emotion.ru,
        routeAnchor: line.routeAnchor,
        cues,
        provider: 'elevenlabs',
        voice: voiceId,
        model,
        hash: p.hash,
        generatedAt: new Date().toISOString(),
      }
      // Persist after every line so an interruption never loses paid work.
      await writeManifest(manifest, script)
      console.log(`${line.id}: ${duration.toFixed(2)} s, ${cues.length} cues`)
    }
    for (const p of plans) if (!p.selected && manifest.clips[p.line.id]) manifest.clips[p.line.id] = refreshDisplayFields(manifest.clips[p.line.id], p.line)
    const written = await writeManifest(manifest, script)
    const totals = blockTotals(written, script)
    console.log(`\nSpent ≈ ${spentChars} chars (${usd(spentChars)}). Durations by block: ${Object.entries(totals).map(([k, v]) => `${k}=${v.toFixed(1)}s`).join(' ')}`)
    console.log('Next: npm run voice:verify')
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e.message ?? e)
    process.exit(1)
  })
}
