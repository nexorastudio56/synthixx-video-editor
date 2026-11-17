/**
 * Resumable chunk orchestrator (built for 20-minute / 72,000-frame renders).
 *  - every chunk is CONTENT-ADDRESSED: sha256(sceneSlice, resolvedThemeHash, assetHashes, bakeHashes, rendererVersion)
 *  - projects/<jobId>/manifest.json holds per-chunk status; written atomically (tmp + fsync + rename), serialised
 *  - on (re)start every "done" chunk is VERIFIED (key, size, sha256, ffprobe frame count); only unfinished/invalid chunks render
 *  - gpu-heavy chunks run serially (concurrency 1), cpu-dom chunks in parallel (concurrency 3), via the shared resource pool
 *  - finished chunks are concatenated with -c copy (closed GOP, bt709) and the FULL-LENGTH audio is muxed once at the end
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import type { SceneGraph } from "../schemas/scene.schema.js";
import { CANVAS } from "../schemas/scene.schema.js";
import { buildCostManifest, planSceneChunks, assertChunkCoverage, runPool, type ChunkJob, type PoolStats } from "./resourceScheduler.js";
import { concatCopy, muxAudio, probe } from "./ffmpegPipeEncoder.js";
import type { ChunkRenderer, RenderContext } from "./renderPipeline.js";
import { stableStringify } from "../styles/themeCompiler.js";
import { compiledFor } from "../visual/materials/themeBridge.js";

export const RENDERER_VERSION = "engine3-chunk-2";
export const GPU_CONCURRENCY = 1, CPU_CONCURRENCY = 3;
export type ChunkStatus = "pending" | "running" | "done" | "failed";
export interface ChunkRecord { index: number; startFrame: number; endFrame: number; frames: number; cls: "gpu-heavy" | "cpu-dom"; sceneIds: string[]; key: string; status: ChunkStatus; file: string | null; bytes: number; sha256: string | null; attempts: number; sec: number; error: string | null }
export interface Manifest {
  version: 1; jobId: string; rendererVersion: string; fps: number; totalFrames: number; width: number; height: number; themeHash: string; createdAt: string; updatedAt: string;
  chunks: ChunkRecord[]; scheduler: { gpuRunning: number; cpuRunning: number; gpuLimit: number; cpuLimit: number; peakGpu: number; peakCpu: number };
  verified: number; rendered: number; final: { path: string; frames: number; bytes: number } | null; state: "planning" | "rendering" | "assembling" | "complete" | "failed";
}
export interface OrchestratorOptions {
  readonly jobId: string; readonly projectsRoot: string; readonly graph: SceneGraph; readonly renderer: ChunkRenderer; readonly out: string; readonly audioPath: string;
  readonly projectDir?: string;                    // emitted Hyperframes project (composition html is folded into the scene slice when present)
  readonly maxChunkFrames?: number; readonly cpuConcurrency?: number; readonly retries?: number; readonly rendererVersion?: string; readonly quality?: string;
  readonly bakesDir?: string; readonly log?: (s: string) => void; readonly onUpdate?: (m: Manifest) => void;
  readonly budgetSec?: number;                     // time-box: stop scheduling new chunks after this many seconds (resume later)
}
export interface OrchestratorResult { complete: boolean; manifest: Manifest; stats: PoolStats | null; skipped: number; rendered: number; pending: number; out: string | null }

const sha = (b: Buffer | string): string => crypto.createHash("sha256").update(b).digest("hex");
const fileSha = (f: string): string => sha(fs.readFileSync(f));
export const manifestPath = (root: string, jobId: string): string => path.join(root, jobId, "manifest.json");

/** (sceneSlice, resolvedThemeHash, assetHashes, bakeHashes, rendererVersion) -> chunk key */
export function chunkContentKey(g: SceneGraph, job: ChunkJob, ex: { themeHash: string; assetHashes: Record<string, string>; bakeHashes: Record<string, string>; rendererVersion: string; compositionHashes?: Record<string, string> }): string {
  const ids = new Set(job.sceneIds); const scenes = g.scenes.filter(s => ids.has(s.id));
  const sceneSlice = { range: [job.startFrame, job.endFrame], fps: g.fps, aspect: g.aspectRatio, morphism: g.morphism, scenes, compositions: scenes.map(s => ex.compositionHashes?.[s.id] ?? null) };
  const used = new Set(scenes.flatMap(s => s.entities.map(e => e.assetId).filter((x): x is string => !!x)));
  const assetHashes = Object.fromEntries([...used].sort().map(id => [id, ex.assetHashes[id] ?? "missing"]));
  const bakeHashes = Object.fromEntries(scenes.map(s => [s.id, ex.bakeHashes[s.id] ?? "none"]));
  return sha(stableStringify({ sceneSlice, resolvedThemeHash: ex.themeHash, assetHashes, bakeHashes, rendererVersion: ex.rendererVersion }));
}
export function resolvedThemeHash(g: SceneGraph): string { return g.theme ? compiledFor(g.theme).hash : "legacy-synthixx-brand"; }
function assetHashesOf(g: SceneGraph, root: string): Record<string, string> { const m: Record<string, string> = {}; for (const a of g.assets) { if (a.sha256) m[a.id] = a.sha256; else { const f = path.resolve(root, a.path); if (fs.existsSync(f)) m[a.id] = fileSha(f); } } return m; }
function bakeHashesOf(g: SceneGraph, dir: string | undefined): Record<string, string> {
  const m: Record<string, string> = {}; if (!dir || !fs.existsSync(dir)) return m;
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort();
  for (const s of g.scenes) { const hit = files.filter(f => f.includes(s.id)); if (hit.length) m[s.id] = sha(hit.map(f => fileSha(path.join(dir, f))).join("|")); }
  return m;
}
function compositionHashesOf(g: SceneGraph, projectDir: string | undefined): Record<string, string> {
  const m: Record<string, string> = {}; if (!projectDir) return m;
  for (const s of g.scenes) { const f = path.join(projectDir, "compositions", `${s.id}.html`); if (fs.existsSync(f)) m[s.id] = fileSha(f); }
  for (const x of ["bg", "cine"]) { const f = path.join(projectDir, "compositions", `${x}.html`); if (fs.existsSync(f)) m[x] = fileSha(f); }
  return m;
}
/** composition hash of the always-present layers is folded into every scene's slice */
function withGlobalLayers(per: Record<string, string>, g: SceneGraph): Record<string, string> { const glob = sha((per["bg"] ?? "") + (per["cine"] ?? "")); return Object.fromEntries(g.scenes.map(s => [s.id, sha((per[s.id] ?? "") + glob)])); }

