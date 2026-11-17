import type { Component } from "../types.js";
import { byType, esc } from "../types.js";
import { WRAP, U } from "./shared.js";
export const workflow: Component = {
  kind: ["workflow"],
  render(e, actions, c) {
    const id = e.id, b = c.box(e);
    const nodes = (Array.isArray(e.props.nodes) ? e.props.nodes as string[] : ["Trigger", "Agent", "Action"]);
    const glyphs = ["⚡", "✦", "➜", "✉", "⚙", "✓"];
    const horiz = b.w >= b.h * 1.15; const n = nodes.length;
    const pos = (i: number) => horiz ? { x: (i + 0.5) / n * 100, y: 50 } : { x: 50, y: (i + 0.5) / n * 100 };
    const nodeHtml = nodes.map((t, i) => { const p = pos(i); return `<div class="nd_${id}_${i} m-chip" style="position:absolute;left:${p.x}%;top:${p.y}%;width:${U(horiz ? 24 : 40)};height:${U(horiz ? 24 : 14)};margin-left:${U(horiz ? -12 : -20)};margin-top:${U(horiz ? -12 : -7)};border-radius:${U(5)};display:flex;flex-direction:${horiz ? "column" : "row"};align-items:center;justify-content:center;gap:${U(1)};opacity:0"><span style="font-size:${U(7)}">${glyphs[i % glyphs.length]}</span><span style="font-size:${U(2.8)};font-weight:800;letter-spacing:${U(.3)};text-transform:uppercase">${esc(t)}</span></div>`; }).join("");
    const lines = nodes.slice(1).map((_, i) => { const a = pos(i), z = pos(i + 1); const L = horiz ? `left:${a.x}%;top:calc(${a.y}% - 3px);width:${z.x - a.x}%;height:6px;transform-origin:0 50%` : `left:calc(${a.x}% - 3px);top:${a.y}%;width:6px;height:${z.y - a.y}%;transform-origin:50% 0`; return `<div class="ln_${id}_${i} m-pill" style="position:absolute;${L};border-radius:3px;opacity:0"></div>`; }).join("");
    const html = WRAP(`${lines}${nodeHtml}`, "background:transparent;box-shadow:none;border:none;backdrop-filter:none");
    let js = "";
    const apps = byType(actions, "appear")[0];
    const t0 = apps ? c.sec(apps.startFrame) : 0;
    nodes.forEach((_, i) => { js += `tl.fromTo('.nd_${id}_${i}',{opacity:0,y:40,scale:.6},{opacity:1,y:0,scale:1,duration:${c.profile.motion.enterDur * .7},ease:'${c.profile.motion.enterEase}'},${t0 + i * c.profile.motion.stagger * 2});`; });
    byType(actions, "connect").forEach(k => {
      const [a] = (k.text ?? "0>1").split(">").map(Number); const t = c.sec(k.startFrame), d = Math.max(.25, c.sec(k.endFrame) - t);
      js += `tl.fromTo('.ln_${id}_${a}',{opacity:1,${horiz ? "scaleX" : "scaleY"}:0},{opacity:1,${horiz ? "scaleX" : "scaleY"}:1,duration:${d},ease:'power2.out'},${t});`;
    });
    byType(actions, "click").forEach(k => { const i = Number(k.text ?? 0); js += `tl.fromTo('.nd_${id}_${i}',{scale:1},{scale:${c.profile.motion.press},duration:.1,yoyo:true,repeat:1},${c.sec(k.startFrame)});`; });
    // lines default visible after both nodes appear if never connected explicitly
    if (!byType(actions, "connect").length) nodes.slice(1).forEach((_, i) => { js += `tl.fromTo('.ln_${id}_${i}',{opacity:1,${horiz ? "scaleX" : "scaleY"}:0},{opacity:1,${horiz ? "scaleX" : "scaleY"}:1,duration:.35,ease:'power2.out'},${t0 + (i + 1) * c.profile.motion.stagger * 2 + .3});`; });
    return { html, js };
  },
};
