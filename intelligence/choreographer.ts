/** Stage 2 — Visual Choreographer: clauses -> continuous 6-12 s scenes of literal performances (never raw render code). */
import { CANVAS, type Archetype, type Entity, type Action, type VideoScene, type SemanticEvent, type CameraKey, type AudioEvent, type Rect, type Word } from "../schemas/scene.schema.js";
import type { Clause, Comp } from "./narrative.js";
import type { ResolvedEntity } from "./entityResolver.js";
import { CAMERA_PRESETS, pickMostNovel, type VisualMemory, type CameraPreset } from "./memory.js";
import { routeDirectorSkill } from "./directorSkill.js";

export interface Ctx { fps: number; aspect: "9:16" | "16:9"; words: Word[]; resolved: ResolvedEntity[]; memory: VisualMemory; durationFrames: number }
const F = (t: number, fps: number) => Math.round(t * fps);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "x";

/** ---- scene grouping: 6-12 s continuous scenes ---- */
export function groupScenes(clauses: Clause[], minS = 5, maxS = 12): Clause[][] {
  const groups: Clause[][] = []; let cur: Clause[] = [];
  const dur = (g: Clause[]) => g.length ? g[g.length - 1].endSec - g[0].startSec : 0;
  for (const c of clauses) {
    const would = cur.length ? c.endSec - cur[0].startSec : c.endSec - c.startSec;
    if (cur.length && (would > maxS || (c.role === "step" && dur(cur) >= minS) || (dur(cur) >= minS && c.split && cur.length >= 2))) { groups.push(cur); cur = []; }
    cur.push(c);
  }
  if (cur.length) groups.push(cur);
  // merge too-short groups into neighbours
  for (let i = 0; i < groups.length; i++) if (groups.length > 1 && dur(groups[i]) < 4) { const j = i > 0 ? i - 1 : i + 1; if (dur([...groups[Math.min(i, j)], ...groups[Math.max(i, j)]]) <= 14) { groups[Math.min(i, j)] = [...groups[Math.min(i, j)], ...groups[Math.max(i, j)]]; groups.splice(Math.max(i, j), 1); i = -1; } }
  return groups;
}

/** ---- archetype candidates from the 24-primitive deterministic director ---- */
function candidates(comps: Comp[], split: boolean, text: string): Archetype[] {
  return routeDirectorSkill(text, comps, split).candidates;
}

/** ---- layout: adaptive per aspect ratio ---- */
const R = (x: number, y: number, w: number, h: number, z = 0): Rect => ({ x: +x.toFixed(3), y: +y.toFixed(3), w: +w.toFixed(3), h: +h.toFixed(3), z });
function layout(n: number, logos: number, aspect: "9:16" | "16:9"): Rect[] {
  const out: Rect[] = []; const top = logos ? 0.17 : 0;
  if (aspect === "9:16") {
    const gap = 0.035, H = 1 - top, hh = Math.min(n === 1 ? 0.5 : 0.36, (H - gap * (n - 1)) / n); const used = n * hh + gap * (n - 1), y0 = top + (H - used) / 2;
    for (let i = 0; i < n; i++) out.push(R(0.03, y0 + i * (hh + gap), 0.94, hh, i % 2 ? 0.2 : -0.1));
  } else {
    const L = top;
    if (n === 1) out.push(R(0.12, L + 0.05, 0.76, 0.8 - L));
    else if (n === 2) out.push(R(0.02, L, 0.47, 0.95 - L, -0.1), R(0.51, L, 0.47, 0.95 - L, 0.2));
    else if (n === 3) out.push(R(0.02, L, 0.47, 0.95 - L, -0.1), R(0.51, L, 0.47, (0.95 - L) / 2 - 0.02, 0.2), R(0.51, L + (0.95 - L) / 2 + 0.02, 0.47, (0.95 - L) / 2 - 0.02, 0));
    else for (let i = 0; i < n; i++) out.push(R(0.02 + (i % 2) * 0.49, L + Math.floor(i / 2) * ((0.95 - L) / 2 + 0.01), 0.47, (0.95 - L) / 2 - 0.02, i % 2 ? 0.2 : -0.1));
  }
  return out;
}
const logoRect = (i: number, aspect: "9:16" | "16:9") => (aspect === "9:16" ? R(0.03 + i * 0.5, 0, 0.45, 0.13, 0.3) : R(0.02 + i * 0.3, 0, 0.27, 0.14, 0.3));

