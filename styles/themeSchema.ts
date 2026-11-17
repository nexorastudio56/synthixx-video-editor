/** BrandThemeTokens: the single data contract every component reads. Any user style = one validated token object (no template forks). */
import { z } from "zod";

export const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "expected #RRGGBB").transform(s => s.toUpperCase());
export type Hex = z.infer<typeof Hex>;

export const ThemeColors = z.object({
  background: Hex, surface: Hex, surfaceRaised: Hex, textPrimary: Hex, textSecondary: Hex, accent: Hex, accentSecondary: Hex, border: Hex,
});
export type ThemeColors = z.infer<typeof ThemeColors>;

const unit = z.number().min(0).max(1);
export const SurfaceStyle = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("minimal"), borderPx: z.number().min(0).max(6).default(1) }),
  z.object({ kind: z.literal("glass"), blurPx: z.number().min(0).max(80), opacity: unit, refractionStrength: unit }),
  z.object({ kind: z.literal("clay"), extrusionPx: z.number().min(0).max(48), highlightStrength: unit }),
  z.object({ kind: z.literal("neumorphism"), depthPx: z.number().min(0).max(40), lightDirectionDeg: z.number().min(0).max(360) }),
  z.object({ kind: z.literal("holo"), scanlineStrength: unit, glowStrength: unit }),
  z.object({ kind: z.literal("liquid"), distortionPx: z.number().min(0).max(40), glossStrength: unit }),
]);
export type SurfaceStyle = z.infer<typeof SurfaceStyle>;
export const SURFACE_KINDS = ["minimal", "glass", "clay", "neumorphism", "holo", "liquid"] as const;
export type SurfaceKind = (typeof SURFACE_KINDS)[number];

const font = (minSize: number, maxSize: number) => z.object({
  family: z.string().min(1).max(80), size: z.number().min(minSize).max(maxSize), weight: z.number().int().min(100).max(900), lineHeight: z.number().min(0.9).max(2), letterSpacingEm: z.number().min(-0.1).max(0.3),
});
export const Typography = z.object({ display: font(56, 220), heading: font(32, 120), body: font(24, 64), caption: font(20, 56) });
export type Typography = z.infer<typeof Typography>;

export const Personality = z.enum(["viral-fast", "explainer-medium", "luxury-slow"]);
export type Personality = z.infer<typeof Personality>;
export const Motion = z.object({
  personality: Personality, defaultEasing: z.enum(["spring", "expo_out", "ease_in_out", "linear"]),
  transitionFrames: z.number().int().min(2).max(90), holdFrames: z.number().int().min(0).max(360), shakeIntensity: unit,
});
export type Motion = z.infer<typeof Motion>;

export const Layout = z.object({
  density: z.enum(["compact", "balanced", "airy"]), safeMarginX: z.number().min(0.02).max(0.25), safeMarginTop: z.number().min(0.02).max(0.3), safeMarginBottom: z.number().min(0.02).max(0.35),
  captionBackground: z.enum(["none", "pill", "scrim", "solid"]),
});
export type Layout = z.infer<typeof Layout>;

export const Backdrop = z.object({ gridPx: z.number().int().min(0).max(160), orbBlurPx: z.number().min(0).max(240), orbOpacity: unit, alternateModes: z.boolean() });
export type Backdrop = z.infer<typeof Backdrop>;

export const Logo = z.object({ path: z.string().min(1), sha256: z.string().regex(/^[0-9a-f]{64}$/).optional() });
export type Logo = z.infer<typeof Logo>;

export const BrandThemeTokens = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{1,47}$/), name: z.string().min(1).max(60),
  color: ThemeColors, surface: SurfaceStyle, typography: Typography, motion: Motion, layout: Layout, backdrop: Backdrop, logo: Logo.optional(),
});
export type BrandThemeTokens = z.infer<typeof BrandThemeTokens>;
export type BrandThemeInput = z.input<typeof BrandThemeTokens>;