/** atomic JSON write: tmp -> fsync -> rename (a crash can never leave a torn manifest) */
export function atomicWriteJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = `${file}.${process.pid}.tmp`; const fd = fs.openSync(tmp, "w");
  try { fs.writeSync(fd, JSON.stringify(data, null, 1)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } fs.renameSync(tmp, file);
}
function frameCount(file: string): number { try { return probe(file).frames; } catch { return -1; } }

/** verify a "done" record against the disk: key, existence, size, sha256, decoded frame count */
export function verifyChunk(rec: ChunkRecord, expectKey: string): boolean {
  if (rec.status !== "done" || rec.key !== expectKey || !rec.file || !fs.existsSync(rec.file)) return false;
  const st = fs.statSync(rec.file); if (st.size !== rec.bytes || st.size === 0) return false;
  if (fileSha(rec.file) !== rec.sha256) return false;
  return frameCount(rec.file) === rec.frames;
}

export async function orchestrate(o: OrchestratorOptions): Promise<OrchestratorResult> {
  const log = o.log ?? ((): void => undefined); const g = o.graph; const t0 = Date.now();
  const projectRoot = path.resolve(o.projectsRoot, ".."); const jobDir = path.resolve(o.projectsRoot, o.jobId), chunkDir = path.join(jobDir, "chunks"); fs.mkdirSync(chunkDir, { recursive: true });
  const rv = o.rendererVersion ?? `${RENDERER_VERSION}|q=${o.quality ?? "default"}|${g.fps}fps|${g.aspectRatio}`, themeHash = resolvedThemeHash(g);
  const jobs = planSceneChunks(buildCostManifest(g), o.maxChunkFrames ?? 450); assertChunkCoverage(jobs, g.durationFrames);
  const ex = { themeHash, assetHashes: assetHashesOf(g, projectRoot), bakeHashes: bakeHashesOf(g, o.bakesDir ?? path.join(o.projectsRoot, "bakes")), rendererVersion: rv, compositionHashes: withGlobalLayers(compositionHashesOf(g, o.projectDir), g) };
  const mp = manifestPath(o.projectsRoot, o.jobId); const { width, height } = CANVAS[g.aspectRatio];
  let prev: Manifest | null = null; if (fs.existsSync(mp)) { try { prev = JSON.parse(fs.readFileSync(mp, "utf8")) as Manifest; } catch { prev = null; } } // torn/corrupt manifest => start clean (chunk files are re-verified by hash anyway)
  for (const f of fs.readdirSync(chunkDir)) if (f.endsWith(".part.mp4") || f.startsWith("work_")) fs.rmSync(path.join(chunkDir, f), { recursive: true, force: true }); // crash leftovers
  const m: Manifest = {
    version: 1, jobId: o.jobId, rendererVersion: rv, fps: g.fps, totalFrames: g.durationFrames, width, height, themeHash, createdAt: prev?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString(),
    chunks: jobs.map(j => ({ index: j.index, startFrame: j.startFrame, endFrame: j.endFrame, frames: j.endFrame - j.startFrame, cls: j.cls, sceneIds: [...j.sceneIds], key: chunkContentKey(g, j, ex), status: "pending" as ChunkStatus, file: null, bytes: 0, sha256: null, attempts: 0, sec: 0, error: null })),
    scheduler: { gpuRunning: 0, cpuRunning: 0, gpuLimit: GPU_CONCURRENCY, cpuLimit: o.cpuConcurrency ?? CPU_CONCURRENCY, peakGpu: 0, peakCpu: 0 }, verified: 0, rendered: 0, final: null, state: "planning",
  };
  // ---- resume: adopt verified chunks by CONTENT KEY (position-independent), discard the rest
  const byKey = new Map<string, ChunkRecord>(); for (const r of prev?.chunks ?? []) if (r.status === "done") byKey.set(r.key, r);
  for (const rec of m.chunks) { const old = byKey.get(rec.key); if (old && verifyChunk(old, rec.key)) { Object.assign(rec, { status: "done", file: old.file, bytes: old.bytes, sha256: old.sha256, attempts: old.attempts, sec: old.sec }); m.verified++; } }
  const live = new Set(m.chunks.filter(c => c.file).map(c => path.resolve(c.file!))); // garbage-collect chunk files no longer referenced
  for (const f of fs.readdirSync(chunkDir)) { const full = path.resolve(chunkDir, f); if (f.endsWith(".mp4") && !live.has(full)) fs.rmSync(full, { force: true }); }
  m.state = "rendering"; let writing: Promise<void> = Promise.resolve();
  const flush = (): void => { m.updatedAt = new Date().toISOString(); const snap = structuredClone(m); writing = writing.then(() => { atomicWriteJson(mp, snap); o.onUpdate?.(snap); }); };
  flush(); log(`job ${o.jobId}: ${m.chunks.length} chunks, ${m.verified} verified (skipped), ${m.chunks.length - m.verified} to render`);

  const todo = jobs.filter(j => m.chunks[j.index]!.status !== "done"); let stats: PoolStats | null = null; let stop = false; let failure: Error | null = null;
  const retries = o.retries ?? 2;
  if (todo.length) {
    const ctx: RenderContext = { graph: g, fps: g.fps as 30 | 60, width, height, workDir: chunkDir, log };
    const work = async (j: ChunkJob): Promise<void> => {
      const rec = m.chunks[j.index]!; if (o.budgetSec && (Date.now() - t0) / 1000 > o.budgetSec) { stop = true; return; }
      rec.status = "running"; if (j.cls === "gpu-heavy") m.scheduler.gpuRunning++; else m.scheduler.cpuRunning++;
      m.scheduler.peakGpu = Math.max(m.scheduler.peakGpu, m.scheduler.gpuRunning); m.scheduler.peakCpu = Math.max(m.scheduler.peakCpu, m.scheduler.cpuRunning); flush();
      const ts = Date.now(); let ok = false, lastErr = "";
      for (let a = 0; a <= retries && !ok; a++) {
        rec.attempts++; const wd = path.join(chunkDir, `work_${j.index}`); fs.rmSync(wd, { recursive: true, force: true }); fs.mkdirSync(wd, { recursive: true });
        try {
          const produced = await o.renderer(j, { ...ctx, workDir: wd }); const n = frameCount(produced);
          if (n !== rec.frames) throw new Error(`chunk ${j.index}: ${n} frames, expected ${rec.frames}`);
          const final = path.join(chunkDir, `c${String(j.index).padStart(4, "0")}_${rec.key.slice(0, 16)}.mp4`), part = final.replace(/\.mp4$/, ".part.mp4");
          fs.copyFileSync(produced, part); const fd = fs.openSync(part, "r"); fs.fsyncSync(fd); fs.closeSync(fd); fs.renameSync(part, final);
          rec.file = final; rec.bytes = fs.statSync(final).size; rec.sha256 = fileSha(final); rec.error = null; ok = true; m.rendered++;
        } catch (e) { lastErr = (e as Error).message; log(`chunk ${j.index} attempt ${a + 1} failed: ${lastErr}`); }
        fs.rmSync(wd, { recursive: true, force: true });
      }
      rec.sec = +((Date.now() - ts) / 1000).toFixed(2); rec.status = ok ? "done" : "failed"; rec.error = ok ? null : lastErr;
      if (j.cls === "gpu-heavy") m.scheduler.gpuRunning--; else m.scheduler.cpuRunning--; flush();
      if (!ok) throw new Error(`chunk ${j.index} failed after ${retries + 1} attempts: ${lastErr}`);
    };
    try { stats = (await runPool(todo, o.cpuConcurrency ?? CPU_CONCURRENCY, work)).stats; } catch (e) { failure = e as Error; }
  }
  const pending = m.chunks.filter(c => c.status !== "done").length;
  if (failure) { m.state = "failed"; flush(); await writing; throw failure; }
  if (pending > 0) { m.state = "rendering"; flush(); await writing; log(`time-boxed: ${pending} chunk(s) pending; re-run to resume`); return { complete: false, manifest: m, stats, skipped: m.verified, rendered: m.rendered, pending, out: null }; }
  // ---- assemble: stream-copy concat of verified chunks + ONE full-length audio mux
  m.state = "assembling"; flush();
  const video = path.join(jobDir, "video_noaudio.mp4"); concatCopy(m.chunks.map(c => c.file!), video); muxAudio(video, o.audioPath, o.out);
  const pi = probe(video); if (pi.frames !== g.durationFrames) throw new Error(`assembled ${pi.frames} frames, expected ${g.durationFrames}`);
  m.final = { path: path.resolve(o.out), frames: pi.frames, bytes: fs.statSync(o.out).size }; m.state = "complete"; flush(); await writing;
  return { complete: true, manifest: m, stats, skipped: m.verified, rendered: m.rendered, pending: 0, out: o.out };
}
/** hand-rolled ffprobe frame count without the heavy pipeline import (used by tests) */
export const countFrames = (f: string): number => { const r = spawnSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", f], { encoding: "utf8" }); return parseInt(r.stdout.trim(), 10) || -1; };
