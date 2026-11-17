/**
 * Unified Morphism Material Engine. One config flag (graph.morphism) swaps the entire look:
 * canvas, surfaces, insets, glow, motion feel. Components only use the semantic classes
 * (.m-surf, .m-inset, .m-pill, .m-led, .m-chip, .m-ink, .m-dim) and CSS vars, never raw colours.
 */
export type MorphismId = "glass" | "clay" | "neumorphism" | "holo" | "skeuomorphism" | "liquid" | "brand";
export interface Motion { enterFrom: Record<string, number | string>; enterEase: string; enterDur: number; press: number; floatAmp: number; floatPer: number; stagger: number }
export interface Profile {
  id: MorphismId; dark: boolean; vars: Record<string, string>; css: string; motion: Motion;
  bg: (totalSec: number) => { html: string; css: string; js: string };
}
const FONT = "font-family:'InterX',sans-serif";
const orb = (cls: string, l: number, t: number, s: number, c: string, blur = 120) => `<div class="${cls}" style="position:absolute;left:${l}px;top:${t}px;width:${s}px;height:${s}px;border-radius:50%;background:${c};filter:blur(${blur}px)"></div>`;
const drift = (cls: string, x: number, y: number, T: number) => `tl.to('.${cls}',{x:${x},y:${y},duration:${T},ease:'sine.inOut'},0);`;

