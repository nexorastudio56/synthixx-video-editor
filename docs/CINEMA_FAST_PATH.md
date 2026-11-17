# Cinema fast path (16:9, 1080p, 60 fps)
cinema/script.txt -> `python3 audio/kokoro_direct.py cinema/script.txt cinema/work am_adam 0.97`
cinema/page.html (GSAP paused timeline, word-timed via A('word')) -> `node compose.mjs` -> `node probe.mjs` (bounds QA every 0.25s) -> `node shots.mjs <frames>` (stills) -> `node cues.mjs` -> `node render.mjs` (2 Chromium workers, JPEG->x264 chunks, concat -c copy) -> `python3 mixaudio.py` (seeded SFX + pad, ducked, -16 LUFS) -> mux.
Measured: 1800 frames @1080p in 172 s (10.5 fps) on 2 CPUs; the old Hyperframes chunk path needed ~25 min for 58 s.
