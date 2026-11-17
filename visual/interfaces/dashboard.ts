import type { Component } from "../types.js";
import { byType, esc } from "../types.js";
import { WRAP, U } from "./shared.js";
export const dashboard: Component = {
  kind: ["dashboard"],
  render(e, actions, c) {
    const id = e.id; const heights = [38, 56, 44, 72, 52, 88, 64, 100];
    const bars = heights.map((h, i) => `<div class="bar_${id} m-pill" style="position:absolute;left:${6 + i * 11}%;bottom:0;width:7%;height:${h}%;border-radius:${U(1.4)} ${U(1.4)} ${U(.4)} ${U(.4)};transform-origin:50% 100%"></div>`).join("");
    const html = WRAP(`<div style="position:absolute;left:${U(3)};top:${U(2.4)};font-size:${U(2.6)};letter-spacing:${U(.4)};font-weight:700;text-transform:uppercase;color:var(--ink2)">${esc(String(e.props.title ?? "Live data"))}</div>
<div style="position:absolute;right:${U(3)};top:${U(2)};display:flex;align-items:center;gap:${U(1)};font-size:${U(2.4)};font-weight:800;color:var(--bad)"><i style="width:${U(1.6)};height:${U(1.6)};border-radius:50%;background:var(--bad);box-shadow:0 0 12px var(--bad)"></i>LIVE</div>
<div style="position:absolute;left:${U(3)};top:${U(7)};font-size:${U(11)};font-weight:800;letter-spacing:-.04em;line-height:1" class="m-glow"><span class="kpi_${id}">0</span><span style="font-size:${U(5)}">${esc(String(e.props.unit ?? ""))}</span></div>
<div style="position:absolute;left:46%;right:${U(3)};top:${U(8)};bottom:${U(3)}">${bars}</div>`);
    let js = ""; const ap = byType(actions, "appear")[0]; const t0 = ap ? c.sec(ap.startFrame) : 0;
    js += `tl.fromTo('.bar_${id}',{scaleY:0},{scaleY:1,duration:.5,ease:'back.out(1.5)',stagger:.07},${t0 + .2});tl.to('.bar_${id}',{scaleY:'+=0.12',duration:.4,yoyo:true,repeat:3,stagger:.05,ease:'sine.inOut'},${t0 + 1.0});`;
    byType(actions, "count").forEach(k => { js += `CNT('.kpi_${id}',0,${k.value ?? 100},${c.sec(k.startFrame)},${c.sec(k.endFrame)});`; });
    return { html, js };
  },
};
