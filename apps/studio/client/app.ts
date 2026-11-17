/** Studio client: presets, brand kit, URL/prompt import, live BrandThemeTokens preview, render + QA/chunk inspector. */
interface ModeView { id: string; colors: Record<string, string>; ratios: { text: number; accent: number } }
interface ThemeView { tokens: { name?: string; surface: { kind: string }; motion: { personality: string }; color: Record<string, string> } & Record<string, unknown>; hash: string; modes: ModeView[]; repairs: { detail?: string; what?: string }[]; matched?: unknown; site?: { title: string | null } }
interface PresetView extends ThemeView { id: string }
interface ChunkRec { index: number; status: string; cls: string; startFrame: number; endFrame: number; sec: number }
interface Manifest { state: string; chunks: ChunkRec[]; verified: number; rendered: number; scheduler: { gpuRunning: number; cpuRunning: number; gpuLimit: number; cpuLimit: number; peakGpu: number; peakCpu: number } }
interface SceneQA { sceneId: string; passed: boolean; repairs: unknown[]; issues: { code: string; detail: string }[] }
interface JobStatus { id: string; running: boolean; exit: number | null; log: string[]; manifest: Manifest | null; qa: { passed: boolean; scenes: SceneQA[]; global: { code: string; detail: string }[] } | null; sheet: boolean; video: string | null }
interface SystemView { cpus: number; load1: number; memUsedGb: number; memTotalGb: number; gpu: { name: string; usedMb: number; totalMb: number; util: number } | null; limits: { gpuHeavy: number; cpuDom: number } }

let scrubDuration = 0, scrubTimer = 0; let loopId: any = 0;
async function scrubFrame(t: number): Promise<void> {
  if (!state.jobId) return;
  const img = document.getElementById("scrubFrame") as HTMLImageElement;
  if (!img) return;
  try {
    const r = await fetch(`/api/scrub/${state.jobId}?t=${encodeURIComponent(String(t))}`);
    if (!r.ok) return;
    const blob = await r.blob();
    img.src = URL.createObjectURL(blob);
  } catch { /* scrub retry next tick */ }
}
function mountScrubber(panelEl: HTMLElement): void {
  if (document.getElementById("scrubWrap")) return;
  const wrap = document.createElement("div");
  wrap.id = "scrubWrap";
  wrap.style.cssText = "margin-top:14px;padding:12px;border-radius:14px;background:var(--bg);box-shadow:inset 4px 4px 9px var(--lo),inset -4px -4px 9px var(--hi)";
  wrap.innerHTML = `
    <h2 style="margin:0 0 10px;font-size:13px;text-transform:uppercase;color:var(--ink2)">Live Scene Scrub</h2>
    <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px">
      <img id="scrubFrame" src="" style="width:160px;height:284px;border-radius:10px;background:#111;object-fit:cover" alt="scrub frame">
      <div class="grow" style="min-width:0">
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--ink2);margin-bottom:6px"><span>0:00</span><span id="scrubTime">0:00</span><span id="scrubDur">0:00</span></div>
        <input id="scrubSlider" type="range" min="0" max="100" value="0" style="width:100%;accent-color:var(--acc)">
      </div>
    </div>
    <div style="display:flex;gap:8px">
      <button id="scrubPlay" class="btn">▶ Preview</button>
      <button id="scrubLoop" class="btn">↻ Loop</button>
    </div>
  `;
  panelEl.appendChild(wrap);
  const slider = $("scrubSlider") as HTMLInputElement;
  const playBtn = $("scrubPlay") as HTMLButtonElement;
  const loopBtn = $("scrubLoop") as HTMLButtonElement;
  let playing = false;
  slider.oninput = () => { const t = (parseFloat(slider.value) / 100) * scrubDuration; $("scrubTime").textContent = fmtTime(t); void scrubFrame(t); };
  playBtn.onclick = () => { playing = !playing; playBtn.textContent = playing ? "⏸ Pause" : "▶ Preview"; if (playing) { loopId = setInterval(() => { const v = parseFloat(slider.value) + 1; if (v > 100) slider.value = "0"; slider.dispatchEvent(new Event("input")); }, 120); } else { clearInterval(loopId); } };
  loopBtn.onclick = () => { clearInterval(loopId); loopId = setInterval(() => { const v = parseFloat(slider.value) + 1; if (v > 100) slider.value = "0"; slider.dispatchEvent(new Event("input")); }, 120); };
  function fmtTime(s: number) { const m = Math.floor(s / 60), sec = Math.floor(s % 60); return `${m}:${sec.toString().padStart(2, "0")}`; }
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const esc = (s: unknown): string => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
function fmtTime(s: number) { const m = Math.floor(s / 60), sec = Math.floor(s % 60); return `${m}:${sec.toString().padStart(2, "0")}`; }
const post = async <T>(url: string, b: unknown): Promise<T> => { const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }); const j = await r.json() as T & { error?: string }; if (!r.ok) throw new Error(j.error ?? r.statusText); return j; };

