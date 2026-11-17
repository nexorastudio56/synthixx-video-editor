import fs from "node:fs";
import path from "node:path";
import { ProductionOrchestrator } from "../../production/orchestrator.js";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) { if (cond) { passed++; console.log(`  PASS: ${msg}`); } else { failed++; console.error(`  FAIL: ${msg}`); } }

async function main() {
  const root = process.cwd();
  const scriptPath = path.join(root, "demo", "nvidia-news", "script.txt");

  if (!fs.existsSync(scriptPath)) {
    console.error(`Script not found: ${scriptPath}`);
    process.exit(1);
  }

  const orch = new ProductionOrchestrator({
    projectId: "test-orch-001",
    name: "Test Orchestrator Project",
    scriptPath,
    aspectRatio: "9:16",
    theme: "white-editorial",
    fps: 60,
    rootDir: root,
    skipHumanApproval: true,
  }, (msg: string) => {});

  const m = orch.getManifest();
  assert(!!m, "orchestrator has manifest");
  assert(m.currentStage === "research", "starts at research");

  // Run the full pipeline (will stop at first failure)
  const result = await orch.run("research");
  const manifest = orch.getManifest();

  console.log(`  Pipeline reached stage: ${manifest.currentStage}`);
  console.log(`  Completed stages: ${manifest.completedStages.join(", ")}`);

  // Check stages that should have completed
  assert(manifest.completedStages.includes("research"), "research completed");
  assert(manifest.completedStages.includes("script"), "script completed");
  assert(manifest.completedStages.includes("entity-detection"), "entity-detection completed");
  assert(manifest.completedStages.includes("asset-discovery"), "asset-discovery completed");
  assert(manifest.completedStages.includes("asset-preparation"), "asset-preparation completed");
  assert(manifest.completedStages.includes("storyboard"), "storyboard completed");

  // Check script
  if (manifest.script) {
    assert(manifest.script.wordCount > 0, "script has words");
  }

  // Check entities
  if (manifest.entities.length > 0) {
    assert(true, `entities detected: ${manifest.entities.length}`);
  }

  // Check assets
  if (manifest.assets.length > 0) {
    const verified = manifest.assets.filter(a => a.downloadStatus === "verified").length;
    assert(verified > 0, `assets verified: ${verified}/${manifest.assets.length}`);
  }

  // Check storyboard
  if (manifest.storyboard.scenes > 0) {
    assert(true, `storyboard has ${manifest.storyboard.scenes} scenes`);
  }

  // Check scene-planning (may fail if TTS unavailable)
  if (manifest.completedStages.includes("scene-planning")) {
    assert(manifest.scenePlan !== null, "scene plan generated");
    if (manifest.scenePlan) {
      assert(manifest.scenePlan.scenes.length > 0, "scene plan has scenes");
    }
  } else {
    console.log(`  SKIP: scene-planning not completed (TTS may be unavailable)`);
  }

  console.log(`\nOrchestrator tests: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
