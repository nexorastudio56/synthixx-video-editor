import type { Component } from "../types.js";
import { byType, esc, jsStr } from "../types.js";
import { WRAP, DOTS, U } from "./shared.js";
export const chat: Component = {
  kind: ["chat"],
  render(e, actions, c) {
    const id = e.id, types = byType(actions, "type");
    const msgs = types.map((t, i) => {
      const user = (t.text ?? "").startsWith(">");
      const txt = (t.text ?? "").replace(/^>\s*/, "");
      const side = user ? `right:${U(3)};border-radius:${U(3)} ${U(3)} ${U(.8)} ${U(3)};background:linear-gradient(135deg,var(--acc2),var(--acc))` : `left:${U(3)};border-radius:${U(3)} ${U(3)} ${U(3)} ${U(.8)}`;
      return `<div class="b_${id}_${i} ${user ? "" : "m-chip"}" style="position:absolute;${side};top:${U(10 + i * 9.5)};max-width:78%;padding:${U(1.8)} ${U(2.6)};font-size:${U(3.1)};font-weight:700;color:${user ? "#fff" : "var(--ink)"};opacity:0;white-space:nowrap"><span class="t_${id}_${i}"></span></div>`;
    }).join("");
    const html = WRAP(`${DOTS}<div style="position:absolute;left:${U(14)};top:${U(1.8)};font-size:${U(2.6)};font-weight:700;letter-spacing:${U(.4)};text-transform:uppercase;color:var(--ink2)">${esc(String(e.props.title ?? "AI chat"))}</div>${msgs}`);
    let js = "";
    types.forEach((t, i) => { const t0 = c.sec(t.startFrame), t1 = c.sec(t.endFrame); js += `tl.fromTo('.b_${id}_${i}',{opacity:0,y:20,scale:.9},{opacity:1,y:0,scale:1,duration:.3,ease:'back.out(1.6)'},${t0});TY('.t_${id}_${i}',${jsStr((t.text ?? "").replace(/^>\s*/, ""))},${t0 + 0.2},${Math.max(t1, t0 + 0.5)});`; });
    return { html, js };
  },
};
