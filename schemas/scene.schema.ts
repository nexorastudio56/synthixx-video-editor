/**
 * Scene Graph schema (v1). The AI Director only ever emits this JSON.
 * Everything is expressed in INTEGER GLOBAL FRAMES (globalTime = frame / fps)
 * so any chunk renderer reproduces identical state -> seamless parallel rendering.
 */
import { z } from "zod";
import { BrandThemeTokens } from "../styles/themeSchema.js";

export const AspectRatio = z.enum(["9:16", "16:9"]);
export const Morphism = z.enum(["glass", "clay", "neumorphism", "holo", "skeuomorphism", "liquid", "brand"]);

export const Capability = z.enum([
  "appear", "disappear", "move", "click", "type", "connect", "transform", "follow_camera",
  "highlight", "count", // extensions used by simulators
  "merge", "fan", "step", "morph", // brand archetype performances
]);
export type Capability = z.infer<typeof Capability>;

export const EntityKind = z.enum([
  "browser", "terminal", "code_editor", "chat", "workflow", "dashboard", // live interfaces
  "logo", "cutout", "icon", "device", "card", "text", "particles",        // stage objects
  "anchor_core", "orbital_hub", "card_deck", "roadmap", "kinetic_words", "ui_sim", // brand archetypes
]);
export type EntityKind = z.infer<typeof EntityKind>;

/** Which capabilities each entity kind can physically perform. Compiler enforces this. */
export const KIND_CAPABILITIES: Record<EntityKind, Capability[]> = {
  browser:     ["appear", "disappear", "move", "click", "type", "transform", "follow_camera", "highlight"],
  terminal:    ["appear", "disappear", "move", "type", "transform", "follow_camera", "highlight", "count"],
  code_editor: ["appear", "disappear", "move", "type", "transform", "follow_camera", "highlight"],
  chat:        ["appear", "disappear", "move", "type", "transform", "follow_camera", "highlight"],
  workflow:    ["appear", "disappear", "move", "connect", "click", "transform", "follow_camera", "highlight"],
  dashboard:   ["appear", "disappear", "move", "transform", "follow_camera", "highlight", "count"],
  logo:        ["appear", "disappear", "move", "connect", "transform", "follow_camera", "highlight"],
  cutout:      ["appear", "disappear", "move", "connect", "transform", "follow_camera"],
  icon:        ["appear", "disappear", "move", "click", "connect", "transform", "follow_camera", "highlight"],
  device:      ["appear", "disappear", "move", "click", "type", "transform", "follow_camera"],
  card:        ["appear", "disappear", "move", "transform", "follow_camera", "highlight", "count"],
  text:        ["appear", "disappear", "move", "transform", "highlight", "count"],
  particles:   ["appear", "disappear", "move", "transform"],
  anchor_core:   ["appear", "disappear", "morph", "highlight", "transform"],
  orbital_hub:   ["appear", "disappear", "merge", "highlight", "transform"],
  card_deck:     ["appear", "disappear", "fan", "click", "highlight", "transform"],
  roadmap:       ["appear", "disappear", "step", "highlight", "transform"],
  kinetic_words: ["appear", "disappear", "highlight"],
  ui_sim:        ["appear", "disappear", "type", "click", "count", "highlight", "transform"],
};

export const Archetype = z.enum([
  "process_simulation", "live_ui_action", "environmental_story", "split_comparison", "exploded_view",
  "kinetic_data", "network_graph", "timeline_journey", "before_after", "device_showcase",
  "terminal_run", "chat_conversation", "workflow_build", "metric_reveal", "hero_object",
  "notification_cascade", "orbit_system",
]);
export type Archetype = z.infer<typeof Archetype>;

/** Normalised stage rectangle: 0..1 of the safe stage for that aspect ratio. z = depth layer (parallax). */
export const Rect = z.object({
  x: z.number().min(0).max(1), y: z.number().min(0).max(1),
  w: z.number().min(0.02).max(1), h: z.number().min(0.02).max(1),
  z: z.number().min(-1).max(1).default(0),
});
export type Rect = z.infer<typeof Rect>;

/** Adaptive composition: each entity declares a placement per aspect ratio (not a crop). */
export const Placement = z.object({ "9:16": Rect.optional(), "16:9": Rect.optional() });

const Frame = z.number().int().nonnegative();
const Id = z.string().regex(/^[a-z][a-z0-9_]{1,47}$/, "id must be snake_case, 2-48 chars");

export const Entity = z.object({
  id: Id,
  kind: EntityKind,
  label: z.string().max(60).optional(),
  capabilities: z.array(Capability).min(1),
  assetId: Id.optional(),
  placement: Placement,
  props: z.record(z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])).default({}),
  seed: z.number().int().optional(), // required for kind "particles" (determinism)
});
export type Entity = z.infer<typeof Entity>;

