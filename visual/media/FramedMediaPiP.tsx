/**
 * FramedMediaPiP: external screen-recording / B-roll inside a perspective-tilted glass-bevel card (rotateY(-10deg) rotateX(5deg)), soft cast shadow, accent border glow.
 * The shown image is source frame K = sourceFrameIndex(globalFrame): pre-extracted by exact native index (frameExtractor.ts), never a playing <video>.
 */
import * as React from "react";
import { sourceFrameIndex, frameFileName, type MediaClock } from "./mediaTiming.js";
import { BrandColorGrade } from "./BrandColorGrade.js";
import type { GradeMode, GradePalette } from "./colorGrade.js";
import type { FrameBarrier } from "../../core/determinism/frameBarrier.js";
import { springAtFrame, type Fps } from "../../core/determinism/timelineClock.js";

export const PIP_TILT = { rotateYDeg: -10, rotateXDeg: 5, perspectivePx: 1400 } as const;
export interface FramedMediaPiPProps {
  readonly frame: number; readonly fps: Fps; readonly baseUrl: string; readonly ext: string; readonly clock: MediaClock; readonly width: number; readonly height: number;
  readonly accent: string; readonly bevelPx?: number; readonly radiusPx?: number; readonly grade?: { readonly mode: GradeMode; readonly palette?: GradePalette; readonly strength?: number };
  readonly barrier?: FrameBarrier; readonly style?: React.CSSProperties;
}
const hexA = (hex: string, a: number): string => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`;
export function FramedMediaPiP(p: FramedMediaPiPProps): React.ReactElement {
  const idx = sourceFrameIndex(p.frame, p.clock), url = `${p.baseUrl.replace(/\/$/, "")}/${frameFileName(idx, p.ext)}`;
  const bevel = p.bevelPx ?? 14, radius = p.radiusPx ?? 28, inner = { w: p.width - bevel * 2, h: p.height - bevel * 2 };
  const enter = springAtFrame(p.frame, p.clock.startFrame, p.fps, 150, 15, 1).position; // closed-form spring, seek-safe
  const imgRef = React.useRef<HTMLImageElement>(null);
  React.useLayoutEffect(() => { if (p.barrier && imgRef.current) p.barrier.hold(imgRef.current.decode().catch(() => undefined)); }, [url]);
  return (
    <div data-pip-frame={idx} style={{ position: "relative", width: p.width, height: p.height, perspective: `${PIP_TILT.perspectivePx}px`, pointerEvents: "none", ...p.style }}>
      <div style={{ position: "absolute", inset: 0, transformStyle: "preserve-3d", transform: `rotateY(${PIP_TILT.rotateYDeg}deg) rotateX(${PIP_TILT.rotateXDeg}deg) scale(${(0.9 + 0.1 * Math.min(1.04, enter)).toFixed(4)})`, opacity: Math.min(1, Math.max(0, enter * 1.4)),
        borderRadius: radius, padding: bevel, boxSizing: "border-box", background: "linear-gradient(150deg,rgba(255,255,255,.55),rgba(255,255,255,.12) 45%,rgba(255,255,255,.28))",
        border: `2px solid ${p.accent}`, boxShadow: `0 0 36px ${hexA(p.accent, 0.55)}, 0 50px 80px rgba(9,9,11,.38), inset 0 1px 0 rgba(255,255,255,.7), inset 0 -2px 6px rgba(9,9,11,.25)` }}>
        <div style={{ position: "relative", width: inner.w, height: inner.h, borderRadius: Math.max(0, radius - bevel * 0.6), overflow: "hidden", background: "#09090B" }}>
          {p.grade ? <BrandColorGrade src={url} width={inner.w} height={inner.h} mode={p.grade.mode} palette={p.grade.palette} strength={p.grade.strength} barrier={p.barrier} />
            : <img ref={imgRef} src={url} width={inner.w} height={inner.h} alt="" style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }} />}
        </div>
      </div>
    </div>
  );
}
