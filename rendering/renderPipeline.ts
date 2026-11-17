/**
 * renderPipeline - resource-class scheduled, pipe-encoded, scene-boundary-chunked renderer.
 *   manifest -> jobs (scene boundaries, half-open) -> pool (<=1 gpu-heavy, 2..4 cpu-dom) -> per-chunk ffmpeg pipe (bt709, closed GOP)
 *   -> concat -c copy -> single audio mux.
 * Two interchangeable chunk renderers:
 *   - captureChunkRenderer: Playwright harness; every frame = seek(frame) + FrameBarrier.settle() + screenshot -> ffmpeg stdin (no PNG files on disk).
 *   - hyperframesChunkRenderer: the existing Hyperframes CLI (it writes its own mp4 so it cannot be piped); output is trimmed to exact frames and re-encoded with the same bt709/closed-GOP settings.
 */
import { chromium, type Browser, type Page } from "playwright-core";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, existsSync, renameSync } from "node:fs";
import { join, resolve } from "node:path";
import type { SceneGraph } from "../schemas/scene.schema.js";
import { assertFps, type Fps } from "../core/determinism/timelineClock.js";
import { BARCODE_BITS, decodeBarcode, type BarcodeGeom } from "../core/determinism/frameBarrier.js";
import { buildCostManifest, planSceneChunks, assertChunkCoverage, runPool, chromeArgs, cpuWorkerCount, type ChunkJob, type PoolStats, type ResourceClass } from "./resourceScheduler.js";
import { FfmpegPipeEncoder, concatCopy, muxAudio, bt709Args, probe, type ProbeInfo } from "./ffmpegPipeEncoder.js";

export const BARCODE_STRIP_PX = 8;
/** Browser resolution: explicit env, then system Chrome, then any Playwright-bundled chromium. */
export function resolveChrome(explicit?: string): string | undefined {
  const cands = [
    explicit,
    process.env["HYPERFRAMES_BROWSER_PATH"],
    process.env["CHROME_PATH"],
    // Windows
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    // Linux
    "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable",
  ];
  for (const c of cands) if (c && existsSync(c)) return c;
  return undefined;
}
export const barcodeGeom = (): BarcodeGeom => ({ cell: 4, x0: 0, y: 0 });
export type BarcodeCheck = "off" | "sparse" | "every";

/** A chunk renderer produces an encoded mp4 holding exactly frames [job.startFrame, job.endFrame). */
export type ChunkRenderer = (job: ChunkJob, ctx: RenderContext) => Promise<string>;
export interface RenderContext { readonly graph: SceneGraph; readonly fps: Fps; readonly width: number; readonly height: number; readonly workDir: string; readonly log: (s: string) => void }

export interface PipelineOptions {
  readonly graph: SceneGraph; readonly width: number; readonly height: number; readonly workDir: string; readonly out: string; readonly audio?: string;
  readonly renderer: ChunkRenderer; readonly maxChunkFrames?: number; readonly cpuWorkers?: number; readonly cores?: number; readonly log?: (s: string) => void;
}
export interface PipelineResult { readonly out: string; readonly jobs: readonly ChunkJob[]; readonly stats: PoolStats; readonly probe: ProbeInfo }

export async function renderPipeline(o: PipelineOptions): Promise<PipelineResult> {
  const fps = assertFps(o.graph.fps); const log = o.log ?? ((s: string) => console.log(s));
  const jobs = planSceneChunks(buildCostManifest(o.graph), o.maxChunkFrames ?? 900); assertChunkCoverage(jobs, o.graph.durationFrames);
  mkdirSync(o.workDir, { recursive: true });
  const ctx: RenderContext = { graph: o.graph, fps, width: o.width, height: o.height, workDir: o.workDir, log };
  const { results, stats } = await runPool(jobs, cpuWorkerCount(o.cores ?? 4, o.cpuWorkers), j => { log(`chunk ${j.index} [${j.startFrame},${j.endFrame}) ${j.cls}`); return o.renderer(j, ctx); });
  const joined = join(o.workDir, "joined.mp4"); concatCopy(results, o.audio ? joined : o.out);
  if (o.audio) muxAudio(joined, o.audio, o.out);
  return { out: o.out, jobs, stats, probe: probe(o.out) };
}

