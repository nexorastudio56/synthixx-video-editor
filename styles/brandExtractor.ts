/**
 * Brand Kit & URL/Prompt compiler. Three inputs, one output (validated BrandThemeTokens, then compileTheme):
 *   fromKit(3 hex + optional logo) | fromUrl(safe public website) | fromPrompt(natural-language style prompt, rule-based, deterministic).
 * fromUrl blocks non-http(s), credentials, localhost, private / loopback / link-local / CGNAT / metadata addresses (DNS-resolved, re-checked on every redirect hop).
 */
import { promises as dns } from "node:dns";
import { isIP } from "node:net";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { extname } from "node:path";
import { BrandThemeTokens, type SurfaceKind, type Personality } from "./themeSchema.js";
import { getPreset, PRESET_IDS, type PresetId } from "./presets.js";
import { compileTheme, mix, rgbToHex, hexToRgb, luminance, WHITE, CARBON, type CompiledTheme } from "./themeCompiler.js";

/* ---------- colour helpers ---------- */
export function rgbToHsl([r, g, b]: readonly [number, number, number]): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255, mx = Math.max(R, G, B), mn = Math.min(R, G, B), l = (mx + mn) / 2, d = mx - mn;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1)); const h = mx === R ? ((G - B) / d) % 6 : mx === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}
export function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2; const k = Math.floor((((h % 360) + 360) % 360) / 60);
  const [r, g, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][k]; return rgbToHex([(r + m) * 255, (g + m) * 255, (b + m) * 255]);
}
const normHex = (h: string): string | null => { const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(h.trim()); if (!m) return null; const x = m[1].length === 3 ? m[1].split("").map(c => c + c).join("") : m[1]; return "#" + x.toUpperCase(); };

/* ---------- Brand kit ---------- */
export interface BrandKit { readonly background: string; readonly text: string; readonly accent: string; readonly logoPath?: string; readonly base?: PresetId; readonly material?: SurfaceKind; readonly pacing?: Personality; readonly name?: string }
const MATERIALS: Record<SurfaceKind, BrandThemeTokens["surface"]> = {
  minimal: { kind: "minimal", borderPx: 1 }, glass: { kind: "glass", blurPx: 24, opacity: 0.7, refractionStrength: 0.35 }, clay: { kind: "clay", extrusionPx: 16, highlightStrength: 0.7 },
  neumorphism: { kind: "neumorphism", depthPx: 14, lightDirectionDeg: 135 }, holo: { kind: "holo", scanlineStrength: 0.3, glowStrength: 0.7 }, liquid: { kind: "liquid", distortionPx: 14, glossStrength: 0.7 },
};
export const surfaceFor = (k: SurfaceKind): BrandThemeTokens["surface"] => structuredClone(MATERIALS[k]);
const PACING: Record<Personality, BrandThemeTokens["motion"]> = {
  "viral-fast": { personality: "viral-fast", defaultEasing: "spring", transitionFrames: 8, holdFrames: 15, shakeIntensity: 0.4 },
  "explainer-medium": { personality: "explainer-medium", defaultEasing: "ease_in_out", transitionFrames: 18, holdFrames: 48, shakeIntensity: 0.1 },
  "luxury-slow": { personality: "luxury-slow", defaultEasing: "expo_out", transitionFrames: 32, holdFrames: 110, shakeIntensity: 0 },
};
export const pacingFor = (p: Personality): BrandThemeTokens["motion"] => ({ ...PACING[p] });

