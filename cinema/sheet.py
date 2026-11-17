import sys,glob,os
from PIL import Image
S=[0,3.12,5.90,8.72,12.74,17.74,22.16,30.0]
rows=[int(x) for x in sys.argv[1:]] or range(7)
fr=[]
for i in rows:
    a,b=S[i],S[i+1]; fr.append([round((a+0.9)*60),round((a+b)/2*60),round((b-0.5)*60)])
open('frames.txt','w').write(' '.join(str(f) for r in fr for f in r))
