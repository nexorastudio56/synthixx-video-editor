/**
 * Canonical clock. Every visual property is a pure function of an INTEGER globalFrame and fps (t = globalFrame / fps).
 * Scene intervals are half-open [startFrame, endFrame): a boundary frame belongs to exactly ONE scene (never double-rendered, never dropped).
 */
export type Frame = number & { readonly __frame: unique symbol };
export type Fps = 30 | 60;

export function asFrame(n: number): Frame {
  if (!Number.isInteger(n)) throw new RangeError(`Frame must be an integer, got ${n}`);
  if (n < 0) throw new RangeError(`Frame must be >= 0, got ${n}`);
  return n as Frame;
}
export function assertFps(fps: number): Fps {
  if (fps !== 30 && fps !== 60) throw new RangeError(`fps must be 30 or 60, got ${fps}`);
  return fps;
}
/** t = globalFrame / fps */
export const frameToSec = (frame: Frame | number, fps: Fps): number => (frame as number) / fps;
/** Nearest integer frame for a time in seconds (ties away from zero: Math.round on non-negative values). */
export const secToFrame = (sec: number, fps: Fps): Frame => asFrame(Math.round(sec * fps));

export interface Interval { readonly startFrame: number; readonly endFrame: number } // half-open [start, end)
export const intervalLength = (i: Interval): number => i.endFrame - i.startFrame;
export const inInterval = (i: Interval, frame: number): boolean => frame >= i.startFrame && frame < i.endFrame;

/** Validate that intervals are sorted, non-empty, contiguous and cover [0,total) exactly: no gaps, no overlaps, no double-rendered boundary. */
export function assertPartition(intervals: readonly Interval[], totalFrames: number): void {
  let cursor = 0;
  intervals.forEach((iv, k) => {
    if (!Number.isInteger(iv.startFrame) || !Number.isInteger(iv.endFrame)) throw new RangeError(`interval ${k} has non-integer bounds`);
    if (iv.endFrame <= iv.startFrame) throw new RangeError(`interval ${k} is empty or inverted [${iv.startFrame},${iv.endFrame})`);
    if (iv.startFrame !== cursor) throw new RangeError(`interval ${k} starts at ${iv.startFrame}, expected ${cursor} (gap or overlap)`);
    cursor = iv.endFrame;
  });
  if (cursor !== totalFrames) throw new RangeError(`intervals end at ${cursor}, expected ${totalFrames}`);
}

/** Index of the single interval containing `frame` (binary search, O(log n)); -1 when outside. */
export function intervalIndexAt(intervals: readonly Interval[], frame: number): number {
  let lo = 0, hi = intervals.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1; const iv = intervals[mid];
    if (frame < iv.startFrame) hi = mid - 1; else if (frame >= iv.endFrame) lo = mid + 1; else return mid;
  }
  return -1;
}

export interface SpringState { readonly position: number; readonly velocity: number }
/**
 * Analytic closed-form unit-step response of a damped harmonic oscillator x'' = (k/m)(1 - x) - (c/m) x'  starting at rest at 0.
 * Pure function of t: seekable to ANY frame without sequential stepping. Handles under-, critically- and over-damped cases.
 */
export function evaluateSpring(t: number, stiffness: number, damping: number, mass: number): SpringState {
  if (!(stiffness > 0) || !(mass > 0) || damping < 0) throw new RangeError("stiffness and mass must be > 0 and damping >= 0");
  if (t <= 0) return { position: 0, velocity: 0 };
  const w0 = Math.sqrt(stiffness / mass), z = damping / (2 * Math.sqrt(stiffness * mass));
  if (Math.abs(z - 1) < 1e-9) {
    const e = Math.exp(-w0 * t);
    return { position: 1 - e * (1 + w0 * t), velocity: e * w0 * w0 * t };
  }
  if (z < 1) {
    const wd = w0 * Math.sqrt(1 - z * z), e = Math.exp(-z * w0 * t), c = Math.cos(wd * t), s = Math.sin(wd * t), k = (z * w0) / wd;
    return { position: 1 - e * (c + k * s), velocity: e * (z * w0 * (c + k * s) - wd * (-s + k * c)) };
  }
  const q = Math.sqrt(z * z - 1), r1 = -w0 * (z - q), r2 = -w0 * (z + q), e1 = Math.exp(r1 * t), e2 = Math.exp(r2 * t), d = r2 - r1;
  return { position: 1 - (r2 * e1 - r1 * e2) / d, velocity: -(r2 * r1 * e1 - r1 * r2 * e2) / d };
}
/** Time (s) after which |1 - x| stays below `eps`. Found analytically from the envelope e^{-zeta*w0*t}. */
export function springSettleSec(stiffness: number, damping: number, mass: number, eps = 0.001): number {
  const w0 = Math.sqrt(stiffness / mass), z = damping / (2 * Math.sqrt(stiffness * mass)); const rate = z >= 1 ? w0 * (z - Math.sqrt(Math.max(0, z * z - 1))) : z * w0;
  return Math.log(1 / eps) / Math.max(rate, 1e-6);
}
/** Spring progress for a frame inside an action starting at `startFrame`. */
export function springAtFrame(frame: number, startFrame: number, fps: Fps, stiffness: number, damping: number, mass = 1): SpringState {
  return evaluateSpring((frame - startFrame) / fps, stiffness, damping, mass);
}
