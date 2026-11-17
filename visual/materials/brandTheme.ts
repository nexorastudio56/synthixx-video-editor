/**
 * THEME-DRIVEN CANVAS (light/dark alternating; colours come from the active theme).
 * Strict palette discipline: only White / Carbon Black / Signal Red (+ its glow). No purples, greens, blues.
 * Two alternating dual-mode canvases (retention): canvas_light <-> canvas_dark.
 * All motion is a pure function of GLOBAL time (scene start + local time): deterministic across chunks.
 */
import type { Profile, Motion } from "./morphismProfiles.js";
/** Live brand palette. Defaults = neutral fallback (never shipped; every run is themed); `setBrandPalette` swaps it per scene (theme-driven, deterministic: set -> render -> reset, synchronous). */
export interface Palette {
  readonly light: string; readonly dark: string; readonly acc: string; readonly hi: string; readonly glow: string; readonly crimson: string; readonly deep: string; readonly soft: string;
  readonly ok: string; readonly base: string | null; readonly gridPx: number; readonly orbBlur: number | null; readonly accRgb: readonly [number, number, number];
}
export const DEFAULT_PALETTE: Palette = { light: "#F8FAFC", dark: "#0F172A", acc: "#2563EB", hi: "#3B82F6", glow: "rgba(59, 130, 246, 0.42)", crimson: "rgba(30, 64, 175, 0.62)", deep: "rgba(23, 37, 84, 0.55)", soft: "rgba(59,130,246,0.30)", ok: "#16A34A", base: null, gridPx: 48, orbBlur: null, accRgb: [37, 99, 235] };
let LIVE: Palette = DEFAULT_PALETTE;
export const setBrandPalette = (p: Palette | null): void => { LIVE = p ?? DEFAULT_PALETTE; };
export const getBrandPalette = (): Palette => LIVE;
export const BRAND = {
  get pureWhite() { return LIVE.light; }, get carbonBlack() { return LIVE.dark; }, get signalRed() { return LIVE.acc; }, get glowRed() { return LIVE.glow; },
  get crimson() { return LIVE.crimson; }, get okGreen() { return LIVE.ok; }, get hi() { return LIVE.hi; }, // okGreen is reserved for the simulator's success checkmark only
  /** accent colour with alpha (replaces hard-coded rgba(230,0,0,a)) */
  accA: (a: number | string): string => `rgba(${LIVE.accRgb[0]},${LIVE.accRgb[1]},${LIVE.accRgb[2]},${a})`,
};
export type BrandMode = "canvas_light" | "canvas_dark";
export const MODES: BrandMode[] = ["canvas_light", "canvas_dark"];
/** primary alternates per scene for retention: light, dark, light, dark ... */
export const modeForScene = (sceneIndex: number, explicit?: BrandMode): BrandMode => explicit ?? MODES[sceneIndex % 2];

const MOTION: Motion = { enterFrom: { opacity: 0, y: 70, scale: .94, rotationX: 14 }, enterEase: "expo.out", enterDur: .65, press: .965, floatAmp: 6, floatPer: 2.8, stagger: .09 };
const LIGHT: Profile = {
  id: "brand", dark: false,
  vars: { "--ink": BRAND.carbonBlack, "--ink2": "rgba(9,9,11,.58)", "--acc": BRAND.signalRed, "--acc2": BRAND.signalRed, "--hot": BRAND.signalRed, "--ok": BRAND.carbonBlack, "--bad": BRAND.signalRed, "--r": "30px", "--glow": BRAND.glowRed, "--card": BRAND.pureWhite },
  css: `
.m-surf{background:linear-gradient(150deg,rgba(255,255,255,.98),rgba(255,255,255,.86));backdrop-filter:blur(18px);border:1px solid rgba(9,9,11,.10);border-radius:var(--r);box-shadow:0 34px 64px rgba(9,9,11,.14),0 0 0 1px rgba(230,0,0,.05),inset 0 1.5px 0 #fff;overflow:hidden}
.m-surf::after{content:'';position:absolute;inset:0;background:radial-gradient(120% 55% at 0% 0%,rgba(255,24,24,.07),transparent 60%);pointer-events:none}
.m-inset{background:rgba(9,9,11,.07);border-radius:999px;box-shadow:inset 0 2px 6px rgba(9,9,11,.14)}
.m-pill{background:linear-gradient(90deg,#E60000,#FF1818);box-shadow:0 0 26px rgba(255,24,24,.42)}
.m-led{background:var(--ok)}
.m-chip{background:#fff;border:1px solid rgba(9,9,11,.12);box-shadow:0 12px 26px rgba(9,9,11,.12)}
.m-glow{text-shadow:0 0 34px rgba(255,24,24,.30)}`,
  motion: MOTION, bg: () => ({ html: "", css: "", js: "" }),
};
const DARK: Profile = {
  id: "brand", dark: true,
  vars: { "--ink": BRAND.pureWhite, "--ink2": "rgba(255,255,255,.62)", "--acc": BRAND.signalRed, "--acc2": BRAND.signalRed, "--hot": BRAND.signalRed, "--ok": BRAND.pureWhite, "--bad": BRAND.signalRed, "--r": "30px", "--glow": BRAND.glowRed, "--card": "#121214" },
  css: `
.m-surf{background:linear-gradient(150deg,#161619,#0C0C0E);border:1px solid rgba(230,0,0,.45);border-radius:var(--r);box-shadow:0 0 44px rgba(230,0,0,.20),0 40px 70px rgba(0,0,0,.65),inset 0 1px 0 rgba(255,255,255,.07);overflow:hidden}
.m-surf::after{content:'';position:absolute;inset:0;background:radial-gradient(120% 55% at 0% 0%,rgba(255,24,24,.12),transparent 60%);pointer-events:none}
.m-inset{background:rgba(255,255,255,.07);border-radius:999px;box-shadow:inset 0 2px 8px rgba(0,0,0,.7)}
.m-pill{background:linear-gradient(90deg,#E60000,#FF1818);box-shadow:0 0 30px rgba(255,24,24,.55)}
.m-led{background:var(--ok)}
.m-chip{background:#151518;border:1px solid rgba(230,0,0,.45);box-shadow:0 0 24px rgba(230,0,0,.18)}
.m-glow{text-shadow:0 0 40px rgba(255,24,24,.55)}`,
  motion: MOTION, bg: () => ({ html: "", css: "", js: "" }),
};
export const brandProfile = (mode: BrandMode): Profile => (mode === "canvas_dark" ? DARK : LIGHT);

