/**
 * CardDeckFan3D - 3-5 glass cards stacked in 3D Z-space (perspective 1200px, rotateY -15deg). `fan` spreads them in an arc and
 * highlights the active card with a Signal Red border glow; `click` glides a cursor to it and fires a red ripple.
 */
import type { Component } from "../types.js";
import { byType, esc } from "../types.js";
import { BRAND } from "../materials/brandTheme.js";
import { U } from "../interfaces/shared.js";

const R = { toString: () => BRAND.signalRed }; // live (theme-driven) accent: resolved at render time
export const cardDeck: Component = {
  kind: ["card_deck"],
  render(e, actions, c) {
    const id = e.id, dark = c.profile.dark, b = c.box(e);
    const titles = (Array.isArray(e.props.titles) ? e.props.titles as string[] : ["Overview", "Insights", "Actions"]).slice(0, 5); const n = Math.max(3, titles.length);
    while (titles.length < n) titles.push("Next");
    const cw = Math.min(b.w * .46, b.h * .95), ch = Math.min(b.h * .92, cw * 1.02), mid = (n - 1) / 2;
    const fan = byType(actions, "fan")[0], clk = byType(actions, "click")[0];
    const active = Math.min(n - 1, Math.max(0, Number(fan?.value ?? clk?.value ?? n - 1)));
    const spacing = Math.min(cw * .62, (b.w - cw) / Math.max(1, n - 1));
    const stackPose = (i: number) => ({ x: (i - mid) * 14, y: (mid - i) * 7, z: (i - (n - 1)) * 60, rotationY: -15, scale: 1 });
    const fanPose = (i: number) => ({ x: (i - mid) * spacing, y: i === active ? -b.h * .03 : 0, z: i === active ? 80 : -Math.abs(i - active) * 45, rotationY: i === active ? -4 : -15 + (i - mid) * 8, scale: i === active ? 1.06 : .96 });
    const card = (t: string, i: number) => `<div class="dk_${id}_${i} m-surf" style="position:absolute;left:${(b.w - cw) / 2}px;top:${(b.h - ch) / 2}px;width:${cw}px;height:${ch}px;--u:${cw / 40}px;--r:${cw * .07}px;padding:${cw * .07}px;z-index:${i + 1}">
<div style="font-size:${cw * .05}px;letter-spacing:.14em;font-weight:800;color:var(--hot)">0${i + 1}</div>
<div style="font-size:${cw * .1}px;line-height:1.05;letter-spacing:-.03em;font-weight:800;color:var(--ink);margin:${cw * .03}px 0 ${cw * .06}px">${esc(t)}</div>
<div class="m-inset" style="height:${cw * .055}px;margin-bottom:${cw * .035}px;width:92%"></div><div class="m-inset" style="height:${cw * .055}px;margin-bottom:${cw * .035}px;width:74%"></div><div class="m-inset" style="height:${cw * .055}px;margin-bottom:${cw * .07}px;width:58%"></div>
<div class="m-inset" style="height:${cw * .05}px;width:100%"><div class="m-pill" style="height:100%;width:${50 + ((i * 17) % 40)}%;border-radius:999px"></div></div></div>`;
    const html = `<div data-layout-allow-overlap style="position:absolute;inset:0">${titles.map(card).join("")}
<svg class="cu_${id}" viewBox="0 0 24 24" style="position:absolute;left:0;top:0;width:${cw * .12}px;height:${cw * .12}px;opacity:0;z-index:30;filter:drop-shadow(0 4px 8px rgba(0,0,0,.4))"><path d="M4 2 L4 19 L8.6 14.6 L12 22 L14.8 20.8 L11.4 13.6 L18 13.6 Z" fill="${dark ? "#fff" : BRAND.carbonBlack}" stroke="${dark ? BRAND.carbonBlack : "#fff"}" stroke-width="1.2" stroke-linejoin="round"/></svg>
<div class="rp_${id}" style="position:absolute;left:0;top:0;width:${cw * .16}px;height:${cw * .16}px;border-radius:50%;border:3px solid ${R};background:${BRAND.glowRed};opacity:0;z-index:29"></div></div>`;
    let js = "";
    for (let i = 0; i < n; i++) js += `tl.set('.dk_${id}_${i}',{transformPerspective:1200,...${JSON.stringify(stackPose(i))}},0);`;
    if (fan) {
      const t = c.sec(fan.startFrame), d = Math.max(.5, c.sec(fan.endFrame) - t);
      for (let i = 0; i < n; i++) js += `tl.to('.dk_${id}_${i}',{...${JSON.stringify(fanPose(i))},duration:${d.toFixed(3)},ease:SPR},${(t + i * .05).toFixed(3)});`;
      js += `tl.to('.dk_${id}_${active}',{borderColor:'${R}',borderWidth:'3px',boxShadow:'0 0 50px ${BRAND.glowRed},0 0 0 1px ${R}',zIndex:20,duration:.35,ease:'power2.out'},${(t + d * .6).toFixed(3)});`;
    }
    if (clk) {
      const t = c.sec(clk.startFrame), ai = Math.min(n - 1, Math.max(0, Number(clk.value ?? active))); const p = fan ? fanPose(ai) : stackPose(ai);
      const tx = b.w / 2 + p.x + cw * .12, ty = b.h / 2 + p.y + ch * .22, sx = b.w * .96, sy = b.h * .98;
      js += `tl.fromTo('.cu_${id}',{x:${sx.toFixed(1)},y:${sy.toFixed(1)},opacity:0},{x:${tx.toFixed(1)},y:${ty.toFixed(1)},opacity:1,duration:.55,ease:'power3.inOut'},${Math.max(0, t - .55).toFixed(3)});`;
      js += `tl.fromTo('.cu_${id}',{scale:1},{scale:.82,duration:.08,yoyo:true,repeat:1},${t.toFixed(3)});`;
      js += `tl.fromTo('.rp_${id}',{x:${(tx - cw * .06).toFixed(1)},y:${(ty - cw * .06).toFixed(1)},scale:.3,opacity:.9},{scale:2.6,opacity:0,duration:.55,ease:'power2.out'},${t.toFixed(3)});`;
      js += `tl.fromTo('.dk_${id}_${ai}',{scale:${p.scale}},{scale:${(p.scale * .97).toFixed(3)},duration:.09,yoyo:true,repeat:1},${t.toFixed(3)});`;
    }
    return { html, js };
  },
};
