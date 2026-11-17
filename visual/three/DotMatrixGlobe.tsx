/**
 * DotMatrixGlobe: Fibonacci-sphere dot cloud (accent + textPrimary dots) with glowing laser arcs whose head position is a closed-form function of globalFrame.
 * Land/ocean mask is a deterministic procedural noise field (counter-hash lattice), NOT real geography.
 */
import * as React from "react";
import { BufferGeometry, Float32BufferAttribute, Points, ShaderMaterial, Scene, PerspectiveCamera, Color, AdditiveBlending, NormalBlending, Group } from "three";
import type { Fps } from "../../core/determinism/timelineClock.js";
import { rand3 } from "../../core/determinism/counterRng.js";
import { SharedThreeAdapter, ResourceScope, applyPose, orbitPose, type SceneModule } from "./SharedThreeAdapter.js";

export interface LatLon { readonly lat: number; readonly lon: number }
export interface GlobeArc { readonly from: LatLon; readonly to: LatLon; readonly startFrame: number; readonly durationFrames: number }
export interface GlobeTheme { readonly accent: string; readonly textPrimary: string }
export interface GlobeOptions { readonly theme: GlobeTheme; readonly width: number; readonly height: number; readonly seed?: number; readonly pointCount?: number; readonly arcs?: readonly GlobeArc[]; readonly degPerSec?: number; readonly accentShare?: number }

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const DEG = Math.PI / 180;
export const latLonToVec = (p: LatLon): [number, number, number] => { const la = p.lat * DEG, lo = p.lon * DEG; return [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)]; };
const smooth = (t: number) => t * t * (3 - 2 * t);
/** Lattice value noise on 3D integer cells, hashed with the counter RNG (no state, bit-reproducible). */
export function valueNoise3(seed: number, x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), fx = smooth(x - xi), fy = smooth(y - yi), fz = smooth(z - zi);
  const h = (a: number, b: number, c: number) => rand3(seed, ((a & 0x3ff) << 20) | ((b & 0x3ff) << 10) | (c & 0x3ff), 0);
  const l = (a: number, b: number, t: number) => a + (b - a) * t; let v = 0;
  const x00 = l(h(xi, yi, zi), h(xi + 1, yi, zi), fx), x10 = l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), fx), x01 = l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), fx), x11 = l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), fx);
  v = l(l(x00, x10, fy), l(x01, x11, fy), fz); return v;
}
export interface DotCloud { readonly positions: Float32Array; readonly colors: Float32Array; readonly sizes: Float32Array; readonly count: number }
export function buildDotCloud(o: { seed: number; pointCount: number; accent: string; text: string; accentShare: number }): DotCloud {
  const keep: number[] = []; const pos: number[] = [], col: number[] = [], siz: number[] = []; const A = new Color(o.accent), T = new Color(o.text);
  for (let i = 0; i < o.pointCount; i++) {
    const y = 1 - (2 * (i + 0.5)) / o.pointCount, r = Math.sqrt(1 - y * y), th = i * GOLDEN, x = Math.cos(th) * r, z = Math.sin(th) * r;
    const n = 0.65 * valueNoise3(o.seed, x * 2.2 + 11, y * 2.2 + 11, z * 2.2 + 11) + 0.35 * valueNoise3(o.seed + 1, x * 4.6 + 29, y * 4.6 + 29, z * 4.6 + 29);
    if (n < 0.47) continue; keep.push(i); pos.push(x, y, z);
    const isAccent = rand3(o.seed, i, 7) < o.accentShare; const c = isAccent ? A : T; col.push(c.r, c.g, c.b); siz.push(isAccent ? 2.6 : 1.7 + 0.5 * rand3(o.seed, i, 8));
  }
  return { positions: new Float32Array(pos), colors: new Float32Array(col), sizes: new Float32Array(siz), count: keep.length };
}

const VERT_DOTS = `uniform float uRot; uniform float uScale; attribute vec3 aColor; attribute float aSize; varying vec3 vColor; varying float vFacing;
void main(){ float c=cos(uRot), s=sin(uRot); vec3 p=vec3(c*position.x+s*position.z, position.y, -s*position.x+c*position.z);
  vec4 mv=modelViewMatrix*vec4(p,1.0); vec3 n=normalize(normalMatrix*normalize(p)); vFacing=n.z*0.8+ (normalize(-mv.xyz)).z*0.2; vColor=aColor;
  gl_PointSize=aSize*uScale/(-mv.z); gl_Position=projectionMatrix*mv; }`;
const FRAG_DOTS = `varying vec3 vColor; varying float vFacing;
void main(){ float d=length(gl_PointCoord-vec2(0.5)); float a=smoothstep(0.5,0.32,d); a*=mix(0.16,1.0,smoothstep(-0.05,0.4,vFacing)); if(a<0.003) discard; gl_FragColor=vec4(vColor,a);
#include <colorspace_fragment>
}`;
const VERT_ARC = `uniform float uRot; uniform float uScale; uniform float uHead; uniform float uTail; uniform float uFade; attribute float aU; varying float vI;
void main(){ float c=cos(uRot), s=sin(uRot); vec3 p=vec3(c*position.x+s*position.z, position.y, -s*position.x+c*position.z);
  float inT=step(uHead-uTail,aU)*step(aU,uHead); float k=clamp((aU-(uHead-uTail))/uTail,0.0,1.0); float head=smoothstep(0.9,1.0,k);
  vI=inT*(0.25+0.75*k)*uFade; vec4 mv=modelViewMatrix*vec4(p,1.0); gl_PointSize=(1.5+7.0*head+3.0*k)*uScale/(-mv.z)*step(0.001,vI); gl_Position=projectionMatrix*mv; }`;
