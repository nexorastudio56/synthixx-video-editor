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
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto("file:///" + process.cwd().replace(/\\/g, "/") + "/build/index.html"); 
await p.waitForTimeout(600);
const issues = [];
for (let f = 0; f < 1800; f += 15) {
  await p.evaluate(`window.seek(${f})`);
  const r = await p.evaluate(() => { 
    const out = []; 
    for (const el of document.querySelectorAll('#cam *')) { 
      if (el.closest('svg')) continue; 
      let op = 1; 
      for (let a = el; a && a.id !== 'stage'; a = a.parentElement) op *= parseFloat(getComputedStyle(a).opacity); 
      if (op < 0.6) continue; 
      const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()); 
      if (!own) continue; 
      const q = document.createRange(); 
      q.selectNodeContents(el); 
      const rc = q.getBoundingClientRect(); 
      if (rc.width === 0) continue; 
      const m = 54; 
      if (rc.left < 90 || rc.right > 1830 || rc.top < m || rc.bottom > 1080 - m) 
        out.push((el.textContent || '').trim().slice(0, 30) + ' [' + [rc.left, rc.top, rc.right, rc.bottom].map(Math.round) + ']'); 
    } 
    return out; 
  });
  for (const x of r) issues.push(f + ' ' + x);
}
console.log('errors', errs); 
console.log(issues.length ? issues.slice(0, 40).join('\n') : 'BOUNDS OK'); 
await b.close();
