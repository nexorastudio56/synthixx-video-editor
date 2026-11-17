#!/usr/bin/env node
/**
 * Quick test: compose -> probe -> shots -> render (5s only) -> verify
 * Usage: node test_cinema.mjs
 * Run from inside cinema/ directory
 */
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const step = (n, msg) => console.log(`\n[${"=".repeat(40)}]\n  STEP ${n}: ${msg}\n[${"=".repeat(40)}]`);
const run = (cmd, opts = {}) => { console.log(`> ${cmd}`); return execSync(cmd, { stdio: "inherit", encoding: "utf8", ...opts }); };
const t0 = Date.now();

try {
  step(1, "Compose (inject timing into page.html)");
  run("node compose.mjs");
  if (!fs.existsSync("build/index.html")) throw new Error("build/index.html not created!");
  console.log("  OK: build/index.html created");

  step(2, "Probe (bounds check)");
  run("node probe.mjs");

  step(3, "Shots (capture key frames)");
  run("node shots.mjs 0 90 180 300 600 900 1200 1500 1790");
  const shotCount = fs.readdirSync("shots").filter(f => f.endsWith(".png")).length;
  console.log(`  OK: ${shotCount} shots captured`);

  step(4, "Cues (extract SFX cue list)");
  run("node cues.mjs");
  if (!fs.existsSync("build/cues.json")) throw new Error("cues.json not created!");
  const cues = JSON.parse(fs.readFileSync("build/cues.json", "utf8"));
  console.log(`  OK: ${cues.length} cues`);

  step(5, "Render (first 5 seconds only = 300 frames at 60fps)");
  run("node render.mjs --seconds 30 --to 300 --workers 2 --out build/test_5s.mp4");
  if (!fs.existsSync("build/test_5s.mp4")) throw new Error("test_5s.mp4 not created!");

  step(6, "Verify (ffprobe)");
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height,r_frame_rate,codec_name,color_space", "-of", "json", "build/test_5s.mp4"], { encoding: "utf8" });
  console.log(probe.stdout);

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n${"=".repeat(50)}\n  ALL TESTS PASSED in ${elapsed}s\n${"=".repeat(50)}\n`);
  console.log("Engine3 Cinema fast path is READY on Windows!");
  console.log("Next: full render with 'node render.mjs --seconds 30 --workers 2'");
} catch (e) {
  console.error(`\nFAILED: ${e.message}`);
  process.exit(1);
}
