/** Phase 3 verification: theme wiring, storyboard + 2-tier QA + LayoutRepair, resumable orchestrator (72,000 frames, real SIGKILL), Studio, two-tenant E2E. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { chromium } from "playwright-core";
import { SceneGraph, CANVAS } from "../schemas/scene.schema.js";
import { composeScene } from "../visual/sceneComposer.js";
import { getBrandPalette } from "../visual/materials/brandTheme.js";
import { lookFor, compiledFor } from "../visual/materials/themeBridge.js";
import { getPreset, PRESET_IDS } from "../styles/presets.js";
import { geometryIssues, applyLayoutRepairs, planRepairs, LayoutRepair, safeBoxFor, staticIssues, conformAudio, ensureAssetHashes, runVisualQA, probeDurationSec } from "../rendering/visualQA.js";
import { keyFrames, type FrameProbe, type TextBox } from "../rendering/storyboard.js";
import { chunkContentKey, orchestrate, verifyChunk, manifestPath, atomicWriteJson, type Manifest } from "../rendering/chunkOrchestrator.js";
import { planSceneChunks, buildCostManifest } from "../rendering/resourceScheduler.js";
import { probe } from "../rendering/ffmpegPipeEncoder.js";
import { resolveChrome } from "../rendering/renderPipeline.js";
import { createServer } from "../apps/studio/server.js";
import { stubRenderer, longGraph } from "./fixtures/orchStub.js";

interface Row { name: string; ok: boolean; detail: string }
const rows: Row[] = []; const check = (name: string, ok: boolean, detail: string): void => { rows.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}: ${detail}`); };
const ROOT = path.resolve(import.meta.dirname, ".."), TMP = path.join(ROOT, "projects", "_phase3_test"); fs.rmSync(TMP, { recursive: true, force: true }); fs.mkdirSync(TMP, { recursive: true });
const sha = (s: string): string => crypto.createHash("sha256").update(s).digest("hex");
const loadGraph = (p: string): SceneGraph => SceneGraph.parse(JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8")));
const BASE = loadGraph("out/test_script_apple_minimal_9x16/scene.json");

/* ===== 1. theme wiring: one component set, any tenant ===== */
{
  const legacy = { ...BASE, theme: undefined } as SceneGraph; const red = BASE, clay = { ...BASE, theme: getPreset("playful_clay") } as SceneGraph;
  const sc = BASE.scenes[1]!;
  const hRed = composeScene(red, sc, {}).html, hClay = composeScene(clay, sc, {}).html, hLegacy = composeScene(legacy, sc, {}).html;
  const claySignal = compiledFor(getPreset("playful_clay")).modes[0]!.colors.accent.toUpperCase();
  check("1a themed render differs per tenant", hRed !== hClay && hClay.toUpperCase().includes(claySignal), `clay accent ${claySignal} present in clay scene html`);
  check("1b no hard-coded Synthixx red leaks into the clay tenant", !/230,\s*0,\s*0|#E60000|#FF1818/i.test(hClay), `leaks=${(hClay.match(/230,\s*0,\s*0|#E60000|#FF1818/gi) ?? []).length}`);
  check("1c composeScene is deterministic + palette is reset after compose", composeScene(clay, sc, {}).html === hClay && getBrandPalette().acc === "#E60000", `reset acc=${getBrandPalette().acc}`);
  check("1d legacy (no theme) path still the Synthixx red", /E60000|230,\s*0,\s*0/i.test(hLegacy), "legacy html keeps brand red");
  const alt = getPreset("playful_clay").backdrop.alternateModes; const l0 = lookFor(getPreset("playful_clay"), 0), l1 = lookFor(getPreset("playful_clay"), 1);
  check("1e primary/inverted alternate only when the theme asks for it", alt ? l0.mode !== l1.mode : l0.mode === l1.mode, `alternateModes=${alt} -> ${l0.mode}/${l1.mode}`);
  const all = PRESET_IDS.map(id => composeScene({ ...BASE, theme: getPreset(id) } as SceneGraph, sc, {}).html); check("1f all 5 presets compose on the same components", new Set(all).size === 5, `${new Set(all).size}/5 distinct`);
}

/* ===== 2. Tier-1 geometry (synthetic probes) ===== */
const box = safeBoxFor(BASE); const kindOf = new Map(BASE.scenes[0]!.entities.map(e => [e.id, e.kind] as const));
const l2id = BASE.scenes[0]!.entities.find(e => e.kind === "kinetic_words")!.id, heroId = BASE.scenes[0]!.entities.find(e => e.kind !== "kinetic_words" && e.kind !== "text")!.id;
const tb = (o: Partial<TextBox>): TextBox => ({ entityId: l2id, text: "hello", x: 200, y: 600, w: 300, h: 80, fg: "#000000", fgAlpha: 1, fontPx: 80, opacity: 1, clipped: false, ...o });
const pr = (boxes: TextBox[], o: Partial<FrameProbe> = {}): FrameProbe => ({ W: 1080, H: 1920, boxes, nan: [], fontOk: true, brokenImages: [], sceneId: "scene_01", kind: "mid", frame: 10, png: "", bgPng: "", contrast: [], ...o });
{
  const codes = (p: FrameProbe): string[] => geometryIssues(p, kindOf, box).map(i => i.code);
  check("2a safe box = theme margins as fractions of canvas (9:16)", Math.abs(box.x0 - BASE.theme!.layout.safeMarginX * 1080) < 0.5 && Math.abs(box.y0 - BASE.theme!.layout.safeMarginTop * 1920) < 0.5 && Math.abs(box.y1 - (1920 - BASE.theme!.layout.safeMarginBottom * 1920)) < 0.5, `[${box.x0.toFixed(0)},${box.y0.toFixed(0)},${box.x1.toFixed(0)},${box.y1.toFixed(0)}]`);
  check("2b clean text passes", codes(pr([tb({})])).length === 0, "no issues");
  check("2c text above top margin -> safe-zone", codes(pr([tb({ y: 100 })])).includes("safe-zone"), "y=100 < 269");
  check("2d text into bottom feed band -> safe-zone", codes(pr([tb({ y: 1500 })])).includes("safe-zone"), "y+h=1580 > 1536");
  check("2e hero (L1) text is exempt from the L2 safe zone", !codes(pr([tb({ entityId: heroId, y: 100 })])).includes("safe-zone"), "hero text allowed near edge");
  check("2f overlapping L2 boxes -> overlap", codes(pr([tb({}), tb({ x: 250, y: 620 })])).includes("overlap") && geometryIssues(pr([tb({}), tb({ x: 250, y: 620 })]), kindOf, box).some(i => /same-entity/.test(i.detail)), "overlap detected (same-entity tagged)");
  check("2g clipped text -> clip, off-canvas -> off-canvas", codes(pr([tb({ clipped: true })])).includes("clip") && codes(pr([tb({ x: 1000 })])).includes("off-canvas"), "both flagged");
  check("2h NaN transform / missing font / broken image", ["nan-transform", "missing-font", "missing-asset"].every(c => codes(pr([], { nan: ["#x.x"], fontOk: false, brokenImages: ["a.png"] })).includes(c)), "all three flagged");
  const b2 = safeBoxFor({ ...BASE, aspectRatio: "16:9" } as SceneGraph); check("2i 16:9 uses landscape vertical margins", b2.x0 > 100 && b2.y0 < 120 && b2.y1 > 1000 / 1080 * 1080 - 100, `[${b2.x0.toFixed(0)},${b2.y0.toFixed(0)},${b2.x1.toFixed(0)},${b2.y1.toFixed(0)}]`);
}

/* ===== 3. static Tier-1 (assets, hashes, partition, audio/video <= 1 frame) ===== */
const EXACT = path.join(TMP, "exact.wav"); const ex = EXACT; void ex;
const projDir = path.join(ROOT, "out/test_script_apple_minimal_9x16/work/hf"), mixWav = path.join(ROOT, "out/test_script_apple_minimal_9x16/work/mix.wav");
{
  const g = ensureAssetHashes(BASE, ROOT);
  check("3a clean graph: zero static issues", staticIssues(g, { projectRoot: ROOT, projectDir: projDir, audioPath: mixWav }).length === 0, "assets, hashes, fonts, partition, A/V ok");
  const bad = structuredClone(g); bad.assets[0]!.sha256 = "0".repeat(64); const i1 = staticIssues(bad, { projectRoot: ROOT, projectDir: projDir }).map(i => i.code);
  check("3b wrong sha256 -> asset-hash", i1.includes("asset-hash"), i1.join(","));
  const bad2 = structuredClone(g); bad2.assets[0]!.path = "nope/missing.wav"; check("3c missing asset -> missing-asset", staticIssues(bad2, { projectRoot: ROOT, projectDir: projDir }).some(i => i.code === "missing-asset"), "flagged");
  const bad3 = structuredClone(g); bad3.assets[0]!.sha256 = undefined as never; check("3d missing hash -> asset-hash", staticIssues(bad3, { projectRoot: ROOT, projectDir: projDir }).some(i => i.code === "asset-hash"), "flagged");
  const bad4 = structuredClone(g); bad4.scenes[1]!.startFrame += 3; check("3e scene gap -> partition", staticIssues(bad4, { projectRoot: ROOT, projectDir: projDir }).some(i => i.code === "partition"), "flagged");
  const short = path.join(TMP, "short.wav"); conformAudio(mixWav, g.durationFrames - 40, g.fps, short);
  check("3f audio 40 frames short -> av-duration", staticIssues(g, { projectRoot: ROOT, projectDir: projDir, audioPath: short }).some(i => i.code === "av-duration"), "flagged");
  conformAudio(mixWav, g.durationFrames, g.fps, EXACT); const df = Math.abs(Math.round(probeDurationSec(EXACT) * g.fps) - g.durationFrames);
  check("3g conformAudio lands within <= 1 frame", df <= 1, `delta=${df}f`);
}

/* ===== 4. LayoutRepair: pure patches, schema, and the 2-tier loop on real stills ===== */
{
  const sc = BASE.scenes[0]!, e = sc.entities.find(x => x.kind === "kinetic_words")!, pl = e.placement[BASE.aspectRatio]!; const before = JSON.stringify(BASE);
  const g2 = applyLayoutRepairs(BASE, [{ op: "move", sceneId: sc.id, entityId: e.id, dx: 0.02, dy: 0.05 }, { op: "resize", sceneId: sc.id, entityId: e.id, scale: 0.9 }, { op: "add-scrim", sceneId: sc.id, entityId: e.id, opacity: 0.95 }]);
  const p2 = g2.scenes[0]!.entities.find(x => x.id === e.id)!;
  check("4a repairs are pure (input graph untouched => rollback is free)", JSON.stringify(BASE) === before, "no mutation");
  check("4b move/resize/add-scrim change exactly what they say", Math.abs(p2.placement[BASE.aspectRatio]!.w - pl.w * 0.9) < 1e-3 && p2.props["scrim"] === 0.95, `w ${pl.w}->${p2.placement[BASE.aspectRatio]!.w}, scrim=${p2.props["scrim"]}`);
  const cp = structuredClone(BASE); const ce = cp.scenes[0]!.entities.find(x => x.kind !== "kinetic_words")!; ce.label = "one two three four five six seven eight nine ten eleven"; ce.props["title"] = "a b c d e f g h i j k"; ce.props["tasks"] = ["alpha beta gamma delta", "x y"];
  const cs = applyLayoutRepairs(cp, [{ op: "shorten-copy", sceneId: cp.scenes[0]!.id, entityId: ce.id, maxWords: 3 }]).scenes[0]!.entities.find(x => x.id === ce.id)!;
  check("4c shorten-copy cuts label, string props and string arrays", cs.label === "one two three" && cs.props["title"] === "a b c" && (cs.props["tasks"] as string[])[0] === "alpha beta gamma", `${cs.label} | ${cs.props["title"]}`);
  check("4d invalid patch rejected by schema", !LayoutRepair.safeParse({ op: "resize", sceneId: "a", entityId: "b", scale: 3 }).success && !LayoutRepair.safeParse({ op: "bogus" }).success, "scale>1 and unknown op rejected");
  const plan = planRepairs(BASE, sc, [{ tier: 1, code: "safe-zone", sceneId: sc.id, entityId: e.id, detail: "x" }], [pr([tb({ y: 240, h: 90 })])], box, 0);
  check("4e safe-zone issue -> move patch with the exact needed shift", plan[0]?.op === "move" && plan[0].dy > 0, JSON.stringify(plan[0]));
  const sab = structuredClone(ensureAssetHashes(BASE, ROOT)); const s3 = sab.scenes[1]!; const kw = s3.entities.find(x => x.kind === "kinetic_words")!; kw.placement[sab.aspectRatio]!.y = 0.0; for (const o of s3.entities) { const q = o.placement[sab.aspectRatio]!; if (o.kind === "anchor_core") q.y = 0.7; else if (o.kind !== "kinetic_words") q.y = 0.23; } // sabotage: push caption block to the very top
  const t0 = Date.now(); const rep = await runVisualQA({ graph: sab, projectRoot: ROOT, projectDir: projDir, outDir: path.join(TMP, "qa"), audioPath: ex, scenes: [s3.id, BASE.scenes[0]!.id] });
  const q3 = rep.scenes.find(s => s.sceneId === s3.id)!;
  check("4f sabotaged scene is repaired and re-validated (<=2 retries)", q3.passed && q3.repairs.length > 0 && q3.attempts <= 2, `repairs=${q3.repairs.map(r => r.op).join("+")} attempts=${q3.attempts}`);
  check("4g QA sampled start/mid/end stills + contact sheet in seconds", rep.sampledFrames >= 6 && fs.existsSync(rep.sheet) && rep.ms < 120000, `${rep.sampledFrames} frames in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  check("4h QA does not mutate the caller's graph", JSON.stringify(sab.scenes[1]!.entities.find(x => x.kind === "kinetic_words")!.placement[sab.aspectRatio]) !== JSON.stringify(rep.graph.scenes[1]!.entities.find(x => x.kind === "kinetic_words")!.placement[sab.aspectRatio]), "repaired graph is a new object");
  const unfixable = structuredClone(sab); unfixable.assets[0]!.sha256 = "f".repeat(64); const rep2 = await runVisualQA({ graph: unfixable, projectRoot: ROOT, projectDir: projDir, outDir: path.join(TMP, "qa2"), scenes: [BASE.scenes[0]!.id] });
  check("4i hard Tier-1 failure (bad asset hash) fails the report", !rep2.passed && rep2.global.some(i => i.code === "asset-hash"), "report.passed=false");
  const kf = keyFrames(sc); check("4j key frames inside the half-open scene interval, ordered", kf.start < kf.mid && kf.mid < kf.end && kf.start >= sc.startFrame && kf.end < sc.endFrame, `${kf.start}/${kf.mid}/${kf.end}`);
}

/* ===== 5. chunk keys (content addressing) ===== */
{
  const g = BASE; const jobs = planSceneChunks(buildCostManifest(g), 300); const ex = { themeHash: "T", assetHashes: Object.fromEntries(g.assets.map(a => [a.id, a.sha256 ?? "x"])), bakeHashes: {} as Record<string, string>, rendererVersion: "R1" };
  const k = (gg: SceneGraph, o: Partial<typeof ex> = {}): string[] => jobs.map(j => chunkContentKey(gg, j, { ...ex, ...o }));
  const base = k(g); check("5a keys are stable", JSON.stringify(base) === JSON.stringify(k(structuredClone(g))), `${base.length} chunks`);
  check("5b theme change invalidates every chunk", k(g, { themeHash: "T2" }).every((x, i) => x !== base[i]), "all differ");
  check("5c renderer version change invalidates every chunk", k(g, { rendererVersion: "R2" }).every((x, i) => x !== base[i]), "all differ");
  const g2 = structuredClone(g); g2.scenes[jobs[2]!.sceneIds.length ? g.scenes.findIndex(s => s.id === jobs[2]!.sceneIds[0]) : 0]!.entities[0]!.props["edit"] = 1; const k2 = k(g2);
  check("5d editing one scene changes only its chunk", k2.map((x, i) => x !== base[i]).filter(Boolean).length === 1 && k2[2] !== base[2], `changed=${k2.map((x, i) => x !== base[i] ? i : -1).filter(i => i >= 0)}`);
  const aid = g.assets.find(a => g.scenes.some(s => s.entities.some(e => e.assetId === a.id)))?.id; const ak = aid ? k(g, { assetHashes: { ...ex.assetHashes, [aid]: "changed" } }) : base;
  check("5e asset hash change invalidates only chunks using it", !aid || (ak.some((x, i) => x !== base[i]) && ak.some((x, i) => x === base[i])), `asset=${aid ?? "none in graph"}`);
  const bk = k(g, { bakeHashes: { [g.scenes[0]!.id]: "bake2" } }); check("5f bake hash change invalidates only that scene's chunk", bk.filter((x, i) => x !== base[i]).length === 1, "1 chunk");
}

/* ===== 6. 72,000-frame resumable render with a REAL crash (SIGKILL) ===== */
{
  const g = longGraph(BASE, 160, 450, 60); check("6a synthetic job is 72,000 frames (20 min @60fps)", g.durationFrames === 72000, `${g.durationFrames}f = ${(g.durationFrames / g.fps / 60).toFixed(1)} min`);
  const gp = path.join(TMP, "long.json"), audio = path.join(TMP, "long.wav"), out = path.join(TMP, "long_final.mp4"), calls = path.join(TMP, "calls.log"), pj = path.join(TMP, "jobs"); fs.writeFileSync(gp, JSON.stringify(g));
  spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=f=220:r=8000", "-t", String(g.durationFrames / g.fps), "-ac", "1", audio]);
  const jobs = planSceneChunks(buildCostManifest(g), 450); const gpuN = jobs.filter(j => j.cls === "gpu-heavy").length;
  check("6b planner splits gpu-heavy / cpu-dom chunks", gpuN > 0 && jobs.length - gpuN > 0, `${gpuN} gpu-heavy + ${jobs.length - gpuN} cpu-dom = ${jobs.length}`);
  const tsxBin = path.join(ROOT, "node_modules/tsx/dist/cli.mjs"), child = (crash: number) => spawnSync(process.execPath, [tsxBin, path.join(ROOT, "tests/fixtures/orchStub.ts"), gp, pj, "job72k", audio, out, calls, String(crash)], { encoding: "utf8", cwd: ROOT, timeout: 540000 });
  const t0 = Date.now(); const c1 = child(60);
  check("6c child process was killed mid-render (SIGKILL, no clean exit)", (c1.signal === "SIGKILL" || c1.status !== 0) && !fs.existsSync(out) && !/"complete"/.test(c1.stdout), `signal=${c1.signal} status=${c1.status} after ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  const mp = manifestPath(pj, "job72k"); const m1 = JSON.parse(fs.readFileSync(mp, "utf8")) as Manifest; const done1 = m1.chunks.filter(c => c.status === "done");
  check("6d manifest survived the crash, valid JSON, partial progress", done1.length > 0 && done1.length < jobs.length, `${done1.length}/${jobs.length} done, ${m1.chunks.filter(c => c.status === "running").length} left 'running'`);
  const callsBefore = fs.readFileSync(calls, "utf8").trim().split("\n").length; const t1 = Date.now(); const c2 = child(-1); const r2 = JSON.parse(c2.stdout.trim().split("\n").pop()!) as { complete: boolean; skipped: number; rendered: number; stats: { g: number; c: number; t: number } };
  const callsAfter = fs.readFileSync(calls, "utf8").trim().split("\n").length - callsBefore;
  check("6e resume completes the job", c2.status === 0 && r2.complete && fs.existsSync(out), `status=${c2.status} in ${((Date.now() - t1) / 1000).toFixed(0)}s`);
  check("6f verified chunks are SKIPPED, only unfinished ones render", r2.skipped >= done1.length && r2.rendered === jobs.length - r2.skipped && callsAfter === r2.rendered, `skipped=${r2.skipped} rendered=${r2.rendered} renderer calls=${callsAfter}`);
  check("6g concurrency limits: gpu-heavy serial (1), cpu-dom parallel (<=3)", r2.stats.g <= 1 && r2.stats.c <= 3 && r2.stats.c >= 2, `peak gpu=${r2.stats.g} cpu=${r2.stats.c}`);
  const pi = probe(out); const ff = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", out], { encoding: "utf8" }).stdout.trim().split("\n");
  check("6h final = 72,000 frames, bt709, single audio stream", pi.frames === 72000 && pi.colorSpace === "bt709" && ff.filter(x => x === "audio").length === 1, `${pi.frames}f ${pi.colorSpace} streams=${ff.join("+")}`);
  check("6i closed GOP: keyframe every 60 frames, never mid-chunk drift", pi.gop.every((f, i) => i === 0 || f - pi.gop[i - 1]! <= 60) && pi.gop[0] === 0, `${pi.gop.length} keyframes`);
  const m2 = JSON.parse(fs.readFileSync(mp, "utf8")) as Manifest; check("6j manifest final state complete, every chunk verified done", m2.state === "complete" && m2.chunks.every(c => c.status === "done" && verifyChunk(c, c.key)), `${m2.chunks.length} chunks`);
  // third run: nothing to do. fourth: one chunk truncated on disk, one scene edited.
  const c3 = child(-1); const r3 = JSON.parse(c3.stdout.trim().split("\n").pop()!) as { rendered: number; skipped: number }; check("6k re-run with nothing changed renders 0 chunks", r3.rendered === 0 && r3.skipped === jobs.length, `rendered=${r3.rendered} skipped=${r3.skipped}`);
  const victim = m2.chunks[37]!; fs.truncateSync(victim.file!, Math.floor(victim.bytes / 2));
  const c4 = child(-1); const r4 = JSON.parse(c4.stdout.trim().split("\n").pop()!) as { rendered: number }; check("6l a truncated chunk is detected (size/sha) and re-rendered alone", r4.rendered === 1, `rendered=${r4.rendered}`);
  const g5 = JSON.parse(fs.readFileSync(gp, "utf8")) as SceneGraph; g5.scenes[100]!.entities[0]!.props["n"] = -1; fs.writeFileSync(gp, JSON.stringify(g5));
  const c5 = child(-1); const r5 = JSON.parse(c5.stdout.trim().split("\n").pop()!) as { rendered: number }; check("6m editing one scene of 160 re-renders exactly 1 chunk", r5.rendered === 1, `rendered=${r5.rendered}`);
  fs.writeFileSync(mp, '{"torn":'); const c6 = child(-1); const r6 = JSON.parse(c6.stdout.trim().split("\n").pop()!) as { rendered: number; complete: boolean };
  check("6n corrupt manifest => clean restart, still completes", r6.complete && c6.status === 0, `rendered=${r6.rendered}`);
  atomicWriteJson(path.join(TMP, "a.json"), { a: 1 }); check("6o atomic manifest write leaves no tmp files", fs.readdirSync(TMP).every(f => !f.endsWith(".tmp")), "no .tmp");
}

/* ===== 7. Studio on localhost ===== */
{
  const srv = createServer(); await new Promise<void>(r => srv.listen(3100, "127.0.0.1", () => r())); const U = "http://127.0.0.1:3100";
  const get = async (p: string): Promise<Response> => fetch(U + p); const post = async (p: string, b: unknown, h: Record<string, string> = { "content-type": "application/json" }): Promise<Response> => fetch(U + p, { method: "POST", headers: h, body: typeof b === "string" || b instanceof Uint8Array ? (b as string) : JSON.stringify(b) });
  const idx = await (await get("/")).text(); const js = await (await get("/app.js")).text();
  check("7a Studio serves the neumorphism UI (#E6ECF5) + client bundle", idx.includes("#E6ECF5") && js.length > 5000 && !js.includes("import "), `html ${idx.length}B, bundle ${js.length}B`);
  const presets = await (await get("/api/presets")).json() as { id: string; hash: string }[]; check("7b 5 presets, Apple Minimal first (default)", presets.length === 5 && presets[0]!.id === "apple_minimal" && new Set(presets.map(p => p.hash)).size === 5, presets.map(p => p.id).join(","));
  const kit = await (await post("/api/compile-theme", { mode: "kit", background: "#101820", text: "#F2F2F2", accent: "#FFB000", material: "holo", pacing: "luxury-slow" })).json() as { tokens: { surface: { kind: string }; motion: { personality: string }; color: { accent: string } }; modes: unknown[] };
  check("7c compile-theme kit: colours + material + pacing", kit.tokens.surface.kind === "holo" && kit.tokens.motion.personality === "luxury-slow" && kit.modes.length === 2, `${kit.tokens.surface.kind}/${kit.tokens.motion.personality}`);
  const pr1 = await (await post("/api/compile-theme", { mode: "prompt", prompt: "calm luxury fintech, emerald, slow" })).json() as { matched: { preset: string }; tokens: { motion: { personality: string } } }; check("7d compile-theme AI style prompt", !!pr1.matched.preset && pr1.tokens.motion.personality === "luxury-slow", `matched ${pr1.matched.preset}`);
  const ssrf = await post("/api/compile-theme", { mode: "url", url: "http://127.0.0.1:3100/" }); check("7e URL import blocks private addresses (SSRF)", ssrf.status === 400, `status ${ssrf.status}`);
  const bad = await post("/api/compile-theme", { mode: "kit", background: "nope", text: "#000", accent: "#f00" }); check("7f invalid kit -> 422 with message", bad.status === 422, `status ${bad.status}`);
  const logoPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"); const up = await (await post("/api/logo", logoPng as unknown as string, { "content-type": "image/png" })).json() as { logoPath: string; sha256: string };
  check("7g logo upload stores a content-addressed file", up.sha256 === crypto.createHash("sha256").update(logoPng).digest("hex") && fs.existsSync(path.join(ROOT, up.logoPath)), up.logoPath);
  const withLogo = await (await post("/api/compile-theme", { mode: "kit", background: "#FFFFFF", text: "#09090B", accent: "#E60000", logoPath: up.logoPath })).json() as { tokens: { logo?: { sha256: string } } }; check("7h logo flows into theme tokens (3D Brand Anchor)", withLogo.tokens.logo?.sha256 === up.sha256, "tokens.logo.sha256 matches");
  const noLogoType = await post("/api/logo", "GIF89a-not-allowed-here", { "content-type": "image/gif" }); check("7i non-image upload rejected", noLogoType.status === 415, `status ${noLogoType.status}`);
  const short = await post("/api/jobs", { script: "hi", ratio: "9:16", quality: "draft", tokens: presets[0] }); check("7j job with too-short script rejected", short.status === 422, `status ${short.status}`);
  check("7k unknown job -> 404", (await get("/api/jobs/abcdef012345")).status === 404, "404");
  const sys = await (await get("/api/system")).json() as { cpus: number; limits: { gpuHeavy: number; cpuDom: number } }; check("7l scheduler/system endpoint reports limits", sys.cpus > 0 && sys.limits.gpuHeavy === 1 && sys.limits.cpuDom === 3, JSON.stringify(sys.limits));
  // real browser: every Brand Kit control active
  const br = await chromium.launch({ executablePath: resolveChrome(), args: ["--no-sandbox"] }); const pg = await br.newPage({ viewport: { width: 1500, height: 1500 } }); const errs: string[] = []; pg.on("pageerror", e => errs.push(String(e))); pg.on("console", m => { if (m.type() === "error" && !/status of 400/.test(m.text())) errs.push(m.text()); /* 400 = the deliberate SSRF-block probe in 7q */ });
  await pg.goto(U); await pg.waitForSelector(".card", { timeout: 15000 }); const nCards = await pg.locator(".card").count(); const hash0 = await pg.locator("#preview small").first().textContent();
  await pg.locator('.card[data-id="cyberpunk_holo"]').click(); await pg.waitForTimeout(300); const hash1 = await pg.locator("#preview small").first().textContent();
  check("7m UI: 5 preset cards; clicking one re-compiles the live preview", nCards === 5 && hash0 !== hash1, `${nCards} cards, ${hash0} -> ${hash1}`);
  await pg.locator("#cAc").evaluate((el: HTMLInputElement) => { el.value = "#00B386"; el.dispatchEvent(new Event("input", { bubbles: true })); }); await pg.waitForTimeout(700); const accTxt = await pg.locator("#preview .sw i").nth(2).getAttribute("title");
  check("7n UI: accent colour picker drives the live tokens", accTxt?.toLowerCase() === "#00b386", `accent -> ${accTxt}`);
  await pg.locator('[data-m="clay"]').click(); await pg.waitForTimeout(600); await pg.locator('[data-p="viral-fast"]').click(); await pg.waitForTimeout(600);
  const badges = await pg.locator("#preview .badge").allTextContents(); check("7o UI: material + pacing switchers update tokens", badges.includes("clay") && badges.includes("viral-fast"), badges.join(","));
  await pg.locator("#prompt").fill("playful clay pastel, fast"); await pg.locator("#goPrompt").click(); await pg.waitForTimeout(900); const msg = await pg.locator("#importMsg").textContent(); check("7p UI: AI Style Prompt wired to /api/compile-theme", /Prompt compiled/.test(msg ?? ""), msg ?? "");
  await pg.locator("#url").fill("http://127.0.0.1/"); await pg.locator("#goUrl").click(); await pg.waitForTimeout(700); check("7q UI: URL import surfaces the SSRF block", /private|blocked|not allowed|unsafe|address/i.test((await pg.locator("#importMsg").textContent()) ?? ""), ((await pg.locator("#importMsg").textContent()) ?? "").slice(0, 90));
  await pg.locator("#logo").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: logoPng }); await pg.waitForTimeout(800); check("7r UI: logo uploader maps onto the 3D Brand Anchor", /3D Brand Anchor/.test((await pg.locator("#logoInfo").textContent()) ?? ""), (await pg.locator("#logoInfo").textContent()) ?? "");
  check("7s UI: inspector present (chunks, scheduler, QA, player)", (await pg.locator("#chunks, #sched, #qaBadges, #player").count()) === 4, "4/4 widgets");
  check("7t UI: zero console/page errors", errs.length === 0, errs.slice(0, 2).join(" | ") || "clean");
  fs.mkdirSync(path.join(ROOT, "out"), { recursive: true }); await pg.screenshot({ path: path.join(ROOT, "out/studio_phase3.png"), fullPage: true }); await br.close(); srv.close();
}

