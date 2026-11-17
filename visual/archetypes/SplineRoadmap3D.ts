/**
 * SplineRoadmap3D - glossy Signal Red ribbon receding in perspective. Each `step` action draws the ribbon forward and pops a numbered badge
 * + card with spring physics (stiffness 150, damping 15). Perspective is computed analytically (CSS-perspective maths) so badges stay upright.
 */
import type { Component } from "../types.js";
import { byType, esc } from "../types.js";
import { BRAND } from "../materials/brandTheme.js";
import { U } from "../interfaces/shared.js";

const R = { toString: () => BRAND.signalRed }; // live (theme-driven) accent: resolved at render time
export const roadmap: Component = {
  kind: ["roadmap"],
  render(e, actions, c) {
    const id = e.id, dark = c.profile.dark, b = c.box(e), W = b.w, H = b.h;
    const steps = byType(actions, "step"); const titles = (Array.isArray(e.props.titles) ? e.props.titles as string[] : []).slice(0, 6);
    const n = Math.max(3, steps.length, titles.length);
    // flat curve (unit space) -> perspective projection about the bottom-centre, rotateX(34deg), d=900
    const th = 34 * Math.PI / 180, d = 900, ox = W / 2, oy = H;
    const proj = (x: number, y: number) => { const Y = y - oy, zz = Y * Math.sin(th), s = 1 / (1 - zz / d); return { x: ox + (x - ox) * s, y: oy + Y * Math.cos(th) * s, s }; };
    const flat = (u: number) => ({ x: W * (.5 + .34 * Math.sin(2 * Math.PI * (u * 1.15) + .35)), y: H * (1.55 - 1.5 * u) });
    const pts = Array.from({ length: 121 }, (_, k) => { const u = k / 120, f = flat(u), f2 = flat(Math.min(1, u + .004)), f1 = flat(Math.max(0, u - .004)); const tx = f2.x - f1.x, ty = f2.y - f1.y, L = Math.hypot(tx, ty) || 1, nx = -ty / L, ny = tx / L, hw = W * .045 * (1 - .5 * u);
      return { l: proj(f.x + nx * hw, f.y + ny * hw), r: proj(f.x - nx * hw, f.y - ny * hw), c: proj(f.x, f.y), u }; });
    const vis = pts.filter(p => p.c.y > -H * .02 && p.c.y < H * 1.0); // clip to box
    const poly = `M${vis.map(p => `${p.l.x.toFixed(1)},${p.l.y.toFixed(1)}`).join(" L")} L${[...vis].reverse().map(p => `${p.r.x.toFixed(1)},${p.r.y.toFixed(1)}`).join(" L")} Z`;
    const mask = `M${vis.map(p => `${p.c.x.toFixed(1)},${p.c.y.toFixed(1)}`).join(" L")}`;
    const at = (u: number) => { const q = vis.reduce((a, p) => (Math.abs(p.u - u) < Math.abs(a.u - u) ? p : a), vis[0]); return q; };
    const uRange = [vis[0].u, vis[vis.length - 1].u]; const uk = (k: number) => uRange[0] + (uRange[1] - uRange[0]) * ((k + .5) / n);
    const bs = Math.min(W, H) * .11;
    const marks = Array.from({ length: n }, (_, k) => { const p = at(uk(k)); const side = k % 2 === 0 ? -1 : 1; const cw = Math.min(W * .46, 520), chh = Math.min(H * .26, cw * .36), sc = p.c.s;
      const cx = Math.min(W - cw - 4, Math.max(4, p.c.x + side * (W * .075 + cw / 2) - cw / 2)), cy = p.c.y - chh / 2;
      return { k, bx: p.c.x - bs * sc / 2, by: p.c.y - bs * sc / 2, bsz: bs * sc, cx, cy, cw: cw * (.8 + .2 * sc), chh: chh * (.8 + .2 * sc) }; });
    const badge = marks.map(m => `<div class="bd_${id}_${m.k}" style="position:absolute;left:${m.bx}px;top:${m.by}px;width:${m.bsz}px;height:${m.bsz}px;border-radius:50%;background:${dark ? BRAND.pureWhite : BRAND.carbonBlack};color:${dark ? BRAND.carbonBlack : BRAND.pureWhite};display:flex;align-items:center;justify-content:center;font-size:${m.bsz * .5}px;font-weight:800;opacity:0;box-shadow:0 10px 22px rgba(9,9,11,.35);z-index:6">${m.k + 1}</div>`).join("");
    const cards = marks.map(m => { const t = String(steps[m.k]?.text ?? titles[m.k] ?? `Step ${m.k + 1}`); return `<div class="rc_${id}_${m.k} m-surf" style="position:absolute;left:${m.cx}px;top:${m.cy}px;width:${m.cw}px;height:${m.chh}px;--u:${m.cw / 36}px;--r:${m.chh * .22}px;padding:${m.chh * .16}px ${m.cw * .06}px;opacity:0;z-index:7;display:flex;flex-direction:column;justify-content:center"><div style="font-size:${Math.max(24, m.chh * .2)}px;letter-spacing:.14em;color:var(--hot);font-weight:800">STEP ${m.k + 1}</div><div style="font-size:${Math.max(30, m.chh * .3)}px;line-height:1.08;letter-spacing:-.02em;color:var(--ink);font-weight:800;margin-top:${m.chh * .05}px">${esc(t.slice(0, 34))}</div></div>`; }).join("");
    const html = `<div class="fw_${id}" style="position:absolute;inset:0"><svg style="position:absolute;inset:0;width:100%;height:100%;overflow:visible" viewBox="0 0 ${W} ${H}"><defs>
<linearGradient id="rg_${id}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${BRAND.hi}"/><stop offset="1" stop-color="${R}"/></linearGradient>
<mask id="mk_${id}" maskUnits="userSpaceOnUse" x="-50" y="-50" width="${W + 100}" height="${H + 100}"><path class="mp_${id}" d="${mask}" pathLength="1" stroke="#fff" stroke-width="${W * .16}" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="1" stroke-dashoffset="1"/></mask></defs>
<path d="${poly}" fill="rgba(0,0,0,.22)" transform="translate(0 ${H * .02})" mask="url(#mk_${id})" style="filter:blur(6px)"/>
<path d="${poly}" fill="url(#rg_${id})" mask="url(#mk_${id})" style="filter:drop-shadow(0 0 18px ${BRAND.glowRed})"/></svg>${badge}${cards}</div>`;
    let js = `tl.set('.mp_${id}',{strokeDashoffset:${steps.length ? 1 : 0}},0);`; let prev = -1; const ord = [...steps].sort((a, b2) => a.startFrame - b2.startFrame);
    ord.forEach((s, i) => {
      const k = Math.min(n - 1, Math.max(0, Math.round(s.value ?? i + 1) - 1)), t = c.sec(s.startFrame), dd = Math.max(.5, c.sec(s.endFrame) - t); const m = marks[k];
      js += `tl.to('.mp_${id}',{strokeDashoffset:${(1 - Math.min(1, (uk(k) - uRange[0] + .04) / (uRange[1] - uRange[0]))).toFixed(4)},duration:${dd.toFixed(3)},ease:'power2.inOut'},${t.toFixed(3)});`;
      js += `tl.fromTo('.bd_${id}_${k}',{opacity:0,scale:.2,y:26},{opacity:1,scale:1,y:0,duration:1.1,ease:SPR},${(t + dd * .45).toFixed(3)});tl.fromTo('.rc_${id}_${k}',{opacity:0,scale:.6,y:30},{opacity:1,scale:1,y:0,duration:1.1,ease:SPR},${(t + dd * .55).toFixed(3)});`;
      js += `tl.to('.bd_${id}_${k}',{backgroundColor:'${R}',color:'#fff',duration:.2},${(t + dd * .45).toFixed(3)});`;
      if (prev >= 0) js += `tl.to('.bd_${id}_${prev}',{backgroundColor:'${dark ? BRAND.pureWhite : BRAND.carbonBlack}',color:'${dark ? BRAND.carbonBlack : BRAND.pureWhite}',duration:.25},${(t + dd * .45).toFixed(3)});`;
      prev = k; void m;
    });
    const dur = c.sec(c.graph.scenes.find(s => s.startFrame === c.sceneStartFrame)!.endFrame);
    js += `tl.fromTo('.fw_${id}',{y:0,scale:1},{y:${(H * .035).toFixed(1)},scale:1.035,duration:${dur.toFixed(3)},ease:'none'},0);`; // forward motion through the scene
    return { html, js };
  },
};
