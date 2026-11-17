/**
 * KineticWordSync - 3-5 word hero title (exponential snap entry, cubic-bezier(0.16,1,0.3,1)) + word-level active captions.
 * The spoken word turns Signal Red and pops to 1.06x. Timings come straight from graph.voice.words (global seconds - scene start).
 */
import type { Component } from "../types.js";
import { byType, esc } from "../types.js";
import { BRAND } from "../materials/brandTheme.js";
import { U } from "../interfaces/shared.js";

const R = { toString: () => BRAND.signalRed }; // live (theme-driven) accent: resolved at render time
function pages(words: { w: string; start: number; end: number }[], maxWords = 4, maxChars = 24) {
  const out: { w: string; start: number; end: number; i: number }[][] = []; let cur: typeof out[number] = [];
  words.forEach((w, i) => { const chars = cur.reduce((a, x) => a + x.w.length + 1, 0) + w.w.length; if (cur.length && (cur.length >= maxWords || chars > maxChars)) { out.push(cur); cur = []; } cur.push({ ...w, i }); });
  if (cur.length) out.push(cur); return out;
}
export const kineticWords: Component = {
  kind: ["kinetic_words"],
  render(e, actions, c) {
    const id = e.id, g = c.graph, ink = c.profile.vars["--ink"];
    const ws = Number(e.props.wordStart ?? 0), we = Number(e.props.wordEnd ?? ws);
    const sceneStartSec = c.sceneStartFrame / c.fps; const words = g.voice.words.slice(ws, we + 1);
    const title = String(e.props.title ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 5); const hot = Number(e.props.hot ?? title.length - 1);
    const tHtml = title.map((w, i) => `<span class="tw_${id}" style="display:inline-block;opacity:0;margin:0 ${U(.9)};${i === hot ? `color:${R}` : ""}">${esc(w)}</span>`).join("");
    const u = Math.min(2.4 * c.box(e).w / 100, 4 * c.box(e).h / 100), fpx = (c.portrait ? 3.5 : 2.7) * u, maxChars = Math.max(10, Math.floor(0.84 * c.box(e).w / (0.6 * fpx)));
    const pg = pages(words, 4, maxChars);
    const pHtml = pg.map((p, k) => `<div class="pg_${id}_${k}" style="position:absolute;left:0;right:0;bottom:0;text-align:center;opacity:0;white-space:nowrap">${p.map((w, j) => `<span class="kw_${id}_${k}_${j}" style="display:inline-block;margin:0 ${U(.8)};color:${ink}">${esc(w.w)}</span>`).join("")}</div>`).join("");
    const statement = e.props.statement === true; // breather scene: one oversized centred phrase
    const html = `<div style="position:absolute;inset:0;--u:min(2.4cqw,4cqh)">
<div class="ti_${id}" style="position:absolute;left:0;right:0;top:${statement ? "30%" : "0"};text-align:center;font-size:${U(statement ? (c.portrait ? 7 : 5.4) : (c.portrait ? 4.3 : 3.1))};line-height:1.08;letter-spacing:-.03em;color:${ink}">${tHtml}</div>
<div style="position:absolute;left:0;right:0;bottom:0;height:${U(c.portrait ? 6 : 4.4)};font-size:${U(c.portrait ? 3.5 : 2.7)};letter-spacing:-.01em;font-weight:800">${pHtml}</div></div>`;
    let js = "";
    const first = byType(actions, "appear")[0], t0 = first ? c.sec(first.startFrame) : 0;
    if (title.length) js += `tl.fromTo('.tw_${id}',{opacity:0,y:80,scale:1.18},{opacity:1,y:0,scale:1,duration:.6,ease:SNAP,stagger:.08},${t0.toFixed(3)});`;
    const dis = byType(actions, "disappear")[0]; if (dis) js += `tl.to('.ti_${id}',{opacity:0,y:-30,duration:.3,ease:'power2.in'},${c.sec(dis.startFrame).toFixed(3)});`;
    pg.forEach((p, k) => {
      const ps = p[0].start - sceneStartSec, pe = k + 1 < pg.length ? pg[k + 1][0].start - sceneStartSec : p[p.length - 1].end - sceneStartSec + .35;
      js += `tl.fromTo('.pg_${id}_${k}',{opacity:0,y:26},{opacity:1,y:0,duration:.22,ease:SNAP,immediateRender:false},${Math.max(0, ps).toFixed(3)});tl.set('.pg_${id}_${k}',{opacity:0},${pe.toFixed(3)});`;
      p.forEach((w, j) => { const a = w.start - sceneStartSec, b = (j + 1 < p.length ? p[j + 1].start : w.end) - sceneStartSec;
        js += `tl.set('.kw_${id}_${k}_${j}',{color:'${R}',scale:1.06},${Math.max(0, a).toFixed(3)});tl.set('.kw_${id}_${k}_${j}',{color:'${ink}',scale:1},${Math.max(0, b).toFixed(3)});`; });
    });
    return { html, js };
  },
};
