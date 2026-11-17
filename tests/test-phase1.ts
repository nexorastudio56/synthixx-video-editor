/** Phase 1 verification: presets+WCAG, brand extractor safety, deterministic physics bake + safe-zone shield, three.js leak/determinism/colour, tsc. */
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { buildSync } from "esbuild";
import { chromium } from "playwright-core";
import { PRESET_IDS, getPreset, PRESETS } from "../styles/presets.js";
import { compileTheme, contrastRatio, luminance, themeHash } from "../styles/themeCompiler.js";
import { BrandThemeTokens } from "../styles/themeSchema.js";
import { fromKit, fromPrompt, fromUrl, assertSafeUrl, isPrivateAddress, UnsafeUrlError, type SafeDeps } from "../styles/brandExtractor.js";
import { bakePhysics, obbRectPenetration, type LayoutDNA } from "../simulation/physicsBaker.js";
import { resolveChrome } from "../rendering/renderPipeline.js";

interface Row { name: string; ok: boolean; detail: string }
const rows: Row[] = []; const check = (name: string, ok: boolean, detail: string): void => { rows.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`); };
const ROOT = resolve(import.meta.dirname, ".."); const WORK = join(ROOT, "out", "phase1_test"); rmSync(WORK, { recursive: true, force: true }); mkdirSync(WORK, { recursive: true });

/* ---- 1. presets + WCAG ---- */
{
  const r = contrastRatio("#E60000", "#09090B"); check("1a WCAG maths: #E60000 on #09090B = 4.13:1", Math.abs(r - 4.13) < 0.01, `${r.toFixed(4)} (large>=3 ${r >= 3 ? "pass" : "fail"}, small>=4.5 ${r >= 4.5 ? "pass" : "fail"})`);
  check("1b WCAG maths: white/black = 21:1, luminance(white)=1", Math.abs(contrastRatio("#FFFFFF", "#000000") - 21) < 1e-9 && luminance("#FFFFFF") === 1, "21.0000");
  const summary: string[] = []; let allOk = true;
  for (const id of PRESET_IDS) {
    const t = compileTheme(getPreset(id)); const rs = [...t.modes[0].results, ...t.modes[1].results]; const ok = t.passed && rs.every(x => x.passed && x.ratioAfter + 1e-9 >= x.required); allOk &&= ok;
    summary.push(`${id}:${rs.length - t.repairs.length}ok+${t.repairs.length}repaired`);
  }
  check("1c all 5 presets compile and every text/background pair passes WCAG after auto-repair", allOk && PRESET_IDS.length === 5, summary.join(" "));
  // compiler fixture (not a shipped preset): white / carbon / #E60000 exercises the pill-backing repair ladder
  const redFx = structuredClone(getPreset("apple_minimal")); Object.assign(redFx.color, { background: "#FFFFFF", textPrimary: "#09090B", accent: "#E60000" });
  const dark = compileTheme(redFx).modes[1].results.find(x => x.id === "caption:accent/background");
  check("1d #E60000 small text on #09090B auto-repaired (pill backing, brand colour kept)", !!dark && dark.ratioBefore < 4.5 && dark.action === "pill" && dark.ratioAfter >= 4.5 && dark.backing.kind === "pill", dark ? `before ${dark.ratioBefore.toFixed(2)} -> after ${dark.ratioAfter.toFixed(2)} via ${dark.action}, text ${dark.finalFg}` : "missing");
  const disp = compileTheme(redFx).modes[1].results.find(x => x.id === "display:accent/background");
  check("1e #E60000 display text on #09090B passes large-text 3:1 with no repair", !!disp && disp.action === "none" && disp.passed, disp ? `${disp.ratioBefore.toFixed(2)}:1` : "missing");
  const holo = PRESETS.cyberpunk_holo, clay = PRESETS.playful_clay, noir = PRESETS.noir_documentary, apple = PRESETS.apple_minimal, fin = PRESETS.fintech_emerald;
  check("1g preset identities (apple/holo/fintech/clay/noir)", apple.color.background === "#F8FAFC" && apple.color.textPrimary === "#0F172A" && apple.motion.personality === "luxury-slow" && holo.color.background === "#030305" && holo.color.accent === "#00F5D4" && holo.color.accentSecondary === "#9B5DE5" && holo.motion.personality === "viral-fast" && fin.color.background === "#062016" && fin.color.accent === "#10B981" && fin.surface.kind === "glass" && clay.color.background === "#EEF2FF" && clay.color.textPrimary === "#1E293B" && clay.surface.kind === "clay" && noir.color.background === "#121214" && noir.color.textPrimary === "#F5F5F4" && noir.color.accent === "#DC2626", "ok");
  // logo is never mutated
  const logo = join(WORK, "logo.svg"); writeFileSync(logo, `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#123456"/></svg>`);
  const k = fromKit({ background: "#09090B", text: "#FFFFFF", accent: "#E60000", logoPath: logo }); check("1h brand kit (3 hex + logo) compiles; logo passes through unmodified", k.passed && k.tokens.logo?.path === logo && /^[0-9a-f]{64}$/.test(k.tokens.logo?.sha256 ?? ""), `logo sha ${k.tokens.logo?.sha256?.slice(0, 12)} hash ${k.hash.slice(0, 12)}`);
  check("1i theme hash stable across parse round-trip", themeHash(BrandThemeTokens.parse(JSON.parse(JSON.stringify(k.tokens)))) === k.hash, "stable");
  let bad = false; try { BrandThemeTokens.parse({ ...getPreset("apple_minimal"), color: { ...getPreset("apple_minimal").color, accent: "red" } }); } catch { bad = true; } check("1j schema rejects non-hex colours", bad, "zod error");
  const bad2 = BrandThemeTokens.safeParse({ ...getPreset("apple_minimal"), typography: { ...getPreset("apple_minimal").typography, body: { ...getPreset("apple_minimal").typography.body, size: 400 } } }); check("1k schema bounds font sizes", !bad2.success, "size 400 rejected");
  const p = fromPrompt("a dark cyberpunk neon look, fast viral pacing, holo material"); check("1l prompt -> tokens (cyberpunk, viral-fast, holo)", p.theme.passed && p.matched.preset === "cyberpunk_holo" && p.theme.tokens.motion.personality === "viral-fast" && p.theme.tokens.surface.kind === "holo", JSON.stringify(p.matched));
  const p2 = fromPrompt("calm luxury minimal blue"); check("1m prompt -> tokens (apple_minimal, blue accent, luxury-slow)", p2.theme.passed && p2.matched.preset === "apple_minimal" && p2.theme.tokens.color.accent === "#2563EB" && p2.theme.tokens.motion.personality === "luxury-slow", JSON.stringify(p2.matched));
}

