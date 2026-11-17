/**
 * Offline Rapier physics baker. Fixed 120 Hz solver (dt = 1/120, integer ticks per output frame: 120/fps = 4 @30fps, 2 @60fps).
 * Output: frame-indexed [x,y,z,qx,qy,qz,qw] per body, cached as projects/bakes/<hash>.json.
 * Units: 100 px = 1 m. Origin = bottom-left of the canvas, +y up (screenToWorld/worldToScreen helpers below). Bodies are locked to the xy plane (z is a fixed parallax layer).
 * Text Safe-Zone Shield: every 120 Hz tick each body's exact oriented box is tested (SAT) against LayoutDNA text rectangles. Violations trigger an automatic re-bake with an
 * escalating ladder: (1) spawn columns avoid the text; (2) repulsor force + sideways spawn impulse; (3) rigid shield colliders over the text rectangles. Max 6 attempts, else throws.
 */
import RAPIER from "@dimforge/rapier3d-compat";
import { createHash } from "node:crypto";
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { rand3 } from "../core/determinism/counterRng.js";
import { assertFps, type Fps } from "../core/determinism/timelineClock.js";
import { stableStringify } from "../styles/themeCompiler.js";

export const BAKER_VERSION = "bake-1";
export const SOLVER_HZ = 120;
export const PX_PER_M = 100;
export interface SafeZone { readonly id: string; readonly x: number; readonly y: number; readonly w: number; readonly h: number } // px, y down
export interface LayoutDNA { readonly width: number; readonly height: number; readonly fps: Fps; readonly safeZones: readonly SafeZone[] }
export interface BodySpec { readonly id: string; readonly kind: "icon" | "card"; readonly sizePx: number }
export interface BakeRequest {
  readonly layout: LayoutDNA; readonly durationFrames: number; readonly seed: number; readonly bodyCount?: number; readonly bodies?: readonly BodySpec[];
  readonly gravity?: number; readonly restitution?: number; readonly friction?: number; readonly floorMarginPx?: number; readonly zoneMarginPx?: number; readonly cacheDir?: string; readonly useCache?: boolean; readonly forceAttempt?: number;
}
export interface AttemptReport { readonly attempt: number; readonly strategy: "baseline" | "avoid-spawn" | "repulsor" | "rigid-shield"; readonly repulsorN: number; readonly violations: number; readonly firstViolation?: { readonly body: string; readonly tick: number; readonly zone: string } }
export type Pose = readonly [number, number, number, number, number, number, number];
export interface BakeResult {
  readonly hash: string; readonly trajectoryHash: string; readonly bodies: readonly BodySpec[]; readonly fps: Fps; readonly durationFrames: number; readonly ticksPerFrame: number;
  readonly frames: readonly (readonly Pose[])[]; readonly attempts: readonly AttemptReport[]; readonly collisions: number; readonly file?: string; readonly fromCache: boolean;
}
export const screenToWorld = (px: number, py: number, H: number): [number, number] => [px / PX_PER_M, (H - py) / PX_PER_M];
export const worldToScreen = (x: number, y: number, H: number): [number, number] => [x * PX_PER_M, H - y * PX_PER_M];

let ready: Promise<void> | null = null;
const initRapier = (): Promise<void> => (ready ??= RAPIER.init());

export function bodiesFor(seed: number, n: number): BodySpec[] {
  if (n < 8 || n > 12) throw new RangeError("bodyCount must be 8..12");
  return Array.from({ length: n }, (_, i) => { const card = i % 4 === 3; return { id: `${card ? "card" : "icon"}_${String(i).padStart(2, "0")}`, kind: card ? "card" : "icon", sizePx: Math.round((card ? 150 : 96) + 30 * rand3(seed, i, 11)) } as BodySpec; });
}
const dims = (b: BodySpec): [number, number] => (b.kind === "card" ? [Math.round(b.sizePx * 1.5), b.sizePx] : [b.sizePx, b.sizePx]);

/** Exact oriented-box vs axis-aligned-rect overlap (SAT). Returns penetration depth (>0 = overlap). All in px, y-down screen space. */
export function obbRectPenetration(cx: number, cy: number, hw: number, hh: number, angle: number, z: SafeZone, margin: number): number {
  const c = Math.cos(angle), s = Math.sin(angle); const zx = z.x - margin + (z.w + 2 * margin) / 2, zy = z.y - margin + (z.h + 2 * margin) / 2, zhw = z.w / 2 + margin, zhh = z.h / 2 + margin;
  const dx = zx - cx, dy = zy - cy; const axes: [number, number][] = [[1, 0], [0, 1], [c, s], [-s, c]]; let minPen = Infinity;
  for (const [ax, ay] of axes) {
    const rB = hw * Math.abs(c * ax + s * ay) + hh * Math.abs(-s * ax + c * ay), rZ = zhw * Math.abs(ax) + zhh * Math.abs(ay), dist = Math.abs(dx * ax + dy * ay), pen = rB + rZ - dist;
    if (pen <= 0) return 0; if (pen < minPen) minPen = pen;
  }
  return minPen;
}

