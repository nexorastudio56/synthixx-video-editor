/**
 * Linear-light brand colour grade (pure, deterministic, browser + Node).
 *   srgbToLinear -> luminance (Rec.709 coefficients) -> palette ramp (interpolated in LINEAR light) -> linearToSrgb.
 * strict-duotone      shadows -> theme background, 18% mid-grey -> accent, highlights -> white.      (abstract tech B-roll, icons)
 * palette-harmonize   luminance-preserving bias of every pixel toward the ramp colour; legibility kept.
 * natural             identity (skin tones / UI recordings stay untouched; the brand lives in the frame around them).
 */
export type GradeMode = "strict-duotone" | "palette-harmonize" | "natural";
export interface GradePalette { readonly shadow: string; readonly mid: string; readonly highlight: string; readonly midStop?: number }
export const DEFAULT_PALETTE: GradePalette = { shadow: "#09090B", mid: "#E60000", highlight: "#FFFFFF", midStop: 0.18 };
export const HARMONIZE_STRENGTH = 0.55;

export const srgbToLinear = (c8: number): number => { const c = c8 / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
export const linearToSrgb = (l: number): number => { const x = Math.min(1, Math.max(0, l)); return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055; };
export const luminanceLinear = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const hexLin = (h: string): [number, number, number] => [srgbToLinear(parseInt(h.slice(1, 3), 16)), srgbToLinear(parseInt(h.slice(3, 5), 16)), srgbToLinear(parseInt(h.slice(5, 7), 16))];
const LUT = new Float64Array(256).map((_, i) => srgbToLinear(i));

/** Ramp colour (linear RGB) at linear luminance y in [0,1]. */
export function rampLinear(y: number, p: GradePalette): [number, number, number] {
  const s = hexLin(p.shadow), m = hexLin(p.mid), h = hexLin(p.highlight), stop = p.midStop ?? 0.18, t = Math.min(1, Math.max(0, y));
  const [a, b, u] = t <= stop ? [s, m, t / stop] : [m, h, (t - stop) / (1 - stop)]; return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}
const to8 = (l: number): number => Math.round(linearToSrgb(l) * 255);
export function makeGrader(mode: GradeMode, p: GradePalette = DEFAULT_PALETTE, strength: number = HARMONIZE_STRENGTH): (r: number, g: number, b: number) => [number, number, number] {
  if (mode === "natural") return (r, g, b) => [r, g, b];
  if (mode === "strict-duotone") { const N = 4096, lut = new Uint8Array(N * 3); for (let i = 0; i < N; i++) { const c = rampLinear(i / (N - 1), p); lut[i * 3] = to8(c[0]); lut[i * 3 + 1] = to8(c[1]); lut[i * 3 + 2] = to8(c[2]); }
    return (r, g, b) => { const y = luminanceLinear(LUT[r], LUT[g], LUT[b]), i = Math.round(Math.min(1, Math.max(0, y)) * (N - 1)) * 3; return [lut[i], lut[i + 1], lut[i + 2]]; }; }
  return (r, g, b) => {
    const c: [number, number, number] = [LUT[r], LUT[g], LUT[b]], y = luminanceLinear(c[0], c[1], c[2]), ramp = rampLinear(y, p), yr = luminanceLinear(ramp[0], ramp[1], ramp[2]);
    const tinted = yr > 1e-6 ? ramp.map(v => v * (y / yr)) : c; const mixed = c.map((v, k) => v * (1 - strength) + tinted[k] * strength); const ym = luminanceLinear(mixed[0], mixed[1], mixed[2]);
    const k = ym > 1e-6 ? y / ym : 1; return [to8(mixed[0] * k), to8(mixed[1] * k), to8(mixed[2] * k)];
  };
}
export const gradePixel = (r: number, g: number, b: number, mode: GradeMode, p: GradePalette = DEFAULT_PALETTE, strength?: number): [number, number, number] => makeGrader(mode, p, strength)(r, g, b);
/** In-place grade of RGBA bytes (alpha untouched). */
export function gradeImageData(data: Uint8ClampedArray | Uint8Array, mode: GradeMode, p: GradePalette = DEFAULT_PALETTE, strength?: number): void {
  if (mode === "natural") return; const f = makeGrader(mode, p, strength);
  for (let i = 0; i < data.length; i += 4) { const o = f(data[i], data[i + 1], data[i + 2]); data[i] = o[0]; data[i + 1] = o[1]; data[i + 2] = o[2]; }
}
/** SVG filter (linearRGB) approximating the duotone ramp with a 64-step table; for CSS-only paths. The canvas grader above is the exact reference. */
export function svgDuotoneFilter(id: string, p: GradePalette = DEFAULT_PALETTE): string {
  const N = 64, ch = [0, 1, 2].map(k => Array.from({ length: N }, (_, i) => rampLinear(i / (N - 1), p)[k].toFixed(5)).join(" "));
  return `<filter id="${id}" color-interpolation-filters="linearRGB"><feColorMatrix type="matrix" values="0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0 0 0 1 0"/><feComponentTransfer><feFuncR type="table" tableValues="${ch[0]}"/><feFuncG type="table" tableValues="${ch[1]}"/><feFuncB type="table" tableValues="${ch[2]}"/></feComponentTransfer></filter>`;
}
