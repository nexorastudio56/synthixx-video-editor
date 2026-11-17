import { esc } from "../types.js";
/** units: 1u = min(1cqw, 1.7cqh) so every interface scales with its own box (portrait or landscape). */
export const U = (n: number) => `calc(var(--u)*${n})`;
export const WRAP = (inner: string, extra = "") => `<div class="m-surf" style="position:absolute;inset:0;--u:min(2.4cqw,4cqh);${extra}">${inner}</div>`;
export const DOTS = `<div style="position:absolute;left:${U(3)};top:${U(2.6)};display:flex;gap:${U(1.6)}"><i class="m-led" style="width:${U(2)};height:${U(2)};border-radius:50%;background:var(--bad);box-shadow:0 0 10px var(--bad)"></i><i class="m-led" style="width:${U(2)};height:${U(2)};border-radius:50%;background:#ffc53d;box-shadow:0 0 10px #ffc53d"></i><i class="m-led" style="width:${U(2)};height:${U(2)};border-radius:50%"></i></div>`;
/** deterministic typing: text revealed purely from timeline time */
export const TYPE_JS = `function TY(sel,text,t0,t1,pre){const el=document.querySelector(sel);if(!el)return;const o={v:0};tl.fromTo(o,{v:0},{v:1,duration:Math.max(.05,t1-t0),ease:'none',onUpdate:()=>{el.textContent=(pre||'')+text.slice(0,Math.floor(o.v*text.length+1e-6))}},t0)}
function CNT(sel,from,to,t0,t1,fmt){const el=document.querySelector(sel);if(!el)return;const o={v:from};tl.fromTo(o,{v:from},{v:to,duration:Math.max(.05,t1-t0),ease:'power2.out',onUpdate:()=>{el.textContent=fmt?fmt(o.v):Math.round(o.v).toLocaleString('en-US')}},t0)}
function BLINK(sel,T){const el=document.querySelector(sel);if(!el)return;const o={v:0};tl.fromTo(o,{v:0},{v:T,duration:T,ease:'none',onUpdate:()=>{el.style.opacity=(Math.floor(o.v*2)%2===0)?1:.15}},0)}`;
/** physics helpers (pure functions of timeline progress): damped spring (stiffness/damping/mass) and CSS cubic-bezier as GSAP ease functions */
export const PHYS_JS = `function SPRING(k,d,m,T){const w0=Math.sqrt(k/m),z=d/(2*Math.sqrt(k*m)),wd=w0*Math.sqrt(Math.max(1e-6,1-z*z));return p=>{const t=p*T;return p>=1?1:1-Math.exp(-z*w0*t)*(Math.cos(wd*t)+(z*w0/wd)*Math.sin(wd*t))}}
function BEZ(x1,y1,x2,y2){const cx=3*x1,bx=3*(x2-x1)-cx,ax=1-cx-bx,cy=3*y1,by=3*(y2-y1)-cy,ay=1-cy-by;const X=t=>((ax*t+bx)*t+cx)*t,Y=t=>((ay*t+by)*t+cy)*t,D=t=>(3*ax*t+2*bx)*t+cx;return p=>{if(p<=0)return 0;if(p>=1)return 1;let t=p;for(let i=0;i<8;i++){const e=X(t)-p;if(Math.abs(e)<1e-6)break;const d=D(t);if(Math.abs(d)<1e-6)break;t-=e/d}return Y(Math.min(1,Math.max(0,t)))}}
const SNAP=BEZ(.16,1,.3,1),SPR=SPRING(150,15,1,1.1);`;
export { esc };