const MATERIALS = ["glass", "clay", "neumorphism", "holo", "liquid", "minimal"], PACING = [["viral-fast", "Viral Fast"], ["explainer-medium", "Explainer Medium"], ["luxury-slow", "Luxury Slow"]] as const;
const state = { theme: null as ThemeView | null, presetId: "apple_minimal", material: "", pacing: "", logoPath: "", presets: [] as PresetView[], jobId: "" };

function swatches(m: ModeView): string { const c = m.colors; return `<div class="sw">${[c["background"], c["textPrimary"], c["accent"], c["accentSecondary"], c["surface"]].map(x => `<i title="${esc(x)}" style="background:${esc(x)}"></i>`).join("")}</div>`; }
function renderPreview(t: ThemeView): void {
  state.theme = t;
  $("preview").innerHTML = `<div class="row" style="justify-content:space-between"><b>${esc(t.tokens.name ?? "custom")}</b><small>hash ${esc(t.hash.slice(0, 10))}</small></div>
  <div class="row" style="margin:10px 0"><span class="badge">${esc(t.tokens.surface.kind)}</span><span class="badge">${esc(t.tokens.motion.personality)}</span></div>
  ${t.modes.map(m => `<div class="inset" style="padding:10px;margin-bottom:10px"><small>${esc(m.id)} · text ${m.ratios.text}:1 · accent ${m.ratios.accent}:1</small>${swatches(m)}</div>`).join("")}
  ${t.repairs.length ? `<small>WCAG auto-repairs: ${t.repairs.map(r => esc(r.detail ?? r.what ?? "repair")).join("; ")}</small>` : "<small>No WCAG repairs needed.</small>"}
  <details style="margin-top:10px"><summary><small>tokens JSON</small></summary><pre>${esc(JSON.stringify(t.tokens, null, 1))}</pre></details>`;
  const m0 = t.modes[0]!.colors; (($("cBg") as HTMLInputElement).value = m0["background"]!); (($("cTx") as HTMLInputElement).value = m0["textPrimary"]!); (($("cAc") as HTMLInputElement).value = m0["accent"]!);
  state.material = t.tokens.surface.kind; state.pacing = t.tokens.motion.personality; paintToggles();
}
function paintToggles(): void {
  $("materials").innerHTML = MATERIALS.map(m => `<button class="btn ${state.material === m ? "on" : ""}" data-m="${m}">${m[0]!.toUpperCase() + m.slice(1)}</button>`).join("");
  $("pacing").innerHTML = PACING.map(([k, l]) => `<button class="btn ${state.pacing === k ? "on" : ""}" data-p="${k}">${l}</button>`).join("");
  document.querySelectorAll<HTMLButtonElement>("[data-m]").forEach(b => b.onclick = () => { state.material = b.dataset["m"]!; void compileKit(); });
  document.querySelectorAll<HTMLButtonElement>("[data-p]").forEach(b => b.onclick = () => { state.pacing = b.dataset["p"]!; void compileKit(); });
}
function paintPresets(): void {
  $("presets").innerHTML = state.presets.map(p => `<button class="card ${state.presetId === p.id ? "on" : ""}" data-id="${p.id}"><b>${esc(p.tokens.name ?? p.id)}</b>${swatches(p.modes[0]!)}<div style="margin-top:8px" class="tag">${p.id === "apple_minimal" ? "default · " : ""}${esc(p.tokens.surface.kind)}</div></button>`).join("");
  document.querySelectorAll<HTMLButtonElement>("[data-id]").forEach(b => b.onclick = () => { state.presetId = b.dataset["id"]!; state.logoPath = ""; $("logoInfo").textContent = "No logo uploaded."; paintPresets(); renderPreview(state.presets.find(p => p.id === state.presetId)!); });
}
let kitTimer = 0;
async function compileKit(): Promise<void> {
  window.clearTimeout(kitTimer);
  kitTimer = window.setTimeout(async () => { try { renderPreview(await post<ThemeView>("/api/compile-theme", { mode: "kit", background: ($("cBg") as HTMLInputElement).value, text: ($("cTx") as HTMLInputElement).value, accent: ($("cAc") as HTMLInputElement).value, base: state.presetId, material: state.material, pacing: state.pacing, ...(state.logoPath ? { logoPath: state.logoPath } : {}) })); } catch (e) { $("importMsg").innerHTML = `<span class="err">${esc((e as Error).message)}</span>`; } }, 120);
}
for (const id of ["cBg", "cTx", "cAc"]) $(id).addEventListener("input", () => void compileKit());
$("logo").addEventListener("change", async ev => {
  const f = (ev.target as HTMLInputElement).files?.[0]; if (!f) return;
  const r = await fetch("/api/logo", { method: "POST", headers: { "content-type": f.type }, body: f }); const j = await r.json() as { logoPath?: string; sha256?: string; error?: string };
  if (!r.ok || !j.logoPath) { $("logoInfo").innerHTML = `<span class="err">${esc(j.error ?? "upload failed")}</span>`; return; }
  state.logoPath = j.logoPath; $("logoInfo").textContent = `Logo ${f.name} → 3D Brand Anchor (sha ${j.sha256!.slice(0, 10)})`; void compileKit();
});
async function importer(body: unknown, btn: string): Promise<void> {
  const b = $(btn) as HTMLButtonElement; b.disabled = true; $("importMsg").textContent = "Working…";
  try { const t = await post<ThemeView>("/api/compile-theme", body); renderPreview(t); state.presetId = ""; paintPresets(); $("importMsg").innerHTML = `<small>${t.site ? "Imported from " + esc(t.site.title ?? "site") : "Prompt compiled"} — adjust below or render.</small>`; }
  catch (e) { $("importMsg").innerHTML = `<span class="err">${esc((e as Error).message)}</span>`; } finally { b.disabled = false; }
}
$("goUrl").onclick = () => void importer({ mode: "url", url: ($("url") as HTMLInputElement).value }, "goUrl");
$("goPrompt").onclick = () => void importer({ mode: "prompt", prompt: ($("prompt") as HTMLInputElement).value }, "goPrompt");

