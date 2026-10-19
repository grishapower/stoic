#!/usr/bin/env node
// Voice audition: the same excerpt of the letter read by several candidate
// voices (ElevenLabs eleven_v4, Russian), plus Voice Design previews of a
// voice made from a description. Writes a listening page:
//   public/auditions/index.html  →  http://localhost:5173/auditions/index.html
//
//   node scripts/voice/audition.mjs --dry-run [--set=elders]          # texts, chars, no requests
//   node scripts/voice/audition.mjs --yes --set=elders [--max-chars=6000] [--only=a,b] [--design]
//   node scripts/voice/audition.mjs --set=elders --page=a,b,c          # rebuild the page from existing files (free)
//
// Billing safety: planned characters are checked against --max-chars before
// anything is sent; the subscription counter is read before and after, and
// every paid call is appended to assets-src/voice/elevenlabs-ledger.json.
// Library voices are added to "My Voices" (free, uses a voice slot).

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { api, buildTtsText } from './generate-elevenlabs.mjs'
import { loadEnvLocal, loadScript, parseArgs, PUBLIC_DIR, ROOT, stripStress, stripTags } from './lib.mjs'

const MODEL = 'eleven_v4'
const OUTPUT = 'mp3_44100_192'
const AUDITIONS_DIR = join(PUBLIC_DIR, 'auditions')
const LEDGER = join(ROOT, 'assets-src/voice/elevenlabs-ledger.json')

/** Excerpt: warmth, a quiet truth, sincerity, self-irony, a wry sigh. */
const EXCERPT_LINES = ['A-greet-1', 'L09', 'L10', 'L13', 'L16']

/** Round 1: native Russian voices from the shared library, verified with eleven_v4 (all middle-aged). */
const ROUND1 = [
  { slug: 'stanislav', name: 'Stanislav — Deep, Empathetic and Warm', id: 'ogi2DyUAKJb7CEdqqvlU', owner: '152a4c8bb687587afe756eb1540b77ffce8f93be3cbcb3050243e7d1e34739e7' },
  { slug: 'sergey', name: 'Sergey — Rich, Engaging and Captivating', id: 'XuEV9VY3VUASYgJVNBh0', owner: 'b5842eea911f8fcd7045f63e6e54c205273b36c420f1c2437c6ebd326059793e' },
  { slug: 'nester', name: 'Nester Surovy — Gravelly yet Refined', id: 'pM78bgjPVk0JXtaEnFoj', owner: '64fab69cf451fccfdb114f268c0886bce94218d590e46d728f8e389f0b2a746c' },
  { slug: 'ivan', name: 'Ivan — Meditative, Calm and Relaxing', id: '1qd9R09Ljlx9V1Ok0t5S', owner: 'fd70bbf7704e49ac5d618cdfbbd19ede69879b4092835a0564cb63ad869bf136' },
  { slug: 'marat', name: 'Marat — Warm, Calm and Friendly', id: 'vQxSi2EuaRWwBw3nn6dK', owner: '77358e36d967efc4b39d5ecf0e5d338649bf0f5570411caf64734e950f51e9dd' },
  { slug: 'vasko', name: 'VASKO — Deep, Warm and Pleasant', id: 'Vl27Cllkuw8BhyPqus2n', owner: '82c9c5cee6d85b0bf7f96279eb3a4eee2e037ff4526a9d1ab060ecb50758f7a8' },
]

/**
 * Round 2 ("older, wiser"): genuinely old voices whose Russian ElevenLabs has
 * verified as standard/Moscow accent, plus the most mature native narrators.
 */
const ELDERS = [
  { slug: 'sage', name: 'Matthew Schmitz — Ancient Sage (пожилой, «средневековый философ»)', id: 'HAvvFKatz0uu0Fv55Riy', owner: '1bdf478ac5e1a81b0b8423faadde277a29cb25195ed2c86adcb0622464c9b930' },
  { slug: 'joe', name: 'Grandfather Joe — Gentle, Warm & Wise (пожилой)', id: '0lp4RIz96WD1RUtvEu3Q', owner: '34c483aaa9f266050bb548d8a3495b18c266f138401947fae23df13770cb6f7b' },
  { slug: 'sully', name: 'Sully — Mature, Deep and Intriguing (пожилой, московский выговор)', id: 'wAGzRVkxKEs8La0lmdrE', owner: '4c70de23dafb03ed39c93f321b71fbf03de8d7b000ebcf26d0b75777ff704efb' },
  { slug: 'adam', name: 'Adam — Elder Storyteller (пожилой, «мудрый историк»)', id: 'U5UjeJMsOvyhYhXfZdvZ', owner: '751e6916d6bff1264667b343c7f8e26abae82993b855c1d5aef615063d60d0d3' },
  { slug: 'gregory', name: 'Gregory Grumble — Warm, Gravelly (пожилой)', id: '8TMmdpPgqHKvDOGYP2lN', owner: '4d49e1f6a4608f4702abcb9914a565b56353fa58abba4b23a34b647e549c3cd6' },
  { slug: 'cornelius', name: 'Cornelius — Wise Old Sage (пожилой)', id: '6sFKzaJr574YWVu4UuJF', owner: 'a72a436938f959ab051e6a27b035db67a4b75945b4d6e8c86ed40e6e946a2e11' },
  { slug: 'arcad', name: 'Arcad — Calm, Deep, Historical (русский чтец)', id: 'kuR1PV7xDOsP38QMSEvD', owner: '2e19734d31f064ad2a424d1b09009f1643efcb711405e898566e80665cf42207' },
  { slug: 'nazarov', name: 'Ivan Nazarov — Audiobook Narrator (русский чтец)', id: 'lxY8Pn0yWs1Ve9rBceah', owner: '39942dea4435a598a933090ff3592d827e2bce32434d19d061c32bb7323f0275' },
]

