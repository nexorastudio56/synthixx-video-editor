/**
 * Dynamic pacing & cognitive-breather planner.
 *  1. Motion personalities set the scene length range: viral-fast 0.8-2.0 s micro-beats, explainer-medium 2.5-5.0 s, luxury-slow 4.5-8.0 s holds.
 *  2. Breather rule: after every 15-20 s of dense UI/3D motion a 1.5-2.0 s Minimal Statement Breather scene is carved out of the narration (word-aligned, no timeline shift).
 *  3. GPU-hero budget: <= 30% of the timeline (by duration AND by scene count), never two GPU-hero scenes back to back.
 * Every boundary sits in a gap between two words, so a cut can never land inside a spoken word. Pure + deterministic (no clock, no RNG).
 */
import type { Word } from "../schemas/scene.schema.js";
import type { Clause } from "./narrative.js";
import { extractClauses } from "./narrative.js";
import type { ResolvedEntity } from "./entityResolver.js";

export type Personality = "viral-fast" | "explainer-medium" | "luxury-slow";
export interface Range { readonly min: number; readonly max: number; readonly target: number }
export const PERSONALITY_RANGE: Readonly<Record<Personality, Range>> = { "viral-fast": { min: 0.8, max: 2.0, target: 1.4 }, "explainer-medium": { min: 2.5, max: 5.0, target: 3.75 }, "luxury-slow": { min: 4.5, max: 8.0, target: 6.0 } };
export const BREATHER_KEY = "__breather__";
export interface PacingOptions {
  readonly personality: Personality; readonly fps: 24 | 30 | 60; readonly breather?: boolean; readonly breatherAfterSec?: { readonly min: number; readonly max: number }; readonly breatherSec?: { readonly min: number; readonly max: number };
  readonly gpuBudget?: number; readonly tailGuardSec?: number; readonly durationFrames?: number; readonly leadSec?: number;
}
export interface PlannedScene {
  readonly index: number; readonly kind: "content" | "breather"; readonly wordStart: number; readonly wordEnd: number; readonly startFrame: number; readonly endFrame: number;
  readonly startSec: number; readonly endSec: number; readonly hero3d: boolean; readonly score3d: number; readonly text: string; readonly relaxed: boolean;
}
export interface PacingStats {
  readonly scenes: number; readonly contentScenes: number; readonly breathers: number; readonly gpuScenes: number; readonly gpuRatioByTime: number; readonly gpuRatioByCount: number;
  readonly maxDenseStretchSec: number; readonly minSceneSec: number; readonly maxSceneSec: number; readonly relaxedScenes: number; readonly breatherLengthsSec: readonly number[];
}
export interface PacingPlan { readonly personality: Personality; readonly fps: number; readonly durationFrames: number; readonly scenes: readonly PlannedScene[]; readonly cutFrames: readonly number[]; readonly stats: PacingStats }

const CONJ = /^(and|but|then|so|next|first|finally|because|while|when|now|also)$/i;
/** Cost of cutting BEFORE word i (lower = more natural). */
function boundaryCost(words: readonly Word[], i: number): number {
  if (i <= 0 || i >= words.length) return 0;
  const prev = words[i - 1].w, gap = Math.max(0, words[i].start - words[i - 1].end);
  const pause = Math.min(gap / 0.3, 1);
  if (/[.!?]$/.test(prev)) return 0 - 0.15 * pause;
  if (/[,;:—–-]$/.test(prev)) return 0.25 - 0.1 * pause;
  return 1 - 0.4 * pause + (CONJ.test(words[i].w.replace(/[^\w]/g, "")) ? -0.35 : 0);
}
/** Boundary frame before word i: cut shortly before the next word, but never before the previous word has finished (half-frame tolerance). */
export function boundaryFrame(words: readonly Word[], i: number, fps: number, lead: number, total: number): number {
  if (i <= 0) return 0; if (i >= words.length) return total;
  const e = words[i - 1].end, s = words[i].start; const t = Math.min(s, Math.max(e, s - lead)); let f = Math.round(t * fps);
  if (f / fps < e - 0.5 / fps) f = Math.ceil(e * fps - 0.5); if (f / fps > s + 0.5 / fps) f = Math.floor(s * fps + 0.5); return f;
}

