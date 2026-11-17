/** Stage 1 — Narrative Extractor: words -> clauses (story beats) with Subject + Action + Object triplets and visual cues. */
import type { Word } from "../schemas/scene.schema.js";
import type { ResolvedEntity } from "./entityResolver.js";

export type Comp = "browser" | "dashboard" | "code" | "terminal" | "workflow" | "alert" | "metric" | "chat" | "brand" | "text";
export interface Triplet { subject: string; verb: string; object: string }
export interface Clause { idx: number; wordStart: number; wordEnd: number; text: string; startSec: number; endSec: number; role: "hook" | "step" | "explain" | "cta"; triplet: Triplet; numbers: number[]; brands: ResolvedEntity[]; cues: Comp[]; split: boolean; key: string }

const STOP = new Set("a an the and or but of to in on at for with by from as is are was were be been it its this that these those you your we our they their i my me can will just not all itself".split(" "));
const VERBS = "stop use open search write connect scan build send boost watch let automate create generate analyze track book reply schedule deploy learn run find fix make get turn show start grow save sell hire launch post publish train ship test click type read draw design edit plan code".split(" ");
const stem = (v: string) => v.replace(/(ing|ed|es|s)$/, "");
const VSET = new Set(VERBS.map(stem));
const CUES: [RegExp, Comp][] = [
  [/\b(browser|website|web page|webpage|site|open|url|tab)\b/i, "browser"],
  [/\b(code|python|script|program|developer|function|app)\b/i, "code"],
  [/\b(terminal|command|files?|scan|console|server)\b/i, "terminal"],
  [/\b(workflow|automation|automate|pipeline|integration|connects?)\b/i, "workflow"],
  [/\b(alert|notification|notify|ping|reminder)\b/i, "alert"],
  [/\b(productivity|faster|boost|growth|revenue|results|\d+x|percent)\b/i, "metric"],
  [/\b(data|analytics|metrics|numbers|stats|dashboard|report|charts?)\b/i, "dashboard"],
  [/\b(chat|chatbot|chatting|prompt|ask|conversation|talk)\b/i, "chat"],
];
const num = (w: string) => { const m = w.match(/^(\d+(?:\.\d+)?)x?$/i); return m ? Number(m[1]) : null; };

export function extractClauses(words: Word[], resolved: ResolvedEntity[]): Clause[] {
  const raw: { s: number; e: number }[] = []; let s = 0;
  words.forEach((w, i) => { if (/[.!?;:,—]$/.test(w.w) || i === words.length - 1) { raw.push({ s, e: i }); s = i + 1; } });
  // merge tiny fragments (<3 words) into the next clause
  const spans: { s: number; e: number }[] = [];
  for (const r of raw) { const last = spans[spans.length - 1]; if (last && (last.e - last.s + 1) < 3 && !/[.!?]$/.test(words[last.e].w)) { last.e = r.e; } else spans.push({ ...r }); }
  return spans.map((sp, idx) => {
    const toks = words.slice(sp.s, sp.e + 1).map(w => w.w); const text = toks.join(" ");
    const clean = toks.map(t => t.replace(/[^\w-]/g, "")); const low = clean.map(t => t.toLowerCase());
    let vi = low.findIndex(t => VSET.has(stem(t)));
    const verb = vi >= 0 ? stem(low[vi]) : "show";
    const subj = vi > 0 ? low.slice(Math.max(0, vi - 3), vi).filter(t => !STOP.has(t)).slice(-2).join(" ") : "";
    const obj = low.slice(vi + 1).filter(t => t && !STOP.has(t)).slice(0, 4).join(" ");
    const cues: Comp[] = []; for (const [re, c] of CUES) if (re.test(text) && !cues.includes(c)) cues.push(c);
    const brands = resolved.filter(e => e.type === "brand" && low.includes(e.name.toLowerCase()));
    if (brands.length && !cues.includes("brand")) cues.push("brand");
    const first = low[0]; const role: Clause["role"] = idx === 0 ? "hook" : /^(first|next|then|finally|now|watch|step)$/.test(first) ? "step" : (sp.e === words.length - 1 ? "cta" : "explain");
    const key = clean.filter(t => !STOP.has(t.toLowerCase())).slice(-3).join(" ");
    return { idx, wordStart: sp.s, wordEnd: sp.e, text, startSec: words[sp.s].start, endSec: words[sp.e].end, role, triplet: { subject: subj || "agent", verb, object: obj || key }, numbers: clean.map(num).filter((n): n is number => n !== null), brands, cues: cues.length ? cues : ["text"], split: /\b(not just|instead|versus|vs|but|rather than|stop)\b/i.test(text), key };
  });
}
