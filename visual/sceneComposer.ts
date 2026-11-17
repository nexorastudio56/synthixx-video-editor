/**
 * Scene Compiler (render side): validated SceneGraph -> Hyperframes sub-composition HTML.
 * Every tween time is derived from integer GLOBAL frames via ctx.sec(frame): no Date, no random, no chunk-local state.
 */
import { CANVAS, type SceneGraph, type VideoScene, type Action, type Entity } from "../schemas/scene.schema.js";
import { PROFILES, profileCss, type Profile } from "./materials/morphismProfiles.js";
import { brandProfile, brandBackground, modeForScene, setBrandPalette } from "./materials/brandTheme.js";
import { hexToRgb } from "../styles/themeCompiler.js";
import { lookFor, type SceneLook } from "./materials/themeBridge.js";
import { boxFor, stageFor, focusZoomBoost } from "./layout.js";
import { REGISTRY } from "./registry.js";
import { TYPE_JS, PHYS_JS } from "./interfaces/shared.js";
import { pulseRuntimeJs, PULSE_EXCLUDED_KINDS, type PulseImpact } from "./fx/impactPulse.js";

/** Optional emphasis-driven impact pulse (L0 backdrop + L1 heroes only; never captions/logos). */
export interface PulseFx { readonly impacts: readonly PulseImpact[] }
import type { Ctx } from "./types.js";

export const FONT_FACES = `@font-face{font-family:'InterX';font-weight:800;src:url('assets/fonts/inter800.otf')}@font-face{font-family:'InterX';font-weight:700;src:url('assets/fonts/inter700.otf')}`;

/** Theme-driven look for a scene (null = legacy hard-wired Synthixx brand). */
export function themeLook(graph: SceneGraph, scene: VideoScene): SceneLook | null { if (graph.morphism !== "brand" || !graph.theme) return null; const i = Math.max(0, graph.scenes.findIndex(x => x.id === scene.id)); return lookFor(graph.theme, i, scene.theme); }
export function sceneMode(graph: SceneGraph, scene: VideoScene) { const l = themeLook(graph, scene); if (l) return l.mode; const i = graph.scenes.findIndex(x => x.id === scene.id); return modeForScene(Math.max(0, i), scene.theme); }
export function profileFor(graph: SceneGraph, scene: VideoScene): Profile { const l = themeLook(graph, scene); if (l) return l.profile; return graph.morphism === "brand" ? brandProfile(sceneMode(graph, scene)) : PROFILES[graph.morphism]; }
export function makeCtx(graph: SceneGraph, scene: VideoScene, assetPaths: Record<string, string>): Ctx {
  const { width: W, height: H } = CANVAS[graph.aspectRatio];
  const ents = new Map(scene.entities.map(e => [e.id, e]));
  return {
    graph, fps: graph.fps, W, H, portrait: graph.aspectRatio === "9:16", profile: profileFor(graph, scene), sceneStartFrame: scene.startFrame,
    sec: f => +((f - scene.startFrame) / graph.fps).toFixed(4),
    box: e => boxFor(e, graph, scene.typeScale ?? 1), assetPath: id => (id ? assetPaths[id] : undefined), entities: ents,
  };
}
const center = (e: Entity, c: Ctx) => { const b = c.box(e); return { x: b.x + b.w / 2, y: b.y + b.h / 2 }; };

