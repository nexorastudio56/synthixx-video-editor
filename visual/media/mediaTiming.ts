/** Browser-safe, pure frame-index mapping for embedded media. No <video> element is ever played: the renderer asks for source frame K of global frame F. */
export interface MediaClock {
  readonly startFrame: number;       // global frame where the clip starts
  readonly fps: number;              // output fps
  readonly srcFps: number;           // native fps of the source file
  readonly firstIndex: number;       // first extracted source frame index
  readonly lastIndex: number;        // last extracted source frame index
  readonly trimStartFrames?: number; // source frames skipped at the head
  readonly speed?: number;           // playback speed (1 = real time)
  readonly end?: "hold" | "loop";    // behaviour after the last frame
}
/** Source frame index shown at integer global frame `f`. Exact integer maths; the 1e-9 term only absorbs binary rounding of exact rationals. */
export function sourceFrameIndex(f: number, c: MediaClock): number {
  const local = Math.max(0, f - c.startFrame), span = c.lastIndex - c.firstIndex + 1;
  const adv = Math.floor((local * c.srcFps * (c.speed ?? 1)) / c.fps + 1e-9) + (c.trimStartFrames ?? 0);
  const rel = (c.end ?? "hold") === "loop" ? ((adv % span) + span) % span : Math.min(adv, span - 1);
  return c.firstIndex + rel;
}
export const frameFileName = (index: number, ext: string): string => `src_${String(index).padStart(6, "0")}.${ext}`;
