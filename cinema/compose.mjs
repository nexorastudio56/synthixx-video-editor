import fs from "node:fs";
import path from "node:path";
const t = JSON.parse(fs.readFileSync("work/voice.json", "utf8"));
let html = fs.readFileSync("page.html", "utf8").replace("/*TIMING*/null", JSON.stringify(t));

// Embed fonts as base64 for deterministic rendering (no network dependency)
const fontDir = path.resolve(import.meta.dirname, "..", "vendor", "fonts");
for (const [file, family, weight] of [["inter700.otf", "Inter", 700], ["inter800.otf", "Inter", 800]]) {
  const fp = path.join(fontDir, file);
  if (fs.existsSync(fp)) {
    const b64 = fs.readFileSync(fp).toString("base64");
    const face = `@font-face{font-family:'${family}';font-weight:${weight};src:url(data:font/otf;base64,${b64}) format('opentype')}`;
    html = html.replace("</style>", face + "\n</style>");
  }
}

fs.mkdirSync("build", { recursive: true });
fs.writeFileSync("build/index.html", html);
// Copy GSAP
const gsap = path.resolve(import.meta.dirname, "..", "vendor", "gsap.min.js");
fs.copyFileSync(gsap, "build/gsap.min.js");
// Copy grain texture if exists
const grain = path.resolve(import.meta.dirname, "..", "vendor", "grain.png");
if (fs.existsSync(grain)) fs.copyFileSync(grain, "build/grain.png");
console.log("composed", html.length, "bytes (fonts embedded)");
