#!/usr/bin/env tsx
/**
 * Production Orchestrator CLI
 *
 * Usage:
 *   npx tsx production/cli.ts --project nvidia-news --script demo/nvidia-news/script.txt --ratio 9:16 --theme white-editorial --auto-approve
 *
 * Options:
 *   --project       Project ID (required)
 *   --name          Project display name (defaults to project ID)
 *   --script        Script file path (required for new projects)
 *   --script-content  Inline script text (alternative to --script)
 *   --ratio         Aspect ratio: 9:16 or 16:9 (default: 9:16)
 *   --theme         Theme: white-editorial or dark-cinematic (default: white-editorial)
 *   --fps           Frames per second: 24, 30, 60 (default: 60)
 *   --root          Root directory (default: .)
 *   --voice         Kokoro voice name
 *   --images        User images directory for rembg cutouts
 *   --resume        Resume token for crash-resume
 *   --skip-approval Skip human approval gate (auto-approve)
 *   --from          Start from a specific pipeline stage
 *   --approve       Approve a pending item (requires --item-id and --reviewer)
 *   --reject        Reject a pending item (requires --item-id and --reviewer)
 *   --item-id       Item ID for approval/rejection
 *   --reviewer      Reviewer name
 *   --notes         Review notes
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { ProductionOrchestrator } from "./orchestrator.js";

const { values: v } = parseArgs({ options: {
  project: { type: "string" },
  name: { type: "string" },
  script: { type: "string" },
  "script-content": { type: "string" },
  ratio: { type: "string", default: "9:16" },
  theme: { type: "string", default: "white-editorial" },
  fps: { type: "string", default: "60" },
  root: { type: "string", default: "." },
  voice: { type: "string" },
  images: { type: "string" },
  resume: { type: "string" },
  "skip-approval": { type: "boolean", default: false },
  from: { type: "string" },
  approve: { type: "boolean", default: false },
  reject: { type: "boolean", default: false },
  "item-id": { type: "string" },
  reviewer: { type: "string" },
  notes: { type: "string", default: "" },
} });

const fail = (m: string): never => { console.error("ERROR: " + m); process.exit(2); };

if (!v.project) fail("--project <id> required");

const rootDir = path.resolve(v.root!);
const fps = +v.fps! as 24 | 30 | 60;
if (!["9:16", "16:9"].includes(v.ratio!)) fail("--ratio must be 9:16 or 16:9");
if (!["24", "30", "60"].includes(v.fps!)) fail("--fps must be 24, 30, or 60");

let scriptContent: string | undefined;
if (v["script-content"]) scriptContent = v["script-content"];
if (v.script) {
  if (!fs.existsSync(v.script)) fail(`Script file not found: ${v.script}`);
  scriptContent = fs.readFileSync(v.script, "utf8");
}

const orchestrator = new ProductionOrchestrator({
  projectId: v.project!,
  name: v.name ?? v.project!,
  scriptPath: v.script ? path.resolve(v.script) : undefined,
  scriptContent,
  aspectRatio: v.ratio as "9:16" | "16:9",
  theme: v.theme!,
  fps,
  rootDir,
  voice: v.voice,
  imagesDir: v.images ? path.resolve(v.images) : undefined,
  skipHumanApproval: v["skip-approval"],
  resumeToken: v.resume,
}, (msg: string) => console.log(`[pipeline] ${msg}`));

// Handle approval/rejection commands
if (v.approve || v.reject) {
  if (!v["item-id"]) fail("--item-id required for approval/rejection");
  if (!v.reviewer) fail("--reviewer required for approval/rejection");
  const ok = v.approve
    ? orchestrator.approveItem(v["item-id"]!, v.reviewer!, v.notes!)
    : orchestrator.rejectItem(v["item-id"]!, v.reviewer!, v.notes!);
  console.log(ok ? `${v.approve ? "Approved" : "Rejected"}: ${v["item-id"]}` : `Item not found: ${v["item-id"]}`);
  process.exit(ok ? 0 : 1);
}

// Run the pipeline
const result = await orchestrator.run(v.from as any);
if (result.ok) {
  console.log(`\n✅ Pipeline complete. Output: ${result.finalOutput ?? "(no video output)"}`);
  process.exit(0);
} else {
  console.log(`\n❌ Pipeline failed at stage: ${orchestrator.getManifest().currentStage}`);
  process.exit(1);
}
