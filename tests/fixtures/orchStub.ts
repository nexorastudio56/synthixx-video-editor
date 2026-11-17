/** Fast deterministic stand-in for a chunk renderer: lavfi frames -> x264 (closed GOP, bt709) with the SAME contract as hyperframesChunkRenderer. */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { ChunkRenderer } from "../../rendering/renderPipeline.js";
import { SceneGraph } from "../../schemas/scene.schema.js";
import { orchestrate } from "../../rendering/chunkOrchestrator.js";

export function stubRenderer(callLog: string, crashAfter = -1): ChunkRenderer {
  return async (job, ctx) => {
    fs.appendFileSync(callLog, `${job.index}\n`);
    const calls = fs.readFileSync(callLog, "utf8").trim().split("\n").length;
    const file = path.join(ctx.workDir, `chunk_${job.index}.mp4`), n = job.endFrame - job.startFrame;
    const args = ["-y", "-v", "error", "-f", "lavfi", "-i", `testsrc2=s=72x128:r=${ctx.fps}`, "-vf", `setpts=PTS+${job.startFrame}/${ctx.fps}/TB,setpts=PTS-STARTPTS`, "-frames:v", String(n), "-c:v", "libx264", "-preset", "ultrafast", "-crf", "30", "-g", "60", "-keyint_min", "60", "-sc_threshold", "0", "-pix_fmt", "yuv420p", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-movflags", "+faststart", file];
    if (crashAfter >= 0 && calls > crashAfter) { fs.writeFileSync(file + ".part.mp4", "torn"); process.kill(process.pid, "SIGKILL"); await new Promise(r => setTimeout(r, 5000)); }
    const r = spawnSync("ffmpeg", args, { encoding: "utf8" }); if (r.status !== 0) throw new Error("stub encode failed: " + r.stderr);
    return file;
  };
}
/** synthetic long graph: `scenes` x `sceneFrames`, every 5th scene is a gpu-heavy (props.webgl) scene */
export function longGraph(base: SceneGraph, scenes: number, sceneFrames: number, fps: 30 | 60): SceneGraph {
  const g = structuredClone(base); const tpl = base.scenes[0]!; g.fps = fps; g.durationFrames = scenes * sceneFrames; g.scenes = [];
  for (let i = 0; i < scenes; i++) { const s = structuredClone(tpl); s.id = `s${String(i).padStart(3, "0")}`; s.startFrame = i * sceneFrames; s.endFrame = (i + 1) * sceneFrames; s.entities = s.entities.slice(0, 1); s.entities[0]!.props = { ...s.entities[0]!.props, n: i, ...(i % 5 === 0 ? { webgl: true } : {}) }; g.scenes.push(s); }
  return g;
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.dirname, "orchStub.ts")) {
  // child process mode: node tsx orchStub.ts <graph.json> <projectsRoot> <jobId> <audio> <out> <callLog> <crashAfter>
  const [gp, root, jobId, audio, out, callLog, crash] = process.argv.slice(2) as [string, string, string, string, string, string, string];
  const g = JSON.parse(fs.readFileSync(gp, "utf8")) as SceneGraph;
  orchestrate({ jobId, projectsRoot: root, graph: g, renderer: stubRenderer(callLog, +crash), out, audioPath: audio, maxChunkFrames: 450, cpuConcurrency: 3, quality: "stub" }).then(r => { console.log(JSON.stringify({ complete: r.complete, skipped: r.skipped, rendered: r.rendered, stats: r.stats && { g: r.stats.maxGpuConcurrent, c: r.stats.maxCpuConcurrent, t: r.stats.maxTotalConcurrent } })); }, e => { console.error(e); process.exit(1); });
}
