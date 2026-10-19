# Voice-over pipeline

Seneca's lines live in `src/data/narration/script.json` (single source of truth).
The scripts in `scripts/voice/` turn them into audio clips in
`public/assets/audio/voice/<lineId>.mp3` plus `src/data/generated/voice-manifest.json`,
which the game reads through `src/data/narration/index.ts`.

| Command | What it does | Cost |
|---|---|---|
| `npm run voice:placeholder` | Offline placeholder voice (Piper, voice *denis*) | free |
| `npm run voice:elevenlabs` | Production voice via ElevenLabs (`eleven_v4`). Dry run without a key | paid per character |
| `npm run voice:verify` | QA of whatever is in the manifest → `docs/audio/voice-qa.md` | free |

All three accept `--only=L01,L02`. Both generators skip lines whose hash (sha1 of
the TTS text + generation settings) is unchanged and whose file exists; `--force`
regenerates. Display-only edits are refreshed in the manifest without regenerating.
Clips of lines removed from `script.json` are pruned.

## Requirements

- Node 22 (ESM, no npm dependencies), `ffmpeg`/`ffprobe` with libmp3lame on `PATH`.
- Python venv `.tools/venv` (git-ignored) with `piper-tts` 1.8.0 and numpy for the
  placeholder and the DSP helper `scripts/voice/voice_tools.py`. Optional:
  `faster-whisper` (installed, 1.2.1) for ASR take selection and QA.
  - PyAV 19 is incompatible with faster-whisper 1.2.1's file loader, so the helper
    decodes audio with ffmpeg and passes numpy arrays (no action needed).
  - ASR model `large-v3-turbo` (int8, CPU) is cached in `.tools/whisper-models`
    (~1.6 GB, downloaded on first use). `--asr-model=small` is a lighter option.
- Piper voices in `.tools/piper-voices/` (`ru_RU-denis-medium.onnx` + `.json`).

Setup from scratch:

```sh
python3 -m venv .tools/venv
.tools/venv/bin/pip install piper-tts==1.8.0 faster-whisper
# voices: https://huggingface.co/rhasspy/piper-voices/tree/main/ru/ru_RU/denis/medium
```

## Manifest format

`src/data/generated/voice-manifest.json` matches `VoiceManifest` in
`src/data/narration/types.ts`:

```jsonc
{
  "version": 1,
  "provider": "piper-placeholder",   // "elevenlabs" as soon as any clip is from ElevenLabs
  "placeholder": true,                // true while ANY clip is not ElevenLabs (or missing) — show it in the UI
  "generatedAt": "…",
  "clips": {
    "L02": {
      "id": "L02", "kind": "letter", "block": "b1",
      "file": "assets/audio/voice/L02.mp3",       // relative to the site root, no leading slash
      "duration": 11.96,                           // seconds (exact PCM length; the MP3 decodes to the same length)
      "text": "Поступай так, мой Луцилий: …",       // displayed text = cues joined by one space
      "ttsText": "Поступай так, мой Луци́лий: …",   // exactly what the engine received
      "emotion": "доброжелательное наставление",
      "routeAnchor": "garden",
      "cues": [ { "index": 0, "text": "…", "start": 0.1, "end": 4.39 }, … ],
      "provider": "piper-placeholder", "voice": "piper:ru_RU-denis-medium",
      "model": "piper-tts 1.8.0 (VITS, espeak-ng phonemes)",
      "hash": "…", "generatedAt": "…"
    }
  }
}
```

Clip layout (both providers): 0.10 s lead-in → cue 0 → exactly `cue.pause` s of
silence → cue 1 → … → last cue → 0.25 s tail. `start`/`end` are the cue's speech
(including ~25 ms before onset and ~60 ms after offset), 3 decimals. The last cue's
`pause` is replaced by the fixed tail; the game adds `postPause` itself.

