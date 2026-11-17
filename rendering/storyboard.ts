/**
 * Storyboard capture: renders KEYFRAME STILLS of any scene (no video encode) by seeking the scene's paused GSAP timeline,
 * measures the live DOM (text boxes, overlaps, clipping, NaN transforms, fonts/images) and builds a contact sheet.
 * Seconds per scene instead of minutes per chunk; it is also the sensor for Tier-1/Tier-2 visual QA.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import sharp, { type OverlayOptions } from "sharp";
import { CANVAS, type SceneGraph, type VideoScene } from "../schemas/scene.schema.js";
import { composeScene, composeBackground } from "../visual/sceneComposer.js";
import { resolveChrome } from "./renderPipeline.js";
import { chromeArgs } from "./resourceScheduler.js";

export interface TextBox { readonly entityId: string | null; readonly text: string; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly fg: string; readonly fgAlpha: number; readonly fontPx: number; readonly opacity: number; readonly clipped: boolean }
export interface DomProbe { readonly W: number; readonly H: number; readonly boxes: readonly TextBox[]; readonly nan: readonly string[]; readonly fontOk: boolean; readonly brokenImages: readonly string[] }
export type FrameKind = "start" | "mid" | "end";
export interface FrameProbe extends DomProbe { readonly sceneId: string; readonly kind: FrameKind; readonly frame: number; readonly png: string; readonly bgPng: string; readonly contrast: readonly { readonly entityId: string | null; readonly text: string; readonly ratio: number; readonly required: number }[] }

/** plain-JS probe (kept as a string: no transpiler helpers like __name can leak into the page) */
export const PROBE_JS = `(() => {
  const W = innerWidth, H = innerHeight, boxes = [], nan = [], broken = [];
  const root = document.querySelector('#root'); if (!root) return { W, H, boxes, nan: ['no #root'], fontOk: false, brokenImages: [] };
  const id = el => el.id || (el.className && el.className.baseVal === undefined ? String(el.className) : el.tagName.toLowerCase());
  for (const el of root.querySelectorAll('*')) {
    if (el._gsap) for (const k of ['x','y','z','scaleX','scaleY','rotation','rotationX','rotationY','skewX','opacity']) { const v = el._gsap[k]; if (typeof v === 'number' && !Number.isFinite(v)) nan.push(id(el) + '.' + k); }
    if (/NaN|Infinity/.test(el.getAttribute('style') || '')) nan.push(id(el) + ':style');
    if (el.tagName === 'IMG' && !(el.complete && el.naturalWidth > 0)) broken.push(el.getAttribute('src') || 'img');
    if (el.closest('script,style,template')) continue;
    const rs = [];
    for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) { const r = document.createRange(); r.selectNodeContents(n); for (const q of r.getClientRects()) if (q.width > 0 && q.height > 0) rs.push(q); }
    if (!rs.length) continue;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const q of rs) { x0 = Math.min(x0, q.left); y0 = Math.min(y0, q.top); x1 = Math.max(x1, q.right); y1 = Math.max(y1, q.bottom); }
    let op = 1, hidden = false; for (let a = el; a && a !== document.documentElement; a = a.parentElement) { const c = getComputedStyle(a); op *= parseFloat(c.opacity); if (c.visibility === 'hidden' || c.display === 'none') hidden = true; }
    if (hidden || !(op > 0.5)) continue;
    let clipped = false; for (let a = el.parentElement; a && a !== root; a = a.parentElement) { const c = getComputedStyle(a); if (c.overflow !== 'visible' && c.overflow !== '') { const r = a.getBoundingClientRect(); if (x0 < r.left - 2 || y0 < r.top - 2 || x1 > r.right + 2 || y1 > r.bottom + 2) { clipped = true; break; } } }
    const cs = getComputedStyle(el), m = /rgba?\\(([^)]+)\\)/.exec(cs.color), p = m ? m[1].split(',').map(Number) : [0,0,0,1];
    const ent = el.closest('.ent');
    boxes.push({ entityId: ent ? ent.id.replace(/^e_/, '') : null, text: el.textContent.trim().slice(0, 60), x: x0, y: y0, w: x1 - x0, h: y1 - y0, fg: '#' + [0,1,2].map(i => Math.round(p[i]).toString(16).padStart(2, '0')).join(''), fgAlpha: p.length > 3 ? p[3] : 1, fontPx: parseFloat(cs.fontSize), opacity: op, clipped });
  }
  return { W, H, boxes, nan, fontOk: document.fonts.check("800 40px InterX"), brokenImages: broken };
})()`;