/* ---- 1b. URL safety + extraction (injected DNS/fetch; no real network) ---- */
{
  const dnsMap: Record<string, string[]> = { "good.example.com": ["93.184.216.34"], "evil.example.com": ["10.0.0.5"], "mixed.example.com": ["93.184.216.34", "192.168.1.9"], "redir.example.com": ["93.184.216.34"] };
  const deps: SafeDeps = { lookup: async h => dnsMap[h] ?? [],
    fetch: async u => { const url = new URL(u); if (url.hostname === "redir.example.com") return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } });
      if (url.pathname.endsWith(".css")) return new Response(":root{--brand-primary:#0EA5E9;} .a{color:#0EA5E9} .b{background:#0EA5E9}", { status: 200 });
      return new Response(`<html><head><title>Acme Cloud</title><meta name="theme-color" content="#0EA5E9"><link rel="stylesheet" href="/s.css"><link rel="icon" href="/favicon.png"></head><body style="background:#FFFFFF;color:#0F172A"><img class="site-logo" src="/img/logo.svg"></body></html>`, { status: 200, headers: { "content-type": "text/html" } }); } };
  const blocked = ["http://localhost:3000", "http://127.0.0.1/", "http://10.1.2.3/", "http://192.168.0.1/", "http://169.254.169.254/latest", "http://[::1]/", "file:///etc/passwd", "ftp://good.example.com/", "http://user:pw@good.example.com/", "http://service.internal/", "http://evil.example.com/", "http://mixed.example.com/", "http://0.0.0.0/", "http://172.16.0.9/", "http://100.64.0.1/"];
  const results: string[] = []; let allBlocked = true;
  for (const u of blocked) { try { await assertSafeUrl(u, deps); allBlocked = false; results.push(`LEAK ${u}`); } catch (e) { if (!(e instanceof UnsafeUrlError)) { allBlocked = false; results.push(`WRONG-ERR ${u}`); } } }
  check("1n blocks localhost / private / link-local / metadata / non-http / credentials / DNS-to-private", allBlocked, `${blocked.length} URLs blocked${results.length ? " ; " + results.join(",") : ""}`);
  let redirBlocked = false; try { await fromUrl("http://redir.example.com/", deps); } catch (e) { redirBlocked = e instanceof UnsafeUrlError; } check("1o redirect to a private address is re-validated and blocked", redirBlocked, "302 -> 169.254.169.254 refused");
  const okSite = await fromUrl("https://good.example.com/", deps);
  check("1p safe site: accent from CSS/theme-color, logo URL, compiled theme passes", okSite.theme.passed && okSite.theme.tokens.color.accent === "#0EA5E9" && okSite.site.logoUrl === "https://good.example.com/img/logo.svg", `accent ${okSite.theme.tokens.color.accent} logo ${okSite.site.logoUrl}`);
  check("1q isPrivateAddress covers v4/v6 ranges", ["127.0.0.1", "10.2.3.4", "172.20.1.1", "192.168.1.1", "169.254.1.1", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"].every(isPrivateAddress) && !isPrivateAddress("93.184.216.34") && !isPrivateAddress("2606:2800:220:1::1"), "ok");
}

/* ---- 3. physics bake ---- */
{
  const layout: LayoutDNA = { width: 1080, height: 1920, fps: 30, safeZones: [{ id: "title", x: 150, y: 330, w: 780, h: 300 }, { id: "caption", x: 150, y: 1350, w: 780, h: 260 }] };
  const dir = join(WORK, "bakes"); const req = { layout, durationFrames: 240, seed: 7, cacheDir: dir, useCache: false } as const;
  const a = await bakePhysics(req), b = await bakePhysics(req);
  check("3a bake twice -> identical trajectory hash", a.trajectoryHash === b.trajectoryHash && a.hash === b.hash, `${a.trajectoryHash.slice(0, 16)} == ${b.trajectoryHash.slice(0, 16)}`);
  check("3b 120 Hz solver, integer ticks/frame (4 @30fps), 8..12 bodies, [x,y,z,qx,qy,qz,qw]", a.ticksPerFrame === 4 && a.bodies.length >= 8 && a.bodies.length <= 12 && a.frames.length === 240 && a.frames[0][0].length === 7, `${a.bodies.length} bodies, ${a.frames.length} frames, ${a.ticksPerFrame} ticks/frame`);
  const a60 = await bakePhysics({ ...req, layout: { ...layout, fps: 60 }, durationFrames: 120 }); check("3c 60 fps -> 2 ticks/frame", a60.ticksPerFrame === 2 && a60.frames.length === 120, `${a60.ticksPerFrame} ticks/frame`);
  check("3d shield engaged: baseline violated, ladder re-baked to zero", a.attempts.length > 1 && a.attempts[0].violations > 0 && a.attempts.at(-1)?.violations === 0, a.attempts.map(x => `${x.strategy}:${x.violations}`).join(" -> "));
  // independent recheck on the recorded frames (every output frame, every body, every zone)
  let hits = 0; a.frames.forEach(fr => fr.forEach((p, i) => { const sizeW = a.bodies[i].kind === "card" ? Math.round(a.bodies[i].sizePx * 1.5) : a.bodies[i].sizePx, sizeH = a.bodies[i].sizePx; const sx = p[0] * 100, sy = 1920 - p[1] * 100, ang = -2 * Math.atan2(p[5], p[6]); for (const z of layout.safeZones) if (obbRectPenetration(sx, sy, sizeW / 2, sizeH / 2, ang, z, 0) > 0.75) hits++; }));
  check("3e zero safe-zone collisions (independent recheck of all frames)", hits === 0 && a.collisions === 0, `${hits} hits over ${a.frames.length * a.bodies.length * layout.safeZones.length} body/zone/frame tests`);
  const c = await bakePhysics({ ...req, useCache: true }); const c2 = await bakePhysics({ ...req, useCache: true }); check("3f bake cached to projects/bakes/<hash>.json and reloaded verified", !!c.file && existsSync(c.file) && c2.fromCache && c2.trajectoryHash === a.trajectoryHash, `${c.file?.split("/").pop()}`);
  const d = await bakePhysics({ ...req, seed: 8 }); check("3g different seed -> different trajectory", d.trajectoryHash !== a.trajectoryHash, d.trajectoryHash.slice(0, 12));
  const free = await bakePhysics({ ...req, layout: { ...layout, safeZones: [] } }); check("3h no safe zones -> baseline passes first try", free.attempts.length === 1 && free.attempts[0].violations === 0, `${free.attempts.length} attempt`);
}

/* ---- 2. three.js (headless Chrome, software GL) ---- */
{
  const bundle = buildSync({ entryPoints: [join(ROOT, "tests", "fixtures", "threeEntry.tsx")], bundle: true, write: false, format: "iife", platform: "browser", target: "es2022", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } }).outputFiles[0].text;
  const page = join(WORK, "three.html"); writeFileSync(page, `<!doctype html><html><body style="margin:0;background:#fff"><script>${bundle}</script></body></html>`);
  const br = await chromium.launch({ executablePath: resolveChrome(), args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--force-color-profile=srgb"] });
  try {
    const pg = await br.newPage({ viewport: { width: 300, height: 520 } }); const errs: string[] = []; pg.on("pageerror", e => errs.push(String(e))); await pg.goto("file://" + page);
    type Mem = { geometries: number; textures: number; programs: number }; type P1 = { leak(n: number): Promise<{ baseline: Mem; after: Mem[]; during: Mem[]; openScopes: number[]; drawn: number[]; disposedFlags: boolean[] }>; determinism(): { seq: string[]; shuffled: string[] }; colorProbe(h: string): number[]; glassCheck(): { center: number[]; tinted: number[]; edgeAlpha: number; drawn: number }; reactSmoke(): { opaque: number; canvases: number } };
    const call = async <T>(fn: string, ...args: unknown[]): Promise<T> => pg.evaluate(([f, a]) => (window as unknown as { __p1: Record<string, (...x: unknown[]) => unknown> }).__p1[f as string](...(a as unknown[])), [fn, args] as [string, unknown[]]) as Promise<T>;
    const L = await call<Awaited<ReturnType<P1["leak"]>>>("leak", 10);
    const leaks = L.after.filter(m => m.geometries !== L.baseline.geometries || m.textures !== L.baseline.textures).length;
    check("2a 10 render/dispose cycles: renderer.info.memory returns to baseline each cycle (zero leaks)", leaks === 0 && L.after.length === 10, `baseline geo=${L.baseline.geometries} tex=${L.baseline.textures}; during(max) geo=${Math.max(...L.during.map(m => m.geometries))} tex=${Math.max(...L.during.map(m => m.textures))}; after all cycles geo=${[...new Set(L.after.map(m => m.geometries))]} tex=${[...new Set(L.after.map(m => m.textures))]}`);
    check("2b resources were really allocated while the scene was live (test is not vacuous)", L.during.every(m => m.geometries >= 3 && m.textures >= 1), `geometries>=${Math.min(...L.during.map(m => m.geometries))}, textures>=${Math.min(...L.during.map(m => m.textures))}`);
    check("2c GPU programs do not accumulate across cycles", new Set(L.after.map(m => m.programs)).size === 1 && L.after[9].programs <= L.after[0].programs, `programs per cycle: ${L.after.map(m => m.programs).join(",")}`);
    check("2d ref-counted scope: retained scope survives first close, disposes on last release; no scopes left open", L.disposedFlags.every(Boolean) && L.openScopes.every(n => n === 0), `open scopes ${L.openScopes.join(",")}`);
    check("2e globe actually rendered pixels every cycle", L.drawn.every(n => n > 300), `non-transparent px per cycle: ${L.drawn.join(",")}`);
    const D = await call<ReturnType<P1["determinism"]>>("determinism"); check("2f random-access determinism: frame pixels identical regardless of render order", D.seq[0] !== D.seq[1] && D.shuffled[0] === D.seq[3] && D.shuffled[1] === D.seq[0] && D.shuffled[2] === D.seq[2] && D.shuffled[3] === D.seq[1] && D.shuffled[4] === D.seq[3], `hashes ${D.seq.slice(0, 4).join(",")}`);
    const C = await call<number[]>("colorProbe", "#E60000"); check("2g exact colour: NoToneMapping + SRGBColorSpace renders #E60000 as rgb(230,0,0)", Math.abs(C[0] - 230) <= 1 && C[1] <= 1 && C[2] <= 1 && C[3] === 255 && C[4] === 0 && C[5] === 1, `got rgb(${C.slice(0, 3)}) toneMapping=${C[4]} srgb=${C[5]}`);
    const C2 = await call<number[]>("colorProbe", "#09090B"); check("2h exact colour #09090B", C2.slice(0, 3).every((v, i) => Math.abs(v - [9, 9, 11][i]) <= 1), `got rgb(${C2.slice(0, 3)})`);
    const G = await call<ReturnType<P1["glassCheck"]>>("glassCheck"); check("2i glass slab samples the pre-blurred backdrop (red orb shows through, R-G>30), rounded edge is transparent", G.tinted[3] === 255 && G.tinted[0] - G.tinted[1] > 30 && G.drawn > 5000 && G.edgeAlpha === 0, `orb-region rgba(${G.tinted}) centre rgba(${G.center}) opaque px ${G.drawn}`);
    const R = await call<ReturnType<P1["reactSmoke"]>>("reactSmoke"); check("2j React components DotMatrixGlobe + ScreenSpaceGlassHero mount, render, unmount", R.canvases === 2 && R.opaque > 300 && errs.length === 0, `canvases=${R.canvases} globe px=${R.opaque} pageErrors=${errs.length}${errs.length ? " " + errs[0] : ""}`);
  } finally { await br.close(); }
}

/* ---- 4. tsc ---- */
{ const r = spawnSync("npx", ["tsc", "--noEmit"], { cwd: ROOT, encoding: "utf8" }); check("4 npx tsc --noEmit", r.status === 0, r.status === 0 ? "0 errors" : (r.stdout + r.stderr).slice(0, 500)); }
const failed = rows.filter(r => !r.ok).length; console.log(`\n==== PHASE 1 REPORT: ${rows.length - failed}/${rows.length} passed ====`); for (const r of rows) console.log(`${r.ok ? "[x]" : "[ ]"} ${r.name}`);
writeFileSync(join(WORK, "report.json"), JSON.stringify(rows, null, 1)); void readFileSync; process.exit(failed ? 1 : 0);