Audio spec: mono, 44.1 kHz, MP3 LAME VBR V1 (≈ 95–100 kbps on this speech),
−18 LUFS integrated (±0.1), true peak ≤ −2.1 dBTP (limit −1.5). LAME's CBR/ABR modes apply a
flat 0.95 gain (−0.45 dB), so VBR is used to keep the loudness exact. The MP3 has
a LAME/Xing header, so ffmpeg and browsers trim the encoder delay (verified: no
offset after decoding with ffmpeg).

## Placeholder voice (Piper)

`scripts/voice/generate-placeholder.mjs`, options:
`--force --only=… --voice=denis|dmitri --pitch-offset=<st> --takes=N --asr-model=… --asr-isolated --keep-temp --dry-run`.
A full run (30 lines × 3 takes, incl. ASR) takes ≈ 6 min on an M-series CPU; cached runs are instant.

Per cue:

1. Text = `cue.tts ?? cue.text` with `[tags]` removed. **Stress marks are kept**:
   espeak-ng (inside piper-tts) honours U+0301, e.g. `бо́льшая` → `bˈoɭʃʌja`, while plain
   `большая` → `bʌɭʃˈɑja`. A small lexicon (`STRESS_FIXES` in `lib.mjs`) also fixes
   espeak errors in words that have no `tts` yet: велика́, что́-то, на счету́, сто́ит.
   Two Piper-only phoneme overrides (`PIPER_PHONEME_FIXES`) fix consistent ASR
   failures: cue-initial «Что же» → `[[ʃːtˈoʒy]]` (Piper clips the initial /ʂ/, heard
   as «Кто же») and cue-initial «Ведь,» → `[[vʲˈetʲ]],` (heard as «Весь»). Both went
   from 0/4 to 4/4 correct in A/B tests. `ttsText` in the manifest shows them.
2. Piper synthesis with per-emotion settings (`PRESETS` in the script):
   reflective/quiet lines tempo 1.20–1.27, warm/encouraging 1.09–1.14, noise_scale
   0.58–0.70, noise_w 0.70–0.82, deterministic ±2 % tempo and ±0.25 st pitch jitter
   per cue, final cue of a line 3 % slower. Multi-sentence cues get a 0.28–0.33 s gap.
3. **Best of 3 takes** (VITS sampling noise differs per take): each take is
   transcribed with faster-whisper and the take with the lowest WER (and the final
   word present) is used. Takes are packed several per 30-s Whisper window, ordered
   take-major so a window never contains the same sentence twice (Whisper skips
   verbatim repeats). Falls back to 1 take without faster-whisper. In the full run
   the selection replaced ≈ 1 in 5 cues whose first take was garbled (WER 0.4–1.0).
   `--asr-isolated` scores each take in its own window, which is slower but matches
   `voice:verify` better on very short lines. It was used for L01, L10 and L20 with
   `--takes=6`.
4. Pitch-down by resampling (`asetrate` + `aresample`), −3.0 … −3.6 st by emotion.
   The tempo change of resampling is pre-compensated in Piper's `length_scale`, so
   no `atempo` (WSOLA) is needed and there are no time-stretch artefacts.
5. Warmth EQ: high-pass 70 Hz, +2.5 dB @ 190 Hz, −1 dB @ 480 Hz, −2 dB @ 3.3 kHz
   (de-harsh), −3 dB high shelf @ 6.5 kHz, low-pass 9.8 kHz.