const HIDE_TEXT_CSS = "*{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important}";
export const FRAME_FRACTIONS: Readonly<Record<FrameKind, number>> = { start: 0.12, mid: 0.5, end: 0.92 };
/** key frames of a scene: integer GLOBAL frames inside the half-open interval */
export function keyFrames(s: VideoScene): Record<FrameKind, number> {
  const n = s.endFrame - s.startFrame; const f = (k: FrameKind): number => s.startFrame + Math.min(n - 1, Math.max(0, Math.round(n * FRAME_FRACTIONS[k])));
  return { start: f("start"), mid: f("mid"), end: f("end") };
}
export function assetMapFor(graph: SceneGraph): Record<string, string> { const m: Record<string, string> = {}; for (const a of graph.assets) m[a.id] = `assets/${a.id}${path.extname(a.path)}`; return m; }

const unwrap = (tpl: string): string => { const m = /<template>([\s\S]*)<\/template>/.exec(tpl); if (!m) throw new Error("composition has no <template>"); return m[1]!; };
const sbName = (id: string): string => `_sb_${id}.html`;
/** standalone page for one scene (+ the global background composition for non-brand morphisms) */
export function writeScenePage(graph: SceneGraph, scene: VideoScene, projDir: string, html?: string): string {
  const { width: W, height: H } = CANVAS[graph.aspectRatio];
  const inner = unwrap(html ?? composeScene(graph, scene, assetMapFor(graph)).html);
  let bg = "";
  if (graph.morphism !== "brand") { fs.writeFileSync(path.join(projDir, sbName("bg")), `<!doctype html><meta charset=utf-8><style>html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden}</style><script src="assets/gsap.min.js"></script><script>window.__timelines={}</script>${unwrap(composeBackground(graph))}`); bg = `<iframe id="__bg" src="${sbName("bg")}" style="position:absolute;left:0;top:0;width:${W}px;height:${H}px;border:0;z-index:0"></iframe>`; }
  const doc = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:#808080}</style><script src="assets/gsap.min.js"></script><script>window.__timelines={}</script></head><body>${bg}${inner}</body></html>`;
  const file = path.join(projDir, sbName(scene.id)); fs.writeFileSync(file, doc); return file;
}

