import { createManifestStore } from "../../production/manifest.js";
import { PIPELINE_STAGES } from "../../production/manifest.js";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) { if (cond) { passed++; console.log(`  PASS: ${msg}`); } else { failed++; console.error(`  FAIL: ${msg}`); } }

async function main() {
  const root = process.cwd();
  const store = createManifestStore("test-manifest-001", "Test Manifest", root, "9:16", "white-editorial", 60);

  // Test 1: Manifest creation
  const m = store.loadOrCreate({ projectId: "test-manifest-001", name: "Test Manifest", aspectRatio: "9:16", theme: "white-editorial", fps: 60, rootDir: root });
  assert(!!m.projectId, "manifest has projectId");
  assert(!!m.gates && m.gates.length === PIPELINE_STAGES.length, `manifest has ${PIPELINE_STAGES.length} gates`);
  assert(m.currentStage === "research", "starts at research stage");
  assert(m.completedStages.length === 0, "no completed stages initially");
  assert(m.resumeToken !== null, "has resume token");

  // Test 2: Gate advancement
  store.advanceGate(m, "research", "passed", { sources: 3 });
  assert(m.completedStages.includes("research"), "research stage completed");
  assert(m.currentStage === "script", "advanced to script stage");
  const researchGate = m.gates.find(g => g.stage === "research");
  assert(researchGate?.status === "passed", "research gate passed");
  assert(researchGate?.evidence?.sources === 3, "evidence recorded");

  // Test 3: Gates passed through
  assert(store.gatesPassedThrough(m, "research") === true, "gates passed through research");
  assert(store.gatesPassedThrough(m, "script") === false, "gates NOT passed through script");

  // Test 4: Validate render readiness
  const readiness = store.validateRenderReadiness(m);
  assert(readiness.ok === false, "not render-ready without full pipeline");
  assert(readiness.missing.length > 0, "has missing items");

  // Test 5: Resume token
  const token1 = m.resumeToken;
  store.save(m);
  const m2 = store.get();
  assert(m2.resumeToken === token1, "resume token persists");

  // Test 6: Manifest persistence
  assert(fs.existsSync(path.join(root, "projects", "test-manifest-001", "manifest.json")), "manifest file exists");

  console.log(`\nManifest tests: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

import fs from "node:fs";
import path from "node:path";
main();