const SETS = { round1: ROUND1, elders: ELDERS }

const DESIGN_PROMPT =
  'A Roman Stoic philosopher in his early sixties, speaking native Russian. Low, warm baritone with a slight natural rasp of age; ' +
  'unhurried, thoughtful and intimate, like a wise old friend reading his own letter aloud at sunset by the sea. ' +
  'Gentle irony, quiet authority, never theatrical or announcer-like. Clear diction, soft breath, natural pauses. Close, dry studio recording.'

const SETTINGS = { stability: 0.45, similarity_boost: 0.8 }

async function subscription(key) {
  const res = await api('/v1/user/subscription', { key })
  const s = await res.json()
  return { used: s.character_count, limit: s.character_limit }
}

async function ledger(entry) {
  const list = existsSync(LEDGER) ? JSON.parse(await readFile(LEDGER, 'utf8')) : { budgetChars: 25000, approved: '2026-10-19', entries: [] }
  list.entries.push({ at: new Date().toISOString(), ...entry })
  list.spentChars = list.entries.reduce((s, e) => s + (e.chars ?? 0), 0)
  await mkdir(join(ROOT, 'assets-src/voice'), { recursive: true })
  await writeFile(LEDGER, JSON.stringify(list, null, 2) + '\n')
  return list
}

async function myVoiceIds(key) {
  const res = await api('/v2/voices', { key, query: { page_size: 100 } })
  const j = await res.json()
  return new Map((j.voices ?? []).map((v) => [v.voice_id, v.name]))
}

