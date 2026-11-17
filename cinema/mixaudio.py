"""Cinema fast-path audio mix: voice + procedural SFX + ambient pad, ducked, -16 LUFS.
Windows compatible (python, not python3). Auto-reads DUR from work/voice.json."""
import json, numpy as np, soundfile as sf, subprocess, sys, os
SR=48000
# Auto-detect duration from voice.json
vj = json.load(open("work/voice.json"))
DUR = vj.get("total", 30.0)
rng=np.random.default_rng(7)   # fixed seed => deterministic
subprocess.run(["ffmpeg","-y","-loglevel","error","-i","work/voice.wav","-ar",str(SR),"-ac","1","build/voice48.wav"],check=True)
v,_=sf.read("build/voice48.wav",dtype="float32"); N=int(DUR*SR)
voice=np.zeros(N,np.float32); voice[:min(N,len(v))]=v[:N]; voice/= max(1e-6,np.abs(voice).max()); voice*=0.85
t=lambda d: np.arange(int(d*SR))/SR
def env(x,a,r): n=len(x); e=np.ones(n); na=max(1,int(a*SR)); e[:na]=np.linspace(0,1,na); nr=max(1,int(r*SR)); e[-nr:]*=np.linspace(1,0,nr)**2; return x*e
def noise(n): return rng.standard_normal(n).astype(np.float32)
def filt(x,f1,f2):  # crude band-pass via FFT
    X=np.fft.rfft(x); fr=np.fft.rfftfreq(len(x),1/SR); X[(fr<f1)|(fr>f2)]=0; return np.fft.irfft(X,len(x)).astype(np.float32)
def whoosh():
    d=0.55; n=noise(int(d*SR)); x=filt(n,300,6000); sw=np.sin(np.pi*np.linspace(0,1,len(x)))**2; return x*sw*0.9
def tick(): d=0.03; x=filt(noise(int(d*SR)),2500,9000); return env(x,0.001,0.028)*0.8
def click(): d=0.06; tt=t(d); x=np.sin(2*np.pi*1800*tt)*np.exp(-tt*90)+filt(noise(len(tt)),2000,8000)*np.exp(-tt*120); return x.astype(np.float32)*0.8
def pop(): d=0.14; tt=t(d); f=700-450*tt/d; x=np.sin(2*np.pi*np.cumsum(f)/SR)*np.exp(-tt*28); return x.astype(np.float32)
def soft(): d=0.5; tt=t(d); x=np.sin(2*np.pi*140*tt)*np.exp(-tt*7)+0.3*np.sin(2*np.pi*280*tt)*np.exp(-tt*10); return x.astype(np.float32)*0.9
def hit(): d=0.9; tt=t(d); x=np.sin(2*np.pi*(55+40*np.exp(-tt*18))*tt)*np.exp(-tt*5.5)+0.35*filt(noise(len(tt)),80,1200)*np.exp(-tt*14); return x.astype(np.float32)
def fail(): d=0.45; tt=t(d); f=np.where(tt<0.18,330,220); x=np.sign(np.sin(2*np.pi*np.cumsum(f)/SR))*0.25*np.exp(-tt*6)+0.5*np.sin(2*np.pi*np.cumsum(f)/SR)*np.exp(-tt*6); return x.astype(np.float32)
def swipe(): d=0.3; x=filt(noise(int(d*SR)),2000,10000); sw=np.linspace(0.2,1,len(x))*np.linspace(1,0,len(x))**0.5; return x*sw*0.7
K=dict(whoosh=whoosh,tick=tick,click=click,pop=pop,soft=soft,hit=hit,fail=fail,swipe=swipe)
sfx=np.zeros(N,np.float32)
for c in json.load(open("build/cues.json")):
    s=K[c["kind"]]()*c["gain"]; i=int(max(0,c["t"])*SR); j=min(N,i+len(s))
    if i<N: sfx[i:j]+=s[:j-i]
# duck sfx under speech: smooth envelope from voice activity
act=np.abs(voice); k=int(0.12*SR); sm=np.convolve(act,np.ones(k)/k,mode="same"); duck=1-0.55*np.clip(sm/0.08,0,1)
sfx*=duck.astype(np.float32); sfx/=max(1e-6,np.abs(sfx).max()); sfx*=0.09     # SFX peak ~ -21 dBFS
tt_arr=np.arange(N)/SR; pad=(np.sin(2*np.pi*55*tt_arr)+0.6*np.sin(2*np.pi*82.4*tt_arr+1)+0.4*np.sin(2*np.pi*110*tt_arr+2))*(0.6+0.4*np.sin(2*np.pi*0.11*tt_arr)); pad=(pad/np.abs(pad).max()*0.035).astype(np.float32)
pad*=np.minimum(1,tt_arr/1.5)*np.minimum(1,(DUR-tt_arr)/1.5)
mix=voice+sfx+pad
sf.write("build/mix_raw.wav",mix,SR)
fade_start = max(0, DUR - 0.6)
subprocess.run(["ffmpeg","-y","-loglevel","error","-i","build/mix_raw.wav","-af",f"loudnorm=I=-16:TP=-1.5:LRA=7,afade=t=out:st={fade_start}:d=0.6","-ar","48000","build/mix.wav"],check=True)
print(f"mix ok {len(mix)/SR:.1f}s  DUR={DUR}s")