const FRAG_ARC = `uniform vec3 uColor; varying float vI;
void main(){ float d=length(gl_PointCoord-vec2(0.5)); float g=pow(max(1.0-2.0*d,0.0),2.0)*vI; if(g<0.003) discard; gl_FragColor=vec4(uColor,g);
#include <colorspace_fragment>
}`;

export class GlobeScene implements SceneModule {
  readonly scene = new Scene(); readonly camera: PerspectiveCamera; readonly scope: ResourceScope;
  private readonly dots: ShaderMaterial; private readonly arcMats: ShaderMaterial[] = []; private readonly arcs: readonly GlobeArc[]; private readonly degPerSec: number; private readonly height: number;
  constructor(adapter: SharedThreeAdapter, o: GlobeOptions) {
    this.scope = adapter.openScope("globe"); this.arcs = o.arcs ?? []; this.degPerSec = o.degPerSec ?? 14; this.height = o.height;
    this.camera = new PerspectiveCamera(32, o.width / o.height, 0.1, 50);
    const seed = o.seed ?? 1337, cloud = buildDotCloud({ seed, pointCount: o.pointCount ?? 2600, accent: o.theme.accent, text: o.theme.textPrimary, accentShare: o.accentShare ?? 0.14 });
    const g = new BufferGeometry(); g.setAttribute("position", new Float32BufferAttribute(cloud.positions, 3)); g.setAttribute("aColor", new Float32BufferAttribute(cloud.colors, 3)); g.setAttribute("aSize", new Float32BufferAttribute(cloud.sizes, 1));
    this.dots = new ShaderMaterial({ vertexShader: VERT_DOTS, fragmentShader: FRAG_DOTS, transparent: true, depthWrite: false, blending: NormalBlending, uniforms: { uRot: { value: 0 }, uScale: { value: 1 } } });
    const root = new Group(); root.add(new Points(g, this.dots));
    for (const a of this.arcs) {
      const A = latLonToVec(a.from), B = latLonToVec(a.to), dot = Math.min(1, Math.max(-1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2])), om = Math.acos(dot), so = Math.sin(om) || 1, N = 200, p: number[] = [], u: number[] = [];
      for (let i = 0; i < N; i++) { const t = i / (N - 1), k0 = Math.sin((1 - t) * om) / so, k1 = Math.sin(t * om) / so; let x = k0 * A[0] + k1 * B[0], y = k0 * A[1] + k1 * B[1], z = k0 * A[2] + k1 * B[2]; const L = Math.hypot(x, y, z) || 1, lift = 1.004 + 0.32 * (om / Math.PI) * Math.sin(Math.PI * t); p.push((x / L) * lift, (y / L) * lift, (z / L) * lift); u.push(t); }
      const ag = new BufferGeometry(); ag.setAttribute("position", new Float32BufferAttribute(p, 3)); ag.setAttribute("aU", new Float32BufferAttribute(u, 1));
      const m = new ShaderMaterial({ vertexShader: VERT_ARC, fragmentShader: FRAG_ARC, transparent: true, depthWrite: false, blending: AdditiveBlending, uniforms: { uRot: { value: 0 }, uScale: { value: 1 }, uHead: { value: 0 }, uTail: { value: 0.28 }, uFade: { value: 1 }, uColor: { value: new Color(o.theme.accent) } } });
      this.arcMats.push(m); root.add(new Points(ag, m));
    }
    this.scene.add(root); this.scope.trackObject(root);
  }
  /** Pure function of (frame, fps). */
  update(frame: number, fps: Fps): void {
    const t = frame / fps, rot = this.degPerSec * DEG * t; applyPose(this.camera, orbitPose(frame, fps, { radius: 4.1, elevDeg: 14, degPerSec: 0, fov: 32 }));
    const scale = this.height * 0.5 / Math.tan(16 * DEG); this.dots.uniforms.uRot.value = rot; this.dots.uniforms.uScale.value = scale;
    this.arcs.forEach((a, i) => {
      const m = this.arcMats[i], p = Math.min(1, Math.max(0, (frame - a.startFrame) / a.durationFrames)), e = p * p * (3 - 2 * p), after = Math.max(0, frame - (a.startFrame + a.durationFrames)) / (fps * 0.6);
      m.uniforms.uRot.value = rot; m.uniforms.uScale.value = scale; m.uniforms.uHead.value = frame < a.startFrame ? -1 : e * 1.28 - 0.0; m.uniforms.uFade.value = Math.max(0, 1 - after);
    });
  }
}

export interface DotMatrixGlobeProps extends GlobeOptions { readonly frame: number; readonly fps: Fps; readonly style?: React.CSSProperties }
/** React wrapper (L1 slot, pointer-events none). Renders synchronously for the given frame; owns its adapter and releases every GPU resource on unmount. */
export function DotMatrixGlobe(p: DotMatrixGlobeProps): React.ReactElement {
  const ref = React.useRef<HTMLCanvasElement>(null); const state = React.useRef<{ adapter: SharedThreeAdapter; scene: GlobeScene } | null>(null);
  React.useLayoutEffect(() => {
    const canvas = ref.current as HTMLCanvasElement; const adapter = new SharedThreeAdapter({ canvas, width: p.width, height: p.height }); const scene = new GlobeScene(adapter, p);
    adapter.mount(scene); state.current = { adapter, scene };
    return () => { adapter.closeScope(scene.scope); adapter.dispose(); state.current = null; };
  }, [p.width, p.height, p.seed, p.pointCount, p.theme.accent, p.theme.textPrimary]);
  React.useLayoutEffect(() => { state.current?.adapter.renderFrame(p.frame, p.fps); });
  return <canvas ref={ref} width={p.width} height={p.height} style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", pointerEvents: "none", ...p.style }} />;
}