function segment(words: readonly Word[], T: (i: number) => number, a0: number, b0: number, r: Range): { cuts: number[]; relaxed: boolean } {
  // partition word positions [a0,b0) into segments, cut positions returned as start indices (excluding a0)
  const total = T(b0) - T(a0); if (total <= r.max * 1.0001 && total >= 0) return { cuts: [], relaxed: total < r.min };
  for (const [lo, hi, relaxed] of [[1, 1, false], [0.85, 1.15, true], [0.7, 1.3, true], [0.5, 1.6, true]] as const) {
    const min = r.min * lo, max = r.max * hi; const n = b0 - a0; const best = new Array<number>(n + 1).fill(Infinity), from = new Array<number>(n + 1).fill(-1); best[0] = 0;
    for (let i = 1; i <= n; i++) for (let j = i - 1; j >= 0; j--) {
      const d = T(a0 + i) - T(a0 + j); if (d > max) break; if (d < min && i !== n) continue; if (d < min * 0.5) continue; if (!Number.isFinite(best[j])) continue;
      const c = best[j] + 0.6 * Math.abs(d - r.target) / r.target + (i === n ? 0 : boundaryCost(words, a0 + i)) + (d < min ? 2 : 0);
      if (c < best[i]) { best[i] = c; from[i] = j; }
    }
    if (Number.isFinite(best[n])) { const cuts: number[] = []; for (let i = n; i > 0; i = from[i]) if (from[i] > 0) cuts.push(a0 + from[i]); return { cuts: cuts.reverse(), relaxed }; }
  }
  return { cuts: [], relaxed: true };
}

const SCORE3D: RegExp[] = [/\b(global|world|worldwide|network|ecosystem|platform|unified|everything|orbit|3d)\b/i, /\b(connect\w*|integrat\w*|tools?|apps?)\b/i, /\b(cards?|screens?|features?|dashboard|results?|reports?)\b/i, /\b(future|next level|transform\w*)\b/i];
export function score3d(text: string, first: boolean, last: boolean): number {
  let s = 0; for (const re of SCORE3D) if (re.test(text)) s++; if (/\d/.test(text)) s += 0.5; if (first) s += 0.5; if (last) s += 0.25; return s;
}

export function planPacing(words: readonly Word[], o: PacingOptions): PacingPlan {
  if (!words.length) throw new Error("planPacing: no words"); const fps = o.fps, r = PERSONALITY_RANGE[o.personality], lead = o.leadSec ?? 0.12;
  const lastEnd = Math.max(...words.map(w => w.end)); const total = o.durationFrames ?? Math.ceil(lastEnd * fps) + 6; const n = words.length;
  const BF = Array.from({ length: n + 1 }, (_, i) => boundaryFrame(words, i, fps, lead, total)); const T = (i: number): number => BF[i] / fps;
  // ---- breather spans (word-aligned, carved out of the narration) ----
  const after = o.breatherAfterSec ?? { min: 15, max: 20 }, blen = o.breatherSec ?? { min: 1.5, max: 2.0 }, guard = o.tailGuardSec ?? 3; const spans: { a: number; b: number; relaxed: boolean }[] = [];
  if (o.breather !== false) {
    let cursor = 0; // index of first word after the last breather
    for (;;) {
      const t0 = T(cursor); let pick = -1, pc = Infinity;
      for (let i = cursor + 1; i < n; i++) { const d = T(i) - t0; if (d < after.min) continue; if (d > after.max) break; const c = boundaryCost(words, i) + 0.05 * Math.abs(d - (after.min + after.max) / 2); if (c < pc) { pc = c; pick = i; } }
      if (pick < 0) break; let end = -1, ec = Infinity, relaxed = false;
      for (const [lo, hi, rel] of [[blen.min, blen.max, false], [blen.min - 0.25, blen.max + 0.35, true]] as const) {
        for (let k = pick + 1; k <= n; k++) { const d = T(k) - T(pick); if (d < lo) continue; if (d > hi) break; const c = (k === n ? 0 : boundaryCost(words, k)) + 0.2 * Math.abs(d - (blen.min + blen.max) / 2); if (c < ec) { ec = c; end = k; relaxed = rel; } }
        if (end >= 0) break;
      }
      if (end < 0 || T(n) - T(end) < guard) break; spans.push({ a: pick, b: end, relaxed }); cursor = end;
    }
  }
  // ---- content segmentation per gap between breathers ----
  type Raw = { a: number; b: number; kind: "content" | "breather"; relaxed: boolean }; const raw: Raw[] = []; let at = 0;
  const fill = (a: number, b: number): void => { if (b <= a) return; const { cuts, relaxed } = segment(words, T, a, b, r); const edges = [a, ...cuts, b]; for (let k = 0; k < edges.length - 1; k++) raw.push({ a: edges[k], b: edges[k + 1], kind: "content", relaxed }); };
  for (const s of spans) { fill(at, s.a); raw.push({ a: s.a, b: s.b, kind: "breather", relaxed: s.relaxed }); at = s.b; } fill(at, n);
  // ---- GPU-hero budget ----
  const textOf = (a: number, b: number): string => words.slice(a, b).map(w => w.w).join(" ");
  const sc = raw.map((x, i) => ({ frames: BF[x.b] - BF[x.a], s: x.kind === "content" ? score3d(textOf(x.a, x.b), i === 0, i === raw.length - 1) : -1 }));
  const budget = o.gpuBudget ?? 0.3, maxFrames = Math.floor(budget * total), maxCount = Math.floor(budget * raw.length); const gpu = new Set<number>(); let gf = 0;
  [...sc.keys()].filter(i => sc[i].s > 0).sort((a, b) => sc[b].s - sc[a].s || a - b).forEach(i => {
    if (gpu.size + 1 > maxCount || gf + sc[i].frames > maxFrames || gpu.has(i - 1) || gpu.has(i + 1)) return; gpu.add(i); gf += sc[i].frames;
  });
  const scenes: PlannedScene[] = raw.map((x, i) => ({ index: i, kind: x.kind, wordStart: x.a, wordEnd: x.b - 1, startFrame: BF[x.a], endFrame: BF[x.b], startSec: BF[x.a] / fps, endSec: BF[x.b] / fps, hero3d: gpu.has(i), score3d: Math.max(0, sc[i].s), text: textOf(x.a, x.b), relaxed: x.relaxed }));
  return { personality: o.personality, fps, durationFrames: total, scenes, cutFrames: scenes.map(s => s.startFrame), stats: statsOf(scenes, total, fps) };
}

