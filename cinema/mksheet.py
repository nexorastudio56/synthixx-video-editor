from PIL import Image
fr=open('/home/claude/engine3/cinema/frames.txt').read().split()
W,H=640,360
for part,rng in (("a",range(0,4)),("b",range(4,7))):
    im=Image.new('RGB',(W*3,H*len(rng)))
    for r,i in enumerate(rng):
        for c in range(3):
            f=int(fr[i*3+c]); im.paste(Image.open(f'/home/claude/engine3/cinema/shots/f{f:05d}.png').resize((W,H)),(c*W,r*H))
    im.save(f'/home/claude/engine3/cinema/sheet_{part}.png')
