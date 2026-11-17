/** Six curated presets. Every one is a plain BrandThemeTokens object. */
import { BrandThemeTokens, type BrandThemeInput } from "./themeSchema.js";

const F = (family: string, size: number, weight: number, lineHeight: number, letterSpacingEm = 0) => ({ family, size, weight, lineHeight, letterSpacingEm });
const sans = "Inter, 'DejaVu Sans', sans-serif";
const RAW: Record<string, BrandThemeInput> = {
  apple_minimal: {
    id: "apple_minimal", name: "Apple Minimal",
    color: { background: "#F8FAFC", surface: "#F1F5F9", surfaceRaised: "#FFFFFF", textPrimary: "#0F172A", textSecondary: "#475569", accent: "#2563EB", accentSecondary: "#94A3B8", border: "#E2E8F0" },
    surface: { kind: "minimal", borderPx: 1 },
    typography: { display: F(sans, 120, 700, 1.02, -0.03), heading: F(sans, 68, 600, 1.1, -0.015), body: F(sans, 38, 400, 1.4), caption: F(sans, 30, 500, 1.3) },
    motion: { personality: "luxury-slow", defaultEasing: "expo_out", transitionFrames: 30, holdFrames: 96, shakeIntensity: 0 },
    layout: { density: "airy", safeMarginX: 0.09, safeMarginTop: 0.16, safeMarginBottom: 0.22, captionBackground: "none" },
    backdrop: { gridPx: 0, orbBlurPx: 160, orbOpacity: 0.16, alternateModes: false },
  },
  cyberpunk_holo: {
    id: "cyberpunk_holo", name: "Cyberpunk Holo",
    color: { background: "#030305", surface: "#0B0B14", surfaceRaised: "#14142A", textPrimary: "#F8FAFC", textSecondary: "#A5B4FC", accent: "#00F5D4", accentSecondary: "#9B5DE5", border: "#2A2A4A" },
    surface: { kind: "holo", scanlineStrength: 0.35, glowStrength: 0.8 },
    typography: { display: F("'Space Grotesk', Inter, sans-serif", 128, 800, 1.0, -0.01), heading: F("'Space Grotesk', Inter, sans-serif", 72, 700, 1.08), body: F(sans, 38, 500, 1.3), caption: F("'JetBrains Mono', monospace", 30, 600, 1.25) },
    motion: { personality: "viral-fast", defaultEasing: "spring", transitionFrames: 6, holdFrames: 12, shakeIntensity: 0.6 },
    layout: { density: "compact", safeMarginX: 0.06, safeMarginTop: 0.13, safeMarginBottom: 0.19, captionBackground: "pill" },
    backdrop: { gridPx: 40, orbBlurPx: 90, orbOpacity: 0.5, alternateModes: false },
  },
  fintech_emerald: {
    id: "fintech_emerald", name: "FinTech Emerald",
    color: { background: "#062016", surface: "#0B2F22", surfaceRaised: "#10402F", textPrimary: "#FFFFFF", textSecondary: "#A7F3D0", accent: "#10B981", accentSecondary: "#34D399", border: "#14614A" },
    surface: { kind: "glass", blurPx: 28, opacity: 0.6, refractionStrength: 0.3 },
    typography: { display: F(sans, 124, 800, 1.02, -0.02), heading: F(sans, 70, 700, 1.1), body: F(sans, 38, 500, 1.35), caption: F(sans, 32, 600, 1.25) },
    motion: { personality: "explainer-medium", defaultEasing: "ease_in_out", transitionFrames: 18, holdFrames: 48, shakeIntensity: 0.1 },
    layout: { density: "balanced", safeMarginX: 0.07, safeMarginTop: 0.14, safeMarginBottom: 0.2, captionBackground: "scrim" },
    backdrop: { gridPx: 56, orbBlurPx: 120, orbOpacity: 0.36, alternateModes: false },
  },
  playful_clay: {
    id: "playful_clay", name: "Playful Clay",
    color: { background: "#EEF2FF", surface: "#E0E7FF", surfaceRaised: "#FFFFFF", textPrimary: "#1E293B", textSecondary: "#475569", accent: "#F43F5E", accentSecondary: "#4F46E5", border: "#C7D2FE" },
    surface: { kind: "clay", extrusionPx: 18, highlightStrength: 0.7 },
    typography: { display: F("Poppins, Inter, sans-serif", 128, 800, 1.02), heading: F("Poppins, Inter, sans-serif", 72, 700, 1.1), body: F("Poppins, Inter, sans-serif", 38, 500, 1.35), caption: F("Poppins, Inter, sans-serif", 32, 600, 1.25) },
    motion: { personality: "explainer-medium", defaultEasing: "spring", transitionFrames: 16, holdFrames: 40, shakeIntensity: 0.15 },
    layout: { density: "airy", safeMarginX: 0.08, safeMarginTop: 0.15, safeMarginBottom: 0.21, captionBackground: "pill" },
    backdrop: { gridPx: 0, orbBlurPx: 100, orbOpacity: 0.3, alternateModes: false },
  },
  noir_documentary: {
    id: "noir_documentary", name: "Noir Documentary",
    color: { background: "#121214", surface: "#1B1B1F", surfaceRaised: "#26262B", textPrimary: "#F5F5F4", textSecondary: "#A8A29E", accent: "#DC2626", accentSecondary: "#78716C", border: "#3F3F46" },
    surface: { kind: "minimal", borderPx: 1 },
    typography: { display: F("'Playfair Display', Georgia, serif", 120, 700, 1.04, -0.01), heading: F("'Playfair Display', Georgia, serif", 68, 600, 1.12), body: F(sans, 36, 400, 1.45), caption: F(sans, 30, 500, 1.3, 0.02) },
    motion: { personality: "luxury-slow", defaultEasing: "ease_in_out", transitionFrames: 36, holdFrames: 120, shakeIntensity: 0.05 },
    layout: { density: "airy", safeMarginX: 0.09, safeMarginTop: 0.16, safeMarginBottom: 0.22, captionBackground: "scrim" },
    backdrop: { gridPx: 0, orbBlurPx: 140, orbOpacity: 0.14, alternateModes: false },
  },
};
export const PRESET_IDS = ["apple_minimal", "cyberpunk_holo", "fintech_emerald", "playful_clay", "noir_documentary"] as const;
export type PresetId = (typeof PRESET_IDS)[number];
export const DEFAULT_PRESET: PresetId = "apple_minimal";
export const PRESETS: Readonly<Record<PresetId, BrandThemeTokens>> = Object.freeze(Object.fromEntries(PRESET_IDS.map(id => [id, BrandThemeTokens.parse(RAW[id])])) as Record<PresetId, BrandThemeTokens>);
export function getPreset(id: string): BrandThemeTokens {
  if (!(PRESET_IDS as readonly string[]).includes(id)) throw new Error(`unknown preset "${id}". Available: ${PRESET_IDS.join(", ")}`);
  return structuredClone(PRESETS[id as PresetId]);
}
