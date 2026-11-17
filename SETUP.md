# Synthixx Video Editor — Setup Guide

## Prerequisites

### Required Software

| Software | Version | Download |
|----------|---------|----------|
| Node.js | 18+ | https://nodejs.org |
| ffmpeg | 4+ | https://ffmpeg.org/download.html |
| Python | 3.10+ | https://python.org |
| Google Chrome | Latest | https://google.com/chrome |

### Python Packages (for TTS)

```bash
pip install kokoro-onnx soundfile numpy scipy
# Optional (for better TTS):
pip install edge-tts gTTS pyttsx3
```

### Kokoro TTS Model (Optional, for high-quality voice)

Download from HuggingFace:
```bash
# Model file (340MB)
# Place in: ~/vo/kokoro-v1.0.onnx and ~/vo/voices-v1.0.bin
# Or set KOKORO_DIR environment variable
```

## Installation

### 1. Clone Repository

```bash
git clone https://github.com/YOUR_USERNAME/synthixx-video-editor.git
cd synthixx-video-editor/engine3
```

### 2. Install Node Dependencies

```bash
npm install
```

### 3. Verify Setup

```bash
# Type check
npm run typecheck

# Run manifest tests
npm run test:manifest

# Verify ffmpeg
ffmpeg -version

# Verify Chrome
# Windows: C:\Program Files\Google\Chrome\Application\chrome.exe
# Linux: /usr/bin/google-chrome
```

### 4. Environment Variables (Optional)

```bash
# Windows PowerShell
$env:HYPERFRAMES_BROWSER_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$env:KOKORO_DIR = "C:\path\to\kokoro\models"

# Linux/macOS
export HYPERFRAMES_BROWSER_PATH="/usr/bin/google-chrome"
export KOKORO_DIR="/path/to/kokoro/models"
```

## Quick Start

### Generate Your First Video

```bash
# 1. Create a script file
echo "NVIDIA just shipped the future of AI chips. Jensen Huang says accelerated computing changes everything." > my_script.txt

# 2. Generate the video
npx tsx produce.ts --script my_script.txt --ratio 9:16 --theme white-editorial --out out/my_video

# 3. Your video is at: out/my_video.mp4
```

### Use the Studio UI

```bash
npm run studio
# Open http://localhost:3000 in your browser
```

### Generate Voice MP3 Only

```bash
# Santa voice
python audio/santa_tts.py script.txt out/voice_dir

# Bella voice (Edge TTS, 1.15x speed)
python audio/edge_tts_gen.py script.txt out/voice_dir en-US-JennyNeural +15%

# Trim silence and convert to MP3
ffmpeg -i voice_dir/voice.wav -af "silenceremove=start_periods=1:start_duration=0.1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_duration=0.1:start_threshold=-50dB,areverse" -acodec libmp3lame -q:a 2 voice.mp3
```

## Troubleshooting

### "python3 not found" (Windows)
Use `python` instead of `python3`. The engine auto-detects the correct Python executable.

### "Kokoro synthesis failed"
Kokoro model files are missing. The engine falls back to:
1. SAPI (Windows built-in TTS)
2. Edge TTS (online, requires internet)
3. Silent audio with estimated timing

### "No Chrome/Chromium found"
Set `HYPERFRAMES_BROWSER_PATH` to your Chrome executable path.

### "npx hyperframes not found"
Install hyperframes globally: `npm install -g hyperframes`
Or use the Playwright capture renderer (default in produce.ts).

### Render is slow
- Reduce FPS: `--fps 30` instead of `--fps 60`
- Reduce quality: `--quality draft`
- Use fewer workers: `--workers 2`

## Performance

| Metric | Value |
|--------|-------|
| 60s video @ 1080×1920 60fps | ~3-5 minutes |
| 60s video @ 1080×1920 30fps | ~2-3 minutes |
| Voice synthesis (SAPI) | ~10s/60s |
| Voice synthesis (Edge TTS) | ~15s/60s |
| Voice synthesis (Kokoro) | ~2min/60s |

## Platform Support

| Platform | Status | Notes |
|----------|--------|-------|
| Windows 10/11 | ✅ Full | Use `python` not `python3` |
| Linux | ✅ Full | `python3` works natively |
| macOS | ⚠️ Untested | Should work with adjustments |

---

**Synthixx Video Editor — 50× faster. Every frame is code. Every scene is cinematic.**
