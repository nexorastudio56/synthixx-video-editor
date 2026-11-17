/** Adaptive 9:16 / 16:9 layout: stage rect + type scale differ per aspect (reframe, never crop). */
import { CANVAS, type Entity, type SceneGraph } from "../schemas/scene.schema.js";
import type { PxBox } from "./types.js";
export interface Stage { x: number; y: number; w: number; h: number; capY: number; capH: number }
export function stageFor(aspect: "9:16" | "16:9"): Stage {
  if (aspect === "9:16") return { x: 72, y: 270, w: 936, h: 1050, capY: 1380, capH: 260 };   // nothing in top 168, captions below
  return { x: 110, y: 90, w: 1700, h: 740, capY: 880, capH: 160 };
}
export function boxFor(e: Entity, g: SceneGraph, typeScale = 1): PxBox {
  const r = e.placement[g.aspectRatio]!; const s = stageFor(g.aspectRatio);
  let x = s.x + r.x * s.w, y = s.y + r.y * s.h, w = r.w * s.w, h = r.h * s.h;
  if (typeScale < 1) { const cx = s.x + s.w / 2, cy = s.y + s.h / 2; x = cx + (x - cx) * typeScale; y = cy + (y - cy) * typeScale; w *= typeScale; h *= typeScale; } // self-QA: shrink about stage centre (type scales with the box)
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), z: r.z ?? 0 };
}
/** typography scale factor so text keeps a constant physical size on both canvases */
export const typeScale = (aspect: "9:16" | "16:9") => (aspect === "9:16" ? 1 : 0.92);
/** camera reframing: how strongly a focus target is zoomed depends on aspect (portrait needs tighter framing) */
export const focusZoomBoost = (aspect: "9:16" | "16:9") => (aspect === "9:16" ? 1.12 : 1.0);
export const canvas = (a: "9:16" | "16:9") => CANVAS[a];