function freeCorridors(width: number, zones: readonly SafeZone[], pad: number): [number, number][] {
  const blocked = zones.map(z => [z.x - pad, z.x + z.w + pad] as [number, number]).sort((a, b) => a[0] - b[0]); const out: [number, number][] = []; let cur = 0;
  for (const [a, b] of blocked) { if (a > cur) out.push([cur, Math.min(a, width)]); cur = Math.max(cur, b); } if (cur < width) out.push([cur, width]); return out.filter(([a, b]) => b - a > 24);
}
const STRATEGY: AttemptReport["strategy"][] = ["baseline", "avoid-spawn", "repulsor", "repulsor", "rigid-shield", "rigid-shield"];

interface RunOut { frames: Pose[][]; violations: number; first?: AttemptReport["firstViolation"] }
function simulate(req: BakeRequest, bodies: readonly BodySpec[], attempt: number): RunOut {
  const { layout } = req; const fps = assertFps(layout.fps); const tpf = SOLVER_HZ / fps; const H = layout.height, W = layout.width;
  const strat = STRATEGY[Math.min(attempt, STRATEGY.length - 1)], repulsorN = strat === "repulsor" ? 90 * (attempt - 1) : strat === "rigid-shield" ? 240 : 0;
  const world = new RAPIER.World({ x: 0, y: -(req.gravity ?? 9.81), z: 0 }); world.timestep = 1 / SOLVER_HZ;
  const floorY = (H - (req.floorMarginPx ?? 70)) , m = req.zoneMarginPx ?? 6;
  const stat = (hx: number, hy: number, x: number, y: number, rest = 0.3): void => { const b = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, 0)); world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, 0.5).setRestitution(rest).setFriction(0.8), b); };
  { const [fx, fy] = screenToWorld(W / 2, floorY + 50, H); stat(W / PX_PER_M, 0.5, fx, fy); } // floor (top surface at floorY)
  { const [lx, ly] = screenToWorld(-50, H / 2, H); stat(0.5, H / PX_PER_M * 4, lx, ly + 20); const [rx, ry] = screenToWorld(W + 50, H / 2, H); stat(0.5, H / PX_PER_M * 4, rx, ry + 20); } // side walls
  if (strat === "rigid-shield") for (const z of req.layout.safeZones) { const [zx, zy] = screenToWorld(z.x + z.w / 2, z.y + z.h / 2, H); stat((z.w / 2 + m) / PX_PER_M, (z.h / 2 + m) / PX_PER_M, zx, zy, 0.15); }
  const corr = strat === "baseline" ? ([[40, W - 40]] as [number, number][]) : freeCorridors(W, req.layout.safeZones, 60); const corrs = corr.length ? corr : ([[40, W - 40]] as [number, number][]);
  const total = corrs.reduce((a, [l, r]) => a + (r - l), 0); const handles: RAPIER.RigidBody[] = [];
  bodies.forEach((b, i) => {
    const [w, h] = dims(b); let u = rand3(req.seed, i, 1) * total, x = corrs[0][0];
    for (const [l, r] of corrs) { if (u <= r - l) { x = l + u; break; } u -= r - l; }
    x = Math.min(Math.max(x, w / 2 + 8), W - w / 2 - 8);
    const y = -(h / 2) - 60 - i * (h * 0.9 + 30) - 200 * rand3(req.seed, i, 2); const [wx, wy] = screenToWorld(x, y, H);
    const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(wx, wy, 0).setRotation({ x: 0, y: 0, z: Math.sin((rand3(req.seed, i, 3) - 0.5) * 0.6), w: Math.cos((rand3(req.seed, i, 3) - 0.5) * 0.6) }).enabledTranslations(true, true, false).enabledRotations(false, false, true).setLinearDamping(0.05).setAngularDamping(0.3).setCanSleep(false);
    const body = world.createRigidBody(desc); const r = Math.min(w, h) * 0.12 / PX_PER_M;
    world.createCollider(RAPIER.ColliderDesc.roundCuboid(Math.max(0.01, w / 2 / PX_PER_M - r), Math.max(0.01, h / 2 / PX_PER_M - r), 0.04, r).setRestitution(req.restitution ?? 0.35).setFriction(req.friction ?? 0.6).setDensity(1), body);
    body.setAngvel({ x: 0, y: 0, z: (rand3(req.seed, i, 4) - 0.5) * 2.4 }, true);
    const side = strat === "repulsor" ? ((): number => { const z = req.layout.safeZones[0]; return z ? (x < z.x + z.w / 2 ? -1 : 1) : 0; })() : 0; body.setLinvel({ x: (rand3(req.seed, i, 5) - 0.5) * 0.8 + side * 0.4 * (attempt - 1), y: 0, z: 0 }, true);
    handles.push(body);
  });
  const frames: Pose[][] = []; let violations = 0; let first: AttemptReport["firstViolation"];
  const pose = (b: RAPIER.RigidBody, i: number): Pose => { const p = b.translation(), q = b.rotation(), R = (v: number): number => Math.round(v * 1e6) / 1e6 + 0; return [R(p.x), R(p.y), R(0.15 * (i % 3)), R(q.x), R(q.y), R(q.z), R(q.w)]; };
  const check = (tick: number): void => {
    handles.forEach((b, i) => { const p = b.translation(), q = b.rotation(), [sx, sy] = worldToScreen(p.x, p.y, H), ang = -2 * Math.atan2(q.z, q.w), [w, h] = dims(bodies[i]);
      for (const z of req.layout.safeZones) if (obbRectPenetration(sx, sy, w / 2, h / 2, ang, z, 0) > 0.75) { violations++; first ??= { body: bodies[i].id, tick, zone: z.id }; } });
  };
  const zones = req.layout.safeZones; const infl = 140;
  for (let f = 0; f < req.durationFrames; f++) {
    frames.push(handles.map(pose));
    for (let k = 0; k < tpf; k++) {
      if (repulsorN > 0) handles.forEach((b, i) => { b.resetForces(true); const p = b.translation(), [sx, sy] = worldToScreen(p.x, p.y, H), [w, h] = dims(bodies[i]); let fx = 0, fy = 0;
        for (const z of zones) { const ex0 = z.x - infl - w / 2, ex1 = z.x + z.w + infl + w / 2, ey0 = z.y - infl - h / 2, ey1 = z.y + z.h + infl + h / 2; if (sx < ex0 || sx > ex1 || sy < ey0 || sy > ey1) continue;
          const nx = Math.min(Math.max(sx, z.x), z.x + z.w), ny = Math.min(Math.max(sy, z.y), z.y + z.h); let dx = sx - nx, dy = sy - ny; let d = Math.hypot(dx, dy);
          if (d < 1e-6) { const cx = z.x + z.w / 2; dx = sx < cx ? -1 : 1; dy = 0; d = 0; } else { dx /= d; dy /= d; }
          const s = repulsorN * Math.max(0, 1 - d / (infl + Math.max(w, h) / 2)); fx += dx * s; fy += -dy * s; }
        if (fx !== 0 || fy !== 0) b.addForce({ x: fx, y: fy, z: 0 }, true); });
      world.step(); check(f * tpf + k + 1);
    }
  }
  const out: RunOut = { frames, violations, first }; world.free(); return out;
}

