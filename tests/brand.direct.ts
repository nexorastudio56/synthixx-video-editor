import { direct } from "../intelligence/visualDirector.js";
const r = await direct({ scriptPath: "test_script.txt", workDir: "work/brand_test", projectRoot: process.cwd(), morphism: "brand", ratio: "9:16", fps: 60 });
console.log("fallback", r.usedFallback, JSON.stringify(r.attempts));
for (const s of r.scenePlan.scenes) console.log(s.id, s.theme, s.seconds + "s", s.heroes, s.components.join(","));
