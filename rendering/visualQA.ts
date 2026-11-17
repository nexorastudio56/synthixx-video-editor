/**
 * Commercial visual QA, two tiers, run on the storyboard (stills) BEFORE any full render.
 *  Tier 1 (hard, deterministic): safe-zone, L2 overlap, clipping, fonts/assets/hashes, NaN transforms, partition, audio/video <=1 frame.
 *  Tier 2 (sampled pixels): start/mid/end frame contrast; failing frames emit targeted LayoutRepair patches
 *  (move | resize | shorten-copy | add-scrim) -> re-validate -> max 2 retries -> rollback to the best-known graph.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { z } from "zod";
import { CANVAS, type SceneGraph, type VideoScene, type EntityKind } from "../schemas/scene.schema.js";
import { validateScene } from "../core/compiler/validateScene.js";
import { stageFor } from "../visual/layout.js";
import { assertPartition } from "../core/determinism/timelineClock.js";
import { StoryboardSession, keyFrames, contactSheet, type FrameProbe, type FrameKind, type TextBox } from "./storyboard.js";

export const LayoutRepair = z.discriminatedUnion("op", [
  z.object({ op: z.literal("move"), sceneId: z.string(), entityId: z.string(), dx: z.number().min(-0.5).max(0.5), dy: z.number().min(-0.5).max(0.5) }),     // fractions of the stage
  z.object({ op: z.literal("resize"), sceneId: z.string(), entityId: z.string(), scale: z.number().min(0.5).max(1) }),                                  // about the entity centre
  z.object({ op: z.literal("shorten-copy"), sceneId: z.string(), entityId: z.string(), maxWords: z.number().int().min(1).max(40) }),
  z.object({ op: z.literal("add-scrim"), sceneId: z.string(), entityId: z.string(), opacity: z.number().min(0.2).max(0.95) }),
]);
export type LayoutRepair = z.infer<typeof LayoutRepair>;

export type IssueCode = "safe-zone" | "overlap" | "clip" | "nan-transform" | "missing-asset" | "missing-font" | "asset-hash" | "av-duration" | "partition" | "contrast" | "off-canvas";
export interface QAIssue { readonly tier: 1 | 2; readonly code: IssueCode; readonly sceneId?: string; readonly entityId?: string | null; readonly frame?: number; readonly detail: string }
export interface SceneQA { sceneId: string; issues: QAIssue[]; repairs: LayoutRepair[]; attempts: number; rolledBack: boolean; passed: boolean; frames: number[] }
export interface QAReport { passed: boolean; graph: SceneGraph; scenes: SceneQA[]; global: QAIssue[]; sheet: string; sampledFrames: number; ms: number; safeBox: SafeBox }

const L2_KINDS: ReadonlySet<EntityKind> = new Set<EntityKind>(["kinetic_words", "text"]);
export interface SafeBox { x0: number; y0: number; x1: number; y1: number }
const DEFAULT_LAYOUT = { safeMarginX: 0.067, safeMarginTop: 0.14, safeMarginBottom: 0.2 };
/** Safe margins are fractions of the canvas. 9:16 uses them as-is (feed-UI bands). 16:9 has no overlay band: vertical margins x0.5 / x0.3. */
export function safeBoxFor(g: SceneGraph): SafeBox {
  const { width: W, height: H } = CANVAS[g.aspectRatio]; const l = g.theme?.layout ?? DEFAULT_LAYOUT, p = g.aspectRatio === "9:16";
  return { x0: l.safeMarginX * W, x1: W - l.safeMarginX * W, y0: l.safeMarginTop * H * (p ? 1 : 0.5), y1: H - l.safeMarginBottom * H * (p ? 1 : 0.3) };
}
const TOL = 3; // px: float/parallax micro-motion (<=6px amplitude on heroes, none on L2)

