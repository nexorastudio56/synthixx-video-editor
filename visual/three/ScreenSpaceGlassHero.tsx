/**
 * ScreenSpaceGlassHero: hero-only glass slab. The fragment shader samples a PRE-BLURRED L0 backdrop texture in screen space (refracted by an SDF bevel normal) and adds a
 * Fresnel rim in the accent colour. It lives in L1 and never touches L2, so sharp text above it is never blurred or refracted.
 */
import * as React from "react";
import { Scene, PerspectiveCamera, Mesh, PlaneGeometry, ShaderMaterial, Color, CanvasTexture, SRGBColorSpace, LinearFilter, Texture, Vector2 } from "three";
import type { Fps } from "../../core/determinism/timelineClock.js";
import { SharedThreeAdapter, ResourceScope, applyPose, type SceneModule } from "./SharedThreeAdapter.js";

export interface BackdropOrb { readonly cx: number; readonly cy: number; readonly r: number; readonly color: string; readonly alpha: number }
/** Deterministic pre-blurred backdrop (canvas 2D blur), uploaded once as a texture. */
export function createBlurredBackdrop(doc: Document, w: number, h: number, o: { background: string; orbs: readonly BackdropOrb[]; blurPx: number }): CanvasTexture {
  const cv = doc.createElement("canvas"); cv.width = w; cv.height = h; const ctx = cv.getContext("2d") as CanvasRenderingContext2D;
  ctx.fillStyle = o.background; ctx.fillRect(0, 0, w, h); ctx.filter = `blur(${o.blurPx}px)`;
  for (const orb of o.orbs) { ctx.globalAlpha = orb.alpha; ctx.fillStyle = orb.color; ctx.beginPath(); ctx.arc(orb.cx, orb.cy, orb.r, 0, Math.PI * 2); ctx.fill(); }
  const tex = new CanvasTexture(cv); tex.colorSpace = SRGBColorSpace; tex.minFilter = LinearFilter; tex.magFilter = LinearFilter; tex.generateMipmaps = false; return tex;
}

export interface GlassHeroOptions {
  readonly width: number; readonly height: number; readonly backdrop: Texture; readonly slabWidthPx: number; readonly slabHeightPx: number; readonly radiusPx: number; readonly bevelPx?: number;
  readonly surface: string; readonly accent: string; readonly opacity?: number; readonly refractionStrength?: number; readonly tiltDeg?: number; readonly centerY?: number;
}
const VERT = `varying vec2 vUv; varying vec3 vN; varying vec3 vView; void main(){ vUv=uv; vN=normalize(normalMatrix*normal); vec4 mv=modelViewMatrix*vec4(position,1.0); vView=-mv.xyz; gl_Position=projectionMatrix*mv; }`;
const FRAG = `uniform sampler2D uBackdrop; uniform vec2 uRes; uniform vec2 uSize; uniform float uRadius; uniform float uBevel; uniform vec3 uSurface; uniform vec3 uAccent; uniform float uOpacity; uniform float uRefract;
varying vec2 vUv; varying vec3 vN; varying vec3 vView;
float sdBox(vec2 p, vec2 b, float r){ vec2 q=abs(p)-b+r; return length(max(q,0.0))+min(max(q.x,q.y),0.0)-r; }
void main(){ vec2 p=(vUv-0.5)*uSize; vec2 hb=uSize*0.5; float sd=sdBox(p,hb,uRadius); float e=1.5;
  vec2 g=vec2(sdBox(p+vec2(e,0.0),hb,uRadius)-sdBox(p-vec2(e,0.0),hb,uRadius), sdBox(p+vec2(0.0,e),hb,uRadius)-sdBox(p-vec2(0.0,e),hb,uRadius)); g=normalize(g+vec2(1e-5));
  float h=clamp(-sd/uBevel,0.0,1.0); vec3 n=normalize(vec3(g*(1.0-h), 0.15+0.85*h));
  vec2 suv=gl_FragCoord.xy/uRes; vec3 bg=texture2D(uBackdrop, clamp(suv+n.xy*uRefract*(1.0-h)*0.07,0.001,0.999)).rgb;
  vec3 tint=mix(bg,uSurface,uOpacity); vec3 N=normalize(normalize(vN)+vec3(n.xy*0.9,0.0)); float fres=pow(1.0-clamp(dot(N,normalize(vView)),0.0,1.0),3.0);
  float edge=1.0-smoothstep(0.0,uBevel*0.6,-sd); float sheen=smoothstep(0.35,-0.5,vUv.y-vUv.x*0.6-0.2)*0.06;
  vec3 col=tint+uAccent*(fres*0.85+edge*0.35)+vec3(sheen); float a=(1.0-smoothstep(-1.0,1.0,sd)); gl_FragColor=vec4(col,a);
#include <colorspace_fragment>
}`;

