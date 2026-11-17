/**
 * Project Manifest - Persistent production state for every video.
 *
 * Every video must have a persistent project manifest containing its research,
 * script, assets, storyboard, scene plans, approvals and rendering status.
 * The manifest is the single source of truth for the production orchestrator
 * and enables crash-resume (checkpoint) execution.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { SceneGraph } from "../schemas/scene.schema.js";
import type { BrandThemeTokens } from "../styles/themeSchema.js";

export const PIPELINE_STAGES = [
  "research",
  "script",
  "entity-detection",
  "asset-discovery",
  "asset-preparation",
  "storyboard",
  "scene-planning",
  "voice-sync",
  "motion-design",
  "render",
  "qa",
  "approval",
  "publish",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export interface PipelineGate {
  stage: PipelineStage;
  status: "pending" | "in-progress" | "passed" | "failed" | "skipped" | "blocked";
  startedAt?: number;
  completedAt?: number;
  attempts: number;
  maxAttempts: number;
  error?: string;
  checkpoint?: string; // checkpoint file path for resume
  evidence?: Record<string, unknown>; // gate-specific evidence (urls, hashes, etc.)
}

export interface ResearchRecord {
  topic: string;
  sources: Array<{
    url: string;
    title: string;
    type: "article" | "video" | "documentation" | "press-release" | "social";
    retrievedAt: number;
    credibility: "high" | "medium" | "low";
    facts: string[];
  }>;
  verified: boolean;
  verificationNotes: string;
}

export interface ScriptRecord {
  title: string;
  content: string;
  language: "english" | "urdu" | "mixed";
  wordCount: number;
  estimatedDurationSec: number;
  source: "ai-generated" | "human-written" | "imported";
  researchBacked: boolean;
  factChecked: boolean;
}

export interface EntityRecord {
  name: string;
  type: "person" | "company" | "product" | "technology" | "location" | "brand";
  detectedIn: string[]; // script segments where entity appears
  resolved: boolean;
  resolutionSource: string;
}

export interface AssetRecordManifest {
  id: string;
  name: string;
  type: "portrait" | "logo" | "icon" | "image" | "video" | "audio" | "font";
  sourceUrl: string | null;
  license: string | null;
  attribution: string | null;
  localPath: string | null;
  downloadStatus: "pending" | "downloading" | "verified" | "failed" | "skipped";
  sha256: string | null;
  width: number | null;
  height: number | null;
  hasAlpha: boolean | null;
  isAuthentic: boolean; // true = real photograph/logo, false = AI-generated/placeholder
  isAiGenerated: boolean;
  aiPrompt?: string;
  error?: string;
}

export interface ApprovalRecord {
  item: string; // "asset" | "fact" | "script" | "storyboard"
  itemId: string;
  status: "pending" | "approved" | "rejected" | "needs-review";
  reviewer: string | null;
  reviewedAt: number | null;
  notes: string;
}

export interface RenderStatus {
  status: "not-started" | "in-progress" | "completed" | "failed" | "cancelled";
  outputPath: string | null;
  durationSec: number | null;
  resolution: string | null;
  fps: number | null;
  codec: string | null;
  audioSync: boolean | null;
  qaPassed: boolean | null;
  chunksCompleted: number;
  chunksTotal: number;
  startedAt: number | null;
  completedAt: number | null;
}

export interface ProjectManifest {
  projectId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  version: string;
  aspectRatio: "9:16" | "16:9";
  theme: string;
  fps: number;

  // Pipeline state
  currentStage: PipelineStage;
  gates: PipelineGate[];
  completedStages: PipelineStage[];

  // Production records
  research: ResearchRecord | null;
  script: ScriptRecord | null;
  entities: EntityRecord[];
  assets: AssetRecordManifest[];
  storyboard: { visual: string | null; technical: string | null; scenes: number };
  scenePlan: SceneGraph | null;

  // Approvals
  approvals: ApprovalRecord[];

  // Render
  render: RenderStatus;

  // Checkpoints
  lastCheckpoint: number | null;
  resumeToken: string | null;
}

export interface ManifestOptions {
  projectId: string;
  name: string;
  aspectRatio: "9:16" | "16:9";
  theme: string;
  fps: number;
  rootDir: string;
}

/** Compute a resume token from current manifest state. */
function computeResumeToken(manifest: ProjectManifest): string {
  const payload = JSON.stringify({
    stage: manifest.currentStage,
    completed: manifest.completedStages.sort(),
    gates: manifest.gates.map(g => `${g.stage}:${g.status}`),
    assets: manifest.assets.map(a => `${a.id}:${a.downloadStatus}`),
    approvals: manifest.approvals.map(a => `${a.item}:${a.status}`),
  });
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

export class ProjectManifestStore {
  private readonly dir: string;
  private readonly path: string;

  constructor(o: ManifestOptions) {
    this.dir = path.join(o.rootDir, "projects", o.projectId);
    this.path = path.join(this.dir, "manifest.json");
    fs.mkdirSync(this.dir, { recursive: true });
    fs.mkdirSync(path.join(this.dir, "research"), { recursive: true });
    fs.mkdirSync(path.join(this.dir, "assets"), { recursive: true });
    fs.mkdirSync(path.join(this.dir, "storyboard"), { recursive: true });
    fs.mkdirSync(path.join(this.dir, "render"), { recursive: true });
    fs.mkdirSync(path.join(this.dir, "checkpoints"), { recursive: true });
  }

  /** Load existing manifest or create a new one. */
  loadOrCreate(o: ManifestOptions): ProjectManifest {
    if (fs.existsSync(this.path)) {
      const existing = JSON.parse(fs.readFileSync(this.path, "utf8")) as ProjectManifest;
      // Validate essential fields
      if (existing.projectId && existing.gates && Array.isArray(existing.gates)) {
        existing.updatedAt = Date.now();
        this.save(existing);
        return existing;
      }
    }
    const now = Date.now();
    const initialGates: PipelineGate[] = PIPELINE_STAGES.map(s => ({
      stage: s,
      status: s === "research" ? "pending" : "pending",
      attempts: 0,
      maxAttempts: 3,
    }));
    // Research is the first stage, mark as pending to start
    initialGates[0].status = "pending";
    const manifest: ProjectManifest = {
      projectId: o.projectId,
      name: o.name,
      createdAt: now,
      updatedAt: now,
      version: "1.0.0",
      aspectRatio: o.aspectRatio,
      theme: o.theme,
      fps: o.fps,
      currentStage: "research",
      gates: initialGates,
      completedStages: [],
      research: null,
      script: null,
      entities: [],
      assets: [],
      storyboard: { visual: null, technical: null, scenes: 0 },
      scenePlan: null,
      approvals: [],
      render: {
        status: "not-started",
        outputPath: null,
        durationSec: null,
        resolution: null,
        fps: null,
        codec: null,
        audioSync: null,
        qaPassed: null,
        chunksCompleted: 0,
        chunksTotal: 0,
        startedAt: null,
        completedAt: null,
      },
      lastCheckpoint: null,
      resumeToken: null,
    };
    this.save(manifest);
    return manifest;
  }

  save(manifest: ProjectManifest): void {
    manifest.updatedAt = Date.now();
    manifest.resumeToken = computeResumeToken(manifest);
    fs.writeFileSync(this.path, JSON.stringify(manifest, null, 2));
    // Also write a latest checkpoint
    const cp = path.join(this.dir, "checkpoints", `checkpoint_${manifest.resumeToken}.json`);
    fs.writeFileSync(cp, JSON.stringify(manifest, null, 2));
    manifest.lastCheckpoint = Date.now();
    fs.writeFileSync(this.path, JSON.stringify(manifest, null, 2));
  }

  get(): ProjectManifest {
    return JSON.parse(fs.readFileSync(this.path, "utf8")) as ProjectManifest;
  }

  /** Advance a gate to the next status. Returns the updated manifest. */
  advanceGate(manifest: ProjectManifest, stage: PipelineStage, status: PipelineGate["status"], evidence?: Record<string, unknown>, error?: string): ProjectManifest {
    const gate = manifest.gates.find(g => g.stage === stage);
    if (!gate) throw new Error(`Unknown pipeline stage: ${stage}`);
    gate.status = status;
    gate.attempts += 1;
    if (status === "in-progress" && !gate.startedAt) gate.startedAt = Date.now();
    if (status === "passed" || status === "failed" || status === "blocked") {
      gate.completedAt = Date.now();
    }
    if (evidence) gate.evidence = evidence;
    if (error) gate.error = error;

    if (status === "passed") {
      if (!manifest.completedStages.includes(stage)) {
        manifest.completedStages.push(stage);
      }
      // Auto-advance to next stage if this was the current stage
      if (manifest.currentStage === stage) {
        const nextIndex = PIPELINE_STAGES.indexOf(stage) + 1;
        if (nextIndex < PIPELINE_STAGES.length) {
          manifest.currentStage = PIPELINE_STAGES[nextIndex]!;
          const nextGate = manifest.gates.find(g => g.stage === manifest.currentStage);
          if (nextGate) nextGate.status = "pending";
        }
      }
    }
    this.save(manifest);
    return manifest;
  }

  /** Check if all required gates up to a given stage are passed. */
  gatesPassedThrough(manifest: ProjectManifest, through: PipelineStage): boolean {
    const idx = PIPELINE_STAGES.indexOf(through);
    for (let i = 0; i <= idx; i++) {
      const g = manifest.gates.find(x => x.stage === PIPELINE_STAGES[i]);
      if (!g || g.status !== "passed") return false;
    }
    return true;
  }

  /** Check if the manifest has all required inputs for rendering. */
  validateRenderReadiness(manifest: ProjectManifest): { ok: boolean; missing: string[] } {
    const missing: string[] = [];
    if (!manifest.script) missing.push("script");
    if (!manifest.scenePlan) missing.push("scenePlan");
    if (manifest.assets.length === 0) missing.push("assets (none resolved)");
    if (!this.gatesPassedThrough(manifest, "asset-preparation")) missing.push("asset-preparation gate not passed");
    if (!this.gatesPassedThrough(manifest, "storyboard")) missing.push("storyboard gate not passed");
    if (!this.gatesPassedThrough(manifest, "voice-sync")) missing.push("voice-sync gate not passed");
    return { ok: missing.length === 0, missing };
  }
}

export function createManifestStore(projectId: string, name: string, rootDir: string, aspectRatio: "9:16" | "16:9" = "9:16", theme: string = "white-editorial", fps: number = 60): ProjectManifestStore {
  return new ProjectManifestStore({ projectId, name, aspectRatio, theme, fps, rootDir });
}
