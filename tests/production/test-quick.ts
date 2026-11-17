import fs from "node:fs";
import path from "node:path";
import { ProductionOrchestrator } from "../../production/orchestrator.js";

async function main() {
  const root = process.cwd();
  const scriptPath = path.join(root, "demo", "nvidia-news", "script.txt");

  const orch = new ProductionOrchestrator({
    projectId: "test-quick-001",
    name: "Quick Test",
    scriptPath,
    aspectRatio: "9:16",
    theme: "white-editorial",
    fps: 60,
    rootDir: root,
    skipHumanApproval: true,
  }, (msg: string) => console.log(`  [${msg}]`));

  // Run only up to storyboard
  const result = await orch.run("research");
  console.log("Result:", result.ok ? "OK" : "FAILED");
  console.log("Completed:", orch.getManifest().completedStages.join(", "));
  console.log("Current stage:", orch.getManifest().currentStage);
  if (!result.ok) console.log("Error:", result.manifest.gates.find(g => g.status === "failed")?.error);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
