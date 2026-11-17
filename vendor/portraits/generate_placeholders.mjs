import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const portraits = [
  { name: "jensen_huang", initials: "JH", color: "#76B900" },   // NVIDIA green
  { name: "elon_musk", initials: "EM", color: "#000000" },      // Tesla black
  { name: "sam_altman", initials: "SA", color: "#000000" },     // OpenAI black
  { name: "satya_nadella", initials: "SN", color: "#00A4EF" },  // Microsoft blue
  { name: "mark_zuckerberg", initials: "MZ", color: "#1877F2" }, // Meta blue
];

const dir = path.join(import.meta.dirname);
const size = 1000;

(async () => {
  for (const p of portraits) {
    const out = path.join(dir, p.name + ".png");
    await sharp({
      create: {
        width: size, height: size,
        channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([
        {
          input: Buffer.from(
            `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="g" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${p.color}" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="${p.color}" stop-opacity="0.6"/>
    </radialGradient>
  </defs>
  <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 10}" fill="url(#g)"/>
  <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="Inter,DejaVu Sans,sans-serif" font-size="${size * 0.35}" font-weight="800" fill="white" letter-spacing="2">${p.initials}</text>
</svg>`
          ),
          top: 0, left: 0,
        },
      ])
      .png()
      .toFile(out);
    console.log("Created", out);
  }
  console.log("Done");
})();