/* ---------- render + inspector ---------- */
$("render").onclick = async () => {
  if (!state.theme) return; const b = $("render") as HTMLButtonElement; b.disabled = true; $("renderMsg").textContent = "";
  try { const j = await post<{ id: string }>("/api/jobs", { script: ($("script") as HTMLTextAreaElement).value, ratio: ($("ratio") as HTMLSelectElement).value, quality: ($("quality") as HTMLSelectElement).value, tokens: state.theme.tokens }); state.jobId = j.id; $("renderMsg").innerHTML = `<small>job ${j.id} (same inputs resume automatically)</small>`; }
  catch (e) { $("renderMsg").innerHTML = `<span class="err">${esc((e as Error).message)}</span>`; } finally { b.disabled = false; }
};
function paintJob(s: JobStatus): void {
  const m = s.manifest, qa = s.qa; let badges = "";
  if (qa) { badges += `<span class="badge ${qa.passed ? "pass" : "fail"}">QA ${qa.passed ? "PASS" : "FAIL"}</span>`; for (const sc of qa.scenes) badges += `<span class="badge ${sc.passed ? (sc.repairs.length ? "fix" : "pass") : "fail"}" title="${esc(sc.issues.map(i => i.detail).join(" | "))}">${esc(sc.sceneId.replace("scene_", "S"))}${sc.repairs.length ? " ⚙" + sc.repairs.length : ""}</span>`; for (const g of qa.global) badges += `<span class="badge fail" title="${esc(g.detail)}">${esc(g.code)}</span>`; }
  $("qaBadges").innerHTML = badges || "<small>QA runs before rendering (storyboard stills).</small>";
  if (m) {
    const done = m.chunks.filter(c => c.status === "done").length, n = m.chunks.length; ($("bar") as HTMLElement).style.width = `${n ? (100 * done) / n : 0}%`;
    $("chunkTitle").textContent = `Chunks ${done}/${n}`; $("chunkSub").textContent = `${m.state} · ${m.verified} reused · ${m.rendered} rendered`;
    $("chunks").innerHTML = m.chunks.map(c => `<div class="ck ${c.status} ${c.cls === "gpu-heavy" ? "gpu" : ""}" title="#${c.index} ${c.cls} f${c.startFrame}-${c.endFrame} ${c.status} ${c.sec}s"></div>`).join("");
    const sc = m.scheduler; $("sched").innerHTML = `<div>GPU-heavy: <b>${sc.gpuRunning}/${sc.gpuLimit}</b> <small>(peak ${sc.peakGpu})</small> · CPU-DOM: <b>${sc.cpuRunning}/${sc.cpuLimit}</b> <small>(peak ${sc.peakCpu})</small></div>`;
  }
  $("log").textContent = s.log.join("\n");
  const v = $("player") as HTMLVideoElement; if (s.video) { if (!v.src.endsWith(s.video)) v.src = s.video; $("noVideo").style.display = "none"; } else { $("noVideo").style.display = ""; }
  const img = $("sheet") as HTMLImageElement; if (s.sheet) { img.style.display = ""; if (!img.src.includes(s.id)) img.src = `/api/jobs/${s.id}/sheet`; }
  // Mount live scrubber inside the Player panel.
  const playerPanel = $("player")!.parentElement!;
  mountScrubber(playerPanel);
  if (s.manifest && s.manifest.state) { scrubDuration = Math.max(1, parseFloat(s.manifest.state) || 60); }
  const sd = document.getElementById("scrubDur"); if (sd) sd.textContent = fmtTime(scrubDuration);
  const slider = document.getElementById("scrubSlider") as HTMLInputElement | null; if (slider) slider.max = "100";
}
async function sysTick(): Promise<void> {
  try { const s = await (await fetch("/api/system")).json() as SystemView; const el = $("sched"); const extra = `<div><small>CPU load ${s.load1}/${s.cpus} · RAM ${s.memUsedGb}/${s.memTotalGb} GB · ${s.gpu ? `VRAM ${s.gpu.usedMb}/${s.gpu.totalMb} MB (${esc(s.gpu.name)}, ${s.gpu.util}%)` : "no NVIDIA GPU detected (software raster)"}</small></div>`; const old = el.querySelector(".sys"); if (old) old.remove(); const d = document.createElement("div"); d.className = "sys"; d.innerHTML = extra; el.appendChild(d); } catch { /* server restarting */ }
}
async function jobTick(): Promise<void> { if (!state.jobId) return; try { const r = await fetch(`/api/jobs/${state.jobId}`); if (r.ok) paintJob(await r.json() as JobStatus); } catch { /* retry next tick */ } }
void (async () => {
  state.presets = await (await fetch("/api/presets")).json() as PresetView[]; paintPresets(); renderPreview(state.presets.find(p => p.id === state.presetId) ?? state.presets[0]!);
  setInterval(() => void jobTick().then(sysTick), 1500); void sysTick();
})();
