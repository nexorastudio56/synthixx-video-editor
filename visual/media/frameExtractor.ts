/** Offline, exact source-frame extraction (Node). Frames are addressed by native frame index, so there is no async <video> seek/playback drift. */
import { spawnSync } from "node:child_process";
import { mkdirSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { frameFileName, type MediaClock } from "./mediaTiming.js";

export interface VideoInfo { readonly width: number; readonly height: number; readonly frames: number; readonly srcFps: number }
export function probeVideo(file: string): VideoInfo {
  const r = spawnSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=width,height,nb_read_frames,r_frame_rate", "-of", "json", resolve(file)], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffprobe failed: ${r.stderr}`);
  const s = (JSON.parse(r.stdout) as { streams: Record<string, string>[] }).streams[0]; const [n, d] = s["r_frame_rate"].split("/").map(Number);
  return { width: +s["width"], height: +s["height"], frames: +s["nb_read_frames"], srcFps: n / d };
}
export interface ExtractOptions { readonly from?: number; readonly to?: number; readonly maxWidth?: number; readonly format?: "png" | "jpg" }
export interface ExtractedMedia { readonly dir: string; readonly ext: string; readonly firstIndex: number; readonly lastIndex: number; readonly srcFps: number; readonly width: number; readonly height: number }
export function extractSourceFrames(file: string, outDir: string, o: ExtractOptions = {}): ExtractedMedia {
  const info = probeVideo(file), from = o.from ?? 0, to = Math.min(o.to ?? info.frames - 1, info.frames - 1), ext = o.format ?? "png"; if (from > to) throw new RangeError(`bad range ${from}..${to}`);
  mkdirSync(outDir, { recursive: true }); const mw = o.maxWidth ?? info.width;
  const args = ["-y", "-v", "error", "-i", resolve(file), "-an", "-vf", `select='between(n,${from},${to})',scale='min(${mw},iw)':-2:flags=lanczos`, "-fps_mode", "passthrough", "-start_number", String(from), ...(ext === "jpg" ? ["-q:v", "2"] : []), join(resolve(outDir), `src_%06d.${ext}`)];
  const r = spawnSync("ffmpeg", args, { encoding: "utf8" }); if (r.status !== 0) throw new Error(`frame extraction failed: ${r.stderr}`);
  for (const i of [from, to]) if (!existsSync(join(outDir, frameFileName(i, ext)))) throw new Error(`missing extracted frame ${i}`);
  const n = readdirSync(outDir).filter(f => f.endsWith(`.${ext}`)).length; if (n < to - from + 1) throw new Error(`extracted ${n} frames, expected ${to - from + 1}`);
  return { dir: resolve(outDir), ext, firstIndex: from, lastIndex: to, srcFps: info.srcFps, width: Math.min(mw, info.width), height: Math.round((info.height * Math.min(mw, info.width)) / info.width / 2) * 2 };
}
export const clockFor = (m: ExtractedMedia, startFrame: number, fps: number, extra: Partial<MediaClock> = {}): MediaClock => ({ startFrame, fps, srcFps: m.srcFps, firstIndex: m.firstIndex, lastIndex: m.lastIndex, ...extra });