/** Scene canvas: solid base + 48px grid + drifting radial blur orbs. Orb positions are f(globalSec) via onUpdate (seek-safe). */
export function brandBackground(mode: BrandMode, W: number, H: number, sceneStartSec: number, sceneDurSec: number, fx?: { runtime: string }): { html: string; css: string; js: string } {
  const dark = mode === "canvas_dark";
  const base = LIVE.base ?? (dark ? BRAND.carbonBlack : BRAND.pureWhite), gl = LIVE.gridPx, gr = dark ? "rgba(255,255,255,0.06)" : "rgba(9,9,11,0.06)", grid = gl > 0 ? gr : "transparent", gsz = gl > 0 ? gl : 48;
  const orbs = dark
    ? [{ s: 980, c: BRAND.crimson, b: LIVE.orbBlur ?? 110, x: .05, y: .12, ax: 170, ay: 120, p: 17, ph: 0 }, { s: 820, c: BRAND.glowRed, b: LIVE.orbBlur ?? 110, x: .55, y: .62, ax: 150, ay: 170, p: 21, ph: 2.1 }, { s: 640, c: LIVE.deep, b: LIVE.orbBlur ?? 110, x: .1, y: .8, ax: 120, ay: 100, p: 13, ph: 4.0 }]
    : [{ s: 900, c: BRAND.glowRed, b: LIVE.orbBlur ?? 100, x: -.05, y: .02, ax: 160, ay: 110, p: 19, ph: 0 }, { s: 760, c: BRAND.glowRed, b: LIVE.orbBlur ?? 100, x: .55, y: .34, ax: 140, ay: 120, p: 23, ph: 1.7 }, { s: 560, c: LIVE.soft, b: LIVE.orbBlur ?? 100, x: .05, y: .5, ax: 110, ay: 80, p: 15, ph: 3.6 }];
  const css = `.bgc{position:absolute;inset:0;background:${base}}.bgg{position:absolute;inset:0;background-image:linear-gradient(${grid} 1px,transparent 1px),linear-gradient(90deg,${grid} 1px,transparent 1px);background-size:${gsz}px ${gsz}px}.bo{position:absolute;border-radius:50%}`;
  const PAD = 20; // backdrop is oversized so the impact micro-pulse (<=0.8% of the short edge) never exposes an edge
  const html = `<div id="bgp" style="position:absolute;inset:-${PAD}px"><div class="bgc"></div>${orbs.map((o, i) => `<div class="bo bo${i}" style="left:${Math.round(o.x * W) + PAD}px;top:${Math.round(o.y * H) + PAD}px;width:${o.s}px;height:${o.s}px;background:${o.c};filter:blur(${o.b}px)"></div>`).join("")}<div class="bgg"></div></div>`;
  const js = `{const O=${JSON.stringify(orbs.map(o => [o.ax, o.ay, o.p, o.ph]))},els=[0,1,2].map(i=>document.querySelector('.bo'+i)),bgp=document.querySelector('#bgp'),st={t:0},S=${sceneStartSec};tl.to(st,{t:${sceneDurSec},duration:${sceneDurSec},ease:'none',onUpdate(){const g=S+st.t;${fx ? "const P=__pulse(g);bgp.style.translate=P.dx.toFixed(3)+'px '+P.dy.toFixed(3)+'px';" : "const P={glow:1};"}O.forEach((o,i)=>{els[i].style.transform='translate('+(o[0]*Math.sin(6.2831853*g/o[2]+o[3])).toFixed(1)+'px,'+(o[1]*Math.cos(6.2831853*g/(o[2]*1.31)+o[3])).toFixed(1)+'px) scale('+P.glow.toFixed(4)+')'})}},0)}`;
  return { html, css, js: (fx ? fx.runtime + "\n" : "") + js };
}