/** ---------- Tier 1 geometry on one probe ---------- */
export function geometryIssues(p: FrameProbe, kindOf: ReadonlyMap<string, EntityKind>, box: SafeBox): QAIssue[] {
  const out: QAIssue[] = []; const base = { tier: 1 as const, sceneId: p.sceneId, frame: p.frame };
  const l2 = p.boxes.filter(b => b.entityId && L2_KINDS.has(kindOf.get(b.entityId)!));
  for (const b of p.boxes) {
    if (b.x < -TOL || b.y < -TOL || b.x + b.w > p.W + TOL || b.y + b.h > p.H + TOL) out.push({ ...base, code: "off-canvas", entityId: b.entityId, detail: `"${b.text}" leaves the canvas` });
    if (b.clipped) out.push({ ...base, code: "clip", entityId: b.entityId, detail: `"${b.text}" is clipped by an overflow ancestor` });
  }
  for (const b of l2) if (b.x < box.x0 - TOL || b.y < box.y0 - TOL || b.x + b.w > box.x1 + TOL || b.y + b.h > box.y1 + TOL) out.push({ ...base, code: "safe-zone", entityId: b.entityId, detail: `"${b.text}" [${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.x + b.w)},${Math.round(b.y + b.h)}] outside safe [${Math.round(box.x0)},${Math.round(box.y0)},${Math.round(box.x1)},${Math.round(box.y1)}]` });
  for (let i = 0; i < l2.length; i++) for (let j = i + 1; j < l2.length; j++) {
    const a = l2[i]!, b = l2[j]!; const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (ix > 2 && iy > 2 && (ix * iy) / Math.min(a.w * a.h, b.w * b.h) > 0.12) out.push({ ...base, code: "overlap", entityId: b.entityId, detail: `"${a.text}" overlaps "${b.text}" (${Math.round(ix)}x${Math.round(iy)}px)${a.entityId === b.entityId ? " [same-entity]" : ""}` });
  }
  // L2 copy colliding with another entity's text (UI panels, labels): the other entity is the obstacle, the headline is repaired
  const others = p.boxes.filter(b => b.entityId && !L2_KINDS.has(kindOf.get(b.entityId)!));
  for (const a of l2) for (const b of others) {
    if (a.entityId === b.entityId) continue; const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (ix > 2 && iy > 2 && (ix * iy) / Math.min(a.w * a.h, b.w * b.h) > 0.12) out.push({ ...base, code: "overlap", entityId: a.entityId, detail: `"${a.text}" overlaps "${b.text}" (${Math.round(ix)}x${Math.round(iy)}px) [other-entity]` });
  }
  for (const n of p.nan) out.push({ ...base, code: "nan-transform", detail: `non-finite transform: ${n}` });
  if (!p.fontOk) out.push({ ...base, code: "missing-font", detail: "InterX 800 not loaded" });
  for (const s of p.brokenImages) out.push({ ...base, code: "missing-asset", detail: `image failed to load: ${s}` });
  return out;
}
export function contrastIssues(p: FrameProbe, kindOf: ReadonlyMap<string, EntityKind>): QAIssue[] {
  return p.contrast.filter(c => c.entityId && L2_KINDS.has(kindOf.get(c.entityId)!) && c.ratio < c.required).map(c => ({ tier: 2 as const, code: "contrast" as const, sceneId: p.sceneId, frame: p.frame, entityId: c.entityId, detail: `"${c.text}" contrast ${c.ratio}:1 < ${c.required}:1` }));
}

