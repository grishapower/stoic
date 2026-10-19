# Audio engine

Web Audio engine for *Seneca: The Art of Time*. It covers Seneca's spatialised voice, a fully procedural Mediterranean evening (no ambience files), very quiet modal lyre music and procedural footsteps.

Code: `src/game/audio/`. Public contract: `contract.ts`. Singleton: `import { audio } from './audio/engine'`.

> Nothing here has been checked by ear. Levels come from gain-staging arithmetic (below) and the buffer generators were checked numerically (RMS, peak, NaN, loop seams, Karplus–Strong tuning within 0.1 cent). Listen first to the items in [Listening checklist](#listening-checklist).

## Files

| File | Role |
|---|---|
| `contract.ts` | Public API (unchanged) |
| `engine.ts` | Singleton `audio`: context lifecycle, bus graph, listener, 10 Hz control tick, `debugAudioLevels()` |
| `voice.ts` | `VoicePlayer`: decode/cache, transport, cue polling, silent-timer fallback, HRTF and presence |
| `ambience.ts` | `Ambience` facade and staged runtime |
| `wind.ts` | Wind-strength model (gusts) and stereo wind bed |
| `foliage.ts` | Leaf rustle (nearest-4 emitter pool and distant canopy bed), cicadas and crickets |
| `fountain.ts` | Positional fountain: bubble loops, fluttering splash, droplet plinks |
| `sea.ts` | Positional surf: irregular swells (rumble followed by foam), distance shaping |
| `birds.ts` | Six individual birds of five synthesized species |
| `music.ts` | Karplus–Strong lyre phrases in D dorian with a breathing drone and a synthetic reverb |
| `footsteps.ts` | Gravel, stone, grass and wood one-shots |
| `synth.ts` | PRNG, math, noise/texture generators, KS pluck, reverb IR, soft-clip curve, node utilities |
| `spatial.ts` | Panner factory, smoothed positioning, listener driver, nearest-k |
| `bank.ts` | Lazily rendered shared buffers (24 kHz) |

## Integration notes

```ts
// From a click/keydown handler (session.beginWalk already does this):
await audio.unlock()                        // rejects if the context cannot run; the game continues silently

// Every frame (GameLoop): pass reusable vectors, no allocations needed
audio.updateListener(camera.position, fwd, up)
audio.voice.setSourcePosition(runtime.seneca.head)

// Once, when the layout is known (can be called before unlock; may be called again)
audio.ambience.configure({ fountain, sea, birdPerches, foliage })

// Freely, every frame if convenient (only real changes touch the graph)
audio.ambience.setTimeOfDay(progress)      // 0 = afternoon, 1 = sunset
audio.music.setEnabled(on)                 // fades in over 12 s; first phrase after 7–13 s
audio.music.setIntensity(v)                // 0..1
audio.setBusVolume('ambience', v)          // remembered before unlock
audio.setMenuMuffle(true | false)

// Footfalls
audio.footsteps.step(pos, 'gravel', 'player' | 'seneca', speed / walkSpeed)

// Optional: warm the next lines (before unlock this only fetches bytes)
void audio.voice.preload(['L03', 'L04'])
```

- **Before unlock**, every call is safe. Volumes, muffle, ambience config, time of day, wind and music state are remembered and applied on unlock. `voice.play()` runs on a **silent timer** with the manifest timings, so cue and ended events still drive subtitles and the director even when audio is blocked.
- **Voice semantics**: `play(id, {fromCue})` starts 0.15 s before that cue. `pause()` fades over about 250 ms and keeps `currentCue`. `resume()` restarts at the active cue's start minus 0.15 s with a 120 ms fade-in, and no `-1` is emitted during that lead-in, so subtitles don't flicker. `stop()` emits `-1` (if a cue was showing) and no ended event. `onEnded` fires exactly once on natural completion, and it is safe to call `play()` inside it. Switching clips with `play()` emits `-1` for the old clip first.
- **Fallbacks**: if `file === ''`, the fetch or decode fails, or the context is not running, the clip plays on the silent timer. If the context gets suspended mid-clip for more than 3 s, the clip finishes on the timer, so the director never stalls.
- **Ducking is automatic**: while the voice plays, ambience drops 2 dB and music drops 5 dB, and music postpones about half its phrases. The director's `setIntensity(0.3)` while talking stacks on top of this, which is intended.
- **Heights**: the `y` values passed to `configure` are used as given: fountain at basin height, foliage at canopy height, perches at branch height, sea at the waterline. `CANOPY_LIFT` and `HEIGHT_OFFSET` add an offset if needed.
- **Recovery**: pointer, key or touch gestures and tab visibility resume a suspended or Safari-`interrupted` context. `dispose()` closes everything; the voice continues on the silent timer.
- **Dev**: `window.__senecaAudio.debugAudioLevels()` returns momentary RMS/peak dBFS for the voice, ambience and music buses and the final output, plus a state snapshot (context state, measured compressor makeup, voice cue and position). After hot-reloading an audio file, the old context is closed, so click *Begin* again or reload.

## Bus graph

```
voice ──────────────────────────────→ voiceBus ─┐
ambience → fade-in 3 s → voice duck ─→ ambBus ──┤
footsteps → sfx ────────────────────↗           ├→ master → menu LPF → menu gain → compressor → makeup⁻¹ → soft clip → out
music ──────────────────────────────→ musicBus ─┘
```

- Bus volumes are linear (`0..1`) and smoothed with `setTargetAtTime`, τ = 80 ms. Defaults match the store: master 0.9, voice 1, ambience 0.75, music 0.35. Internal trims (`*_TRIM_DB` in `engine.ts`) are 0 dB.
- **Menu muffle**: Butterworth lowpass from 20 kHz down to 900 Hz plus −8 dB, τ = 150 ms.
- **Compressor** for gentle glue: threshold −12 dB, knee 8, ratio 2.5, attack 12 ms, release 300 ms. `DynamicsCompressorNode` adds automatic makeup gain, which the spec defines as (1/fullRangeGain)^0.6. At unlock the engine measures it with an `OfflineAudioContext` (a −40 dBFS constant signal) and cancels it, so everything below threshold passes at unity. Until the measurement lands, a −3 dB estimate is used.
- **Limiter**: a WaveShaper soft clip (2× oversampled). It is exactly linear up to −3 dBFS and saturates smoothly to −0.2 dBFS for inputs up to +6 dBFS. It is a safety net only; the mix never gets near it.

## Mixing levels

Estimates at default volumes, in output dBFS (after bus and master). Voice assumes a typical TTS master around −18 dBFS RMS.

| Layer | Where | RMS (or peak) |
|---|---|---|
| **Voice** | Seneca 2–4 m away | **≈ −20 RMS**, peaks ≈ −6 (lightly compressed) |
| Fountain | 5 m / 10 m / 15 m / 22 m / 30 m | −36 / −42 / −45 / −53 / silent |
| Wind bed (LF) | calm / gust | −38 / −34 |
| Wind "air" (1 kHz) | calm / gust | −50 / −41 |
| Leaves, one emitter at 6 m | calm / gust | −46 / −38 (up to 4 emitters) |
| Distant canopy | calm / gust | −48 / −40 |
| Birds | whistler at 12 m / 25 m | peaks −32 / −39 |
| Sea rumble (< 260 Hz) | terrace / garden | swell peaks −30 / −47 |
| Sea foam (0.65–5.5 kHz) | terrace / garden | swell peaks −37 / ≈ −60 |
| Crickets / cicadas | sunset | ≈ −55 / ≈ −54 |
| Footsteps, player | gravel / stone / grass / wood | −36 / −40 / −48 / −41 (40–80 ms bursts) |
| Footsteps, Seneca | 3 m | ≈ player level |
| Music plucks | intensity 0.5, no voice | peaks ≈ −35 (−5 dB more under the voice) |
| Music drone | | ≈ −45 (mostly 70–150 Hz) |
| **Ambience total** | garden, calm | **≈ −33** |

The voice sits about 13–15 dB above the whole ambience in the garden (including the 2 dB duck), and about 17 dB above the foam at the terrace. The terrace rumble is the loudest ambient element by RMS, but it is all below 260 Hz and does not mask speech. If the terrace feels boomy, lower `RUMBLE_PEAK` first.

## How each sound is made

### Voice (`voice.ts`)
The signal runs source → per-playback fade gain → HPF 85 Hz → low shelf +1.5 dB at 240 Hz (warmth) → peaking −2 dB at 6.8 kHz, Q 0.8 (tames TTS harshness). It then splits into:
- an **HRTF panner** (inverse model, ref 2.5 m, rolloff 0.7; −10 dB at 10 m, −15 dB at 20 m)
- a **non-positional presence send** at 0.18 (−15 dB)

Position glides with τ = 60 ms; jumps over 6 m are applied instantly. Cue polling runs at 30 Hz from `AudioContext.currentTime`, or `performance.now()` in silent mode. Decoded buffers live in an LRU of 20 clips.

### Wind (`wind.ts`)
- **Strength model** `w ∈ 0..1`: base 0.42, reduced 30 % toward sunset (evening calm). Three slow sines (31 s, 13.7 s, 5.3 s) meander around it. Gusts come every 6–22 s: rise 1.4–3.2 s, hold, fall 3–7 s, amplitude 0.15–0.42. `setWind(v)` overrides the base.
- **Bed**: decorrelated L/R brown noise (two loops of different length, 50 Hz corner) → HPF 45 → LPF that drifts from 240 to 950 Hz with `w^1.3`. Gain runs from 35 % to 100 % with `w`.
- **Air**: L/R pink noise → band-pass 650–1500 Hz, Q 0.6, gain ∝ `w^1.5`. This is the audible "whoosh" of gusts.

### Leaves, cicadas, crickets (`foliage.ts`)
- **Rustle texture**: a granular buffer with about 900 micro-grains/s (0.4–2.5 ms decaying noise bursts, heavy-tailed amplitudes, some 2.5–6 kHz clicks). The rate clusters in random 40–220 ms segments, which reads as leaves moving in bursts.
- **Positional pool**: four HRTF emitters (ref 4 m, rolloff 1.1). Every second they are reassigned to the four foliage centres nearest the listener: fade out, jump, fade in. Each emitter runs rustle → HPF 900 → BPF 2.3–3.6 kHz (rises with wind) → gain ∝ `0.18 + 0.82·w²`.
- **Distant canopy**: stereo rustle → BPF 3.2 kHz, Q 0.5, also following `w²`. It is audible from the first second, even before `configure`.
- **Cicadas**: a pre-rendered tymbal-click train (150–190 Hz pulses of damped 4.8–6.2 kHz resonances) played as stereo → BPF 5.2 kHz. It fades in between timeOfDay 0.25 and 0.7, thins to half at sunset, and swells randomly every 4–12 s.
- **Crickets**: a periodic chirp loop (3–4 pulses of 4.6 kHz every 0.56 s). One distant cricket is panned left; one rides the last foliage emitter at a different rate and pitch. They fade in between timeOfDay 0.55 and 0.95.

### Fountain (`fountain.ts`)
- **Bubbles**: two loops (7.1 s and 5.3 s, so they never align) of Poisson-distributed **Minnaert bubbles**. Each bubble is a damped sine whose pitch rises slightly, with damping `d = 0.13/r + 0.0072·r^-1.5`, radius `r = 3/f`, and `f` log-uniform from 450 Hz to 3.4 kHz. Bubbles come in clusters of varying density.
- **Splash**: white noise → HPF 400 → BPF 1.7 kHz, amplitude-modulated by a smooth random ~14 Hz signal (gain 0.3–1.0) for flutter.
- **Plinks**: about 0.9 per second, Poisson. Each is a sine at 1.1–2.6 kHz with a fast glide over 25–60 ms and exponential decay (τ = 10–30 ms). The glide is **rising** (×1.25–1.7), which is the physical bubble "bloop" of a drop. Set `PLINK_GLIDE` below 1 for a falling blip.
- **Distance**: HRTF, ref 4 m, plus an extra smoothstep fade from 16 m to 30 m, so it is gone by 30 m. Plinks aren't scheduled while it's inaudible.

### Sea (`sea.ts`)
- Up to four emitters, chosen by farthest-point sampling so their order doesn't matter. They use equal-power panning (wide and cheap), inverse distance with ref 25 m, plus extra shaping from 45 m to 120 m: gain down to 0.4 and an air lowpass from 9 kHz down to 1.3 kHz. The result is a dark murmur in the garden and a bright, clear sea at the terrace.
- Each swell (period 6–12 s, amplitude 0.55–1, and 15 % "set" waves at ×1.3) has two parts:
  - **Rumble**: brown noise → LPF 260 Hz, rising with τ = 0.9 s for 1.8–2.6 s, then decaying with τ = 1.5 s.
  - **Foam**: 1.3–1.9 s later, pink noise → HPF 650 → swept LPF that opens to 5.5 kHz as the wave breaks (τ = 0.25 s). It holds for 0.5–0.9 s, then decays over τ = 1.4–2.2 s while the LPF closes to 1.6 kHz as the wash draws back.
- Constant floors keep the sea from ever going silent.

### Birds (`birds.ts`)
Six individuals: `whistler, dove, chirp, trill, whistler, tit`. Each has its own pitch (±8 %), tempo (±10 %), HRTF panner (ref 5 m) and perch. Every phrase uses **one oscillator** (a custom `PeriodicWave` for timbre) and **one envelope**. Pitch jumps happen only while the envelope is at zero, so there are no clicks.

| Species | Model | Sound |
|---|---|---|
| whistler | blackbird | 3–5 fluty notes (1.5–3.1 kHz, glides ×0.82–1.22) from a personal repertoire of 3 motifs, sung with variation; half the time a soft 4.5–6.5 kHz twitter coda |
| trill | serin/wren | 0.6–1.3 s of 14–20 notes/s tiny down-sweeps (5.2 → 3.7 kHz), crescendo–decrescendo, slight drift |
| chirp | sparrow/finch | 2–4 "chip"s (2.9 → 4.3 → 3.2 kHz in 50–75 ms), sometimes repeated |
| tit | great tit | 3–5 "tee-cher" pairs (5.1 kHz then 3.8 kHz) |
| dove | collared dove | "coo-COO-coo" at 470–560 Hz, repeated 2–4 times, distant perches (16–70 m) |

Timing: phrases start 0.6–4.5 s after unlock, so birds are the first thing heard. After that each bird rests 3–15 s, or 14–30 s with 22 % probability. Perches are chosen with weight `1/(1+(d/18)²)` within 4–45 m of the listener, and birds relocate every 25–70 s or when the listener is more than 55 m away. Before `configure`, birds sit on a virtual ring 8–28 m around the listener. **Dusk**: intervals stretch by ×(1 + 1.6·t), and the number of active birds drops from 6 to 2 (the first whistler and the dove).

### Music (`music.ts`)
- **Lyre**: one Karplus–Strong string per D dorian note from D3 to D5 (15 notes). Each has an exact fractional-delay allpass tuning, a lowpassed noise excitation, a pluck-position comb at 0.17, and T60 from 3.4 s (low) to 1.6 s (high). The notes are rendered in the background 8 s after unlock, or at the first enable, one note per tick. The body EQ is HPF 90, +2.5 dB at 320 Hz and LPF 3.4 kHz. A synthetic stereo hall IR (3.2 s, darkening) feeds a convolver with a 0.4 send.
- **Phrases**: 2–5 notes, mostly stepwise with a pull toward D4. They start on D or A, end on D or A 70 % of the time, and sometimes add a soft octave or fifth below the last note. Notes are 0.55–1.35 s apart. Silences between phrases are 10–24 s × (1.6 → 0.6 with intensity), never under 6 s. There is no beat.
- **Drone**: D2 and A2 sines plus a detuned D3 triangle → LPF 520 Hz, breathing over a 55 s period. A modal colour tone (F3, E3, G3, C4 or A3) cross-fades every 25–55 s.
- **Level**: a linear fade-in over **12 s** after `setEnabled(true)`, then `0.7 × lerp(0.3, 1, intensity)`, −5 dB while the voice plays, and a fade-out with τ = 2 s. The drone stops 15 s after disable.

### Footsteps (`footsteps.ts`)
Filtered-noise bursts and short sines, normalised by each filter's pass-band so the levels are predictable. Each step varies by ±2 dB, filter frequency, heel–toe gap and source offset.
- **gravel**: heel and toe "crunch" (a dense granular buffer → BPF 1.4–2.6 kHz) plus a 250 Hz weight thump
- **stone**: LPF 600–900 Hz tap, a 100 Hz weight sine and a faint 2.5 kHz sandal scuff
- **grass**: two soft BPF 1.8–3.5 kHz swishes and a muffled 180 Hz thud
- **wood**: a 170–210 Hz knock sine plus narrow resonances at 520 Hz and 1.25 kHz

Seneca's steps go through two alternating HRTF panners (ref 1.5 m). The player's are non-positional, alternating ±0.08 stereo, at about half Seneca's source level. `intensity` scales the level (clamped 0..1.5).

## Tuning

Every module starts with a `tuning` block of named constants; all gains are linear and all times are in seconds.

| To change… | Edit |
|---|---|
| Overall balance of a whole layer | `engine.ts` `*_TRIM_DB`, `AMBIENCE_VOICE_DUCK_DB` |
| Voice intelligibility vs. localisation | `voice.ts` `PRESENCE_SEND` (higher = less positional), `ROLLOFF`, `REF_DISTANCE` |
| Voice tone | `voice.ts` `EQ_*` |
| Fountain range or loudness | `fountain.ts` `FADE_START/END`, `REF_DISTANCE`, `*_LEVEL` |
| Sea presence at the garden vs. terrace | `sea.ts` `FAR_START/END/GAIN`, `LPF_FAR`, `RUMBLE_PEAK`, `FOAM_PEAK` |
| Gustiness | `wind.ts` `GUST_*`, `MEANDER`, `WIND_BASE` |
| Bird density | `birds.ts` `FLOCK`, `INTERVAL`, `LONG_REST_*`, `DUSK_*`, `LEVEL` |
| Music sparseness or level | `music.ts` `PHRASE_GAP`, `OUT_LEVEL`, `PLUCK_GAIN`, `PAD_LEVEL` |
| Footstep loudness | `footsteps.ts` `PLAYER_LEVEL`, `SENECA_LEVEL`, `SURFACE_TRIM` |

Workflow: walk to a spot and run `__senecaAudio.debugAudioLevels()` a few times, comparing `voice.rmsDb` with `ambience.rmsDb`. During speech, aim for the voice to be at least 10 dB above the ambience.

## CPU and memory

- About 14 HRTF panners (voice 1, birds 6, foliage 4, fountain 1, Seneca's steps 2), 4 equal-power panners for the sea, 1 convolver (only meaningful while music is on), and roughly 25 looping buffer sources. Chrome skips HRTF work for silent inputs, so idle birds are cheap.
- Bird phrases, plinks, plucks and steps are one-shot nodes. They are disconnected on `ended`.
- Procedural buffers are rendered at 24 kHz (all their content is below 12 kHz), about 70 s of mono audio (≈ 7 MB) in total. Rendering is staged one buffer per tick, 40 ms apart, after unlock, so a single step costs a few ms. The KS notes and IR are rendered at the context rate (≈ 14 MB). Decoded voice clips are LRU-capped at 20 (≈ 1 MB per 5 s of mono 48 kHz).
- The per-frame path (`updateListener`, `setSourcePosition`) allocates nothing. `setTimeOfDay`, `setIntensity` and `setEnabled` are no-ops unless their value changes. Control logic runs on a 10 Hz `setInterval` with look-ahead scheduling, and voice cues poll at 30 Hz only while a clip plays.

## Listening checklist

1. In the first 5 s after *Begin*: birds, soft wind and the fountain, with no music.
2. The fountain should sound like a gentle trickle, not hiss. If it is too hissy, lower `SPLASH_LEVEL`; if it is too "boiling", lower the bubble `rate` in `bank.ts`.
3. Leaves should be audible in gusts but nearly gone in still air.
4. The terrace sea should not boom on headphones (check `RUMBLE_PEAK`), and the foam wash should be clear.
5. Birds should never stack into a chorus. Whistler motifs are meant to sound musical, not like sine "beeps"; if they do, lower `LEVEL.whistler` or narrow the glide range.
6. Music should be barely noticeable, with plucks well apart.
7. In the menu, the scene should be muffled and quieter, with no clicks when switching in and out.

## Interaction sounds (added later)

`footsteps.step(pos, surface, 'world', intensity)` also renders two small positional one-shots used by the fruit interaction:

- `leaves`: picking a fruit. Two band-passed leaf rustles (2.4–4.8 kHz) and a tiny high-passed "stem snap".
- `fruit`: a fruit landing. A soft sine thump (≈160 → 70 Hz) plus low-passed noise, scaled by impact speed. It fires from `interaction/fruits.ts` → `fruitEvents.onImpact`.

Both use the `world` level (`WORLD_LEVEL = 0.5`) and the positional HRTF panners.
