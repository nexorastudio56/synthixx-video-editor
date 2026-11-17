// Fast deterministic renderer: N Chromium workers seek the paused GSAP timeline per frame, JPEG -> ffmpeg (hw-accel or x264, bt709). Chunks are concatenated with -c copy.
// UPGRADED: Windows h264_mf hardware encoder detection, Chrome path from env, progress reporting
import { createRequire } from "node:module"; import { spawn, execFileSync, spawnSync } from "node:child_process"; import fs from "node:fs"; import path from "node:path";
const { chromium } = createRequire(import.meta.url)("playwright");
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i < 0 ? d : process.argv[i + 1]; };
const FPS = +arg("fps", 60), TOTAL = +arg("seconds", 30), WORKERS = +arg("workers", 2), FROM = +arg("from", 0), TO = Math.min(+arg("to", TOTAL * FPS), TOTAL * FPS), Q = +arg("quality", 94), OUT = arg("out", "build/video_silent.mp4"), CRF = arg("crf", "14");
const url = "file:///" + path.resolve("build/index.html").replace(/\\/g, "/"); fs.mkdirSync("build/chunks", { recursive: true });

// Detect best encoder: h264_mf (Windows HW) > h264_nvenc (NVIDIA) > libx264
function detectEncoder() {
  const candidates = process.platform === "win32"
    ? [["h264_mf", ["-c:v", "h264_mf", "-q:v", "80"]], ["h264_nvenc", ["-c:v", "h264_nvenc", "-preset", "p4", "-cq", CRF]], ["libx264", ["-c:v", "libx264", "-preset", "veryfast", "-crf", CRF]]]
    : [["h264_nvenc", ["-c:v", "h264_nvenc", "-preset", "p4", "-cq", CRF]], ["libx264", ["-c:v", "libx264", "-preset", "veryfast", "-crf", CRF]]];
  for (const [name, args] of candidates) {
    const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "nullsrc=s=64x64:d=0.1", ...args, "-f", "null", "-"], { encoding: "utf8", timeout: 5000 });
    if (r.status === 0) { console.log(`[encoder] ${name}`); return { name, args }; }
  }
  console.log("[encoder] fallback libx264"); return { name: "libx264", args: ["-c:v", "libx264", "-preset", "veryfast", "-crf", CRF] };
}
const enc = detectEncoder();

// Resolve Chrome path: env > Program Files > Playwright bundled
function findChrome() {
  const cands = [process.env.HYPERFRAMES_BROWSER_PATH, process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"];
  for (const c of cands) if (c && fs.existsSync(c)) return c;
  return undefined; // let Playwright use its bundled browser
}
const chromePath = findChrome();
if (chromePath) console.log(`[chrome] ${chromePath}`);

const n = TO - FROM, per = Math.ceil(n / WORKERS); const t0 = Date.now(); let done = 0;
async function worker(i) {
  const a = FROM + i * per, b = Math.min(TO, a + per); if (a >= b) return null; const file = `build/chunks/c${i}.mp4`;
  const launchOpts = { args: ["--disable-gpu-vsync", "--disable-features=PaintHolding", "--force-device-scale-factor=1"] };
  if (chromePath) launchOpts.executablePath = chromePath;
  const br = await chromium.launch(launchOpts); const pg = await br.newPage({ viewport: { width: 1920, height: 1080 } });
  await pg.goto(url); await pg.waitForFunction("window.seek", null, { timeout: 30000 }); await pg.evaluate("document.fonts.ready.then(()=>true)");
  const ffArgs = ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
    ...enc.args, "-g", "60", "-keyint_min", "60", "-sc_threshold", "0", "-pix_fmt", "yuv420p",
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
    "-vf", "scale=out_color_matrix=bt709:out_range=tv", "-movflags", "+faststart", file];
  const ff = spawn("ffmpeg", ffArgs, { stdio: ["pipe", "inherit", "inherit"] });
  for (let f = a; f < b; f++) { await pg.evaluate(`window.seek(${f})`); const buf = await pg.screenshot({ type: "jpeg", quality: Q }); if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once("drain", r)); done++; if (done % 60 === 0) { const elapsed = (Date.now() - t0) / 1000; const fps = (done / elapsed).toFixed(1); const eta = ((n - done) / (done / elapsed)).toFixed(0); console.log(`  ${done}/${n} (${(done/n*100).toFixed(0)}%)  ${fps} fps  ETA ${eta}s`); } }
  ff.stdin.end(); await new Promise(r => ff.on("close", r)); await br.close(); return file;
}
const files = (await Promise.all(Array.from({ length: WORKERS }, (_, i) => worker(i)))).filter(Boolean);
fs.writeFileSync("build/chunks/list.txt", files.map(f => `file '${path.resolve(f).replace(/\\/g, "/")}'`).join("\n"));
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", "build/chunks/list.txt", "-c", "copy", OUT]);
console.log(`\n[OK] rendered ${n} frames in ${((Date.now() - t0) / 1000).toFixed(1)}s => ${(n / ((Date.now() - t0) / 1000)).toFixed(1)} fps -> ${OUT}`);