export function logoRef(p: string): { path: string; sha256: string } {
  const ext = extname(p).toLowerCase(); if (![".svg", ".png", ".webp", ".jpg", ".jpeg"].includes(ext)) throw new Error(`logo must be svg/png/webp/jpg, got "${ext}"`);
  if (!existsSync(p)) throw new Error(`logo not found: ${p}`); return { path: p, sha256: createHash("sha256").update(readFileSync(p)).digest("hex") };
}
export function fromKit(kit: BrandKit): CompiledTheme {
  const bg = normHex(kit.background), tx = normHex(kit.text), ac = normHex(kit.accent); if (!bg || !tx || !ac) throw new Error("kit colors must be hex (#RGB or #RRGGBB)");
  const base = getPreset(kit.base ?? "apple_minimal"); const [h, s, l] = rgbToHsl(hexToRgb(ac));
  const t: BrandThemeTokens = { ...base, id: "custom_kit", name: kit.name ?? "Custom Brand Kit",
    color: { background: bg as never, textPrimary: tx as never, accent: ac as never, surface: mix(bg, tx, 0.05) as never, surfaceRaised: mix(bg, tx, 0.1) as never, textSecondary: mix(tx, bg, 0.3) as never, accentSecondary: hslToHex(h + 150, Math.max(0.35, s * 0.8), Math.min(0.6, Math.max(0.4, l))) as never, border: mix(bg, tx, 0.16) as never },
    surface: kit.material ? surfaceFor(kit.material) : base.surface, motion: kit.pacing ? pacingFor(kit.pacing) : base.motion };
  if (kit.logoPath) t.logo = logoRef(kit.logoPath);
  return compileTheme(BrandThemeTokens.parse(t));
}

