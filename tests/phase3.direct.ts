import { direct } from "../intelligence/visualDirector.js";
const r = await direct({ scriptPath: "samples/tech60.txt", workDir: "work/tech60", projectRoot: process.cwd(), morphism: "glass", ratio: "9:16" });
console.log("source", r.source, "fallback", r.usedFallback, "attempts", JSON.stringify(r.attempts));
console.log(JSON.stringify({ dur: r.scenePlan.durationSec, totals: r.scenePlan.componentTotals, assets: r.scenePlan.assets }, null, 1));
for (const s of r.scenePlan.scenes) console.log(s.id, s.seconds + "s", s.archetype, s.camera, s.components.join(","));
