// Shared helpers for the voice pipeline (placeholder, ElevenLabs, verify).
// Plain Node ESM, no dependencies beyond Node 22 and ffmpeg/ffprobe on PATH.

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const SCRIPT_PATH = join(ROOT, 'src/data/narration/script.json')
export const MANIFEST_PATH = join(ROOT, 'src/data/generated/voice-manifest.json')
export const PUBLIC_DIR = join(ROOT, 'public')
export const AUDIO_REL_DIR = 'assets/audio/voice'
export const AUDIO_DIR = join(PUBLIC_DIR, AUDIO_REL_DIR)
export const TOOLS_DIR = join(ROOT, '.tools')
export const VENV_PYTHON = join(TOOLS_DIR, 'venv/bin/python')
export const PY_TOOLS = join(ROOT, 'scripts/voice/voice_tools.py')
export const DOCS_AUDIO_DIR = join(ROOT, 'docs/audio')

/* ------------------------------------------------------------------ text */

export const STRESS_MARK = '\u0301'
const STRESS_RE = /\u0301/g
const TAG_RE = /\[[^\]]*\]/g

export const stripStress = (s) => s.replace(STRESS_RE, '')
export const stripTags = (s) => s.replace(TAG_RE, ' ').replace(/\s+/g, ' ').trim()
export const hasTags = (s) => /[[\]]/.test(s)

/** Displayed text of a line: cue texts joined by a single space. */
export const displayText = (line) => line.cues.map((c) => c.text).join(' ')

/** TTS spelling of a cue (stress marks allowed, never tags). */
export const cueTts = (cue) => stripTags(cue.tts ?? cue.text)

/**
 * Words espeak-ng / TTS engines stress wrongly and that script.json does not
 * (yet) mark in `tts`. Applied by the Piper placeholder; the ElevenLabs dry run
 * only warns so script.json stays the single source of truth.
 */
export const STRESS_FIXES = [
  { re: /(^|[^\p{L}])велика(?=[^\p{L}\u0301]|$)/gu, to: '$1велика́', note: 'велика́ (short adj.), espeak: вели́ка' },
  { re: /(^|[^\p{L}])что-то(?=[^\p{L}\u0301]|$)/gu, to: '$1что́-то', note: 'что́-то, espeak: что-то́' },
  { re: /(^|[^\p{L}])на счету(?=[^\p{L}\u0301]|$)/gu, to: '$1на счету́', note: 'на счету́, espeak: на счёту' },
  { re: /(^|[^\p{L}])стоит(?= выходить)/gu, to: '$1сто́ит', note: 'сто́ит (is worth), espeak: стои́т' },
]

export function applyStressFixes(text) {
  let out = text
  const applied = []
  for (const f of STRESS_FIXES) {
    f.re.lastIndex = 0
    if (f.re.test(out)) {
      f.re.lastIndex = 0
      out = out.replace(f.re, f.to)
      applied.push(f.note)
    }
  }
  return { text: out, applied }
}

/**
 * Normalisation used for comparisons (WER, alignment matching):
 * lower case, ё→е, no stress marks / tags / punctuation, single spaces.
 */
export function normalizeForCompare(s) {
  return stripTags(stripStress(s.normalize('NFD')).normalize('NFC'))
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[-‐‑–—]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export const words = (s) => (normalizeForCompare(s) || '').split(' ').filter(Boolean)

/** Word-level edit distance details (Levenshtein). */
export function wordErrors(refWords, hypWords) {
  const n = refWords.length
  const m = hypWords.length
  const d = Array.from({ length: n + 1 }, (_, i) => {
    const row = new Array(m + 1).fill(0)
    row[0] = i
    return row
  })
  for (let j = 0; j <= m; j++) d[0][j] = j
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const sub = d[i - 1][j - 1] + (refWords[i - 1] === hypWords[j - 1] ? 0 : 1)
      d[i][j] = Math.min(sub, d[i - 1][j] + 1, d[i][j - 1] + 1)
    }
  }
  // Backtrack to list the differing words.
  const diffs = []
  let i = n
  let j = m
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (refWords[i - 1] === hypWords[j - 1] ? 0 : 1)) {
      if (refWords[i - 1] !== hypWords[j - 1]) diffs.unshift(`${refWords[i - 1]}→${hypWords[j - 1]}`)
      i--
      j--
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      diffs.unshift(`-${refWords[i - 1]}`)
      i--
    } else {
      diffs.unshift(`+${hypWords[j - 1]}`)
      j--
    }
  }
  return { distance: d[n][m], wer: n ? d[n][m] / n : m ? 1 : 0, diffs }
}

