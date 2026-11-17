import fs from "node:fs";
import { validateScene } from "../core/compiler/validateScene.js";
import { emitProject } from "../rendering/emitProject.js";
const [morph, aspect] = process.argv.slice(2);
const raw = JSON.parse(fs.readFileSync("samples/agent.scene.json", "utf8"));
raw.morphism = morph; raw.aspectRatio = aspect;
const r = validateScene(raw, { projectRoot: "." });
if (!r.ok) { console.error(r.errors); process.exit(1); }
const out = `${process.env.HOME}/hf/e3/${morph}_${aspect.replace(":", "x")}`;
fs.mkdirSync(out, { recursive: true });
emitProject(r.graph!, out, { projectRoot: ".", vendorAssets: "vendor" });
console.log(out);