export function bakeHash(req: BakeRequest, bodies: readonly BodySpec[]): string {
  return createHash("sha256").update(stableStringify({ v: BAKER_VERSION, rapier: RAPIER.version?.() ?? "0.14", solver: SOLVER_HZ, layout: req.layout, durationFrames: req.durationFrames, seed: req.seed, bodies, g: req.gravity ?? 9.81, e: req.restitution ?? 0.35, mu: req.friction ?? 0.6, floor: req.floorMarginPx ?? 70, zm: req.zoneMarginPx ?? 6 })).digest("hex").slice(0, 32);
}
export async function bakePhysics(req: BakeRequest): Promise<BakeResult> {
  await initRapier(); const fps = assertFps(req.layout.fps); if (!Number.isInteger(SOLVER_HZ / fps)) throw new Error("solver rate must be an integer multiple of fps");
  const bodies = req.bodies ?? bodiesFor(req.seed, req.bodyCount ?? 10); if (bodies.length < 8 || bodies.length > 12) throw new RangeError("8..12 bodies required");
  const hash = bakeHash(req, bodies); const dir = req.cacheDir ?? join(process.cwd(), "projects", "bakes"); const file = join(dir, `${hash}.json`);
  if (req.useCache !== false && existsSync(file)) { const c = JSON.parse(readFileSync(file, "utf8")) as BakeResult; if (createHash("sha256").update(JSON.stringify(c.frames)).digest("hex") === c.trajectoryHash) return { ...c, fromCache: true, file }; }
  const attempts: AttemptReport[] = []; let result: RunOut | null = null;
  for (let a = req.forceAttempt ?? 0; a < STRATEGY.length; a++) {
    const out = simulate(req, bodies, a); const strat = STRATEGY[a];
    attempts.push({ attempt: a, strategy: strat, repulsorN: strat === "repulsor" ? 90 * (a - 1) : strat === "rigid-shield" ? 240 : 0, violations: out.violations, firstViolation: out.first });
    if (out.violations === 0) { result = out; break; }
  }
  if (!result) throw new Error(`safe-zone shield failed after ${attempts.length} attempts: ${JSON.stringify(attempts.at(-1))}`);
  const trajectoryHash = createHash("sha256").update(JSON.stringify(result.frames)).digest("hex");
  const res: BakeResult = { hash, trajectoryHash, bodies, fps, durationFrames: req.durationFrames, ticksPerFrame: SOLVER_HZ / fps, frames: result.frames, attempts, collisions: 0, fromCache: false };
  mkdirSync(dir, { recursive: true }); const tmp = `${file}.tmp`; writeFileSync(tmp, JSON.stringify(res)); renameSync(tmp, file); return { ...res, file };
}
/** Pure lookup used by renderers: pose of body `i` at global frame `f` (clamped to the bake length). */
export const poseAt = (b: Pick<BakeResult, "frames">, f: number, i: number): Pose => b.frames[Math.min(Math.max(0, f), b.frames.length - 1)][i];
