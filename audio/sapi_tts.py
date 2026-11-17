#!/usr/bin/env python3
"""Windows SAPI TTS fallback. Generates voice.wav + voice.json with estimated word timings."""
import sys, os, re, json, wave, struct
import win32com.client

script_path = sys.argv[1]
out_dir = sys.argv[2]
voice_name = sys.argv[3] if len(sys.argv) > 3 else "Microsoft David Desktop"
speed = float(sys.argv[4]) if len(sys.argv) > 4 else 1.0

os.makedirs(out_dir, exist_ok=True)
text = open(script_path, encoding='utf8').read().strip()

# Use SAPI to synthesize speech to WAV
speaker = win32com.client.Dispatch("SAPI.SpVoice")
# Find the voice
for v in speaker.GetVoices():
    if voice_name.lower() in v.GetDescription().lower():
        speaker.Voice = v
        break

# Set rate (SAPI rate is -10 to 10, map speed 0.5-2.0 to -5 to 5)
speaker.Rate = int((speed - 1.0) * 5)

# Save to WAV
stream = win32com.client.Dispatch("SAPI.SpFileStream")
stream.Open(os.path.join(out_dir, "voice.wav"), 3)  # 3 = SSFMCreateForWrite
speaker.AudioOutputStream = stream
speaker.Speak(text)
stream.Close()

# Generate estimated word timings (SAPI doesn't provide word-level timestamps easily)
words = text.replace("—", " ").split()
sr = 24000
# Estimate duration from WAV file
import wave
wf = wave.open(os.path.join(out_dir, "voice.wav"), 'rb')
total_dur = wf.getnframes() / wf.getframerate()
wf.close()

# Distribute words evenly across duration
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

print(f"Generated voice.wav ({total_dur:.1f}s) with {len(est_words)} words using SAPI")
