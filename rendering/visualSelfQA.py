#!/usr/bin/env python3
"""
Visual Self-QA gate. Samples a key frame every 2 s of the rendered MP4 and checks:
  1) SAFE MARGIN   - no text/UI content intrudes into the 60 px padding band (9:16 and 16:9)
  2) READABILITY   - every detected text region has WCAG contrast >= 3:1 (no white-on-white / black-on-black)
  3) PALETTE       - generated compositions only use White / Carbon Black / Signal Red (+glow) (+ the simulator's success-green)
On a safe-zone failure it logs the exact scene id and writes an auto-fix (scene.typeScale *= 0.9, min 0.7) to --fix-out.
Exit code: 0 pass, 1 fail. Deterministic: no randomness, pure numpy/scipy.
"""
import argparse, json, os, re, subprocess, sys, tempfile
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

PAL_OK_HUES = None  # red hue band handled in code
ALLOWED_GREEN = {"#16a34a", "#16A34A"}

def luma(a):  # a: HxWx3 float 0..1 (sRGB-encoded)
    return 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]

def rel_lum(a):  # WCAG relative luminance
    lin = np.where(a <= 0.03928, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)
    return 0.2126 * lin[..., 0] + 0.7152 * lin[..., 1] + 0.0722 * lin[..., 2]

def ratio(l1, l2):
    hi, lo = max(l1, l2), min(l1, l2)
    return (hi + 0.05) / (lo + 0.05)

def otsu(v):
    hist, edges = np.histogram(v, bins=64)
    w0 = np.cumsum(hist); w1 = w0[-1] - w0
    m = np.cumsum(hist * (edges[:-1] + edges[1:]) / 2)
    mu0 = m / np.maximum(w0, 1); mu1 = (m[-1] - m) / np.maximum(w1, 1)
    k = int(np.argmax(w0 * w1 * (mu0 - mu1) ** 2))
    return (edges[k] + edges[k + 1]) / 2

def analyze(img, margin, detail_strong=0.14, detail_text=0.025, skip=()):
    a = np.asarray(img.convert("RGB"), dtype=np.float32) / 255.0
    H, W = a.shape[:2]; L = luma(a)
    detail = np.abs(L - ndi.gaussian_filter(L, 10))
    open3 = np.ones((3, 3), bool)
    strong = ndi.binary_opening(detail > detail_strong, open3)
    band = np.ones((H, W), bool); band[margin:H - margin, margin:W - margin] = False
    lab, n = ndi.label(strong & band)
    margin_fail = []
    for i, sl in enumerate(ndi.find_objects(lab), start=1):
        area = int((lab[sl] == i).sum())
        if area >= 50:
            margin_fail.append({"bbox": [int(sl[1].start), int(sl[0].start), int(sl[1].stop), int(sl[0].stop)], "area": area})
    # readability
    txt = ndi.binary_opening(detail > detail_text, open3)
    grown = ndi.binary_dilation(txt, iterations=6)
    lab2, n2 = ndi.label(grown)
    RL = rel_lum(a); contrast_fail = []; checked = 0
    for i, sl in enumerate(ndi.find_objects(lab2), start=1):
        y0, y1, x0, x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
        h, w = y1 - y0, x1 - x0
        if h < 16 or h > 420 or w < 16 or w > W * 0.98: continue
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        if any(a0 <= cx <= a1 and b0 <= cy <= b1 for a0, b0, a1, b1 in skip): continue   # decorative 3D anchor cube is a graphic, not text
        reg = lab2[sl] == i; core = txt[sl] & reg
        if int(core.sum()) < 150 or core.sum() / (h * w) < 0.08: continue     # not text-like (soft gradient / sparse contour)
        rl = RL[sl]; near = ndi.binary_dilation(core, iterations=4)
        bgpix = rl[~near]
        if bgpix.size < 0.1 * rl.size: bgpix = rl[~core]
        if bgpix.size < 40: continue
        bg = float(np.median(bgpix)); dist = np.abs(rl[core] - bg)
        fgpix = rl[core][dist >= np.percentile(dist, 85)]
        checked += 1; r = ratio(float(np.median(fgpix)), bg)
        if r < 3.0: contrast_fail.append({"bbox": [int(x0), int(y0), int(x1), int(y1)], "ratio": round(r, 2)})
    return margin_fail, contrast_fail, checked

