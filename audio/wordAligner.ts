import crypto from "node:crypto";
/**
 * Word-level alignment. Script text is AUTHORITATIVE for spelling; audio supplies timing.
 *  1) Kokoro (existing mengine install) or a user audio file.
 *  2) SAPI TTS (Windows built-in) as fallback.
 *  3) WhisperX word timestamps + confidence when available, else estimated timing.
 *  4) Low-confidence repair for numbers / tech terms / brand names via monotone alignment against the script tokens.
 */
import { spawnSync } from "node:child_process";
import { resolvePython } from "../core/python.js";
import fs from "node:fs";
import path from "node:path";
import type { Word } from "../schemas/scene.schema.js";

export interface AlignResult { wavPath: string; words: Word[]; phrases: { text: string; start: number; end: number }[]; durationSec: number; source: "whisperx" | "estimated"; repaired: number }
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const TECH = /^(openai|ai|gpt|api|json|python|github|llm|sql|ui|ux|3d|\d+x?)$/i;

export function repairWords(script: string[], heard: { w: string; start: number | null; end: number | null; conf: number }[]): { words: Word[]; repaired: number } {
  const a = script.map(norm), b = heard.map(h => norm(h.w));
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const match = new Array<number>(a.length).fill(-1);
  for (let i = 0, j = 0; i < a.length && j < b.length;) { if (a[i] === b[j]) { match[i] = j; i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++; }
  const out: Word[] = []; let repaired = 0;
  script.forEach((w, i) => { const h = match[i] >= 0 ? heard[match[i]] : undefined; out.push({ w, start: h?.start ?? NaN, end: h?.end ?? NaN, conf: h ? h.conf : 0 }); });
  for (let i = 0; i < out.length; i++) {
    const bad = Number.isNaN(out[i].start) || (out[i].conf < 0.5 && TECH.test(norm(out[i].w)));
    if (!bad) continue;
    let l = i - 1; while (l >= 0 && Number.isNaN(out[l].end)) l--;
    let r = i + 1; while (r < out.length && Number.isNaN(out[r].start)) r++;
    const t0 = l >= 0 ? out[l].end : 0, t1 = r < out.length ? out[r].start : (l >= 0 ? out[l].end + 0.4 * (r - l) : 1);
    const n = r - l - 1, k = i - l - 1, step = (t1 - t0) / Math.max(n, 1);
    out[i] = { w: out[i].w, start: +(t0 + step * k).toFixed(3), end: +(t0 + step * (k + 0.9)).toFixed(3), conf: 0.45, repaired: true }; repaired++;
  }
  return { words: out.map(w => ({ ...w, start: +w.start.toFixed(3), end: +w.end.toFixed(3) })), repaired };
}

export function alignWords(opts: { scriptPath: string; outDir: string; userAudio?: string; voice?: string; speed?: number; whisper?: "auto" | "off" | "force" }): AlignResult {
  const root = path.resolve(import.meta.dirname, "..");
  fs.mkdirSync(opts.outDir, { recursive: true });
  let phrases: AlignResult["phrases"] = []; let wavPath = path.join(opts.outDir, "voice.wav");
  const scriptText = fs.readFileSync(opts.scriptPath, "utf8").trim();
  const scriptTokens = scriptText.replace(/—/g, " ").split(/\s+/).filter(Boolean);
  let est: Word[];
  if (opts.userAudio) {
    fs.copyFileSync(opts.userAudio, wavPath); est = [];
  } else {
    const key = crypto.createHash("sha256").update(JSON.stringify([scriptText, opts.voice ?? "am_adam", opts.speed ?? 1.05])).digest("hex");
    const keyFile = path.join(opts.outDir, "voice.key");
    const cached = fs.existsSync(keyFile) && fs.readFileSync(keyFile, "utf8") === key && fs.existsSync(wavPath) && fs.existsSync(path.join(opts.outDir, "voice.json"));
    if (!cached) {
      // Try Edge TTS (Bella/Jenny voice) if voice is "bella" or "jenny"
      if (opts.voice === "bella" || opts.voice === "jenny") {
        const edgePy = path.join(root, "audio", "edge_tts_gen.py");
        if (fs.existsSync(edgePy)) {
          const voiceName = "en-US-JennyNeural";
          const rateStr = "+15%";
          const er = spawnSync(resolvePython(), [edgePy, opts.scriptPath, opts.outDir, voiceName, rateStr], { encoding: "utf8" });
          if (er.status === 0 && fs.existsSync(wavPath) && fs.existsSync(path.join(opts.outDir, "voice.json"))) {
            fs.writeFileSync(keyFile, key);
            const j = JSON.parse(fs.readFileSync(path.join(opts.outDir, "voice.json"), "utf8"));
            phrases = j.phrases; est = j.words.map((w: any) => ({ w: w.w, start: w.start, end: w.end, conf: w.conf }));
            const dur = Math.max(...est.map(w => w.end)) + 0.3;
            let source: AlignResult["source"] = "estimated"; let words = est; let repaired = 0;
            if ((opts.whisper ?? "auto") !== "off") {
              const wj = path.join(opts.outDir, "whisperx.json");
              const wr = spawnSync(resolvePython(), [path.join(root, "audio/whisperx_align.py"), wavPath, wj], { encoding: "utf8" });
              if (wr.status === 0 && fs.existsSync(wj)) { const x = repairWords(scriptTokens, JSON.parse(fs.readFileSync(wj, "utf8"))); words = x.words; repaired = x.repaired; source = "whisperx"; }
              else if (opts.whisper === "force" || opts.userAudio) throw new Error("WhisperX required but unavailable: " + wr.stderr.slice(-200));
            }
            const finalDur = Math.max(...words.map(w => w.end)) + 0.3;
            return { wavPath, words, phrases, durationSec: +finalDur.toFixed(3), source, repaired };
          }
        }
      }
      // Try Santa TTS if voice is "santa"
      if (opts.voice === "santa") {
        const santaPy = path.join(root, "audio", "santa_tts.py");
        if (fs.existsSync(santaPy)) {
          const sr = spawnSync(resolvePython(), [santaPy, opts.scriptPath, opts.outDir], { encoding: "utf8" });
          if (sr.status === 0 && fs.existsSync(wavPath) && fs.existsSync(path.join(opts.outDir, "voice.json"))) {
            fs.writeFileSync(keyFile, key);
            const j = JSON.parse(fs.readFileSync(path.join(opts.outDir, "voice.json"), "utf8"));
            phrases = j.phrases; est = j.words.map((w: any) => ({ w: w.w, start: w.start, end: w.end, conf: w.conf }));
            const dur = Math.max(...est.map(w => w.end)) + 0.3;
            let source: AlignResult["source"] = "estimated"; let words = est; let repaired = 0;
            if ((opts.whisper ?? "auto") !== "off") {
              const wj = path.join(opts.outDir, "whisperx.json");
              const wr = spawnSync(resolvePython(), [path.join(root, "audio/whisperx_align.py"), wavPath, wj], { encoding: "utf8" });
              if (wr.status === 0 && fs.existsSync(wj)) { const x = repairWords(scriptTokens, JSON.parse(fs.readFileSync(wj, "utf8"))); words = x.words; repaired = x.repaired; source = "whisperx"; }
              else if (opts.whisper === "force" || opts.userAudio) throw new Error("WhisperX required but unavailable: " + wr.stderr.slice(-200));
            }
            const finalDur = Math.max(...words.map(w => w.end)) + 0.3;
            return { wavPath, words, phrases, durationSec: +finalDur.toFixed(3), source, repaired };
          }
        }
      }
      // Try Kokoro
      const synthPy = fs.existsSync(path.join(root, "mengine")) ? "audio/kokoro_synth.py" : "audio/kokoro_direct.py";
      const r = spawnSync(resolvePython(), [path.join(root, synthPy), opts.scriptPath, opts.outDir, opts.voice ?? "am_adam", String(opts.speed ?? 1.05)], { encoding: "utf8" });
      if (r.status !== 0) {
        // Try SAPI TTS (Windows built-in)
        console.warn("Kokoro TTS unavailable, trying SAPI...");
        const sapiPy = path.join(root, "audio", "sapi_tts.py");
        if (fs.existsSync(sapiPy)) {
          const sr = spawnSync(resolvePython(), [sapiPy, opts.scriptPath, opts.outDir, "Microsoft David Desktop", String(opts.speed ?? 1.0)], { encoding: "utf8" });
          if (sr.status === 0 && fs.existsSync(wavPath) && fs.existsSync(path.join(opts.outDir, "voice.json"))) {
            fs.writeFileSync(keyFile, key);
            const j = JSON.parse(fs.readFileSync(path.join(opts.outDir, "voice.json"), "utf8"));
            phrases = j.phrases; est = j.words.map((w: any) => ({ w: w.w, start: w.start, end: w.end, conf: w.conf }));
            const dur = Math.max(...est.map(w => w.end)) + 0.3;
            // Continue to whisperx
            let source: AlignResult["source"] = "estimated"; let words = est; let repaired = 0;
            if ((opts.whisper ?? "auto") !== "off") {
              const wj = path.join(opts.outDir, "whisperx.json");
              const wr = spawnSync(resolvePython(), [path.join(root, "audio/whisperx_align.py"), wavPath, wj], { encoding: "utf8" });
              if (wr.status === 0 && fs.existsSync(wj)) { const x = repairWords(scriptTokens, JSON.parse(fs.readFileSync(wj, "utf8"))); words = x.words; repaired = x.repaired; source = "whisperx"; }
              else if (opts.whisper === "force" || opts.userAudio) throw new Error("WhisperX required but unavailable: " + wr.stderr.slice(-200));
            }
            const finalDur = Math.max(...words.map(w => w.end)) + 0.3;
            return { wavPath, words, phrases, durationSec: +finalDur.toFixed(3), source, repaired };
          }
        }
        // Final fallback: silent audio with estimated timing
        console.warn("All TTS unavailable, falling back to silent audio with estimated timing");
        const words = scriptText.replace(/—/g, " ").split(/\s+/).filter(Boolean);
        const totalDur = words.length / 2.5 + 0.5;
        const sr2 = 24000;
        const samples = new Float32Array(Math.round(totalDur * sr2));
        const wavBuf = Buffer.alloc(44 + samples.length * 2);
        wavBuf.write("RIFF", 0); wavBuf.writeUInt32LE(36 + samples.length * 2, 4);
        wavBuf.write("WAVEfmt ", 8); wavBuf.writeUInt32LE(16, 16); wavBuf.writeUInt16LE(1, 20);
        wavBuf.writeUInt16LE(1, 22); wavBuf.writeUInt32LE(sr2, 24); wavBuf.writeUInt32LE(sr2 * 2, 28);
        wavBuf.writeUInt16LE(2, 32); wavBuf.writeUInt16LE(16, 34); wavBuf.write("data", 36);
        wavBuf.writeUInt32LE(samples.length * 2, 40);
        fs.writeFileSync(wavPath, wavBuf);
        let t = 0.3;
        const estWords = words.map(w => { const dur = Math.max(0.15, w.length * 0.06); const word = { w, start: +t.toFixed(3), end: +(t + dur * 0.9).toFixed(3), conf: 0.5 }; t += dur; return word; });
        fs.writeFileSync(path.join(opts.outDir, "voice.json"), JSON.stringify({ phrases: [{ text: scriptText, start: 0.3, end: t }], words: estWords, total: t }, null, 2));
        fs.writeFileSync(keyFile, key);
        const j = JSON.parse(fs.readFileSync(path.join(opts.outDir, "voice.json"), "utf8"));
        phrases = j.phrases; est = j.words.map((w: any) => ({ w: w.w, start: w.start, end: w.end, conf: w.conf }));
        const dur = Math.max(...est.map(w => w.end)) + 0.3;
        let source: AlignResult["source"] = "estimated"; let words2 = est; let repaired = 0;
        if ((opts.whisper ?? "auto") !== "off") {
          const wj = path.join(opts.outDir, "whisperx.json");
          const wr = spawnSync(resolvePython(), [path.join(root, "audio/whisperx_align.py"), wavPath, wj], { encoding: "utf8" });
          if (wr.status === 0 && fs.existsSync(wj)) { const x = repairWords(scriptTokens, JSON.parse(fs.readFileSync(wj, "utf8"))); words2 = x.words; repaired = x.repaired; source = "whisperx"; }
          else if (opts.whisper === "force" || opts.userAudio) throw new Error("WhisperX required but unavailable: " + wr.stderr.slice(-200));
        }
        const finalDur = Math.max(...words2.map(w => w.end)) + 0.3;
        return { wavPath, words: words2, phrases, durationSec: +finalDur.toFixed(3), source, repaired };
      }
      fs.writeFileSync(keyFile, key);
    }
    const j = JSON.parse(fs.readFileSync(path.join(opts.outDir, "voice.json"), "utf8")); phrases = j.phrases; est = j.words.map((w: any) => ({ w: w.w, start: w.start, end: w.end, conf: w.conf }));
  }
  let source: AlignResult["source"] = "estimated"; let words = est!; let repaired = 0;
  if ((opts.whisper ?? "auto") !== "off") {
    const wj = path.join(opts.outDir, "whisperx.json");
    const r = spawnSync(resolvePython(), [path.join(root, "audio/whisperx_align.py"), wavPath, wj], { encoding: "utf8" });
    if (r.status === 0 && fs.existsSync(wj)) { const x = repairWords(scriptTokens, JSON.parse(fs.readFileSync(wj, "utf8"))); words = x.words; repaired = x.repaired; source = "whisperx"; }
    else if (opts.whisper === "force" || opts.userAudio) throw new Error("WhisperX required but unavailable: " + r.stderr.slice(-200));
  }
  const dur = Math.max(...words.map(w => w.end)) + 0.3;
  return { wavPath, words, phrases, durationSec: +dur.toFixed(3), source, repaired };
}
