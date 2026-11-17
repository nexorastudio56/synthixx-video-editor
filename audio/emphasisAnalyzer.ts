/**
 * Offline audio emphasis & impact evaluator. FFmpeg normalises the voice-over to mono 24 kHz PCM, numpy/scipy (audio/emphasis_features.py) computes
 * normalised RMS + spectral flux per video frame, per-word peaks are blended with a lexical prior, and the result is a frame-indexed emphasisTrack.json in [0,1].
 * Word timestamps come from WhisperX when available (graph.voice.words), otherwise the Kokoro estimates; the analyzer only needs {w,start,end}.
 */
import { spawnSync } from "node:child_process";
import { resolvePython } from "../core/python.js";
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { assertFps } from "../core/determinism/timelineClock.js";

export const EmphasisWord = z.object({ i: z.number().int(), w: z.string(), start: z.number(), end: z.number(), startFrame: z.number().int(), endFrame: z.number().int(), peakEnergy: z.number(), rank: z.number(), prior: z.number(), score: z.number().min(0).max(1), impact: z.boolean() });
export const EmphasisTrack = z.object({
  version: z.literal("emphasis-1"), fps: z.number(), sampleRate: z.number(), durationFrames: z.number().int().positive(), threshold: z.number(), attackSec: z.number(), decaySec: z.number(), minGapSec: z.number(),
  values: z.array(z.number().min(0).max(1)), words: z.array(EmphasisWord), impacts: z.array(z.object({ frame: z.number().int().nonnegative(), wordIndex: z.number().int(), score: z.number().min(0).max(1) })), sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type EmphasisTrack = z.infer<typeof EmphasisTrack>;
export interface AnalyzeOptions { readonly wavPath: string; readonly words: readonly { w: string; start: number; end: number }[]; readonly fps: 30 | 60; readonly outPath: string; readonly workDir?: string }

export function analyzeEmphasis(o: AnalyzeOptions): EmphasisTrack {
  assertFps(o.fps); const work = resolve(o.workDir ?? join(dirname(resolve(o.outPath)), ".emphasis_work")); mkdirSync(work, { recursive: true }); mkdirSync(dirname(resolve(o.outPath)), { recursive: true });
  const mono = join(work, "voice_mono24k.wav"), wj = join(work, "words.json");
  const ff = spawnSync("ffmpeg", ["-y", "-v", "error", "-i", resolve(o.wavPath), "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le", mono], { encoding: "utf8" });
  if (ff.status !== 0) throw new Error(`ffmpeg audio normalisation failed: ${ff.stderr}`);
  writeFileSync(wj, JSON.stringify(o.words.map(w => ({ w: w.w, start: w.start, end: w.end }))));
  const py = spawnSync(resolvePython(), ["-I", join(import.meta.dirname, "emphasis_features.py"), mono, wj, String(o.fps), resolve(o.outPath)], { encoding: "utf8", maxBuffer: 1 << 26 });
  if (py.status !== 0) throw new Error(`emphasis analysis failed: ${py.stderr.slice(-500)}`);
  const track = EmphasisTrack.parse(JSON.parse(readFileSync(o.outPath, "utf8"))); rmSync(work, { recursive: true, force: true }); return track;
}
export const loadEmphasisTrack = (path: string): EmphasisTrack => EmphasisTrack.parse(JSON.parse(readFileSync(path, "utf8")));
/** Emphasis value at an integer frame (clamped to the track). */
export const emphasisAt = (t: Pick<EmphasisTrack, "values">, frame: number): number => t.values[Math.min(Math.max(0, frame), t.values.length - 1)];
