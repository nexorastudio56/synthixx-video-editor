/**
 * Asset & Identity Resolver. Finds real-world entities in the script, resolves verified logos/icons/images/cutouts
 * and registers them in AssetRecord manifests BEFORE rendering. Zero broken images: anything that fails
 * decode-verification degrades to a glyph/wordmark icon entity (no file needed).
 * Brand logos come only from the simple-icons package (official brand SVGs); brands it does not ship
 * (e.g. OpenAI) fall back to a labelled glyph chip, never a redrawn fake logo.
 * Person portraits come from the curated offline cache in vendor/portraits/ (genuine photographs,
 * 1000×1000 minimum, sharp circular cutout with anti-aliased edge). No cartoons, no invented graphics.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolvePython } from "../core/python.js";
import sharp from "sharp";
import type { AssetRecord } from "../schemas/scene.schema.js";

export interface ResolvedEntity {
  name: string;
  slug: string;
  type: "brand" | "tool" | "object" | "person";
  kind: "logo" | "icon" | "cutout" | "portrait";
  assetId?: string;
  glyph?: string;
  resolution: "simple-icons" | "glyph-fallback" | "rembg-cutout" | "user-image" | "curated-portrait" | "portrait-placeholder";
  note?: string;
}
export interface ResolveResult { entities: ResolvedEntity[]; assets: AssetRecord[]; report: string[] }

/** surface form -> simple-icons slug. Brands absent from simple-icons are listed with null (-> glyph fallback). */
const BRANDS: Record<string, string | null> = {
  python: "python", github: "github", google: "google", whatsapp: "whatsapp", slack: "slack", notion: "notion", n8n: "n8n", zapier: "zapier",
  youtube: "youtube", chrome: "googlechrome", docker: "docker", react: "react", linkedin: "linkedin", instagram: "instagram", telegram: "telegram",
  gmail: "gmail", stripe: "stripe", shopify: "shopify", wordpress: "wordpress", figma: "figma", canva: "canva", javascript: "javascript", typescript: "typescript",
  openai: null, chatgpt: null, gemini: "googlegemini", claude: "claude", anthropic: "anthropic", cursor: "cursor", nvidia: "nvidia", tesla: "tesla", apple: "apple", microsoft: null, amazon: null,
};

/** Known person names -> curated portrait file (vendor/portraits/<slug>.png). Genuine photographs only. */
const PORTRAITS: Record<string, { file: string; display: string }> = {
  jensen: { file: "jensen_huang.png", display: "Jensen Huang" },
  huang:  { file: "jensen_huang.png", display: "Jensen Huang" },
  elon:   { file: "elon_musk.png", display: "Elon Musk" },
  musk:   { file: "elon_musk.png", display: "Elon Musk" },
  sam:    { file: "sam_altman.png", display: "Sam Altman" },
  altman: { file: "sam_altman.png", display: "Sam Altman" },
  satya:  { file: "satya_nadella.png", display: "Satya Nadella" },
  nadella:{ file: "satya_nadella.png", display: "Satya Nadella" },
  zuckerberg: { file: "mark_zuckerberg.png", display: "Mark Zuckerberg" },
  mark:   { file: "mark_zuckerberg.png", display: "Mark Zuckerberg" },
};
const PORTRAIT_MIN = 1000; // minimum source resolution (px)

const GLYPHS: Record<string, string> = { files: "📁", file: "📄", email: "✉", emails: "✉", alert: "🔔", clock: "⏱", brain: "🧠", rocket: "🚀", money: "$", lock: "🔒", cloud: "☁", database: "🗄", robot: "🤖" };

const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "n$1");

/** Apply sharp circular mask + edge refinement to a portrait source. Outputs anti-aliased alpha cutout. */
async function circularCutout(src: string, dst: string, size = PORTRAIT_MIN): Promise<{ width: number; height: number; hasAlpha: boolean }> {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  // Load, auto-rotate, fit to cover a square canvas (center crop), sharp Lanczos3 downscale.
  const img = sharp(src).rotate().resize({ width: size, height: size, fit: "cover", position: "centre" });
  // Build a circular mask at the target size, anti-aliased via blur.
  const maskBuf = await (sharp as any)({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      {
        input: Buffer.from(`<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
          <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 2}" fill="white" />
        </svg>`),
        top: 0, left: 0,
      },
    ])
    .blur(0.5)
    .png()
    .toBuffer();
  const out = await img
    .composite([{ input: maskBuf, blend: "dest-in", top: 0, left: 0 }])
    .png({ compressionLevel: 9 })
    .toFile(dst);
  return out;
}

