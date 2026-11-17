import { createRequire } from "node:module"; 
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");

function findChrome() {
  const cands = [process.env.HYPERFRAMES_BROWSER_PATH, process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"];
  for (const c of cands) if (c && fs.existsSync(c)) return c;
  return undefined;
}

const frames = process.argv.slice(2).map(Number);
const chromePath = findChrome();
const launchOpts = chromePath ? { executablePath: chromePath } : {};
const b = await chromium.launch(launchOpts); 
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
const errs = []; 
p.on("pageerror", e => errs.push(String(e))); 
p.on("console", m => { if (m.type() === "error") errs.push(m.text()); });
await p.goto("file:///" + process.cwd().replace(/\\/g, "/") + "/build/index.html"); 
await p.waitForTimeout(800); 
if (!(await p.evaluate("!!window.seek"))) { 
  console.log("PAGE ERRORS", errs); 
  process.exit(1); 
} 
await p.evaluate("document.fonts.ready.then(()=>true)");
fs.mkdirSync("shots", { recursive: true });
for (const f of frames) { 
  await p.evaluate(`window.seek(${f})`); 
  await p.screenshot({ path: `shots/f${String(f).padStart(5, "0")}.png` }); 
}
console.log("errors:", errs.slice(0, 5)); 
await b.close();
