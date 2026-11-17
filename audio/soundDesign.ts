/** Procedural sound design: UI SFX synthesised from maths (seeded, deterministic), ambient pad, voice-keyed ducking, final mix. */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { SceneGraph } from "../schemas/scene.schema.js";
import { mulberry32 } from "../visual/types.js";

export const SR = 44100;
const TAU = Math.PI * 2;
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const env = (t: number, a: number, d: number) => (t < a ? t / a : Math.exp(-(t - a) / d));

type Synth = (rnd: () => number) => Float32Array;
const buf = (sec: number) => new Float32Array(Math.round(sec * SR));
/** one-pole low-pass sweep helper */
function lp(x: Float32Array, cutoff: (i: number) => number): Float32Array { const y = new Float32Array(x.length); let s = 0; for (let i = 0; i < x.length; i++) { const a = 1 - Math.exp(-TAU * cutoff(i) / SR); s += a * (x[i] - s); y[i] = s; } return y; }
const tick = (rnd: () => number, f: number, len = 0.045, decay = 0.009) => { const o = buf(len); for (let i = 0; i < o.length; i++) { const t = i / SR; o[i] = (Math.sin(TAU * f * t) * 0.7 + (rnd() * 2 - 1) * 0.5) * env(t, 0.0006, decay); } return o; };

export const SYNTH: Record<string, Synth> = {
  click: r => tick(r, 1800, 0.06, 0.012),
  tick: r => tick(r, 2600, 0.035, 0.006),
  pop: r => { const o = buf(0.12); for (let i = 0; i < o.length; i++) { const t = i / SR; o[i] = Math.sin(TAU * (520 + 900 * Math.exp(-t * 40)) * t) * env(t, 0.002, 0.03); } return o; },
  switch: r => { const a = tick(r, 1400, 0.05, 0.01), b = tick(r, 900, 0.07, 0.016); const o = buf(0.2); a.forEach((v, i) => (o[i] += v)); b.forEach((v, i) => (o[i + Math.round(0.09 * SR)] += v)); return o; },
  type: r => { const o = buf(0.42); for (let k = 0; k < 7; k++) { const t0 = Math.round((k * 0.055 + r() * 0.02) * SR); tick(r, 1500 + r() * 900, 0.03, 0.005).forEach((v, i) => { if (t0 + i < o.length) o[t0 + i] += v * 0.7; }); } return o; },
  whoosh: r => { const n = buf(0.55); for (let i = 0; i < n.length; i++) n[i] = r() * 2 - 1; const y = lp(n, i => 300 + 5200 * Math.sin(Math.PI * Math.min(1, i / n.length))); for (let i = 0; i < y.length; i++) { const t = i / SR; y[i] *= Math.sin(Math.PI * Math.min(1, t / 0.55)) ** 1.5 * 1.8; } return y; },
  swoosh_up: r => { const n = buf(0.5); for (let i = 0; i < n.length; i++) n[i] = r() * 2 - 1; const y = lp(n, i => 400 + 7000 * (i / n.length) ** 2); for (let i = 0; i < y.length; i++) y[i] *= (i / y.length) * (1 - i / y.length) * 4.5; return y; },
  riser: r => { const o = buf(1.2); for (let i = 0; i < o.length; i++) { const t = i / SR, p = t / 1.2; o[i] = (Math.sin(TAU * (180 + 1500 * p * p) * t) * 0.4 + (r() * 2 - 1) * 0.3 * p) * p * p; } return o; },
  impact: r => { const o = buf(0.7); for (let i = 0; i < o.length; i++) { const t = i / SR; o[i] = (Math.sin(TAU * (55 + 80 * Math.exp(-t * 30)) * t) * 1.1 + (r() * 2 - 1) * 0.35 * Math.exp(-t * 35)) * env(t, 0.003, 0.16); } return o; },
  notify: r => { const o = buf(0.9); for (let i = 0; i < o.length; i++) { const t = i / SR; const a = Math.sin(TAU * 988 * t) * env(t, 0.003, 0.18); const b = t > 0.11 ? Math.sin(TAU * 1480 * (t - 0.11)) * env(t - 0.11, 0.003, 0.25) : 0; o[i] = (a * 0.6 + b * 0.5 + Math.sin(TAU * 1976 * t) * 0.12 * env(t, 0.002, 0.08)); } return o; },
};

