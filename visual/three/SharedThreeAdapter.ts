/**
 * SharedThreeAdapter: ONE WebGLRenderer for the whole render (NoToneMapping + SRGBColorSpace so #E60000 stays exactly #E60000),
 * reference-counted ResourceScope disposal per scene, and camera/uniforms evaluated purely from globalFrame (no useFrame delta, no clock).
 */
import { WebGLRenderer, NoToneMapping, SRGBColorSpace, PerspectiveCamera, Scene, Vector3, Quaternion, Matrix4, Object3D, Mesh, Points, Line, type Material, type BufferGeometry, type Texture, type WebGLRenderTarget, ColorManagement } from "three";
import { assertFps, type Fps } from "../../core/determinism/timelineClock.js";

export interface Disposable { dispose(): void }
export type Trackable = BufferGeometry | Material | Texture | WebGLRenderTarget | Disposable;

/** Reference-counted disposal scope. Resources are disposed exactly once, when the last holder releases. */
export class ResourceScope {
  private refs = 1; private readonly items = new Set<Trackable>(); private done = false;
  constructor(readonly name: string) {}
  get disposed(): boolean { return this.done; }
  get refCount(): number { return this.refs; }
  get size(): number { return this.items.size; }
  track<T extends Trackable>(r: T): T { if (this.done) throw new Error(`scope "${this.name}" already disposed`); this.items.add(r); return r; }
  /** Track geometry, material(s) and every texture referenced by a material under `root`. */
  trackObject<T extends Object3D>(root: T): T {
    root.traverse(o => {
      const m = o as Mesh | Points | Line; if (m.geometry) this.track(m.geometry);
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) { this.track(mat); for (const v of Object.values(mat as unknown as Record<string, unknown>)) if (v && typeof v === "object" && "isTexture" in (v as object)) this.track(v as Texture); const u = (mat as unknown as { uniforms?: Record<string, { value: unknown }> }).uniforms; if (u) for (const k of Object.keys(u)) { const val = u[k].value; if (val && typeof val === "object" && "isTexture" in (val as object)) this.track(val as Texture); } }
    });
    return root;
  }
  retain(): this { if (this.done) throw new Error(`scope "${this.name}" already disposed`); this.refs++; return this; }
  release(): void { if (this.done) return; this.refs--; if (this.refs <= 0) { this.done = true; for (const r of this.items) r.dispose(); this.items.clear(); } }
}

export interface CameraPose { readonly position: readonly [number, number, number]; readonly target: readonly [number, number, number]; readonly fov: number }
/** A 3D scene module: pure function of (globalFrame, fps). No internal clocks. */
export interface SceneModule {
  readonly scene: Scene; readonly camera: PerspectiveCamera; readonly scope: ResourceScope;
  update(frame: number, fps: Fps): void;
}
export interface AdapterOptions { readonly canvas: HTMLCanvasElement | OffscreenCanvas; readonly width: number; readonly height: number; readonly pixelRatio?: number }
export interface MemorySnapshot { readonly geometries: number; readonly textures: number; readonly programs: number }

export class SharedThreeAdapter {
  readonly renderer: WebGLRenderer; private readonly open = new Set<ResourceScope>(); private current: SceneModule | null = null;
  constructor(o: AdapterOptions) {
    ColorManagement.enabled = true;
    this.renderer = new WebGLRenderer({ canvas: o.canvas as HTMLCanvasElement, antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true, powerPreference: "low-power" });
    this.renderer.toneMapping = NoToneMapping; this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setPixelRatio(o.pixelRatio ?? 1); this.renderer.setSize(o.width, o.height, false); this.renderer.setClearColor(0x000000, 0);
  }
  openScope(name: string): ResourceScope { const s = new ResourceScope(name); this.open.add(s); return s; }
  /** Release the scene's scope: resources are disposed when the last reference drops. */
  closeScope(s: ResourceScope): void { s.release(); if (s.disposed) this.open.delete(s); }
  /** Scopes not yet disposed (prunes any that were released directly through scope.release()). */
  get openScopes(): number { for (const s of [...this.open]) if (s.disposed) this.open.delete(s); return this.open.size; }
  mount(m: SceneModule): void { this.current = m; }
  /** Render exactly the requested global frame. Nothing here reads a clock. */
  renderFrame(frame: number, fpsIn: number): void {
    const fps = assertFps(fpsIn); if (!Number.isInteger(frame) || frame < 0) throw new RangeError(`bad frame ${frame}`);
    const m = this.current; if (!m) throw new Error("no scene mounted"); m.update(frame, fps); this.renderer.render(m.scene, m.camera);
  }
  memory(): MemorySnapshot { const i = this.renderer.info; return { geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length ?? 0 }; }
  /** Dispose any scopes still open, then the renderer (end of render job). */
  dispose(): void { for (const s of [...this.open]) { while (!s.disposed) s.release(); } this.open.clear(); this.current = null; this.renderer.dispose(); this.renderer.forceContextLoss(); }
}

/** Camera from a pose: position + quaternion derived by lookAt (pure maths, no Object3D.lookAt state). */
const _m = new Matrix4(), _up = new Vector3(0, 1, 0);
export function applyPose(cam: PerspectiveCamera, p: CameraPose): void {
  cam.position.set(p.position[0], p.position[1], p.position[2]); _m.lookAt(cam.position, new Vector3(p.target[0], p.target[1], p.target[2]), _up);
  cam.quaternion.setFromRotationMatrix(_m); if (cam.fov !== p.fov) { cam.fov = p.fov; cam.updateProjectionMatrix(); } cam.updateMatrixWorld(true);
}
export const quaternionOf = (cam: PerspectiveCamera): Quaternion => cam.quaternion.clone();
/** Orbit rig: azimuth/elevation/radius are closed-form in t = frame/fps. */
export function orbitPose(frame: number, fps: Fps, o: { radius: number; elevDeg: number; degPerSec: number; startDeg?: number; fov?: number }): CameraPose {
  const t = frame / fps, az = ((o.startDeg ?? 0) + o.degPerSec * t) * Math.PI / 180, el = o.elevDeg * Math.PI / 180;
  return { position: [o.radius * Math.cos(el) * Math.sin(az), o.radius * Math.sin(el), o.radius * Math.cos(el) * Math.cos(az)], target: [0, 0, 0], fov: o.fov ?? 35 };
}