export const Action = z.object({
  id: Id,
  entityId: Id,
  type: Capability,
  startFrame: Frame,
  endFrame: Frame,
  targetEntityId: Id.optional(),                      // connect / click / move-to
  to: Rect.partial().optional(),                      // move / transform destination
  text: z.string().max(400).optional(),               // type
  value: z.number().optional(),                       // count target
  ease: z.enum(["linear", "ease_in_out", "ease_out", "spring", "steps"]).default("ease_in_out"),
});
export type Action = z.infer<typeof Action>;

/** Word-synced event: ties narration words to the actions that literally perform them. */
export const SemanticEvent = z.object({
  id: Id,
  wordStart: z.number().int().nonnegative(),          // index into voice.words
  wordEnd: z.number().int().nonnegative(),
  startFrame: Frame, endFrame: Frame,                 // must match word timestamps (compiler checks)
  intent: z.string().max(160),                        // e.g. "agent opens browser"
  actions: z.array(Action).min(1),
});
export type SemanticEvent = z.infer<typeof SemanticEvent>;

export const CameraKey = z.object({
  frame: Frame,
  pan: z.object({ x: z.number().min(-1).max(1), y: z.number().min(-1).max(1) }).default({ x: 0, y: 0 }),
  tilt: z.number().min(-30).max(30).default(0),       // degrees
  zoom: z.number().min(0.6).max(2.5).default(1),
  focusTarget: Id.optional(),
  depthOfField: z.object({ enabled: z.boolean(), focusEntityId: Id.optional(), blurPx: z.number().min(0).max(12).default(4) }).optional(),
  ease: z.enum(["linear", "ease_in_out", "ease_out"]).default("ease_in_out"),
});
export type CameraKey = z.infer<typeof CameraKey>;

export const SfxName = z.enum(["click", "type", "whoosh", "impact", "notify", "pop", "tick", "switch", "swoosh_up", "riser"]);
export const AudioEvent = z.object({
  id: Id, frame: Frame, sfx: SfxName, gain: z.number().min(0).max(1).default(0.6), entityId: Id.optional(),
});
export type AudioEvent = z.infer<typeof AudioEvent>;

export const AssetRecord = z.object({
  id: Id,
  kind: z.enum(["logo", "image", "icon", "cutout", "portrait", "audio", "font"]),
  path: z.string().min(1),                            // relative to project root
  source: z.string().min(1),                          // origin: "simple-icons", "user", "kokoro", "rembg:<src>" ...
  verified: z.boolean(),                              // entityResolver sets true only after file + decode check
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  hasAlpha: z.boolean().optional(),
  sha256: z.string().length(64).optional(),
});
export type AssetRecord = z.infer<typeof AssetRecord>;

export const Word = z.object({
  w: z.string().min(1), start: z.number().nonnegative(), end: z.number().nonnegative(),
  conf: z.number().min(0).max(1).default(1), repaired: z.boolean().optional(),
});
export type Word = z.infer<typeof Word>;

export const VideoScene = z.object({
  id: Id,
  archetype: Archetype,
  startFrame: Frame, endFrame: Frame,                 // contiguous with neighbours, no gaps
  title: z.string().max(80).optional(),
  entities: z.array(Entity).min(1),
  semanticEvents: z.array(SemanticEvent).min(1),
  camera: z.array(CameraKey).min(1),
  audioEvents: z.array(AudioEvent).default([]),
  theme: z.enum(["canvas_light", "canvas_dark"]).optional(), // brand morphism: alternating dual-mode canvas
  typeScale: z.number().min(0.6).max(1).default(1),             // self-QA auto-adjust: shrinks content boxes (and therefore type) about the stage centre
});
export type VideoScene = z.infer<typeof VideoScene>;

export const SceneGraph = z.object({
  schemaVersion: z.literal(1),
  title: z.string().max(120),
  fps: z.union([z.literal(24), z.literal(30), z.literal(60)]),
  aspectRatio: AspectRatio,
  morphism: Morphism,
  durationFrames: z.number().int().positive(),
  voice: z.object({ audioAssetId: Id, words: z.array(Word).min(1) }),
  assets: z.array(AssetRecord).default([]),
  scenes: z.array(VideoScene).min(1),
  theme: BrandThemeTokens.optional(),                 // multi-tenant style: any BrandThemeTokens drives the brand morphism (absent = neutral fallback palette)
});
export type SceneGraph = z.infer<typeof SceneGraph>;

export const CANVAS: Record<z.infer<typeof AspectRatio>, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
};
export const toFrame = (sec: number, fps: number) => Math.round(sec * fps);
