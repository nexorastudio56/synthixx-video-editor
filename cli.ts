#!/usr/bin/env tsx
/** One-command pipeline: script -> aligned words -> resolved assets -> Scene Graph (validated) -> sound mix -> chunked deterministic render -> assembly -> QA. */
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { direct } from "./intelligence/visualDirector.js";
import { mixAudio } from "./audio/soundDesign.js";
import { emitProject } from "./rendering/emitProject.js";
import { analyzeEmphasis } from "./audio/emphasisAnalyzer.js";
import { orchestrate } from "./rendering/chunkOrchestrator.js";
import { scenePageChunkRenderer } from "./rendering/renderPipeline.js";
import { runVisualQA, conformAudio, ensureAssetHashes } from "./rendering/visualQA.js";
import { PRESET_IDS, getPreset } from "./styles/presets.js";
import { compileTheme } from "./styles/themeCompiler.js";
import { BrandThemeTokens } from "./styles/themeSchema.js";
import { runQA } from "./rendering/qa.js";
import { spawnSync } from "node:child_process";
import { resolvePython } from "./core/python.js";
import { validateScene } from "./core/compiler/validateScene.js";
import { PROFILES } from "./visual/materials/morphismProfiles.js";

const { values: v } = parseArgs({ options: {
  script: { type: "string" }, morphism: { type: "string", default: "glass" }, ratio: { type: "string", default: "9:16" }, workers: { type: "string", default: "2" },
  out: { type: "string" }, fps: { type: "string", default: "30" }, "chunk-frames": { type: "string", default: "300" }, quality: { type: "string", default: "draft" },
  audio: { type: "string" }, images: { type: "string" }, voice: { type: "string" }, "no-music": { type: "boolean", default: false }, publish: { type: "string" }, "strict-qa": { type: "boolean", default: false }, "no-cinematic": { type: "boolean", default: false }, budget: { type: "string" }, pacing: { type: "string" }, "no-emphasis": { type: "boolean", default: false }, preset: { type: "string" }, "theme-file": { type: "string" }, "storyboard-only": { type: "boolean", default: false }, "no-qa": { type: "boolean", default: false }, "jobs-root": { type: "string", default: "projects" }, "job-id": { type: "string" }, speed: { type: "string" },
} });
const fail = (m: string): never => { console.error("ERROR: " + m); process.exit(2); };
if (!v.script || !fs.existsSync(v.script)) fail("--script <file> required and must exist");
let themeTokens: BrandThemeTokens | undefined;
if (v.preset) { if (!(PRESET_IDS as readonly string[]).includes(v.preset)) fail(`--preset must be one of ${PRESET_IDS.join(", ")}`); themeTokens = getPreset(v.preset as (typeof PRESET_IDS)[number]); }
if (v["theme-file"]) { if (!fs.existsSync(v["theme-file"])) fail("--theme-file not found"); themeTokens = compileTheme(BrandThemeTokens.parse(JSON.parse(fs.readFileSync(v["theme-file"], "utf8")))).tokens; }
if (themeTokens) { v.morphism = "brand"; v.pacing ??= themeTokens.motion.personality; }   // theme => brand morphism; pacing defaults to the theme personality
if (v.morphism === "brand" && !themeTokens) fail("--morphism brand ab alag se available nahi: --preset / --theme-file use karo");
if (!(v.morphism! in PROFILES)) fail(`--morphism must be one of ${Object.keys(PROFILES).join(", ")}`);
if (!["9:16", "16:9"].includes(v.ratio!)) fail("--ratio must be 9:16 or 16:9");
const root = path.resolve(import.meta.dirname); const name = path.parse(v.script!).name;
const tag = v.preset ?? (themeTokens ? "custom" : v.morphism!);
const outDir = path.resolve(v.out ?? `out/${name}_${tag}_${v.ratio!.replace(":", "x")}`); const work = path.join(outDir, "work"); fs.mkdirSync(work, { recursive: true });
const fps = +v.fps! as 24 | 30 | 60; const t0 = Date.now(); const step = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`);

step("1/6 director (align -> resolve -> narrative -> choreograph -> validate/repair)");
const d = await direct({ scriptPath: v.script!, workDir: work, projectRoot: root, morphism: v.morphism!, ratio: v.ratio as "9:16" | "16:9", fps, userAudio: v.audio, userImagesDir: v.images, voice: v.voice, speed: v.speed ? +v.speed : undefined, pacing: v.pacing as "viral-fast" | "explainer-medium" | "luxury-slow" | undefined });
let g = d.graph; if (themeTokens) { g.theme = themeTokens; fs.writeFileSync(path.join(work, "scene.json"), JSON.stringify(g, null, 1)); }
fs.copyFileSync(path.join(work, "scenePlan.json"), path.join(outDir, "scenePlan.json")); fs.copyFileSync(path.join(work, "scene.json"), path.join(outDir, "scene.json"));
step(`   scenes=${g.scenes.length} dur=${d.scenePlan.durationSec}s timing=${d.source} attempts=${d.attempts.length} fallback=${d.usedFallback}`);

step("2/6 sound design (procedural SFX + pad + voice-keyed ducking)");
const mix = mixAudio(g, d.wavPath, path.join(work, "mix.wav"), { music: !v["no-music"] }); conformAudio(mix.path, g.durationFrames, g.fps, path.join(work, "mix_exact.wav")); fs.copyFileSync(path.join(work, "mix_exact.wav"), mix.path); // exact video length (director pads video by a few frames) step(`   sfx=${mix.sfx} peak=${mix.peak} rms=${mix.rmsDb}dB duckedSpeech=${mix.duckedPct}%`);

const emphasis = !v["no-emphasis"] && (g.fps === 30 || g.fps === 60) ? analyzeEmphasis({ wavPath: d.wavPath, words: g.voice.words, fps: g.fps, outPath: path.join(work, "emphasisTrack.json") }) : undefined; if (emphasis) step(`   emphasis: ${emphasis.impacts.length} impact words, track sha ${emphasis.sha256.slice(0, 10)}`);
step("3/6 emit native GSAP scene project");
const proj = path.join(work, "hf"); fs.mkdirSync(proj, { recursive: true });
const hfBase = path.join(root, "hf_base"); for (const f of ["package.json", "hyperframes.json", "meta.json"]) if (fs.existsSync(path.join(hfBase, f))) fs.copyFileSync(path.join(hfBase, f), path.join(proj, f));
emitProject(g, proj, { projectRoot: root, vendorAssets: path.join(root, "vendor"), audioFile: null, cinematic: v["no-cinematic"] ? false : undefined, emphasis });

g = ensureAssetHashes(g, root);
if (!v["no-qa"]) {
  step("3b/6 storyboard + visual QA (stills only: Tier-1 hard asserts, Tier-2 sampled contrast, LayoutRepair <=2 retries, rollback-safe)");
  const sbDir = path.join(outDir, "storyboard"); const rep = await runVisualQA({ graph: g, projectRoot: root, projectDir: proj, outDir: sbDir, audioPath: mix.path, log: step });
  fs.writeFileSync(path.join(outDir, "visual_qa_report.json"), JSON.stringify({ passed: rep.passed, ms: rep.ms, sampledFrames: rep.sampledFrames, safeBox: rep.safeBox, global: rep.global, scenes: rep.scenes }, null, 1));
  const nRep = rep.scenes.reduce((n, x) => n + x.repairs.length, 0);
  if (nRep) { g = rep.graph; const rv = validateScene(g, { projectRoot: root }); if (!rv.ok) fail("post-repair validation failed: " + rv.errors.map(e => e.code).join(",")); fs.writeFileSync(path.join(outDir, "scene.json"), JSON.stringify(g, null, 1)); emitProject(g, proj, { projectRoot: root, vendorAssets: path.join(root, "vendor"), audioFile: null, cinematic: v["no-cinematic"] ? false : undefined, emphasis }); }
  step(`   QA ${rep.passed ? "PASSED" : "FAILED"} in ${(rep.ms / 1000).toFixed(0)}s (${rep.sampledFrames} frames, ${nRep} repair(s)); contact sheet: ${rep.sheet}`);
  for (const i of [...rep.global, ...rep.scenes.flatMap(x => x.issues)]) step(`   ! [${i.code}] ${i.sceneId ?? "-"} ${i.detail}`);
  if (!rep.passed && !v["storyboard-only"]) fail("visual QA failed (see visual_qa_report.json); fix or pass --no-qa");
}
if (v["storyboard-only"]) { step("storyboard-only: done (no video rendered)"); process.exit(0); }

step(`4/6 resumable chunk render (cpu-dom x${v.workers}, gpu-heavy x1, chunk<=${v["chunk-frames"]}f, quality=${v.quality})`);
const budget = v.budget ? +v.budget : undefined; const jobId = v["job-id"] ?? `${name}_${tag}_${v.ratio!.replace(":", "x")}`; const final = path.join(outDir, `${jobId}.mp4`);
const renderAll = async () => orchestrate({ jobId, projectsRoot: path.join(root, v["jobs-root"]!), graph: g, renderer: scenePageChunkRenderer({ projectDir: proj, quality: v.quality as "draft" | "looks" | "delivery" }), out: final, audioPath: mix.path, projectDir: proj, maxChunkFrames: +v["chunk-frames"]!, cpuConcurrency: Math.min(3, Math.max(2, +v.workers!)), quality: v.quality!, budgetSec: budget, log: step });
let r = await renderAll();
if (!r.complete) { step(`PAUSED: ${r.pending} chunk(s) still pending (time-boxed). Re-run the same command; verified chunks are skipped via projects/${jobId}/manifest.json.`); process.exit(3); }
step(`5/6 assembled by orchestrator (${r.skipped} chunk(s) reused, ${r.rendered} rendered; audio muxed once)`);

step("6/6 QA (technical + Visual Self-QA gate: 60px safe zone, contrast, palette)");
let qa = runQA(final, g, mix.path); fs.writeFileSync(path.join(outDir, "qa.json"), JSON.stringify(qa, null, 1));
const vqa = () => { const rep = path.join(outDir, "visual_qa.json"), fx = path.join(work, "fixes.json"); fs.rmSync(fx, { force: true });
  const run = spawnSync(resolvePython(), [path.join(root, "rendering/visualSelfQA.py"), "--video", final, "--scene", path.join(outDir, "scene.json"), "--out", rep, "--fix-out", fx, "--project", proj], { encoding: "utf8" }); process.stdout.write(run.stdout);
  return { report: JSON.parse(fs.readFileSync(rep, "utf8")), fixes: fs.existsSync(fx) ? JSON.parse(fs.readFileSync(fx, "utf8")) as Record<string, number> : {} }; };
let vq = themeTokens ? { report: { failedScenes: [] as string[], frames: [] as unknown[], lowContrastScenes: [] as string[], palette: {} as Record<string, unknown> }, fixes: {} as Record<string, number> } : vqa();   // legacy pixel QA enforces the Synthixx 3-colour palette; themed renders are gated by the Tier-1/2 QA above
for (let it = 1; it <= 2 && Object.keys(vq.fixes).length; it++) {                       // auto-adjust typography scale for the exact failing scene ids, re-render only the affected chunks
  step(`   auto-fix #${it}: ${JSON.stringify(vq.fixes)}`);
  for (const [sid, ts] of Object.entries(vq.fixes)) { const sc = g.scenes.find((x: any) => x.id === sid); if (sc) sc.typeScale = ts; }
  const rv = validateScene(g, { projectRoot: root }); if (!rv.ok) fail("post-fix validation failed: " + rv.errors.map(e => e.code).join(","));
  fs.writeFileSync(path.join(outDir, "scene.json"), JSON.stringify(g, null, 1));
  emitProject(g, proj, { projectRoot: root, vendorAssets: path.join(root, "vendor"), audioFile: null, cinematic: v["no-cinematic"] ? false : undefined, emphasis });
  fs.writeFileSync(path.join(proj, "index.html"), fs.readFileSync(path.join(proj, "index.html"), "utf8"));
  r = await renderAll(); if (!r.complete) { step(`PAUSED during auto-fix: ${r.pending} chunk(s) pending. Re-run the same command.`); process.exit(3); }
  qa = runQA(final, g, mix.path); fs.writeFileSync(path.join(outDir, "qa.json"), JSON.stringify(qa, null, 1)); vq = vqa();
}
for (const c of qa.checks) console.log(`  ${c.pass ? "PASS" : "FAIL"}  ${c.name}: ${c.detail}`);
const vr = vq.report; console.log(`  ${vr.failedScenes.length ? "FAIL" : "PASS"}  safe-zone (60px): ${vr.failedScenes.length ? "scenes " + vr.failedScenes.join(",") : (themeTokens ? "enforced by Tier-1 visual QA (theme safe margins)" : "no overflow in " + vr.frames.length + " key frames")}\n  ${vr.lowContrastScenes.length ? "WARN" : "PASS"}  contrast >=3:1: ${vr.lowContrastScenes.length ? "low in " + vr.lowContrastScenes.join(",") : "ok"}\n  ${Object.keys(vr.palette).length ? "FAIL" : "PASS"}  palette discipline: ${Object.keys(vr.palette).length ? JSON.stringify(vr.palette) : (themeTokens ? "themed run: enforced by Tier-1/2 visual QA + WCAG theme compiler" : "only White/Carbon/Signal Red")}`);
const gateOk = vr.failedScenes.length === 0 && Object.keys(vr.palette).length === 0 && (!v["strict-qa"] || vr.lowContrastScenes.length === 0);
let published = "";
if (v.publish) { const pd = path.resolve(v.publish); fs.mkdirSync(path.join(pd, "scenes"), { recursive: true }); const fin = path.join(pd, "scenes/final.mp4"); fs.copyFileSync(final, fin);
  spawnSync("ffmpeg", ["-y", "-v", "error", "-i", fin, "-vf", "select=eq(n\\,90)", "-vframes", "1", path.join(pd, "debug_frame_90.png")]); published = `\nFINAL:  ${fin}\nFRAME:  ${path.join(pd, "debug_frame_90.png")}`; }
console.log(`\nOUTPUT: ${final}\nPLAN:   ${path.join(outDir, "scenePlan.json")}${published}\nQA: ${qa.ok && gateOk ? "all gates passed" : "FAILED"}`);
process.exit(qa.ok && gateOk ? 0 : 4);
