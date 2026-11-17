#!/usr/bin/env python3
"""Optional WhisperX word alignment. Usage: whisperx_align.py audio.wav out.json [model=small.en]
Exits 3 when whisperx (or its models) is unavailable so the caller can fall back."""
import sys, json
try:
    import whisperx, torch
except Exception as e:
    print("whisperx unavailable:", e, file=sys.stderr); sys.exit(3)
wav, out = sys.argv[1], sys.argv[2]; model = sys.argv[3] if len(sys.argv) > 3 else 'small.en'
dev = 'cuda' if torch.cuda.is_available() else 'cpu'
try:
    m = whisperx.load_model(model, dev, compute_type='float16' if dev == 'cuda' else 'int8')
    a = whisperx.load_audio(wav); r = m.transcribe(a, language='en')
    am, meta = whisperx.load_align_model(language_code='en', device=dev)
    r = whisperx.align(r['segments'], am, meta, a, dev, return_char_alignments=False)
except Exception as e:
    print("whisperx failed:", e, file=sys.stderr); sys.exit(3)
words = [{"w": w['word'], "start": w.get('start'), "end": w.get('end'), "conf": w.get('score', 0)} for s in r['segments'] for w in s['words']]
json.dump(words, open(out, 'w'))
