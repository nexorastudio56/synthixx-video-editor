#!/usr/bin/env python3
"""Santa voice TTS using SAPI with SSML pitch adjustment."""
import sys, os, re, json, wave
import win32com.client

script_path = sys.argv[1]
out_dir = sys.argv[2]
os.makedirs(out_dir, exist_ok=True)
text = open(script_path, encoding='utf8').read().strip()

# Use SAPI with SSML for Santa-like voice (lower pitch)
speaker = win32com.client.Dispatch("SAPI.SpVoice")
for v in speaker.GetVoices():
    if "david" in v.GetDescription().lower():
        speaker.Voice = v
        break

speaker.Rate = -1  # Slightly slower for Santa

# Wrap text in SSML for pitch adjustment (lower pitch for Santa)
ssml = f'<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US"><prosody pitch="-15%">{text}</prosody></speak>'

stream = win32com.client.Dispatch("SAPI.SpFileStream")
stream.Open(os.path.join(out_dir, "voice.wav"), 3)
speaker.AudioOutputStream = stream
speaker.Speak(ssml, 8)  # 8 = SVSFIsXML
stream.Close()

# Generate estimated word timings
wf = wave.open(os.path.join(out_dir, "voice.wav"), 'rb')
total_dur = wf.getnframes() / wf.getframerate()
wf.close()

words = text.replace("—", " ").split()
t = 0.3
est_words = []
for w in words:
    dur = max(0.15, len(w) * 0.06)
    est_words.append({"w": w, "start": round(t, 3), "end": round(t + dur * 0.9, 3), "conf": 0.7})
    t += dur
    if t > total_dur - 0.3:
        t = total_dur - 0.3

phrases = [{"text": text, "start": 0.3, "end": t}]
with open(os.path.join(out_dir, "voice.json"), "w") as f:
    json.dump({"phrases": phrases, "words": est_words, "total": total_dur}, f, indent=2)

print(f"Generated Santa voice.wav ({total_dur:.1f}s) with {len(est_words)} words")
