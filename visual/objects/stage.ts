import type { Component } from "../types.js";
import { byType, esc, mulberry32 } from "../types.js";
import { WRAP, U } from "../interfaces/shared.js";
const img = (src: string, extra = "") => `<img src="${src}" style="width:100%;height:100%;object-fit:contain;${extra}">`;
export const logo: Component = {
  kind: ["logo"],
  render(e, _a, c) {
    const src = c.assetPath(e.assetId)!; const invert = c.profile.dark ? "filter:invert(1) drop-shadow(0 0 14px var(--acc));" : "";
    return { html: `<div class="m-chip" style="position:absolute;inset:0;--u:min(2.4cqw,4cqh);border-radius:${U(8)};display:flex;align-items:center;gap:${U(3)};padding:${U(2.5)} ${U(4)}"><div style="height:80%;aspect-ratio:1">${img(src, invert)}</div>${e.label ? `<div class="m-glow" style="font-size:${U(8)};font-weight:800;letter-spacing:-.02em">${esc(e.label)}</div>` : ""}</div>`, js: "" };
  },
};
export const cutout: Component = {
  kind: ["cutout"],
  render(e, _a, c) { return { html: `<div style="position:absolute;inset:0;filter:drop-shadow(0 30px 40px rgba(0,0,0,.45))">${img(c.assetPath(e.assetId)!)}</div>`, js: "" }; },
};
export const icon: Component = {
  kind: ["icon"],
  render(e, actions, c) {
    const glyph = String(e.props.glyph ?? "✦");
    const html = `<div class="m-chip ic_${e.id}" style="position:absolute;inset:0;--u:min(2.4cqw,4cqh);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:${U(34)}">${e.assetId ? img(c.assetPath(e.assetId)!, "width:60%;height:60%;" + (c.profile.dark ? "filter:invert(1);" : "")) : esc(glyph)}</div><div class="rip_${e.id}" style="position:absolute;inset:0;border-radius:50%;border:3px solid var(--acc);opacity:0"></div>`;
    let js = ""; byType(actions, "click").forEach(k => { const t = c.sec(k.startFrame); js += `tl.fromTo('.ic_${e.id}',{scale:1},{scale:${c.profile.motion.press},duration:.1,yoyo:true,repeat:1},${t});tl.fromTo('.rip_${e.id}',{opacity:.9,scale:1},{opacity:0,scale:1.7,duration:.5,ease:'power2.out'},${t});`; });
    return { html, js };
  },
};
export const device: Component = {
  kind: ["device"],
  render(e, actions, c) {
    const id = e.id, types = byType(actions, "type");
    const html = `<div class="m-surf" style="position:absolute;inset:0;--u:min(2cqw,2.6cqh);border-radius:${U(7)};border:${U(.8)} solid var(--ink2)"><div class="m-inset" style="position:absolute;left:${U(2)};right:${U(2)};top:${U(2)};bottom:${U(2)};border-radius:${U(5)};overflow:hidden"><div class="m-ink" style="position:absolute;left:${U(5)};right:${U(5)};top:${U(8)};font-size:${U(6)};font-weight:800"><span class="tx_${id}"></span></div></div></div>`;
    let js = ""; types.forEach(t => { js += `TY('.tx_${id}',${JSON.stringify(t.text ?? "")},${c.sec(t.startFrame)},${c.sec(t.endFrame)});`; });
    return { html, js };
  },
};
export const card: Component = {
  kind: ["card", "text"],
  render(e, actions, c) {
    const id = e.id; const val = String(e.props.value ?? ""); const isText = e.kind === "text";
    const html = isText
      ? `<div class="m-glow m-ink" style="position:absolute;inset:0;--u:min(2.4cqw,4cqh);display:flex;align-items:center;justify-content:center;text-align:center;font-size:${U(isText ? 12 : 8)};font-weight:800;letter-spacing:-.03em;line-height:1.05"><span class="tt_${id}">${esc(e.label ?? "")}</span></div>`
      : WRAP(`<div style="position:absolute;left:${U(4)};top:${U(3)};font-size:${U(3)};letter-spacing:${U(.5)};font-weight:700;text-transform:uppercase;color:var(--ink2)">${esc(e.label ?? "")}</div><div class="m-glow" style="position:absolute;left:${U(4)};top:${U(9)};font-size:${U(18)};font-weight:800;letter-spacing:-.04em;line-height:1"><span class="cv_${id}">${esc(val)}</span><span style="font-size:${U(9)}">${esc(String(e.props.suffix ?? ""))}</span></div>`);
    let js = ""; byType(actions, "count").forEach(k => { js += `CNT('.cv_${id}',0,${k.value ?? 0},${c.sec(k.startFrame)},${c.sec(k.endFrame)});`; });
    return { html, js };
  },
};
export const particles: Component = {
  kind: ["particles"],
  render(e, _a, c) {
    const rnd = mulberry32(e.seed ?? 1), N = Number(e.props.count ?? 28); const T = c.sec(c.graph.durationFrames);
    const dots = Array.from({ length: N }, (_, i) => `<i class="pt_${e.id}" data-a="${rnd().toFixed(4)}" data-b="${rnd().toFixed(4)}" data-s="${(0.2 + rnd() * 0.6).toFixed(3)}" data-p="${(rnd() * 6.283).toFixed(3)}" style="position:absolute;left:${(rnd() * 100).toFixed(2)}%;top:${(rnd() * 100).toFixed(2)}%;width:${(3 + rnd() * 7).toFixed(1)}px;height:${(3 + rnd() * 7).toFixed(1)}px;border-radius:50%;background:var(--acc);opacity:${(0.25 + rnd() * 0.5).toFixed(2)};box-shadow:0 0 12px var(--acc)"></i>`).join("");
    // positions are a pure function of timeline time -> chunk-safe
    const js = `{const els=[...document.querySelectorAll('.pt_${e.id}')],o={v:0};tl.fromTo(o,{v:0},{v:${T},duration:${T},ease:'none',onUpdate:()=>{els.forEach(el=>{const s=+el.dataset.s,p=+el.dataset.p;el.style.transform='translate('+Math.sin(o.v*s+p)*30+'px,'+Math.cos(o.v*s*.8+p)*40+'px)'})}},0)}`;
    return { html: `<div style="position:absolute;inset:0">${dots}</div>`, js };
  },
};