const GLASS: Profile = {
  id: "glass", dark: true,
  vars: { "--ink": "#fff", "--ink2": "rgba(255,255,255,.62)", "--acc": "#22e1ff", "--acc2": "#8b5cf6", "--hot": "#f15bb5", "--ok": "#7dff9b", "--bad": "#ff3b4a", "--r": "44px" },
  css: `
.m-surf{background:linear-gradient(145deg,rgba(255,255,255,.11),rgba(255,255,255,.03));backdrop-filter:blur(16px) saturate(180%);border:1.5px solid rgba(255,255,255,.18);border-radius:var(--r);box-shadow:inset 0 1.5px 1px rgba(255,255,255,.3),inset 1.5px 0 1px rgba(255,255,255,.12),0 40px 70px rgba(0,0,0,.6);overflow:hidden}
.m-surf::after{content:'';position:absolute;inset:0;background:radial-gradient(120% 60% at 0% 0%,rgba(255,255,255,.18),transparent 55%);pointer-events:none}
.m-inset{background:rgba(0,0,0,.42);border-radius:999px;box-shadow:inset 5px 5px 12px rgba(0,0,0,.65),inset -3px -3px 8px rgba(255,255,255,.06)}
.m-pill{background:linear-gradient(90deg,var(--acc2),var(--acc));box-shadow:0 0 30px rgba(34,225,255,.5)}
.m-led{background:var(--ok);box-shadow:0 0 14px var(--ok)}
.m-chip{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2)}
.m-glow{text-shadow:0 0 40px rgba(34,225,255,.55),0 0 90px rgba(139,92,246,.45)}`,
  motion: { enterFrom: { opacity: 0, y: 90, scale: .9, rotationX: 22 }, enterEase: "expo.out", enterDur: .7, press: .96, floatAmp: 9, floatPer: 2.4, stagger: .1 },
  bg: T => ({ html: `<div class="bgc" style="position:absolute;inset:0;background:#07090E"></div>${orb("o1", -300, 100, 900, "rgba(139,92,246,.75)")}${orb("o2", 520, 700, 850, "rgba(34,225,255,.5)")}${orb("o3", -100, 1250, 800, "rgba(241,91,181,.5)")}<div class="gd" style="position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.05) 2px,transparent 2px),linear-gradient(90deg,rgba(255,255,255,.05) 2px,transparent 2px);background-size:90px 90px"></div>`, css: "", js: drift("o1", 380, 260, T) + drift("o2", -380, -300, T) + drift("o3", 420, -240, T) + `tl.fromTo('.gd',{backgroundPosition:'0px 0px'},{backgroundPosition:'0px 180px',duration:${T},ease:'none'},0);` }),
};
const CLAY: Profile = {
  id: "clay", dark: false,
  vars: { "--ink": "#2b2d5b", "--ink2": "#6b6e9c", "--acc": "#6366F1", "--acc2": "#EC4899", "--hot": "#F59E0B", "--ok": "#10B981", "--bad": "#EF4444", "--r": "56px" },
  css: `
.m-surf{background:linear-gradient(145deg,#ffffff,#e6e9ff);border-radius:var(--r);box-shadow:14px 16px 30px rgba(99,102,241,.28),inset -10px -10px 20px rgba(99,102,241,.14),inset 10px 10px 20px rgba(255,255,255,.95)}
.m-inset{background:#d8dcff;border-radius:999px;box-shadow:inset 8px 8px 16px rgba(99,102,241,.3),inset -8px -8px 16px rgba(255,255,255,.9)}
.m-pill{background:linear-gradient(135deg,#818cf8,#6366F1);box-shadow:8px 8px 16px rgba(99,102,241,.35),inset -6px -6px 12px rgba(0,0,0,.18),inset 6px 6px 12px rgba(255,255,255,.55)}
.m-led{background:var(--ok);box-shadow:inset -3px -3px 6px rgba(0,0,0,.2),inset 3px 3px 6px rgba(255,255,255,.6)}
.m-chip{background:linear-gradient(145deg,#fff,#eef0ff);box-shadow:6px 6px 12px rgba(99,102,241,.2),inset 4px 4px 8px #fff}
.m-glow{text-shadow:0 6px 0 rgba(99,102,241,.18)}`,
  motion: { enterFrom: { opacity: 0, scale: .25, y: 60 }, enterEase: "elastic.out(1,0.45)", enterDur: 1.0, press: .9, floatAmp: 14, floatPer: 2.0, stagger: .12 },
  bg: T => ({ html: `<div class="bgc" style="position:absolute;inset:0;background:linear-gradient(165deg,#E0E7FF,#F3E8FF)"></div>${orb("o1", -200, 150, 700, "rgba(236,72,153,.30)", 90)}${orb("o2", 560, 800, 700, "rgba(99,102,241,.35)", 90)}${orb("o3", -100, 1350, 700, "rgba(16,185,129,.25)", 90)}`, css: "", js: drift("o1", 300, 200, T) + drift("o2", -300, -250, T) + drift("o3", 350, -200, T) }),
};
const NEU: Profile = {
  id: "neumorphism", dark: true,
  vars: { "--ink": "#e6e9ef", "--ink2": "#8b90a0", "--acc": "#06B6D4", "--acc2": "#F59E0B", "--hot": "#F59E0B", "--ok": "#34d399", "--bad": "#fb7185", "--r": "40px" },
  css: `
.m-surf{background:#1E2025;border-radius:var(--r);box-shadow:12px 12px 24px #141518,-12px -12px 24px #282B32}
.m-inset{background:#1E2025;border-radius:999px;box-shadow:inset 7px 7px 14px #141518,inset -7px -7px 14px #282B32}
.m-pill{background:#1E2025;box-shadow:0 0 22px rgba(6,182,212,.7),inset 0 0 0 3px #06B6D4}
.m-led{background:var(--acc);box-shadow:0 0 16px var(--acc)}
.m-chip{background:#1E2025;box-shadow:6px 6px 12px #141518,-6px -6px 12px #282B32}
.m-glow{text-shadow:0 0 24px rgba(6,182,212,.5)}`,
  motion: { enterFrom: { opacity: 0, scale: .94, y: 20 }, enterEase: "power2.out", enterDur: .5, press: .94, floatAmp: 4, floatPer: 3.0, stagger: .08 },
  bg: T => ({ html: `<div class="bgc" style="position:absolute;inset:0;background:#1E2025"></div>${orb("o1", 100, 300, 800, "rgba(6,182,212,.05)", 140)}`, css: "", js: drift("o1", 200, 400, T) }),
};
const HOLO: Profile = {
  id: "holo", dark: true,
  vars: { "--ink": "#f4f6ff", "--ink2": "rgba(244,246,255,.6)", "--acc": "#00F5D4", "--acc2": "#9B5DE5", "--hot": "#F15BB5", "--ok": "#00F5D4", "--bad": "#ff4d6d", "--r": "36px" },
  css: `
.m-surf{position:relative;background:linear-gradient(145deg,rgba(14,14,30,.82),rgba(6,6,16,.7));border-radius:var(--r);box-shadow:0 0 30px rgba(155,93,229,.3),inset 0 0 20px rgba(0,245,212,.15);overflow:hidden}
.m-surf::before{content:'';position:absolute;inset:0;border-radius:inherit;padding:2.5px;background:linear-gradient(135deg,#00F5D4,#9B5DE5,#F15BB5,#00F5D4);background-size:200% 200%;-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none}
.m-surf::after{content:'';position:absolute;inset:0;background:linear-gradient(115deg,transparent 30%,rgba(255,255,255,.1) 45%,transparent 60%);pointer-events:none}
.m-inset{background:rgba(0,0,0,.5);border-radius:999px;box-shadow:inset 0 0 16px rgba(155,93,229,.4)}
.m-pill{background:linear-gradient(90deg,#9B5DE5,#00F5D4,#F15BB5);box-shadow:0 0 28px rgba(0,245,212,.55)}
.m-led{background:var(--acc);box-shadow:0 0 14px var(--acc)}
.m-chip{background:rgba(155,93,229,.14);border:1px solid rgba(0,245,212,.4)}
.m-glow{text-shadow:-2px 0 rgba(255,0,110,.7),2px 0 rgba(0,245,212,.7),0 0 36px rgba(155,93,229,.6)}`,
  motion: { enterFrom: { opacity: 0, x: -70, skewX: 10, filter: "blur(10px)" }, enterEase: "power3.out", enterDur: .6, press: .96, floatAmp: 7, floatPer: 2.6, stagger: .09 },
  bg: T => ({ html: `<div class="bgc" style="position:absolute;inset:0;background:#030305"></div>${orb("o1", -300, 100, 950, "rgba(155,93,229,.65)", 130)}${orb("o2", 450, 600, 900, "rgba(0,245,212,.4)", 130)}${orb("o3", -200, 1250, 900, "rgba(241,91,181,.5)", 130)}${orb("o4", 500, 1300, 700, "rgba(163,255,0,.18)", 130)}`, css: "", js: drift("o1", 420, 300, T) + drift("o2", -420, -260, T) + drift("o3", 460, -300, T) + drift("o4", -300, -400, T) }),
};
const SKEUO: Profile = {
  id: "skeuomorphism", dark: true,
  vars: { "--ink": "#e8ecf2", "--ink2": "#98a0ad", "--acc": "#ffb020", "--acc2": "#34d1ff", "--hot": "#ff5a36", "--ok": "#43e97b", "--bad": "#ff4d4d", "--r": "30px" },
  css: `
.m-surf{background:linear-gradient(145deg,#2f3238,#1a1c1f);border-radius:var(--r);border:2px solid #0e0f11;box-shadow:inset 0 2px 1px rgba(255,255,255,.22),inset 0 -3px 2px rgba(0,0,0,.6),0 15px 35px rgba(0,0,0,.8),0 2px 0 #3d4149}
.m-surf::after{content:'';position:absolute;inset:0;background:repeating-linear-gradient(90deg,rgba(255,255,255,.025) 0 2px,transparent 2px 4px),linear-gradient(160deg,rgba(255,255,255,.12),transparent 40%);pointer-events:none;border-radius:inherit}
.m-inset{background:linear-gradient(180deg,#0c0d0f,#17191c);border-radius:999px;box-shadow:inset 0 5px 10px rgba(0,0,0,.9),0 1px 0 rgba(255,255,255,.12)}
.m-pill{background:linear-gradient(180deg,#ffd27a,#ff9d00);box-shadow:0 0 18px rgba(255,176,32,.55),inset 0 2px 2px rgba(255,255,255,.7)}
.m-led{background:radial-gradient(circle at 35% 30%,#d6ffe3,var(--ok) 55%,#0a7a35);box-shadow:0 0 16px var(--ok),inset 0 -2px 3px rgba(0,0,0,.35)}
.m-chip{background:linear-gradient(145deg,#3a3d44,#22252a);box-shadow:inset 0 1px 1px rgba(255,255,255,.2),0 6px 12px rgba(0,0,0,.6)}
.m-glow{text-shadow:0 0 22px rgba(255,176,32,.5)}`,
  motion: { enterFrom: { opacity: 0, y: -90, scale: 1.05 }, enterEase: "back.out(1.5)", enterDur: .55, press: .93, floatAmp: 3, floatPer: 3.2, stagger: .09 },
  bg: T => ({ html: `<div class="bgc" style="position:absolute;inset:0;background:radial-gradient(120% 80% at 50% 20%,#2a2d33,#0f1012 70%),repeating-linear-gradient(90deg,#23262b 0 2px,#1b1d21 2px 4px);background-blend-mode:overlay"></div><div style="position:absolute;inset:0;background:repeating-linear-gradient(90deg,rgba(255,255,255,.035) 0 2px,transparent 2px 5px)"></div>`, css: "", js: "" }),
};
const LIQUID: Profile = {
  id: "liquid", dark: true,
  vars: { "--ink": "#fff", "--ink2": "rgba(255,255,255,.65)", "--acc": "#5eead4", "--acc2": "#a78bfa", "--hot": "#fb7185", "--ok": "#86efac", "--bad": "#fb7185", "--r": "90px 50px 80px 44px / 52px 84px 44px 76px" },
  css: `
.m-surf{background:radial-gradient(120% 90% at 25% 15%,rgba(255,255,255,.34),rgba(255,255,255,.07) 45%,rgba(94,234,212,.12));border:1.5px solid rgba(255,255,255,.28);border-radius:var(--r);box-shadow:inset 0 10px 24px rgba(255,255,255,.28),inset 0 -16px 30px rgba(167,139,250,.25),0 40px 70px rgba(0,0,0,.55);backdrop-filter:blur(10px) saturate(160%);overflow:hidden}
.m-surf::after{content:'';position:absolute;left:8%;top:5%;width:46%;height:22%;border-radius:50%;background:linear-gradient(180deg,rgba(255,255,255,.6),transparent);filter:blur(4px);pointer-events:none}
.m-inset{background:rgba(0,0,0,.35);border-radius:999px;box-shadow:inset 5px 6px 14px rgba(0,0,0,.6),inset -2px -2px 8px rgba(255,255,255,.12)}
.m-pill{background:linear-gradient(90deg,#a78bfa,#5eead4);box-shadow:0 0 28px rgba(94,234,212,.5),inset 0 4px 8px rgba(255,255,255,.5)}
.m-led{background:var(--acc);box-shadow:0 0 14px var(--acc)}
.m-chip{background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.3);backdrop-filter:blur(8px)}
.m-glow{text-shadow:0 0 36px rgba(94,234,212,.6)}`,
  motion: { enterFrom: { opacity: 0, scale: .2 }, enterEase: "elastic.out(1,0.6)", enterDur: 1.1, press: .92, floatAmp: 10, floatPer: 2.8, stagger: .12 },
  bg: T => ({ html: `<div class="bgc" style="position:absolute;inset:0;background:#05060a"></div>${orb("o1", -250, 100, 900, "rgba(167,139,250,.6)", 110)}${orb("o2", 480, 650, 900, "rgba(94,234,212,.45)", 110)}${orb("o3", -100, 1300, 800, "rgba(251,113,133,.4)", 110)}`, css: "", js: drift("o1", 360, 300, T) + drift("o2", -360, -260, T) + drift("o3", 420, -240, T) }),
};
import { brandProfile } from "./brandTheme.js";
export const PROFILES: Record<MorphismId, Profile> = { brand: brandProfile("canvas_light"), glass: GLASS, clay: CLAY, neumorphism: NEU, holo: HOLO, skeuomorphism: SKEUO, liquid: LIQUID };
export const FONT_CSS = FONT;
export function profileCss(p: Profile): string {
  const vars = Object.entries(p.vars).map(([k, v]) => `${k}:${v}`).join(";");
  return `:root{${vars}}.m-ink{color:var(--ink)}.m-dim{color:var(--ink2)}${p.css}`;
}
