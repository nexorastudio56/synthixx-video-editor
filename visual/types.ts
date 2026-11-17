import type { Entity, Action, SceneGraph } from "../schemas/scene.schema.js";
import type { Profile } from "./materials/morphismProfiles.js";

export interface PxBox { x: number; y: number; w: number; h: number; z: number }
export interface Ctx {
  graph: SceneGraph; fps: number; W: number; H: number; portrait: boolean;
  profile: Profile; sceneStartFrame: number;
  /** scene-local seconds for a GLOBAL frame: the only time conversion allowed (determinism) */
  sec: (globalFrame: number) => number;
  box: (e: Entity) => PxBox;
  assetPath: (id?: string) => string | undefined;
  entities: Map<string, Entity>;
}
export interface Rendered { html: string; css?: string; js: string }
export interface Component {
  kind: string[];
  render(e: Entity, actions: Action[], c: Ctx): Rendered;
}
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const jsStr = (s: string) => JSON.stringify(s);
export const byType = (a: Action[], t: string) => a.filter(x => x.type === t).sort((p, q) => p.startFrame - q.startFrame);
/** deterministic PRNG (seeded): the ONLY randomness allowed in visuals */
export function mulberry32(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