/* ---------- SSRF-safe fetching ---------- */
export class UnsafeUrlError extends Error {}
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip); if (!v) return true;
  if (v === 4) { const [a, b] = ip.split(".").map(Number); return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224; }
  const x = ip.toLowerCase(); if (x === "::1" || x === "::") return true; if (x.startsWith("::ffff:")) return isPrivateAddress(x.slice(7));
  return x.startsWith("fc") || x.startsWith("fd") || x.startsWith("fe8") || x.startsWith("fe9") || x.startsWith("fea") || x.startsWith("feb") || x.startsWith("ff");
}
export interface SafeDeps { readonly lookup: (host: string) => Promise<string[]>; readonly fetch: (url: string, init: { redirect: "manual"; signal: AbortSignal; headers: Record<string, string> }) => Promise<Response> }
export const defaultDeps: SafeDeps = { lookup: async h => (await dns.lookup(h, { all: true })).map(a => a.address), fetch: (u, i) => fetch(u, i) };
export async function assertSafeUrl(raw: string, deps: SafeDeps = defaultDeps): Promise<URL> {
  let u: URL; try { u = new URL(raw); } catch { throw new UnsafeUrlError(`invalid URL: ${raw}`); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new UnsafeUrlError(`blocked protocol ${u.protocol}`);
  if (u.username || u.password) throw new UnsafeUrlError("credentials in URL are not allowed");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || !host.includes(".") && !isIP(host)) throw new UnsafeUrlError(`blocked host ${host}`);
  const addrs = isIP(host) ? [host] : await deps.lookup(host); if (!addrs.length) throw new UnsafeUrlError(`no DNS answer for ${host}`);
  for (const a of addrs) if (isPrivateAddress(a)) throw new UnsafeUrlError(`blocked private address ${a} for ${host}`);
  return u;
}
export const MAX_BYTES = 1_500_000;
export async function safeGet(raw: string, deps: SafeDeps = defaultDeps, hops = 3): Promise<{ url: URL; body: string; contentType: string }> {
  let cur = raw;
  for (let i = 0; i <= hops; i++) {
    const u = await assertSafeUrl(cur, deps); const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 10_000);
    try {
      const res = await deps.fetch(u.href, { redirect: "manual", signal: ac.signal, headers: { "user-agent": "SynthixxBrandBot/1.0", accept: "text/html,text/css,*/*;q=0.5" } });
      if (res.status >= 300 && res.status < 400) { const loc = res.headers.get("location"); if (!loc) throw new UnsafeUrlError("redirect without location"); cur = new URL(loc, u).href; continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${u.href}`);
      const reader = res.body?.getReader(); if (!reader) return { url: u, body: await res.text(), contentType: res.headers.get("content-type") ?? "" };
      const chunks: Uint8Array[] = []; let n = 0; for (;;) { const { done, value } = await reader.read(); if (done) break; n += value.byteLength; if (n > MAX_BYTES) { await reader.cancel(); break; } chunks.push(value); }
      return { url: u, body: Buffer.concat(chunks).toString("utf8"), contentType: res.headers.get("content-type") ?? "" };
    } finally { clearTimeout(timer); }
  }
  throw new UnsafeUrlError("too many redirects");
}

/* ---------- URL extraction ---------- */
export interface SiteBrand { readonly colors: readonly { hex: string; count: number }[]; readonly themeColor?: string; readonly logoUrl?: string; readonly title?: string }
export function extractFromHtml(html: string, css: string, base: URL): SiteBrand {
  const counts = new Map<string, number>(); const bump = (h: string, w = 1): void => { const n = normHex(h); if (n) counts.set(n, (counts.get(n) ?? 0) + w); };
  const all = html.replace(/<script[\s\S]*?<\/script>/gi, "") + "\n" + css;
  for (const m of all.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) bump(m[0]);
  for (const m of all.matchAll(/rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/g)) bump(rgbToHex([+m[1], +m[2], +m[3]]));
  for (const m of all.matchAll(/--[\w-]*(?:primary|brand|accent|main)[\w-]*\s*:\s*(#[0-9a-fA-F]{3,6})/gi)) bump(m[1], 8); // named brand variables weigh more
  const tc = /<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1]; if (tc && normHex(tc)) bump(tc, 12);
  const pick = (re: RegExp): string | undefined => re.exec(html)?.[1];
  const logoRaw = pick(/<img[^>]+(?:class|id|alt|src)=["'][^"']*logo[^"']*["'][^>]*src=["']([^"']+)["']/i) ?? pick(/<img[^>]+src=["']([^"']*logo[^"']*)["']/i) ?? pick(/<link[^>]+rel=["'](?:apple-touch-icon|icon)["'][^>]+href=["']([^"']+)["']/i) ?? pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  let logoUrl: string | undefined; if (logoRaw) { try { logoUrl = new URL(logoRaw, base).href; } catch { logoUrl = undefined; } }
  return { colors: [...counts.entries()].map(([hex, count]) => ({ hex, count })).sort((a, b) => b.count - a.count || a.hex.localeCompare(b.hex)), themeColor: tc ? (normHex(tc) ?? undefined) : undefined, logoUrl, title: /<title[^>]*>([^<]{1,80})/i.exec(html)?.[1]?.trim() };
}
/** Map extracted palette -> kit: accent = most frequent saturated colour; background/text = most frequent extreme-luminance colours. */
export function kitFromPalette(s: SiteBrand): BrandKit {
  const sat = s.colors.filter(c => { const [, sa, l] = rgbToHsl(hexToRgb(c.hex)); return sa > 0.35 && l > 0.2 && l < 0.75; });
  const accent = (s.themeColor && rgbToHsl(hexToRgb(s.themeColor))[1] > 0.3 ? s.themeColor : sat[0]?.hex) ?? "#E60000";
  const light = s.colors.find(c => luminance(c.hex) > 0.8)?.hex, dark = s.colors.find(c => luminance(c.hex) < 0.05)?.hex;
  const lightScore = s.colors.filter(c => luminance(c.hex) > 0.8).reduce((a, c) => a + c.count, 0), darkScore = s.colors.filter(c => luminance(c.hex) < 0.05).reduce((a, c) => a + c.count, 0);
  const darkMode = darkScore > lightScore * 1.5; const lt = light ?? WHITE, dk = dark ?? CARBON;
  return { background: darkMode ? dk : lt, text: darkMode ? lt : dk, accent, name: s.title ? s.title.slice(0, 50) : "Website brand" };
}
export async function fromUrl(url: string, deps: SafeDeps = defaultDeps): Promise<{ theme: CompiledTheme; site: SiteBrand }> {
  const page = await safeGet(url, deps); const sheets = [...page.body.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/gi)].map(m => m[1]).slice(0, 3); let css = "";
  for (const href of sheets) { try { css += "\n" + (await safeGet(new URL(href, page.url).href, deps)).body; } catch (e) { if (e instanceof UnsafeUrlError) continue; } } // an unsafe or failing stylesheet is skipped, never fetched
  const site = extractFromHtml(page.body, css, page.url); return { theme: fromKit(kitFromPalette(site)), site };
}

/* ---------- Natural-language prompt -> tokens (deterministic rules) ---------- */
const PRESET_WORDS: [PresetId, RegExp][] = [
  ["cyberpunk_holo", /cyber|neon|hacker|futur|sci-?fi|gaming|synthwave|holo/], ["fintech_emerald", /fintech|finance|bank|crypto|invest|trading|money|emerald|forest/],
  ["playful_clay", /playful|fun\b|kids|clay|pastel|cute|friendly|toy/], ["noir_documentary", /noir|documentary|cinematic|serious|news|history|moody|film/],
  ["apple_minimal", /apple|minimal|clean|luxur|elegant|premium|calm|simple/],
];
const COLOR_WORDS: Record<string, string> = { red: "#E60000", crimson: "#DC2626", orange: "#F97316", amber: "#F59E0B", yellow: "#EAB308", lime: "#84CC16", green: "#16A34A", emerald: "#10B981", teal: "#14B8A6", cyan: "#06B6D4", blue: "#2563EB", indigo: "#4F46E5", violet: "#7C3AED", purple: "#9333EA", pink: "#EC4899", coral: "#F43F5E", rose: "#E11D48", gold: "#CA8A04" };
export interface PromptResult { readonly theme: CompiledTheme; readonly matched: { readonly preset: PresetId; readonly accentWord?: string; readonly dark?: boolean; readonly material?: SurfaceKind; readonly pacing?: Personality } }
export function fromPrompt(prompt: string): PromptResult {
  const p = prompt.toLowerCase().slice(0, 600); const preset = PRESET_WORDS.find(([, re]) => re.test(p))?.[0] ?? "apple_minimal"; const base = getPreset(preset);
  const accentWord = Object.keys(COLOR_WORDS).find(w => new RegExp(`\\b${w}\\b`).test(p)); const dark = /\bdark\b|\bblack\b|night/.test(p) ? true : /\blight\b|\bwhite\b|bright/.test(p) ? false : undefined;
  const material = (["glass", "clay", "neumorph", "holo", "liquid", "minimal"] as const).map(w => [w, w === "neumorph" ? "neumorphism" : w] as const).find(([w]) => p.includes(w))?.[1] as SurfaceKind | undefined;
  const pacing: Personality | undefined = /fast|viral|punchy|energetic|tiktok|shorts/.test(p) ? "viral-fast" : /slow|calm|luxur|relax|cinematic/.test(p) ? "luxury-slow" : /explain|tutorial|medium|steady/.test(p) ? "explainer-medium" : undefined;
  const c = base.color; const darkBase = luminance(c.background) < 0.2; const wantDark = dark ?? darkBase;
  const bg = wantDark === darkBase ? c.background : c.textPrimary, tx = wantDark === darkBase ? c.textPrimary : c.background;
  const theme = fromKit({ background: bg, text: tx, accent: accentWord ? COLOR_WORDS[accentWord] : c.accent, base: preset, material: material ?? (base.surface.kind as SurfaceKind), pacing: pacing ?? base.motion.personality, name: `Prompt: ${prompt.slice(0, 40)}` });
  return { theme, matched: { preset, accentWord, dark, material, pacing } };
}
export { PRESET_IDS };
