import { repairWords } from "../audio/wordAligner.js";
let fail = 0; const t = (n: string, c: boolean) => { console.log(c ? "PASS" : "FAIL", n); if (!c) fail++; };
const script = "Python agents boost output by 10x using OpenAI".split(" ");
// whisper misheard "OpenAI" as "open a eye" + dropped "10x"
const heard = [{ w: "Python", start: 0.1, end: 0.5, conf: .9 }, { w: "agents", start: 0.55, end: 1.0, conf: .9 }, { w: "boost", start: 1.05, end: 1.4, conf: .9 }, { w: "output", start: 1.45, end: 1.9, conf: .9 }, { w: "by", start: 1.95, end: 2.1, conf: .9 }, { w: "using", start: 3.0, end: 3.3, conf: .9 }, { w: "open", start: 3.35, end: 3.6, conf: .2 }];
const r = repairWords(script, heard);
t("script spelling is authoritative", r.words.map(w => w.w).join(" ") === script.join(" "));
t("dropped '10x' interpolated between 'by' and 'using'", r.words[5].start >= 2.1 && r.words[5].end <= 3.0 && r.words[5].repaired === true);
t("timings monotone", r.words.every((w, i) => i === 0 || w.start >= r.words[i - 1].start));
t("repaired count reported", r.repaired >= 1);
console.log(r.words.map(w => `${w.w}:${w.start}-${w.end}${w.repaired ? "*" : ""}`).join("  "));
process.exit(fail ? 1 : 0);
