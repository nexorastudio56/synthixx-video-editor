/** Browser-side harness (bundled by esbuild) for the Phase-1 three.js leak / determinism / colour tests. */
import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { Scene, PerspectiveCamera, Mesh, PlaneGeometry, ShaderMaterial, Color } from "three";
import { SharedThreeAdapter, type MemorySnapshot, type SceneModule } from "../../visual/three/SharedThreeAdapter.js";
import { GlobeScene, DotMatrixGlobe, type GlobeArc } from "../../visual/three/DotMatrixGlobe.js";
import { GlassHeroScene, createBlurredBackdrop, ScreenSpaceGlassHero } from "../../visual/three/ScreenSpaceGlassHero.js";

const W = 270, H = 480; const ACCENT = "#E60000", TEXT = "#09090B";
const arcs: GlobeArc[] = [{ from: { lat: 24.86, lon: 67.0 }, to: { lat: 51.5, lon: -0.12 }, startFrame: 4, durationFrames: 30 }, { from: { lat: 40.7, lon: -74 }, to: { lat: 35.7, lon: 139.7 }, startFrame: 10, durationFrames: 40 }, { from: { lat: -33.9, lon: 151.2 }, to: { lat: 1.35, lon: 103.8 }, startFrame: 16, durationFrames: 24 }];
const newCanvas = (): HTMLCanvasElement => { const c = document.createElement("canvas"); c.width = W; c.height = H; document.body.appendChild(c); return c; };
function pixels(a: SharedThreeAdapter): Uint8Array { const gl = a.renderer.getContext(); const buf = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf); return buf; }
function fnv(b: Uint8Array): string { let h = 0x811c9dc5; for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); }
const opaque = (b: Uint8Array): number => { let n = 0; for (let i = 3; i < b.length; i += 4) if (b[i] > 8) n++; return n; };
const globe = (a: SharedThreeAdapter): GlobeScene => new GlobeScene(a, { theme: { accent: ACCENT, textPrimary: TEXT }, width: W, height: H, seed: 99, pointCount: 2600, arcs });
const glass = (a: SharedThreeAdapter): GlassHeroScene => new GlassHeroScene(a, { width: W, height: H, backdrop: createBlurredBackdrop(document, W, H, { background: "#FFFFFF", orbs: [{ cx: 100, cy: 250, r: 60, color: "#E60000", alpha: 0.9 }], blurPx: 24 }), slabWidthPx: 200, slabHeightPx: 140, radiusPx: 28, surface: "#FFFFFF", accent: ACCENT });

async function leak(cycles: number): Promise<{ baseline: MemorySnapshot; after: MemorySnapshot[]; during: MemorySnapshot[]; openScopes: number[]; drawn: number[]; disposedFlags: boolean[] }> {
  const a = new SharedThreeAdapter({ canvas: newCanvas(), width: W, height: H }); const baseline = a.memory(); const after: MemorySnapshot[] = [], during: MemorySnapshot[] = [], openScopes: number[] = [], drawn: number[] = [], disposedFlags: boolean[] = [];
  for (let c = 0; c < cycles; c++) {
    const g = globe(a), h = glass(a); a.mount(g); a.renderFrame(c * 7, 30); drawn.push(opaque(pixels(a))); a.mount(h); a.renderFrame(c * 7 + 1, 30); during.push(a.memory());
    g.scope.retain(); a.closeScope(g.scope); a.closeScope(h.scope); disposedFlags.push(h.scope.disposed && !g.scope.disposed); g.scope.release(); disposedFlags.push(g.scope.disposed); // ref-count: first close must NOT dispose a retained scope
    openScopes.push(a.openScopes); after.push(a.memory());
  }
  a.dispose(); return { baseline, after, during, openScopes, drawn, disposedFlags };
}
function determinism(): { seq: string[]; shuffled: string[]; globeOpaque: number } {
  const a = new SharedThreeAdapter({ canvas: newCanvas(), width: W, height: H }); const g = globe(a); a.mount(g); const frames = [0, 20, 33, 59]; const hashOf = (f: number): string => { a.renderFrame(f, 30); return fnv(pixels(a)); };
  const seq = frames.map(hashOf); const order = [3, 0, 2, 1, 3]; const shuffled = order.map(i => hashOf(frames[i])); a.closeScope(g.scope); a.dispose();
  return { seq: [...seq, seq[3]], shuffled, globeOpaque: 0 };
}
function colorProbe(hex: string): number[] {
  const a = new SharedThreeAdapter({ canvas: newCanvas(), width: W, height: H }); const scope = a.openScope("probe"); const scene = new Scene(); const cam = new PerspectiveCamera();
  const mesh = new Mesh(new PlaneGeometry(2, 2), new ShaderMaterial({ uniforms: { uColor: { value: new Color(hex) } }, vertexShader: "void main(){gl_Position=vec4(position.xy,0.0,1.0);}", fragmentShader: "uniform vec3 uColor; void main(){gl_FragColor=vec4(uColor,1.0);\n#include <colorspace_fragment>\n}" }));
  scene.add(mesh); scope.trackObject(mesh); const m: SceneModule = { scene, camera: cam, scope, update: () => undefined }; a.mount(m); a.renderFrame(0, 30);
  const px = pixels(a), o = ((H >> 1) * W + (W >> 1)) * 4; const out = [px[o], px[o + 1], px[o + 2], px[o + 3]]; const tm = a.renderer.toneMapping, cs = a.renderer.outputColorSpace; a.closeScope(scope); a.dispose(); return [...out, tm, cs === "srgb" ? 1 : 0];
}
function glassCheck(): { center: number[]; tinted: number[]; edgeAlpha: number; drawn: number } {
  const a = new SharedThreeAdapter({ canvas: newCanvas(), width: W, height: H }); const h = glass(a); a.mount(h); a.renderFrame(30, 30); const px = pixels(a); const o = ((H >> 1) * W + (W >> 1)) * 4; const c = [px[o], px[o + 1], px[o + 2], px[o + 3]]; const e = ((H >> 1) * W + 1) * 4;
  const t = ((H - 250) * W + 100) * 4; const r = { center: c, tinted: [px[t], px[t + 1], px[t + 2], px[t + 3]], edgeAlpha: px[e + 3], drawn: opaque(px) }; a.closeScope(h.scope); a.dispose(); return r;
}
function reactSmoke(): { opaque: number; canvases: number } {
  const host = document.createElement("div"); host.style.cssText = `position:relative;width:${W}px;height:${H}px`; document.body.appendChild(host); const root = createRoot(host);
  flushSync(() => root.render(<><DotMatrixGlobe frame={12} fps={30} width={W} height={H} theme={{ accent: ACCENT, textPrimary: TEXT }} seed={5} arcs={arcs} /><ScreenSpaceGlassHero frame={12} fps={30} width={W} height={H} slabWidthPx={180} slabHeightPx={120} radiusPx={24} surface="#FFFFFF" accent={ACCENT} backdrop={{ background: "#FFFFFF", orbs: [], blurPx: 20 }} /></>));
  const cv = host.querySelectorAll("canvas"); const n = cv.length; const c2 = document.createElement("canvas"); c2.width = W; c2.height = H; const ctx = c2.getContext("2d") as CanvasRenderingContext2D; ctx.drawImage(cv[0], 0, 0); const d = ctx.getImageData(0, 0, W, H).data; let o = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 8) o++;
  flushSync(() => root.unmount()); return { opaque: o, canvases: n };
}
(window as unknown as { __p1: unknown }).__p1 = { leak, determinism, colorProbe, glassCheck, reactSmoke };
