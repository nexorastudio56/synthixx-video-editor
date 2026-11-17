# Project docs ("motion graphics shorts") — verbatim copies from the old account's Project

## claude/pipeline-plan-v2.md
- Hyperframes = main engine. Lemo-Opuscar (artistic styles) + Open Design (templates) = secondary sources. Each long video -> ONLY 1 short. No PC zip until sandbox videos are good.
- Process per video: art direction -> story (3 storylines, pick one) -> SPEC.md (adjectives as numbers) -> build in Hyperframes (registry blocks first) -> verify (check, snapshot --review) -> fix -> render.
- Quality rubric: hook visual surprise in 2 s; every spoken idea shown literally; pattern interrupt <=25 s (long)/3 s (short); captions 1-3 key words, safe zones, no overlap; no fake stats (made-up examples labelled); natural voice; -14 LUFS, SFX on actions, music ducked; per-video look variety; click-worthy thumbnail; long: chapters, REMEMBER notes, challenge, next-video tease.
- Risks: sandbox render slow (software GL, 2 CPU); ffmpeg 6.1 vs lemo 7+; Whisper models unreachable here; PC GPU later.
- Sandbox needed HYPERFRAMES_BROWSER_PATH=<chrome binary> (e.g. /usr/bin/google-chrome or /opt/pw-browsers/chromium-*/chrome-linux64/chrome).

## claude/master-plan-v1.md (brand/shorts plan after 3 reference videos)
- References: 26-31 s, a new visual every 1-2 s, caption word changes every 0.4-0.6 s, ~-14 LUFS, captions 1-3 words (mixed weights, italic serif accent), one hero object per scene, light<->dark rhythm, dark scenes = twist beat, hook claim in 2 s, payoff last 3 s, loop ending, end card "Screenshot this".
- Captions: only key words; hero word pop 0.8->1.12->1.0; position never over the hero object; safe zone above bottom 22%.
- Motion: expo.out in, power2.inOut moves, no linear moves, slow camera drift, motion blur on fast moves, match-cut/object-carry transitions, 60 fps.
- Voice: natural American English with markers [pause .4] [hmm] [laugh] [sigh] [slow] [emph]; -14 LUFS; own voice later (Kokoro now).
- Script formula: Hook (0-2 s) -> tiny story with ONE labelled made-up example -> twist -> 3-step fix -> payoff loops to hook -> rotating CTA. Contractions, short lines, one bold opinion, no invented stats. 45-70 s for substance.
- QA gates: caption overlap, safe zone, reading speed (<=3 words/0.4 s), -14 LUFS, 60 fps, length.

## claude/rule-show-what-is-said.md — Director rule #1
Whatever the voice says must appear on screen at that exact moment as a literal visual, not only caption text ("closed door" -> real door swings shut; "three businesses" -> three shopfronts; "no invoice" -> blank invoice + NONE stamp ...). For every key word name the object/event that shows it; if none exists, build it first. Footage made with HTML/CSS/SVG. Corner handle = "Jawad Zaheer" + SX logo (NOTE: current rule for videos is: NO name/DP/corner brackets inside videos).

## claude/long-video-plan-v1.md
- Long video (8-12 min, 16:9 tutorial) = main product; 4-5 shorts cut from each (now: ONE short per long). Retention: cold open result + promise + light roast; open loop; chapters 60-90 s with pattern interrupt every 20-30 s; mid story labelled "EXAMPLE · MADE UP"; "Try this now" checkpoints; twist in last 20%; end recap + challenge + next-video tease.
- Tone: tough love. Roast the excuse/habit, never the person; motivation right after; ~1 roast : 3 encouragements.
- Tutorials need REAL screen recordings from Jawad; HTML UI replicas (labelled) otherwise. Voice: own voice is best for long videos.
- Engine needs: 16:9 1920x1080 @30, chapter bar, lower-thirds, PiP with zoom/callouts, chunked render.
- First 5 topics: (1) AI WhatsApp agent for a local business (no code); (2) professional business website in 1 day with AI; (3) website speed fix; (4) first 10 clients via Google Maps/Instagram; (5) freelancer -> agency, first $500 project.

## claude/long1-ai-whatsapp-agent.md
Long Video 1 "Build Your First AI WhatsApp Agent (Skill Businesses Pay For)", 16:9 ~5:00, Kokoro voice, ~720-word script with beats: 0:00 hook (WhatsApp chat auto-replying at 2 AM, BOOKED stamp) / 0:25 promise+loop / 0:50 step1 pick one boring business / 1:20 step2 ten questions (the twist) / 2:00 mid-story (EXAMPLE · MADE UP salon owner) / 2:35 step3 write instructions / 3:10 step4 connect (n8n/Make + WhatsApp Business) / 3:45 step5 break it on purpose / 4:15 roast+motivation / 4:40 challenge. Titles: "Learn This 5-Minute Skill Before Everyone Else Does" / "I Built an AI WhatsApp Agent. Here's the Exact Process" / "Stop Watching Tutorials. Build This Instead." 5 shorts to cut. (Full script text lives in the old Project; rewrite from this beat sheet if needed.)
