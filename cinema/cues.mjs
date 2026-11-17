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

const chromePath = findChrome();
const launchOpts = chromePath ? { executablePath: chromePath } : {};
const b = await chromium.launch(launchOpts); 
const p = await b.newPage(); 
await p.goto("file:///" + process.cwd().replace(/\\/g, "/") + "/build/index.html"); 
await p.waitForTimeout(500);
const c = await p.evaluate("window.CUES"); 
fs.writeFileSync("build/cues.json", JSON.stringify(c)); 
console.log(c.length, "cues"); 
await b.close();
