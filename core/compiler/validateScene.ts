/**
 * Deterministic Scene Compiler / Validator.
 * Input: unknown JSON from the AI Director. Output: structured, LLM-readable repair errors.
 * Pure function (no clock / random / network). File existence is checked only if opts.projectRoot is given.
 */
import fs from "node:fs";
import path from "node:path";
import { SceneGraph, KIND_CAPABILITIES, type Entity, type Action, type Capability } from "../../schemas/scene.schema.js";

export type Severity = "error" | "warning";
export interface Issue {
  code: string; severity: Severity; path: string; message: string; repair: string;
}
export interface ValidationResult { ok: boolean; errors: Issue[]; warnings: Issue[]; graph?: SceneGraph; stats?: Record<string, number> }
export interface Options { projectRoot?: string; minSceneSeconds?: number; maxSceneSeconds?: number; frameToleranceWords?: number }

const E = (code: string, path: string, message: string, repair: string): Issue => ({ code, severity: "error", path, message, repair });
const W = (code: string, path: string, message: string, repair: string): Issue => ({ code, severity: "warning", path, message, repair });
const REQUIRES_TARGET: Capability[] = ["connect"];
const TYPING_KINDS = new Set(["terminal", "code_editor", "chat", "browser", "device", "ui_sim"]);
const GLYPHS = new Set(["code", "checkmark", "waveform", "bolt"]);

