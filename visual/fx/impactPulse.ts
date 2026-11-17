/**
 * Impact pulse: deterministic, band-limited camera micro-pulse + ambient-orb glow pulse driven by emphasisTrack.impacts (score > threshold).
 *  - Translation only, hard-capped at 0.8% of the viewport short edge. Kernel = Hann window (zero value AND zero slope at both ends => band-limited, no discontinuity).
 *  - Orb glow: scale 1 + 0.12 * kernel (peaks exactly 1.12x).
 *  - Applies to L0 (backdrop) and L1 (hero) only. L2 (captions, logos, text, brand anchor) is excluded by `PULSE_EXCLUDED_KINDS`.
 * Evaluated from continuous global time t = frame/fps and rand3(seed, impactIndex, channel), so any frame can be sampled in any order.
 */
import { rand3 } from "../../core/determinism/counterRng.js";
import type { EmphasisTrack } from "../../audio/emphasisAnalyzer.js";

export const PULSE_SEC = 0.28;
export const CAMERA_CAP = 0.008;       // fraction of viewport short edge
export const GLOW_PEAK = 1.12;
export const IMPACT_THRESHOLD = 0.72;
export const PULSE_EXCLUDED_KINDS: ReadonlySet<string> = new Set(["kinetic_words", "logo", "text", "anchor_core", "cutout"]);
export interface PulseImpact { readonly frame: number; readonly score: number; readonly index: number }
export interface Pulse { readonly dx: number; readonly dy: number; readonly glow: number; readonly kernel: number; readonly impact: number }
export const NO_PULSE: Pulse = { dx: 0, dy: 0, glow: 1, kernel: 0, impact: -1 };

export const hann = (tau: number, dur: number = PULSE_SEC): number => (tau <= 0 || tau >= dur ? 0 : 0.5 * (1 - Math.cos((2 * Math.PI * tau) / dur)));
export const impactsOf = (track: Pick<EmphasisTrack, "impacts" | "threshold">): PulseImpact[] => track.impacts.filter(i => i.score > track.threshold).map((i, index) => ({ frame: i.frame, score: i.score, index })).sort((a, b) => a.frame - b.frame);

/** Pulse at continuous time tSec. `seed` picks each impact's direction via the counter RNG. */
export function pulseAtTime(impacts: readonly PulseImpact[], tSec: number, fps: number, viewW: number, viewH: number, seed = 0x51f7): Pulse {
  let lo = 0, hi = impacts.length - 1, found = -1; // last impact with onset <= t
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (impacts[mid].frame / fps <= tSec) { found = mid; lo = mid + 1; } else hi = mid - 1; }
  if (found < 0) return NO_PULSE; const im = impacts[found], tau = tSec - im.frame / fps, k = hann(tau); if (k === 0) return NO_PULSE;
  const strength = Math.min(1, Math.max(0, (im.score - IMPACT_THRESHOLD) / (1 - IMPACT_THRESHOLD)));
  const amp = CAMERA_CAP * Math.min(viewW, viewH) * (0.6 + 0.4 * strength), th = 2 * Math.PI * rand3(seed, im.index, 0);
  return { dx: amp * k * Math.cos(th), dy: amp * k * Math.sin(th), glow: 1 + (GLOW_PEAK - 1) * k, kernel: k, impact: im.index };
}
export const pulseAtFrame = (impacts: readonly PulseImpact[], frame: number, fps: number, w: number, h: number, seed?: number): Pulse => pulseAtTime(impacts, frame / fps, fps, w, h, seed);

/** Self-contained browser runtime with the identical maths (hash3 = counterRng.ts). Injected into scene compositions. */
export function pulseRuntimeJs(impacts: readonly PulseImpact[], fps: number, viewW: number, viewH: number, seed = 0x51f7): string {
  return `const __IMP=${JSON.stringify(impacts.map(i => [i.frame, i.score, i.index]))},__FPS=${fps},__VW=${viewW},__VH=${viewH},__SEED=${seed},__PS=${PULSE_SEC},__CAP=${CAMERA_CAP},__TH=${IMPACT_THRESHOLD};
function __h32(x){x>>>=0;x=(x^(x>>>16))>>>0;x=Math.imul(x,0x7feb352d)>>>0;x=(x^(x>>>15))>>>0;x=Math.imul(x,0x846ca68b)>>>0;x=(x^(x>>>16))>>>0;return x}
function __r3(s,i,c){let h=__h32(s);h=__h32((h^(i>>>0))>>>0);h=__h32((h+Math.imul(c>>>0,0x9e3779b9))>>>0);return h/4294967296}
function __pulse(t){let lo=0,hi=__IMP.length-1,f=-1;while(lo<=hi){const m=(lo+hi)>>1;if(__IMP[m][0]/__FPS<=t){f=m;lo=m+1}else hi=m-1}
if(f<0)return {dx:0,dy:0,glow:1};const im=__IMP[f],tau=t-im[0]/__FPS;if(tau<=0||tau>=__PS)return {dx:0,dy:0,glow:1};
const k=0.5*(1-Math.cos(6.283185307179586*tau/__PS)),st=Math.min(1,Math.max(0,(im[1]-0.72)/0.28)),amp=__CAP*Math.min(__VW,__VH)*(0.6+0.4*st),th=6.283185307179586*__r3(__SEED,im[2],0);
return {dx:amp*k*Math.cos(th),dy:amp*k*Math.sin(th),glow:1+0.12*k}}`;
}
