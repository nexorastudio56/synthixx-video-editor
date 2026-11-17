/** Browser harness for Phase-2 media components. */
import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { FramedMediaPiP, type FramedMediaPiPProps } from "../../visual/media/FramedMediaPiP.js";
import { BrandColorGrade } from "../../visual/media/BrandColorGrade.js";
import { FrameBarrier } from "../../core/determinism/frameBarrier.js";

async function pip(props: Omit<FramedMediaPiPProps, "barrier">): Promise<{ idx: string; transform: string; nat: number[]; px: number[]; opacity: string }> {
  const host = document.createElement("div"); document.body.appendChild(host); const root = createRoot(host); const barrier = new FrameBarrier();
  flushSync(() => root.render(<FramedMediaPiP {...props} barrier={barrier} />)); await barrier.settle();
  const outer = host.firstElementChild as HTMLElement, card = outer.firstElementChild as HTMLElement, img = host.querySelector("img") as HTMLImageElement;
  const cv = document.createElement("canvas"); cv.width = img.naturalWidth; cv.height = img.naturalHeight; const ctx = cv.getContext("2d") as CanvasRenderingContext2D; ctx.drawImage(img, 0, 0); const d = ctx.getImageData(2, 2, 1, 1).data;
  const r = { idx: outer.dataset["pipFrame"] ?? "", transform: getComputedStyle(card).transform, nat: [img.naturalWidth, img.naturalHeight], px: [d[0], d[1], d[2]], opacity: getComputedStyle(card).opacity };
  flushSync(() => root.unmount()); host.remove(); return r;
}
async function grade(src: string, mode: "strict-duotone" | "palette-harmonize" | "natural", w: number, h: number): Promise<{ graded: string; samples: number[][] }> {
  const host = document.createElement("div"); document.body.appendChild(host); const root = createRoot(host); const barrier = new FrameBarrier();
  flushSync(() => root.render(<BrandColorGrade src={src} width={w} height={h} mode={mode} barrier={barrier} fit="cover" />)); await barrier.settle();
  const cv = host.querySelector("canvas") as HTMLCanvasElement; const ctx = cv.getContext("2d") as CanvasRenderingContext2D; const pts = [[2, 2], [w >> 1, h >> 1], [w - 3, h - 3]];
  const r = { graded: cv.dataset["graded"] ?? "", samples: pts.map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data)) }; flushSync(() => root.unmount()); host.remove(); return r;
}
(window as unknown as { __p2: unknown }).__p2 = { pip, grade };