/* ---------------- Playwright capture renderer (frames piped straight into ffmpeg) ---------------- */
export interface CaptureHooks {
  /** URL of the page to load (file:// or http://localhost). Page must define window.__setFrame(frame) and window.__frameBarrier (FrameBarrier-compatible). */
  readonly pageUrl: string; readonly chromePath?: string; readonly check?: BarcodeCheck;
}
const pngToRgb = (png: Buffer): Buffer => { const r = spawnSync("ffmpeg", ["-v", "error", "-i", "pipe:0", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { input: png, maxBuffer: 1 << 26 }); if (r.status !== 0) throw new Error("png decode failed"); return r.stdout; };

export function captureChunkRenderer(h: CaptureHooks): ChunkRenderer {
  return async (job, ctx) => {
    const file = join(ctx.workDir, `chunk_${String(job.index).padStart(3, "0")}.mp4`); const part = `${file}.part.mp4`;
    const browser: Browser = await chromium.launch({ executablePath: resolveChrome(h.chromePath), args: chromeArgs(job.cls) });
    try {
      const page: Page = await browser.newPage({ viewport: { width: ctx.width, height: ctx.height + BARCODE_STRIP_PX }, deviceScaleFactor: 1 });
      await page.goto(h.pageUrl); await page.evaluate(() => (window as unknown as { __frameBarrier: { settle(): Promise<void> } }).__frameBarrier.settle());
      const enc = new FfmpegPipeEncoder({ out: part, width: ctx.width, height: ctx.height, fps: ctx.fps, format: "png" }); const check = h.check ?? "sparse"; const geom = barcodeGeom();
      for (let f = job.startFrame; f < job.endFrame; f++) {
        await page.evaluate(async (frame: number) => { const w = window as unknown as { __setFrame(f: number): void; __frameBarrier: { settle(): Promise<void> } }; w.__setFrame(frame); await w.__frameBarrier.settle(); }, f);
        if (check === "every" || (check === "sparse" && (f === job.startFrame || f === job.endFrame - 1 || f % 30 === 0))) {
          const strip = await page.screenshot({ type: "png", clip: { x: 0, y: ctx.height, width: ctx.width, height: BARCODE_STRIP_PX } });
          const got = decodeBarcode(pngToRgb(strip), ctx.width, 3, { ...geom, y: 0 });
          if (got !== f) throw new Error(`frame barrier mismatch: requested ${f}, captured ${got}`);
        }
        await enc.write(await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: ctx.width, height: ctx.height } })); // barcode strip is outside this clip
      }
      await enc.finish(); renameSync(part, file); return file;
    } finally { await browser.close(); }
  };
}

/* ---------------- Hyperframes CLI renderer (existing path preserved) ---------------- */
export interface HyperframesHooks { readonly projectDir: string; readonly quality?: "draft" | "looks" | "delivery"; readonly handle?: number; readonly chromePath?: string }
/** npx resolves/installs the CLI into a shared cache on first use; concurrent first calls race, so warm it once serially. */
let warmed: Promise<void> | null = null;
const NPM_BIN = process.platform === "win32" ? "C:\\Program Files\\nodejs\\npx.cmd" : "npx";
const warmHyperframes = (): Promise<void> => (warmed ??= new Promise<void>(res => { const p = spawn(NPM_BIN, ["hyperframes", "--version"], { stdio: "ignore" }); p.on("close", () => res()); p.on("error", () => res()); }));
export function hyperframesChunkRenderer(h: HyperframesHooks): ChunkRenderer {
  return async (job, ctx) => {
    const handle = h.handle ?? 6, rs = Math.max(0, job.startFrame - handle), re = Math.min(ctx.graph.durationFrames, job.endFrame + handle), n = job.endFrame - job.startFrame;
    const raw = join(ctx.workDir, `hf_${job.index}.raw.mp4`), file = join(ctx.workDir, `chunk_${String(job.index).padStart(3, "0")}.mp4`);
    const gpuFlag = job.browserGpu ? "--browser-gpu" : "--no-browser-gpu";
    await warmHyperframes();
    let errTail = ""; const code = await new Promise<number>(res => { const p = spawn(NPM_BIN, ["hyperframes", "render", resolve(h.projectDir), "--start", String(rs / ctx.fps), "--end", String(re / ctx.fps), "--fps", String(ctx.fps), "-q", h.quality ?? "looks", "--workers", "1", gpuFlag, "-o", raw, "--quiet"], { cwd: h.projectDir, stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, HYPERFRAMES_BROWSER_PATH: resolveChrome(h.chromePath) } }); p.stderr.on("data", d => { errTail = (errTail + String(d)).slice(-600); }); p.on("close", c => res(c ?? 1)); });
    if (code !== 0 || !existsSync(raw)) throw new Error(`hyperframes chunk ${job.index} failed (exit ${code}) ${errTail.trim()}`);
    const lead = job.startFrame - rs; const gop = "60";
    const r = spawnSync("ffmpeg", ["-y", "-v", "error", "-i", raw, "-vf", `trim=start_frame=${lead}:end_frame=${lead + n},setpts=PTS-STARTPTS,scale=in_range=full:out_range=tv:in_color_matrix=bt709:out_color_matrix=bt709,format=yuv420p`, "-r", String(ctx.fps), "-an", "-c:v", "libx264", "-crf", "16", "-g", gop, "-keyint_min", gop, "-sc_threshold", "0", "-flags", "+cgop", ...bt709Args(), file], { encoding: "utf8" });
    rmSync(raw, { force: true }); if (r.status !== 0) throw new Error(`trim/encode failed: ${r.stderr}`); return file;
  };
}
export type { ResourceClass };
export { BARCODE_BITS };
