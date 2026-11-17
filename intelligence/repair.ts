/** Deterministic auto-repair: structural normalisation + code-driven fixes for validator issues. No randomness. */
import { KIND_CAPABILITIES } from "../schemas/scene.schema.js";
import type { Issue } from "../core/compiler/validateScene.js";
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
type J = any;

/** Normalise everything that can be derived: scene contiguity, event/action/camera/audio bounds, ordering. */
export function normalize(g: J, fps = g.fps): J {
  const words: J[] = g.voice.words; const F = (t: number) => Math.round(t * fps);
  g.scenes.sort((a: J, b: J) => a.startFrame - b.startFrame);
  g.scenes.forEach((s: J, i: number) => { s.startFrame = i === 0 ? 0 : g.scenes[i - 1].endFrame; if (i === g.scenes.length - 1) s.endFrame = g.durationFrames; if (s.endFrame <= s.startFrame + 1) s.endFrame = s.startFrame + 24; });
  for (const s of g.scenes) {
    const ids = new Set(s.entities.map((e: J) => e.id));
    for (const ev of s.semanticEvents) {
      ev.wordStart = clamp(ev.wordStart, 0, words.length - 1); ev.wordEnd = clamp(ev.wordEnd, ev.wordStart, words.length - 1);
      ev.startFrame = clamp(F(words[ev.wordStart].start), s.startFrame, s.endFrame - 2);
      ev.endFrame = clamp(Math.max(F(words[ev.wordEnd].end), ev.startFrame + 6), ev.startFrame + 1, s.endFrame - 1);
      ev.actions = ev.actions.filter((a: J) => ids.has(a.entityId) && !(a.targetEntityId && !ids.has(a.targetEntityId)));
      for (const a of ev.actions) { a.startFrame = clamp(a.startFrame, ev.startFrame, ev.endFrame - 1); a.endFrame = clamp(Math.max(a.endFrame, a.startFrame + 1), a.startFrame + 1, ev.endFrame); }
    }
    s.camera.forEach((k: J) => { k.frame = clamp(k.frame, s.startFrame, s.endFrame - 1); }); s.camera.sort((a: J, b: J) => a.frame - b.frame);
    s.audioEvents = s.audioEvents.filter((a: J) => a.frame >= s.startFrame && a.frame < s.endFrame && (!a.entityId || ids.has(a.entityId)));
  }
  return g;
}

