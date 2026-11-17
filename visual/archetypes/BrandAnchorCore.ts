/**
 * BrandAnchorCore - persistent 3D prism/cube (glass front, matte-black body, Signal Red crown).
 * Its front-face icon morphs (code | checkmark | waveform | bolt) on `morph` actions that the director syncs to narration words.
 * Orientation is a pure function of GLOBAL time -> identical continuation across scene cuts and render chunks.
 */
import type { Component } from "../types.js";
import { byType } from "../types.js";
import { BRAND } from "../materials/brandTheme.js";

const R = { toString: () => BRAND.signalRed }; // live (theme-driven) accent: resolved at render time
const ICONS: Record<string, string> = {
  code: `<polyline points="36,28 14,50 36,72"/><polyline points="64,28 86,50 64,72"/><line x1="57" y1="22" x2="43" y2="78"/>`,
  checkmark: `<polyline points="20,53 42,75 80,28"/>`,
  waveform: `<line x1="18" y1="42" x2="18" y2="58"/><line x1="34" y1="28" x2="34" y2="72"/><line x1="50" y1="14" x2="50" y2="86"/><line x1="66" y1="30" x2="66" y2="70"/><line x1="82" y1="44" x2="82" y2="56"/>`,
  bolt: `<polygon points="57,8 22,57 46,57 40,92 78,40 54,40" stroke-linejoin="round"/>`,
};
export const anchorCore: Component = {
  kind: ["anchor_core"],
  render(e, actions, c) {
    const id = e.id, dark = c.profile.dark, start = String(e.props.face ?? "code");
    const morphs = byType(actions, "morph"), hl = byType(actions, "highlight");
    const face = (rot: string, bg: string, extra = "") => `<div class="af" style="transform:${rot};background:${bg};${extra}"></div>`;
    const matte = `linear-gradient(145deg,#1A1A1D,${BRAND.carbonBlack})`, edge = `border:1px solid ${BRAND.accA(.55)};box-shadow:inset 0 0 18px ${BRAND.accA(.18)}`;
    const glass = dark ? `linear-gradient(145deg,#222226,#0E0E10)` : `linear-gradient(145deg,rgba(255,255,255,.98),rgba(255,255,255,.62))`;
    const html = `<div class="as_${id}" style="position:absolute;inset:0;perspective:760px;--s:calc(min(100cqw,100cqh)*.56)">
<div style="position:absolute;left:50%;bottom:4%;width:calc(var(--s)*1.5);height:calc(var(--s)*.26);margin-left:calc(var(--s)*-.75);border-radius:50%;background:radial-gradient(closest-side,${BRAND.glowRed},transparent);filter:blur(10px)"></div>
<div class="cp_${id}" style="position:absolute;left:50%;top:50%;width:var(--s);height:var(--s);margin:calc(var(--s)*-.5) 0 0 calc(var(--s)*-.5)">
<div class="cube_${id}" style="position:absolute;inset:0;transform-style:preserve-3d">
${face("translateZ(calc(var(--s)/2))", glass, `border:1.5px solid ${BRAND.accA(.55)};box-shadow:0 0 30px ${BRAND.glowRed}`)}
${face("rotateY(180deg) translateZ(calc(var(--s)/2))", matte, edge)}
${face("rotateY(90deg) translateZ(calc(var(--s)/2))", matte, edge)}
${face("rotateY(-90deg) translateZ(calc(var(--s)/2))", matte, edge)}
${face("rotateX(90deg) translateZ(calc(var(--s)/2))", `linear-gradient(145deg,${BRAND.hi},${R})`, `box-shadow:0 0 40px ${BRAND.glowRed}`)}
${face("rotateX(-90deg) translateZ(calc(var(--s)/2))", matte, edge)}
<div class="af" style="transform:translateZ(calc(var(--s)/2 + 1px));background:none"><svg viewBox="0 0 100 100" style="position:absolute;inset:18%;width:64%;height:64%" fill="none" stroke="${R}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">
${Object.keys(ICONS).map(k => `<g class="ic_${id}_${k}" style="opacity:${k === start ? 1 : 0};transform-box:fill-box;transform-origin:50% 50%">${ICONS[k]}</g>`).join("")}</svg></div>
</div></div></div>`;
    const css = `.af{position:absolute;inset:0;border-radius:calc(var(--s)*.12);backface-visibility:hidden}`;
    const S = c.sceneStartFrame / c.fps, dur = c.sec(c.graph.scenes.find(s => s.startFrame === c.sceneStartFrame)!.endFrame);
    let js = `{const cube=document.querySelector('.cube_${id}'),st={t:0},S=${S};const F=t=>{const g=S+t;cube.style.transform='rotateX('+(-12+6*Math.sin(6.2831853*g/7+1)).toFixed(2)+'deg) rotateY('+(26*Math.sin(6.2831853*g/9)).toFixed(2)+'deg)'};F(0);tl.to(st,{t:${dur.toFixed(3)},duration:${dur.toFixed(3)},ease:'none',onUpdate:()=>F(st.t)},0)}`;
    let cur = start;
    for (const m of morphs) {
      const t = c.sec(m.startFrame), next = m.text!; if (next === cur) continue;
      js += `tl.to('.ic_${id}_${cur}',{opacity:0,scale:.55,duration:.16,ease:'power2.in'},${t});tl.fromTo('.ic_${id}_${next}',{opacity:0,scale:.4},{opacity:1,scale:1,duration:.6,ease:SPR},${(t + .1).toFixed(3)});tl.fromTo('.cp_${id}',{scale:1},{scale:1.14,duration:.14,yoyo:true,repeat:1,ease:'sine.inOut'},${t});`;
      cur = next;
    }
    for (const h of hl) js += `tl.fromTo('.cp_${id}',{scale:1},{scale:1.1,duration:.18,yoyo:true,repeat:1,ease:'sine.inOut'},${c.sec(h.startFrame)});`;
    return { html, css, js };
  },
};
