# Phase 3 — Storyboard QA, resumable chunks, Brand Studio

## Faster workflow (use this first)
1. `npx tsx cli.ts --script s.txt --preset playful_clay --ratio 16:9 --storyboard-only`  
   Renders start/mid/end STILLS of every scene + a contact sheet (`out/<job>/storyboard/contact_sheet.png`) in ~10–40 s, runs Tier-1/Tier-2 QA and auto-repairs layout. No video is rendered.
2. Happy with the sheet? Run the same command without `--storyboard-only`. Only then chunks render.
3. Re-run any time: chunks are content-addressed, so only changed scenes re-render. Interrupted? Re-run the same command (or use `--budget <sec>` to time-box; exit code 3 = paused, resume by re-running).

## CLI additions
`--preset <apple_minimal|cyberpunk_holo|fintech_emerald|playful_clay|noir_documentary>` · `--theme-file <BrandThemeTokens.json>` · `--storyboard-only` · `--no-qa` · `--jobs-root projects` · `--job-id <id>`

## Modules
- `visual/materials/themeBridge.ts` BrandThemeTokens → live palette + Profile (archetypes read `BRAND.*` getters / `c.profile.vars`; no hard-coded colours).
- `rendering/storyboard.ts` Playwright stills + DOM probe + contact sheet.
- `rendering/visualQA.ts` Tier-1 (safe zone, L2 overlap, clipping, fonts/assets/hashes, NaN, partition, A/V ≤1 frame) and Tier-2 (sampled contrast) + `LayoutRepair` (`move|resize|shorten-copy|add-scrim`), ≤2 retries, rollback.
- `rendering/chunkOrchestrator.ts` key = sha256(sceneSlice, resolvedThemeHash, assetHashes, bakeHashes, rendererVersion); atomic `projects/<jobId>/manifest.json`; verify (key/size/sha/frames) on resume; gpu-heavy ×1, cpu-dom ×3; `-c copy` concat + one audio mux.
- `apps/studio` zero-dependency server: `npx tsx apps/studio/server.ts` → http://localhost:3000

## Tests
`npx tsx tests/test-phase3.ts` (needs the two E2E outputs; it renders them if missing — slow on 2 CPUs).

## Known limits (honest)
- Hyperframes CLI cannot receive piped frames; chunks are rendered by Hyperframes to a file, then stream-copied. The Playwright→FFmpeg pipe path exists (`captureChunkRenderer`) but is not the default.
- WhisperX absent in the sandbox → word timing estimated; Kokoro model must be present on your PC (`mengine`) or a cached `voice.wav/voice.json` is reused (keyed by script+voice+speed).
- 4 GB VRAM behaviour is enforced by scheduling (one gpu-heavy chunk at a time) but not measured here.
- Legacy pixel QA (`visualSelfQA.py`, 3-colour palette) is skipped for themed runs; Tier-1/2 QA replaces it.