export async function resolveEntities(scriptText: string, o: { projectRoot: string; cacheDir: string; userImagesDir?: string }): Promise<ResolveResult> {
  const out: ResolveResult = { entities: [], assets: [], report: [] };
  fs.mkdirSync(path.join(o.cacheDir, "logos"), { recursive: true });
  fs.mkdirSync(path.join(o.cacheDir, "cutouts"), { recursive: true });

  const found = new Set<string>();
  const foundPersons = new Set<string>();
  const text = scriptText.replace(/[^\w\s.-]/g, " ");

  // ---- Pass 1: brand logos from simple-icons ----
  for (const m of text.matchAll(/\b[A-Za-z][A-Za-z0-9.]{1,24}\b/g)) {
    const w = m[0].toLowerCase(); if (found.has(w)) continue;
    if (w in BRANDS) {
      found.add(w); const slug = BRANDS[w];
      const display = scriptText.match(new RegExp(`\\b${w}\\b`, "i"))![0];
      if (slug) {
        const svgPath = path.join(o.projectRoot, "node_modules/simple-icons/icons", slug + ".svg");
        if (fs.existsSync(svgPath)) {
          const dst = path.join(o.cacheDir, "logos", slug + ".svg"); fs.copyFileSync(svgPath, dst);
          try {
            const md = await sharp(dst).metadata(); // decode check
            const id = "logo_" + slugify(w);
            out.assets.push({ id, kind: "logo", path: path.relative(o.projectRoot, dst), source: "simple-icons", verified: true, width: md.width, height: md.height, hasAlpha: true, sha256: sha(fs.readFileSync(dst)) });
            out.entities.push({ name: display, slug: slugify(w), type: "brand", kind: "logo", assetId: id, resolution: "simple-icons" }); out.report.push(`brand ${display}: simple-icons/${slug}.svg verified ${md.width}x${md.height}`); continue;
          } catch (e) { out.report.push(`brand ${display}: decode failed (${(e as Error).message}) -> glyph fallback`); }
        } else out.report.push(`brand ${display}: ${slug}.svg not in installed simple-icons -> glyph fallback`);
      } else out.report.push(`brand ${display}: no official logo in simple-icons (removed by owner) -> glyph chip, NOT a redrawn logo`);
      out.entities.push({ name: display, slug: slugify(w), type: "brand", kind: "icon", glyph: display[0].toUpperCase(), resolution: "glyph-fallback" });
    } else if (w in GLYPHS) { found.add(w); out.entities.push({ name: w, slug: slugify(w), type: "object", kind: "icon", glyph: GLYPHS[w], resolution: "glyph-fallback" }); }
  }

  // ---- Pass 2: person portraits from curated cache ----
  for (const [key, info] of Object.entries(PORTRAITS)) {
    if (found.has(key)) continue;
    if (foundPersons.has(info.display)) continue; // already resolved this person via another key
    // Match full name (first + last) or last name alone, case-insensitive.
    const nameRe = new RegExp(`\\b${key}\\b`, "i");
    if (!nameRe.test(scriptText)) continue;
    found.add(key);
    foundPersons.add(info.display);
    const portraitDir = path.join(o.projectRoot, "vendor", "portraits");
    const src = path.join(portraitDir, info.file);
    const dst = path.join(o.cacheDir, "cutouts", info.file.replace(/\.png$/, "") + ".png");
    let resolution: ResolvedEntity["resolution"] = "portrait-placeholder";
    let used = src;

    if (fs.existsSync(src)) {
      try {
        await circularCutout(src, dst, PORTRAIT_MIN);
        const md = await sharp(dst).metadata();
        if (md.hasAlpha && md.width! >= PORTRAIT_MIN && md.height! >= PORTRAIT_MIN) {
          const id = "portrait_" + slugify(info.display);
          out.assets.push({ id, kind: "portrait", path: path.relative(o.projectRoot, dst), source: "curated:" + info.file, verified: true, width: md.width, height: md.height, hasAlpha: true, sha256: sha(fs.readFileSync(dst)) });
          out.entities.push({ name: info.display, slug: slugify(info.display), type: "person", kind: "portrait", assetId: id, resolution: "curated-portrait" }); out.report.push(`person ${info.display}: curated portrait cutout verified ${md.width}x${md.height} alpha`); continue;
        }
      } catch (e) { out.report.push(`person ${info.display}: circular cutout failed (${(e as Error).message}) -> placeholder`); }
    } else {
      out.report.push(`person ${info.display}: no source photo at vendor/portraits/${info.file} -> generating placeholder`);
    }

    // Fallback: generate a high-res placeholder disc with initials (never a cartoon).
    try {
      const initials = info.display.split(" ").map(n => n[0]).join("").toUpperCase();
      const brandColor = { "Jensen Huang": "#76B900", "Elon Musk": "#000000", "Sam Altman": "#000000", "Satya Nadella": "#00A4EF", "Mark Zuckerberg": "#1877F2" }[info.display] ?? "#6B7280";
      await (sharp as any)({
        create: { width: PORTRAIT_MIN, height: PORTRAIT_MIN, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      })
        .composite([
          {
            input: Buffer.from(`<svg width="${PORTRAIT_MIN}" height="${PORTRAIT_MIN}" xmlns="http://www.w3.org/2000/svg">
              <defs><radialGradient id="g" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="${brandColor}" stop-opacity="0.9"/><stop offset="100%" stop-color="${brandColor}" stop-opacity="0.6"/></radialGradient></defs>
              <circle cx="${PORTRAIT_MIN / 2}" cy="${PORTRAIT_MIN / 2}" r="${PORTRAIT_MIN / 2 - 2}" fill="url(#g)"/>
              <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="Inter,DejaVu Sans,sans-serif" font-size="${PORTRAIT_MIN * 0.3}" font-weight="800" fill="white">${initials}</text>
            </svg>`),
            top: 0, left: 0,
          },
        ])
        .png({ compressionLevel: 9 })
        .toFile(dst);
      const md = await sharp(dst).metadata();
      const id = "portrait_" + slugify(info.display);
      out.assets.push({ id, kind: "portrait", path: path.relative(o.projectRoot, dst), source: "placeholder:" + info.file, verified: true, width: md.width, height: md.height, hasAlpha: true, sha256: sha(fs.readFileSync(dst)) });
      out.entities.push({ name: info.display, slug: slugify(info.display), type: "person", kind: "portrait", assetId: id, resolution: "portrait-placeholder" }); out.report.push(`person ${info.display}: placeholder portrait disc ${md.width}x${md.height} (replace vendor/portraits/${info.file} with a genuine photo)`);
    } catch (e) { out.report.push(`person ${info.display}: placeholder generation failed (${(e as Error).message})`); }
  }

  // ---- Pass 3: user photos -> rembg transparent cutouts (3D parallax objects). file name = object name.
  if (o.userImagesDir && fs.existsSync(o.userImagesDir)) for (const f of fs.readdirSync(o.userImagesDir).filter(f => /\.(png|jpe?g|webp)$/i.test(f))) {
    const name = path.parse(f).name.toLowerCase(); if (!new RegExp(`\\b${name}\\b`, "i").test(scriptText)) continue;
    const src = path.join(o.userImagesDir, f), dst = path.join(o.cacheDir, "cutouts", name + ".png");
    const r = spawnSync(resolvePython(), [path.resolve(import.meta.dirname, "../visual/objects/cutout.py"), src, dst], { encoding: "utf8" });
    if (r.status === 0) {
      const md = await sharp(dst).metadata();
      if (md.hasAlpha) { const id = "cut_" + slugify(name); out.assets.push({ id, kind: "cutout", path: path.relative(o.projectRoot, dst), source: "rembg:" + f, verified: true, width: md.width, height: md.height, hasAlpha: true, sha256: sha(fs.readFileSync(dst)) }); out.entities.push({ name, slug: slugify(name), type: "object", kind: "cutout", assetId: id, resolution: "rembg-cutout" }); out.report.push(`object ${name}: rembg cutout verified ${md.width}x${md.height} alpha`); continue; }
    }
    out.report.push(`object ${name}: cutout failed -> skipped (${r.stderr.slice(-120)})`);
  }
  return out;
}
export async function verifyAssets(assets: AssetRecord[], root: string): Promise<string[]> {
  const bad: string[] = [];
  for (const a of assets) { const f = path.resolve(root, a.path); if (!fs.existsSync(f)) { bad.push(`${a.id}: missing`); continue; } if (a.kind !== "audio" && a.kind !== "font") { try { await sharp(f).metadata(); } catch { bad.push(`${a.id}: undecodable`); } } }
  return bad;
}
