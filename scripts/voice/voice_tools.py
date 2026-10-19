"""Audio helpers for the voice pipeline (run with .tools/venv/bin/python).

Called by scripts/voice/*.mjs. Every subcommand reads a JSON spec from the file
given as argv[2] and prints a JSON result on stdout (logs go to stderr).

  synth     Piper TTS, one WAV per job (voice loaded once).
  assemble  trim cues, insert exact pauses, loudness-normalise, peak-limit.
  analyze   F0 / peak / edge-silence stats for finished clips.
  asr       faster-whisper transcription (optional dependency).

Only numpy (+ piper / faster-whisper for their subcommands) is required.
"""

import json
import subprocess
import sys
import wave

import numpy as np

# --------------------------------------------------------------------------- io


def log(*args):
    print(*args, file=sys.stderr, flush=True)


def read_f32(path):
    return np.fromfile(path, dtype="<f4").astype(np.float64)


def write_f32(path, x):
    np.asarray(x, dtype="<f4").tofile(path)


def decode(path, sr, raw_sr=None):
    """Decode any audio file (or raw f32le mono at raw_sr) to mono float at `sr`."""
    pre = ["-f", "f32le", "-ar", str(raw_sr), "-ac", "1"] if raw_sr else []
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", *pre, "-i", path, "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"],
        capture_output=True,
        check=True,
    ).stdout
    return np.frombuffer(raw, dtype="<f4").astype(np.float64)


def db(x):
    return 20.0 * np.log10(max(float(x), 1e-12))


# ------------------------------------------------------------------- envelopes


def moving_rms(x, win):
    win = max(1, int(win))
    c = np.concatenate([[0.0], np.cumsum(x * x)])
    half = win // 2
    idx = np.arange(len(x))
    lo = np.clip(idx - half, 0, len(x))
    hi = np.clip(idx + half + 1, 0, len(x))
    return np.sqrt((c[hi] - c[lo]) / np.maximum(hi - lo, 1))


def speech_bounds(x, sr, rel_db=-42.0, abs_db=-62.0):
    """First/last sample whose 10 ms RMS exceeds max(peak_rms*rel, abs)."""
    if len(x) == 0:
        return None
    env = moving_rms(x, sr * 0.010)
    thr = max(env.max() * 10 ** (rel_db / 20), 10 ** (abs_db / 20))
    above = np.nonzero(env > thr)[0]
    if len(above) == 0:
        return None
    return int(above[0]), int(above[-1])


# ------------------------------------------------------------------------ synth