/* ===== 8. two-tenant E2E (same components, different brand + ratio) ===== */
const runCli = (args: string[]): { status: number | null; out: string } => { const r = spawnSync(process.execPath, [path.join(ROOT, "node_modules/tsx/dist/cli.mjs"), "cli.ts", ...args], { cwd: ROOT, encoding: "utf8", timeout: 570000, env: { ...process.env, HYPERFRAMES_BROWSER_PATH: resolveChrome() } }); return { status: r.status, out: r.stdout + r.stderr }; };
const E2E = [{ preset: "apple_minimal", ratio: "9:16" }, { preset: "playful_clay", ratio: "16:9" }] as const; const finals: Record<string, string> = {};
for (const e of E2E) {
  const dir = path.join(ROOT, "out", `test_script_${e.preset}_${e.ratio.replace(":", "x")}`), mp4 = path.join(dir, `test_script_${e.preset}_${e.ratio.replace(":", "x")}.mp4`);
  for (let tries = 0; tries < 4 && !fs.existsSync(mp4); tries++) { const r = runCli(["--script", "test_script.txt", "--preset", e.preset, "--ratio", e.ratio, "--quality", "draft", "--no-music", "--budget", "300"]); if (r.status !== 0 && r.status !== 3) { check(`8x ${e.preset} CLI exit`, false, r.out.slice(-400)); break; } }
  const ok = fs.existsSync(mp4); finals[e.preset] = mp4; if (!ok) { check(`8a ${e.preset} ${e.ratio} render`, false, "no output"); continue; }
  const pi = probe(mp4), sc = JSON.parse(fs.readFileSync(path.join(dir, "scene.json"), "utf8")) as { durationFrames: number; fps: number; theme?: { id: string } }, { width: W, height: H } = CANVAS[e.ratio];
  check(`8a ${e.preset} ${e.ratio}: full render, frames == durationFrames`, pi.frames === sc.durationFrames && pi.width === W && pi.height === H, `${pi.width}x${pi.height} ${pi.frames}/${sc.durationFrames}f @${pi.fps}`);
  check(`8b ${e.preset}: bt709 + closed GOP`, pi.colorSpace === "bt709" && pi.gop.every((f, i) => i === 0 || f - pi.gop[i - 1]! <= 60), `${pi.colorSpace}, ${pi.gop.length} keyframes`);
  const dur = probeDurationSec(mp4), a = spawnSync("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_name", "-of", "csv=p=0", mp4], { encoding: "utf8" }).stdout.trim();
  check(`8c ${e.preset}: one audio track, A/V length within 1 frame`, a.split("\n").length === 1 && Math.abs(dur - sc.durationFrames / sc.fps) <= 1 / sc.fps + 0.03, `audio=${a} dur=${dur.toFixed(3)}s vs ${(sc.durationFrames / sc.fps).toFixed(3)}s`);
  const qa = JSON.parse(fs.readFileSync(path.join(dir, "visual_qa_report.json"), "utf8")) as { passed: boolean }; check(`8d ${e.preset}: visual QA gate passed`, qa.passed, `passed=${qa.passed}`);
  const mf = JSON.parse(fs.readFileSync(manifestPath(path.join(ROOT, "projects"), `test_script_${e.preset}_${e.ratio.replace(":", "x")}`), "utf8")) as Manifest; check(`8e ${e.preset}: manifest complete, chunk-addressed`, mf.state === "complete" && mf.chunks.every(c => c.status === "done"), `${mf.chunks.length} chunks, themeHash ${mf.themeHash.slice(0, 8)}`);
}
if (finals["apple_minimal"] && finals["playful_clay"] && fs.existsSync(finals["apple_minimal"]) && fs.existsSync(finals["playful_clay"])) {
  const still = (f: string, t: number, o: string): string => { spawnSync("ffmpeg", ["-y", "-v", "error", "-ss", String(t), "-i", f, "-frames:v", "1", "-vf", "scale=96:-1", "-f", "rawvideo", "-pix_fmt", "rgb24", o]); return o; };
  const a = fs.readFileSync(still(finals["apple_minimal"], 9, path.join(TMP, "a.rgb"))), b = fs.readFileSync(still(finals["playful_clay"], 9, path.join(TMP, "b.rgb")));
  const mean = (x: Buffer): number[] => { const m = [0, 0, 0]; for (let i = 0; i < x.length; i += 3) for (let c = 0; c < 3; c++) m[c]! += x[i + c]!; return m.map(v => v / (x.length / 3)); };
  const ma = mean(a), mb = mean(b); const d = Math.hypot(ma[0]! - mb[0]!, ma[1]! - mb[1]!, ma[2]! - mb[2]!);
  const rd = (x: Buffer): number => { let n = 0; for (let i = 0; i < x.length; i += 3) if (x[i]! > 170 && x[i + 1]! < 70 && x[i + 2]! < 70) n++; return n / (x.length / 3); };
  check("8f multi-tenant switch is visible in the pixels", d > 12 || Math.abs(rd(a) - rd(b)) > 0.002, `mean-colour distance ${d.toFixed(1)}; pure-red pixel share ${(rd(a) * 100).toFixed(2)}% vs ${(rd(b) * 100).toFixed(2)}%`);
}
const tsc = spawnSync("npx", ["tsc", "--noEmit"], { cwd: ROOT, encoding: "utf8" }); check("9 npx tsc --noEmit (engine + apps/studio)", tsc.status === 0, tsc.status === 0 ? "0 errors" : (tsc.stdout + tsc.stderr).slice(0, 300));
const fails = rows.filter(r => !r.ok); console.log(`\n==== PHASE 3: ${rows.length - fails.length}/${rows.length} passed ====`); if (fails.length) { for (const f of fails) console.log(`  FAIL ${f.name}: ${f.detail}`); process.exit(1); }