export class GlassHeroScene implements SceneModule {
  readonly scene = new Scene(); readonly camera: PerspectiveCamera; readonly scope: ResourceScope; private readonly mesh: Mesh; private readonly tilt: number; private readonly cy: number; private readonly o: GlassHeroOptions;
  constructor(adapter: SharedThreeAdapter, o: GlassHeroOptions) {
    this.o = o; this.scope = adapter.openScope("glass-hero"); this.tilt = o.tiltDeg ?? 6; this.cy = o.centerY ?? 0;
    this.camera = new PerspectiveCamera(30, o.width / o.height, 0.1, 100); const dist = (o.height * 0.5) / Math.tan(15 * Math.PI / 180); // 1 world unit = 1 px at z=0
    this.camera.position.set(0, 0, dist); this.camera.near = 1; this.camera.far = dist * 4; this.camera.updateProjectionMatrix();
    const mat = new ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, uniforms: {
      uBackdrop: { value: o.backdrop }, uRes: { value: new Vector2(o.width, o.height) }, uSize: { value: new Vector2(o.slabWidthPx, o.slabHeightPx) }, uRadius: { value: o.radiusPx }, uBevel: { value: o.bevelPx ?? 28 },
      uSurface: { value: new Color(o.surface) }, uAccent: { value: new Color(o.accent) }, uOpacity: { value: o.opacity ?? 0.16 }, uRefract: { value: o.refractionStrength ?? 0.35 } } });
    this.mesh = new Mesh(new PlaneGeometry(o.slabWidthPx, o.slabHeightPx, 1, 1), mat); this.scene.add(this.mesh); this.scope.trackObject(this.mesh);
    this.mesh.position.y = this.cy;
  }
  update(frame: number, fps: Fps): void {
    const t = frame / fps; this.mesh.rotation.y = Math.sin(t * 0.9) * this.tilt * Math.PI / 180; this.mesh.rotation.x = Math.cos(t * 0.7) * this.tilt * 0.5 * Math.PI / 180;
    applyPose(this.camera, { position: [0, 0, this.camera.position.z], target: [0, 0, 0], fov: 30 }); void this.o;
  }
}
export interface GlassHeroProps extends Omit<GlassHeroOptions, "backdrop"> { readonly frame: number; readonly fps: Fps; readonly backdrop: { readonly background: string; readonly orbs: readonly BackdropOrb[]; readonly blurPx: number } }
export function ScreenSpaceGlassHero(p: GlassHeroProps): React.ReactElement {
  const ref = React.useRef<HTMLCanvasElement>(null); const st = React.useRef<{ a: SharedThreeAdapter; s: GlassHeroScene } | null>(null);
  React.useLayoutEffect(() => {
    const canvas = ref.current as HTMLCanvasElement; const a = new SharedThreeAdapter({ canvas, width: p.width, height: p.height }); const tex = createBlurredBackdrop(document, p.width, p.height, p.backdrop);
    const s = new GlassHeroScene(a, { ...p, backdrop: tex }); a.mount(s); st.current = { a, s };
    return () => { a.closeScope(s.scope); a.dispose(); st.current = null; };
  }, [p.width, p.height, p.slabWidthPx, p.slabHeightPx, p.accent, p.surface]);
  React.useLayoutEffect(() => { st.current?.a.renderFrame(p.frame, p.fps); });
  return <canvas ref={ref} width={p.width} height={p.height} style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", pointerEvents: "none" }} />;
}
