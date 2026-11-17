/** Writes a Hyperframes project directory from a validated SceneGraph. */
import fs from "node:fs";
import path from "node:path";
import { CANVAS, type SceneGraph } from "../schemas/scene.schema.js";
import { composeScene, composeBackground } from "../visual/sceneComposer.js";
import { impactsOf } from "../visual/fx/impactPulse.js";
import type { EmphasisTrack } from "../audio/emphasisAnalyzer.js";
import { composeCinematic, LIGHT, type CinematicOpts } from "../cinematic/cinematicLayer.js";

const BRAND_CINE: CinematicOpts = { grain: 0.045, vignette: 0.14, dust: 0, dustCount: 0 }; // light canvas: no black dirt, no invisible white dust
export interface EmitOpts { projectRoot: string; vendorAssets: string; audioFile?: string | null; cinematic?: CinematicOpts | false; emphasis?: EmphasisTrack }
export function emitProject(graph: SceneGraph, outDir: string, o: EmitOpts) {
  const { width: W, height: H } = CANVAS[graph.aspectRatio];
  fs.rmSync(path.join(outDir, "compositions"), { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, "compositions"), { recursive: true });
  fs.mkdirSync(path.join(outDir, "assets/fonts"), { recursive: true });
  for (const f of ["gsap.min.js", "grain.png", "fonts/inter800.otf", "fonts/inter700.otf"]) fs.copyFileSync(path.join(o.vendorAssets, f), path.join(outDir, "assets", f));
  const map: Record<string, string> = {};
  for (const a of graph.assets) { const dst = `assets/${a.id}${path.extname(a.path)}`; fs.copyFileSync(path.resolve(o.projectRoot, a.path), path.join(outDir, dst)); map[a.id] = dst; }
  const T = +(graph.durationFrames / graph.fps).toFixed(3);
  fs.writeFileSync(path.join(outDir, "compositions/bg.html"), composeBackground(graph));
  const hosts = [`<div id="bg" class="clip" data-composition-id="bg" data-composition-src="compositions/bg.html" data-start="0" data-duration="${T}" data-track-index="0" data-track-kind="graphics" data-width="${W}" data-height="${H}"></div>`];
  for (const s of graph.scenes) {
    const { html } = composeScene(graph, s, map, o.emphasis ? { impacts: impactsOf(o.emphasis) } : undefined);
    fs.writeFileSync(path.join(outDir, `compositions/${s.id}.html`), html);
    const st = +(s.startFrame / graph.fps).toFixed(3), du = +((s.endFrame - s.startFrame) / graph.fps).toFixed(3);
    hosts.push(`<div id="${s.id}" class="clip" data-composition-id="${s.id}" data-composition-src="compositions/${s.id}.html" data-start="${st}" data-duration="${du}" data-track-index="1" data-track-kind="graphics" data-width="${W}" data-height="${H}"></div>`);
  }
  if (o.cinematic !== false) { fs.writeFileSync(path.join(outDir, "compositions/cine.html"), composeCinematic(graph, o.cinematic ?? (graph.morphism === "brand" ? BRAND_CINE : LIGHT))); hosts.push(`<div id="cine" class="clip" data-composition-id="cine" data-composition-src="compositions/cine.html" data-start="0" data-duration="${T}" data-track-index="2" data-track-kind="graphics" data-width="${W}" data-height="${H}" style="z-index:50"></div>`); }
  let audioTag = "";
  if (o.audioFile !== null) { const voice = graph.assets.find(a => a.id === graph.voice.audioAssetId)!; const src = o.audioFile ? (fs.copyFileSync(o.audioFile, path.join(outDir, "assets/mix.wav")), "assets/mix.wav") : map[voice.id]; audioTag = `<audio id="mix" src="${src}" data-start="0" data-duration="${T}" data-track-index="10" data-volume="1"></audio>`; }
  const index = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=${W}, height=${H}"><script src="assets/gsap.min.js"></script><style>*{margin:0;padding:0}html,body{width:${W}px;height:${H}px;overflow:hidden;background:#000}</style></head><body>
<div id="root" data-fps="${graph.fps}" data-composition-id="main" data-start="0" data-duration="${T}" data-width="${W}" data-height="${H}">${hosts.join("\n")}
${audioTag}</div>
<script>window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});window.__timelines["main"]=tl;</script></body></html>`;
  fs.writeFileSync(path.join(outDir, "index.html"), index);
  const base = path.resolve(o.vendorAssets, "..");
  for (const f of ["package.json", "hyperframes.json", "meta.json"]) { const s = path.join(base, f); if (fs.existsSync(s) && !fs.existsSync(path.join(outDir, f))) fs.copyFileSync(s, path.join(outDir, f)); }
}
