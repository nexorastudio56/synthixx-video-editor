#!/usr/bin/env python3
"""Offline emphasis analysis. usage: emphasis_features.py <mono_wav> <words.json> <fps> <out.json>
Features: normalized RMS (dB, p10..p95 over speech) + half-wave-rectified spectral flux (100 Hz-6 kHz, log-compressed, p95-normalized),
aggregated per VIDEO frame, then per word (peak) -> rank -> blended with a lexical prior -> impact words. Output is a frame-indexed track in [0,1].
Pure numpy/scipy, no randomness: identical input gives identical bytes."""
import json, sys, hashlib
import numpy as np
from scipy.io import wavfile

VERSION = "emphasis-1"
ATTACK, DECAY, THRESH, MIN_GAP = 0.05, 0.30, 0.72, 0.9
BASE_CAP = 0.6
TECH = {"openai", "python", "github", "gpt", "api", "chatgpt", "claude", "automation", "agent", "browser", "terminal", "workflow", "productivity"}

def load(path):
    sr, x = wavfile.read(path)
    x = x.astype(np.float64)
    if x.ndim > 1: x = x.mean(axis=1)
    peak = np.max(np.abs(x)) or 1.0
    if x.dtype.kind in "iu" or peak > 1.5: x = x / 32768.0
    return sr, x

def stft_features(x, sr):
    n_fft, hop = 1024, max(1, sr // 200)                       # 5 ms hop
    pad = np.pad(x, (n_fft // 2, n_fft // 2))
    n = 1 + (len(pad) - n_fft) // hop
    idx = np.arange(n_fft)[None, :] + hop * np.arange(n)[:, None]
    fr = pad[idx] * np.hanning(n_fft)[None, :]
    mag = np.abs(np.fft.rfft(fr, axis=1))
    freqs = np.fft.rfftfreq(n_fft, 1.0 / sr)
    band = (freqs >= 100) & (freqs <= 6000)
    lm = np.log1p(mag[:, band] * 10.0)
    flux = np.zeros(n); flux[1:] = np.maximum(0.0, lm[1:] - lm[:-1]).sum(axis=1)
    rms = np.sqrt((fr ** 2).mean(axis=1) + 1e-12); db = 20 * np.log10(rms + 1e-9)
    return hop, db, flux

def norm_rms(db):
    speech = db > -50.0
    if speech.sum() < 10: return np.zeros_like(db)
    lo, hi = np.percentile(db[speech], 10), np.percentile(db[speech], 95)
    return np.clip((db - lo) / max(hi - lo, 1e-6), 0.0, 1.0) * speech

def norm_flux(flux, speech):
    ref = np.percentile(flux[speech], 95) if speech.sum() else 1.0
    return np.clip(flux / max(ref, 1e-9), 0.0, 1.0)

def per_frame(vals, hop, sr, fps, nframes, reducer):
    t = np.arange(len(vals)) * hop / sr
    out = np.zeros(nframes)
    f_idx = np.floor(t * fps + 0.5).astype(int)  # nearest video frame
    f_idx = np.clip(f_idx, 0, nframes - 1)
    for f in range(nframes):
        sel = vals[f_idx == f]
        out[f] = reducer(sel) if sel.size else 0.0
    return out

def prior(words, i):
    w = words[i]["w"]; core = "".join(ch for ch in w if ch.isalnum())
    p = 0.0
    if any(ch.isdigit() for ch in core): p += 0.55
    if len(core) >= 2 and core.isupper(): p += 0.35
    if core.lower() in TECH: p += 0.3
    if w[-1:] in ".!?" and len(core) >= 4: p += 0.25
    if w[-1:] == "!": p += 0.2
    if i == 0 or words[i - 1]["w"][-1:] in ".!?": p += 0.15
    if len(core) >= 8: p += 0.15
    return min(1.0, p)

def main():
    wav, wj, fps, out = sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4]
    words = json.load(open(wj))
    sr, x = load(wav)
    dur = len(x) / sr
    nframes = int(np.ceil(dur * fps)) + 1
    hop, db, flux = stft_features(x, sr)
    rn = norm_rms(db); fn = norm_flux(flux, db > -50.0)
    rms_f = per_frame(rn, hop, sr, fps, nframes, np.mean)
    flux_f = per_frame(fn, hop, sr, fps, nframes, np.max)
    energy = 0.5 * rms_f + 0.5 * flux_f
    peaks = []
    for w in words:
        a = max(0, int(np.floor(w["start"] * fps))); b = min(nframes - 1, int(np.ceil(w["end"] * fps)))
        seg = energy[a:b + 1]
        peaks.append(float(seg.max()) if seg.size else 0.0)
    peaks = np.array(peaks)
    order = peaks.argsort(kind="stable"); rank = np.empty(len(peaks)); rank[order] = np.arange(len(peaks)) / max(1, len(peaks) - 1)
    rows = []
    for i, w in enumerate(words):
        pr = prior(words, i)
        score = float(np.clip(0.55 * rank[i] ** 1.5 + 0.62 * pr + 0.08, 0.0, 1.0))
        rows.append({"i": i, "w": w["w"], "start": round(w["start"], 4), "end": round(w["end"], 4), "startFrame": int(round(w["start"] * fps)), "endFrame": int(round(w["end"] * fps)),
                     "peakEnergy": round(float(peaks[i]), 4), "rank": round(float(rank[i]), 4), "prior": round(pr, 4), "score": round(score, 4), "impact": False})
    cand = sorted([r for r in rows if r["score"] > THRESH], key=lambda r: (-r["score"], r["i"]))
    chosen = []
    for r in cand:
        if all(abs(r["start"] - c["start"]) >= MIN_GAP for c in chosen): chosen.append(r)
    for r in chosen: r["impact"] = True
    impacts = [{"frame": r["startFrame"], "wordIndex": r["i"], "score": r["score"]} for r in sorted(chosen, key=lambda r: r["startFrame"])]
    track = np.minimum(energy * BASE_CAP, BASE_CAP)
    for im in impacts:
        o = im["frame"]; s = im["score"]
        for f in range(max(0, o), min(nframes, o + int(np.ceil((ATTACK + DECAY) * fps)) + 1)):
            tau = (f - o) / fps
            v = s * np.sin(np.pi / 2 * tau / ATTACK) if tau < ATTACK else s * np.cos(np.pi / 2 * (tau - ATTACK) / DECAY) ** 2 if tau < ATTACK + DECAY else 0.0
            track[f] = max(track[f], v)
    values = [round(float(v), 4) for v in np.clip(track, 0.0, 1.0)]
    doc = {"version": VERSION, "fps": fps, "sampleRate": sr, "durationFrames": nframes, "threshold": THRESH, "attackSec": ATTACK, "decaySec": DECAY, "minGapSec": MIN_GAP,
           "values": values, "words": rows, "impacts": impacts}
    doc["sha256"] = hashlib.sha256(json.dumps(values, separators=(",", ":")).encode()).hexdigest()
    json.dump(doc, open(out, "w"), separators=(",", ":"))

main()