export class StoryboardSession {
  private browser!: Browser; private page!: Page;
  private constructor(readonly graph: SceneGraph, readonly projDir: string, readonly outDir: string, readonly scale: number) {}
  static async open(graph: SceneGraph, projDir: string, outDir: string, o: { chromePath?: string; scale?: number } = {}): Promise<StoryboardSession> {
    const s = new StoryboardSession(graph, projDir, outDir, o.scale ?? 0.5); fs.mkdirSync(outDir, { recursive: true });
    const { width: W, height: H } = CANVAS[graph.aspectRatio];
    s.browser = await chromium.launch({ executablePath: resolveChrome(o.chromePath), args: ["--no-sandbox", ...chromeArgs("cpu-dom"), "--disable-background-networking", "--disable-component-update", "--disable-sync", "--no-first-run", "--disable-default-apps"] });
    const ctx = await s.browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: s.scale }); s.page = await ctx.newPage(); return s;
  }
  async close(): Promise<void> { await this.browser.close(); }
  /** (re)compose one scene from the CURRENT graph state and load it */
  async load(graph: SceneGraph, scene: VideoScene): Promise<void> {
    const file = path.resolve(writeScenePage(graph, scene, this.projDir)); await this.page.goto("file://" + file, { waitUntil: "load" }); await this.page.evaluate("document.fonts.ready.then(()=>true)");
    await this.page.waitForFunction(`!!window.__timelines[${JSON.stringify(scene.id)}]`, undefined, { timeout: 15000 });
  }
  private async seek(scene: VideoScene, frame: number): Promise<void> {
    const t = +((frame - scene.startFrame) / this.graph.fps).toFixed(6), T = +(frame / this.graph.fps).toFixed(6);
    await this.page.evaluate(`window.__timelines[${JSON.stringify(scene.id)}].time(${t},false);true`);
    if (this.graph.morphism !== "brand") { const f = this.page.frames().find(x => x.url().endsWith(sbName("bg"))); if (f) await f.evaluate(`(window.__timelines.bg||window.__timelines[Object.keys(window.__timelines)[0]]).time(${T},false);true`); }
    await this.page.evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))");
  }
  async probe(scene: VideoScene, kind: FrameKind, frame: number, tag = ""): Promise<FrameProbe> {
    await this.seek(scene, frame); const dom = (await this.page.evaluate(PROBE_JS)) as DomProbe;
    const png = path.join(this.outDir, `${scene.id}_${kind}${tag}.png`), bgPng = path.join(this.outDir, `${scene.id}_${kind}${tag}.notext.png`);
    await this.page.screenshot({ path: png, type: "png" });
    await this.page.addStyleTag({ content: HIDE_TEXT_CSS }); await this.page.screenshot({ path: bgPng, type: "png" }); await this.page.evaluate("document.querySelectorAll('style').forEach(s=>{if((s.textContent||'').startsWith('*{color:transparent'))s.remove()})");
    return { ...dom, sceneId: scene.id, kind, frame, png, bgPng, contrast: await this.contrastOf(dom.boxes, bgPng) };
  }
  private async contrastOf(boxes: readonly TextBox[], bgPng: string): Promise<FrameProbe["contrast"]> {
    const img = sharp(bgPng), meta = await img.metadata(), raw = await img.removeAlpha().raw().toBuffer(); const sw = meta.width ?? 1, sh = meta.height ?? 1, k = this.scale, out: { entityId: string | null; text: string; ratio: number; required: number }[] = [];
    for (const b of boxes) {
      const x0 = Math.max(0, Math.floor(b.x * k)), y0 = Math.max(0, Math.floor(b.y * k)), x1 = Math.min(sw, Math.ceil((b.x + b.w) * k)), y1 = Math.min(sh, Math.ceil((b.y + b.h) * k)); if (x1 <= x0 || y1 <= y0 || b.fgAlpha < 0.05) continue;
      // the WORST-case luminance under the glyph box decides (a bright orb behind dark text, or a dark patch behind light text, both count)
      const fgL = relLum(hex3(b.fg)); let worst = Infinity;
      for (let y = y0; y < y1; y += Math.max(1, Math.floor((y1 - y0) / 6))) for (let x = x0; x < x1; x += Math.max(1, Math.floor((x1 - x0) / 24))) { const i = (y * sw + x) * 3; const bg: [number, number, number] = [raw[i]!, raw[i + 1]!, raw[i + 2]!]; const eff = hex3(b.fg).map((c, j) => c * b.fgAlpha + bg[j]! * (1 - b.fgAlpha)) as [number, number, number]; const a = relLum(eff), c = relLum(bg); const r = (Math.max(a, c) + 0.05) / (Math.min(a, c) + 0.05); if (r < worst) worst = r; }
      void fgL; out.push({ entityId: b.entityId, text: b.text, ratio: +worst.toFixed(2), required: b.fontPx >= 48 ? 3 : 4.5 });
    }
    return out;
  }
}
const hex3 = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const lin = (c: number): number => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const relLum = (c: readonly number[]): number => 0.2126 * lin(c[0]!) + 0.7152 * lin(c[1]!) + 0.0722 * lin(c[2]!);

/** contact sheet: one row per scene (start|mid|end), labelled */
export async function contactSheet(probes: readonly FrameProbe[], outPath: string, thumbW = 270): Promise<string> {
  const ids = [...new Set(probes.map(p => p.sceneId))]; if (!ids.length) throw new Error("no probes");
  const first = await sharp(probes[0]!.png).metadata(); const ratio = (first.height ?? 1) / (first.width ?? 1), th = Math.round(thumbW * ratio), lab = 26, pad = 8;
  const cols = 3, rowH = th + lab + pad, cellW = thumbW + pad;
  const comps: OverlayOptions[] = [];
  for (let r = 0; r < ids.length; r++) {
    comps.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cols * cellW}" height="${lab}"><text x="6" y="19" font-family="DejaVu Sans,Arial,sans-serif" font-size="16" fill="#111">${ids[r]}</text></svg>`), left: 0, top: r * rowH });
    for (const [c, k] of (["start", "mid", "end"] as const).entries()) { const p = probes.find(x => x.sceneId === ids[r] && x.kind === k); if (p) comps.push({ input: await sharp(p.png).resize(thumbW, th).png().toBuffer(), left: c * cellW, top: r * rowH + lab }); }
  }
  await sharp({ create: { width: cols * cellW, height: ids.length * rowH, channels: 3, background: "#E6ECF5" } }).composite(comps).png().toFile(outPath); return outPath;
}