function readWav(p: string): Float32Array {
  const tmp = p + ".44k.wav"; const r = spawnSync("ffmpeg", ["-y", "-v", "error", "-i", p, "-ac", "1", "-ar", String(SR), "-c:a", "pcm_s16le", tmp]); if (r.status !== 0) throw new Error("ffmpeg resample failed: " + r.stderr);
  const b = fs.readFileSync(tmp); fs.unlinkSync(tmp); let off = 12; while (off < b.length - 8) { const id = b.toString("ascii", off, off + 4), sz = b.readUInt32LE(off + 4); if (id === "data") { const n = Math.floor(sz / 2), o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = b.readInt16LE(off + 8 + i * 2) / 32768; return o; } off += 8 + sz + (sz & 1); }
  throw new Error("no data chunk");
}
export function writeWav(p: string, x: Float32Array, rate = SR) {
  const n = x.length, b = Buffer.alloc(44 + n * 2); b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), 44 + i * 2); fs.writeFileSync(p, b);
}

/** Soft ambient pad: Am - F - C - G, 4 s each, detuned sines + slow swell. Deterministic. */
export function ambientPad(sec: number): Float32Array {
  const o = buf(sec); const prog = [[220, 261.63, 329.63], [174.61, 220, 261.63], [130.81, 196, 261.63], [196, 246.94, 293.66]]; const seg = 4;
  for (let i = 0; i < o.length; i++) { const t = i / SR, k = Math.floor(t / seg) % 4, u = (t % seg) / seg; const swell = Math.sin(Math.PI * Math.min(1, u * 1.0)) ** 0.6; let v = 0;
    for (const f of prog[k]) v += Math.sin(TAU * f * t) + 0.6 * Math.sin(TAU * (f * 1.004) * t) + 0.25 * Math.sin(TAU * f * 2 * t);
    o[i] = (v / 9) * (0.55 + 0.45 * swell) * Math.min(1, t / 1.5) * Math.min(1, (sec - t) / 2); }
  return lp(o, () => 1400);
}

/** Speech-activity envelope -> music gain. attack/release smoothing; merged word gaps < 0.25 s. */
export function duckEnvelope(words: { start: number; end: number }[], n: number, depth = 0.3) {
  const target = new Float32Array(n).fill(1); let active = 0;
  const iv: [number, number][] = []; for (const w of words) { const l = iv[iv.length - 1]; if (l && w.start - l[1] < 0.25) l[1] = Math.max(l[1], w.end); else iv.push([w.start, w.end]); }
  for (const [a, b] of iv) { const s = Math.max(0, Math.round(a * SR)), e = Math.min(n, Math.round(b * SR)); target.fill(depth, s, e); active += e - s; }
  const out = new Float32Array(n); let g = 1; const aA = 1 - Math.exp(-1 / (0.08 * SR)), aR = 1 - Math.exp(-1 / (0.35 * SR));
  for (let i = 0; i < n; i++) { g += (target[i] < g ? aA : aR) * (target[i] - g); out[i] = g; }
  return { env: out, duckedPct: +(100 * active / n).toFixed(1) };
}

export interface MixReport { path: string; sec: number; sfx: number; peak: number; rmsDb: number; duckedPct: number; duckMin: number }
export function mixAudio(graph: SceneGraph, voiceWav: string, outPath: string, o: { music?: boolean; musicGain?: number; sfxGain?: number } = {}): MixReport {
  const voice = readWav(voiceWav); const n = Math.max(voice.length, Math.round(graph.durationFrames / graph.fps * SR)); const mix = new Float32Array(n);
  for (let i = 0; i < voice.length; i++) mix[i] += voice[i];
  const { env: duck, duckedPct } = duckEnvelope(graph.voice.words, n);
  if (o.music !== false) { const pad = ambientPad(n / SR); const mg = o.musicGain ?? 0.2; for (let i = 0; i < n; i++) mix[i] += pad[i] * mg * duck[i]; }
  let sfx = 0; const sg = o.sfxGain ?? 1;
  for (const s of graph.scenes) for (const ev of s.audioEvents) { const f = SYNTH[ev.sfx]; if (!f) continue; const x = f(mulberry32(hash(ev.id + ev.sfx))); const t0 = Math.round(ev.frame / graph.fps * SR); const g = ev.gain * 0.55 * sg; for (let i = 0; i < x.length && t0 + i < n; i++) mix[t0 + i] += x[i] * g; sfx++; }
  let peak = 0; for (let i = 0; i < n; i++) { mix[i] = Math.tanh(mix[i] * 0.95); peak = Math.max(peak, Math.abs(mix[i])); } // soft limiter
  const norm = peak > 0 ? 0.89 / peak : 1; let ss = 0; for (let i = 0; i < n; i++) { mix[i] *= norm; ss += mix[i] * mix[i]; }
  fs.mkdirSync(path.dirname(outPath), { recursive: true }); writeWav(outPath, mix);
  return { path: outPath, sec: +(n / SR).toFixed(2), sfx, peak: +(peak * norm).toFixed(3), rmsDb: +(10 * Math.log10(ss / n + 1e-12)).toFixed(1), duckedPct, duckMin: +Math.min(...duck.subarray(0, n).filter((_, i) => i % 441 === 0)).toFixed(2) };
}