def palette_audit(project):
    bad = {}
    comp = os.path.join(project, "compositions")
    if not os.path.isdir(comp): return bad
    for f in sorted(os.listdir(comp)):
        s = open(os.path.join(comp, f), encoding="utf8").read()
        for m in re.finditer(r"#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b", s):
            h = m.group(1); h = h if len(h) == 6 else "".join(c * 2 for c in h)
            r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4)); mx, mn = max(r, g, b), min(r, g, b)
            if mx - mn < 28: continue                       # neutral (white/black/grey)
            if r > g + 40 and r > b + 40: continue          # red family
            if ("#" + h).lower() in {x.lower() for x in ALLOWED_GREEN}: continue
            bad.setdefault(f, set()).add("#" + h)
    return {k: sorted(v) for k, v in bad.items()}

STAGE = {"9:16": (72, 270, 936, 1050), "16:9": (110, 90, 1700, 740)}
def skip_boxes(g):
    ar = g.get("aspectRatio", "9:16"); sx, sy, sw, sh = STAGE[ar]; out = []
    for sc in g["scenes"]:
        for e in sc.get("entities", []):
            if e["kind"] == "anchor_core":
                r = e["placement"][ar]; out.append((sx + r["x"] * sw, sy + r["y"] * sh, sx + (r["x"] + r["w"]) * sw, sy + (r["y"] + r["h"]) * sh))
    return list(dict.fromkeys(out))

def scene_at(scenes, frame):
    for s in scenes:
        if s["startFrame"] <= frame < s["endFrame"]: return s
    return scenes[-1]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video"); ap.add_argument("--scene", required=True); ap.add_argument("--out", required=True)
    ap.add_argument("--every", type=float, default=2.0); ap.add_argument("--margin", type=int, default=60)
    ap.add_argument("--fix-out"); ap.add_argument("--project"); ap.add_argument("--frames-dir", help="analyse existing PNGs t<sec>.png instead of --video")
    a = ap.parse_args()
    g = json.load(open(a.scene)); fps = g["fps"]; scenes = g["scenes"]; dur = g["durationFrames"] / fps
    frames = []  # (t, PIL image)
    if a.frames_dir:
        for f in sorted(os.listdir(a.frames_dir)):
            m = re.match(r"t([\d.]+)\.png$", f)
            if m: frames.append((float(m.group(1)), Image.open(os.path.join(a.frames_dir, f))))
    else:
        t = a.every / 2.0
        with tempfile.TemporaryDirectory() as td:
            while t < dur - 0.05:
                p = os.path.join(td, f"t{t:.2f}.png")
                subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{t:.3f}", "-i", a.video, "-frames:v", "1", p], check=True)
                frames.append((t, Image.open(p).copy())); t += a.every
    report = {"every": a.every, "margin": a.margin, "frames": [], "ok": True}
    fails = {}
    for t, img in frames:
        mf, cf, n = analyze(img, a.margin, skip=skip_boxes(g))
        sc = scene_at(scenes, int(round(t * fps)))
        e = {"t": round(t, 2), "scene": sc["id"], "theme": sc.get("theme"), "textRegions": n, "marginViolations": mf, "contrastFailures": cf, "ok": not mf and not cf}
        report["frames"].append(e)
        if mf: fails[sc["id"]] = max(fails.get(sc["id"], 0), 1)
        if not e["ok"]: report["ok"] = False
    report["failedScenes"] = sorted({f["scene"] for f in report["frames"] if f["marginViolations"]})
    report["lowContrastScenes"] = sorted({f["scene"] for f in report["frames"] if f["contrastFailures"]})
    report["palette"] = palette_audit(a.project) if a.project else {}
    if report["palette"]: report["ok"] = False
    fixes = {}
    for sid in report["failedScenes"]:
        cur = next(s for s in scenes if s["id"] == sid).get("typeScale", 1.0)
        fixes[sid] = round(max(0.7, cur * 0.9), 3)
        print(f"[visualSelfQA] SAFE-ZONE FAIL scene={sid}: auto-adjust typeScale {cur} -> {fixes[sid]}")
    if a.fix_out: json.dump(fixes, open(a.fix_out, "w"), indent=1)
    json.dump(report, open(a.out, "w"), indent=1)
    nfail = sum(1 for f in report["frames"] if not f["ok"])
    print(f"[visualSelfQA] frames={len(report['frames'])} failing={nfail} safeZoneScenes={report['failedScenes']} lowContrastScenes={report['lowContrastScenes']} paletteViolations={len(report['palette'])}")
    sys.exit(0 if report["ok"] else 1)
if __name__ == "__main__": main()
