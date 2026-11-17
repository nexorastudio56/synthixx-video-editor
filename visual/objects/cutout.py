#!/usr/bin/env python3
"""rembg transparent cutout. Usage: cutout.py in.png out.png"""
import sys
from rembg import remove, new_session
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGBA'); im.thumbnail((1600, 1600))
out = remove(im, session=new_session('u2netp'))
out.save(dst)
