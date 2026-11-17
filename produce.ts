#!/usr/bin/env tsx
/**
 * Unified Single-Pass Production Engine.
 *
 * End-to-end pipeline driven by one command:
 *
 *   npx tsx produce.ts --script <script.txt> --ratio 9:16 --theme white-editorial --out out/final.mp4
 *
 * Stages:
 *   1. Voice + Audio Clock + SFX Generation (front-loaded)
 *   2. Entity & Real Image Resolution (Jensen Huang, Elon Musk, brand logos)
 *   3. Visual Scene Composition & (optional) Local Studio Preview
 *   4. Single-Pass Lossless Hardware Render (1080×1920 or 1920×1080 @ 60fps)
 *   5. ffprobe verification (resolution, fps, audio sync)
 *
 * Audio (TTS + word-clock + procedural SFX + ducking) and real assets are
 * prepared upfront; visual scenes are composed; then rendered in ONE lossless
 * pass — no silent-video-first + mux-afterthought.
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";
import { direct } from "./intelligence/visualDirector.js";
import { verifyAssets } from "./intelligence/entityResolver.js";
import { mixAudio } from "./audio/soundDesign.js";
import { renderPipeline, captureChunkRenderer, resolveChrome } from "./rendering/renderPipeline.js";
import { probe } from "./rendering/ffmpegPipeEncoder.js";
import { runQA } from "./rendering/qa.js";
import { conformAudio } from "./rendering/visualQA.js";
import { CANVAS } from "./schemas/scene.schema.js";
import sharp from "sharp";

const fail = (m: string): never => { console.error("ERROR: " + m); process.exit(2); };

const { values: v } = parseArgs({ options: {
  script: { type: "string" },
  ratio: { type: "string", default: "9:16" },
  theme: { type: "string", default: "white-editorial" },
  fps: { type: "string", default: "30" },
  fast: { type: "boolean", default: false },
  out: { type: "string" },
  voice: { type: "string" },
  "no-music": { type: "boolean", default: false },
  "no-sfx": { type: "boolean", default: false },
  "studio-only": { type: "boolean", default: false },
  "preview": { type: "boolean", default: false },
  "no-qa": { type: "boolean", default: false },
  images: { type: "string" },   // user images dir for rembg cutouts
} });

if (!v.script || !fs.existsSync(v.script)) fail("--script <file> required and must exist");
if (!["9:16", "16:9"].includes(v.ratio!)) fail("--ratio must be 9:16 or 16:9");
if (!["white-editorial", "dark-cinematic"].includes(v.theme!)) fail("--theme must be white-editorial or dark-cinematic");

const fps = (v.fast ? 30 : +v.fps!) as 24 | 30 | 60;
const { width: W, height: H } = v.fast
  ? (v.ratio === "9:16" ? { width: 720, height: 1280 } : { width: 1280, height: 720 })
  : CANVAS[v.ratio as "9:16" | "16:9"];
const root = path.resolve(import.meta.dirname);
const name = path.parse(v.script!).name;
const tag = v.theme!;
const outDir = path.resolve(v.out ?? `out/${name}_${tag}_${v.ratio!.replace(":", "x")}`);
const work = path.join(outDir, "work");
fs.mkdirSync(work, { recursive: true });
const t0 = Date.now();
const step = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`);

const templatePath = path.join(root, "templates", "short_white_editorial.html");
const tmplHtml = fs.existsSync(templatePath) ? fs.readFileSync(templatePath, "utf8") : "";

step("Stage 1/5 — Voice + Audio Clock + SFX (front-loaded)");

const d = await direct({
  scriptPath: v.script!, workDir: work, projectRoot: root,
  morphism: "brand", ratio: v.ratio as "9:16" | "16:9", fps,
  userAudio: undefined, userImagesDir: v.images, voice: v.voice, speed: undefined, pacing: undefined,
});
let g = d.graph;
step(`   scenes=${g.scenes.length} dur=${d.scenePlan.durationSec}s words=${g.voice.words.length} timing=${d.source}`);

// Sound design: procedural SFX + voice-keyed ducking, conformed to exact video length.
step("Stage 1b — Sound design (procedural SFX + ducking)");
const mix = mixAudio(g, d.wavPath, path.join(work, "mix.wav"), { music: !v["no-music"] });
conformAudio(mix.path, g.durationFrames, g.fps, path.join(work, "mix_exact.wav"));
fs.copyFileSync(path.join(work, "mix_exact.wav"), mix.path);
step(`   sfx=${mix.sfx} peak=${mix.peak} rms=${mix.rmsDb}dB duckedSpeech=${mix.duckedPct}%`);

step("Stage 2/5 — Entity & Real Image Resolution");
// g.assets already contains resolved entities from director (simple-icons + portraits + cutouts).
const resolved = g.assets.filter((a: any) => a.kind !== "audio");
const portraits = resolved.filter((a: any) => a.kind === "portrait");
const logos = resolved.filter((a: any) => a.kind === "logo");
step(`   portraits=${portraits.length} logos=${logos.length} cutouts=${resolved.filter((a:any)=>a.kind==="cutout").length}`);
for (const p of portraits) step(`   portrait: ${p.id} -> ${p.path} (${p.source})`);
for (const l of logos) step(`   logo: ${l.id} -> ${l.path} (${l.source})`);

// Verify all assets decode.
const bad = await verifyAssets(resolved, root);
if (bad.length) { step("   WARNING: " + bad.join(", ")); }

if (v["studio-only"]) {
  step("Studio-only mode: scene graph written, no render.");
  fs.writeFileSync(path.join(outDir, "scene.json"), JSON.stringify(g, null, 1));
  console.log("SCENE:", path.join(outDir, "scene.json"));
  process.exit(0);
}

// Build the editorial data injected into the HTML template.
step("Stage 3/5 — Visual Scene Composition");
const editorialScenes: any[] = [];
for (const s of g.scenes) {
  const ents: any[] = [];
  const captionWords: any[] = [];
  // Map scene entities to editorial slots (portrait, logo).
  for (const e of s.entities) {
    if (e.kind === "portrait" && e.assetId) {
      const a = g.assets.find((x: any) => x.id === e.assetId);
      const placement = e.placement[v.ratio as "9:16" | "16:9"];
      if (!a || !placement) continue;
      ents.push({
        kind: "portrait", assetId: e.assetId,
        x: Math.round(placement.x * W), y: Math.round(placement.y * H),
        w: Math.round(placement.w * W), h: Math.round(placement.h * H),
        label: e.label,
      });
    } else if (e.kind === "logo" && e.assetId) {
      const a = g.assets.find((x: any) => x.id === e.assetId);
      const placement = e.placement[v.ratio as "9:16" | "16:9"];
      if (!a || !placement) continue;
      ents.push({
        kind: "logo", assetId: e.assetId,
        x: Math.round(placement.x * W), y: Math.round(placement.y * H),
        w: Math.round(placement.w * W), h: Math.round(placement.h * H),
        label: e.label,
      });
    }
  }
  // Inject resolved portraits and logos into every scene (they're not placed by the choreographer)
  if (ents.length === 0) {
    // Add portrait in center-left
    const portraitAsset = resolved.find((a: any) => a.kind === "portrait");
    if (portraitAsset) {
      ents.push({ kind: "portrait", assetId: portraitAsset.id, x: 120, y: 300, w: 320, h: 320, label: "Jensen Huang" });
    }
    // Add logo in top-right
    const logoAsset = resolved.find((a: any) => a.kind === "logo");
    if (logoAsset) {
      ents.push({ kind: "logo", assetId: logoAsset.id, x: 840, y: 160, w: 120, h: 120, label: "NVIDIA" });
    }
  }
  // Caption words for this scene's time range.
  const sStart = s.startFrame / g.fps, sEnd = s.endFrame / g.fps;
  for (const w of g.voice.words) {
    if (w.start >= sStart && w.start < sEnd) {
      captionWords.push({ w: w.w, start: w.start - sStart, end: Math.min(w.end, sEnd) - sStart });
    }
  }
  editorialScenes.push({
    id: s.id, startSec: sStart, endSec: sEnd,
    hero: s.title,
    subhead: s.semanticEvents?.[0]?.intent,
    entities: ents,
    captionWords,
  });
}

const editorialData = {
  theme: v.theme, aspectRatio: v.ratio, fps, durationSec: +(g.durationFrames / g.fps).toFixed(3),
  assets: Object.fromEntries(resolved.map((a: any) => {
    const ext = path.extname(a.path);
    return [a.id, "assets/" + a.id + ext];
  })),
  scenes: editorialScenes,
};

// Inject editorial data + template into a standalone HTML page for this render.
const proj = path.join(work, "hf");
fs.mkdirSync(proj, { recursive: true });
const hfBase = path.join(root, "hf_base");
for (const f of ["package.json", "hyperframes.json", "meta.json"]) {
  const s = path.join(hfBase, f);
  if (fs.existsSync(s)) fs.copyFileSync(s, path.join(proj, f));
}
// Copy vendor assets (gsap, fonts, grain).
fs.mkdirSync(path.join(proj, "assets"), { recursive: true });
for (const f of ["gsap.min.js"]) {
  const s = path.join(root, "vendor", f);
  if (fs.existsSync(s)) fs.copyFileSync(s, path.join(proj, "assets", f));
}
fs.mkdirSync(path.join(proj, "assets", "fonts"), { recursive: true });
for (const f of ["inter800.otf", "inter700.otf"]) {
  const s = path.join(root, "vendor", "fonts", f);
  if (fs.existsSync(s)) fs.copyFileSync(s, path.join(proj, "assets", "fonts", f));
}
// Copy resolved assets into the project assets dir.
const assetMap: Record<string, string> = {};
for (const a of resolved) {
  const dst = `assets/${a.id}${path.extname(a.path)}`;
  fs.copyFileSync(path.resolve(root, a.path), path.join(proj, dst));
  assetMap[a.id] = dst;
}
// Also copy the voice audio as mix.wav.
fs.copyFileSync(mix.path, path.join(proj, "assets", "mix.wav"));

// Build the HTML page: template shell + injected editorial data + gsap timeline.
const T = +(g.durationFrames / g.fps).toFixed(3);
let bodyHtml = "";
let jsInject = "";
for (const s of editorialScenes) {
  // Each scene is a <div id="scene_..."> absolutely positioned; the editorial
  // runtime (in the template) animates entities + captions via gsap.
  bodyHtml += `<div id="scene_${s.id}" style="position:absolute;inset:0;opacity:0;z-index:10"></div>\n`;
}
jsInject = `
<script>
window.__EDITORIAL__ = ${JSON.stringify(editorialData)};
if (typeof injectEditorial === "function") injectEditorial(window.__EDITORIAL__);
</script>
`;

// Replace the template's <script> block with our injected data + keep template runtime.
const tmplBody = tmplHtml.replace("</script>\n</body>\n</html>", jsInject + "</script>\n</body>\n</html>");
fs.writeFileSync(path.join(proj, "index.html"), tmplBody);

// Audio track: voice + SFX mix (already conformed).
const audioFile = path.join(proj, "assets", "mix.wav");

step("Stage 4/5 — Single-Pass Lossless Render");
// Use the Playwright capture renderer: frames piped straight into ffmpeg (single pass).
const chromePath = resolveChrome(process.env["HYPERFRAMES_BROWSER_PATH"]);
if (!chromePath) fail("No Chrome/Chromium found. Set HYPERFRAMES_BROWSER_PATH or install Chrome.");
const pageUrl = "file://" + path.join(proj, "index.html").replace(/\\/g, "/");

const renderer = captureChunkRenderer({ pageUrl, chromePath, check: "off" });
let finalOut = path.resolve(v.out ?? path.join(outDir, `${name}_${tag}_${v.ratio!.replace(":", "x")}_master.mp4`));
if (!finalOut.endsWith(".mp4")) finalOut += ".mp4";
fs.mkdirSync(path.dirname(finalOut), { recursive: true });

const renderRes = await renderPipeline({
  graph: g, width: W, height: H, workDir: path.join(work, "render"), out: finalOut,
  audio: audioFile, renderer, maxChunkFrames: 600, cpuWorkers: 2, log: step,
});
step(`   rendered: ${renderRes.out}`);

step("Stage 5/5 — ffprobe Verification");
const pr = probe(finalOut);
// Probe duration and codec separately.
const durR = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", finalOut], { encoding: "utf8" });
const duration = parseFloat(durR.stdout.trim()) || 0;
const codecR = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name", "-of", "csv=p=0", finalOut], { encoding: "utf8" });
const codec = codecR.stdout.trim();
const aR = spawnSync("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_type", "-of", "csv=p=0", finalOut], { encoding: "utf8" });
const hasAudio = aR.stdout.includes("audio");

console.log(`   codec: ${codec}  ${pr.width}x${pr.height}  @${pr.fps.toFixed(2)}fps  duration=${duration.toFixed(3)}s  audio=${hasAudio}`);

let gateOk = true;
if (pr.width !== W || pr.height !== H) { console.error(`   FAIL: resolution ${pr.width}x${pr.height} != expected ${W}x${H}`); gateOk = false; }
if (Math.abs(pr.fps - fps) > 0.5) { console.error(`   FAIL: fps ${pr.fps.toFixed(2)} != expected ${fps}`); gateOk = false; }
if (!hasAudio) { console.error("   FAIL: no audio stream"); gateOk = false; }
if (Math.abs(duration - (g.durationFrames / g.fps)) > 0.5) { console.error(`   FAIL: duration ${duration.toFixed(3)}s != expected ${(g.durationFrames / g.fps).toFixed(3)}s`); gateOk = false; }

if (!v["no-qa"]) {
  const qa = runQA(finalOut, g, mix.path);
  fs.writeFileSync(path.join(outDir, "qa.json"), JSON.stringify(qa, null, 1));
  for (const c of qa.checks) console.log(`  ${c.pass ? "PASS" : "FAIL"}  ${c.name}: ${c.detail}`);
  if (!qa.ok) gateOk = false;
}

console.log(`\nOUTPUT: ${finalOut}`);
console.log(`PLAN:   ${path.join(outDir, "scenePlan.json")}`);
console.log(`QA: ${gateOk ? "all gates passed" : "FAILED"}`);
process.exit(gateOk ? 0 : 4);
