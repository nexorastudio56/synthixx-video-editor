/**
 * Synthixx Studio (localhost:3000): zero-dependency Node HTTP server.
 *  GET  /                  Neumorphism UI          GET /app.js           client bundle (esbuild, in-memory)
 *  GET  /api/presets       1-click presets          POST /api/compile-theme  kit | url | prompt | preset -> live BrandThemeTokens
 *  POST /api/logo          logo upload (-> 3D Brand Anchor)   POST /api/jobs   start/resume a render   GET /api/jobs/:id   live status
 *  GET  /api/system        VRAM / CPU scheduler status        GET /video/:id    mp4 with Range support
 */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { build } from "esbuild";
import { chromium, type Browser } from "playwright-core";
import { PRESET_IDS, getPreset } from "../../styles/presets.js";
import { compileTheme, contrastRatio, type CompiledTheme } from "../../styles/themeCompiler.js";
import { BrandThemeTokens } from "../../styles/themeSchema.js";
import { fromKit, fromPrompt, fromUrl, UnsafeUrlError } from "../../styles/brandExtractor.js";
import { resolveChrome } from "../../rendering/renderPipeline.js";

const HERE = import.meta.dirname, ROOT = path.resolve(HERE, "../.."), PROJECTS = path.join(ROOT, "projects"), STUDIO = path.join(PROJECTS, "studio");
const sha = (b: Buffer | string): string => crypto.createHash("sha256").update(b).digest("hex");
const MAX_BODY = 12_000_000;
let scrubBrowser: Browser | null = null;
async function getScrubBrowser(): Promise<Browser> {
  if (scrubBrowser) return scrubBrowser;
  const cp = resolveChrome();
  if (!cp) throw new Error("No Chrome/Chromium found for scrubbing. Set HYPERFRAMES_BROWSER_PATH.");
  scrubBrowser = await chromium.launch({ executablePath: cp, args: ["--no-sandbox", "--disable-gpu", "--headless=new"] });
  return scrubBrowser;
}

export function themeView(c: CompiledTheme): Record<string, unknown> {
  const m = c.modes.map(x => ({ id: x.mode, colors: x.colors, ratios: { text: +contrastRatio(x.colors.textPrimary, x.colors.background).toFixed(2), accent: +contrastRatio(x.colors.accent, x.colors.background).toFixed(2) } }));
  return { tokens: c.tokens, hash: c.hash, modes: m, repairs: c.repairs };
}
const body = (req: http.IncomingMessage): Promise<Buffer> => new Promise((res, rej) => { const a: Buffer[] = []; let n = 0; req.on("data", (d: Buffer) => { n += d.length; if (n > MAX_BODY) { rej(new Error("body too large")); req.destroy(); } else a.push(d); }); req.on("end", () => res(Buffer.concat(a))); req.on("error", rej); });
const json = (res: http.ServerResponse, code: number, v: unknown): void => { const b = JSON.stringify(v); res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(b); };

async function compileRequest(b: Record<string, unknown>): Promise<Record<string, unknown>> {
  const mode = String(b["mode"] ?? "preset");
  if (mode === "preset") return themeView(compileTheme(getPreset(String(b["preset"]) as (typeof PRESET_IDS)[number])));
  if (mode === "kit") return themeView(fromKit({ background: String(b["background"]), text: String(b["text"]), accent: String(b["accent"]), ...(b["logoPath"] ? { logoPath: path.resolve(ROOT, String(b["logoPath"])) } : {}), ...(b["base"] ? { base: String(b["base"]) as (typeof PRESET_IDS)[number] } : {}), ...(b["material"] ? { material: String(b["material"]) as never } : {}), ...(b["pacing"] ? { pacing: String(b["pacing"]) as never } : {}) }));
  if (mode === "prompt") { const r = fromPrompt(String(b["prompt"] ?? "")); return { ...themeView(r.theme), matched: r.matched }; }
  if (mode === "url") { const r = await fromUrl(String(b["url"] ?? "")); return { ...themeView(r.theme), site: { title: r.site.title ?? null, colors: r.site.colors.slice(0, 6) } }; }
  if (mode === "tokens") return themeView(compileTheme(BrandThemeTokens.parse(b["tokens"])));
  throw new Error("unknown mode " + mode);
}

