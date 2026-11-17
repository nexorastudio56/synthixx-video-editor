/**
 * Frame barrier: the capture harness must NEVER screenshot a half-mounted frame. settle() waits for every held promise, React flushSync,
 * document.fonts.ready, <img> decode, <video> frame readiness, and two animation-frame-free microtask/paint turns. A 24-bit frame-index barcode
 * strip (placed OUTSIDE the cropped viewport) lets the harness prove captured frame === requested globalFrame.
 */
export type FlushFn = () => void;

export class FrameBarrier {
  private readonly held = new Set<Promise<unknown>>();
  private readonly flushers: FlushFn[] = [];
  /** Register a synchronous flush (e.g. `() => flushSync(() => root.render(...))`). Runs at the start of every settle(). */
  onFlush(fn: FlushFn): void { this.flushers.push(fn); }
  /** Hold the barrier until `p` settles (resolve OR reject: rejection is rethrown by settle()). Returns p. */
  hold<T>(p: Promise<T>): Promise<T> {
    this.held.add(p);
    const done = () => { this.held.delete(p); };
    p.then(done, done);
    return p;
  }
  get pending(): number { return this.held.size; }
  /** Wait until nothing is pending. Loops because new holds may be added while waiting. */
  async settle(): Promise<void> {
    for (const f of this.flushers) f();
    const hasDom = typeof document !== "undefined";
    for (let guard = 0; guard < 64; guard++) {
      if (hasDom) {
        this.hold(document.fonts.ready);
        for (const img of Array.from(document.images)) if (!img.complete || img.naturalWidth === 0) this.hold(img.decode().catch(() => undefined)); else this.hold(img.decode().catch(() => undefined));
        for (const v of Array.from(document.querySelectorAll("video"))) if (v.readyState < 2) this.hold(new Promise<void>(res => { const ok = () => res(); v.addEventListener("loadeddata", ok, { once: true }); v.addEventListener("error", ok, { once: true }); }));
      }
      const snapshot = Array.from(this.held);
      if (!snapshot.length) break;
      const results = await Promise.allSettled(snapshot);
      const rejected = results.find(r => r.status === "rejected") as PromiseRejectedResult | undefined;
      if (rejected) throw rejected.reason instanceof Error ? rejected.reason : new Error(String(rejected.reason));
      if (this.held.size === 0) break;
    }
    if (hasDom) await new Promise<void>(res => setTimeout(res, 0)); // let style/layout of the flushed DOM commit
  }
}

/** ------- 24-bit frame-index barcode (MSB first). White cell = 1, black cell = 0, with a 1-cell white/black guard on each side. ------- */
export const BARCODE_BITS = 24;
export const MAX_BARCODE_FRAME = (1 << BARCODE_BITS) - 1;
export function frameBits(frame: number): number[] {
  if (!Number.isInteger(frame) || frame < 0 || frame > MAX_BARCODE_FRAME) throw new RangeError(`frame ${frame} out of 24-bit range`);
  return Array.from({ length: BARCODE_BITS }, (_, i) => (frame >> (BARCODE_BITS - 1 - i)) & 1);
}
export interface BarcodeGeom { cell: number; x0: number; y: number }
/** Absolutely positioned HTML strip. Put it at y >= viewport height (outside the crop) and capture with a taller clip, or in debug mode inside the frame. */
export function barcodeHtml(frame: number, g: BarcodeGeom): string {
  const bits = frameBits(frame);
  const cells = bits.map((b, i) => `<i style="position:absolute;left:${g.x0 + (i + 1) * g.cell}px;top:${g.y}px;width:${g.cell}px;height:${g.cell}px;background:${b ? "#fff" : "#000"}"></i>`).join("");
  const guard = `<i style="position:absolute;left:${g.x0}px;top:${g.y}px;width:${g.cell}px;height:${g.cell}px;background:#fff"></i><i style="position:absolute;left:${g.x0 + (BARCODE_BITS + 1) * g.cell}px;top:${g.y}px;width:${g.cell}px;height:${g.cell}px;background:#000"></i>`;
  return `<div id="__barcode" data-frame="${frame}" style="position:absolute;left:0;top:0;width:0;height:0">${guard}${cells}</div>`;
}
/** Decode from a raw RGBA/RGB buffer. Returns the frame index or null if guards/cells are unreadable. */
export function decodeBarcode(buf: Uint8Array, width: number, channels: 3 | 4, g: BarcodeGeom): number | null {
  const px = (cellIdx: number): number => { const x = g.x0 + cellIdx * g.cell + (g.cell >> 1), y = g.y + (g.cell >> 1), o = (y * width + x) * channels; return (buf[o] + buf[o + 1] + buf[o + 2]) / 3; };
  if (px(0) < 192 || px(BARCODE_BITS + 1) > 64) return null;
  let v = 0;
  for (let i = 0; i < BARCODE_BITS; i++) { const l = px(i + 1); if (l > 64 && l < 192) return null; v = (v << 1) | (l >= 128 ? 1 : 0); }
  return v;
}
