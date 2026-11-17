/** Phase 2 verification: emphasis track + impact pulse, pacing planner (60 s script), media timing/PiP, strict-duotone grading, tsc. */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { buildSync } from "esbuild";
import { chromium } from "playwright-core";
import { analyzeEmphasis } from "../audio/emphasisAnalyzer.js";
import { impactsOf, pulseAtFrame, pulseAtTime, pulseRuntimeJs, hann, PULSE_SEC, CAMERA_CAP, GLOW_PEAK, IMPACT_THRESHOLD } from "../visual/fx/impactPulse.js";
import { composeScene } from "../visual/sceneComposer.js";
import { SceneGraph } from "../schemas/scene.schema.js";
import { planPacing, planToGroups, midWordCuts, PERSONALITY_RANGE, type Personality } from "../intelligence/pacingPlanner.js";
import { brandChoreograph } from "../intelligence/brandChoreographer.js";
import { newMemory } from "../intelligence/memory.js";
import { normalize, applyRepairs } from "../intelligence/repair.js";
import { validateScene } from "../core/compiler/validateScene.js";
import { buildCostManifest } from "../rendering/resourceScheduler.js";
import { sourceFrameIndex } from "../visual/media/mediaTiming.js";
import { extractSourceFrames, clockFor, probeVideo } from "../visual/media/frameExtractor.js";
import { gradeImageData, makeGrader, luminanceLinear, srgbToLinear, svgDuotoneFilter, DEFAULT_PALETTE } from "../visual/media/colorGrade.js";
import { resolveChrome } from "../rendering/renderPipeline.js";
import type { Word } from "../schemas/scene.schema.js";