/* --------------------------------------------------------------- hashing */

/** JSON.stringify with sorted object keys (stable hashes). */
export function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v)
}

export const sha1 = (v) => createHash('sha1').update(typeof v === 'string' ? v : stableStringify(v)).digest('hex')

/** Deterministic pseudo-random number in [-1, 1) from a string key. */
export function jitter(key) {
  const h = createHash('sha1').update(key).digest()
  return h.readUInt32BE(0) / 2 ** 31 - 1
}

export const round3 = (x) => Math.round(x * 1000) / 1000

/* ---------------------------------------------------------- script / io */

export async function loadScript() {
  const script = JSON.parse(await readFile(SCRIPT_PATH, 'utf8'))
  validateScript(script)
  return script
}

export function validateScript(script) {
  const ids = new Set()
  for (const line of script.lines) {
    if (ids.has(line.id)) throw new Error(`Duplicate line id ${line.id}`)
    ids.add(line.id)
    if (!line.cues?.length) throw new Error(`${line.id}: no cues`)
    line.cues.forEach((c, i) => {
      if (hasTags(c.text)) throw new Error(`${line.id} cue ${i}: display text contains [tags]`)
      if (c.text.includes(STRESS_MARK)) throw new Error(`${line.id} cue ${i}: display text contains a stress mark`)
      if (c.tts && stripStress(c.tts) !== c.text) {
        console.warn(`warn: ${line.id} cue ${i}: tts differs from text beyond stress marks`)
      }
      if (typeof c.pause !== 'number' || c.pause < 0) throw new Error(`${line.id} cue ${i}: bad pause`)
    })
  }
}

export function emptyManifest() {
  return { version: 1, provider: 'none', placeholder: true, generatedAt: '', clips: {} }
}

export async function readManifest() {
  if (!existsSync(MANIFEST_PATH)) return emptyManifest()
  try {
    const m = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'))
    if (m?.version !== 1 || typeof m.clips !== 'object') return emptyManifest()
    return m
  } catch {
    return emptyManifest()
  }
}

/** Writes the manifest with clips in script order; derives top-level fields. */
export async function writeManifest(manifest, script) {
  const order = script.lines.map((l) => l.id)
  const clips = {}
  for (const id of order) if (manifest.clips[id]) clips[id] = manifest.clips[id]
  const list = Object.values(clips)
  const provider = list.some((c) => c.provider === 'elevenlabs')
    ? 'elevenlabs'
    : list.some((c) => c.provider === 'piper-placeholder')
      ? 'piper-placeholder'
      : 'none'
  const out = {
    version: 1,
    provider,
    // Honest flag for the UI: true while ANY clip is a placeholder (or missing).
    placeholder: list.length < order.length || list.some((c) => c.provider !== 'elevenlabs'),
    generatedAt: new Date().toISOString(),
    clips,
  }
  await mkdir(dirname(MANIFEST_PATH), { recursive: true })
  const tmp = `${MANIFEST_PATH}.tmp`
  await writeFile(tmp, `${JSON.stringify(out, null, 2)}\n`)
  await rename(tmp, MANIFEST_PATH)
  return out
}

/** Refreshes display-only fields of an existing clip from the script line. */
export function refreshDisplayFields(clip, line) {
  return {
    ...clip,
    kind: line.kind,
    block: line.block,
    text: displayText(line),
    emotion: line.emotion.ru,
    routeAnchor: line.routeAnchor,
    cues: clip.cues.map((c) => ({ ...c, text: line.cues[c.index]?.text ?? c.text })),
  }
}

/* ------------------------------------------------------------ processes */

/** Runs a command, resolves { stdout, stderr }; rejects on non-zero exit. */
export function run(cmd, args, { input, quiet = true } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    const out = []
    const err = []
    child.stdout.on('data', (d) => out.push(d))
    child.stderr.on('data', (d) => {
      err.push(d)
      if (!quiet) process.stderr.write(d)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      const stdout = Buffer.concat(out).toString('utf8')
      const stderr = Buffer.concat(err).toString('utf8')
      if (code === 0) resolvePromise({ stdout, stderr })
      else reject(new Error(`${cmd} ${args.slice(0, 4).join(' ')}… exited ${code}\n${stderr.slice(-2000)}`))
    })
    if (input !== undefined) child.stdin.end(input)
    else child.stdin.end()
  })
}

