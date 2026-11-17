# Synthixx Production Pipeline — Architecture & Usage Guide

## Overview

The Synthixx Production Pipeline is a central, stateful orchestrator that drives
every video through 13 explicit stages with validation gates, retry handling,
checkpoints, and resumable execution.

## Pipeline Stages

| # | Stage | Description |
|---|-------|-------------|
| 1 | `research` | Research and fact verification |
| 2 | `script` | English script generation/import |
| 3 | `entity-detection` | Semantic and entity detection |
| 4 | `asset-discovery` | Authentic asset research and collection |
| 5 | `asset-preparation` | AI-generated asset preparation & verification |
| 6 | `storyboard` | Visual and technical storyboard generation |
| 7 | `scene-planning` | Production timeline preparation (Scene Graph) |
| 8 | `voice-sync` | Voiceover synchronization |
| 9 | `motion-design` | Scene-specific motion design |
| 10 | `render` | Automated rendering (single-pass lossless) |
| 11 | `qa` | Automated quality control |
| 12 | `approval` | Human approval gate |
| 13 | `publish` | Final output publication |

## Project Manifest

Every video has a persistent `manifest.json` in `projects/<project-id>/` containing:
- **Research**: sources, facts, verification status
- **Script**: content, word count, duration, source type
- **Entities**: detected people, companies, technologies
- **Assets**: source URLs, licenses, attribution, download status, SHA-256 hashes
- **Storyboard**: visual (Markdown) and technical (JSON) storyboard paths
- **Scene Plan**: full Scene Graph JSON
- **Approvals**: human review records
- **Render**: output path, resolution, fps, codec, QA status
- **Checkpoints**: resume tokens for crash-resume

## Usage

### Create and run a new project
```powershell
cd engine3
npx tsx production/cli.ts --project nvidia-news --script demo/nvidia-news/script.txt --ratio 9:16 --theme white-editorial --skip-approval
```

### Resume a paused project
```powershell
npx tsx production/cli.ts --project nvidia-news --resume <resume-token>
```

### Approve a pending item
```powershell
npx tsx production/cli.ts --project nvidia-news --approve --item-id nvidia-news --reviewer "admin" --notes "Looks good"
```

### Reject a pending item
```powershell
npx tsx production/cli.ts --project nvidia-news --reject --item-id nvidia-news --reviewer "admin" --notes "Needs revision"
```

### Start from a specific stage
```powershell
npx tsx production/cli.ts --project nvidia-news --from storyboard --skip-approval
```

## Asset Discovery & Download

Assets are catalogued with:
- `sourceUrl`: origin URL (or `local://` for offline assets)
- `license`: license type (if known)
- `attribution`: source attribution
- `downloadStatus`: `pending | downloading | verified | failed | skipped`
- `sha256`: file hash for integrity verification
- `isAuthentic`: true for real photos/logos, false for AI-generated
- `isAiGenerated`: true if AI-generated

### Asset Types
- **Portrait**: Curated photos of people (Jensen Huang, Elon Musk, etc.) from `vendor/portraits/`
- **Logo**: Official brand SVGs from `simple-icons` package
- **Icon**: Glyph fallbacks for brands not in simple-icons
- **Cutout**: User-provided images processed via rembg

## Storyboard System

### Visual Storyboard (`storyboard/visual_storyboard.md`)
Human-readable Markdown with:
- Scene-by-scene narration
- Visual descriptions
- Camera movement notes
- Lighting notes
- Audio design notes
- Entity feature list

### Technical Storyboard (`storyboard/technical_storyboard.json`)
Machine-readable JSON with:
- Scene IDs, start/end frames
- Entity placements
- Camera movement specs
- Audio event specs
- Frame counts and timing

## Validation Gates

Each stage has a validation gate that must pass before proceeding:
- **Research**: At least one source found
- **Script**: Script content provided (min 3 words)
- **Entity Detection**: Entities resolved from script
- **Asset Discovery**: Assets catalogued
- **Asset Preparation**: All assets decode-verified
- **Storyboard**: Visual + technical storyboards generated
- **Scene Planning**: Scene Graph generated and validated
- **Voice Sync**: Word timings extracted
- **Motion Design**: Motion specs generated
- **Render**: Output file exists and probe-verified
- **QA**: All QA checks pass
- **Approval**: Human approval (or auto-approved)
- **Publish**: Final output copied to publish directory

## Retry Handling

Each gate allows up to 3 attempts. On failure:
1. Error is logged to the manifest
2. Gate status set to "failed"
3. Orchestrator retries the stage (up to maxAttempts)
4. After maxAttempts, pipeline halts with error

## Crash Resume

The orchestrator writes checkpoints after each stage. To resume:
1. Use `--resume <token>` with the resume token from the previous run
2. Or simply re-run the same command - the manifest is loaded from disk
3. The orchestrator skips completed stages and resumes from the current one

## Real Assets Only Policy

- **Portraits**: Genuine photographs only (Jensen Huang, Elon Musk, Sam Altman, Satya Nadella, Mark Zuckerberg)
- **Logos**: Official brand SVGs from `simple-icons` package
- **No cartoons or invented graphics**
- **AI-generated assets are clearly marked** (`isAiGenerated: true`)
- **Generated visuals are never misrepresented as authentic footage**

## Testing

```powershell
# Run manifest tests
npx tsx tests/production/test-manifest.ts

# Run orchestrator tests
npx tsx tests/production/test-orchestrator.ts

# Run all existing tests
npm run test:phase0
npm run test:phase1
npm run test:phase2
npm run test:phase3

# Type check
npm run typecheck
```

## NVIDIA Demo Project

A complete NVIDIA-style technology-news demonstration project is available at:
- `demo/nvidia-news/script.txt` - 12-paragraph script covering Nvidia, Jensen Huang, Elon Musk, Sam Altman, Satya Nadella
- Run with: `npx tsx production/cli.ts --project nvidia-news --script demo/nvidia-news/script.txt --ratio 9:16 --theme white-editorial --skip-approval`
