/** BrandColorGrade: draws an image into a canvas and grades it in linear light (colorGrade.ts). Waits on the FrameBarrier so a frame is never captured un-graded. */
import * as React from "react";
import { gradeImageData, DEFAULT_PALETTE, type GradeMode, type GradePalette } from "./colorGrade.js";
import type { FrameBarrier } from "../../core/determinism/frameBarrier.js";

export interface BrandColorGradeProps {
  readonly src: string; readonly width: number; readonly height: number; readonly mode: GradeMode; readonly palette?: GradePalette; readonly strength?: number;
  readonly fit?: "cover" | "contain"; readonly barrier?: FrameBarrier; readonly style?: React.CSSProperties;
}
export function BrandColorGrade(p: BrandColorGradeProps): React.ReactElement {
  const ref = React.useRef<HTMLCanvasElement>(null);
  React.useLayoutEffect(() => {
    const cv = ref.current as HTMLCanvasElement; const img = new Image(); img.src = p.src;
    const job = img.decode().then(() => {
      const ctx = cv.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D; const sc = (p.fit === "contain" ? Math.min : Math.max)(p.width / img.naturalWidth, p.height / img.naturalHeight);
      const dw = img.naturalWidth * sc, dh = img.naturalHeight * sc; ctx.clearRect(0, 0, p.width, p.height); ctx.drawImage(img, (p.width - dw) / 2, (p.height - dh) / 2, dw, dh);
      const id = ctx.getImageData(0, 0, p.width, p.height); gradeImageData(id.data, p.mode, p.palette ?? DEFAULT_PALETTE, p.strength); ctx.putImageData(id, 0, 0); cv.dataset["graded"] = `${p.mode}`;
    });
    if (p.barrier) p.barrier.hold(job); else void job;
  }, [p.src, p.width, p.height, p.mode, p.palette?.shadow, p.palette?.mid, p.palette?.highlight, p.strength, p.fit]);
  return <canvas ref={ref} width={p.width} height={p.height} style={{ display: "block", width: "100%", height: "100%", ...p.style }} />;
}