type Plan = { id: string; kind: Entity["kind"]; comp: Comp; label?: string; assetId?: string; props: Entity["props"]; caps: Entity["capabilities"] };
const KIND: Record<string, Entity["kind"]> = { browser: "browser", dashboard: "dashboard", code: "code_editor", terminal: "terminal", workflow: "workflow", alert: "card", metric: "card", chat: "chat", text: "text" };
const CAPS: Record<string, Entity["capabilities"]> = { browser: ["appear", "type", "click"], dashboard: ["appear", "count"], code: ["appear", "type"], terminal: ["appear", "type", "count"], workflow: ["appear", "click", "highlight"], alert: ["appear", "highlight"], metric: ["appear", "count", "highlight"], chat: ["appear", "type"], text: ["appear"], logo: ["appear", "connect", "highlight"], icon: ["appear", "click", "connect", "highlight"] };

export function choreograph(groups: Clause[][], ctx: Ctx): { scenes: VideoScene[]; notes: Record<string, unknown>[] } {
  const { fps, aspect, words, memory } = ctx; const scenes: VideoScene[] = []; const notes: Record<string, unknown>[] = [];
  groups.forEach((g, si) => {
    const startFrame = si === 0 ? 0 : Math.max(0, F(g[0].startSec, fps) - 8);
    const endFrame = si === groups.length - 1 ? ctx.durationFrames : Math.max(0, F(groups[si + 1][0].startSec, fps) - 8);
    // entities by cue (dedupe), max 4 interface + up to 2 logos/icons
    const plans: Plan[] = []; const logos: Plan[] = [];
    for (const c of g) for (const cue of c.cues) {
      if (cue === "brand") { for (const b of c.brands) { const id = memory.recurring[b.slug] ?? `${b.kind}_${b.slug}`; memory.recurring[b.slug] = id; if (!logos.some(l => l.id === id) && logos.length < 2) logos.push({ id, kind: b.kind === "logo" ? "logo" : "icon", comp: "brand", label: b.name, assetId: b.assetId, props: b.glyph ? { glyph: b.glyph } : {}, caps: CAPS[b.kind === "logo" ? "logo" : "icon"] }); } continue; }
      const id = `${KIND[cue]}_${slug(cue)}`;
      if (plans.some(p => p.id === id) || plans.length >= 4) continue;
      const nums = g.flatMap(x => x.numbers);
      const props: Entity["props"] = cue === "metric" ? { label: "Productivity", suffix: /\d+x/i.test(c.text) ? "x" : "%", value: "0" } : cue === "alert" ? { value: "Alert sent" } : cue === "code" ? { language: "python" } : cue === "browser" ? { url: "agent://browse" } : cue === "workflow" ? { nodes: ["Trigger", "Agent", "Action"] } : {};
      plans.push({ id, kind: KIND[cue], comp: cue, label: cue === "alert" ? "Instant alert" : cue === "metric" ? "Productivity" : cue === "text" ? c.key : undefined, props, caps: CAPS[cue] });
      void nums;
    }
    const lay = layout(plans.length, logos.length, aspect);
    const ents: Entity[] = [];
    logos.forEach((l, i) => ents.push({ id: l.id, kind: l.kind, label: l.label, capabilities: l.caps, assetId: l.assetId, placement: { [aspect]: logoRect(i, aspect) }, props: l.props } as Entity));
    plans.forEach((p, i) => ents.push({ id: p.id, kind: p.kind, label: p.label, capabilities: p.caps, placement: { [aspect]: lay[i] }, props: p.props } as Entity));
    const has = new Set<string>(); const events: SemanticEvent[] = []; const audio: AudioEvent[] = []; let ai = 0; let evI = 0;
    const target = (comp: Comp) => (comp === "brand" ? logos[0]?.id : plans.find(p => p.comp === comp)?.id);
    for (const c of g) {
      const sF = Math.max(F(c.startSec, fps), startFrame + 1), eF = Math.min(Math.max(F(c.endSec, fps), sF + 20), endFrame - 1);
      const acts: Action[] = []; const A = (a: Omit<Action, "id" | "ease"> & { ease?: Action["ease"] }) => { acts.push({ ease: "ease_in_out", ...a, id: `a_${++ai}` } as Action); };
      const avail = eF - sF;
      const appear = (id: string | undefined) => { if (id && !has.has(id)) { has.add(id); A({ entityId: id, type: "appear", startFrame: sF, endFrame: Math.min(sF + 12, eF), ease: "spring" }); return true; } return false; };
      const t0 = () => Math.min(sF + 14, eF - 4);
      for (const comp of c.cues) {
        const id = target(comp); if (!id) continue; const justAppeared = appear(id); void justAppeared;
        const obj = c.triplet.object || c.key, verb = c.triplet.verb;
        if (comp === "browser") { A({ entityId: id, type: "type", startFrame: t0(), endFrame: Math.min(t0() + Math.max(8, Math.round(avail * .6)), eF), text: `agent://${slug(obj).slice(0, 18)}`, ease: "steps" }); A({ entityId: id, type: "click", startFrame: Math.max(eF - 14, t0() + 8), endFrame: eF - 2 }); audio.push({ id: `s_${++ai}`, frame: Math.max(eF - 14, sF + 20), sfx: "click", gain: .5, entityId: id }); }
        if (comp === "code") { const txt = `agent.${verb}("${slug(obj).slice(0, 14)}")`; A({ entityId: id, type: "type", startFrame: t0(), endFrame: Math.min(t0() + Math.max(10, Math.round(avail * .7)), eF), text: txt, ease: "steps" }); audio.push({ id: `s_${++ai}`, frame: t0(), sfx: "type", gain: .35, entityId: id }); }
        if (comp === "terminal") { A({ entityId: id, type: "type", startFrame: t0(), endFrame: Math.min(t0() + Math.max(10, Math.round(avail * .7)), eF), text: `${verb} ./${slug(obj).slice(0, 14)} --all`, ease: "steps" }); audio.push({ id: `s_${++ai}`, frame: t0(), sfx: "type", gain: .35, entityId: id }); }
        if (comp === "dashboard" && c.numbers.length) { A({ entityId: id, type: "count", startFrame: t0(), endFrame: eF, value: c.numbers[0] }); }
        if (comp === "metric") { if (!c.numbers.length) { A({ entityId: id, type: "highlight", startFrame: t0(), endFrame: Math.min(t0() + 16, eF) }); continue; } const v = c.numbers[0]; A({ entityId: id, type: "count", startFrame: t0(), endFrame: eF, value: v }); audio.push({ id: `s_${++ai}`, frame: eF - 6, sfx: "impact", gain: .6, entityId: id }); }
        if (comp === "alert") { A({ entityId: id, type: "highlight", startFrame: t0(), endFrame: Math.min(t0() + 18, eF) }); audio.push({ id: `s_${++ai}`, frame: sF + 4, sfx: "notify", gain: .55, entityId: id }); }
        if (comp === "chat") { A({ entityId: id, type: "type", startFrame: t0(), endFrame: Math.min(t0() + Math.max(10, Math.round(avail * .4)), eF), text: `> ${obj}`, ease: "steps" }); }
        if (comp === "workflow") { const d = Math.max(8, Math.floor((eF - t0()) / 2)); A({ entityId: id, type: "click", startFrame: t0(), endFrame: Math.min(t0() + d, eF) }); }
        if (comp === "brand") { /* appear only; connect below */ }
        if (comp === "text") { /* appear only */ }
      }
      // logos connect to the first interface entity (a physical, visible link)
      if (c.cues.includes("brand") && logos[0] && plans[0] && !acts.some(a => a.type === "connect" && a.entityId === logos[0].id)) { const s2 = Math.min(sF + 18, eF - 8); A({ entityId: logos[0].id, type: "connect", startFrame: s2, endFrame: Math.min(s2 + 14, eF - 1), targetEntityId: plans[0].id }); }
      if (!acts.length) { const any = ents[0]; if (any) { if (!has.has(any.id)) { has.add(any.id); A({ entityId: any.id, type: "appear", startFrame: sF, endFrame: Math.min(sF + 12, eF) }); } else A({ entityId: any.id, type: "highlight", startFrame: sF, endFrame: Math.min(sF + 14, eF) }); } }
      // workflow connect has no meaningful target entity (internal) -> remove targetEntityId self-link
      for (const a of acts) if (a.type === "connect" && a.targetEntityId === a.entityId) delete a.targetEntityId;
      events.push({ id: `ev_${si}_${evI++}`, wordStart: c.wordStart, wordEnd: c.wordEnd, startFrame: F(words[c.wordStart].start, fps), endFrame: F(words[c.wordEnd].end, fps), intent: `${c.triplet.subject} ${c.triplet.verb} ${c.triplet.object}`.trim().slice(0, 150), actions: acts });
    }
    // events from clauses must sit inside the scene; entities with no appear get one on first event
    for (const e of ents) if (!has.has(e.id)) { const ev = events[0]; ev.actions.unshift({ id: `a_${++ai}`, entityId: e.id, type: "appear", startFrame: ev.startFrame, endFrame: Math.min(ev.startFrame + 12, ev.endFrame), ease: "ease_out" }); }
    // archetype + camera chosen by novelty against visual memory
    const comps = [...new Set(g.flatMap(c => c.cues))]; const split = g.some(c => c.split) && g.length > 1;
    const directorRoute = routeDirectorSkill(g.map(c => c.text).join(" "), comps, split); const cand = candidates(comps, split, g.map(c => c.text).join(" ")); const ap = pickMostNovel(cand, memory.usedArchetypes); memory.usedArchetypes.push(ap.pick);
    const cp = pickMostNovel([...CAMERA_PRESETS] as CameraPreset[], memory.previousCameraAngles); memory.previousCameraAngles.push(cp.pick);
    const focus = ents.filter(e => !["logo", "icon"].includes(e.kind)).slice(-1)[0]?.id ?? ents[0].id;
    memory.dominantColors.push(["acc", "acc2", "hot"][si % 3]);
    const last = endFrame - 1; const K = (frame: number, o: Partial<CameraKey>): CameraKey => ({ frame, pan: { x: 0, y: 0 }, tilt: 0, zoom: 1, ease: "ease_in_out", ...o } as CameraKey);
    const cam: CameraKey[] = ({
      push_in: [K(startFrame, {}), K(last, { zoom: 1.08, focusTarget: focus })],
      pull_out: [K(startFrame, { zoom: 1.1 }), K(last, {})],
      pan_left: [K(startFrame, { pan: { x: .2, y: 0 }, zoom: 1.04 }), K(last, { pan: { x: -.2, y: 0 }, zoom: 1.04 })],
      pan_right: [K(startFrame, { pan: { x: -.2, y: 0 }, zoom: 1.04 }), K(last, { pan: { x: .2, y: 0 }, zoom: 1.04 })],
      tilt_up: [K(startFrame, { tilt: 6, zoom: 1.03 }), K(last, { tilt: 0, zoom: 1.03 })],
      tilt_down: [K(startFrame, { tilt: -6, zoom: 1.03 }), K(last, { tilt: 0, zoom: 1.03 })],
      focus_pull: [K(startFrame, {}), K(last, { zoom: 1.12, focusTarget: focus, depthOfField: { enabled: true, focusEntityId: focus, blurPx: 3 } })],
      drift: [K(startFrame, { pan: { x: 0, y: .15 }, zoom: 1.02 }), K(last, { pan: { x: 0, y: -.1 }, zoom: 1.02 })],
    } as Record<CameraPreset, CameraKey[]>)[cp.pick];
    audio.unshift({ id: `s_${++ai}`, frame: startFrame + 2, sfx: "whoosh", gain: .4 });
    scenes.push({ id: `scene_${String(si + 1).padStart(2, "0")}`, archetype: ap.pick, startFrame, endFrame, title: g[0].key.slice(0, 60), entities: ents, semanticEvents: events, camera: cam, audioEvents: audio.filter(a => a.frame >= startFrame && a.frame <= endFrame), typeScale: 1 });
    notes.push({ scene: si + 1, directorPrimitive: directorRoute.primitive, directorEvidence: directorRoute.evidence, seconds: +((endFrame - startFrame) / fps).toFixed(1), archetype: ap.pick, archetypeScores: ap.scores, camera: cp.pick, components: ents.map(e => `${e.kind}:${e.id}`), intents: events.map(e => e.intent) });
  });
  return { scenes, notes };
}
export const _canvas = CANVAS;