interface Job { id: string; proc: ChildProcess | null; out: string; startedAt: number; exit: number | null }
const jobs = new Map<string, Job>();
function startJob(b: Record<string, unknown>): { id: string } {
  const script = String(b["script"] ?? "").trim(); if (script.split(/\s+/).length < 3) throw new Error("script too short");
  const ratio = b["ratio"] === "16:9" ? "16:9" : "9:16", quality = ["draft", "looks", "delivery"].includes(String(b["quality"])) ? String(b["quality"]) : "draft";
  const theme = compileTheme(BrandThemeTokens.parse(b["tokens"])).tokens;                         // validated + WCAG-repaired before it ever reaches the renderer
  const id = sha(stableJson({ script, ratio, quality, theme })).slice(0, 12);                    // same inputs => same job id => crash-resume for free
  const dir = path.join(STUDIO, id), out = path.join(dir, "out"); fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(dir, "script.txt"), script); fs.writeFileSync(path.join(dir, "theme.json"), JSON.stringify(theme, null, 1));
  const ex = jobs.get(id); if (ex && ex.exit === null) return { id };
  const log = fs.openSync(path.join(dir, "job.log"), "a");
  const proc = spawn(process.execPath, [path.join(ROOT, "node_modules/tsx/dist/cli.mjs"), "cli.ts", "--script", path.join(dir, "script.txt"), "--theme-file", path.join(dir, "theme.json"), "--ratio", ratio, "--quality", quality, "--out", out, "--job-id", id, "--no-music"], { cwd: ROOT, stdio: ["ignore", log, log], env: { ...process.env, HYPERFRAMES_BROWSER_PATH: resolveChrome() } });
  const j: Job = { id, proc, out, startedAt: Date.now(), exit: null }; jobs.set(id, j); proc.on("close", c => { j.exit = c ?? 1; fs.writeFileSync(path.join(dir, "exit.json"), JSON.stringify({ code: j.exit })); });
  return { id };
}
const stableJson = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
const readJson = (f: string): unknown => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
function jobStatus(id: string): Record<string, unknown> | null {
  if (!/^[0-9a-f]{12}$/.test(id)) return null; const dir = path.join(STUDIO, id); if (!fs.existsSync(dir)) return null;
  const log = fs.existsSync(path.join(dir, "job.log")) ? fs.readFileSync(path.join(dir, "job.log"), "utf8").split("\n").slice(-14) : [];
  const manifest = readJson(path.join(PROJECTS, id, "manifest.json")) as { state?: string; final?: { path: string } | null } | null, ex = readJson(path.join(dir, "exit.json")) as { code: number } | null, live = jobs.get(id);
  const running = live ? live.exit === null : false;
  return { id, running, exit: live?.exit ?? ex?.code ?? null, log, manifest, qa: readJson(path.join(dir, "out", "visual_qa_report.json")), sheet: fs.existsSync(path.join(dir, "out", "storyboard", "contact_sheet.png")), video: manifest?.final && fs.existsSync(manifest.final.path) ? `/video/${id}` : null };
}
function system(): Record<string, unknown> {
  const r = spawnSync("nvidia-smi", ["--query-gpu=name,memory.used,memory.total,utilization.gpu", "--format=csv,noheader,nounits"], { encoding: "utf8" });
  const gpu = r.status === 0 && r.stdout.trim() ? r.stdout.trim().split("\n")[0]!.split(",").map(x => x.trim()) : null;
  return { cpus: os.cpus().length, load1: +os.loadavg()[0]!.toFixed(2), memUsedGb: +((os.totalmem() - os.freemem()) / 2 ** 30).toFixed(1), memTotalGb: +(os.totalmem() / 2 ** 30).toFixed(1), gpu: gpu ? { name: gpu[0], usedMb: +gpu[1]!, totalMb: +gpu[2]!, util: +gpu[3]! } : null, limits: { gpuHeavy: 1, cpuDom: 3 } };
}
function serveVideo(req: http.IncomingMessage, res: http.ServerResponse, id: string): void {
  const st = jobStatus(id); const f = (st?.["manifest"] as { final?: { path: string } } | null)?.final?.path; if (!f || !fs.existsSync(f)) { res.writeHead(404).end(); return; }
  const size = fs.statSync(f).size, m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? "");
  if (m) { const a = m[1] ? +m[1] : 0, z = m[2] ? Math.min(+m[2], size - 1) : size - 1; res.writeHead(206, { "content-type": "video/mp4", "accept-ranges": "bytes", "content-range": `bytes ${a}-${z}/${size}`, "content-length": z - a + 1 }); fs.createReadStream(f, { start: a, end: z }).pipe(res); }
  else { res.writeHead(200, { "content-type": "video/mp4", "accept-ranges": "bytes", "content-length": size }); fs.createReadStream(f).pipe(res); }
}
let bundle: string | null = null;
async function clientBundle(): Promise<string> { if (bundle) return bundle; const r = await build({ entryPoints: [path.join(HERE, "client/app.ts")], bundle: true, write: false, format: "iife", target: "es2022", minify: false }); bundle = r.outputFiles[0]!.text; return bundle; }