function page(items, excerpt, others = []) {
  const row = (it) => `<section><h2>${it.title}</h2><p class="meta">${it.meta}</p><audio controls preload="none" src="${it.file}"></audio></section>`
  const rows = items.map(row).join('\n') + (others.length ? `\n<h3>Ещё варианты</h3>\n${others.map(row).join('\n')}` : '')
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Голос Сенеки — прослушивание</title>
<style>
:root{color-scheme:dark}body{margin:0;background:#15110d;color:#efe5d2;font:16px/1.5 Georgia,serif}
main{max-width:760px;margin:0 auto;padding:32px 16px 64px}h1{font-weight:400;font-size:30px;margin:0 0 6px}
.lead{color:#c8b896;margin:0 0 24px}blockquote{margin:0 0 28px;padding:14px 18px;border-left:2px solid #6b5a40;color:#d8c8a8;font-style:italic}
section{padding:16px 0;border-top:1px solid #2c241b}h3{font-weight:400;color:#a8987c;margin:36px 0 4px;font-size:16px;letter-spacing:.08em;text-transform:uppercase}h2{font-size:19px;font-weight:500;margin:0}.meta{color:#a8987c;font:13px/1.4 system-ui,sans-serif;margin:4px 0 10px}
audio{width:100%}
</style></head><body><main>
<h1>Голос Сенеки — прослушивание</h1>
<p class="lead">Один и тот же отрывок, модель eleven_v4. Слушайте в наушниках; отметьте 1–2 голоса, которые ближе всего к Сенеке.</p>
<blockquote>${excerpt}</blockquote>
${rows}
</main></body></html>
`
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const env = { ...(await loadEnvLocal()), ...process.env }
  const key = env.ELEVENLABS_API_KEY
  const script = await loadScript()
  const byId = new Map(script.lines.map((l) => [l.id, l]))
  const tts = EXCERPT_LINES.map((id) => buildTtsText(byId.get(id))).join(' [pause] ')
  const plain = EXCERPT_LINES.map((id) => stripStress(stripTags(buildTtsText(byId.get(id))))).join(' ')
  const set = typeof args.set === 'string' ? args.set : 'round1'
  const CANDIDATES = SETS[set]
  if (!CANDIDATES) throw new Error(`unknown --set=${set}`)
  const OUT_DIR = join(AUDITIONS_DIR, set)
  const only = typeof args.only === 'string' ? new Set(args.only.split(',')) : null
  const voices = CANDIDATES.filter((c) => !only || only.has(c.slug))
  const design = !!args.design && !only
  // Free: rebuild the listening page from files already generated.
  if (typeof args.page === 'string') {
    const pick = args.page.split(',')
    const entry = (v) => ({ title: v.name, meta: `библиотека ElevenLabs · ${v.id}`, file: `${v.slug}.mp3` })
    const items = pick.map((slug) => {
      const v = CANDIDATES.find((c) => c.slug === slug)
      if (!v || !existsSync(join(OUT_DIR, `${slug}.mp3`))) throw new Error(`no audition for ${slug}`)
      return entry(v)
    })
    const others = CANDIDATES.filter((c) => !pick.includes(c.slug) && existsSync(join(OUT_DIR, `${c.slug}.mp3`))).map(entry)
    await writeFile(join(OUT_DIR, 'index.html'), page(items, plain, others))
    console.log(`Listen: http://localhost:5173/auditions/${set}/index.html`)
    return
  }
  const maxChars = Number(args['max-chars'] ?? 6000)
  // Voice Design bills the preview text (assumed once per preview — counted pessimistically ×3).
  const planned = voices.length * tts.length + (design ? plain.length * 3 : 0)

  console.log(`Excerpt (${tts.length} chars sent per voice):\n  ${tts}\n`)
  console.log(`Voices: ${voices.map((v) => v.slug).join(', ')}${design ? ' + Voice Design (3 previews)' : ''}`)
  console.log(`Planned ≤ ${planned} characters (cap --max-chars=${maxChars})`)
  if (planned > maxChars) throw new Error(`planned ${planned} > cap ${maxChars}`)
  if (args['dry-run']) return
  if (!key) throw new Error('ELEVENLABS_API_KEY missing in .env.local')
  if (!args.yes) throw new Error('add --yes to spend characters')

  await mkdir(OUT_DIR, { recursive: true })
  const before = await subscription(key)
  console.log(`Subscription: ${before.used}/${before.limit} used before`)
  const mine = await myVoiceIds(key)
  const items = []

  for (const v of voices) {
    if (!mine.has(v.id)) {
      // Free: copies the shared voice into "My Voices" (one slot).
      await api(`/v1/voices/add/${v.owner}/${v.id}`, { key, method: 'POST', body: { new_name: `Seneca audition — ${v.slug}` } })
      console.log(`  added ${v.slug} to My Voices`)
    }
    const res = await api(`/v1/text-to-speech/${v.id}`, {
      key,
      method: 'POST',
      query: { output_format: OUTPUT },
      body: { text: tts, model_id: MODEL, language_code: 'ru', voice_settings: SETTINGS, seed: 1801 },
    })
    const cost = Number(res.headers.get('character-cost') ?? tts.length)
    const file = `${v.slug}.mp3`
    await writeFile(join(OUT_DIR, file), Buffer.from(await res.arrayBuffer()))
    await ledger({ kind: 'audition', voice: v.slug, voiceId: v.id, model: MODEL, chars: cost })
    items.push({ title: v.name, meta: `библиотека ElevenLabs · ${v.id} · ${cost} символов`, file })
    console.log(`  ${v.slug}: ${cost} chars → public/auditions/${set}/${file}`)
  }

  if (design) {
    const res = await api('/v1/text-to-voice/design', {
      key,
      method: 'POST',
      query: { output_format: OUTPUT },
      body: { voice_description: DESIGN_PROMPT, model_id: 'eleven_ttv_v3', text: plain, guidance_scale: 4, loudness: 0.5, seed: 62 },
    })
    const j = await res.json()
    const ids = []
    for (const [i, p] of (j.previews ?? []).entries()) {
      const file = `design-${i + 1}.mp3`
      await writeFile(join(OUT_DIR, file), Buffer.from(p.audio_base_64, 'base64'))
      ids.push({ file, generated_voice_id: p.generated_voice_id, duration: p.duration_secs })
      items.push({ title: `Голос по описанию — вариант ${i + 1}`, meta: `Voice Design (eleven_ttv_v3) · ${p.duration_secs?.toFixed?.(1) ?? '?'} с`, file })
    }
    await writeFile(join(OUT_DIR, 'design.json'), JSON.stringify({ prompt: DESIGN_PROMPT, previews: ids }, null, 2) + '\n')
    console.log(`  design: ${ids.length} previews`)
  }

  const after = await subscription(key)
  const used = after.used - before.used
  if (design) await ledger({ kind: 'voice-design', chars: Math.max(0, used - items.filter((i) => !i.file.startsWith('design')).reduce((s, i) => s + Number(i.meta.match(/(\d+) символов/)?.[1] ?? 0), 0)) })
  await writeFile(join(OUT_DIR, 'index.html'), page(items, plain))
  console.log(`\nSubscription: ${after.used}/${after.limit} (this run: ${used} chars)`)
  console.log(`Listen: http://localhost:5173/auditions/${set}/index.html`)
}

main().catch((e) => {
  console.error(e.message ?? e)
  process.exit(1)
})
