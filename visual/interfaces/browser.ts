import type { Component } from "../types.js";
import { byType, esc, jsStr } from "../types.js";
import { WRAP, DOTS, U } from "./shared.js";
export const browser: Component = {
  kind: ["browser"],
  render(e, actions, c) {
    const id = e.id, url = String(e.props.url ?? "agent://browse");
    const clicks = byType(actions, "click"), types = byType(actions, "type");
    const html = WRAP(`${DOTS}
<div class="m-inset" style="position:absolute;left:${U(14)};right:${U(3)};top:${U(1.8)};height:${U(5)};border-radius:${U(2.5)};overflow:hidden"><span class="url_${id}" style="position:absolute;left:${U(2.4)};top:${U(.9)};font-size:${U(3)};font-weight:700;color:var(--ink2);white-space:nowrap">${esc(url)}</span></div>
<div style="position:absolute;left:${U(3)};right:${U(3)};top:${U(10)};bottom:${U(3)};border-radius:${U(2.5)};overflow:hidden">
 <div class="m-chip" style="position:absolute;left:0;top:0;width:100%;height:42%;border-radius:${U(2.2)}"></div>
 <div class="m-chip" style="position:absolute;left:0;top:48%;width:58%;height:${U(2.4)};border-radius:${U(1.2)}"></div>
 <div class="m-chip" style="position:absolute;left:0;top:calc(48% + ${U(4.4)});width:38%;height:${U(2)};border-radius:${U(1)}"></div>
 <div class="m-pill btn_${id}" style="position:absolute;right:0;bottom:0;width:30%;height:${U(7)};border-radius:${U(3.5)}"></div>
</div>
<svg class="cur_${id}" viewBox="0 0 24 24" style="position:absolute;left:12%;top:60%;width:${U(6)};height:${U(6)};opacity:0;filter:drop-shadow(0 0 8px var(--acc));z-index:5"><path d="M5 3l14 8-6 2 4 7-3 1-4-7-5 4z" fill="#fff" stroke="#111" stroke-width="1"/></svg>
<div class="rip_${id}" style="position:absolute;width:${U(8)};height:${U(8)};border-radius:50%;border:3px solid var(--acc);opacity:0;z-index:4"></div>`);
    let js = "";
    for (const t of types) js += `TY('.url_${id}',${jsStr(t.text ?? url)},${c.sec(t.startFrame)},${c.sec(t.endFrame)});`;
    // initial url text empty only if a type action exists
    clicks.forEach((k, i) => {
      const t0 = c.sec(k.startFrame), t1 = c.sec(k.endFrame);
      js += `{const cur='.cur_${id}',rip='.rip_${id}',btn=document.querySelector('.btn_${id}');tl.fromTo(cur,{opacity:0,left:'12%',top:'62%'},{opacity:1,left:'72%',top:'84%',duration:Math.max(.3,(${t1}-${t0})*.7),ease:'power2.inOut'},${t0});
tl.fromTo(rip,{opacity:.9,scale:.3,left:'78%',top:'84%'},{opacity:0,scale:1.6,duration:.45,ease:'power2.out'},${t1});tl.fromTo('.btn_${id}',{scale:1},{scale:${c.profile.motion.press},duration:.1,yoyo:true,repeat:1,transformOrigin:'50% 50%'},${t1});tl.to(cur,{opacity:0,duration:.25},${t1 + 0.5});}`;
    });
    if (types.length) js = `document.querySelector('.url_${id}').textContent='';` + js;
    return { html, js };
  },
};
