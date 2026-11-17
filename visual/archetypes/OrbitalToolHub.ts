/**
 * OrbitalToolHub - chaos-to-order. 6-10 tool chips orbit a Signal Red core on two concentric rings (hero chip red, the rest black / white-on-dark).
 * `merge` action: chips spiral inward magnetically, collapse into the core, which expands into one unified dashboard.
 * Every position is a pure function of GLOBAL time (scene start + local) inside one seek-safe onUpdate.
 */
import type { Component } from "../types.js";
import { byType, esc } from "../types.js";
import { BRAND } from "../materials/brandTheme.js";
import { U } from "../interfaces/shared.js";

const R = { toString: () => BRAND.signalRed }; // live (theme-driven) accent: resolved at render time
export const orbitalHub: Component = {
  kind: ["orbital_hub"],
  render(e, actions, c) {
    const id = e.id, dark = c.profile.dark, b = c.box(e);
    const items = (Array.isArray(e.props.items) ? e.props.items as string[] : ["Gmail", "Slack", "Sheets", "Notion", "GitHub", "Calendar"]).slice(0, 10);
    const logoIds = Array.isArray(e.props.logoIds) ? e.props.logoIds as string[] : [];
    const n = Math.max(6, items.length); while (items.length < n) items.push(["Docs", "Drive", "CRM", "Mail"][items.length % 4]);
    const Rm = Math.min(b.w, b.h) / 2, chip = Rm * .34, inner = Math.min(4, Math.round(n * .4)), rIn = Rm * .45, rOut = Rm * .76;
    const chips = items.map((name, i) => {
      const hero = i === 0, src = logoIds[i] ? c.assetPath(logoIds[i]) : undefined;
      const bg = hero ? R : dark ? BRAND.pureWhite : BRAND.carbonBlack, fg = hero ? BRAND.pureWhite : dark ? BRAND.carbonBlack : BRAND.pureWhite;
      const inv = hero || !dark ? "filter:invert(1);" : "";
      const inner_ = src ? `<img src="${src}" style="width:58%;height:58%;object-fit:contain;${inv}">` : `<span style="font-size:${chip * .46}px;color:${fg};font-weight:800">${esc(name[0].toUpperCase())}</span>`;
      return `<div class="ch_${id}_${i}" style="position:absolute;left:${b.w / 2 - chip / 2}px;top:${b.h / 2 - chip / 2}px;width:${chip}px;height:${chip}px;border-radius:${chip * .28}px;background:${bg};display:flex;align-items:center;justify-content:center;box-shadow:0 14px 28px rgba(9,9,11,${dark ? .6 : .25})${hero ? `,0 0 30px ${BRAND.glowRed}` : ""};border:1px solid ${hero ? R : "${BRAND.accA(.45)}"}">${inner_}</div>`;
    }).join("");
    const rows = items.slice(0, c.portrait ? 3 : 4).map((nm, i) => `<div style="display:flex;align-items:center;justify-content:space-between;padding:${U(.8)} ${U(2)};border-radius:${U(1.6)};margin-bottom:${U(.8)}" class="m-inset"><span style="font-size:${U(2.5)};font-weight:800;color:var(--ink)">${esc(nm)}</span><span class="m-pill" style="font-size:${U(1.9)};font-weight:800;color:#fff;padding:${U(.5)} ${U(1.6)};border-radius:999px;letter-spacing:.04em">SYNCED</span></div>`).join("");
    const html = `<div style="position:absolute;inset:0;--u:min(2.4cqw,4cqh)">
<svg class="rg_${id}" style="position:absolute;inset:0;width:100%;height:100%" viewBox="0 0 ${b.w} ${b.h}"><circle cx="${b.w / 2}" cy="${b.h / 2}" r="${rIn}" fill="none" stroke="${BRAND.accA(.35)}" stroke-width="1.5" stroke-dasharray="6 10"/><circle cx="${b.w / 2}" cy="${b.h / 2}" r="${rOut}" fill="none" stroke="${BRAND.accA(.22)}" stroke-width="1.5" stroke-dasharray="6 10"/></svg>
<div class="core_${id}" style="position:absolute;left:${b.w / 2 - Rm * .16}px;top:${b.h / 2 - Rm * .16}px;width:${Rm * .32}px;height:${Rm * .32}px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#FF4A4A,${R});box-shadow:0 0 ${Rm * .35}px ${BRAND.glowRed},0 0 ${Rm * .12}px ${R}"></div>
${chips}
<div class="hd_${id} m-surf" style="position:absolute;left:4%;right:4%;top:4%;bottom:4%;opacity:0;padding:${U(2.5)};--r:${U(3)}"><div style="font-size:${U(2.3)};letter-spacing:.12em;font-weight:800;color:var(--hot);margin-bottom:${U(1.6)}">UNIFIED WORKSPACE</div>${rows}</div></div>`;
    const mg = byType(actions, "merge")[0]; const t0 = mg ? c.sec(mg.startFrame) : 9999, t1 = mg ? c.sec(mg.endFrame) : 9999;
    const S = c.sceneStartFrame / c.fps, dur = c.sec(c.graph.scenes.find(s => s.startFrame === c.sceneStartFrame)!.endFrame);
    const js = `{const N=${n},INN=${inner},B=${JSON.stringify([b.w, b.h, rIn, rOut, chip])},T0=${t0},T1=${t1},S=${S},st={t:0};
const ch=Array.from({length:N},(_,i)=>document.querySelector('.ch_${id}_'+i)),core=document.querySelector('.core_${id}'),hd=document.querySelector('.hd_${id}'),rg=document.querySelector('.rg_${id}');
const cl=(x,a,b)=>Math.min(b,Math.max(a,x)),eo=x=>1-Math.pow(1-x,4),ei=x=>x*x*x;
const F=t=>{const g=S+t,p=T0<9000?ei(cl((t-T0)/(T1-T0),0,1)):0,q=T0<9000?eo(cl((t-T1)/.75,0,1)):0;
ch.forEach((el,i)=>{const ring=i<INN?0:1,cnt=ring?N-INN:INN,k=ring?i-INN:i,dir=ring?-1:1,per=ring?24:15,r0=ring?B[3]:B[2];
const a=6.2831853*k/cnt+dir*6.2831853*g/per+ring*.7+(i===0?0:.35*i)+12.5*p*p*dir;const r=r0*(1-p);
const sc=(1-.62*p)*(1-q),op=1-cl((p-.82)/.18,0,1);
el.style.transform='translate('+(r*Math.cos(a)).toFixed(1)+'px,'+(r*Math.sin(a)*.92).toFixed(1)+'px) scale('+Math.max(0.01,sc).toFixed(3)+')';el.style.opacity=op.toFixed(3);el.style.zIndex=String(2+Math.round(r*Math.sin(a)*.92>0?1:0))});
core.style.transform='scale('+(1+.5*Math.sin(Math.PI*p)+.9*q*(1-q)*4).toFixed(3)+')';core.style.opacity=(1-cl((q-.25)/.4,0,1)).toFixed(3);
rg.style.opacity=(1-p).toFixed(3);hd.style.opacity=q.toFixed(3);hd.style.transform='scale('+(.15+.85*q).toFixed(3)+')'};
F(0);tl.to(st,{t:${dur.toFixed(3)},duration:${dur.toFixed(3)},ease:'none',onUpdate:()=>F(st.t)},0)}`;
    return { html, js };
  },
};
