#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
npm install
pip install --break-system-packages scipy pillow numpy rembg onnxruntime kokoro-onnx soundfile 2>/dev/null || pip install scipy pillow numpy rembg onnxruntime kokoro-onnx soundfile
( cd mengine/m2 && [ -f package.json ] && npm install || true )
python3 mengine/get_models.py || echo "Kokoro model download failed: needs internet/GitHub; run again later"
command -v ffmpeg >/dev/null || echo "WARNING: install ffmpeg"
echo "Set HYPERFRAMES_BROWSER_PATH to a chromium/chrome binary before rendering."
