/**
 * LayerCompositor - strict 4-layer contract.
 *   L0 BackdropLayer          (z 0)  background, grid, PRE-BLURRED orbs (the blur lives on the orb itself, never an ancestor of text)
 *   L1 Hero3DStageLayer       (z 10) single shared WebGL/3D slot, pointer-events:none
 *   L3 FinishingOverlay       (z 20) vignette + <=1% grain, painted BENEATH L2
 *   L2 CrispTypographyUILayer (z 30) all text/UI/charts/logos: no filter / backdrop-filter / WebGL tone-mapping on it or any ancestor
 * DOM order is L0, L1, L3, L2 so text is always the top-most paint, and L2 is a direct child of the root (its ancestor chain is root -> L2 only).
 */
import * as React from "react";
import { LAYERS, GRAIN_MAX_OPACITY, vignetteCss } from "./layerSpec.js";

export interface Orb { readonly cx: number; readonly cy: number; readonly size: number; readonly color: string; readonly blurPx: number }
export interface LayerCompositorProps {
  readonly width: number; readonly height: number;
  readonly canvasColor: string; readonly gridColor: string; readonly gridPx?: number; readonly orbs?: readonly Orb[];
  readonly vignette?: number; readonly grainOpacity?: number; readonly grainSrc?: string; readonly grainOffset?: { readonly x: number; readonly y: number };
  readonly stage3D?: React.ReactNode; readonly canvasRef?: React.Ref<HTMLCanvasElement>;
  readonly children?: React.ReactNode; // L2 content
}
const fill: React.CSSProperties = { position: "absolute", left: 0, top: 0, width: "100%", height: "100%" };

export function BackdropLayer(p: Pick<LayerCompositorProps, "canvasColor" | "gridColor" | "gridPx" | "orbs">): React.ReactElement {
  const g = p.gridPx ?? 48;
  return (
    <div data-layer={LAYERS.L0.id} style={{ ...fill, zIndex: LAYERS.L0.z, background: p.canvasColor, overflow: "hidden" }}>
      {(p.orbs ?? []).map((o, i) => (
        <div key={i} style={{ position: "absolute", left: o.cx - o.size / 2, top: o.cy - o.size / 2, width: o.size, height: o.size, borderRadius: "50%", background: o.color, filter: `blur(${o.blurPx}px)` }} />
      ))}
      <div style={{ ...fill, backgroundImage: `linear-gradient(${p.gridColor} 1px,transparent 1px),linear-gradient(90deg,${p.gridColor} 1px,transparent 1px)`, backgroundSize: `${g}px ${g}px` }} />
    </div>
  );
}
export function Hero3DStageLayer(p: { readonly width: number; readonly height: number; readonly canvasRef?: React.Ref<HTMLCanvasElement>; readonly children?: React.ReactNode }): React.ReactElement {
  return (
    <div data-layer={LAYERS.L1.id} style={{ ...fill, zIndex: LAYERS.L1.z, pointerEvents: "none" }}>
      <canvas ref={p.canvasRef} width={p.width} height={p.height} style={{ ...fill }} />
      {p.children}
    </div>
  );
}
export function FinishingOverlay(p: Pick<LayerCompositorProps, "vignette" | "grainOpacity" | "grainSrc" | "grainOffset" | "width" | "height">): React.ReactElement {
  const grain = Math.min(p.grainOpacity ?? GRAIN_MAX_OPACITY, GRAIN_MAX_OPACITY); // hard cap: <= 1%
  const o = p.grainOffset ?? { x: 0, y: 0 };
  return (
    <div data-layer={LAYERS.L3.id} style={{ ...fill, zIndex: LAYERS.L3.z, pointerEvents: "none", overflow: "hidden" }}>
      <div style={{ ...fill, background: vignetteCss(p.vignette ?? 0.14) }} />
      {p.grainSrc ? <div style={{ position: "absolute", left: -256 + o.x, top: -256 + o.y, width: p.width + 512, height: p.height + 512, backgroundImage: `url(${p.grainSrc})`, backgroundSize: "256px", opacity: grain }} /> : null}
    </div>
  );
}
export function CrispTypographyUILayer(p: { readonly children: React.ReactNode }): React.ReactElement {
  // No filter / backdrop-filter / mix-blend / mask here, and it is a direct child of the root (no filtered ancestor).
  return <div data-layer={LAYERS.L2.id} style={{ ...fill, zIndex: LAYERS.L2.z, textRendering: "geometricPrecision" }}>{p.children}</div>;
}
export function LayerCompositor(p: LayerCompositorProps): React.ReactElement {
  return (
    <div data-layer-root style={{ position: "relative", width: p.width, height: p.height, overflow: "hidden" }}>
      <BackdropLayer canvasColor={p.canvasColor} gridColor={p.gridColor} gridPx={p.gridPx} orbs={p.orbs} />
      <Hero3DStageLayer width={p.width} height={p.height} canvasRef={p.canvasRef}>{p.stage3D}</Hero3DStageLayer>
      <FinishingOverlay vignette={p.vignette} grainOpacity={p.grainOpacity} grainSrc={p.grainSrc} grainOffset={p.grainOffset} width={p.width} height={p.height} />
      <CrispTypographyUILayer>{p.children}</CrispTypographyUILayer>
    </div>
  );
}

export { auditCrispText } from "./audit.js";
