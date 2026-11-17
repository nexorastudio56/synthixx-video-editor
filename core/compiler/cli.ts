import fs from "node:fs";
import { validateScene, formatRepairPrompt } from "./validateScene.js";
const file = process.argv[2];
if (!file) { console.error("usage: npm run validate -- scene.json"); process.exit(2); }
const r = validateScene(JSON.parse(fs.readFileSync(file, "utf8")), { projectRoot: process.argv[3] });
console.log(r.ok ? "OK" : "INVALID", r.stats ?? "");
for (const w of r.warnings) console.log("  warn", w.code, w.path, w.message);
if (!r.ok) { console.log(formatRepairPrompt(r)); process.exit(1); }
