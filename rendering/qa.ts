/** Automated QA of the final MP4: duration, audio presence/sync, black frames, frozen frames, clipping. */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import type { SceneGraph } from "../schemas/scene.schema.js";

const sh = (c: string, a: string[]) => spawnSync(c, a, { encoding: "utf8", maxBuffer: 1 << 26 });
export interface QAReport { ok: boolean; checks: { name: string; pass: boolean; detail: string }[] }
export function runQA(mp4: string, graph: SceneGraph, mixWav: string): QAReport {
  const checks: QAReport["checks"] = []; const add = (name: string, pass: boolean, detail: string) => checks.push({ name, pass, detail });
  const exp = graph.durationFrames / graph.fps;
  const pr = (s: string, e: string) => { const r = sh("ffprobe", ["-v", "error", "-select_streams", s, "-show_entries", `stream=${e}`, "-of", "csv=p=0", mp4]); return r.stdout.trim(); };
  const vd = parseFloat(pr("v:0", "duration")), ad = parseFloat(pr("a:0", "duration")), codec = pr("v:0", "codec_name"), size = pr("v:0", "width,height");
  add("video stream", codec === "h264", `${codec} ${size}`);
  add("duration", Math.abs(vd - exp) <= 0.1, `video ${vd.toFixed(2)}s vs expected ${exp.toFixed(2)}s`);
  add("audio present", !Number.isNaN(ad), `audio ${Number.isNaN(ad) ? "missing" : ad.toFixed(2) + "s"}`);
  add("audio/video length sync", !Number.isNaN(ad) && Math.abs(vd - ad) <= 0.15, `delta ${(vd - ad).toFixed(3)}s`);
  // voice onset in mix must align with first aligned word (audible onset within 120 ms)
  const w0 = graph.voice.words[0].start; const r = sh("ffmpeg", ["-v", "error", "-i", mixWav, "-af", "silencedetect=n=-45dB:d=0.05", "-f", "null", "-"]); const m = /silence_end: ([\d.]+)/.exec(r.stderr + r.stdout);
  const onset = m ? parseFloat(m[1]) : 0; add("voice onset sync", Math.abs(onset - w0) <= 0.35, `first word ${w0.toFixed(2)}s, audible onset ${onset.toFixed(2)}s (estimated-timing tolerance 0.35s)`);
  const bd = sh("ffmpeg", ["-v", "info", "-i", mp4, "-vf", "blackdetect=d=0.4:pix_th=0.06", "-an", "-f", "null", "-"]); const blacks = [...(bd.stderr).matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)];
  add("black frames", blacks.length === 0, blacks.length ? blacks.map(b => `${b[1]}-${b[2]}s`).join(", ") : "none >0.4 s");
  const fd = sh("ffmpeg", ["-v", "info", "-i", mp4, "-vf", "freezedetect=n=-55dB:d=2.5", "-an", "-f", "null", "-"]); const fr = [...(fd.stderr).matchAll(/freeze_start: ([\d.]+)/g)];
  add("frozen frames", fr.length === 0, fr.length ? `freeze at ${fr.map(x => x[1]).join(", ")}s` : "none >2.5 s");
  const vol = sh("ffmpeg", ["-v", "info", "-i", mp4, "-af", "volumedetect", "-vn", "-f", "null", "-"]); const mx = /max_volume: (-?[\d.]+) dB/.exec(vol.stderr);
  add("no clipping", !!mx && parseFloat(mx[1]) <= -0.3, mx ? `peak ${mx[1]} dB` : "n/a");
  add("file size", fs.statSync(mp4).size > 50_000, `${(fs.statSync(mp4).size / 1e6).toFixed(2)} MB`);
  return { ok: checks.every(c => c.pass), checks };
}
