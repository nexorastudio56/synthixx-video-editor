/**
 * Theme compiler: exact WCAG 2.x maths + automatic contrast repair + CSS variable / surface emission.
 * Logos are never recoloured: repairs only add backings or swap TEXT colours; `tokens.logo` passes through untouched.
 */
import { createHash } from "node:crypto";
import { BrandThemeTokens, type BrandThemeInput, type Hex, type SurfaceStyle, type ThemeColors } from "./themeSchema.js";

export const COMPILER_VERSION = "theme-1";
export const WHITE = "#FFFFFF", CARBON = "#09090B";

/* ---------- colour maths ---------- */
export type RGB = readonly [number, number, number];
export const hexToRgb = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
export const rgbToHex = (c: RGB): Hex => `#${c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
const lin = (v8: number): number => { const c = v8 / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
/** WCAG 2.x relative luminance. */
export function luminance(hex: string): number { const [r, g, b] = hexToRgb(hex); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); }
/** WCAG contrast ratio (L1+0.05)/(L2+0.05), lighter over darker. */
export function contrastRatio(a: string, b: string): number { const la = luminance(a), lb = luminance(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
export function mix(a: string, b: string, t: number): Hex { const x = hexToRgb(a), y = hexToRgb(b); return rgbToHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]); }
/** Composite fg at alpha over bg. */
export const over = (fg: string, bg: string, alpha: number): Hex => mix(bg, fg, alpha);
export const bestMono = (bg: string): Hex => (contrastRatio(WHITE, bg) >= contrastRatio(CARBON, bg) ? WHITE : CARBON);

/* ---------- usages ---------- */
export type Role = "display" | "heading" | "body" | "caption";
export type Backing = { readonly kind: "none" } | { readonly kind: "pill" | "scrim"; readonly color: Hex; readonly opacity: number };
export interface Usage { readonly id: string; readonly role: Role; readonly fg: Hex; readonly bg: Hex; readonly required: number; readonly accent: boolean }
export interface UsageResult { readonly id: string; readonly role: Role; readonly fg: Hex; readonly bg: Hex; readonly ratioBefore: number; readonly ratioAfter: number; readonly required: number; readonly passed: boolean; readonly action: "none" | "swap-text" | "pill" | "scrim"; readonly finalFg: Hex; readonly backing: Backing }
export interface Repair { readonly usage: string; readonly action: "swap-text" | "pill" | "scrim"; readonly from: Hex; readonly to: Hex; readonly ratioBefore: number; readonly ratioAfter: number }
export interface ModeReport { readonly mode: "primary" | "inverted"; readonly colors: ThemeColors; readonly results: readonly UsageResult[]; readonly repairs: readonly Repair[] }

/** Display-size text needs 3:1 (WCAG large text); headings 3:1 when >=36px; body/caption and any accent used at small sizes need 4.5:1. */
export function usagesFor(c: ThemeColors, size: { heading: number }): Usage[] {
  const U = (id: string, role: Role, fg: Hex, bg: Hex, required: number, accent = false): Usage => ({ id, role, fg, bg, required, accent });
  const headReq = size.heading >= 36 ? 3 : 4.5;
  return [
    U("display:textPrimary/background", "display", c.textPrimary, c.background, 3),
    U("heading:textPrimary/background", "heading", c.textPrimary, c.background, headReq),
    U("body:textPrimary/surface", "body", c.textPrimary, c.surface, 4.5),
    U("body:textPrimary/surfaceRaised", "body", c.textPrimary, c.surfaceRaised, 4.5),
    U("caption:textSecondary/background", "caption", c.textSecondary, c.background, 4.5),
    U("caption:textSecondary/surface", "caption", c.textSecondary, c.surface, 4.5),
    U("display:accent/background", "display", c.accent, c.background, 3, true),
    U("heading:accent/background", "heading", c.accent, c.background, headReq, true),
    U("caption:accent/background", "caption", c.accent, c.background, 4.5, true),
    U("display:accentSecondary/background", "display", c.accentSecondary, c.background, 3, true),
    U("caption:accentSecondary/background", "caption", c.accentSecondary, c.background, 4.5, true),
  ];
}

/** Repair ladder: (1) accent usages -> accent-filled pill with the best mono text (keeps the brand colour);
 *  (2) swap TEXT colour to #FFFFFF/#09090B; (3) opaque-ish scrim behind mono text. Verified after each step. */
export function repairUsage(u: Usage): UsageResult {
  const before = contrastRatio(u.fg, u.bg);
  const done = (action: UsageResult["action"], fg: Hex, bg: Hex, backing: Backing): UsageResult => ({ id: u.id, role: u.role, fg: u.fg, bg: u.bg, ratioBefore: before, ratioAfter: contrastRatio(fg, bg), required: u.required, passed: contrastRatio(fg, bg) >= u.required, action, finalFg: fg, backing });
  if (before >= u.required) return done("none", u.fg, u.bg, { kind: "none" });
  if (u.accent) { const t = bestMono(u.fg); if (contrastRatio(t, u.fg) >= u.required) return done("pill", t, u.fg, { kind: "pill", color: u.fg, opacity: 1 }); }
  const swap = bestMono(u.bg); if (contrastRatio(swap, u.bg) >= u.required) return done("swap-text", swap, u.bg, { kind: "none" });
  const scrimColor = contrastRatio(WHITE, u.bg) >= contrastRatio(CARBON, u.bg) ? CARBON : WHITE; const composite = over(scrimColor, u.bg, 0.86); const t = bestMono(composite);
  return done("scrim", t, composite, { kind: "scrim", color: scrimColor, opacity: 0.86 });
}
export function auditColors(c: ThemeColors, mode: ModeReport["mode"], headingSize: number): ModeReport {
  const results = usagesFor(c, { heading: headingSize }).map(repairUsage);
  const repairs: Repair[] = results.filter(r => r.action !== "none").map(r => ({ usage: r.id, action: r.action as Repair["action"], from: r.fg, to: r.action === "swap-text" ? r.finalFg : (r.backing.kind === "none" ? r.finalFg : r.backing.color), ratioBefore: r.ratioBefore, ratioAfter: r.ratioAfter }));
  return { mode, colors: c, results, repairs };
}
/** Light<->dark flip for alternating scene modes (background<->textPrimary; surfaces re-derived). */
export function invertColors(c: ThemeColors): ThemeColors {
  const background = c.textPrimary, textPrimary = c.background;
  return { background, textPrimary, surface: mix(background, textPrimary, 0.07), surfaceRaised: mix(background, textPrimary, 0.13), textSecondary: mix(textPrimary, background, 0.32), accent: c.accent, accentSecondary: c.accentSecondary, border: mix(background, textPrimary, 0.2) };
}

/* ---------- surface emission ---------- */
export interface SurfaceCss { readonly background: string; readonly border: string; readonly boxShadow: string; readonly backdropFilter: string; readonly extra: string }
const rgba = (hex: string, a: number): string => { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; };
/** CSS for a SURFACE (card/panel). backdropFilter belongs to surfaces only, never to a typography ancestor. */
export function surfaceCss(s: SurfaceStyle, c: ThemeColors): SurfaceCss {
  switch (s.kind) {
    case "minimal": return { background: c.surface, border: `${s.borderPx}px solid ${c.border}`, boxShadow: "none", backdropFilter: "none", extra: "" };
    case "glass": return { background: rgba(c.surface, s.opacity), border: `1px solid ${rgba(c.textPrimary, 0.14 + 0.2 * s.refractionStrength)}`, boxShadow: `0 24px 60px ${rgba(c.background === WHITE ? CARBON : "#000000", 0.18)}, inset 0 1px 0 ${rgba(WHITE, 0.35 * s.refractionStrength + 0.1)}`, backdropFilter: `blur(${s.blurPx}px) saturate(${(1 + s.refractionStrength).toFixed(2)})`, extra: "" };
    case "clay": return { background: c.surfaceRaised, border: "none", boxShadow: `${s.extrusionPx}px ${s.extrusionPx}px ${s.extrusionPx * 2}px ${rgba(mix(c.background, CARBON, 0.35), 0.55)}, -${s.extrusionPx / 2}px -${s.extrusionPx / 2}px ${s.extrusionPx * 1.5}px ${rgba(WHITE, 0.4 + 0.5 * s.highlightStrength)}, inset 0 ${Math.round(s.extrusionPx / 3)}px ${Math.round(s.extrusionPx / 2)}px ${rgba(WHITE, 0.5 * s.highlightStrength)}`, backdropFilter: "none", extra: "" };
    case "neumorphism": { const a = (s.lightDirectionDeg * Math.PI) / 180, dx = Math.round(Math.cos(a) * s.depthPx), dy = Math.round(-Math.sin(a) * s.depthPx); return { background: c.surface, border: "none", boxShadow: `${-dx}px ${-dy}px ${s.depthPx * 1.6}px ${rgba(mix(c.surface, WHITE, 0.7), 0.9)}, ${dx}px ${dy}px ${s.depthPx * 1.6}px ${rgba(mix(c.surface, CARBON, 0.3), 0.7)}`, backdropFilter: "none", extra: "" }; }
    case "holo": return { background: `linear-gradient(135deg,${rgba(c.surfaceRaised, 0.9)},${rgba(c.surface, 0.9)})`, border: `1px solid ${rgba(c.accent, 0.5 + 0.4 * s.glowStrength)}`, boxShadow: `0 0 ${Math.round(40 * s.glowStrength)}px ${rgba(c.accent, 0.45 * s.glowStrength)}, inset 0 0 ${Math.round(30 * s.glowStrength)}px ${rgba(c.accentSecondary, 0.25 * s.glowStrength)}`, backdropFilter: "none", extra: `background-image:repeating-linear-gradient(0deg,${rgba(c.accent, 0.1 * s.scanlineStrength)} 0 1px,transparent 1px 4px);` };
    case "liquid": return { background: `radial-gradient(120% 120% at 30% 15%,${rgba(WHITE, 0.55 * s.glossStrength)},${rgba(c.surfaceRaised, 0.85)} 55%,${rgba(c.surface, 0.9)})`, border: `1px solid ${rgba(c.textPrimary, 0.12)}`, boxShadow: `0 ${s.distortionPx}px ${s.distortionPx * 3}px ${rgba(CARBON, 0.18)}, inset 0 2px ${s.distortionPx / 2}px ${rgba(WHITE, 0.6 * s.glossStrength)}`, backdropFilter: `blur(${Math.round(s.distortionPx / 2)}px)`, extra: "" };
  }
}

/* ---------- compile ---------- */
export interface RoleStyle { readonly role: Role; readonly color: Hex; readonly accentColor: Hex; readonly backing: Backing; readonly accentBacking: Backing }
export interface CompiledTheme {
  readonly tokens: BrandThemeTokens; readonly hash: string; readonly modes: readonly [ModeReport, ModeReport]; readonly roles: Readonly<Record<Role, RoleStyle>>;
  readonly repairs: readonly Repair[]; readonly passed: boolean; readonly css: string; readonly surface: SurfaceCss;
}
export class ThemeContrastError extends Error { constructor(readonly failing: readonly UsageResult[]) { super(`contrast repair failed: ${failing.map(f => `${f.id} ${f.ratioAfter.toFixed(2)}<${f.required}`).join("; ")}`); } }

export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map(k => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
export const themeHash = (t: BrandThemeTokens): string => createHash("sha256").update(COMPILER_VERSION + stableStringify(t)).digest("hex");

export function compileTheme(input: BrandThemeInput | BrandThemeTokens): CompiledTheme {
  const tokens = BrandThemeTokens.parse(input); const logoBefore = JSON.stringify(tokens.logo ?? null);
  const primary = auditColors(tokens.color, "primary", tokens.typography.heading.size);
  const inverted = auditColors(invertColors(tokens.color), "inverted", tokens.typography.heading.size);
  const failing = [...primary.results, ...inverted.results].filter(r => !r.passed); if (failing.length) throw new ThemeContrastError(failing);
  const pick = (id: string): UsageResult => primary.results.find(r => r.id === id) as UsageResult;
  const role = (r: Role, textId: string, accentId: string): RoleStyle => { const t = pick(textId), a = pick(accentId); return { role: r, color: t.finalFg, accentColor: a.finalFg, backing: t.backing, accentBacking: a.backing }; };
  const roles: Record<Role, RoleStyle> = {
    display: role("display", "display:textPrimary/background", "display:accent/background"),
    heading: role("heading", "heading:textPrimary/background", "heading:accent/background"),
    body: role("body", "body:textPrimary/surface", "caption:accent/background"),
    caption: role("caption", "caption:textSecondary/background", "caption:accent/background"),
  };
  if (JSON.stringify(tokens.logo ?? null) !== logoBefore) throw new Error("invariant: logo mutated");
  const surface = surfaceCss(tokens.surface, tokens.color); const c = tokens.color;
  const css = [":root{", ...Object.entries(c).map(([k, v]) => `--c-${k.replace(/[A-Z]/g, m => "-" + m.toLowerCase())}:${v};`),
    ...(["display", "heading", "body", "caption"] as const).flatMap(k => { const f = tokens.typography[k]; return [`--t-${k}-family:${f.family};`, `--t-${k}-size:${f.size}px;`, `--t-${k}-weight:${f.weight};`, `--t-${k}-lh:${f.lineHeight};`, `--role-${k}-color:${roles[k].color};`, `--role-${k}-accent:${roles[k].accentColor};`]; }),
    `--surface-bg:${surface.background};--surface-border:${surface.border};--surface-shadow:${surface.boxShadow};`, `--grid-px:${tokens.backdrop.gridPx}px;`, "}"].join("\n");
  return { tokens, hash: themeHash(tokens), modes: [primary, inverted], roles, repairs: [...primary.repairs, ...inverted.repairs], passed: true, css, surface };
}
