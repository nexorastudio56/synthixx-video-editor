/** Cinematic finishing layer: film grain, vignette, floating dust. Pure function of timeline time (seeded, frame-quantised) - no Math.random. */
import { CANVAS, type SceneGraph } from "../schemas/scene.schema.js";
import { mulberry32 } from "../visual/types.js";

export interface CinematicOpts { grain?: number; vignette?: number; dust?: number; dustCount?: number }
export const LIGHT: CinematicOpts = { grain: 0.07, vignette: 0.42, dust: 0.5, dustCount: 14 }; // sized for 4 GB VRAM / software render
export function composeCinematic(graph: SceneGraph, o: CinematicOpts = LIGHT): string {
  const { width: W, height: H } = CANVAS[graph.aspectRatio]; const T = +(graph.durationFrames / graph.fps).toFixed(3); const fps = graph.fps;
  const r = mulberry32(graph.fps * 7919 + W); const n = o.dustCount ?? 14;
  const dust = Array.from({ length: n }, () => ({ x: +(r() * W).toFixed(1), y: +(r() * H).toFixed(1), s: +(2 + r() * 5).toFixed(1), v: +(10 + r() * 24).toFixed(1), a: +(6 + r() * 14).toFixed(1), p: +(r() * 6.28).toFixed(2), o: +(0.15 + r() * 0.35).toFixed(2) }));
  return `<template><style>#root{position:absolute;inset:0;overflow:hidden;pointer-events:none}
#vg{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 46%,rgba(0,0,0,0) 52%,rgba(0,0,0,${o.vignette}) 100%)}
#gr{position:absolute;left:-256px;top:-256px;width:${W + 512}px;height:${H + 512}px;background:url('assets/grain.png');background-size:256px;opacity:${o.grain};mix-blend-mode:overlay}
.dm{position:absolute;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.9),rgba(255,255,255,0) 70%)}</style>
<div id="root" data-composition-id="cine" data-width="${W}" data-height="${H}"><div id="vg"></div>${dust.map((d, i) => `<div class="dm" id="d${i}" style="width:${d.s * 2}px;height:${d.s * 2}px;opacity:${(d.o * (o.dust ?? .5)).toFixed(2)}"></div>`).join("")}<div id="gr"></div></div>
<script>const D=${JSON.stringify(dust)},W=${W},H=${H},FPS=${fps};
function hs(n){n=Math.imul(n^(n>>>16),2246822507);n=Math.imul(n^(n>>>13),3266489909);return((n^(n>>>16))>>>0)/4294967295}
const els=D.map((_,i)=>document.getElementById('d'+i)),gr=document.getElementById('gr'),st={t:0};
const tl=gsap.timeline({paused:true});
tl.to(st,{t:${T},duration:${T},ease:'none',onUpdate(){const t=st.t,f=Math.floor(t*FPS);
 gr.style.transform='translate('+Math.round(hs(f*2+1)*256)+'px,'+Math.round(hs(f*2+2)*256)+'px)';
 D.forEach((d,i)=>{const y=((d.y-d.v*t)%H+H)%H,x=d.x+Math.sin(t*.6+d.p)*d.a;els[i].style.transform='translate('+x.toFixed(1)+'px,'+y.toFixed(1)+'px)'})}},0);
window.__timelines["cine"]=tl;</script></template>`;
}
