# HANDOFF — Synthixx "Business Meets Technology" video engine (engine3)
Read this first, then docs/PROJECT_DOCS.md. You are continuing work another Claude started. The owner is Jawad Zaheer Kayani (Synthixx Technologies, Pakistan, Windows PC).

## How to talk to Jawad
- Reply in SHORT Roman Urdu, few tokens, zero filler. You decide design/workflow yourself. Be honest about gaps (never claim a render is good if frames show problems). Show him the output file + a brief summary.
- He tests only 30 s videos (full-length tests only when he asks). He will run heavy tests on his own PC later; the sandbox is 2 CPU, software GL, so renders are slow (~150-290 s per 326-frame chunk at 60 fps, 1080x1920).

## Non-negotiable video rules
1. Faceless. NO name, DP, corner brackets, watermarks or the old design inside videos.
2. Every video uses a morphism-style look (glass, clay, neumorphism, holo, skeuomorphism, liquid) or the signature **brand** theme. ZERO FLAT DESIGN: 3D depth, layered UI, physics motion.
3. SHOW WHAT IS SAID: every spoken idea appears as a literal visual at that moment. Key-word-only kinetic captions. NO invented stats/testimonials (made-up examples must be labelled).
5. Fully deterministic: everything is a function of integer global frames (`globalTime = frame/fps`); no Math.random, no timers, no chunk-local resets (seeded mulberry32 only).
6. 9:16 Shorts and up to 20-min 16:9 videos. Engine: Hyperframes (HTML->video, GSAP paused timelines) + Kokoro TTS + FFmpeg.

## Architecture (this folder)
Script -> `audio/` Kokoro voice + word timings (WhisperX if available, else estimated, flagged `source:"estimated"`) -> `intelligence/` entityResolver (logos via simple-icons+sharp, rembg cutouts, AssetRecord manifest) -> narrative extractor (clauses, Subject+Action+Object) -> choreographer / **brandChoreographer** (JSON Scene Graph ONLY, never raw render code) with visual memory/novelty scorer -> `core/compiler/validateScene.ts` (Zod `schemas/scene.schema.ts`, structured repair errors) + `intelligence/repair.ts` (auto-repair, max 3 retries, safe fallback) -> `visual/` composer builds Hyperframes sub-compositions (`visual/sceneComposer.ts`, materials in `visual/materials/`, components in `visual/interfaces|objects|archetypes`) -> `cinematic/` grain/vignette/dust -> `audio/soundDesign.ts` procedural SFX + pad + voice-keyed ducking -> `rendering/` chunked renderer (global-frame chunks + handles, worker pool 1-4, content-hash cache, crash recovery, ffmpeg assembly), `qa.ts` technical QA, `visualSelfQA.py` (60 px safe zone, contrast >=3:1, palette audit, auto typeScale fix).
6 brand archetypes: `visual/archetypes/` BrandAnchorCore, OrbitalToolHub, CardDeckFan3D, SplineRoadmap3D, KineticWordSync, InteractiveUISimulator (TypeScript modules, not React).

## Run
```
bash setup.sh                       # installs everything (see below)
export HYPERFRAMES_BROWSER_PATH=/usr/bin/google-chrome   # or any chromium binary
npx tsx cli.ts --script test_script.txt --morphism brand --ratio 9:16 --fps 60 --workers 2 --publish projects
# options: --morphism glass|clay|neumorphism|holo|skeuomorphism|liquid|brand  --ratio 9:16|16:9  --fps 24|30|60
#          --chunk-frames 300  --quality draft|looks|delivery  --budget <sec>  (time-boxed; re-run to resume from cache)
#          --audio user.wav  --images dir  --no-music  --no-cinematic  --strict-qa
npx tsx tests/phase1.test.ts && python3 tests/visualSelfQA.test.py     # unit tests
```
If a render is paused (exit 3) simply re-run the same command: finished chunks come from `out/<name>/cache`.

## Status (14 Nov 2026)
Done and verified: Phase 1 schema+compiler (11/11 tests), Phase 2 materials+interfaces+adaptive layout, Phase 3 aligner/resolver/director/repair, Phase 4 cinematic/sound/renderer/QA/CLI, brand theme + 6 archetypes + Visual Self-QA (5/5 tests). Last render: test_script.txt, brand, 9:16 60fps 27 s, all gates passed (contrast WARN scene_03/04).
Known gaps (fix next): bottom ~25% of the 9:16 frame is empty (content clusters in the upper/middle area); UI-simulator task labels clip ("Right now auton…"); anchor cube small; roadmap/card text small; red text on pink glow low contrast; WhisperX not runnable in the old sandbox (estimated word timing) — runs on his PC; OpenAI logo not in simple-icons (glyph chip fallback); no LLM provider (director is rule-based; interface only); dashboard/metric show 0 when script has no number; Windows PC: use `python` not `python3`, adjust Chrome path.
Jawad will send 4 "engine upgrade" phase prompts (written with Gemini) one at a time: build each, test lightly, report. Heavy testing happens on his PC, so build to the prompt spec exactly.

## Other pieces (not in this zip, may need re-creating)
- Old Kokoro engine `mengine/` (engine/tts.py etc.) is bundled as `mengine/`; models download via `python mengine/get_models.py` (~340 MB, needs GitHub access).
- Hyperframes CLI: `npx hyperframes ...` (installed by npm). Skills (hyperframes, lemo-opuscar, open-design, motion-skills, synthixx-* skills) lived in Jawad's old account; re-install/upload them if wanted, they are not needed to run this engine.
- Older experiments (three/swiss/glass/agent generators) are not needed.