/** Runs voice_tools.py <command> with a JSON spec; returns parsed stdout JSON. */
export async function runPy(command, spec, tmpDir, { quiet = false } = {}) {
  if (!existsSync(VENV_PYTHON)) {
    throw new Error(`Python venv not found at ${VENV_PYTHON} (see docs/audio/voice.md)`)
  }
  const specPath = join(tmpDir, `${command}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
  await writeFile(specPath, JSON.stringify(spec))
  const { stdout } = await run(VENV_PYTHON, ['-I', PY_TOOLS, command, specPath], { quiet })
  return JSON.parse(stdout)
}

export async function ffprobeDuration(file) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file,
  ])
  return Number.parseFloat(stdout.trim())
}

/** EBU R128 integrated loudness + true peak measured by ffmpeg. */
export async function ffmpegLoudness(file) {
  const { stderr } = await run('ffmpeg', [
    '-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-',
  ])
  const summary = stderr.slice(stderr.lastIndexOf('Summary:'))
  const num = (re) => {
    const m = summary.match(re)
    return m ? Number.parseFloat(m[1]) : Number.NaN
  }
  return { lufs: num(/I:\s+(-?[\d.]+|-inf) LUFS/), truePeak: num(/Peak:\s+(-?[\d.]+|-inf) dBFS/) }
}

/** Maps items with limited concurrency. */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return results
}

/* ---------------------------------------------------------------- CLI */

/** Parses --flag and --key=value arguments. */
export function parseArgs(argv = process.argv.slice(2)) {
  const args = { _: [] }
  for (const a of argv) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/)
    if (m) args[m[1]] = m[2] === undefined ? true : m[2]
    else args._.push(a)
  }
  return args
}

export function onlyFilter(args) {
  if (!args.only || args.only === true) return null
  return new Set(String(args.only).split(',').map((s) => s.trim()).filter(Boolean))
}

/** Tiny .env parser: KEY=value lines, # comments, optional quotes. */
export async function loadEnvLocal(file = join(ROOT, '.env.local')) {
  const env = {}
  if (!existsSync(file)) return env
  for (const raw of (await readFile(file, 'utf8')).split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    let value = m[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    } else {
      value = value.replace(/\s+#.*$/, '')
    }
    env[m[1]] = value
  }
  return env
}

export function blockTotals(manifest, script) {
  const totals = {}
  for (const line of script.lines) {
    const clip = manifest.clips[line.id]
    if (!clip) continue
    const key = line.block ?? 'authored'
    totals[key] = (totals[key] ?? 0) + clip.duration
  }
  return totals
}

/* ------------------------------------------------------------------ ASR */

export const WHISPER_DIR = join(TOOLS_DIR, 'whisper-models')
export const DEFAULT_ASR_MODEL = 'large-v3-turbo'

/** True when faster-whisper is importable from the tools venv. */
export async function asrAvailable() {
  if (!existsSync(VENV_PYTHON)) return false
  try {
    await run(VENV_PYTHON, ['-I', '-c', 'import faster_whisper'])
    return true
  } catch {
    return false
  }
}

// Whisper's well-known Russian hallucinations on silence (YouTube subtitle credits).
const ASR_HALLUCINATIONS = [
  /продолжение следует\.*/giu,
  /субтитры (?:сделал|создавал|подготовил)[^.]*\.?/giu,
  /редактор субтитров[^.]*\.?/giu,
  /спасибо за просмотр\.?/giu,
  /подписывайтесь на канал\.?/giu,
]

export function cleanAsrText(text) {
  let out = text
  const removed = []
  for (const re of ASR_HALLUCINATIONS) {
    out = out.replace(re, (m) => {
      removed.push(m.trim())
      return ' '
    })
  }
  return { text: out.replace(/\s+/g, ' ').trim(), removed }
}

function charSimilarity(a, b) {
  const n = a.length
  const m = b.length
  if (!n || !m) return 0
  let prev = Array.from({ length: m + 1 }, (_, j) => j)
  for (let i = 1; i <= n; i++) {
    const cur = [i]
    for (let j = 1; j <= m; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return 1 - prev[m] / Math.max(n, m)
}

/**
 * Compares an ASR transcript with the expected text.
 * lastWordMissing: the final expected word has no close match (≥ 0.6 char
 * similarity) among the last three recognised words, a hint of a cut word.
 */
export function scoreTranscript(expected, transcript) {
  const { text, removed } = cleanAsrText(transcript)
  const ref = words(expected)
  const hyp = words(text)
  const e = wordErrors(ref, hyp)
  const last = ref.at(-1) ?? ''
  const tail = hyp.slice(-3)
  const lastWordMissing = Boolean(last) && !tail.some((w) => charSimilarity(w, last) >= 0.6)
  return { wer: e.wer, distance: e.distance, refWords: ref.length, diffs: e.diffs, lastWordMissing, removed, hyp: text }
}
