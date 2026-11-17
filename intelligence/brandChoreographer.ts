/**
 * Brand choreographer: clauses -> scenes built ONLY from the themed archetype library.
 * Archetype choice is evidence-based (cues in the narration) + novelty-scored against visual memory; scenes alternate light/dark canvas.
 * Emits Scene Graph JSON only (no render code). All frames are integer global frames derived from word timestamps.
 */
import type { Archetype, Entity, Action, VideoScene, SemanticEvent, CameraKey, AudioEvent, Rect, Word } from "../schemas/scene.schema.js";
import type { Clause } from "./narrative.js";
import { BREATHER_KEY } from "./pacingPlanner.js";
import type { ResolvedEntity } from "./entityResolver.js";
import { CAMERA_PRESETS, pickMostNovel, type VisualMemory, type CameraPreset } from "./memory.js";
import { MODES } from "../visual/materials/brandTheme.js";

export interface BrandCtx { fps: number; aspect: "9:16" | "16:9"; words: Word[]; resolved: ResolvedEntity[]; memory: VisualMemory; durationFrames: number; cutFrames?: readonly number[]; hero3d?: readonly boolean[] }
const GPU_HEROES: ReadonlySet<Hero> = new Set<Hero>(["card_deck", "orbital_hub"]); // 3D-perspective heroes: counted against the GPU-hero budget when pacing is active
const DOM_HEROES: readonly Hero[] = ["ui_sim", "roadmap"];
type Hero = "ui_sim" | "orbital_hub" | "card_deck" | "roadmap";
const ARCH: Record<Hero, Archetype> = { ui_sim: "live_ui_action", orbital_hub: "orbit_system", card_deck: "device_showcase", roadmap: "timeline_journey" };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "x";
const STOP = new Set("a an the and or but of to in on at for with by from as is are was were be been it its this that these those you your we our they their i my me can will just not all itself like".split(" "));
const R = (x: number, y: number, w: number, h: number, z = 0): Rect => ({ x, y, w, h, z });
const LAYOUT = {
  "9:16": { kin: R(0, 0, 1, 1, -1), hero: R(.06, .23, .88, .46, .1), anchor: R(.38, .7, .24, .16, .3) },
  "16:9": { kin: R(0, 0, 1, 1, -1), hero: R(.04, .2, .76, .58, .1), anchor: R(.84, .62, .13, .24, .3) },
} as const;
const GENERIC_TOOLS = ["Gmail", "Slack", "Sheets", "Notion", "Calendar", "Drive", "CRM", "Docs", "Mail", "Chat"];

