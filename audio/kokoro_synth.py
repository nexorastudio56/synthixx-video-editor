#!/usr/bin/env python3
"""Kokoro TTS via the existing mengine setup (no reinstall). Usage: kokoro_synth.py script.txt out_dir [voice] [speed]
Writes out_dir/voice.wav and out_dir/voice.json  {phrases:[{text,start,end}], words:[{w,start,end,conf,est}]}"""
import sys, os, re, json, subprocess, shutil
ME = os.environ.get('MENGINE', os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'mengine'))
script, out = sys.argv[1], sys.argv[2]
voice = sys.argv[3] if len(sys.argv) > 3 else 'am_adam'
speed = float(sys.argv[4]) if len(sys.argv) > 4 else 1.05
os.makedirs(out, exist_ok=True)
text = open(script, encoding='utf8').read().strip()
sents = [s.strip() for s in re.split(r'(?<=[.!?])\s+', text) if s.strip()]
phr = []
for s in sents:
    parts = [p.strip() for p in re.split(r'(?<=,)\s+|(?<=—)\s*|\s+—\s*', s) if p.strip()]
    cur = ''
    for p in parts:   # merge tiny fragments, keep phrases 4-14 words
        if cur and len((cur + ' ' + p).split()) > 14: phr.append(cur); cur = p
        else: cur = (cur + ' ' + p).strip()
    if cur: phr.append(cur)
spoken = [re.sub(r'\b(\d+)x\b', lambda m: m.group(1) + ' x', p).replace('—', ', ') for p in phr]
slug = 'e3_synth'
js = {"title": "e3", "slug": slug, "theme": "synthixx", "fps": 30, "captions": "key", "voice": {"voice": voice, "speed": speed, "gap": 0.18}, "music": {"mood": "cinematic", "level": 0.0}, "lufs": -14,
      "scenes": [{"comp": "x", "pre": 0.3, "say": spoken}]}
sp = os.path.join(ME, 'scripts', slug + '.json'); json.dump(js, open(sp, 'w'))
subprocess.run([sys.executable, 'm2/make2.py', sp, '--audio'], cwd=ME, check=True, stdout=subprocess.DEVNULL)
sys.path[:0] = [os.path.join(ME, 'engine'), os.path.join(ME, 'm2')]
os.chdir(os.path.join(ME, 'engine'))
import timeline, themes
scr = timeline.load(os.path.join(ME, 'out', slug, '_old.json')); themes.use_theme(scr['theme'])
sc, total, ch = timeline.build(scr)
ph = sc[0].ph
def syl(w): return max(1, len(re.findall(r'[aeiouy]+', re.sub(r'e$', '', w.lower()))))
words = []
for p, orig in zip(ph, phr):
    toks = orig.split(); wts = [syl(re.sub(r'\W', '', t)) + 0.6 + (0.5 if t[-1:] in ',.!?' else 0) for t in toks]
    span = p['end'] - p['start']; tot = sum(wts); t = p['start']
    for tk, w in zip(toks, wts):
        d = span * w / tot; words.append({"w": tk, "start": round(t, 3), "end": round(t + d * 0.92, 3), "conf": 0.6, "est": True}); t += d
shutil.copy(os.path.join(ME, 'out', slug, 'audio.wav'), os.path.join(out, 'voice.wav'))
# voice-only track (music level 0 above)
json.dump({"phrases": [{"text": o, "start": round(p['start'], 3), "end": round(p['end'], 3)} for p, o in zip(ph, phr)], "words": words, "total": round(total, 3)}, open(os.path.join(out, 'voice.json'), 'w'), indent=1)
print(json.dumps({"total": round(total, 3), "words": len(words), "phrases": len(ph)}))
