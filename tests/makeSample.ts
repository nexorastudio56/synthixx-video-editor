import fs from "node:fs";
const fps = 30;
const text1 = "Right now an autonomous AI agent can open a browser search live data and write Python code all by itself";
const text2 = "First the agent connects to OpenAI and scans thousands of files in a terminal";
const words: any[] = []; let t = 0.4;
for (const w of [...text1.split(" "), ...text2.split(" ")]) { const d = 0.22 + Math.min(w.length, 9) * 0.02; words.push({ w, start: +t.toFixed(2), end: +(t + d).toFixed(2), conf: 1 }); t += d + 0.04; if (w === "itself") t += 0.9; }
const idx = (w: string, from = 0) => words.findIndex((x, i) => i >= from && x.w === w);
const F = (i: number, k: "start" | "end") => Math.round(words[i][k] * fps);
const iBrowser = idx("browser"), iSearch = idx("search"), iPython = idx("Python"), iItself = idx("itself"), iConn = idx("connects"), iOpenAI = idx("OpenAI"), iTerm = idx("terminal"), iScans = idx("scans");
const s1End = F(iItself, "end") + 25, s2End = F(words.length - 1, "end") + 30;
const R = (x: number, y: number, w: number, h: number, z = 0) => ({ x, y, w, h, z });
const asset = (id: string, kind: string, p: string) => ({ id, kind, path: p, source: "test", verified: true, hasAlpha: kind !== "audio" });
const graph = {
  schemaVersion: 1, title: "Phase 1 sample: AI agent", fps, aspectRatio: "9:16", morphism: "glass", durationFrames: s2End,
  voice: { audioAssetId: "voice_main", words },
  assets: [asset("voice_main", "audio", "samples/voice.wav"), asset("logo_github", "logo", "samples/logo_github.svg")],
  scenes: [
    { id: "scene_agent_powers", archetype: "live_ui_action", startFrame: 0, endFrame: s1End, title: "Agent powers",
      entities: [
        { id: "ent_browser", kind: "browser", capabilities: ["appear", "click", "type"], placement: { "9:16": R(0.05, 0.1, 0.9, 0.22), "16:9": R(0.05, 0.1, 0.4, 0.5) }, props: { url: "agent://browse" } },
        { id: "ent_dash", kind: "dashboard", capabilities: ["appear", "count"], placement: { "9:16": R(0.05, 0.36, 0.9, 0.22), "16:9": R(0.5, 0.1, 0.45, 0.4) }, props: {} },
        { id: "ent_code", kind: "code_editor", capabilities: ["appear", "type"], placement: { "9:16": R(0.05, 0.62, 0.9, 0.24), "16:9": R(0.5, 0.55, 0.45, 0.4) }, props: { language: "python" } }],
      semanticEvents: [
        { id: "ev_browser", wordStart: iBrowser - 1, wordEnd: iBrowser, startFrame: F(iBrowser - 1, "start"), endFrame: F(iBrowser, "end"), intent: "agent opens a browser",
          actions: [{ id: "a_b1", entityId: "ent_browser", type: "appear", startFrame: F(iBrowser - 1, "start"), endFrame: F(iBrowser - 1, "start") + 15, ease: "spring" }, { id: "a_b2", entityId: "ent_browser", type: "type", startFrame: F(iBrowser - 1, "start") + 16, endFrame: F(iBrowser, "end"), text: "agent://open-browser", ease: "steps" }] },
        { id: "ev_data", wordStart: iSearch, wordEnd: iSearch + 2, startFrame: F(iSearch, "start"), endFrame: F(iSearch + 2, "end"), intent: "agent searches live data",
          actions: [{ id: "a_d1", entityId: "ent_dash", type: "appear", startFrame: F(iSearch, "start"), endFrame: F(iSearch, "start") + 15 }, { id: "a_d2", entityId: "ent_dash", type: "count", startFrame: F(iSearch, "start") + 16, endFrame: F(iSearch + 2, "end"), value: 100 }] },
        { id: "ev_code", wordStart: iPython - 2, wordEnd: iItself, startFrame: F(iPython - 2, "start"), endFrame: F(iItself, "end"), intent: "agent writes Python code",
          actions: [{ id: "a_c1", entityId: "ent_code", type: "appear", startFrame: F(iPython - 2, "start"), endFrame: F(iPython - 2, "start") + 15 }, { id: "a_c2", entityId: "ent_code", type: "type", startFrame: F(iPython - 2, "start") + 16, endFrame: F(iItself, "end"), text: "agent.run()", ease: "steps" }] }],
      camera: [{ frame: 0, zoom: 1 }, { frame: s1End - 1, zoom: 1.06, focusTarget: "ent_code", depthOfField: { enabled: true, focusEntityId: "ent_code", blurPx: 3 } }],
      audioEvents: [{ id: "sfx_1", frame: F(iBrowser, "start"), sfx: "click", gain: 0.5, entityId: "ent_browser" }] },
    { id: "scene_terminal_scan", archetype: "terminal_run", startFrame: s1End, endFrame: s2End, title: "Terminal scan",
      entities: [
        { id: "ent_openai", kind: "logo", capabilities: ["appear", "connect"], assetId: "logo_github", label: "GitHub", placement: { "9:16": R(0.2, 0.08, 0.6, 0.1), "16:9": R(0.05, 0.1, 0.3, 0.2) }, props: {} },
        { id: "ent_term", kind: "terminal", capabilities: ["appear", "type", "count"], placement: { "9:16": R(0.05, 0.25, 0.9, 0.5), "16:9": R(0.4, 0.1, 0.55, 0.8) }, props: {} }],
      semanticEvents: [
        { id: "ev_conn", wordStart: iConn, wordEnd: iOpenAI, startFrame: F(iConn, "start"), endFrame: F(iOpenAI, "end"), intent: "agent connects to OpenAI",
          actions: [{ id: "a_o1", entityId: "ent_openai", type: "appear", startFrame: F(iConn, "start"), endFrame: F(iConn, "start") + 12 }, { id: "a_o2", entityId: "ent_openai", type: "connect", startFrame: F(iOpenAI, "start"), endFrame: F(iOpenAI, "end"), targetEntityId: "ent_term" }] },
        { id: "ev_scan", wordStart: iScans, wordEnd: iTerm, startFrame: F(iScans, "start"), endFrame: F(iTerm, "end"), intent: "agent scans files in a terminal",
          actions: [{ id: "a_t1", entityId: "ent_term", type: "appear", startFrame: F(iScans, "start") - 4, endFrame: F(iScans, "start") + 12 }, { id: "a_t2", entityId: "ent_term", type: "type", startFrame: F(iScans, "start") + 13, endFrame: F(iTerm, "end"), text: "scan ./files --all", ease: "steps" }] }],
      camera: [{ frame: s1End, zoom: 1 }, { frame: s2End - 1, zoom: 1.08, focusTarget: "ent_term" }],
      audioEvents: [{ id: "sfx_2", frame: F(iScans, "start"), sfx: "type", gain: 0.4, entityId: "ent_term" }] }]
};
fs.mkdirSync("samples", { recursive: true });
fs.writeFileSync("samples/agent.scene.json", JSON.stringify(graph, null, 1));
// intentionally broken copy: 8 different defects
const bad = JSON.parse(JSON.stringify(graph));
bad.scenes[0].entities[1].capabilities.push("type");                 // dashboard cannot type
bad.scenes[0].semanticEvents[0].actions[1].targetEntityId = undefined;
bad.scenes[0].semanticEvents[1].actions[0].entityId = "ent_missing";  // missing entity
bad.scenes[1].startFrame += 40;                                       // gap
bad.scenes[1].entities[0].assetId = "logo_nope";                      // missing asset
delete bad.scenes[1].entities[1].placement["9:16"];                   // no adaptive placement
bad.scenes[1].semanticEvents[0].actions[1].targetEntityId = undefined; // connect w/o target
bad.scenes[0].semanticEvents[2].actions[0].startFrame = bad.scenes[0].semanticEvents[2].actions[1].startFrame + 6; // appear after type
fs.writeFileSync("samples/agent.bad.scene.json", JSON.stringify(bad, null, 1));
console.log("samples written", graph.durationFrames, "frames");
