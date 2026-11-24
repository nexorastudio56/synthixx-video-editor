/** Visual Director: script+voice -> validated Scene Graph. Stage1 narrative, Stage2 choreography, validate/repair loop (max 3) then safe fallback. */
import fs from "node:fs";
import path from "node:path";
import { alignWords } from "../audio/wordAligner.js";
import { resolveEntities } from "./entityResolver.js";
import { extractClauses } from "./narrative.js";
import { groupScenes, choreograph } from "./choreographer.js";
import { brandChoreograph } from "./brandChoreographer.js";
import { newMemory } from "./memory.js";
import { planPacing, planToGroups, type Personality, type PacingPlan } from "./pacingPlanner.js";
import { validateScene, formatRepairPrompt } from "../core/compiler/validateScene.js";
import { normalize, applyRepairs, safeFallback } from "./repair.js";

export interface DirectOpts { speed?: number; scriptPath: string; workDir: string; projectRoot: string; morphism: string; ratio: "9:16" | "16:9"; fps?: 24 | 30 | 60; userAudio?: string; userImagesDir?: string; voice?: string; maxRetries?: number; pacing?: Personality }
export interface DirectResult { graph: any; scenePlan: any; pacing?: PacingPlan; attempts: { n: number; errors: number; codes: string[] }[]; usedFallback: boolean; wavPath: string; source: string }

export async function direct(o: DirectOpts): Promise<DirectResult> {
  o = { ...o, scriptPath: path.resolve(o.scriptPath), workDir: path.resolve(o.workDir), projectRoot: path.resolve(o.projectRoot), userAudio: o.userAudio ? path.resolve(o.userAudio) : undefined, userImagesDir: o.userImagesDir ? path.resolve(o.userImagesDir) : undefined };
  const fps = o.fps ?? 30; fs.mkdirSync(o.workDir, { recursive: true });
  const script = fs.readFileSync(o.scriptPath, "utf8");
  const al = alignWords({ scriptPath: o.scriptPath, outDir: o.workDir, userAudio: o.userAudio, voice: o.voice, speed: o.speed });
  const rs = await resolveEntities(script, { projectRoot: o.projectRoot, cacheDir: path.join(o.workDir, "assets_cache"), userImagesDir: o.userImagesDir });
  const wavRel = path.relative(o.projectRoot, al.wavPath);
  const audioAsset = { id: "voice_main", kind: "audio" as const, path: wavRel, source: al.source === "whisperx" ? "kokoro+whisperx" : "kokoro", verified: true };
  const clauses = extractClauses(al.words, rs.entities);          // Stage 1
  const memory = newMemory(); const durationFrames = Math.ceil(al.durationSec * fps) + 6;
  const pacing = o.pacing && o.morphism === "brand" && (fps === 30 || fps === 60 || fps === 24) ? planPacing(al.words, { personality: o.pacing, fps, durationFrames }) : undefined; // word-aligned scene plan (no mid-word cuts, breathers, <=30% GPU heroes)
  const groups = pacing ? planToGroups(pacing, al.words, rs.entities) : groupScenes(clauses);
  const { scenes, notes } = (o.morphism === "brand" ? brandChoreograph : choreograph)(groups, { fps, aspect: o.ratio, words: al.words, resolved: rs.entities, memory, durationFrames, ...(pacing ? { cutFrames: pacing.cutFrames, hero3d: pacing.scenes.map(x => x.hero3d) } : {}) }); // Stage 2
  let graph: any = { schemaVersion: 1, title: path.parse(o.scriptPath).name, fps, aspectRatio: o.ratio, morphism: o.morphism, durationFrames, voice: { audioAssetId: "voice_main", words: al.words }, assets: [audioAsset, ...rs.assets], scenes };
  const attempts: DirectResult["attempts"] = []; let usedFallback = false; const max = o.maxRetries ?? 3; let ok = false;
  for (let n = 1; n <= max + 1; n++) {
    graph = normalize(graph); let r = validateScene(graph, { projectRoot: o.projectRoot });
    attempts.push({ n, errors: r.errors.length, codes: [...new Set(r.errors.map(e => e.code))] });
    if (r.ok) { graph = r.graph; ok = true; break; }
    if (n > max) break;
    fs.writeFileSync(path.join(o.workDir, `repair_prompt_${n}.txt`), formatRepairPrompt(r));
    applyRepairs(graph, r.errors);
  }
  if (!ok) { usedFallback = true; graph = safeFallback(graph); const r = validateScene(graph, { projectRoot: o.projectRoot }); attempts.push({ n: attempts.length + 1, errors: r.errors.length, codes: [...new Set(r.errors.map(e => e.code))] }); if (!r.ok) throw new Error("fallback invalid: " + r.errors.map(e => e.code + "@" + e.path).join(", ")); graph = r.graph; }
  const kinds: Record<string, number> = {}; for (const s of graph.scenes) for (const e of s.entities) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
  const scenePlan = { pacing: pacing ? { personality: pacing.personality, ...pacing.stats } : undefined, title: graph.title, aspectRatio: graph.aspectRatio, morphism: graph.morphism, durationSec: +(graph.durationFrames / fps).toFixed(2), timing: al.source, wordsRepaired: al.repaired, usedFallback, attempts,
    componentTotals: kinds, assets: graph.assets.map((a: any) => `${a.id}(${a.kind}:${a.source})`), resolverReport: rs.report,
    scenes: graph.scenes.map((s: any, i: number) => ({ id: s.id, seconds: +((s.endFrame - s.startFrame) / fps).toFixed(1), archetype: s.archetype, directorPrimitive: (notes[i] as any)?.directorPrimitive, directorEvidence: (notes[i] as any)?.directorEvidence, components: s.entities.map((e: any) => `${e.kind}${e.assetId ? "[" + e.assetId + "]" : ""}`), intents: s.semanticEvents.map((e: any) => e.intent), camera: notes[i]?.camera, theme: s.theme, heroes: (notes[i] as any)?.heroes })), memory };
  fs.writeFileSync(path.join(o.workDir, "scene.json"), JSON.stringify(graph, null, 1)); fs.writeFileSync(path.join(o.workDir, "scenePlan.json"), JSON.stringify(scenePlan, null, 1));
  return { graph, scenePlan, pacing, attempts, usedFallback, wavPath: al.wavPath, source: al.source };
}
