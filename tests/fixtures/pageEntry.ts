/** Browser-side harness bundled by esbuild: window.__frameBarrier + window.__setFrame(frame) -> writes the barcode strip and a frame label. */
import { FrameBarrier, barcodeHtml } from "../../core/determinism/frameBarrier.js";
import { auditCrispText } from "../../visual/layers/audit.js";
declare global { interface Window { __audit(): string[]; __frameBarrier: FrameBarrier; __setFrame(f: number): void } }
const barrier = new FrameBarrier(); let pending = 0;
barrier.onFlush(() => {
  const host = document.getElementById("barcode-host") as HTMLElement; host.innerHTML = barcodeHtml(pending, { cell: 4, x0: 0, y: 0 });
  const lab = document.getElementById("frame-label"); if (lab) lab.textContent = String(pending);
});
window.__frameBarrier = barrier; window.__audit = () => auditCrispText(document);
window.__setFrame = (f: number) => { pending = f; };