def cmd_synth(spec):
    from piper import PiperVoice, SynthesisConfig

    voice = PiperVoice.load(spec["model"])
    sr = voice.config.sample_rate
    out = {"sampleRate": sr, "jobs": {}}
    for job in spec["jobs"]:
        cfg = SynthesisConfig(
            length_scale=job["lengthScale"],
            noise_scale=job["noiseScale"],
            noise_w_scale=job["noiseWScale"],
            normalize_audio=False,
        )
        chunks = list(voice.synthesize(job["text"], cfg))
        parts = []
        gap = np.zeros(int(round(job.get("sentenceGap", 0.3) * sr)))
        for i, ch in enumerate(chunks):
            a = ch.audio_float_array.astype(np.float64)
            b = speech_bounds(a, sr)
            if b is None:
                continue
            # Keep outer edges for the assembler; tighten only inner sentence joins.
            s = 0 if i == 0 else max(0, b[0] - int(0.03 * sr))
            e = len(a) if i == len(chunks) - 1 else min(len(a), b[1] + int(0.06 * sr))
            if parts:
                parts.append(gap)
            parts.append(a[s:e])
        x = np.concatenate(parts) if parts else np.zeros(int(0.1 * sr))
        pcm = (np.clip(x, -1, 1) * 32767).astype("<i2")
        with wave.open(job["out"], "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(sr)
            w.writeframes(pcm.tobytes())
        out["jobs"][job["id"]] = {
            "sentences": len(chunks),
            "phonemes": " | ".join("".join(c.phonemes) for c in chunks),
            "seconds": round(len(x) / sr, 3),
            "peak": round(float(np.max(np.abs(x))) if len(x) else 0.0, 4),
        }
    return out


# ------------------------------------------------------------- BS.1770 loudness


def _biquad_ir(b, a, n):
    """Impulse response of a biquad (direct form I), n samples."""
    y = np.zeros(n)
    x1 = x2 = y1 = y2 = 0.0
    for i in range(n):
        x0 = 1.0 if i == 0 else 0.0
        y0 = b[0] * x0 + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2
        y[i] = y0
        x2, x1, y2, y1 = x1, x0, y1, y0
    return y


def _k_weighting_ir(sr):
    """K-weighting (ITU-R BS.1770-4) impulse response for any sample rate."""
    # Stage 1: high shelf (pyloudnorm parametrisation).
    G, Q, fc = 3.99984385397, 0.7071752369554193, 1681.9744509555319
    A = 10 ** (G / 40)
    w0 = 2 * np.pi * fc / sr
    alpha = np.sin(w0) / (2 * Q)
    b0 = A * ((A + 1) + (A - 1) * np.cos(w0) + 2 * np.sqrt(A) * alpha)
    b1 = -2 * A * ((A - 1) + (A + 1) * np.cos(w0))
    b2 = A * ((A + 1) + (A - 1) * np.cos(w0) - 2 * np.sqrt(A) * alpha)
    a0 = (A + 1) - (A - 1) * np.cos(w0) + 2 * np.sqrt(A) * alpha
    a1 = 2 * ((A - 1) - (A + 1) * np.cos(w0))
    a2 = (A + 1) - (A - 1) * np.cos(w0) - 2 * np.sqrt(A) * alpha
    shelf = ([b0 / a0, b1 / a0, b2 / a0], [1.0, a1 / a0, a2 / a0])
    # Stage 2: high pass (RLB).
    Q, fc = 0.5003270373253953, 38.13547087613982
    w0 = 2 * np.pi * fc / sr
    alpha = np.sin(w0) / (2 * Q)
    b0 = (1 + np.cos(w0)) / 2
    b1 = -(1 + np.cos(w0))
    b2 = (1 + np.cos(w0)) / 2
    a0 = 1 + alpha
    a1 = -2 * np.cos(w0)
    a2 = 1 - alpha
    hp = ([b0 / a0, b1 / a0, b2 / a0], [1.0, a1 / a0, a2 / a0])
    n = int(sr * 0.5)
    h1 = _biquad_ir(*shelf, n)
    h2 = _biquad_ir(*hp, n)
    return np.convolve(h1, h2)[:n]


_KIR = {}


def fft_convolve(x, h):
    n = len(x) + len(h) - 1
    nfft = 1 << (n - 1).bit_length()
    y = np.fft.irfft(np.fft.rfft(x, nfft) * np.fft.rfft(h, nfft), nfft)
    return y[: len(x)]


def integrated_loudness(x, sr):
    """Gated integrated loudness in LUFS (mono, BS.1770-4)."""
    if sr not in _KIR:
        _KIR[sr] = _k_weighting_ir(sr)
    y = fft_convolve(x, _KIR[sr])
    block, step = int(0.4 * sr), int(0.1 * sr)
    if len(y) < block:
        y = np.concatenate([y, np.zeros(block - len(y))])
    c = np.concatenate([[0.0], np.cumsum(y * y)])
    starts = np.arange(0, len(y) - block + 1, step)
    z = (c[starts + block] - c[starts]) / block
    lk = -0.691 + 10 * np.log10(np.maximum(z, 1e-20))
    z = z[lk > -70]
    if len(z) == 0:
        return -70.0
    rel = -0.691 + 10 * np.log10(z.mean()) - 10
    lk = -0.691 + 10 * np.log10(np.maximum(z, 1e-20))
    z = z[lk > rel]
    return float(-0.691 + 10 * np.log10(z.mean()))


def true_peak_db(x):
    """Approximate true peak via 4x FFT oversampling (dBTP)."""
    n = len(x)
    if n == 0:
        return -120.0
    X = np.fft.rfft(x)
    up = np.fft.irfft(X, 4 * n) * 4
    return db(np.max(np.abs(up)))


def limit(x, ceiling_lin, sr, radius=0.008):
    """Offline zero-latency peak limiter: applied gain never exceeds ceiling/|x|.

    Sliding minimum of the required gain (radius >= r), then a moving average of
    radius r: every averaged value is <= the requirement at the centre sample, so
    no sample exceeds the ceiling, and gain changes are smoothed over ~2r.
    """
    need = np.minimum(1.0, ceiling_lin / np.maximum(np.abs(x), 1e-12))
    if need.min() >= 1.0:
        return x
    r = max(1, int(radius * sr))
    g = need.copy()
    span, covered = 1, 0
    while covered < r:
        g = np.minimum(g, np.concatenate([g[span:], np.ones(span)]))
        g = np.minimum(g, np.concatenate([np.ones(span), g[:-span]]))
        covered += span
        span *= 2
    c = np.concatenate([[0.0], np.cumsum(g)])
    idx = np.arange(len(g))
    lo = np.clip(idx - r, 0, len(g))
    hi = np.clip(idx + r + 1, 0, len(g))
    smooth = (c[hi] - c[lo]) / (hi - lo)
    return x * np.minimum(smooth, need)


# --------------------------------------------------------------------- assemble


def cmd_assemble(spec):
    sr = spec["sampleRate"]
    target = spec.get("targetLufs", -18.0)
    tp_max = spec.get("truePeakMax", -1.5)
    results = {}
    for line in spec["lines"]:
        lead = np.zeros(int(round(line["leadIn"] * sr)))
        pieces = [lead]
        pos = len(lead)
        cues = []
        n = len(line["cues"])
        for i, cue in enumerate(line["cues"]):
            x = read_f32(cue["file"]) if cue["file"].endswith(".f32") else decode(cue["file"], sr)
            b = speech_bounds(x, sr)
            if b is None:
                raise SystemExit(f"{line['id']} cue {i}: no speech found")
            pre, post = int(0.025 * sr), int(0.06 * sr)
            s, e = max(0, b[0] - pre), min(len(x), b[1] + post)
            seg = x[s:e].copy()
            fi, fo = min(int(0.004 * sr), len(seg) // 4), min(int(0.012 * sr), len(seg) // 4)
            if fi:
                seg[:fi] *= np.linspace(0, 1, fi)
            if fo:
                seg[-fo:] *= np.linspace(1, 0, fo)
            # srcStart: where the kept region began in the source file (lets callers
            # shift externally derived timings, e.g. ElevenLabs alignment).
            cues.append({"index": i, "start": pos / sr, "end": (pos + len(seg)) / sr, "srcStart": s / sr})
            pieces.append(seg)
            pos += len(seg)
            gap = line["tail"] if i == n - 1 else cue["pause"]
            g = np.zeros(int(round(gap * sr)))
            pieces.append(g)
            pos += len(g)
        y = np.concatenate(pieces)

        # Loudness: gain to target, then limit true peak; repeat to converge.
        ceiling = tp_max - 0.6  # margin for MP3 encoding overshoot
        gain_db = target - integrated_loudness(y, sr)
        z = y
        for _ in range(6):
            z = y * 10 ** (gain_db / 20)
            tp = true_peak_db(z)
            lim = ceiling
            while tp > ceiling:
                z = limit(z, 10 ** ((lim - 0.05) / 20), sr)
                tp = true_peak_db(z)
                lim -= 0.3
            lufs = integrated_loudness(z, sr)
            if abs(lufs - target) < 0.1:
                break
            gain_db += target - lufs
        write_f32(line["out"], z)
        results[line["id"]] = {
            "duration": len(z) / sr,
            "cues": cues,
            "lufs": round(lufs, 2),
            "truePeak": round(tp, 2),
            # Peak reduction applied by the limiter (dB) at the final gain.
            "limitedDb": round(max(0.0, true_peak_db(y * 10 ** (gain_db / 20)) - tp), 2),
            "gainDb": round(gain_db, 2),
        }
    return results


# ---------------------------------------------------------------------- analyze


def f0_track(x, sr, fmin=55.0, fmax=320.0):
    """YIN-style F0 per 10 ms frame; returns voiced F0 values (Hz)."""
    win, hop = int(0.040 * sr), int(0.010 * sr)
    if len(x) < win + hop:
        return np.array([])
    frames = np.lib.stride_tricks.sliding_window_view(x, win)[::hop]
    rms = np.sqrt(np.mean(frames**2, axis=1))
    keep = rms > max(rms.max() * 10 ** (-35 / 20), 1e-4)
    frames = frames[keep]
    if len(frames) == 0:
        return np.array([])
    frames = frames - frames.mean(axis=1, keepdims=True)
    nfft = 1 << (2 * win - 1).bit_length()
    F = np.fft.rfft(frames, nfft, axis=1)
    ac = np.fft.irfft(F * np.conj(F), nfft, axis=1)[:, :win]
    # Difference function d(tau) ~ 2*(r0 - r(tau)), cumulative-mean normalised.
    d = 2 * (ac[:, :1] - ac)
    d[:, 0] = 0
    cs = np.cumsum(d[:, 1:], axis=1)
    taus = np.arange(1, win)
    cmnd = np.ones_like(d)
    cmnd[:, 1:] = d[:, 1:] * taus / np.maximum(cs, 1e-12)
    lo, hi = int(sr / fmax), int(sr / fmin)
    seg = cmnd[:, lo:hi]
    f0 = []
    for row in seg:
        below = np.nonzero(row < 0.2)[0]
        if len(below):
            k = below[0]
            while k + 1 < len(row) and row[k + 1] < row[k]:
                k += 1
        else:
            k = int(np.argmin(row))
            if row[k] > 0.30:
                continue
        tau = lo + k
        if 1 <= k < len(row) - 1:  # parabolic refinement
            a, b, c = row[k - 1], row[k], row[k + 1]
            den = a - 2 * b + c
            if den != 0:
                tau = lo + k + 0.5 * (a - c) / den
        f0.append(sr / tau)
    return np.array(f0)


def edge_silence(x, sr, thr_db=-50.0):
    env = moving_rms(x, sr * 0.010)
    above = np.nonzero(env > 10 ** (thr_db / 20))[0]
    if len(above) == 0:
        return len(x) / sr, len(x) / sr
    return above[0] / sr, (len(x) - 1 - above[-1]) / sr


def cmd_analyze(spec):
    sr = 16000
    out = {}
    for item in spec["files"]:
        x = decode(item["file"], 44100)
        lead, tail = edge_silence(x, 44100)
        y = decode(item["file"], sr)
        f0 = f0_track(y, sr)
        res = {
            "seconds": round(len(x) / 44100, 3),
            "samplePeakDb": round(db(np.max(np.abs(x)) if len(x) else 0), 2),
            "clippedSamples": int(np.sum(np.abs(x) >= 0.999)),
            "leadSilence": round(lead, 3),
            "tailSilence": round(tail, 3),
            "lufs": round(integrated_loudness(x, 44100), 2),
            "truePeak": round(true_peak_db(x), 2),
        }
        if len(f0) >= 10:
            p10, p50, p90 = np.percentile(f0, [10, 50, 90])
            res.update(
                {
                    "f0Median": round(float(p50), 1),
                    "f0P10": round(float(p10), 1),
                    "f0P90": round(float(p90), 1),
                    "f0RangeSt": round(float(12 * np.log2(p90 / p10)), 2),
                    "voicedFrames": int(len(f0)),
                }
            )
        out[item["id"]] = res
    return out


# -------------------------------------------------------------------------- asr


def _transcribe(model, audio):
    segs, _info = model.transcribe(
        audio,
        language="ru",
        beam_size=5,
        temperature=0.0,
        condition_on_previous_text=False,
        vad_filter=False,
        word_timestamps=True,
        hallucination_silence_threshold=0.6,
    )
    texts, words = [], []
    for s in segs:
        texts.append(s.text.strip())
        for w in s.words or []:
            words.append({"w": w.word.strip(), "start": round(w.start, 2), "end": round(w.end, 2)})
    return " ".join(texts), words


def cmd_asr(spec):
    """Transcribe items. With pack=true, short items share one 30 s Whisper
    window (the encoder cost is per window) and words are mapped back by time."""
    from faster_whisper import WhisperModel

    model = WhisperModel(
        spec.get("model", "large-v3-turbo"),
        device="cpu",
        compute_type="int8",
        download_root=spec.get("downloadRoot"),
    )
    sr = 16000
    items = [
        (it, decode(it["file"], sr, it.get("rawSampleRate")).astype(np.float32)) for it in spec["files"]
    ]
    out = {}
    if not spec.get("pack"):
        for it, audio in items:
            text, words = _transcribe(model, audio)
            out[it["id"]] = {"text": text, "words": words}
        return out

    gap, max_len = int(1.5 * sr), int(26 * sr)
    groups, cur, cur_len = [], [], 0
    for it, audio in items:
        if cur and cur_len + gap + len(audio) > max_len:
            groups.append(cur)
            cur, cur_len = [], 0
        cur.append((it, audio))
        cur_len += len(audio) + gap
    if cur:
        groups.append(cur)
    for group in groups:
        pieces, spans, pos = [], [], 0
        for it, audio in group:
            pieces += [audio, np.zeros(gap, dtype=np.float32)]
            spans.append((it["id"], pos / sr, (pos + len(audio)) / sr))
            pos += len(audio) + gap
        _text, words = _transcribe(model, np.concatenate(pieces))
        for item_id, t0, t1 in spans:
            mine = [w for w in words if t0 - 0.6 <= (w["start"] + w["end"]) / 2 <= t1 + 0.6]
            out[item_id] = {
                "text": " ".join(w["w"] for w in mine),
                "words": [{**w, "start": round(w["start"] - t0, 2), "end": round(w["end"] - t0, 2)} for w in mine],
            }
    return out


# ------------------------------------------------------------------------- main

COMMANDS = {"synth": cmd_synth, "assemble": cmd_assemble, "analyze": cmd_analyze, "asr": cmd_asr}

if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] not in COMMANDS:
        raise SystemExit(f"usage: voice_tools.py <{'|'.join(COMMANDS)}> spec.json")
    with open(sys.argv[2], encoding="utf-8") as f:
        spec_in = json.load(f)
    result = COMMANDS[sys.argv[1]](spec_in)
    sys.stdout.write(json.dumps(result, ensure_ascii=False))
