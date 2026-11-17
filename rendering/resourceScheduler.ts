/**
 * Resource-class scheduler for a 4 GB VRAM / 32 GB RAM machine.
 *  - Scenes are classified gpu-heavy (3D/WebGL) or cpu-dom (2D typography/UI).
 *  - Chunks are cut ONLY on scene boundaries, half-open [startFrame,endFrame), covering [0,total) exactly once.
 *  - Pool: at most 1 gpu-heavy job at any moment; 2..4 cpu-dom jobs concurrently (GPU compositing disabled for them).
 */
import type { SceneGraph, EntityKind } from "../schemas/scene.schema.js";

export type ResourceClass = "gpu-heavy" | "cpu-dom";
export const GPU_HEAVY_KINDS: ReadonlySet<EntityKind> = new Set<EntityKind>(["device", "particles"]) // CSS-3D heroes are DOM-composited; only real WebGL kinds or props.webgl===true are gpu-heavy;
export const MAX_GPU_WORKERS = 1;
export const MIN_CPU_WORKERS = 2;
export const MAX_CPU_WORKERS = 4;

export interface SceneCost { readonly sceneId: string; readonly startFrame: number; readonly endFrame: number; readonly cls: ResourceClass; readonly reasons: readonly string[]; readonly weight: number }
export interface ChunkJob { readonly index: number; readonly startFrame: number; readonly endFrame: number; readonly sceneIds: readonly string[]; readonly cls: ResourceClass; readonly browserGpu: boolean }

export function classifyScene(s: SceneGraph["scenes"][number]): SceneCost {
  const reasons: string[] = [];
  for (const e of s.entities) {
    if (GPU_HEAVY_KINDS.has(e.kind)) reasons.push(`kind:${e.kind}`);
    if (e.props["webgl"] === true || e.props["three"] === true) reasons.push(`webgl:${e.id}`);
  }
  const frames = s.endFrame - s.startFrame;
  return { sceneId: s.id, startFrame: s.startFrame, endFrame: s.endFrame, cls: reasons.length ? "gpu-heavy" : "cpu-dom", reasons, weight: frames * (reasons.length ? 3 : 1) };
}
export function buildCostManifest(g: SceneGraph): SceneCost[] { return g.scenes.map(classifyScene); }

/** Merge consecutive same-class scenes into chunks of at most maxChunkFrames, never splitting a scene. */
export function planSceneChunks(manifest: readonly SceneCost[], maxChunkFrames: number): ChunkJob[] {
  const jobs: ChunkJob[] = []; let cur: { s: number; e: number; ids: string[]; cls: ResourceClass } | null = null;
  const flush = () => { if (cur) { jobs.push({ index: jobs.length, startFrame: cur.s, endFrame: cur.e, sceneIds: cur.ids, cls: cur.cls, browserGpu: cur.cls === "gpu-heavy" }); cur = null; } };
  for (const m of manifest) {
    const len = m.endFrame - m.startFrame;
    if (cur && (cur.cls !== m.cls || cur.e !== m.startFrame || (cur.e - cur.s) + len > maxChunkFrames)) flush();
    if (!cur) cur = { s: m.startFrame, e: m.endFrame, ids: [m.sceneId], cls: m.cls }; else { cur.e = m.endFrame; cur.ids.push(m.sceneId); }
  }
  flush();
  return jobs;
}
export function assertChunkCoverage(jobs: readonly ChunkJob[], total: number): void {
  let at = 0; for (const j of jobs) { if (j.startFrame !== at) throw new Error(`chunk ${j.index} starts at ${j.startFrame}, expected ${at}`); if (j.endFrame <= j.startFrame) throw new Error(`chunk ${j.index} empty`); at = j.endFrame; }
  if (at !== total) throw new Error(`chunks cover [0,${at}) not [0,${total})`);
}
export function cpuWorkerCount(cores: number, requested?: number): number { return Math.max(MIN_CPU_WORKERS, Math.min(MAX_CPU_WORKERS, requested ?? Math.floor(cores / 2))); }

/** Chrome launch args per resource class. cpu-dom: no GPU (saves VRAM); gpu-heavy: GPU raster, one at a time. */
export function chromeArgs(cls: ResourceClass): string[] {
  const base = ["--force-color-profile=srgb", "--disable-lcd-text", "--hide-scrollbars", "--font-render-hinting=none", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"];
  return cls === "cpu-dom" ? [...base, "--disable-gpu", "--disable-gpu-compositing", "--disable-accelerated-2d-canvas", "--use-gl=swiftshader"] : [...base, "--use-angle=default", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"];
}

export interface PoolStats { maxGpuConcurrent: number; maxCpuConcurrent: number; maxTotalConcurrent: number; order: { index: number; cls: ResourceClass; startedAt: number; endedAt: number }[] }
/** Runs jobs under the class limits. Pure scheduling (no wall-clock dependence on results); `tick` is a monotone counter for tests. */
export async function runPool<T>(jobs: readonly ChunkJob[], cpuWorkers: number, work: (j: ChunkJob) => Promise<T>): Promise<{ results: T[]; stats: PoolStats }> {
  const cpuLimit = cpuWorkers < MIN_CPU_WORKERS || cpuWorkers > MAX_CPU_WORKERS ? (() => { throw new RangeError(`cpu workers must be ${MIN_CPU_WORKERS}..${MAX_CPU_WORKERS}`); })() : cpuWorkers;
  const results: T[] = new Array(jobs.length); const queue = [...jobs]; let gpu = 0, cpu = 0, tick = 0;
  const stats: PoolStats = { maxGpuConcurrent: 0, maxCpuConcurrent: 0, maxTotalConcurrent: 0, order: [] };
  await new Promise<void>((resolve, reject) => {
    let running = 0, failed = false;
    const pump = (): void => {
      if (failed) return;
      for (let i = 0; i < queue.length;) {
        const j = queue[i]; const ok = j.cls === "gpu-heavy" ? gpu < MAX_GPU_WORKERS : cpu < cpuLimit;
        if (!ok) { i++; continue; }
        queue.splice(i, 1); if (j.cls === "gpu-heavy") gpu++; else cpu++; running++;
        stats.maxGpuConcurrent = Math.max(stats.maxGpuConcurrent, gpu); stats.maxCpuConcurrent = Math.max(stats.maxCpuConcurrent, cpu); stats.maxTotalConcurrent = Math.max(stats.maxTotalConcurrent, gpu + cpu);
        const rec = { index: j.index, cls: j.cls, startedAt: tick++, endedAt: -1 }; stats.order.push(rec);
        work(j).then(r => { results[j.index] = r; }, e => { failed = true; reject(e); }).finally(() => { rec.endedAt = tick++; if (j.cls === "gpu-heavy") gpu--; else cpu--; running--; if (!failed) { if (!queue.length && running === 0) resolve(); else pump(); } });
      }
      if (!queue.length && running === 0) resolve();
    };
    pump();
  });
  return { results, stats };
}
