import json, os, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageFont
FONT = "vendor/fonts/inter800.otf"; W, H = 1080, 1920
def frame(path, bg, fg, xy, text="Hello agent"):
    im = Image.new("RGB", (W, H), bg); d = ImageDraw.Draw(im); d.text(xy, text, font=ImageFont.truetype(FONT, 96), fill=fg); im.save(path)
td = tempfile.mkdtemp(); os.makedirs(td + "/f")
frame(td + "/f/t1.00.png", (255, 255, 255), (9, 9, 11), (200, 800))     # ok: black on white inside margins
frame(td + "/f/t3.00.png", (255, 255, 255), (9, 9, 11), (20, 800))      # margin violation (x=20 < 60)
frame(td + "/f/t5.00.png", (255, 255, 255), (238, 238, 238), (200, 800))# white-on-white (contrast)
frame(td + "/f/t7.00.png", (9, 9, 11), (30, 30, 34), (200, 800))        # black-on-black
frame(td + "/f/t9.00.png", (9, 9, 11), (255, 255, 255), (200, 800))     # ok: white on black
sc = {"fps": 30, "durationFrames": 300, "scenes": [{"id": "scene_01", "startFrame": 0, "endFrame": 100, "typeScale": 1}, {"id": "scene_02", "startFrame": 100, "endFrame": 300, "typeScale": 1}]}
json.dump(sc, open(td + "/s.json", "w"))
r = subprocess.run([sys.executable, "rendering/visualSelfQA.py", "--scene", td + "/s.json", "--frames-dir", td + "/f", "--out", td + "/r.json", "--fix-out", td + "/fix.json"], capture_output=True, text=True)
print(r.stdout.strip()); rep = json.load(open(td + "/r.json")); byt = {f["t"]: f for f in rep["frames"]}
fail = 0
def t(name, c):
    global fail; print("PASS" if c else "FAIL", name); fail += (not c)
t("clean black-on-white passes", byt[1.0]["ok"])
t("text at x=20 -> margin violation", bool(byt[3.0]["marginViolations"]))
t("white-on-white -> contrast failure", bool(byt[5.0]["contrastFailures"]))
t("black-on-black -> contrast failure", bool(byt[7.0]["contrastFailures"]))
t("clean white-on-black passes", byt[9.0]["ok"])
fx = json.load(open(td + "/fix.json")); t("auto-fix targets exact scene with typeScale 0.9", fx == {"scene_01": 0.9} or fx == {"scene_02": 0.9})
t("gate exits non-zero on failure", r.returncode == 1)
sys.exit(1 if fail else 0)