/** Records missing asset hashes from the files themselves (the director leaves some blank); returns a new graph. */
export function ensureAssetHashes(g: SceneGraph, projectRoot: string): SceneGraph {
  const n = structuredClone(g); for (const a of n.assets) { const f = path.resolve(projectRoot, a.path); if (!a.sha256 && fs.existsSync(f)) a.sha256 = crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex"); } return n;
}
/** ---------- Tier 1 static (no browser) ---------- */
const sha256 = (f: string): string => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
export function probeDurationSec(file: string): number { const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }); const v = parseFloat(r.stdout.trim()); if (!Number.isFinite(v)) throw new Error("ffprobe failed for " + file); return v; }
/** Trim/pad the mix to EXACTLY durationFrames/fps so video and audio lengths agree (director pads the video by a few frames). */
export function conformAudio(wav: string, frames: number, fps: number, out: string): string {
  const r = spawnSync("ffmpeg", ["-y", "-v", "error", "-i", wav, "-af", `apad=whole_len=${Math.round((frames / fps) * 48000)}`, "-ar", "48000", "-t", (frames / fps).toFixed(6), out], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("conformAudio failed: " + r.stderr); return out;
}
export function staticIssues(g: SceneGraph, o: { projectRoot: string; projectDir: string; audioPath?: string }): QAIssue[] {
  const out: QAIssue[] = [];
  try { assertPartition(g.scenes.map(s => ({ startFrame: s.startFrame, endFrame: s.endFrame })), g.durationFrames); } catch (e) { out.push({ tier: 1, code: "partition", detail: String((e as Error).message) }); }
  for (const f of ["assets/fonts/inter800.otf", "assets/fonts/inter700.otf"]) if (!fs.existsSync(path.join(o.projectDir, f))) out.push({ tier: 1, code: "missing-font", detail: `${f} not found` });
  for (const a of g.assets) {
    const src = path.resolve(o.projectRoot, a.path);
    if (!fs.existsSync(src)) { out.push({ tier: 1, code: "missing-asset", detail: `${a.id}: ${a.path} not found` }); continue; }
    if (!a.verified) out.push({ tier: 1, code: "missing-asset", detail: `${a.id}: not verified by entityResolver` });
    if (!a.sha256) out.push({ tier: 1, code: "asset-hash", detail: `${a.id}: no sha256 recorded` });
    else if (sha256(src) !== a.sha256) out.push({ tier: 1, code: "asset-hash", detail: `${a.id}: sha256 mismatch` });
  }
  if (g.theme?.logo?.sha256) { const lp = path.resolve(o.projectRoot, g.theme.logo.path); if (!fs.existsSync(lp)) out.push({ tier: 1, code: "missing-asset", detail: "theme logo missing" }); else if (sha256(lp) !== g.theme.logo.sha256) out.push({ tier: 1, code: "asset-hash", detail: "theme logo sha256 mismatch" }); }
  if (o.audioPath) { const af = Math.round(probeDurationSec(o.audioPath) * g.fps); if (Math.abs(af - g.durationFrames) > 1) out.push({ tier: 1, code: "av-duration", detail: `audio ${af}f vs video ${g.durationFrames}f (> 1 frame)` }); }
  return out;
}

/** ---------- LayoutRepair planning + application ---------- */
const COPY_KEYS = ["text", "title", "subtitle", "statement", "headline", "caption", "body"];
export function planRepairs(g: SceneGraph, scene: VideoScene, issues: readonly QAIssue[], probes: readonly FrameProbe[], box: SafeBox, attempt: number): LayoutRepair[] {
  const st = stageFor(g.aspectRatio); const out: LayoutRepair[] = []; const done = new Set<string>(); const sceneId = scene.id;
  const push = (r: LayoutRepair): void => { const k = r.op + ":" + r.entityId; if (!done.has(k)) { done.add(k); out.push(r); } };
  for (const i of issues) {
    if (!i.entityId) continue; const ent = scene.entities.find(e => e.id === i.entityId); if (!ent) continue;
    const boxes = probes.flatMap(p => p.boxes.filter(b => b.entityId === i.entityId)); if (!boxes.length) continue;
    if (i.code === "safe-zone" || i.code === "off-canvas") {
      const u = unionOf(boxes); let dx = 0, dy = 0;
      if (u.w > box.x1 - box.x0 || u.h > box.y1 - box.y0) { push({ op: "resize", sceneId, entityId: ent.id, scale: Math.max(0.5, Math.min(0.92, Math.min((box.x1 - box.x0) / u.w, (box.y1 - box.y0) / u.h) * 0.98)) }); continue; }
      if (u.x < box.x0) dx = box.x0 - u.x; else if (u.x + u.w > box.x1) dx = box.x1 - (u.x + u.w);
      if (u.y < box.y0) dy = box.y0 - u.y; else if (u.y + u.h > box.y1) dy = box.y1 - (u.y + u.h);
      push({ op: "move", sceneId, entityId: ent.id, dx: clamp(dx / st.w, 0.5), dy: clamp(dy / st.h, 0.5) });
      // pushing a headline DOWN into the panel/hero below it: make room by moving every non-text entity below it by the same amount (never past the safe floor)
      if (dy > 0 && L2_KINDS.has(ent.kind)) for (const o of scene.entities) {
        const pl = o.placement[g.aspectRatio]; if (!pl || o.id === ent.id || L2_KINDS.has(o.kind) || pl.h >= 0.95 || pl.y * st.h < u.y) continue;
        const room = box.y1 / st.h - (pl.y + pl.h); const mv = Math.min(dy / st.h + 0.03, room); if (mv > 0.004) push({ op: "move", sceneId, entityId: o.id, dx: 0, dy: clamp(mv, 0.5) });
      }
    } else if (i.code === "overlap" || i.code === "clip") {
      const sameEntity = /\[same-entity\]/.test(i.detail);
      if (/\[other-entity\]/.test(i.detail)) {
        // the obstacle (panel / hero below the headline) gives way first: move it down by the overlap + a gap while it still fits above the safe floor; else shrink the headline
        const m = /\((\d+)x(\d+)px\)/.exec(i.detail); const need = (m ? +m[2]! : 40) + 28; let moved = false;
        const hit = new Set<string>(); for (const p of probes) for (const a of p.boxes.filter(b => b.entityId === ent.id)) for (const b of p.boxes) { if (!b.entityId || b.entityId === ent.id || L2_KINDS.has(scene.entities.find(e => e.id === b.entityId)?.kind as EntityKind)) continue; if (Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 2 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 2) hit.add(b.entityId); }
        for (const oid of hit) { const o = scene.entities.find(e => e.id === oid), pl = o?.placement[g.aspectRatio]; if (!o || !pl) continue; const mv = Math.min(need / st.h, box.y1 / st.h - (pl.y + pl.h)); if (mv > 0.004) { push({ op: "move", sceneId, entityId: o.id, dx: 0, dy: clamp(mv, 0.5) }); moved = true; } }
        if (!moved) push({ op: "resize", sceneId, entityId: ent.id, scale: attempt === 0 ? 0.86 : 0.74 });
        continue;
      }
      if (i.code === "overlap" && !sameEntity) { const m = /\((\d+)x(\d+)px\)/.exec(i.detail); const h = m ? +m[2]! : 40; push({ op: "move", sceneId, entityId: ent.id, dx: 0, dy: clamp((h + 12) / st.h, 0.5) }); }
      else if (copyWords(ent) > (attempt === 0 ? 8 : 5)) push({ op: "shorten-copy", sceneId, entityId: ent.id, maxWords: attempt === 0 ? 8 : 5 });
      else push({ op: "resize", sceneId, entityId: ent.id, scale: attempt === 0 ? 0.9 : 0.8 });
    } else if (i.code === "contrast") push({ op: "add-scrim", sceneId, entityId: ent.id, opacity: attempt === 0 ? 0.72 : 0.9 });
  }
  return out;
}
const clamp = (v: number, m: number): number => Math.max(-m, Math.min(m, +v.toFixed(5)));
const unionOf = (bs: readonly TextBox[]): { x: number; y: number; w: number; h: number } => { const x0 = Math.min(...bs.map(b => b.x)), y0 = Math.min(...bs.map(b => b.y)), x1 = Math.max(...bs.map(b => b.x + b.w)), y1 = Math.max(...bs.map(b => b.y + b.h)); return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; };
const wc = (s: string): number => s.trim().split(/\s+/).length;
/** longest copy (in words) held by an entity: strings and string arrays alike */
const copyWords = (e: VideoScene["entities"][number]): number => Math.max(e.label ? wc(e.label) : 0, ...Object.values(e.props).flatMap(v => typeof v === "string" ? [wc(v)] : Array.isArray(v) ? v.map(wc) : []));
const cut = (s: string, n: number): string => s.trim().split(/\s+/).slice(0, n).join(" ");

/** Pure: returns a NEW graph with the patches applied (input untouched => trivial rollback). */
export function applyLayoutRepairs(g: SceneGraph, repairs: readonly LayoutRepair[]): SceneGraph {
  const n: SceneGraph = structuredClone(g);
  for (const r of repairs) {
    const sc = n.scenes.find(s => s.id === r.sceneId); const e = sc?.entities.find(x => x.id === r.entityId); const pl = e?.placement[n.aspectRatio]; if (!sc || !e || !pl) continue;
    if (r.op === "move") { pl.x = +(pl.x + r.dx).toFixed(5); pl.y = +(pl.y + r.dy).toFixed(5); }
    else if (r.op === "resize") { const cx = pl.x + pl.w / 2, cy = pl.y + pl.h / 2; pl.w = +(pl.w * r.scale).toFixed(5); pl.h = +(pl.h * r.scale).toFixed(5); pl.x = +(cx - pl.w / 2).toFixed(5); pl.y = +(cy - pl.h / 2).toFixed(5); }
    else if (r.op === "shorten-copy") { if (e.label) e.label = cut(e.label, r.maxWords); for (const [k, v] of Object.entries(e.props)) { if (typeof v === "string" && COPY_KEYS.includes(k)) e.props[k] = cut(v, r.maxWords); else if (Array.isArray(v)) e.props[k] = v.map(x => cut(x, r.maxWords)); } }
    else e.props["scrim"] = Math.max(typeof e.props["scrim"] === "number" ? (e.props["scrim"] as number) : 0, r.opacity);
  }
  return n;
}

/** ---------- orchestration ---------- */
export interface QAOptions { graph: SceneGraph; projectRoot: string; projectDir: string; outDir: string; audioPath?: string; maxRetries?: number; chromePath?: string; log?: (s: string) => void; scenes?: string[] }
const count = (is: readonly QAIssue[]): number => is.length;
async function probeScene(sb: StoryboardSession, g: SceneGraph, sc: VideoScene, kindOf: ReadonlyMap<string, EntityKind>, box: SafeBox, tag: string): Promise<{ probes: FrameProbe[]; issues: QAIssue[] }> {
  await sb.load(g, sc); const k = keyFrames(sc); const probes: FrameProbe[] = [], issues: QAIssue[] = [];
  for (const kind of ["start", "mid", "end"] as FrameKind[]) { const p = await sb.probe(sc, kind, k[kind], tag); probes.push(p); issues.push(...geometryIssues(p, kindOf, box), ...contrastIssues(p, kindOf)); }
  return { probes, issues: dedupe(issues) };
}
const dedupe = (is: QAIssue[]): QAIssue[] => { const m = new Map<string, QAIssue>(); for (const i of is) { const k = `${i.sceneId}|${i.code}|${i.entityId}|${i.detail}`; if (!m.has(k)) m.set(k, i); } return [...m.values()]; };

export async function runVisualQA(o: QAOptions): Promise<QAReport> {
  const t0 = Date.now(), log = o.log ?? ((): void => undefined), maxRetries = o.maxRetries ?? 2; const box = safeBoxFor(o.graph);
  const global = staticIssues(o.graph, { projectRoot: o.projectRoot, projectDir: o.projectDir, ...(o.audioPath ? { audioPath: o.audioPath } : {}) });
  let g = o.graph; const sb = await StoryboardSession.open(g, o.projectDir, o.outDir, o.chromePath ? { chromePath: o.chromePath } : {});
  const scenes: SceneQA[] = [], finalProbes: FrameProbe[] = []; let sampled = 0;
  try {
    for (const s0 of o.graph.scenes) {
      if (o.scenes && !o.scenes.includes(s0.id)) continue;
      const kindOf = new Map(s0.entities.map(e => [e.id, e.kind] as const));
      let cur = g, sc = cur.scenes.find(s => s.id === s0.id)!; let r = await probeScene(sb, cur, sc, kindOf, box, ""); sampled += 3;
      const qa: SceneQA = { sceneId: s0.id, issues: [], repairs: [], attempts: 0, rolledBack: false, passed: false, frames: r.probes.map(p => p.frame) };
      let best = { graph: cur, issues: r.issues, probes: r.probes };
      for (let a = 0; a < maxRetries && best.issues.length; a++) {
        const plan = planRepairs(best.graph, best.graph.scenes.find(s => s.id === s0.id)!, best.issues, best.probes, box, a); if (!plan.length) break;
        qa.attempts++; const cand = applyLayoutRepairs(best.graph, plan); const v = validateScene(cand, { projectRoot: o.projectRoot });
        if (!v.ok) { log(`  ${s0.id}: repair attempt ${a + 1} rejected by validator (${v.errors.map(e => e.code).join(",")}) -> rollback`); qa.rolledBack = true; break; }
        sc = cand.scenes.find(s => s.id === s0.id)!; const r2 = await probeScene(sb, cand, sc, kindOf, box, `.r${a + 1}`); sampled += 3;
        if (count(r2.issues) < count(best.issues)) { best = { graph: cand, issues: r2.issues, probes: r2.probes }; qa.repairs.push(...plan); log(`  ${s0.id}: repair ${a + 1} ${plan.map(p => p.op).join("+")} -> ${r2.issues.length} issue(s)`); }
        else { qa.rolledBack = true; log(`  ${s0.id}: repair ${a + 1} did not improve (${r2.issues.length} >= ${best.issues.length}) -> rollback`); break; }
      }
      g = best.graph; qa.issues = best.issues; qa.passed = best.issues.length === 0; scenes.push(qa); finalProbes.push(...best.probes);
    }
    const sheet = await contactSheet(finalProbes, path.join(o.outDir, "contact_sheet.png"));
    const passed = global.length === 0 && scenes.every(s => s.passed);
    return { passed, graph: g, scenes, global, sheet, sampledFrames: sampled, ms: Date.now() - t0, safeBox: box };
  } finally { await sb.close(); }
}