export function composeScene(graph: SceneGraph, scene: VideoScene, assetPaths: Record<string, string> = {}, fx?: PulseFx): { id: string; html: string } {
  setBrandPalette(themeLook(graph, scene)?.palette ?? null); // live palette is read by archetypes at render() time; synchronous set -> compose -> reset
  try { return composeSceneInner(graph, scene, assetPaths, fx); } finally { setBrandPalette(null); }
}
function composeSceneInner(graph: SceneGraph, scene: VideoScene, assetPaths: Record<string, string>, fx?: PulseFx): { id: string; html: string } {
  const c = makeCtx(graph, scene, assetPaths); const p = c.profile; const m = p.motion;
  const dur = c.sec(scene.endFrame);
  const allActions: Action[] = scene.semanticEvents.flatMap(ev => ev.actions);
  let body = "", css = "", js = "";
  const seen = new Set<string>();
  const stage = stageFor(graph.aspectRatio);
  // ---- entities ----
  scene.entities.forEach((e, i) => {
    const comp = REGISTRY.get(e.kind); if (!comp) throw new Error(`no component for kind ${e.kind}`);
    const acts = allActions.filter(a => a.entityId === e.id);
    const r = comp.render(e, acts, c);
    if (r.css && !seen.has(e.kind)) { css += r.css; seen.add(e.kind); }
    const b = c.box(e);
    const sc = typeof e.props.scrim === "number" ? Math.max(0, Math.min(0.95, e.props.scrim)) : 0; // LayoutRepair add-scrim: translucent paper-coloured backing UNDER the text, inside the entity (fades with it)
    const paper = c.profile.vars["--paper"] ?? (c.profile.dark ? "#09090B" : "#FFFFFF"), [pr, pg, pb] = hexToRgb(paper);
    const scrim = sc > 0 ? `<div class="scrim" data-scrim="${e.id}" style="position:absolute;inset:-20px -28px;border-radius:36px;background:rgba(${pr},${pg},${pb},${sc});z-index:-1"></div>` : "";
    body += `<div id="e_${e.id}" class="ent" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;container-type:size;z-index:${10 + Math.round((b.z + 1) * 10)}"><div id="p_${e.id}" class="par" style="position:absolute;inset:0"><div class="fl fl_${e.id}" style="position:absolute;inset:0">${scrim}${r.html}</div></div></div>`;
    js += r.js;
    // generic actions
    const first = acts.filter(a => a.type === "appear").sort((a, b2) => a.startFrame - b2.startFrame)[0];
    const t0 = first ? c.sec(first.startFrame) : 0;
    const to = { opacity: 1, x: 0, y: 0, scale: 1, rotationX: 0, skewX: 0, filter: "blur(0px)" };
    const persist = e.props.persistent === true && graph.scenes[0]?.id !== scene.id; // brand anchor stays on screen across cuts
    js += persist ? `tl.set('#e_${e.id}',${JSON.stringify(to)},0);` : `tl.fromTo('#e_${e.id}',${JSON.stringify(m.enterFrom)},{...${JSON.stringify(to)},duration:${m.enterDur},ease:'${m.enterEase}'},${t0 + (first ? 0 : i * m.stagger)});`;
    if (e.kind !== "kinetic_words") js += `tl.fromTo('.fl_${e.id}',{y:${-m.floatAmp}},{y:${m.floatAmp},duration:${m.floatPer},ease:'sine.inOut',yoyo:true,repeat:${Math.ceil(dur / m.floatPer)}},${(i * 0.37).toFixed(2)});`;
    for (const a of acts) {
      const ta = c.sec(a.startFrame), d = Math.max(.15, c.sec(a.endFrame) - ta);
      if (a.type === "disappear") js += `tl.to('#e_${e.id}',{opacity:0,scale:.9,filter:'blur(12px)',duration:${d},ease:'power2.in'},${ta});`;
      if ((a.type === "move" || a.type === "transform") && a.to) {
        const dx = ((a.to.x ?? 0) - (e.placement[graph.aspectRatio]!.x)) * stage.w, dy = ((a.to.y ?? 0) - (e.placement[graph.aspectRatio]!.y)) * stage.h;
        const sc = a.to.w ? a.to.w / e.placement[graph.aspectRatio]!.w : 1;
        js += `tl.to('#e_${e.id}',{x:${dx.toFixed(1)},y:${dy.toFixed(1)},scale:${sc.toFixed(3)},duration:${d},ease:'${a.ease === "spring" ? m.enterEase : "power3.inOut"}'},${ta});`;
      }
      if (a.type === "highlight") js += `tl.fromTo('#e_${e.id}',{scale:1},{scale:1.05,duration:${d / 2},yoyo:true,repeat:1,ease:'sine.inOut'},${ta});`;
      if (a.type === "click" && !["browser", "icon", "workflow"].includes(e.kind)) js += `tl.fromTo('#e_${e.id}',{scale:1},{scale:${m.press},duration:.1,yoyo:true,repeat:1},${ta});`;
      if (a.type === "connect" && e.kind !== "workflow" && a.targetEntityId) {
        const t = c.entities.get(a.targetEntityId)!; const s0 = center(e, c), z0 = center(t, c);
        const edge = (box: ReturnType<Ctx['box']>, from: {x:number;y:number}, to: {x:number;y:number}) => { const dx = to.x - from.x, dy = to.y - from.y; const k = Math.min(dx ? (box.w / 2) / Math.abs(dx) : 9, dy ? (box.h / 2) / Math.abs(dy) : 9); return { x: from.x + dx * Math.min(k, 1) , y: from.y + dy * Math.min(k, 1) }; };
        const s = edge(c.box(e), s0, z0), z = edge(c.box(t), z0, s0);
        const id = `bm_${a.id}`;
        body += `<svg class="beam" style="position:absolute;left:0;top:0;width:${c.W}px;height:${c.H}px;z-index:5;pointer-events:none"><defs><linearGradient id="g_${id}" gradientUnits="userSpaceOnUse" x1="${s.x}" y1="${s.y}" x2="${z.x}" y2="${z.y}"><stop offset="0" stop-color="var(--acc2)"/><stop offset="1" stop-color="var(--acc)"/></linearGradient></defs><line id="${id}" x1="${s.x}" y1="${s.y}" x2="${z.x}" y2="${z.y}" stroke="url(#g_${id})" stroke-width="8" stroke-linecap="butt" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100" style="filter:drop-shadow(0 0 14px var(--acc))"/><circle id="${id}_pk" r="12" fill="#fff" opacity="0" style="filter:drop-shadow(0 0 16px var(--acc))"/></svg>`;
        js += `tl.fromTo('#${id}',{strokeDashoffset:100},{strokeDashoffset:0,duration:${d},ease:'power2.out'},${ta});{const pk=document.querySelector('#${id}_pk'),o={v:0};tl.fromTo(o,{v:0},{v:1,duration:${d + .4},ease:'power1.inOut',onUpdate:()=>{pk.setAttribute('opacity',o.v>0&&o.v<1?1:0);pk.setAttribute('cx',${s.x}+(${z.x - s.x})*o.v);pk.setAttribute('cy',${s.y}+(${z.y - s.y})*o.v)}},${ta});}`;
      }
    }
  });
  if (p.id === 'liquid') js += `tl.fromTo('.ent .m-surf',{borderRadius:'90px 50px 80px 44px / 52px 84px 44px 76px'},{borderRadius:'50px 90px 44px 80px / 84px 46px 76px 50px',duration:2.6,ease:'sine.inOut',yoyo:true,repeat:${Math.ceil(dur / 2.6)}},0);`;
  // ---- camera (pan / tilt / zoom / focus + parallax + depth of field) ----
  const cx = stage.x + stage.w / 2, cy = stage.y + stage.h / 2;
  const keys = scene.camera;
  const pose = (k: typeof keys[number]) => {
    let zoom = k.zoom, x = k.pan.x * c.W * 0.15, y = k.pan.y * c.H * 0.1;
    if (k.focusTarget) { const t = c.entities.get(k.focusTarget)!; const q = center(t, c); zoom = 1 + (zoom - 1) * focusZoomBoost(graph.aspectRatio); const mx = (zoom - 1) * c.W / 2, my = (zoom - 1) * c.H / 2; x = Math.max(-mx, Math.min(mx, -(q.x - cx) * zoom * 0.5)); y = Math.max(-my, Math.min(my, -(q.y - cy) * zoom * 0.5)); }
    return { x: +x.toFixed(1), y: +y.toFixed(1), scale: +zoom.toFixed(3), rotationX: k.tilt };
  };
  keys.forEach((k, i) => {
    const t = c.sec(k.frame); const next = keys[i + 1]; const P = pose(k);
    if (i === 0) js += `tl.set('#cam',${JSON.stringify(P)},0);`;
    if (next) { const Q = pose(next); const d = c.sec(next.frame) - t; const ease = next.ease === "linear" ? "none" : next.ease === "ease_out" ? "power2.out" : "sine.inOut"; js += `tl.fromTo('#cam',${JSON.stringify(P)},{...${JSON.stringify(Q)},duration:${d},ease:'${ease}'},${t});`;
      for (const e of scene.entities) { const z = c.box(e).z; if (z) js += `tl.fromTo('#p_${e.id}',{x:${(-P.x * z * 0.4).toFixed(1)}},{x:${(-Q.x * z * 0.4).toFixed(1)},duration:${d},ease:'none'},${t});`; }
    }
    if (k.depthOfField?.enabled && k.depthOfField.focusEntityId) {
      const f = k.depthOfField.focusEntityId; const tt = t;
      for (const e of scene.entities) if (e.id !== f) js += `tl.to('#e_${e.id} .fl',{filter:'blur(${k.depthOfField.blurPx}px)',duration:.6,ease:'power2.out'},${tt});`;
      js += `tl.to('#e_${f} .fl',{filter:'blur(0px)',duration:.6},${tt});`;
    }
  });
  const runtime = fx && fx.impacts.length ? pulseRuntimeJs(fx.impacts, graph.fps, c.W, c.H) : null;
  const brand = graph.morphism === "brand" ? brandBackground(sceneMode(graph, scene), c.W, c.H, scene.startFrame / graph.fps, +(dur).toFixed(3), runtime ? { runtime } : undefined) : null;
  if (runtime) { // heroes (L1) get the same pulse as the backdrop; captions / logos / text / anchor are excluded so L2 stays razor-still
    const ids = scene.entities.filter(e => !PULSE_EXCLUDED_KINDS.has(e.kind)).map(e => `p_${e.id}`);
    const prelude = brand ? "" : runtime + "\n";
    if (ids.length) js += `{${prelude}const H=${JSON.stringify(ids)}.map(i=>document.getElementById(i)),st={t:0},S=${(scene.startFrame / graph.fps).toFixed(6)};tl.to(st,{t:${(+dur).toFixed(3)},duration:${(+dur).toFixed(3)},ease:'none',onUpdate(){const P=__pulse(S+st.t),v=P.dx.toFixed(3)+'px '+P.dy.toFixed(3)+'px';H.forEach(h=>{if(h)h.style.translate=v})}},0)}`;
  }
  if (brand) { css += brand.css; js = brand.js + js; }
  const html = `<template><style>${FONT_FACES}
*{margin:0;padding:0;box-sizing:border-box}
#root{position:absolute;inset:0;font-family:'InterX',sans-serif;font-weight:800;color:var(--ink);overflow:hidden;perspective:1600px}
#cam{position:absolute;inset:0;transform-origin:${cx}px ${cy}px;transform-style:preserve-3d}
.ent{position:absolute;opacity:0}
${profileCss(p)}${css}</style>
<div id="root" data-composition-id="${scene.id}" data-width="${c.W}" data-height="${c.H}">${brand ? brand.html : ""}<div id="cam">${body}</div></div>
<script>const tl=gsap.timeline({paused:true});
${TYPE_JS}
${PHYS_JS}
${js}
window.__timelines["${scene.id}"]=tl;</script></template>`;
  return { id: scene.id, html };
}

export function composeBackground(graph: SceneGraph): string {
  if (graph.morphism === "brand") return `<template><div id="root" data-composition-id="bg" data-width="${CANVAS[graph.aspectRatio].width}" data-height="${CANVAS[graph.aspectRatio].height}"></div><script>const tl=gsap.timeline({paused:true});window.__timelines["bg"]=tl;</script></template>`;
  const p: Profile = PROFILES[graph.morphism]; const { width: W, height: H } = CANVAS[graph.aspectRatio];
  const T = +(graph.durationFrames / graph.fps).toFixed(3); const b = p.bg(T);
  return `<template><style>${FONT_FACES}#root{position:absolute;inset:0;overflow:hidden}${b.css}</style><div id="root" data-composition-id="bg" data-width="${W}" data-height="${H}">${b.html}</div><script>const tl=gsap.timeline({paused:true});${b.js}window.__timelines["bg"]=tl;</script></template>`;
}