/** Issue-code specific repairs, applied after normalize. Returns number of edits. */
export function applyRepairs(g: J, issues: Issue[]): number {
  let n = 0; const seen = new Set<string>();
  for (const i of issues) {
    const m = /scenes\.(\d+)(?:\.semanticEvents\.(\d+))?(?:\.actions\.(\d+))?/.exec(i.path); if (!m) continue;
    const s = g.scenes[+m[1]]; if (!s) continue; const ev = m[2] !== undefined ? s.semanticEvents[+m[2]] : undefined;
    const key = i.code + i.path; if (seen.has(key)) continue; seen.add(key);
    if (i.code === "ACTION_TARGET_REQUIRED" && ev && m[3] !== undefined) { const a = ev.actions[+m[3]]; const t = s.entities.find((e: J) => e.id !== a.entityId && !["logo", "icon"].includes(e.kind)) ?? s.entities.find((e: J) => e.id !== a.entityId); if (t) { a.targetEntityId = t.id; n++; continue; } }
    if (i.code === "ACTION_CAPABILITY" && ev && m[3] !== undefined) { const a = ev.actions[+m[3]]; const e = s.entities.find((x: J) => x.id === a.entityId); if (e && KIND_CAPABILITIES[e.kind as keyof typeof KIND_CAPABILITIES]?.includes(a.type)) { e.capabilities.push(a.type); n++; continue; } }
    if (/^ACTION_(TARGET|TYPE_KIND|KIND_UNSUPPORTED|CAPABILITY|DUP|ENTITY_MISSING|TEXT_REQUIRED|VALUE_REQUIRED)/.test(i.code) && ev && m[3] !== undefined) { (ev.actions[+m[3]] as J).__drop = true; n++; }
    if (i.code === "ACTION_OVERLAP" && ev && m[3] !== undefined) { (ev.actions[+m[3]] as J).__drop = true; n++; }
    if (i.code === "ACTION_BEFORE_APPEAR" && ev && m[3] !== undefined) { const a = ev.actions[+m[3]]; ev.actions.unshift({ id: `fix_${a.id}`, entityId: a.entityId, type: "appear", startFrame: ev.startFrame, endFrame: Math.min(ev.startFrame + 8, a.startFrame > ev.startFrame + 8 ? a.startFrame : ev.startFrame + 8), ease: "ease_out" }); a.startFrame = Math.max(a.startFrame, ev.startFrame + 8); a.endFrame = Math.max(a.endFrame, a.startFrame + 1); n++; }
    if (i.code === "SEED_REQUIRED") { for (const e of s.entities) if (e.kind === "particles" && e.seed === undefined) { e.seed = 1337; n++; } }
    if (/^(ASSET_MISSING|ASSET_REQUIRED|ASSET_UNVERIFIED|ASSET_KIND|ASSET_FILE_MISSING)/.test(i.code)) { for (const e of s.entities) if (e.assetId && !g.assets.some((a: J) => a.id === e.assetId && a.verified)) { e.kind = "icon"; e.props = { ...(e.props ?? {}), glyph: (e.label ?? "•")[0].toUpperCase() }; delete e.assetId; n++; } }
    if (i.code === "CAMERA_FOCUS_MISSING" || i.code === "DOF_FOCUS_MISSING") { for (const k of s.camera) { delete k.focusTarget; if (k.depthOfField) delete k.depthOfField; } n++; }
    if (i.code === "PLACEMENT_MISSING") { const e = s.entities.find((x: J) => i.path.includes(x.id)) ?? s.entities[0]; e.placement = { ...(e.placement ?? {}), [g.aspectRatio]: { x: .03, y: .2, w: .94, h: .5, z: 0 } }; n++; }
  }
  for (const s of g.scenes) { for (const ev of s.semanticEvents) ev.actions = ev.actions.filter((a: J) => !a.__drop); s.semanticEvents = s.semanticEvents.filter((ev: J) => ev.actions.length); }
  return n;
}

/** Last resort: one calm, always-valid scene per ~7 s: key-phrase text card + gentle push-in. */
export function safeFallback(g: J): J {
  const fps = g.fps, words: J[] = g.voice.words; const F = (t: number) => Math.round(t * fps);
  const per = Math.max(1, Math.ceil(words.length / Math.max(1, Math.round(g.durationFrames / fps / 7)))); const scenes: J[] = [];
  for (let i = 0, n = 0; i < words.length; i += per, n++) {
    const a = i, b = Math.min(words.length - 1, i + per - 1); const sF = scenes.length ? scenes[scenes.length - 1].endFrame : 0;
    const eF = b === words.length - 1 ? g.durationFrames : Math.max(sF + 30, F(words[b + 1].start) - 4);
    const id = `safe_card_${n}`;
    scenes.push({ id: `scene_${String(n + 1).padStart(2, "0")}`, archetype: "hero_object", startFrame: sF, endFrame: eF, title: "safe fallback",
      entities: [{ id, kind: "text", label: words.slice(a, Math.min(b, a + 5) + 1).map(w => w.w).join(" "), capabilities: ["appear"], placement: { [g.aspectRatio]: { x: .06, y: .3, w: .88, h: .3, z: 0 } }, props: {} }],
      semanticEvents: [{ id: `ev_${n}`, wordStart: a, wordEnd: b, startFrame: sF, endFrame: eF - 1, intent: "safe fallback card", actions: [{ id: `a_${n}`, entityId: id, type: "appear", startFrame: sF + 1, endFrame: sF + 13, ease: "spring" }] }],
      camera: [{ frame: sF, pan: { x: 0, y: 0 }, tilt: 0, zoom: 1, ease: "ease_in_out" }, { frame: eF - 1, pan: { x: 0, y: 0 }, tilt: 0, zoom: 1.06, ease: "ease_in_out" }], audioEvents: [] });
  }
  g.scenes = scenes; return normalize(g);
}