export function statsOf(scenes: readonly PlannedScene[], total: number, fps: number): PacingStats {
  const dur = (s: PlannedScene): number => s.endFrame - s.startFrame; const gpuF = scenes.filter(s => s.hero3d).reduce((a, s) => a + dur(s), 0);
  let run = 0, maxRun = 0; for (const s of scenes) { if (s.kind === "breather") run = 0; else { run += dur(s); maxRun = Math.max(maxRun, run); } }
  const secs = scenes.map(s => s.endSec - s.startSec);
  return { scenes: scenes.length, contentScenes: scenes.filter(s => s.kind === "content").length, breathers: scenes.filter(s => s.kind === "breather").length, gpuScenes: scenes.filter(s => s.hero3d).length,
    gpuRatioByTime: gpuF / total, gpuRatioByCount: scenes.filter(s => s.hero3d).length / scenes.length, maxDenseStretchSec: maxRun / fps,
    minSceneSec: Math.min(...secs), maxSceneSec: Math.max(...secs), relaxedScenes: scenes.filter(s => s.relaxed).length, breatherLengthsSec: scenes.filter(s => s.kind === "breather").map(s => s.endSec - s.startSec) };
}
/** Cuts that land strictly inside a spoken word (half-frame tolerance). Must be empty. */
export function midWordCuts(plan: Pick<PacingPlan, "cutFrames" | "fps">, words: readonly Word[]): { frame: number; word: string }[] {
  const tol = 0.5 / plan.fps, out: { frame: number; word: string }[] = [];
  for (const f of plan.cutFrames.slice(1)) { const t = f / plan.fps; const w = words.find(x => t > x.start + tol && t < x.end - tol); if (w) out.push({ frame: f, word: w.w }); } return out;
}

/** Plan -> choreographer groups. Content scenes are re-clausified from their own words; a breather becomes one synthetic clause keyed BREATHER_KEY. */
export function planToGroups(plan: PacingPlan, words: readonly Word[], resolved: ResolvedEntity[]): Clause[][] {
  return plan.scenes.map(s => {
    if (s.kind === "breather") { const ws = words.slice(s.wordStart, s.wordEnd + 1); return [{ idx: 0, wordStart: s.wordStart, wordEnd: s.wordEnd, text: ws.map(w => w.w).join(" "), startSec: ws[0].start, endSec: ws[ws.length - 1].end, role: "explain", triplet: { subject: "", verb: "show", object: "" }, numbers: [], brands: [], cues: [], split: false, key: BREATHER_KEY } as Clause]; }
    const sub = extractClauses(words.slice(s.wordStart, s.wordEnd + 1) as Word[], resolved);
    return sub.map(c => ({ ...c, wordStart: c.wordStart + s.wordStart, wordEnd: c.wordEnd + s.wordStart }));
  });
}