interface Row { name: string; ok: boolean; detail: string }
const rows: Row[] = []; const check = (name: string, ok: boolean, detail: string): void => { rows.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`); };
const ROOT = resolve(import.meta.dirname, ".."); const WORK = join(ROOT, "out", "phase2_test"); rmSync(WORK, { recursive: true, force: true }); mkdirSync(WORK, { recursive: true });
const FIX = join(ROOT, "tests", "fixtures"); const sha = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");
const words30 = (JSON.parse(readFileSync(join(FIX, "test_script.voice.json"), "utf8")) as { words: Word[] }).words;

/* ---------------- 1. emphasis track + deterministic micro-pulse ---------------- */
{
  const wav = join(FIX, "test_script.voice.wav"); const a = analyzeEmphasis({ wavPath: wav, words: words30, fps: 30, outPath: join(WORK, "emphasisTrack.json") }), b = analyzeEmphasis({ wavPath: wav, words: words30, fps: 30, outPath: join(WORK, "emphasisTrack_2.json") });
  check("1a emphasisTrack.json generated from test_script audio (frame-indexed, 0..1)", a.values.length === a.durationFrames && a.values.every(v => v >= 0 && v <= 1) && a.durationFrames >= Math.ceil(26.6 * 30), `${a.durationFrames} frames @${a.fps}fps, ${a.words.length} words, max ${Math.max(...a.values).toFixed(3)}`);
  check("1b analysis is deterministic (two runs byte-identical)", sha(readFileSync(join(WORK, "emphasisTrack.json"))) === sha(readFileSync(join(WORK, "emphasisTrack_2.json"))) && a.sha256 === b.sha256, `sha ${a.sha256.slice(0, 16)}`);
  check("1c impact words exist; each has score > 0.72 and the track exceeds 0.72 there", a.impacts.length >= 1 && a.impacts.every(im => im.score > IMPACT_THRESHOLD && Math.max(...a.values.slice(im.frame, im.frame + 5)) > IMPACT_THRESHOLD), a.impacts.map(i => `${a.words[i.wordIndex].w}@f${i.frame}=${i.score}`).join(", "));
  check("1d non-impact frames never exceed the 0.6 base cap (impacts are the only >0.72 events)", (() => { const hot = new Set<number>(); for (const im of a.impacts) for (let f = im.frame; f <= im.frame + Math.ceil((a.attackSec + a.decaySec) * a.fps) + 1; f++) hot.add(f); return a.values.every((v, f) => hot.has(f) || v <= 0.6 + 1e-9); })(), "ok");
  check("1e impact spacing >= 0.9 s", a.impacts.every((im, i) => i === 0 || (im.frame - a.impacts[i - 1].frame) / a.fps >= a.minGapSec - 1e-9), "ok");
  // pulse maths
  const imps = impactsOf(a), W = 1080, H = 1920, cap = CAMERA_CAP * Math.min(W, H); const o = imps[0].frame;
  const frames = Array.from({ length: 40 }, (_, k) => o - 5 + k); const seq = frames.map(f => pulseAtFrame(imps, f, 30, W, H)); const rev = [...frames].reverse().map(f => pulseAtFrame(imps, f, 30, W, H)).reverse();
  check("1f micro-pulse values deterministic + random-access (forward == reverse == repeat)", JSON.stringify(seq) === JSON.stringify(rev) && JSON.stringify(seq) === JSON.stringify(frames.map(f => pulseAtFrame(imps, f, 30, W, H))), `impact @f${o}: dx/dy at +3f = ${seq[8].dx.toFixed(4)}, ${seq[8].dy.toFixed(4)}`);
  const maxMag = Math.max(...imps.flatMap(im => Array.from({ length: 30 }, (_, k) => { const p = pulseAtFrame(imps, im.frame + k, 60, W, H); return Math.hypot(p.dx, p.dy); })));
  check("1g camera micro-pulse capped at 0.8% of the viewport short edge", maxMag <= cap + 1e-9 && maxMag > cap * 0.5, `max ${maxMag.toFixed(3)}px <= ${cap.toFixed(3)}px (1080 short edge)`);
  check("1h pulse is zero before onset and after PULSE_SEC (band-limited: Hann, zero value+slope at ends)", pulseAtFrame(imps, o - 1, 30, W, H).kernel === 0 && pulseAtTime(imps, o / 30 + PULSE_SEC, 30, W, H).kernel === 0 && hann(1e-6) < 1e-9 && hann(PULSE_SEC - 1e-6) < 1e-9, "ok");
  let step = 0; for (let f = o; f < o + 30; f++) { const p = pulseAtFrame(imps, f, 60, W, H), q = pulseAtFrame(imps, f + 1, 60, W, H); step = Math.max(step, Math.hypot(q.dx - p.dx, q.dy - p.dy)); }
  check("1i pulse continuous: max per-frame step at 60fps <= 2px (no jerk)", step <= 2, `${step.toFixed(3)}px`);
  const peak = pulseAtTime(imps, o / 30 + PULSE_SEC / 2, 30, W, H); check("1j orb glow peaks at exactly 1.12x", Math.abs(peak.glow - GLOW_PEAK) < 1e-12 && pulseAtFrame(imps, o - 3, 30, W, H).glow === 1, `glow ${peak.glow}`);
  // emitted browser runtime == TS maths
  const rt = new Function(`${pulseRuntimeJs(imps, 30, W, H)}; return __pulse;`)() as (t: number) => { dx: number; dy: number; glow: number }; let maxErr = 0;
  for (let f = 0; f < a.durationFrames; f += 7) { const t = f / 30, p = pulseAtTime(imps, t, 30, W, H), q = rt(t); maxErr = Math.max(maxErr, Math.abs(p.dx - q.dx), Math.abs(p.dy - q.dy), Math.abs(p.glow - q.glow)); }
  check("1k injected browser runtime == TypeScript pulse (same hash-RNG, same kernel)", maxErr < 1e-9, `max error ${maxErr}`);
  // L2 exclusion in the composed scene
  const g = SceneGraph.parse(JSON.parse(readFileSync(join(ROOT, "out", "test_script_apple_minimal_9x16", "scene.json"), "utf8"))); const sc = g.scenes[1];
  const html = composeScene(g, sc, {}, { impacts: imps }).html, m = /const H=(\[[^\]]*\])\.map/.exec(html); const ids = m ? (JSON.parse(m[1]) as string[]) : [];
  const heroIds = sc.entities.filter(e => !["kinetic_words", "logo", "text", "anchor_core", "cutout"].includes(e.kind)).map(e => `p_${e.id}`);
  check("1l pulse wired into composition: backdrop + hero wrappers only (captions/logos/anchor untouched)", html.includes("__pulse") && html.includes('id="bgp"') && ids.length > 0 && JSON.stringify(ids) === JSON.stringify(heroIds) && !ids.some(i => i.includes("kin_main") || i.includes("anchor_core")), `pulsed: ${ids.join(",")}; excluded: kin_main, anchor_core`);
  check("1m no-emphasis composition unchanged (no pulse code)", !composeScene(g, sc, {}).html.includes("__pulse"), "ok");
}

/* ---------------- 2. pacing planner on a 60 s script ---------------- */
{
  const words = (JSON.parse(readFileSync(join(FIX, "tech60.voice.json"), "utf8")) as { words: Word[] }).words; const dur = Math.max(...words.map(w => w.end));
  check("2.0 fixture is a ~60 s script", dur > 58 && dur < 62 && words.length > 150, `${dur.toFixed(1)} s, ${words.length} words`);
  for (const p of ["viral-fast", "explainer-medium", "luxury-slow"] as Personality[]) {
    const plan = planPacing(words, { personality: p, fps: 30 }), r = PERSONALITY_RANGE[p], st = plan.stats, content = plan.scenes.filter(s => s.kind === "content");
    check(`2a [${p}] zero mid-word cuts`, midWordCuts(plan, words).length === 0, `${plan.scenes.length} scenes, ${plan.cutFrames.length - 1} cuts all in word gaps`);
    check(`2b [${p}] scenes tile [0,${plan.durationFrames}) exactly, every word used once`, plan.scenes[0].startFrame === 0 && plan.scenes.at(-1)!.endFrame === plan.durationFrames && plan.scenes.every((s, i) => i === 0 || s.startFrame === plan.scenes[i - 1].endFrame) && plan.scenes.reduce((a, s) => a + (s.wordEnd - s.wordStart + 1), 0) === words.length, "contiguous");
    check(`2c [${p}] breather beats present, each 1.5-2.0 s`, st.breathers >= 2 && st.breatherLengthsSec.every(l => l >= 1.5 - 1e-9 && l <= 2.0 + 1e-9), `${st.breathers} breathers: ${st.breatherLengthsSec.map(l => l.toFixed(2)).join(", ")} s`);
    check(`2d [${p}] never more than 20 s of dense motion between breathers; first breather at 15-20 s`, st.maxDenseStretchSec <= 20 + 1e-9 && (() => { const b = plan.scenes.find(s => s.kind === "breather"); return !!b && b.startSec >= 15 && b.startSec <= 20; })(), `max dense stretch ${st.maxDenseStretchSec.toFixed(2)} s, first breather @${plan.scenes.find(s => s.kind === "breather")!.startSec.toFixed(2)} s`);
    check(`2e [${p}] <=30% GPU-hero budget (time and count)`, st.gpuRatioByTime <= 0.3 && st.gpuRatioByCount <= 0.3, `time ${(st.gpuRatioByTime * 100).toFixed(1)}%, count ${st.gpuScenes}/${st.scenes}=${(st.gpuRatioByCount * 100).toFixed(1)}%`);
    check(`2f [${p}] no two GPU-hero scenes adjacent; breathers are never GPU`, plan.scenes.every((s, i) => !(s.hero3d && (plan.scenes[i + 1]?.hero3d || s.kind === "breather"))), "ok");
    const out = content.filter(s => { const d = s.endSec - s.startSec; return d < r.min - 0.07 || d > r.max + 0.07; });
    check(`2g [${p}] content scene lengths within ${r.min}-${r.max} s (<=1 relaxed tail scene)`, out.length <= 1 && out.every(s => s.relaxed), `${content.length} scenes, ${out.length} outside (relaxed tail), range ${st.minSceneSec.toFixed(2)}-${st.maxSceneSec.toFixed(2)} s`);
    const again = planPacing(words, { personality: p, fps: 30 }); check(`2h [${p}] plan deterministic`, JSON.stringify(again) === JSON.stringify(plan), "identical");
  }
  // full choreography of an explainer plan: validates against the scene compiler, breather scenes minimal, GPU budget holds under the scheduler's own classifier
  const plan = planPacing(words, { personality: "explainer-medium", fps: 30 }); const groups = planToGroups(plan, words, []);
  const { scenes } = brandChoreograph(groups, { fps: 30, aspect: "9:16", words, resolved: [], memory: newMemory(), durationFrames: plan.durationFrames, cutFrames: plan.cutFrames, hero3d: plan.scenes.map(s => s.hero3d) });
  let graph: any = { schemaVersion: 1, title: "tech60", fps: 30, aspectRatio: "9:16", morphism: "brand", durationFrames: plan.durationFrames, voice: { audioAssetId: "voice_main", words }, assets: [{ id: "voice_main", kind: "audio", path: "samples/voice.wav", source: "kokoro", verified: true }], scenes };
  let ok = false, rounds = 0, codes: string[] = []; for (; rounds <= 3; rounds++) { graph = normalize(graph); const r = validateScene(graph); codes = [...new Set(r.errors.map(e => e.code))]; if (r.ok) { graph = r.graph; ok = true; break; } applyRepairs(graph, r.errors); }
  check("2i planned scenes choreograph into a graph that passes the scene compiler", ok, ok ? `valid after ${rounds} repair round(s), ${graph.scenes.length} scenes` : `errors: ${codes.join(",")}`);
  if (ok) {
    const br = graph.scenes.filter((s: any) => s.entities.length === 1 && s.entities[0].props?.statement === true);
    check("2j breather scenes are minimal: single kinetic statement, no hero, no anchor", br.length === plan.stats.breathers && br.every((s: any) => s.entities[0].kind === "kinetic_words"), `${br.length} breather scenes`);
    const cost = buildCostManifest(graph), gpuF = cost.filter(c => c.cls === "gpu-heavy").reduce((a, c) => a + (c.endFrame - c.startFrame), 0), gpuN = cost.filter(c => c.cls === "gpu-heavy").length;
    check("2k scheduler classification of the real graph also respects <=30% gpu-heavy", gpuF / graph.durationFrames <= 0.3 && gpuN / cost.length <= 0.3 && gpuN === plan.stats.gpuScenes, `gpu-heavy ${gpuN}/${cost.length} scenes, ${(100 * gpuF / graph.durationFrames).toFixed(1)}% of frames`);
    const cuts = graph.scenes.map((s: any) => s.startFrame).slice(1); const mid = midWordCuts({ cutFrames: [0, ...cuts], fps: 30 }, words); check("2l scene startFrames in the compiled graph are never mid-word", mid.length === 0, "ok");
  }
}

/* ---------------- 3. media timing + frame extraction + PiP + grading ---------------- */
{
  const c = { startFrame: 10, fps: 30, srcFps: 24, firstIndex: 0, lastIndex: 39 } as const;
  check("3a sourceFrameIndex exact (24fps clip on 30fps timeline)", sourceFrameIndex(0, c) === 0 && sourceFrameIndex(10, c) === 0 && sourceFrameIndex(11, c) === 0 && sourceFrameIndex(12, c) === 1 && sourceFrameIndex(40, c) === 24 && sourceFrameIndex(10 + 75, c) === 39 && sourceFrameIndex(10 + 500, c) === 39, "f10->0 f12->1 f40->24 hold at 39");
  check("3b loop + speed + trim", sourceFrameIndex(10 + 50, { ...c, end: "loop" }) === 0 && sourceFrameIndex(10 + 10, { ...c, speed: 2 }) === 16 && sourceFrameIndex(10, { ...c, trimStartFrames: 5 }) === 5, "ok");
  const order = [10, 80, 45, 12, 11]; const sq = [...order].sort((a, b) => a - b).map(f => [f, sourceFrameIndex(f, c)]), sh = order.map(f => [f, sourceFrameIndex(f, c)]); check("3c random-access: shuffled == sequential", JSON.stringify(sq) === JSON.stringify(sh.slice().sort((a, b) => a[0] - b[0])), "ok");
  // lossless coded-index video: frame k has colour (6k, 255-6k, 0)
  const raw = Buffer.alloc(64 * 64 * 3 * 40); for (let k = 0; k < 40; k++) for (let i = 0; i < 64 * 64; i++) { const o = (k * 64 * 64 + i) * 3; raw[o] = 6 * k; raw[o + 1] = 255 - 6 * k; raw[o + 2] = 0; }
  const rawFile = join(WORK, "coded.rgb"), vid = join(WORK, "coded.mp4"); writeFileSync(rawFile, raw);
  const enc = spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "64x64", "-r", "24", "-i", rawFile, "-c:v", "libx264rgb", "-crf", "0", "-pix_fmt", "rgb24", vid], { encoding: "utf8" }); check("3d coded-index test video created", enc.status === 0 && probeVideo(vid).frames === 40, `40 frames @${probeVideo(vid).srcFps}fps`);
  const media = extractSourceFrames(vid, join(WORK, "frames"), { from: 5, to: 35 }); const px = (idx: number): number[] => { const r = spawnSync("ffmpeg", ["-v", "error", "-i", join(media.dir, `src_${String(idx).padStart(6, "0")}.png`), "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { maxBuffer: 1 << 24 }); return [r.stdout[0], r.stdout[1], r.stdout[2]]; };
  const probe = [5, 17, 24, 35].map(i => ({ i, p: px(i) })); check("3e extracted file for source index K contains exactly frame K (lossless)", probe.every(({ i, p }) => p[0] === 6 * i && p[1] === 255 - 6 * i), probe.map(({ i, p }) => `#${i}=(${p})`).join(" "));
  // PiP + grade components in a real browser
  const bundle = buildSync({ entryPoints: [join(FIX, "mediaEntry.tsx")], bundle: true, write: false, format: "iife", platform: "browser", target: "es2022", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } }).outputFiles[0].text;
  const page = join(WORK, "media.html"); writeFileSync(page, `<!doctype html><html><body style="margin:0"><script>${bundle}</script></body></html>`);
  const bar = join(WORK, "bars.png"); spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "smptebars=s=320x180", "-frames:v", "1", bar]); spawnSync("ffmpeg", ["-y", "-v", "error", "-i", bar, "-f", "rawvideo", "-pix_fmt", "rgba", join(WORK, "bars.rgba")]);
  const br = await chromium.launch({ executablePath: resolveChrome(), args: ["--allow-file-access-from-files", "--force-color-profile=srgb"] });
  try {
    const pg = await br.newPage({ viewport: { width: 700, height: 500 } }); const errs: string[] = []; pg.on("pageerror", e => errs.push(String(e))); await pg.goto("file://" + page);
    const clock = clockFor(media, 10, 30); const P = await pg.evaluate(async (a) => (window as any).__p2.pip(a), { frame: 40, fps: 30, baseUrl: "file://" + media.dir, ext: media.ext, clock, width: 400, height: 260, accent: "#E60000" }) as { idx: string; transform: string; nat: number[]; px: number[]; opacity: string };
    const exp = sourceFrameIndex(40, clock); check("3f FramedMediaPiP shows the exact source frame for the global frame (no <video>)", P.idx === String(exp) && P.px[0] === 6 * exp && P.px[1] === 255 - 6 * exp, `global f40 -> source #${P.idx}, pixel (${P.px})`);
    const mm = /matrix3d\(([^)]*)\)/.exec(P.transform); const mv = mm ? mm[1].split(",").map(Number) : []; const rotY = Math.round((Math.asin(-mv[2] / Math.hypot(mv[0], mv[1], mv[2])) * 180) / Math.PI * 100) / 100;
    const Pset = await pg.evaluate(async (a) => (window as any).__p2.pip(a), { frame: 130, fps: 30, baseUrl: "file://" + media.dir, ext: media.ext, clock, width: 400, height: 260, accent: "#E60000" }) as { transform: string; opacity: string };
    const m2 = /matrix3d\(([^)]*)\)/.exec(Pset.transform); const v2 = m2 ? m2[1].split(",").map(Number) : []; const norm = Math.hypot(v2[0], v2[1], v2[2]); const rotYs = Math.round((Math.asin(-v2[2] / norm) * 180) / Math.PI * 100) / 100;
    check("3g card is perspective-tilted rotateY(-10deg) rotateX(5deg) with 3D matrix, fully opaque when settled", !!m2 && Math.abs(Math.abs(rotYs) - 10) < 0.6 && Pset.opacity === "1" && v2.length === 16, `settled rotY≈${rotYs}deg (entry-scale ${rotY}), opacity ${Pset.opacity}`);
    const G = await pg.evaluate(async (a) => (window as any).__p2.grade(a[0], a[1], a[2], a[3]), ["file://" + bar, "strict-duotone", 320, 180]) as { graded: string; samples: number[][] };
    const srcRaw = readFileSync(join(WORK, "bars.rgba")); const g8 = makeGrader("strict-duotone"); const pts: [number, number][] = [[2, 2], [160, 90], [317, 177]];
    const want = pts.map(([x, y]) => { const o = (y * 320 + x) * 4; return g8(srcRaw[o], srcRaw[o + 1], srcRaw[o + 2]); });
    check("3h BrandColorGrade component output == TypeScript duotone grade of the same source pixels (+-2)", G.graded === "strict-duotone" && G.samples.every((s, i) => s[3] === 255 && s.slice(0, 3).every((v, k) => Math.abs(v - want[i][k]) <= 2)), `canvas ${JSON.stringify(G.samples.map(s => s.slice(0, 3)))} vs ts ${JSON.stringify(want)}`);
    check("3i no page errors in media harness", errs.length === 0, errs[0] ?? "0");
  } finally { await br.close(); }

  // strict-duotone on a sample asset, verified against an independent numpy implementation
  const rgbaFile = join(WORK, "bars.rgba"); spawnSync("ffmpeg", ["-y", "-v", "error", "-i", bar, "-f", "rawvideo", "-pix_fmt", "rgba", rgbaFile]); const src = readFileSync(rgbaFile); const out = Uint8Array.from(src); gradeImageData(out, "strict-duotone");
  const outFile = join(WORK, "bars_duotone.rgba"); writeFileSync(outFile, out); spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", "320x180", "-i", outFile, join(WORK, "bars_duotone.png")]);
  const py = spawnSync("python3", ["-I", "-c", `
import numpy as np, sys
a=np.fromfile(sys.argv[1],dtype=np.uint8).reshape(-1,4).astype(np.float64); b=np.fromfile(sys.argv[2],dtype=np.uint8).reshape(-1,4).astype(np.float64)
def lin(c):
    c=c/255.0; return np.where(c<=0.04045,c/12.92,((c+0.055)/1.055)**2.4)
def enc(l):
    l=np.clip(l,0,1); return np.where(l<=0.0031308,12.92*l,1.055*l**(1/2.4)-0.055)
def hexl(h): return lin(np.array([int(h[1:3],16),int(h[3:5],16),int(h[5:7],16)],dtype=np.float64))
S,M,H=hexl('#09090B'),hexl('#E60000'),hexl('#FFFFFF')
Y=lin(a[:,:3])@np.array([0.2126,0.7152,0.0722]); Y=np.clip(Y,0,1)
t1=np.clip(Y/0.18,0,1)[:,None]; t2=np.clip((Y-0.18)/0.82,0,1)[:,None]
ramp=np.where((Y<=0.18)[:,None], S+(M-S)*t1, M+(H-M)*t2)
exp=np.round(enc(ramp)*255)
d=np.abs(exp-b[:,:3]); print(int(d.max()), float(d.mean()), int((a[:,3]!=b[:,3]).sum()))`, rgbaFile, outFile], { encoding: "utf8" });
  const [maxDiff, meanDiff, alphaDiff] = py.stdout.trim().split(/\s+/).map(Number);
  check("3j strict-duotone on sample asset matches independent numpy reference (max diff <= 1/255, alpha untouched)", py.status === 0 && maxDiff <= 1 && alphaDiff === 0, `max ${maxDiff}, mean ${meanDiff.toFixed(4)}, alpha diffs ${alphaDiff}`);
  const f = makeGrader("strict-duotone"); const bk = f(0, 0, 0), wh = f(255, 255, 255), mid = f(118, 118, 118);
  check("3k duotone anchors: black -> #09090B, white -> #FFFFFF, 18% grey (sRGB 118, Y=0.181) -> #E60000 +-8", bk.join() === "9,9,11" && wh.join() === "255,255,255" && mid.every((v, i) => Math.abs(v - [230, 0, 0][i]) <= 8), `black(${bk}) white(${wh}) mid(${mid})`);
  let mono = true, prev = -1; for (let v = 0; v < 256; v++) { const o = f(v, v, v), y = luminanceLinear(srgbToLinear(o[0]), srgbToLinear(o[1]), srgbToLinear(o[2])); if (y < prev - 1e-9) mono = false; prev = y; }
  check("3l ramp luminance monotonic over all 256 greys; hue-invariant (red and equal-luma grey map to same colour)", mono && f(255, 0, 0).every((v, i) => Math.abs(v - f(127, 127, 127)[i]) <= 3), `red->${f(255, 0, 0)} grey127->${f(127, 127, 127)}`);
  const pre = createHash("sha256").update(out).digest("hex"); const again = Uint8Array.from(src); gradeImageData(again, "strict-duotone"); check("3m grading deterministic (identical bytes on re-run)", createHash("sha256").update(again).digest("hex") === pre, pre.slice(0, 16));
  const nat = Uint8Array.from(src); gradeImageData(nat, "natural"); check("3n natural mode leaves pixels untouched", Buffer.compare(Buffer.from(nat), src) === 0, "identical");
  const harm = Uint8Array.from(src); gradeImageData(harm, "palette-harmonize"); let dY = 0, shift = 0, n = 0; for (let i = 0; i < src.length; i += 4) { const y0 = luminanceLinear(srgbToLinear(src[i]), srgbToLinear(src[i + 1]), srgbToLinear(src[i + 2])), y1 = luminanceLinear(srgbToLinear(harm[i]), srgbToLinear(harm[i + 1]), srgbToLinear(harm[i + 2])); dY = Math.max(dY, Math.abs(y1 - y0)); shift += (harm[i] - harm[i + 1]) - (src[i] - src[i + 1]); n++; }
  check("3o palette-harmonize preserves luminance (|dY| <= 0.03 linear) and biases toward the brand red", dY <= 0.03 && shift / n > 0, `max dY ${dY.toFixed(4)}, mean red-green shift ${(shift / n).toFixed(2)}`);
  check("3p SVG duotone filter emitted in linearRGB", svgDuotoneFilter("d", DEFAULT_PALETTE).includes('color-interpolation-filters="linearRGB"') && svgDuotoneFilter("d").includes("feFuncR"), "ok");
}

/* ---------------- 4. tsc ---------------- */
{ const r = spawnSync("npx", ["tsc", "--noEmit"], { cwd: ROOT, encoding: "utf8" }); check("4 npx tsc --noEmit", r.status === 0, r.status === 0 ? "0 errors" : (r.stdout + r.stderr).slice(0, 600)); }
const failed = rows.filter(r => !r.ok).length; console.log(`\n==== PHASE 2 REPORT: ${rows.length - failed}/${rows.length} passed ====`); for (const r of rows) console.log(`${r.ok ? "[x]" : "[ ]"} ${r.name}`);
writeFileSync(join(WORK, "report.json"), JSON.stringify(rows, null, 1)); void existsSync; process.exit(failed ? 1 : 0);
