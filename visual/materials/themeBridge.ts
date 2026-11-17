/**
 * Theme bridge: BrandThemeTokens (styles/*) -> the brand morphism renderer (Profile + live Palette).
 * One component set, any tenant: archetypes read colours only from c.profile.vars / BRAND (live palette).
 */
import type { BrandThemeTokens } from "../../styles/themeSchema.js";
import { compileTheme, surfaceCss, mix, luminance, hexToRgb, themeHash, contrastRatio, type CompiledTheme } from "../../styles/themeCompiler.js";
import type { ThemeColors } from "../../styles/themeSchema.js";
import type { Profile } from "./morphismProfiles.js";
import { DEFAULT_PALETTE, type BrandMode, type Palette } from "./brandTheme.js";

const cache = new Map<string, CompiledTheme>();
export function compiledFor(t: BrandThemeTokens): CompiledTheme {
  const k = themeHash(t); let c = cache.get(k); if (!c) { c = compileTheme(t); cache.set(k, c); } return c;
}
const rgba = (hex: string, a: number): string => { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${+a.toFixed(3)})`; };
export const isDarkColor = (hex: string): boolean => luminance(hex) < 0.3;

/** Accent used as TEXT must clear 4.5:1 (margin for orbs behind glyphs; display minimum is 3:1) on the scene background; shade it toward black/white until it does. Glows keep the pure brand accent. */
export function textSafeAccent(accent: string, bg: string, min = 4.5): string {
  const toward = luminance(bg) > 0.5 ? "#000000" : "#FFFFFF"; let a = accent;
  for (let t = 0; t <= 1.0001 && contrastRatio(a, bg) < min; t += 0.04) a = mix(accent, toward, t);
  return a;
}
export interface SceneLook { readonly mode: BrandMode; readonly colors: ThemeColors; readonly palette: Palette; readonly profile: Profile }

/** primary/inverted selection: alternate per scene when backdrop.alternateModes, else always primary. An explicit scene.theme only matters when alternating. */
export function lookFor(t: BrandThemeTokens, sceneIndex: number, explicit?: BrandMode): SceneLook {
  const comp = compiledFor(t); const alt = t.backdrop.alternateModes;
  const pDark = isDarkColor(comp.modes[0].colors.background);
  let inv = alt && sceneIndex % 2 === 1;
  if (alt && explicit) inv = (explicit === "canvas_dark") !== pDark;
  const colors = comp.modes[inv ? 1 : 0].colors; const dark = isDarkColor(colors.background);
  const mode: BrandMode = dark ? "canvas_dark" : "canvas_light";
  const o = t.backdrop.orbOpacity, acc = textSafeAccent(colors.accent, colors.background), glowAcc = colors.accent, hi = mix(acc, "#FFFFFF", 0.18), sec = colors.accentSecondary;
  const lighter = luminance(colors.background) >= luminance(colors.textPrimary);
  const palette: Palette = {
    light: lighter ? colors.background : colors.textPrimary, dark: lighter ? colors.textPrimary : colors.background,
    acc, hi, glow: rgba(glowAcc, o), crimson: rgba(sec, Math.min(0.9, o * 1.48)), deep: rgba(mix(sec, "#000000", 0.35), Math.min(0.9, o * 1.3)), soft: rgba(hi, o * 0.72),
    ok: DEFAULT_PALETTE.ok, base: colors.background, gridPx: t.backdrop.gridPx, orbBlur: t.backdrop.orbBlurPx, accRgb: hexToRgb(glowAcc),
  };
  return { mode, colors, palette, profile: profileFromTheme(t, colors, dark, palette) };
}

const RADIUS: Record<BrandThemeTokens["surface"]["kind"], number> = { minimal: 18, glass: 30, clay: 44, neumorphism: 36, holo: 22, liquid: 54 };
export function profileFromTheme(t: BrandThemeTokens, c: ThemeColors, dark: boolean, pal: Palette): Profile {
  const s = surfaceCss(t.surface, c); const r = RADIUS[t.surface.kind]; const pill = `linear-gradient(90deg,${c.accentSecondary},${c.accent})`;
  const ink = c.textPrimary, inkOnAcc = luminance(c.accent) > 0.4 ? "#09090B" : "#FFFFFF";
  return {
    id: "brand", dark,
    vars: { "--ink": ink, "--ink2": c.textSecondary, "--acc": pal.acc, "--acc2": c.accentSecondary, "--hot": pal.acc, "--ok": ink, "--bad": pal.acc, "--r": `${r}px`, "--glow": pal.glow, "--card": c.surface, "--paper": c.background, "--on-acc": inkOnAcc },
    css: `
.m-surf{background:${s.background};border:${s.border};border-radius:var(--r);box-shadow:${s.boxShadow};${s.backdropFilter !== "none" ? `backdrop-filter:${s.backdropFilter};` : ""}overflow:hidden;${s.extra}}
.m-surf::after{content:'';position:absolute;inset:0;background:radial-gradient(120% 55% at 0% 0%,${rgba(c.accent, dark ? 0.12 : 0.07)},transparent 60%);pointer-events:none}
.m-inset{background:${rgba(ink, 0.07)};border-radius:999px;box-shadow:inset 0 2px 7px ${rgba(dark ? "#000000" : ink, dark ? 0.7 : 0.14)}}
.m-pill{background:${pill};box-shadow:0 0 28px ${pal.glow};color:${inkOnAcc}}
.m-led{background:var(--ok)}
.m-chip{background:${c.surfaceRaised};border:1px solid ${c.border};box-shadow:0 12px 26px ${rgba(dark ? "#000000" : ink, dark ? 0.5 : 0.12)}}
.m-glow{text-shadow:0 0 34px ${pal.glow}}`,
    motion: { enterFrom: { opacity: 0, y: 70, scale: 0.94, rotationX: 14 }, enterEase: t.motion.defaultEasing === "linear" ? "none" : t.motion.defaultEasing === "ease_in_out" ? "power2.inOut" : "expo.out", enterDur: t.motion.personality === "luxury-slow" ? 0.95 : t.motion.personality === "viral-fast" ? 0.5 : 0.7, press: 0.965, floatAmp: t.motion.personality === "luxury-slow" ? 4 : 6, floatPer: 2.8, stagger: t.motion.personality === "viral-fast" ? 0.07 : 0.11 },
    bg: () => ({ html: "", css: "", js: "" }),
  };
}
