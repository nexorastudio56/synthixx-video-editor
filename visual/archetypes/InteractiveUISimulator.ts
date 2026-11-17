/**
 * InteractiveUISimulator - realistic glass browser / terminal / chat window. Text types character-by-character,
 * the progress bar fills in Signal Red, and task badges flip to green check / red cross as the bar passes each threshold.
 */
import type { Component } from "../types.js";
import { byType, esc, jsStr } from "../types.js";
import { BRAND } from "../materials/brandTheme.js";
import { U } from "../interfaces/shared.js";

const R = { toString: () => BRAND.signalRed }; // live (theme-driven) accent: resolved at render time
export const uiSim: Component = {
  kind: ["ui_sim"],
  render(e, actions, c) {
    const id = e.id, v = String(e.props.variant ?? "terminal"), dark = c.profile.dark;
    const tasks = (Array.isArray(e.props.tasks) ? e.props.tasks as string[] : []).slice(0, 4); const failIdx = e.props.failIndex !== undefined ? Number(e.props.failIndex) : -1;
    const types = byType(actions, "type"), counts = byType(actions, "count"), clicks = byType(actions, "click");
    const title = esc(String(e.props.title ?? (v === "browser" ? "agent browser" : v === "chat" ? "agent chat" : "terminal")));
    const line = (i: number, pre: string) => `<div class="ln_${id}_${i}" style="opacity:0;font-size:${U(2.9)};line-height:1.5;font-weight:700;white-space:nowrap;color:var(--ink)">${pre}<span class="tx_${id}_${i}"></span></div>`;
    let body = "";
    if (v === "browser") body = `<div class="m-inset" style="height:${U(5)};border-radius:999px;display:flex;align-items:center;padding:0 ${U(2.2)};margin-bottom:${U(2)}"><span style="color:var(--hot);font-size:${U(2.6)};margin-right:${U(1.2)}">●</span><span class="tx_${id}_0" style="font-size:${U(2.6)};font-weight:700;color:var(--ink)"></span></div>
<div class="m-inset" style="height:${U(9)};border-radius:${U(2)};margin-bottom:${U(1.6)}"></div><div style="display:flex;gap:${U(1.6)}"><div class="m-inset" style="flex:2;height:${U(4)};border-radius:${U(1.4)}"></div><div class="m-inset" style="flex:1;height:${U(4)};border-radius:${U(1.4)}"></div></div>`;
    else if (v === "chat") body = `<div class="ln_${id}_0" style="opacity:0;flex:none;align-self:flex-end;max-width:94%;background:var(--hot);color:#fff;border-radius:${U(2.4)} ${U(2.4)} ${U(.6)} ${U(2.4)};padding:${U(.6)} ${U(1.8)};font-size:${U(2.15)};line-height:1.2;font-weight:700;margin-bottom:${U(.7)}"><span class="tx_${id}_0"></span></div>
<div class="ln_${id}_1" style="opacity:0;flex:none;align-self:flex-start;max-width:94%" ><div class="m-chip" style="border-radius:${U(2.4)} ${U(2.4)} ${U(2.4)} ${U(.6)};padding:${U(.6)} ${U(1.8)};font-size:${U(2.15)};line-height:1.2;font-weight:700;color:var(--ink)"><span class="tx_${id}_1"></span></div></div>`;
    else body = [0, 1, 2].map(i => line(i, `<span style="color:var(--hot)">$&nbsp;</span>`)).join("") + `<div class="cur_${id}" style="display:inline-block;width:${U(1.5)};height:${U(3)};background:var(--hot);margin-top:${U(.4)}"></div>`;
    const badges = tasks.map((t, i) => `<div style="display:flex;align-items:center;gap:${U(1)};font-size:${U(2)};font-weight:800;color:var(--ink);flex:1;min-width:0;white-space:normal;overflow-wrap:anywhere;line-height:1.15;overflow:visible"><span class="bg_${id}_${i}" style="flex:none;width:${U(3.2)};height:${U(3.2)};border-radius:50%;border:${U(.35)} solid var(--ink2);display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:${U(2.2)}"><b class="ck_${id}_${i}" style="opacity:0;font-weight:800">${i === failIdx ? "✕" : "✓"}</b></span>${esc(t.slice(0, 15))}</div>`).join("");
    const html = `<div class="m-surf" style="position:absolute;inset:0;--u:min(2.3cqw,3.6cqh);display:flex;flex-direction:column">
<div style="height:${U(5.2)};display:flex;align-items:center;gap:${U(1.5)};padding:0 ${U(3)};flex:none"><i style="width:${U(1.9)};height:${U(1.9)};border-radius:50%;background:var(--hot)"></i><i style="width:${U(1.9)};height:${U(1.9)};border-radius:50%;background:var(--ink2)"></i><i style="width:${U(1.9)};height:${U(1.9)};border-radius:50%;background:var(--ink2)"></i><span style="margin-left:${U(1.5)};font-size:${U(2.3)};letter-spacing:.12em;text-transform:uppercase;color:var(--ink2);font-weight:800">${title}</span></div>
<div style="flex:1;padding:${U(.8)} ${U(3)};display:flex;flex-direction:column;overflow:hidden;min-height:0">${body}</div>
<div style="flex:none;padding:${U(.8)} ${U(3)} ${U(1.8)}"><div style="display:flex;justify-content:space-between;font-size:${U(2)};letter-spacing:.12em;font-weight:800;color:var(--ink2);margin-bottom:${U(.6)}"><span>PROGRESS</span><span class="pc_${id}" style="color:var(--hot)">0%</span></div>
<div class="m-inset" style="height:${U(2.1)};overflow:hidden"><div class="pb_${id} m-pill" style="height:100%;width:100%;border-radius:999px;transform-origin:0 50%"></div></div>
${tasks.length ? `<div style="display:flex;flex-wrap:nowrap;gap:${U(1.6)};margin-top:${U(1.2)}">${badges}</div>` : ""}</div></div>
<div class="rp_${id}" style="position:absolute;left:78%;top:70%;width:${U(8)};height:${U(8)};margin:${U(-4)} 0 0 ${U(-4)};border-radius:50%;border:3px solid ${R};background:${BRAND.glowRed};opacity:0"></div>`;
    let js = `BLINK('.cur_${id}',${c.sec(c.graph.durationFrames) + 5});tl.set('.pb_${id}',{scaleX:0},0);`;
    types.forEach((t, i) => { js += `tl.set('.ln_${id}_${i}',{opacity:1},${c.sec(t.startFrame).toFixed(3)});TY('.tx_${id}_${i}',${jsStr(t.text ?? "")},${c.sec(t.startFrame).toFixed(3)},${c.sec(t.endFrame).toFixed(3)});`; });
    if (v === "browser" && types[0]) js += `tl.set('.tx_${id}_0',{opacity:1},0);`;
    counts.forEach(k => { const t0 = c.sec(k.startFrame), t1 = c.sec(k.endFrame), val = Math.min(100, Math.max(1, k.value ?? 100));
      js += `tl.fromTo('.pb_${id}',{scaleX:0},{scaleX:${(val / 100).toFixed(3)},duration:${(t1 - t0).toFixed(3)},ease:'power1.inOut'},${t0.toFixed(3)});CNT('.pc_${id}',0,${val},${t0.toFixed(3)},${t1.toFixed(3)},v=>Math.round(v)+'%');`;
      tasks.forEach((_, i) => { const tf = t0 + (t1 - t0) * ((i + 1) / tasks.length) * .95, bad = i === failIdx, col = bad ? R : BRAND.okGreen;
        js += `tl.to('.bg_${id}_${i}',{scaleX:0,duration:.12,ease:'power2.in'},${tf.toFixed(3)});tl.set('.bg_${id}_${i}',{backgroundColor:'${col}',borderColor:'${col}'},${(tf + .12).toFixed(3)});tl.set('.ck_${id}_${i}',{opacity:1},${(tf + .12).toFixed(3)});tl.to('.bg_${id}_${i}',{scaleX:1,duration:.22,ease:SNAP},${(tf + .12).toFixed(3)});`; });
    });
    clicks.forEach(k => { js += `tl.fromTo('.rp_${id}',{scale:.3,opacity:.9},{scale:1.7,opacity:0,duration:.5,ease:'power2.out'},${c.sec(k.startFrame).toFixed(3)});`; });
    return { html, js };
  },
};