export function validateScene(input: unknown, opts: Options = {}): ValidationResult {
  const errors: Issue[] = []; const warnings: Issue[] = [];
  const parsed = SceneGraph.safeParse(input);
  if (!parsed.success) {
    for (const i of parsed.error.issues) {
      const p = i.path.join(".") || "(root)";
      errors.push(E("SCHEMA_" + i.code.toUpperCase(), p, i.message, `Fix the value at "${p}" so it satisfies the schema (${i.code}${"expected" in i ? `, expected ${(i as any).expected}` : ""}).`));
    }
    return { ok: false, errors, warnings };
  }
  const g = parsed.data;
  const minS = opts.minSceneSeconds ?? 3, maxS = opts.maxSceneSeconds ?? 14, tol = opts.frameToleranceWords ?? 3;

  // ---------- global ----------
  const assetIds = new Map(g.assets.map(a => [a.id, a]));
  if (assetIds.size !== g.assets.length) errors.push(E("ASSET_DUP", "assets", "Duplicate asset ids.", "Give every asset a unique id."));
  const voiceAsset = assetIds.get(g.voice.audioAssetId);
  if (!voiceAsset) errors.push(E("VOICE_ASSET_MISSING", "voice.audioAssetId", `Audio asset "${g.voice.audioAssetId}" not in assets[].`, "Register the voice-over file via entityResolver/wordAligner before directing."));
  else if (voiceAsset.kind !== "audio") errors.push(E("VOICE_ASSET_KIND", "voice.audioAssetId", "Voice asset must have kind 'audio'.", "Point voice.audioAssetId at an audio asset."));

  const words = g.voice.words;
  words.forEach((w, i) => {
    if (w.end < w.start) errors.push(E("WORD_RANGE", `voice.words.${i}`, `Word "${w.w}" ends before it starts.`, "Re-run wordAligner for this word."));
    if (i > 0 && w.start + 1e-6 < words[i - 1].start) errors.push(E("WORD_ORDER", `voice.words.${i}`, "Words are not monotonic in time.", "Sort words by start time."));
  });
  const lowConf = words.filter(w => w.conf < 0.5 && !w.repaired).length;
  if (lowConf) warnings.push(W("WORD_LOW_CONF", "voice.words", `${lowConf} words have confidence < 0.5 and were not repaired.`, "Run the low-confidence repair pass (numbers, tech terms, brands)."));

  if (opts.projectRoot) {
    g.assets.forEach((a, i) => {
      const f = path.resolve(opts.projectRoot!, a.path);
      if (!fs.existsSync(f)) errors.push(E("ASSET_FILE_MISSING", `assets.${i}.path`, `File not found: ${a.path}`, "Re-resolve the asset; zero broken images are allowed."));
    });
  }
  g.assets.forEach((a, i) => {
    if (!a.verified) errors.push(E("ASSET_UNVERIFIED", `assets.${i}`, `Asset "${a.id}" is not verified.`, "Only verified assets may be used. Re-run entityResolver."));
    if ((a.kind === "cutout" || a.kind === "logo" || a.kind === "icon") && a.hasAlpha === false) warnings.push(W("ASSET_NO_ALPHA", `assets.${i}`, `Asset "${a.id}" has no alpha channel.`, "Run cutout (rembg) or use an SVG/PNG with transparency."));
  });

  // ---------- scenes: coverage / overlap ----------
  const scenes = [...g.scenes];
  const sceneIds = new Set<string>();
  scenes.forEach((s, si) => {
    const sp = `scenes.${si}`;
    if (sceneIds.has(s.id)) errors.push(E("SCENE_DUP", sp + ".id", `Duplicate scene id "${s.id}".`, "Rename."));
    sceneIds.add(s.id);
    if (s.endFrame <= s.startFrame) errors.push(E("SCENE_RANGE", sp, "Scene endFrame must be > startFrame.", "Fix the frame range."));
    const sec = (s.endFrame - s.startFrame) / g.fps;
    if (sec < minS) warnings.push(W("SCENE_TOO_SHORT", sp, `Scene lasts ${sec.toFixed(1)}s (< ${minS}s). Looks like a forced cut.`, "Merge with a neighbour so the scene evolves continuously."));
    if (sec > maxS) warnings.push(W("SCENE_TOO_LONG", sp, `Scene lasts ${sec.toFixed(1)}s (> ${maxS}s).`, "Split at a narrative beat."));
    if (si === 0 && s.startFrame !== 0) errors.push(E("SCENE_START", sp, "First scene must start at frame 0.", "Set startFrame to 0."));
    if (si > 0) {
      const prev = scenes[si - 1];
      if (s.startFrame < prev.endFrame) errors.push(E("SCENE_OVERLAP", sp, `Overlaps previous scene by ${prev.endFrame - s.startFrame} frames.`, `Set startFrame to ${prev.endFrame}.`));
      if (s.startFrame > prev.endFrame) errors.push(E("SCENE_GAP", sp, `Gap of ${s.startFrame - prev.endFrame} frames before this scene.`, `Set startFrame to ${prev.endFrame} (or extend the previous scene).`));
    }
    if (s.endFrame > g.durationFrames) errors.push(E("SCENE_PAST_END", sp, "Scene ends after durationFrames.", "Clamp endFrame or raise durationFrames."));
    // ---------- entities ----------
    const ents = new Map<string, Entity>();
    s.entities.forEach((e, ei) => {
      const ep = `${sp}.entities.${ei}`;
      if (ents.has(e.id)) errors.push(E("ENTITY_DUP", ep + ".id", `Duplicate entity id "${e.id}" in scene.`, "Rename."));
      ents.set(e.id, e);
      const allowed = KIND_CAPABILITIES[e.kind];
      for (const c of e.capabilities) if (!allowed.includes(c)) errors.push(E("CAPABILITY_UNSUPPORTED", ep + ".capabilities", `Kind "${e.kind}" cannot "${c}".`, `Allowed for ${e.kind}: ${allowed.join(", ")}.`));
      if (!e.placement[g.aspectRatio]) errors.push(E("PLACEMENT_MISSING", ep + ".placement", `No placement for aspect ratio ${g.aspectRatio}.`, `Add placement["${g.aspectRatio}"] (adaptive layout, not a crop).`));
      if (e.assetId) {
        const a = assetIds.get(e.assetId);
        if (!a) errors.push(E("ASSET_MISSING", ep + ".assetId", `Asset "${e.assetId}" not in manifest.`, "Resolve this asset first or remove the reference."));
        else if (["logo", "cutout", "icon"].includes(e.kind) && !["logo", "cutout", "icon", "image"].includes(a.kind)) errors.push(E("ASSET_KIND", ep + ".assetId", `Asset "${a.id}" kind "${a.kind}" invalid for entity kind "${e.kind}".`, "Use an image-type asset."));
      } else if (["logo", "cutout"].includes(e.kind)) errors.push(E("ASSET_REQUIRED", ep, `Entity kind "${e.kind}" requires assetId.`, "Attach a verified asset."));
      if (e.kind === "particles" && e.seed === undefined) errors.push(E("SEED_REQUIRED", ep, "Particle entities need an integer seed (determinism).", "Add integer seed; never use Math.random."));
    });
    // ---------- semantic events & actions ----------
    const actionIds = new Set<string>();
    const perEntity: Record<string, Action[]> = {};
    s.semanticEvents.forEach((ev, vi) => {
      const vp = `${sp}.semanticEvents.${vi}`;
      if (ev.endFrame <= ev.startFrame) errors.push(E("EVENT_RANGE", vp, "Event endFrame must be > startFrame.", "Fix range."));
      if (ev.wordStart > ev.wordEnd || ev.wordEnd >= words.length) errors.push(E("EVENT_WORDS", vp, `Word range ${ev.wordStart}-${ev.wordEnd} invalid (voice has ${words.length} words).`, "Use valid word indices."));
      else {
        const ws = Math.round(words[ev.wordStart].start * g.fps), we = Math.round(words[ev.wordEnd].end * g.fps);
        if (Math.abs(ev.startFrame - ws) > tol) errors.push(E("EVENT_SYNC_START", vp, `startFrame ${ev.startFrame} not synced with word "${words[ev.wordStart].w}" (${ws}).`, `Set startFrame to ${ws}.`));
        if (Math.abs(ev.endFrame - we) > Math.max(tol, 12)) warnings.push(W("EVENT_SYNC_END", vp, `endFrame ${ev.endFrame} differs from word end (${we}).`, `Prefer endFrame ≈ ${we}.`));
      }
      if (ev.startFrame < s.startFrame || ev.endFrame > s.endFrame) errors.push(E("EVENT_OUTSIDE_SCENE", vp, "Event is outside its scene's frame range.", "Move the event into the scene or fix the scene range."));
      ev.actions.forEach((a, ai) => {
        const ap = `${vp}.actions.${ai}`;
        if (actionIds.has(a.id)) errors.push(E("ACTION_DUP", ap + ".id", `Duplicate action id "${a.id}".`, "Rename."));
        actionIds.add(a.id);
        const ent = ents.get(a.entityId);
        if (!ent) { errors.push(E("ACTION_ENTITY_MISSING", ap + ".entityId", `Entity "${a.entityId}" not in this scene.`, "Add the entity or fix id.")); return; }
        if (!ent.capabilities.includes(a.type)) errors.push(E("ACTION_CAPABILITY", ap + ".type", `Entity "${ent.id}" does not declare capability "${a.type}".`, `Declared: ${ent.capabilities.join(", ")}.`));
        if (!KIND_CAPABILITIES[ent.kind].includes(a.type)) errors.push(E("ACTION_KIND_UNSUPPORTED", ap + ".type", `Kind "${ent.kind}" cannot "${a.type}".`, `Choose one of: ${KIND_CAPABILITIES[ent.kind].join(", ")}.`));
        if (a.endFrame < a.startFrame) errors.push(E("ACTION_RANGE", ap, "Action endFrame < startFrame.", "Fix range."));
        if (a.startFrame < ev.startFrame - 6 || a.endFrame > ev.endFrame + 3 * g.fps) errors.push(E("ACTION_OUTSIDE_EVENT", ap, "Action drifts too far outside its semantic event.", "Keep actions within the narrated moment (≤3 s tail)."));
        if (a.startFrame < s.startFrame || a.endFrame > s.endFrame) errors.push(E("ACTION_OUTSIDE_SCENE", ap, "Action outside scene range.", "Clamp to scene."));
        if (REQUIRES_TARGET.includes(a.type)) {
          if (!a.targetEntityId) errors.push(E("ACTION_TARGET_REQUIRED", ap, `"${a.type}" requires targetEntityId.`, "Provide the entity to connect to."));
          else if (!ents.has(a.targetEntityId)) errors.push(E("ACTION_TARGET_MISSING", ap + ".targetEntityId", `Target "${a.targetEntityId}" not in scene.`, "Fix id."));
          else if (a.targetEntityId === a.entityId) errors.push(E("ACTION_TARGET_SELF", ap, "Cannot connect an entity to itself.", "Use a different target."));
        }
        if (a.type === "click" && a.targetEntityId && !ents.has(a.targetEntityId)) errors.push(E("ACTION_TARGET_MISSING", ap + ".targetEntityId", `Click target "${a.targetEntityId}" not in scene.`, "Fix id."));
        if (a.type === "type") {
          if (!a.text) errors.push(E("ACTION_TEXT_REQUIRED", ap, "type action requires text.", "Add text."));
          if (!TYPING_KINDS.has(ent.kind)) errors.push(E("ACTION_TYPE_KIND", ap, `Kind "${ent.kind}" cannot receive typing.`, "Type into terminal/code_editor/chat/browser."));
        }
        if (a.type === "morph" && !(a.text && GLYPHS.has(a.text))) errors.push(E("ACTION_MORPH_FACE", ap, "morph needs text in {code,checkmark,waveform,bolt}.", "Set text to one of the four face icons."));
        if (a.type === "step" && (a.value === undefined || a.value < 1)) errors.push(E("ACTION_STEP_INDEX", ap, "step needs value >= 1 (1-based step number).", "Add value."));
        if (a.type === "count" && a.value === undefined) errors.push(E("ACTION_VALUE_REQUIRED", ap, "count action requires value.", "Add value."));
        if ((a.type === "move" || a.type === "transform") && !a.to) warnings.push(W("ACTION_NO_TARGET_POSE", ap, `${a.type} without "to" does nothing.`, "Add a destination pose."));
        (perEntity[a.entityId] ||= []).push(a);
      });
    });
    // overlapping timings: same entity, same exclusive capability
    const EXCLUSIVE: Capability[] = ["move", "transform", "type", "follow_camera"];
    for (const [eid, list] of Object.entries(perEntity)) for (const cap of EXCLUSIVE) {
      const l = list.filter(a => a.type === cap).sort((x, y) => x.startFrame - y.startFrame);
      for (let i = 1; i < l.length; i++) if (l[i].startFrame < l[i - 1].endFrame) errors.push(E("ACTION_OVERLAP", `${sp}.entities.${eid}`, `"${cap}" actions "${l[i - 1].id}" and "${l[i].id}" overlap for entity "${eid}".`, `Start "${l[i].id}" at frame ${l[i - 1].endFrame} or later.`));
    }
    // appear must precede other actions
    for (const [eid, list] of Object.entries(perEntity)) {
      const ap = list.filter(a => a.type === "appear").sort((x, y) => x.startFrame - y.startFrame)[0];
      const first = list.filter(a => a.type !== "appear").sort((x, y) => x.startFrame - y.startFrame)[0];
      if (ap && first && first.startFrame < ap.startFrame) errors.push(E("ACTION_BEFORE_APPEAR", `${sp}.entities.${eid}`, `Entity "${eid}" acts (${first.id}) before it appears.`, "Move 'appear' earlier."));
    }
    // camera
    let lastCam = -1;
    s.camera.forEach((k, ki) => {
      const kp = `${sp}.camera.${ki}`;
      if (k.frame < s.startFrame || k.frame > s.endFrame) errors.push(E("CAMERA_OUTSIDE", kp, "Camera key outside scene.", "Clamp frame."));
      if (k.frame <= lastCam) errors.push(E("CAMERA_ORDER", kp, "Camera keyframes must be strictly increasing.", "Sort / dedupe keys."));
      lastCam = k.frame;
      if (k.focusTarget && !ents.has(k.focusTarget)) errors.push(E("CAMERA_FOCUS_MISSING", kp + ".focusTarget", `focusTarget "${k.focusTarget}" not in scene.`, "Fix id."));
      if (k.depthOfField?.enabled && k.depthOfField.focusEntityId && !ents.has(k.depthOfField.focusEntityId)) errors.push(E("DOF_FOCUS_MISSING", kp, "DOF focusEntityId not in scene.", "Fix id."));
    });
    if (s.camera[0].frame !== s.startFrame) warnings.push(W("CAMERA_NO_START_KEY", sp + ".camera.0", "First camera key is not at scene start.", `Add a key at frame ${s.startFrame}.`));
    // audio events
    s.audioEvents.forEach((a, ai) => {
      const ap = `${sp}.audioEvents.${ai}`;
      if (a.frame < s.startFrame || a.frame > s.endFrame) errors.push(E("AUDIO_OUTSIDE", ap, "Audio event outside scene.", "Clamp frame."));
      if (a.entityId && !ents.has(a.entityId)) errors.push(E("AUDIO_ENTITY_MISSING", ap + ".entityId", `Entity "${a.entityId}" not in scene.`, "Fix id."));
    });
  });
  const last = scenes[scenes.length - 1];
  if (last.endFrame !== g.durationFrames) errors.push(E("DURATION_MISMATCH", "durationFrames", `Last scene ends at ${last.endFrame}, durationFrames is ${g.durationFrames}.`, `Set durationFrames to ${last.endFrame}.`));
  const voiceEnd = Math.round(words[words.length - 1].end * g.fps);
  if (voiceEnd > g.durationFrames) errors.push(E("VOICE_PAST_END", "durationFrames", `Voice ends at frame ${voiceEnd} but video ends at ${g.durationFrames}.`, "Extend the last scene."));

  return { ok: errors.length === 0, errors, warnings, graph: g, stats: { scenes: g.scenes.length, entities: g.scenes.reduce((n, s) => n + s.entities.length, 0), events: g.scenes.reduce((n, s) => n + s.semanticEvents.length, 0), words: words.length } };
}

/** Compact repair prompt for the AI Director auto-repair loop. */
export function formatRepairPrompt(r: ValidationResult): string {
  return r.errors.map((e, i) => `${i + 1}. [${e.code}] at ${e.path}: ${e.message} -> ${e.repair}`).join("\n");
}
