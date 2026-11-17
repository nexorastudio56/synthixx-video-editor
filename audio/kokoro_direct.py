#!/usr/bin/env python3
"""Standalone Kokoro TTS (kokoro-onnx; Windows & Linux compatible).
Model files: auto-detected from KOKORO_DIR or D:\\Desktop\\synthixx_engine\\mengine\\models
Writes voice.wav (mono 24 kHz) + voice.json {phrases, words, total}.
Word times are ESTIMATED (char-proportional inside each phrase, est=True).
"""
import sys, os, re, json
import numpy as np, soundfile as sf
from kokoro_onnx import Kokoro

script = sys.argv[1]
out = sys.argv[2]
voice = sys.argv[3] if len(sys.argv) > 3 else 'am_adam'
speed = float(sys.argv[4]) if len(sys.argv) > 4 else 0.97

candidate_dirs = [
    os.environ.get('KOKORO_DIR', ''),
    r"D:\Desktop\synthixx_engine\mengine\models",
    os.path.join(os.path.expanduser('~'), 'vo'),
    "/home/claude/vo"
]
D = None
for c in candidate_dirs:
    if c and os.path.exists(os.path.join(c, 'kokoro-v1.0.onnx')):
        D = c
        break

if not D:
    raise FileNotFoundError("Could not find kokoro-v1.0.onnx in any known location")

os.makedirs(out, exist_ok=True)
k = Kokoro(os.path.join(D, 'kokoro-v1.0.onnx'), os.path.join(D, 'voices-v1.0.bin'))

text = open(script, encoding='utf8').read().strip()
sents = [s.strip() for s in re.split(r'(?<=[.!?])\s+', text) if s.strip()]
SR = 24000
PRE, GAP = 0.3, 0.18
audio = [np.zeros(int(PRE * SR), dtype=np.float32)]
t = PRE
phrases = []
words = []

for s in sents:
    y, sr = k.create(s.replace('—', ', '), voice=voice, speed=speed, lang='en-us')
    assert sr == SR
    y = y.astype(np.float32)
    dur = len(y) / SR
    toks = s.split()
    tot = sum(len(w) + 1 for w in toks)
    c = t
    for w in toks:
        d = dur * (len(w) + 1) / tot
        words.append({"w": w, "start": round(c, 3), "end": round(c + d * 0.92, 3), "conf": 0.6, "est": True})
        c += d
    phrases.append({"text": s, "start": round(t, 3), "end": round(t + dur, 3)})
    audio.append(y)
    audio.append(np.zeros(int(GAP * SR), dtype=np.float32))
    t += dur + GAP

y = np.concatenate(audio)
wav_path = os.path.join(out, 'voice.wav')
json_path = os.path.join(out, 'voice.json')
sf.write(wav_path, y, SR)
json.dump({"phrases": phrases, "words": words, "total": round(len(y) / SR, 3)}, open(json_path, 'w'))
print('ok', round(len(y) / SR, 2), 's', len(words), 'words')