6. Edge trim (10 ms RMS envelope, −42 dB relative to the cue's peak), 4/12 ms fades.

Per line: concatenate with exact pauses, BS.1770-4 loudness (numpy, cross-checked
against ffmpeg `ebur128`: identical to 0.1 LU) → gain to −18 LUFS → zero-latency
look-ahead peak limiter (only when the 4× oversampled true peak exceeds −2.1 dBTP;
typically 0–2 dB of peak reduction on a few plosives) → MP3.

### Pitch choice (F0)

Measured with a YIN-style estimator (`voice_tools.py analyze`, 10 ms frames,
voiced frames only). Raw denis is ≈ 147 Hz median on long text, but ≈ 150–160 Hz on
clause-length cues, because every cue restarts the declination. Iterations:

| Shift (avg) | Median of clip medians | Corpus WER |
|---|---|---|
| −2.0 st (brief's upper bound) | ≈ 140 Hz | 0.12 (8-line sample, 1 take) |
| −2.8 st | 134.3 Hz | 0.056 |
| **−3.3 st (chosen)** | **128.6 Hz** (clips 114–164 Hz, p10–p90 spread ≈ 5–7 st) | 0.060 |

So the presets go beyond the suggested 1–2 st to reach the 115–130 Hz target. ASR
shows no intelligibility cost. Tape-style shifting also lowers formants by ~17 %,
which reads as a larger speaker. It has none of the chipmunk effect (that only
happens upwards) or time-stretch artefacts (there's no atempo). The p10–p90 F0 range
of 5–7 semitones per clip keeps it from sounding monotone. For a gentler shift run
`npm run voice:placeholder -- --force --pitch-offset=1.3` (≈ −2 st, ≈ 138 Hz).
Speaking rate: 12.5–14.7 characters/s inside cues (reflective lines slower), plus
the script's pauses.

### Honest limitations of the placeholder

- It is a 2023-era medium VITS voice trained on a young-ish male reader. It cannot
  act: the `direction` notes, irony, smiles and sighs are not performed; intonation
  is the generic espeak/VITS prosody, phrase by phrase.
- Pitch-down + EQ make it deeper, not older: no breathiness, no vocal texture.
- Pronunciation is espeak-ng's G2P. Wrong stress is fixed only where marked
  (`tts`) or in `STRESS_FIXES`. Some words come out mumbled. Residual ASR flags
  after all fixes (see `voice-qa.md`), none of which could be fixed with spellings,
  phoneme overrides, punctuation or carrier phrases in A/B tests:
  - **L01** «Сенека шлёт»: Piper gives the utterance-initial soft /sʲ/ a plosive
    onset, so it's heard as «Тенека/Синека» and fused with «шлёт». Seneca's own name
    is the most important word to get right in production.
  - **L10** «Всё, Луцилий, не наше»: a vowel-like glide after the comma pause before
    the dark /ɫ/ («Всё от Луцилии»), and «наше;» sometimes sounds like «нашит».
  - **A-table** «сговорчивее»: a rare word, mumbled (heard as «слезговочили»).
  - Lower-impact ASR misses (WER ≤ 0.24): «исподволь», «вырывают» (L03); endings
    such as «самое малое» heard as «самые малые» (L19), which is genuinely ambiguous
    in reduced speech; «ускользало».
- Whisper on CPU (int8) is not perfectly deterministic: the same clip can score
  differently between runs (L01: 0.20 vs 0.60).
- VITS output is random per run; regenerating changes the takes.
- The UI must keep showing that the voice is a placeholder (`manifest.placeholder`).

## Licences

- **piper-tts 1.8.0** (PyPI) is the `OHF-Voice/piper1-gpl` fork, **GPL-3.0-or-later**,
  and bundles espeak-ng (GPL-3.0). It is a build-time tool only. It lives in the
  git-ignored `.tools/` and is never shipped with the game. The GPL covers the
  program, not its output: audio generated with it is not a derivative work of the
  code (GPL FAQ: the output of a program is not covered unless it copies parts of the
  program).
- **Voice models** `ru_RU-denis-medium` / `ru_RU-dmitri-medium` (rhasspy/piper-voices):
  datasets **CC0** (OHF-Voice/voice-datasets), but both were **fine-tuned from the
  en_US *lessac* medium voice**. That base model was trained on the Blizzard 2013
  Lessac corpus, whose licence grants a non-transferable licence for **research
  purposes only**, explicitly excluding "any commercial purpose, including the
  development, marketing, commercialisation, sale or licencing" of speech products.
  The licence does not address models trained on the data, so whether denis/dmitri
  inherit the restriction is unresolved. **Treat Piper audio as prototype/internal
  only and replace it (ElevenLabs or a human actor) before any commercial release.**
- **faster-whisper** (MIT) with Whisper weights (MIT) are used for QA only.
- **ElevenLabs** output: commercial use is governed by your ElevenLabs plan
  (paid plans include a commercial licence; the free tier requires attribution and
  is non-commercial). Check the plan before release.

## Pronunciation notes

What was verified (espeak-ng phonemes from piper-tts + Whisper recognition), and what wasn't:

| Word | Intended | Status |
|---|---|---|
| Луци́лий / Луци́лию | stress on «ци» (Latin Lūcī́lius) | espeak gives `ɭutsˈyɭʲij` with *and* without the mark; Whisper writes «Луцилий» consistently. Not checked by a native listener. |
| Сене́ка | stress on «не» | espeak `sʲinʲˈeka` ✓ |
| бо́льшая (L05) | «бо́льшая» = greater part | needs the mark; espeak honours it ✓ |
| посты́дная, небре́жности, о́бразом, ху́дшее, сгово́рчивее, Признаю́сь | as marked | espeak output matches the marks ✓ |
| велика́ (L12), что́-то (L12), на счету́ (L14), сто́ит (A-wait-2) | as written here | **espeak gets these wrong** (вели́ка, что-то́, на счёту, стои́т). Fixed for Piper by `STRESS_FIXES`; `script.json` has no `tts` for them yet. The ElevenLabs dry run prints a hint. |
| исподво́ль (L03 `tts`) | — | Standard dictionaries give **и́сподволь**; «исподво́ль» is at best a variant. Please confirm with the translator. |
| Признаю́сь (L14) | — | Grammatical (imperfective, "I confess"). The Latin *Fatebor* is future, so «призна́юсь» would mirror it more literally. Translator's call. |

ElevenLabs: stress marks are sent as-is (U+0301). Whether `eleven_v4` honours them
in Russian is **not verified** (no key). If it doesn't, use IPA in slashes
(`/ɫʊˈt͡sɨlʲɪj/`; v4 supports inline IPA) or a pronunciation dictionary.

## ElevenLabs (production)

`scripts/voice/generate-elevenlabs.mjs`. Reads `ELEVENLABS_API_KEY`,
`ELEVENLABS_VOICE_ID`, optional `ELEVENLABS_MODEL` (default `eleven_v4`) from
`.env.local` with a built-in parser (real environment variables override). The key
is never printed. Never use a `VITE_` prefix: Vite would bundle it.

```sh
npm run voice:elevenlabs                      # dry run (default when no key / voice id)
npm run voice:elevenlabs -- --dry-run         # exact texts, chars, cost; sends nothing
npm run voice:elevenlabs -- --voices          # browse ru male old/middle-aged shared voices (free GET)
npm run voice:elevenlabs -- --voices --age=old --search=narrator
npm run voice:elevenlabs -- --only=L01,L10    # first a small test: ~100 chars ≈ $0.01
npm run voice:elevenlabs -- --yes             # everything, no confirmation prompt
npm run voice:elevenlabs -- --only=L10 --seed-offset=1   # another take of one line
```

Other flags: `--force` (regenerate even if up to date), `--model=…`,
`--stability=0.5 --similarity=0.8`, `--max-chars=6000`, `--skip-quota-check`,
`--no-cache`. Legend in the plan: `*` paid request, `c` re-processed from the
local cache (free), `=` up to date.

What it sends per line: `v3Tags` + cue texts (with `tts` stress marks) joined by
spaces, with `[short pause]` between cues whose `pause` ≥ 0.5 s and `[pause]` for ≥
0.85 s. Validation guarantees that no tag or stress mark can reach the subtitles
(display texts never contain `[`, `]` or U+0301; tags only come from `v3Tags` and
pause hints).

Request: `POST /v1/text-to-speech/{voice_id}/with-timestamps?output_format=mp3_44100_128`
with `model_id`, `language_code: "ru"` (omitted for multilingual_v2), `voice_settings`
(v4/v3: `stability 0.5`, `similarity_boost 0.8`; other models also get style 0.15,
speaker boost, speed 0.92), a per-line `seed` (from the line id), and for letter
lines `previous_text`/`next_text` = neighbouring letter lines (skipped for
`eleven_v3`, which does not support stitching). If the timestamp endpoint rejects
the model (400/422), it falls back to the plain endpoint and estimates cue timings
from silences or the characters' share of the duration.

Cue timings: the character alignment is mapped to cues by **normalised text
matching** (letters/digits only, lower case, ё→е, no stress marks, characters
inside `[...]` ignored), aligned by edit distance. So it works whether or not the
alignment contains tag characters, stress marks or normalised spellings (unit-tested
with synthetic alignments). The clip is then edge-trimmed, given the same
lead-in/tail/loudness as the placeholder, and the timings are shifted accordingly.

Safety: `--max-chars` (default 6000) aborts before any request. The remaining
quota (`GET /v1/user/subscription`) is checked first. A y/N confirmation is required
unless `--yes`. Raw responses (audio + alignment) are cached in
`.tools/elevenlabs-cache/` so re-processing never pays twice. The manifest is
written after every line. Placeholder entries stay for lines not generated yet, and
ElevenLabs clips are never overwritten by the placeholder script without `--force`.

### Recommendations

- **Model**: `eleven_v4` (best Russian expressiveness; tags; 10k chars/request).
  Only *stability* and *similarity* apply. Start at stability 0.45–0.55 (lower =
  more expressive, less consistent), similarity 0.75–0.85.
- **Tags**: v4 follows descriptive tags best. Consider replacing the single-word
  `v3Tags` with explicit voice directions, e.g. `[warm, quiet, unhurried]`,
  `[low, reflective, slightly wry]`, `[soft sigh]`. Avoid tags that read as sound
  effects. `[sighs]` (L16) may produce an audible sigh, which is intended there.
  Check with ASR that tags are not spoken (`npm run voice:verify` flags extra words).
- **Voice search**: native Russian, male, age *old* or *middle_aged*, use case
  narration / audiobook, low-mid timbre, calm, clean preview without music. Prefer
  voices with `verified_languages` including `ru` and high 1-year usage. Listen to
  2–3 candidates with one test line (L10, 54 chars) before committing.
- **Cost**: the whole script is **3,212 characters ≈ $0.26 per full pass** at
  $0.08/1K (API price for v4). With 3–4 takes for the best lines, budget ≈ $1.
  Plan credits may be counted differently from the API price.
- After generating: `npm run voice:verify` (ASR WER, cut words, words outside cue
  windows, loudness).

## QA status (placeholder, 2026-10-19)

`npm run voice:verify`: **0 errors**, 3 ASR flags (L01, L10, A-table, all
model-limited, see above), 1 warning (A-farewell: Whisper inserted a phantom «и»
with an unreliable timestamp in the pause, a false positive of the cue-window
check). Corpus WER 0.060. Loudness −17.9…−18.0 LUFS, true peak −2.1…−3.8 dBTP, no
clipping. Cue pauses exact (max error 0.000 s). Total 229.7 s: b1 46.0, b2 39.9,
b3 34.6, b4 35.2, b5 25.2, authored 48.8 s.

## QA (`npm run voice:verify`)

Checks per clip: present in the manifest; file exists; ffprobe duration within
±0.06 s of the manifest; cue count/text in sync with `script.json`; cue timings
monotonic and inside the clip; loudness −18 ± 1 LUFS; true peak ≤ −1.5 dBTP
(error > −0.5); no clipped samples; leading silence 0.03–0.6 s, trailing 0.08–1.2 s;
F0 statistics; ASR (faster-whisper, `large-v3-turbo`, ru) WER vs the displayed text
(flag > 0.25), missing final word (cut-off), and recognised words falling outside
every cue window (timing errors). Known Whisper hallucinations on silence
(«Продолжение следует…», subtitle credits) are ignored and listed. Report:
`docs/audio/voice-qa.md`. Exit code 1 on errors (ASR flags are reported, not fatal).
`--no-asr` skips the slow part.
