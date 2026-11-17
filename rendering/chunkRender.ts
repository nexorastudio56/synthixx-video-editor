/** Deterministic chunked renderer: global-frame partition + handles, bounded worker pool, content-addressed cache, crash recovery, FFmpeg assembly. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";

export interface Chunk { i: number; start: number; end: number; rs: number; re: number } // [start,end) exact; [rs,re) rendered incl. handles
export const ENGINE_VERSION = "engine3-1";
export function planChunks(total: number, chunkFrames = 450, handle = 6): Chunk[] {
  const n = Math.max(1, Math.round(total / chunkFrames)); const base = Math.ceil(total / n); const out: Chunk[] = [];
  for (let i = 0, s = 0; s < total; i++, s += base) { const e = Math.min(total, s + base); out.push({ i, start: s, end: e, rs: Math.max(0, s - handle), re: Math.min(total, e + handle) }); }
  return out;
}
const sha = (s: string | Buffer) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 20);
export function chunkKey(projectDir: string, sceneRanges: { id: string; startFrame: number; endFrame: number }[], c: Chunk, meta: object): string {
  const h = crypto.createHash("sha256"); h.update(ENGINE_VERSION + JSON.stringify(meta) + `${c.start}-${c.end}-${c.rs}-${c.re}`);
  for (const f of ["compositions/bg.html", "compositions/cine.html"]) if (fs.existsSync(path.join(projectDir, f))) h.update(fs.readFileSync(path.join(projectDir, f)));
  h.update(fs.readFileSync(path.join(projectDir, "index.html")));
  for (const s of sceneRanges) if (s.startFrame < c.re && s.endFrame > c.rs) h.update(fs.readFileSync(path.join(projectDir, `compositions/${s.id}.html`)));
  return h.digest("hex").slice(0, 20);
}
function frames(file: string): number { const r = spawnSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", file], { encoding: "utf8" }); return parseInt(r.stdout.trim(), 10) || -1; }
function run(cmd: string, args: string[], cwd: string, log: string): Promise<number> {
  return new Promise(res => { const out = fs.openSync(log, "a"); const env = { ...process.env }; if (!env.HYPERFRAMES_BROWSER_PATH) for (const b of ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"]) if (fs.existsSync(b)) { env.HYPERFRAMES_BROWSER_PATH = b; break; }
    const p = spawn(cmd, args, { cwd, env, stdio: ["ignore", out, out] }); p.on("close", c => { fs.closeSync(out); res(c ?? 1); }); p.on("error", () => res(1)); });
}
export interface RenderOpts { projectDir: string; cacheDir: string; fps: number; durationFrames: number; scenes: { id: string; startFrame: number; endFrame: number }[]; meta: object; workers?: number; chunkFrames?: number; handle?: number; quality?: "draft" | "looks" | "delivery"; retries?: number; budgetSec?: number; log?: (s: string) => void }
export interface ChunkResult { i: number; file: string; cached: boolean; frames: number; sec: number }

export async function renderChunks(o: RenderOpts): Promise<{ chunks: ChunkResult[]; complete: boolean; pending: number }> {
  const log = o.log ?? ((s: string) => console.log(s)); fs.mkdirSync(o.cacheDir, { recursive: true });
  for (const f of fs.readdirSync(o.cacheDir)) if (f.endsWith(".part.mp4")) fs.rmSync(path.join(o.cacheDir, f), { force: true }); // crash recovery: drop half-written chunks
  const handle = o.handle ?? 6, plan = planChunks(o.durationFrames, o.chunkFrames ?? 450, handle), W = Math.min(4, Math.max(1, o.workers ?? 2)); const t0 = Date.now();
  const manifestPath = path.join(o.cacheDir, "manifest.json"); const manifest: Record<string, unknown> = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : {};
  const results: ChunkResult[] = new Array(plan.length); let next = 0; let pending = 0;
  const job = async () => {
    for (;;) {
      const idx = next++; if (idx >= plan.length) return; const c = plan[idx]; const n = c.end - c.start;
      const key = chunkKey(o.projectDir, o.scenes, c, { fps: o.fps, q: o.quality ?? "draft", handle }); const final = path.join(o.cacheDir, `c${String(c.i).padStart(3, "0")}_${key}.mp4`);
      if (fs.existsSync(final) && frames(final) === n) { results[idx] = { i: c.i, file: final, cached: true, frames: n, sec: 0 }; log(`chunk ${c.i + 1}/${plan.length}  [${c.start}-${c.end})  cache hit`); continue; }
      if (o.budgetSec && (Date.now() - t0) / 1000 > o.budgetSec) { pending++; continue; } // time-boxed run: finish later, cache keeps progress
      const ts = Date.now(); let ok = false;
      for (let a = 0; a <= (o.retries ?? 2) && !ok; a++) {
        const raw = path.join(o.cacheDir, `c${c.i}_${key}.raw.part.mp4`), trimmed = path.join(o.cacheDir, `c${c.i}_${key}.part.mp4`);
        const code = await run("npx", ["hyperframes", "render", o.projectDir, "--start", String(c.rs / o.fps), "--end", String(c.re / o.fps), "--fps", String(o.fps), "-q", o.quality ?? "draft", "--workers", "1", "-o", raw, "--quiet"], o.projectDir, path.join(o.cacheDir, `render_c${c.i}.log`));
        if (code !== 0 || !fs.existsSync(raw)) { log(`chunk ${c.i + 1} attempt ${a + 1} failed (exit ${code})`); continue; }
        const lead = c.start - c.rs; // trim handles to exact global frame range
        const t = spawnSync("ffmpeg", ["-y", "-v", "error", "-i", raw, "-vf", `trim=start_frame=${lead}:end_frame=${lead + n},setpts=PTS-STARTPTS`, "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "14", "-pix_fmt", "yuv420p", "-r", String(o.fps), trimmed], { encoding: "utf8" });
        fs.rmSync(raw, { force: true }); if (t.status !== 0 || frames(trimmed) !== n) { log(`chunk ${c.i + 1} trim mismatch (${frames(trimmed)} != ${n})`); continue; }
        fs.renameSync(trimmed, final); ok = true;
      }
      if (!ok) throw new Error(`chunk ${c.i} failed after retries`);
      const sec = +((Date.now() - ts) / 1000).toFixed(1); results[idx] = { i: c.i, file: final, cached: false, frames: n, sec }; manifest[String(c.i)] = { key, frames: n, sec, done: new Date().toISOString() }; fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
      log(`chunk ${c.i + 1}/${plan.length}  [${c.start}-${c.end}) rendered in ${sec}s`);
    }
  };
  await Promise.all(Array.from({ length: W }, job));
  return { chunks: results.filter(Boolean), complete: pending === 0 && results.filter(Boolean).length === plan.length, pending };
}

/** FFmpeg assembly: concat chunks (stream copy, identical encode params) + mux final mix. */
export function assemble(chunks: ChunkResult[], audio: string, out: string, workDir: string): void {
  const list = path.join(workDir, "concat.txt"); fs.writeFileSync(list, chunks.sort((a, b) => a.i - b.i).map(c => `file '${c.file}'`).join("\n"));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const r = spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", list, "-i", audio, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-movflags", "+faststart", "-shortest", out], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("assembly failed: " + r.stderr);
}