export function createServer(): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url ?? "/", "http://localhost"), p = u.pathname;
      if (req.method === "GET" && p === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(fs.readFileSync(path.join(HERE, "index.html"))); return; }
      if (req.method === "GET" && p === "/favicon.ico") { res.writeHead(204).end(); return; }
      if (req.method === "GET" && p === "/app.js") { res.writeHead(200, { "content-type": "text/javascript" }).end(await clientBundle()); return; }
      if (req.method === "GET" && p === "/api/presets") { json(res, 200, PRESET_IDS.map(id => ({ id, ...themeView(compileTheme(getPreset(id))) }))); return; }
      if (req.method === "GET" && p === "/api/system") { json(res, 200, system()); return; }
      if (req.method === "POST" && p === "/api/compile-theme") { try { json(res, 200, await compileRequest(JSON.parse((await body(req)).toString("utf8")) as Record<string, unknown>)); } catch (e) { json(res, e instanceof UnsafeUrlError ? 400 : 422, { error: (e as Error).message }); } return; }
      if (req.method === "POST" && p === "/api/logo") {
        const buf = await body(req); const t = String(req.headers["content-type"] ?? ""); const ext = t.includes("png") ? ".png" : t.includes("svg") ? ".svg" : t.includes("jpeg") ? ".jpg" : t.includes("webp") ? ".webp" : "";
        if (!ext || buf.length < 16) { json(res, 415, { error: "png, svg, jpeg or webp logo required" }); return; }
        const dir = path.join(PROJECTS, "uploads"); fs.mkdirSync(dir, { recursive: true }); const h = sha(buf), f = path.join(dir, h.slice(0, 16) + ext); fs.writeFileSync(f, buf);
        json(res, 200, { logoPath: path.relative(ROOT, f), sha256: h, bytes: buf.length }); return;
      }
      if (req.method === "POST" && p === "/api/jobs") { try { json(res, 200, startJob(JSON.parse((await body(req)).toString("utf8")) as Record<string, unknown>)); } catch (e) { json(res, 422, { error: (e as Error).message }); } return; }
      const jm = /^\/api\/jobs\/([0-9a-f]+)$/.exec(p); if (req.method === "GET" && jm) { const s = jobStatus(jm[1]!); if (s) json(res, 200, s); else json(res, 404, { error: "unknown job" }); return; }
      const sm = /^\/api\/jobs\/([0-9a-f]+)\/sheet$/.exec(p); if (req.method === "GET" && sm) { const f = path.join(STUDIO, sm[1]!, "out", "storyboard", "contact_sheet.png"); if (fs.existsSync(f)) { res.writeHead(200, { "content-type": "image/png" }).end(fs.readFileSync(f)); } else res.writeHead(404).end(); return; }
      const vm = /^\/video\/([0-9a-f]+)$/.exec(p); if (req.method === "GET" && vm) { serveVideo(req, res, vm[1]!); return; }
      // Live scene timeline scrubbing: render a single frame at the given time.
      const scrubM = /^\/api\/scrub\/([0-9a-f]+)$/.exec(p); if (req.method === "GET" && scrubM) {
        try {
          const u = new URL(req.url ?? "", "http://localhost"); const frameSec = parseFloat(u.searchParams.get("t") ?? "0");
          const jobId = scrubM[1]!; const dir = path.join(STUDIO, jobId);
          const idxHtml = path.join(dir, "out", "index.html");
          if (!fs.existsSync(idxHtml)) { res.writeHead(404).end("composition not ready"); return; }
          const browser = await getScrubBrowser();
          const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
          await page.goto("file://" + idxHtml.replace(/\\/g, "/"), { waitUntil: "domcontentloaded" });
          await page.evaluate((t: number) => { const w = window as unknown as { __setFrame?: (f: number) => void }; if (w.__setFrame) w.__setFrame(Math.round(t * 60)); }, frameSec);
          await page.waitForTimeout(150); // let GSAP settle
          const png = await page.screenshot({ type: "png" });
          await page.close();
          res.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" }).end(png);
        } catch (e) { res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: (e as Error).message })); }
        return;
      }
      res.writeHead(404).end("not found");
    } catch (e) { json(res, 500, { error: (e as Error).message }); }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(HERE, "server.ts")) {
  const port = +(process.env["PORT"] ?? 3000); createServer().listen(port, "127.0.0.1", () => console.log(`Synthixx Video Editor Studio: http://localhost:${port}`));
}
