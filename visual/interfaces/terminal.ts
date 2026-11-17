import type { Component } from "../types.js";
import { byType, esc, jsStr } from "../types.js";
import { WRAP, DOTS, U } from "./shared.js";
const KW = /\b(import|from|def|return|for|in|if|else|class|await|async|print|run|search|write|scan)\b/g;
const tint = (s: string) => esc(s).replace(KW, '<span style="color:var(--hot)">$1</span>').replace(/(".*?"|'.*?')/g, '<span style="color:var(--ok)">$1</span>');
export const terminal: Component = {
  kind: ["terminal", "code_editor"],
  render(e, actions, c) {
    const id = e.id, isCode = e.kind === "code_editor";
    const types = byType(actions, "type"), counts = byType(actions, "count");
    const title = String(e.props.title ?? (isCode ? "agent.py" : "terminal"));
    const lineH = 4.6, cap = Math.max(3, Math.floor(70 / lineH));
    const lines = types.map((t, i) => `<div class="ln_${id}_${i}" style="height:${U(lineH)};line-height:${U(lineH)};font-size:${U(3.1)};font-weight:700;white-space:nowrap;opacity:0;color:var(--ink)">${isCode ? `<span style="color:var(--ink2);display:inline-block;width:${U(4)}">${i + 1}</span>` : `<span style="color:var(--ok)">$&nbsp;</span>`}<span class="tx_${id}_${i}"></span></div>`).join("");
    const cnt = counts.length ? `<div style="position:absolute;left:${U(3)};right:${U(3)};bottom:${U(2.2)};height:${U(7)}"><div style="font-size:${U(2.6)};letter-spacing:${U(.4)};font-weight:700;color:var(--ink2);text-transform:uppercase">${esc(String(e.props.countLabel ?? "scanned"))} <span class="cn_${id}" style="color:var(--acc)">0</span></div><div class="m-inset" style="position:absolute;left:0;right:0;bottom:0;height:${U(2.2)}"><div class="m-pill cb_${id}" style="position:absolute;left:3px;top:3px;bottom:3px;width:calc(100% - 6px);border-radius:${U(1.1)};transform-origin:0 50%"></div></div></div>` : "";
    const html = WRAP(`${DOTS}<div style="position:absolute;left:${U(14)};top:${U(1.8)};font-size:${U(2.6)};font-weight:700;letter-spacing:${U(.4)};text-transform:uppercase;color:var(--ink2)">${esc(title)}</div>
<div style="position:absolute;left:${U(3)};right:${U(3)};top:${U(9)};bottom:${counts.length ? U(11) : U(3)};overflow:hidden"><div class="body_${id}" style="position:absolute;left:0;top:0;right:0">${lines}<div class="cur_${id}" style="display:inline-block;width:${U(1.6)};height:${U(3.2)};background:var(--acc);margin-left:${U(3)};box-shadow:0 0 10px var(--acc)"></div></div></div>${cnt}`);
    let js = `BLINK('.cur_${id}',${c.sec(c.graph.durationFrames) + 5});`;
    types.forEach((t, i) => {
      const t0 = c.sec(t.startFrame), t1 = c.sec(t.endFrame);
      const txt = t.text ?? "";
      if (isCode) js += `document.querySelector('.tx_${id}_${i}').innerHTML='';`;
      js += `tl.set('.ln_${id}_${i}',{opacity:1},${t0});`;
      if (isCode) { // type plain, swap to tinted html when complete
        js += `TY('.tx_${id}_${i}',${jsStr(txt)},${t0},${t1});tl.add(()=>{const el=document.querySelector('.tx_${id}_${i}');if(tl.time()>=${t1}-0.001)el.innerHTML=${jsStr(tint(txt))}},${t1 + 0.001});`;
      } else js += `TY('.tx_${id}_${i}',${jsStr(txt)},${t0},${t1});`;
      if (i + 1 > cap) js += `{const lh=document.querySelector('.ln_${id}_0').offsetHeight;tl.to('.body_${id}',{y:-${i + 1 - cap}*lh,duration:.15},${t0});}`;
    });
    counts.forEach(k => { const t0 = c.sec(k.startFrame), t1 = c.sec(k.endFrame); js += `CNT('.cn_${id}',0,${k.value ?? 1000},${t0},${t1});tl.fromTo('.cb_${id}',{scaleX:0},{scaleX:1,duration:${(t1 - t0).toFixed(3)},ease:'none'},${t0});`; });
    return { html, js };
  },
};
