import fs from "node:fs"; import path from "node:path";
import { validateScene } from "../core/compiler/validateScene.js"; import { emitProject } from "../rendering/emitProject.js";
const [src, out] = process.argv.slice(2); const raw = JSON.parse(fs.readFileSync(src, "utf8")); const r = validateScene(raw, { projectRoot: "." });
if (!r.ok) { console.error(r.errors); process.exit(1); }
fs.mkdirSync(out, { recursive: true }); const base = path.resolve("hf_base");
for (const f of ["package.json", "hyperframes.json", "meta.json"]) if (fs.existsSync(path.join(base, f))) fs.copyFileSync(path.join(base, f), path.join(out, f));
emitProject(r.graph!, out, { projectRoot: ".", vendorAssets: path.resolve("vendor"), audioFile: null }); console.log("ok", out);
