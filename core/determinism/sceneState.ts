/**
 * Pure scene-state evaluator: state(graph, globalFrame) depends on nothing but its arguments. Used by the renderer, and by the Phase-0 test that
 * proves random-access seeking is bit-identical to sequential playback.
 */
import type { SceneGraph, Action, CameraKey } from "../../schemas/scene.schema.js";
import { assertFps, evaluateSpring, intervalIndexAt, type Fps } from "./timelineClock.js";
import { rand3 } from "./counterRng.js";

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const easeOut = (p: number) => 1 - Math.pow(1 - p, 3);

export function easeProgress(kind: Action["ease"] | CameraKey["ease"], p: number, durSec: number): number {
  const x = clamp01(p);
  switch (kind) {
    case "linear": return x;
    case "ease_out": return easeOut(x);
    case "steps": return Math.floor(x * 12) / 12;
    case "spring": return evaluateSpring(x * durSec, 150, 15, 1).position; // stiffness 150 / damping 15 / mass 1: analytic, seekable
    default: return easeInOut(x);
  }
}
export interface ActionState { readonly id: string; readonly entityId: string; readonly type: string; readonly progress: number }
export interface CameraPose { readonly panX: number; readonly panY: number; readonly tilt: number; readonly zoom: number }
export interface ParticleState { readonly x: number; readonly y: number; readonly a: number }
export interface FrameState {
  readonly frame: number; readonly t: number; readonly sceneIndex: number; readonly sceneId: string; readonly localFrame: number;
  readonly camera: CameraPose; readonly actions: readonly ActionState[]; readonly particles: readonly ParticleState[];
}

export function cameraAt(keys: readonly CameraKey[], frame: number, fps: Fps): CameraPose {
  if (!keys.length) return { panX: 0, panY: 0, tilt: 0, zoom: 1 };
  if (frame <= keys[0].frame) return { panX: keys[0].pan.x, panY: keys[0].pan.y, tilt: keys[0].tilt, zoom: keys[0].zoom };
  const last = keys[keys.length - 1];
  if (frame >= last.frame) return { panX: last.pan.x, panY: last.pan.y, tilt: last.tilt, zoom: last.zoom };
  let i = 0; while (i < keys.length - 1 && frame >= keys[i + 1].frame) i++;
  const a = keys[i], b = keys[i + 1], p = easeProgress(b.ease, (frame - a.frame) / (b.frame - a.frame), (b.frame - a.frame) / fps), l = (u: number, v: number) => u + (v - u) * p;
  return { panX: l(a.pan.x, b.pan.x), panY: l(a.pan.y, b.pan.y), tilt: l(a.tilt, b.tilt), zoom: l(a.zoom, b.zoom) };
}

/** Counter-RNG dust/particle field: particle i at frame f is rand3-derived, so there is no per-frame state to replay. */
export function particlesAt(seed: number, frame: number, fps: Fps, count: number): ParticleState[] {
  const t = frame / fps; const out: ParticleState[] = [];
  for (let i = 0; i < count; i++) {
    const x0 = rand3(seed, i, 0), y0 = rand3(seed, i, 1), v = 0.02 + 0.05 * rand3(seed, i, 2), ph = 6.283185307179586 * rand3(seed, i, 3);
    out.push({ x: (x0 + 0.03 * Math.sin(t * 0.6 + ph) + 1) % 1, y: (((y0 - v * t) % 1) + 1) % 1, a: 0.15 + 0.35 * rand3(seed, i, 4) });
  }
  return out;
}

export function evaluateFrameState(graph: SceneGraph, frame: number, particleCount = 12): FrameState {
  const fps = assertFps(graph.fps);
  if (!Number.isInteger(frame) || frame < 0 || frame >= graph.durationFrames) throw new RangeError(`frame ${frame} outside [0,${graph.durationFrames})`);
  const si = intervalIndexAt(graph.scenes, frame); if (si < 0) throw new RangeError(`no scene covers frame ${frame}`);
  const scene = graph.scenes[si]; const actions: ActionState[] = [];
  for (const ev of scene.semanticEvents) for (const a of ev.actions) {
    const dur = a.endFrame - a.startFrame; const raw = frame < a.startFrame ? 0 : frame >= a.endFrame ? 1 : (frame - a.startFrame) / dur;
    actions.push({ id: a.id, entityId: a.entityId, type: a.type, progress: easeProgress(a.ease, raw, dur / fps) });
  }
  return { frame, t: frame / fps, sceneIndex: si, sceneId: scene.id, localFrame: frame - scene.startFrame, camera: cameraAt(scene.camera, frame, fps), actions, particles: particlesAt(graph.durationFrames * 31 + si, frame, fps, particleCount) };
}
