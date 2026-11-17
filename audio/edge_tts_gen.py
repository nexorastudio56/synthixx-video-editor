#!/usr/bin/env python3
"""Edge TTS - uses Microsoft Edge's online TTS service."""
import sys, os, json, asyncio

# Import at top level
import edge_tts
import subprocess
import wave

async def generate():
    script_path = sys.argv[1]
    out_dir = sys.argv[2]
    voice = sys.argv[3] if len(sys.argv) > 3 else "en-US-JennyNeural"
    rate = sys.argv[4] if len(sys.argv) > 4 else "+0%"
    
    os.makedirs(out_dir, exist_ok=True)
    text = open(script_path, encoding='utf8').read().strip()
    
    communicate = edge_tts.Communicate(text, voice, rate=rate)
    await communicate.save(os.path.join(out_dir, "voice.mp3"))
    
    # Convert MP3 to WAV for pipeline compatibility
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", os.path.join(out_dir, "voice.mp3"),
                    "-acodec", "pcm_s16le", "-ar", "24000", "-ac", "1",
                    os.path.join(out_dir, "voice.wav")], check=True)
    
    # Generate estimated word timings
    words = text.replace("—", " ").split()
    wf = wave.open(os.path.join(out_dir, "voice.wav"), 'rb')
    total_dur = wf.getnframes() / wf.getframerate()
    wf.close()
    
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
    
    print(f"Generated voice with {voice} ({total_dur:.1f}s) with {len(est_words)} words")

if __name__ == "__main__":
    # Use nest_asyncio if available, otherwise use basic approach
    try:
        import nest_asyncio
        nest_asyncio.apply()
    except ImportError:
        pass
    
    asyncio.run(generate())
