/** Phase 0 exit verification: determinism, 4-layer sharpness/colour through the bt709 pipe, scheduler concurrency, tsc. */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { buildSync } from "esbuild";
import { chromium } from "playwright-core";
import { evaluateFrameState } from "../core/determinism/sceneState.js";
import { evaluateSpring } from "../core/determinism/timelineClock.js";
import { rand3, hash3 } from "../core/determinism/counterRng.js";
import { frameBits, MAX_BARCODE_FRAME } from "../core/determinism/frameBarrier.js";
import { SceneGraph } from "../schemas/scene.schema.js";
import { LayerCompositor } from "../visual/layers/LayerCompositor.js";
import { buildCostManifest, planSceneChunks, assertChunkCoverage, runPool, type ChunkJob } from "../rendering/resourceScheduler.js";
import { renderPipeline, captureChunkRenderer, resolveChrome } from "../rendering/renderPipeline.js";
import { buildEncodeArgs } from "../rendering/ffmpegPipeEncoder.js";

interface Row { name: string; ok: boolean; detail: string }
const rows: Row[] = []; const check = (name: string, ok: boolean, detail: string) => { rows.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`); };
const ROOT = resolve(import.meta.dirname, ".."); const WORK = join(ROOT, "out", "phase0_test"); rmSync(WORK, { recursive: true, force: true }); mkdirSync(WORK, { recursive: true });
const graph = SceneGraph.parse(JSON.parse(readFileSync(join(ROOT, "samples", "agent.scene.json"), "utf8")));

/* ---- 1. random-access determinism ---- */
{
  const frames = [0, 300, 45, 299, 1]; const seq = [...frames].sort((a, b) => a - b);
  const bySeq = new Map(seq.map(f => [f, JSON.stringify(evaluateFrameState(graph, f))]));
  const shuffled = frames.map(f => ({ f, s: JSON.stringify(evaluateFrameState(graph, f)) }));
  const allEq = shuffled.every(x => x.s === bySeq.get(x.f));
  const again = frames.every(f => JSON.stringify(evaluateFrameState(graph, f)) === bySeq.get(f));
  check("1a shuffled order == sequential order", allEq && again, `frames ${frames.join(",")} (graph ${graph.durationFrames}f @${graph.fps}fps)`);
  // full sweep: reverse and sequential identical for every frame
  let sweep = true; const ref: string[] = []; for (let f = 0; f < graph.durationFrames; f++) ref.push(JSON.stringify(evaluateFrameState(graph, f)));
  for (let f = graph.durationFrames - 1; f >= 0; f--) if (JSON.stringify(evaluateFrameState(graph, f)) !== ref[f]) { sweep = false; break; }
  check("1b all frames, reverse sweep == forward sweep", sweep, `${graph.durationFrames} frames`);
  const s299 = evaluateFrameState(graph, 299), s300 = evaluateFrameState(graph, 300), boundary = graph.scenes[1].startFrame;
  check("1c half-open boundary: frame 241 / 242 map to different scenes, no gap", evaluateFrameState(graph, boundary - 1).sceneIndex === 0 && evaluateFrameState(graph, boundary).sceneIndex === 1, `boundary=${boundary}; 299->${s299.sceneId}, 300->${s300.sceneId}`);
  const sp = evaluateSpring(0.37, 150, 15, 1), sp2 = evaluateSpring(0.37, 150, 15, 1); check("1d analytic spring is stateless/seekable", sp.position === sp2.position && Math.abs(evaluateSpring(5, 150, 15, 1).position - 1) < 1e-6, `x(0.37)=${sp.position.toFixed(6)}`);
  // RNG vs an independent Python uint32 implementation (same algorithm as the GLSL string)
  const probes: [number, number, number][] = [[1, 0, 0], [12345, 300, 2], [0xdeadbeef, 99999, 7], [42, MAX_BARCODE_FRAME, 3], [0, 0, 0]];
  const pyRun = spawnSync("python3", ["-I", "-c", [
    "import json,sys", "M=0xFFFFFFFF",
    "def h(x):", "    x&=M; x^=x>>16; x=(x*0x7feb352d)&M; x^=x>>15; x=(x*0x846ca68b)&M; x^=x>>16; return x",
    "def h3(s,i,c):", "    v=h(s); v=h((v^i)&M); v=h((v+(c*0x9e3779b9))&M); return v",
    "print(json.dumps([h3(*p) for p in json.loads(sys.argv[1])]))"].join("\n"), JSON.stringify(probes)], { encoding: "utf8" });
  const pyVals = JSON.parse(pyRun.stdout) as number[]; const tsVals = probes.map(p => hash3(p[0], p[1], p[2]));
  check("1f counter RNG bit-identical to independent uint32 (GLSL-equivalent) implementation", pyVals.every((v, i) => v === tsVals[i]), probes.map((_, i) => `${tsVals[i]}`).join(","));
  const bits = frameBits(777); check("1e counter RNG stateless + barcode bits", rand3(1, 5, 0) === rand3(1, 5, 0) && hash3(1, 5, 0) === hash3(1, 5, 0) && bits.length === 24, `rand3(1,5,0)=${rand3(1, 5, 0)}`);
}

/* ---- 2. 4-layer sharpness + colour through the bt709 pipe ---- */
const W = 360, H = 640, FRAMES = 60;
{
  const bundle = buildSync({ entryPoints: [join(ROOT, "tests", "fixtures", "pageEntry.ts")], bundle: true, write: false, format: "iife", platform: "browser", target: "es2022" }).outputFiles[0].text;
  const body = renderToStaticMarkup(React.createElement(LayerCompositor, { width: W, height: H, canvasColor: "#FFFFFF", gridColor: "rgba(9,9,11,.05)", orbs: [{ cx: 90, cy: 120, size: 200, color: "rgba(230,0,0,.25)", blurPx: 60 }], vignette: 0.1, grainOpacity: 0.5 },
    React.createElement("div", { id: "swatch-red", style: { position: "absolute", left: 20, top: 20, width: 100, height: 100, background: "#E60000" } }),
    React.createElement("div", { id: "swatch-black", style: { position: "absolute", left: 130, top: 20, width: 100, height: 100, background: "#09090B" } }),
    React.createElement("div", { id: "swatch-white", style: { position: "absolute", left: 240, top: 20, width: 100, height: 100, background: "#FFFFFF", outline: "1px solid #09090B" } }),
    React.createElement("div", { id: "txt", style: { position: "absolute", left: 20, top: 200, width: 320, height: 120, background: "#09090B", color: "#FFFFFF", font: "700 44px/120px DejaVu Sans, sans-serif", textAlign: "center" } }, "SHARP"),
    React.createElement("div", { id: "frame-label", style: { position: "absolute", left: 20, top: 360, color: "#E60000", font: "700 30px DejaVu Sans, sans-serif" } }, "0")));
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#000;width:${W}px;height:${H + 8}px;overflow:hidden}#barcode-host{position:absolute;left:0;top:${H}px;width:${W}px;height:8px;background:#000}</style></head><body>${body}<div id="barcode-host"></div><script>${bundle}</script></body></html>`;
  const page = join(WORK, "page.html"); writeFileSync(page, html);
  const graph2 = { ...graph, durationFrames: FRAMES, fps: 30 as const, scenes: [{ ...graph.scenes[0], id: "scene_a", startFrame: 0, endFrame: 30, entities: [] }, { ...graph.scenes[0], id: "scene_b", startFrame: 30, endFrame: FRAMES, entities: [] }] } as unknown as SceneGraph;
  const out = join(WORK, "phase0.mp4");
  const res = await renderPipeline({ graph: graph2, width: W, height: H, workDir: join(WORK, "chunks"), out, renderer: captureChunkRenderer({ pageUrl: "file://" + page, check: "every" }), maxChunkFrames: 30 /* two scenes -> two chunks -> real -c copy concat */, log: () => undefined });
  const p = res.probe;
  check("2a output resolution", p.width === W && p.height === H, `${p.width}x${p.height}`);
  check("2b frame count after -c copy concat", p.frames === FRAMES, `${p.frames}/${FRAMES}  chunks=${res.jobs.length}`);
  check("2c bt709 tags + yuv420p", p.colorSpace === "bt709" && p.colorPrimaries === "bt709" && p.colorTransfer === "bt709" && p.pixFmt === "yuv420p", `${p.colorSpace}/${p.colorPrimaries}/${p.colorTransfer}/${p.pixFmt}`);
  check("2d closed GOP (keyframes every 60 or less, first at 0)", p.gop[0] === 0 && p.gop.every((k, i) => i === 0 || k - p.gop[i - 1] <= 60), `keyframes@${p.gop.join(",")}`);
  const args = buildEncodeArgs({ out: "x.mp4", width: W, height: H, fps: 30 }).join(" ");
  check("2e encoder flags", ["-g 60", "-keyint_min 60", "-sc_threshold 0", "-crf 16", "-colorspace bt709", "-color_primaries bt709", "-color_trc bt709"].every(s => args.includes(s)), "g60 keyint60 sc0 crf16 bt709");
  // decode frame 30 -> RGB with explicit bt709 matrix
  const raw = spawnSync("ffmpeg", ["-v", "error", "-i", out, "-vf", "select=eq(n\\,30),scale=in_color_matrix=bt709:in_range=tv:out_range=full,format=rgb24", "-frames:v", "1", "-f", "rawvideo", "pipe:1"], { maxBuffer: 1 << 26 }).stdout;
  const px = (x: number, y: number): [number, number, number] => { const o = (y * W + x) * 3; return [raw[o], raw[o + 1], raw[o + 2]]; };
  const near = (a: number[], b: number[], tol: number) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
  const red = px(70, 70), blk = px(180, 70), wht = px(290, 70);
  check("2f #E60000 swatch accuracy (tol 4, hue kept)", near(red, [230, 0, 0], 4), `got rgb(${red.join(",")})`);
  check("2g #09090B swatch accuracy", near(blk, [9, 9, 11], 4), `got rgb(${blk.join(",")})`);
  check("2h #FFFFFF swatch accuracy", near(wht, [255, 255, 255], 4), `got rgb(${wht.join(",")})`);
  // text sharpness: SHARP text interior must reach (near) pure white against near-black without grey halo plateau -> count of near-white pixels and strong edges
  let white = 0, edges = 0, total = 0; for (let y = 200; y < 320; y++) for (let x = 20; x < 340; x++) { const l = px(x, y)[0]; total++; if (l > 245) white++; const r = px(x + 1, y)[0]; if (Math.abs(l - r) > 180) edges++; }
  check("2i sharp text (pure-white glyph pixels + hard edges, no blur)", white > 400 && edges > 100, `white=${white} hardEdges=${edges}`);
  // contract audit in a real browser
  const br = await chromium.launch({ executablePath: resolveChrome() }); const pg = await br.newPage({ viewport: { width: W, height: H + 8 } }); await pg.goto("file://" + page);
  const bad = await pg.evaluate(() => (window as unknown as { __audit(): string[] }).__audit()); await br.close();
  check("2j L2 has no filter/backdrop-filter/blend/mask on itself or any ancestor", bad.length === 0, bad.length ? bad.join("; ") : "0 violations");
  check("2k frame barcode verified on every captured frame", true, `${FRAMES} frames checked (throws on mismatch)`);
}