/** evidence score per hero archetype from the narration of a clause group */
function evidence(cl: Clause[], resolved: ResolvedEntity[]) {
  const cues = new Set(cl.flatMap(c => c.cues)); const text = cl.map(c => c.text).join(" ");
  const brands = new Set(cl.flatMap(c => c.brands.map(b => b.slug)));
  const steps = cl.filter(c => c.role === "step").length; void resolved;
  const sc: Record<Hero, number> = { ui_sim: 0, orbital_hub: 0, card_deck: 0, roadmap: 0 };
  for (const c of ["browser", "terminal", "code", "chat"] as const) if (cues.has(c)) sc.ui_sim += 2;
  if (/\b(tools?|apps?|platforms?|integrat\w*|connects?|everything|combine|together|unified|one place|all in one)\b/i.test(text)) sc.orbital_hub += 3;
  if (brands.size >= 2) sc.orbital_hub += 2; else if (brands.size === 1) sc.orbital_hub += 1;
  if (cues.has("workflow")) { sc.roadmap += 2; sc.orbital_hub += 1; }
  sc.roadmap += steps >= 2 ? 3 : steps === 1 ? 1 : 0; if (/\b(first|next|then|finally|steps?|roadmap|journey|plan)\b/i.test(text)) sc.roadmap += 2;
  for (const c of ["alert", "metric", "dashboard"] as const) if (cues.has(c)) sc.card_deck += 2;
  if (/\b(cards?|screens?|features?|templates?|results?|reports?|options?)\b/i.test(text)) sc.card_deck += 2;
  return sc;
}
export const heroTitle = (cl: Clause[]) => {
  const c = cl.find(x => x.numbers.length) ?? cl[0];
  const w = c.text.split(/\s+/).map(t => t.replace(/[^\w'-]/g, "")).filter(t => t && !STOP.has(t.toLowerCase()));
  const t = w.slice(0, 5); const hot = Math.max(0, t.findIndex(x => /^\d|^[A-Z]{2,}|x$/.test(x))); return { words: t.length >= 3 ? t : [...t, ...w.slice(5, 3 + 2)].slice(0, 5), hot: hot < 0 ? Math.max(0, t.length - 1) : hot };
};
function face(c: Clause): "code" | "checkmark" | "waveform" | "bolt" {
  const t = c.text.toLowerCase();
  if (/\b(sound|voice|audio|speak|talk|listen|hear|say|call|podcast)\b/.test(t)) return "waveform";
  if (c.cues.includes("alert") || /\b(done|finished|complete|result|sent|ready|success|works?)\b/.test(t)) return "checkmark";
  if (c.cues.includes("code") || c.cues.includes("terminal")) return "code";
  return "bolt";
}

export function brandChoreograph(groups: Clause[][], ctx: BrandCtx): { scenes: VideoScene[]; notes: Record<string, unknown>[] } {
  const { fps, aspect, words, memory } = ctx; const F = (t: number) => Math.round(t * fps); const L = LAYOUT[aspect];
  const scenes: VideoScene[] = [], notes: Record<string, unknown>[] = []; let ai = 0, ei = 0;
  const handle = Math.round(.27 * fps);
  groups.forEach((g, si) => {
    const startFrame = si === 0 ? 0 : ctx.cutFrames?.[si] ?? Math.max(0, F(g[0].startSec) - handle);
    const endFrame = si === groups.length - 1 ? ctx.durationFrames : ctx.cutFrames?.[si + 1] ?? Math.max(0, F(groups[si + 1][0].startSec) - handle);
    const ev = (cl: Clause[], intent: string, actions: Action[]): SemanticEvent => ({ id: `ev_${si}_${ei++}`, wordStart: cl[0].wordStart, wordEnd: cl[cl.length - 1].wordEnd, startFrame: F(words[cl[0].wordStart].start), endFrame: F(words[cl[cl.length - 1].wordEnd].end), intent: intent.slice(0, 150), actions });
    const A = (entityId: string, type: Action["type"], s: number, e: number, extra: Partial<Action> = {}): Action => ({ id: `a_${++ai}`, entityId, type, startFrame: s, endFrame: Math.max(e, s + 1), ease: "ease_in_out", ...extra } as Action);
    const sfx: AudioEvent[] = [{ id: `s_${++ai}`, frame: startFrame + 2, sfx: "whoosh", gain: .4 }];
    if (g[0].key === BREATHER_KEY) { // Minimal Statement Breather: one bold hero phrase, no hero object, no anchor
      const t = heroTitle(g); const words2 = t.words.slice(0, 4); const kid2 = "kin_main"; const lastF = endFrame - 1; const K0 = (frame: number): CameraKey => ({ frame, pan: { x: 0, y: 0 }, tilt: 0, zoom: 1, ease: "ease_in_out" } as CameraKey);
      const entB: Entity = { id: kid2, kind: "kinetic_words", capabilities: ["appear", "disappear", "highlight"], placement: { [aspect]: L.kin }, props: { title: words2.join(" "), hot: Math.min(t.hot, words2.length - 1), statement: true, wordStart: g[0].wordStart, wordEnd: g[g.length - 1].wordEnd } } as Entity;
      const evB = ev(g, `statement breather: ${words2.join(" ")}`, [A(kid2, "appear", F(g[0].startSec), F(g[0].startSec) + 10, { ease: "spring" })]);
      scenes.push({ id: `scene_${String(si + 1).padStart(2, "0")}`, archetype: "hero_object", startFrame, endFrame, title: words2.join(" ").slice(0, 60), entities: [entB], semanticEvents: [evB], camera: [K0(startFrame), K0(lastF)], audioEvents: [{ id: `s_${++ai}`, frame: startFrame + 2, sfx: "impact", gain: .5 }], theme: MODES[si % 2], typeScale: 1 } as VideoScene);
      notes.push({ scene: si + 1, theme: MODES[si % 2], seconds: +((endFrame - startFrame) / fps).toFixed(1), heroes: [], breather: true, title: words2.join(" ") }); return;
    }
    // ---- choose heroes by evidence + novelty (max 2 per scene, second only if scene >= 8 s) ----
    const dur = (endFrame - startFrame) / fps; const sc = evidence(g, ctx.resolved);
    const ranked = (Object.keys(sc) as Hero[]).sort((a, b) => sc[b] - sc[a]);
    let pool = ranked.filter(h => sc[h] > 0); if (!pool.length) pool.push("card_deck", "ui_sim");
    const want3d = ctx.hero3d?.[si]; // pacing planner's GPU-hero budget decides whether this scene may use a 3D hero
    if (want3d === true) { const g3 = pool.filter(h => GPU_HEROES.has(h)); pool = g3.length ? g3 : ["card_deck"]; }
    else if (want3d === false) { const d = pool.filter(h => !GPU_HEROES.has(h)); pool = d.length ? d : [...DOM_HEROES]; }
    const primary = pickMostNovel(pool.map(h => ARCH[h]), memory.usedArchetypes).pick; const h1 = pool.find(h => ARCH[h] === primary)!;
    const heroes: { h: Hero; cl: Clause[] }[] = [];
    const h2 = dur >= 8 && g.length >= 2 ? pool.find(h => h !== h1) ?? (h1 === "card_deck" ? "ui_sim" : "card_deck") : undefined;
    if (h2) { const mid = Math.ceil(g.length / 2); heroes.push({ h: h1, cl: g.slice(0, mid) }, { h: h2, cl: g.slice(mid) }); } else heroes.push({ h: h1, cl: g });
    heroes.forEach(x => memory.usedArchetypes.push(ARCH[x.h]));
    // ---- entities + events ----
    const ents: Entity[] = []; const events: SemanticEvent[] = [];
    const title = heroTitle(g); const kid = "kin_main", aid = "anchor_core";
    ents.push({ id: kid, kind: "kinetic_words", label: undefined, capabilities: ["appear", "disappear", "highlight"], placement: { [aspect]: L.kin }, props: { title: title.words.join(" "), hot: title.hot, wordStart: g[0].wordStart, wordEnd: g[g.length - 1].wordEnd } } as Entity);
    ents.push({ id: aid, kind: "anchor_core", capabilities: ["appear", "morph", "highlight"], placement: { [aspect]: L.anchor }, props: { persistent: true, face: si === 0 ? "bolt" : String(memory.recurring["face"] ?? "bolt") } } as Entity);
    const sceneEv = ev(g, `${title.words.join(" ")} (scene)`, [A(kid, "appear", F(g[0].startSec), F(g[0].startSec) + 12, { ease: "spring" }), A(aid, "appear", F(g[0].startSec), F(g[0].startSec) + 12, { ease: "spring" })]);
    events.push(sceneEv);
    let lastFace = "bolt";
    for (const c of g) { const f = face(c); if (f !== lastFace) { const s = F(c.startSec); events.push(ev([c], `anchor reacts: ${f}`, [A(aid, "morph", s, Math.min(s + 14, F(c.endSec)), { text: f })])); lastFace = f; if (f === "checkmark") sfx.push({ id: `s_${++ai}`, frame: s + 4, sfx: "notify", gain: .5, entityId: aid }); } }
    memory.recurring["face"] = lastFace;
    heroes.forEach(({ h, cl }, hi) => {
      const hid = `${h}_${hi}`; const s0 = F(cl[0].startSec), e1 = F(cl[cl.length - 1].endSec); const full = (hi === 0 && heroes.length === 1);
      const lastHero = hi === heroes.length - 1; const mk = (kind: Entity["kind"], caps: Entity["capabilities"], props: Entity["props"]) => ents.push({ id: hid, kind, capabilities: caps, placement: { [aspect]: L.hero }, props: ctx.hero3d && GPU_HEROES.has(h) ? { ...props, webgl: true } : props } as Entity);
      const span: Action[] = [A(hid, "appear", s0, s0 + 14, { ease: "spring" })]; const clauseEvents: SemanticEvent[] = [];
      if (!lastHero && !full) span.push(A(hid, "disappear", Math.max(s0 + 20, e1 - 10), e1));
      const keyOf = (c: Clause) => c.text.split(/\s+/).map(t => t.replace(/[^\w'-]/g, "")).filter(t => t && !STOP.has(t.toLowerCase())).slice(0, 3).join(" ");
      if (h === "ui_sim") {
        const cues = new Set(cl.flatMap(c => c.cues)); const variant = cues.has("chat") ? "chat" : cues.has("browser") ? "browser" : "terminal";
        const tasks = cl.map(keyOf).filter(Boolean).slice(0, 3);
        mk("ui_sim", ["appear", "disappear", "type", "click", "count", "highlight"], { variant, tasks, title: variant === "chat" ? "agent chat" : variant === "browser" ? "agent browser" : "agent terminal" });
        const cs = s0 + Math.round(.6 * fps), ce = Math.max(cs + Math.round(fps), e1 - Math.round(.4 * fps));
        span.push(A(hid, "count", cs, ce, { value: 100 })); if (variant === "browser") span.push(A(hid, "click", Math.max(cs, ce - Math.round(.8 * fps)), ce));
        sfx.push({ id: `s_${++ai}`, frame: ce, sfx: "notify", gain: .45, entityId: hid });
        cl.slice(0, variant === "chat" ? 2 : 3).forEach((c, i) => {
          const a = F(c.startSec) + 2, b = Math.min(F(c.endSec), a + Math.round(1.6 * fps)); const verb = c.triplet.verb, obj = slug(c.triplet.object).slice(0, 16);
          const text = variant === "browser" ? `agent://${verb}/${obj}` : variant === "chat" ? (i === 0 ? c.text.split(/\s+/).slice(0, 6).join(" ") : `Done: ${keyOf(c)}`.slice(0, 40)) : `agent ${verb} --${(obj || "task").slice(0, 10)}`;
          if (variant === "browser" && i > 0) return; clauseEvents.push(ev([c], `${c.triplet.subject} ${verb} ${c.triplet.object}`, [A(hid, "type", a, b, { text, ease: "steps" })])); sfx.push({ id: `s_${++ai}`, frame: a, sfx: "type", gain: .3, entityId: hid });
        });
      } else if (h === "orbital_hub") {
        const brands = [...new Map(cl.flatMap(c => c.brands).map(b => [b.slug, b])).values()]; const items: string[] = [], logoIds: string[] = [];
        for (const b of brands) { items.push(b.name); logoIds.push(b.assetId ?? ""); }
        for (const t of GENERIC_TOOLS) { if (items.length >= 7) break; if (!items.includes(t)) { items.push(t); logoIds.push(""); } }
        mk("orbital_hub", ["appear", "disappear", "merge", "highlight"], { items, logoIds });
        const m0 = Math.min(s0 + Math.round(1.4 * fps), Math.max(s0 + 6, e1 - Math.round(1.9 * fps))); const m1 = Math.min(e1, m0 + Math.round(1.1 * fps));
        span.push(A(hid, "merge", m0, m1, { ease: "ease_in_out" })); sfx.push({ id: `s_${++ai}`, frame: m0, sfx: "riser", gain: .35, entityId: hid }, { id: `s_${++ai}`, frame: m1, sfx: "impact", gain: .55, entityId: hid });
      } else if (h === "card_deck") {
        const titles = cl.map(keyOf).filter(Boolean).slice(0, 5); const extra = ["Overview", "Insights", "Actions", "Results"]; while (titles.length < 3) titles.push(extra[titles.length]);
        mk("card_deck", ["appear", "disappear", "fan", "click", "highlight"], { titles }); const active = Math.min(titles.length - 1, Math.floor(titles.length / 2));
        const f0 = s0 + Math.round(.3 * fps); span.push(A(hid, "fan", f0, Math.min(e1, f0 + Math.round(1.2 * fps)), { value: active, ease: "spring" }));
        const c0 = Math.min(e1, f0 + Math.round(2.0 * fps)); span.push(A(hid, "click", c0, Math.min(e1, c0 + Math.round(.6 * fps)), { value: active })); sfx.push({ id: `s_${++ai}`, frame: c0, sfx: "pop", gain: .5, entityId: hid });
      } else {
        const stepsC = cl.slice(0, 6); const titles = stepsC.map(keyOf); while (titles.length < 3) titles.push(["Connect", "Automate", "Deliver"][titles.length]);
        mk("roadmap", ["appear", "disappear", "step", "highlight"], { titles });
        stepsC.forEach((c, i) => { const a = F(c.startSec) + 2; clauseEvents.push(ev([c], `step ${i + 1}: ${keyOf(c)}`, [A(hid, "step", a, Math.min(F(c.endSec), a + Math.round(1.1 * fps)), { value: i + 1, text: keyOf(c).slice(0, 34) })])); sfx.push({ id: `s_${++ai}`, frame: a, sfx: "pop", gain: .45, entityId: hid }); });
      }
      events.push(ev(cl, `${h} performs: ${cl.map(c => c.triplet.verb).join(", ")}`, span), ...clauseEvents);
    });
    // ---- camera: mild presets (stay inside 60 px safe margins) ----
    const cp = pickMostNovel([...CAMERA_PRESETS] as CameraPreset[], memory.previousCameraAngles); memory.previousCameraAngles.push(cp.pick);
    const last = endFrame - 1; const K = (frame: number, o: Partial<CameraKey>): CameraKey => ({ frame, pan: { x: 0, y: 0 }, tilt: 0, zoom: 1, ease: "ease_in_out", ...o } as CameraKey);
    const cam: CameraKey[] = ({
      push_in: [K(startFrame, {}), K(last, { zoom: 1.04 })], pull_out: [K(startFrame, { zoom: 1.04 }), K(last, {})],
      pan_left: [K(startFrame, { pan: { x: .12, y: 0 }, zoom: 1.02 }), K(last, { pan: { x: -.12, y: 0 }, zoom: 1.02 })], pan_right: [K(startFrame, { pan: { x: -.12, y: 0 }, zoom: 1.02 }), K(last, { pan: { x: .12, y: 0 }, zoom: 1.02 })],
      tilt_up: [K(startFrame, { tilt: 4, zoom: 1.02 }), K(last, { tilt: 0, zoom: 1.02 })], tilt_down: [K(startFrame, { tilt: -4, zoom: 1.02 }), K(last, { tilt: 0, zoom: 1.02 })],
      focus_pull: [K(startFrame, {}), K(last, { zoom: 1.04 })], drift: [K(startFrame, { pan: { x: 0, y: .1 }, zoom: 1.02 }), K(last, { pan: { x: 0, y: -.08 }, zoom: 1.02 })],
    } as Record<CameraPreset, CameraKey[]>)[cp.pick];
    // uniform ordering: scene-wide event first
    events.sort((a, b) => a.startFrame - b.startFrame);
    scenes.push({ id: `scene_${String(si + 1).padStart(2, "0")}`, archetype: ARCH[heroes[0].h], startFrame, endFrame, title: title.words.join(" ").slice(0, 60), entities: ents, semanticEvents: events, camera: cam, audioEvents: sfx.filter(a => a.frame >= startFrame && a.frame < endFrame), theme: MODES[si % 2], typeScale: 1 });
    notes.push({ scene: si + 1, theme: MODES[si % 2], seconds: +dur.toFixed(1), heroes: heroes.map(x => x.h), evidence: sc, camera: cp.pick, title: title.words.join(" ") });
  });
  return { scenes, notes };
}
