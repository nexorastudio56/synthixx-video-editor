/** Shared 4-layer contract constants (used by both the React compositor and the HTML composer). Paint order is z-index, bottom -> top. */
export const LAYERS = {
  L0: { id: "L0-backdrop", z: 0, role: "Background canvas, grid, pre-blurred ambient orbs, subtle shaders" },
  L1: { id: "L1-hero3d", z: 10, role: "Single shared WebGL/3D/physics canvas slot (pointer-events:none)" },
  L3: { id: "L3-finishing", z: 20, role: "Vignette + <=1% grain, painted BENEATH the typography layer" },
  L2: { id: "L2-typography", z: 30, role: "Hero statements, kinetic titles, captions, charts, logos: pure sharp DOM/SVG" },
} as const;
export const GRAIN_MAX_OPACITY = 0.01;
/** CSS properties that must never appear on L2 or any of its ancestors (they would soften or tone-map text). */
export const FORBIDDEN_ON_TEXT_PATH = ["filter", "backdrop-filter", "-webkit-backdrop-filter", "mix-blend-mode", "mask-image", "-webkit-mask-image", "opacity-via-filter"] as const;
export const vignetteCss = (strength: number) => `radial-gradient(ellipse at 50% 46%,rgba(0,0,0,0) 56%,rgba(9,9,11,${strength.toFixed(3)}) 100%)`;