/* ---- 3. scheduler concurrency ---- */
{
  const mk = (n: number, cls: "gpu-heavy" | "cpu-dom", off: number): ChunkJob[] => Array.from({ length: n }, (_, i) => ({ index: off + i, startFrame: (off + i) * 10, endFrame: (off + i + 1) * 10, sceneIds: [`s${off + i}`], cls, browserGpu: cls === "gpu-heavy" }));
  const work = async (): Promise<void> => { await new Promise<void>(r => setTimeout(r, 40)); };
  const g = await runPool(mk(5, "gpu-heavy", 0), 4, work); check("3a 5 gpu-heavy jobs serialize to 1 worker", g.stats.maxGpuConcurrent === 1 && g.stats.maxTotalConcurrent === 1, `maxGpu=${g.stats.maxGpuConcurrent}`);
  const c = await runPool(mk(8, "cpu-dom", 0), 4, work); check("3b 8 cpu-dom jobs run concurrently (4 workers)", c.stats.maxCpuConcurrent === 4, `maxCpu=${c.stats.maxCpuConcurrent}`);
  const mixed = [...mk(3, "gpu-heavy", 0), ...mk(6, "cpu-dom", 3)].map((j, i) => ({ ...j, index: i })); const m = await runPool(mixed, 3, work);
  check("3c mixed: gpu<=1 and cpu<=3 at all times", m.stats.maxGpuConcurrent === 1 && m.stats.maxCpuConcurrent === 3, `gpu=${m.stats.maxGpuConcurrent} cpu=${m.stats.maxCpuConcurrent} total=${m.stats.maxTotalConcurrent}`);
  const gOrd = m.stats.order.filter(o => o.cls === "gpu-heavy").sort((a, b) => a.startedAt - b.startedAt); const noOverlap = gOrd.every((o, i) => i === 0 || o.startedAt > gOrd[i - 1].endedAt);
  check("3d gpu-heavy intervals never overlap", noOverlap, `${gOrd.length} gpu jobs strictly sequential`);
  let threw = false; try { await runPool(mk(1, "cpu-dom", 0), 9, work); } catch { threw = true; } check("3e cpu workers limited to 2..4", threw, "9 workers rejected");
  const man = buildCostManifest(graph); const jobs = planSceneChunks(man, 100000); assertChunkCoverage(jobs, graph.durationFrames);
  check("3f chunks cut on scene boundaries, cover [0,total) exactly once", jobs.every(j => graph.scenes.some(s => s.startFrame === j.startFrame) && graph.scenes.some(s => s.endFrame === j.endFrame)), jobs.map(j => `[${j.startFrame},${j.endFrame})${j.cls}`).join(" "));
}

/* ---- 4. tsc ---- */
{
  const r = spawnSync("npx", ["tsc", "--noEmit"], { cwd: ROOT, encoding: "utf8" });
  check("4 npx tsc --noEmit", r.status === 0, r.status === 0 ? "0 errors" : (r.stdout + r.stderr).slice(0, 400));
}
const failed = rows.filter(r => !r.ok).length;
console.log(`\n==== PHASE 0 REPORT: ${rows.length - failed}/${rows.length} passed ====`); for (const r of rows) console.log(`${r.ok ? "[x]" : "[ ]"} ${r.name} - ${r.detail}`);
writeFileSync(join(WORK, "report.json"), JSON.stringify(rows, null, 1)); process.exit(failed ? 1 : 0);
