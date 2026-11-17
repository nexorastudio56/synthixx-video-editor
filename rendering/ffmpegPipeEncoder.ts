/**
 * Direct FFmpeg frame pipe: raw RGBA (or PNG) frames go to ffmpeg stdin, never to disk.
 * Closed GOP (-g 60 -keyint_min 60 -sc_threshold 0), CRF 16, explicit bt709 matrix + tags so #E60000 keeps its hue.
 * Chunks are concatenated with -c copy and audio is muxed exactly once at the end.
 */
import { spawn, spawnSync, type ChildProcessByStdio } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Writable, Readable } from "node:stream";
import type { Fps } from "../core/determinism/timelineClock.js";

export type PipeFormat = "rgba" | "png";
export interface PipeOptions { readonly out: string; readonly width: number; readonly height: number; readonly fps: Fps; readonly format?: PipeFormat; readonly crf?: number; readonly preset?: string; readonly ffmpeg?: string }

export const bt709Args = (): string[] => ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"];
export function buildEncodeArgs(o: PipeOptions): string[] {
  const fmt = o.format ?? "rgba"; const gop = String(60);
  const input = fmt === "rgba" ? ["-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${o.width}x${o.height}`, "-framerate", String(o.fps), "-i", "pipe:0"] : ["-f", "image2pipe", "-c:v", "png", "-framerate", String(o.fps), "-i", "pipe:0"];
  return ["-y", "-hide_banner", "-loglevel", "error", ...input,
    // full-range sRGB RGB -> limited-range BT.709 YUV, explicit matrix
    "-vf", "scale=in_range=full:out_range=tv:in_color_matrix=bt709:out_color_matrix=bt709,format=yuv420p",
    "-c:v", "libx264", "-preset", o.preset ?? "medium", "-crf", String(o.crf ?? 16), "-profile:v", "high",
    "-g", gop, "-keyint_min", gop, "-sc_threshold", "0", "-flags", "+cgop", "-bf", "2",
    "-x264-params", `keyint=${gop}:min-keyint=${gop}:scenecut=0:open-gop=0`,
    ...bt709Args(), "-movflags", "+faststart", "-an", o.out];
}

export class FfmpegPipeEncoder {
  private readonly proc: ChildProcessByStdio<Writable, null, Readable>; private stderr = ""; private frames = 0; private readonly done: Promise<void>; private readonly frameBytes: number;
  constructor(private readonly o: PipeOptions) {
    mkdirSync(dirname(resolve(o.out)), { recursive: true });
    this.frameBytes = o.width * o.height * 4;
    this.proc = spawn(o.ffmpeg ?? "ffmpeg", buildEncodeArgs(o), { stdio: ["pipe", "ignore", "pipe"] });
    this.proc.stderr.on("data", d => { this.stderr += String(d); });
    this.proc.stdin.on("error", () => { /* surfaced through the exit code */ });
    this.done = new Promise<void>((res, rej) => { this.proc.on("error", rej); this.proc.on("close", c => (c === 0 ? res() : rej(new Error(`ffmpeg exit ${c}: ${this.stderr.trim()}`)))); });
  }
  get frameCount(): number { return this.frames; }
  /** Writes one frame with back-pressure (awaits 'drain'), so memory stays flat for 36,000+ frames. */
  async write(buf: Uint8Array): Promise<void> {
    if ((this.o.format ?? "rgba") === "rgba" && buf.byteLength !== this.frameBytes) throw new RangeError(`RGBA frame is ${buf.byteLength} bytes, expected ${this.frameBytes}`);
    this.frames++;
    if (!this.proc.stdin.write(buf)) await new Promise<void>(r => this.proc.stdin.once("drain", () => r()));
  }
  async finish(): Promise<void> { this.proc.stdin.end(); await this.done; }
}

const run = (bin: string, args: string[]): void => { const r = spawnSync(bin, args, { encoding: "utf8" }); if (r.status !== 0) throw new Error(`${bin} failed: ${(r.stderr || "").trim()}`); };

/** Concatenate encoded chunks losslessly (-c copy). Chunks share codec params + closed GOPs, so no re-encode. */
export function concatCopy(chunks: readonly string[], out: string, ffmpeg = "ffmpeg"): void {
  if (!chunks.length) throw new Error("concatCopy: no chunks");
  const list = `${out}.concat.txt`; mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(list, chunks.map(c => `file '${resolve(c).replace(/'/g, "'\\''")}'`).join("\n") + "\n");
  run(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", ...bt709Args(), "-movflags", "+faststart", out]);
}
/** Mux the single full-length audio track once (video stream copied, audio AAC). */
export function muxAudio(video: string, audio: string, out: string, ffmpeg = "ffmpeg"): void {
  if (!existsSync(audio)) throw new Error(`audio not found: ${audio}`);
  run(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-i", video, "-i", audio, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", out]);
}
export interface ProbeInfo { width: number; height: number; frames: number; fps: number; colorSpace: string; colorPrimaries: string; colorTransfer: string; pixFmt: string; gop: number[] }
export function probe(file: string): ProbeInfo {
  const r = spawnSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=width,height,nb_read_frames,r_frame_rate,color_space,color_primaries,color_transfer,pix_fmt", "-of", "json", file], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffprobe failed: ${r.stderr}`);
  const s = (JSON.parse(r.stdout) as { streams: Record<string, string>[] }).streams[0]; const [n, d] = s["r_frame_rate"].split("/").map(Number);
  const k = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "frame=pict_type,key_frame", "-of", "csv=p=0", file], { encoding: "utf8" });
  const gop: number[] = []; let i = 0; for (const line of k.stdout.trim().split("\n")) { if (line.startsWith("1")) gop.push(i); i++; }
  return { width: +s["width"], height: +s["height"], frames: +s["nb_read_frames"], fps: n / d, colorSpace: s["color_space"] ?? "", colorPrimaries: s["color_primaries"] ?? "", colorTransfer: s["color_transfer"] ?? "", pixFmt: s["pix_fmt"], gop };
}
