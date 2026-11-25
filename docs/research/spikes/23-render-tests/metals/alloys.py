import sys, os, pickle, warnings
warnings.filterwarnings("ignore")
import numpy as np
sys.argv = [sys.argv[0], sys.argv[1]]
src = open('/home/claude/scratch/23/reduce.py').read().split("sets = {")[0]
exec(src)
D = pickle.load(open('/home/claude/scratch/23/_data.pkl','rb'))
def eps(nk): n,k = nk; return (n+1j*k)**2
def from_eps(e):
    m = np.sqrt(e); m = np.where(m.imag<0, -m, m); return m.real, m.imag
AM = dict(Au=196.967, Ag=107.868, Cu=63.546, Pd=106.42, Ni=58.693, Zn=65.38, Pt=195.084)
def atfrac(wt):
    mol = {k: v/AM[k] for k,v in wt.items()}; s = sum(mol.values()); return {k: v/s for k,v in mol.items()}
# 1. Rioux series
R = {}
for au in range(0, 101, 10):
    p = os.path.join(DB, 'other','alloys','Au-Ag','nk', f'Rioux-Au{au}Ag{100-au}.yml')
    R[au] = interp(p)
    show(f"Rioux Au{au}Ag{100-au}", analyse(*R[au], fit=(au in (50,60,70,80,100))))
# 2. validation of linear epsilon mixing against Rioux alloy data
print("\n-- validation: eps-mix of Rioux endpoints vs Rioux alloy")
for au in (30, 50, 70):
    x = au/100
    mix = from_eps(x*eps(R[100]) + (1-x)*eps(R[0]))
    a = analyse(*mix, fit=False); b = analyse(*R[au], fit=False)
    dE = np.sqrt(sum((p-q)**2 for p,q in zip(a['lab'], b['lab'])))
    print(f"Au{au}: mix F0={np.round(a['F0'],3)} Lab={np.round(a['lab'],1)} | data F0={np.round(b['F0'],3)} Lab={np.round(b['lab'],1)} | dE76={dE:.1f}")
# 3. ternary estimates
print("\n-- ternary estimates (atomic-fraction eps mixing)")
alloys = {
 '24K fine': dict(Au=999, Ag=0.5, Cu=0.5),
 '22K yellow (917/50/33)': dict(Au=917, Ag=50, Cu=33),
 '18K 2N pale yellow (750/160/90)': dict(Au=750, Ag=160, Cu=90),
 '18K 3N yellow (750/125/125)': dict(Au=750, Ag=125, Cu=125),
 '18K 4N rose (750/90/160)': dict(Au=750, Ag=90, Cu=160),
 '18K 5N red (750/45/205)': dict(Au=750, Ag=45, Cu=205),
 '14K yellow (585/265/150)': dict(Au=585, Ag=265, Cu=150),
 '14K yellow (585/205/210)': dict(Au=585, Ag=205, Cu=210),
 '14K rose (585/90/325)': dict(Au=585, Ag=90, Cu=325),
 '18K Pd white (750 Au/150 Pd/100 Ag)': dict(Au=750, Pd=150, Ag=100),
 '18K Ni white (750 Au/110 Ni/95 Cu/45 Zn~Cu)': dict(Au=750, Ni=110, Cu=140),
 '14K Ni white (585 Au/120 Ni/295 Cu)': dict(Au=585, Ni=120, Cu=295),
 'Sterling 925 (Ag/Cu)': dict(Ag=925, Cu=75),
 'Pt950/Cu? -> pure Pt used': None,
}
pure = dict(Au=D[('Au','Johnson')], Ag=D[('Ag','Johnson')], Cu=D[('Cu','Johnson')], Pd=D[('Pd','Johnson')], Ni=D[('Ni','Johnson')])
for name, wt in alloys.items():
    if wt is None: continue
    x = atfrac(wt)
    mix = from_eps(sum(x[k]*eps(pure[k]) for k in x))
    a = analyse(*mix, fit=True)
    print("at%:", {k: round(100*v,1) for k,v in x.items()})
    show(name, a)
    # hybrid: Rioux Au-Ag pair (nearest 10%) then mix with Cu
    if set(x) == {'Au','Ag','Cu'} and x['Ag'] > 0.02:
        r = x['Au']/(x['Au']+x['Ag']); lo = int(np.floor(r*10)*10); hi = min(lo+10,100); t = (r*100-lo)/10
        pair = from_eps((1-t)*eps(R[lo]) + t*eps(R[hi]))
        mix2 = from_eps((x['Au']+x['Ag'])*eps(pair) + x['Cu']*eps(pure['Cu']))
        show("   hybrid (Rioux Au-Ag + Cu)", analyse(*mix2, fit=False))
# 4. Blender default check: titanium RGB n,k from manual -> F0 and F82 ratio
n = np.array([2.757,2.513,2.231]); k = np.array([3.867,3.404,3.009])
F0 = fres(n,k,1.0); F82 = fres(n,k,1/7); sch = F0+(1-F0)*(6/7)**5
print("\nBlender Ti default n,k -> F0", np.round(F0,3), "F(82)", np.round(F82,3), "ratio", np.round(F82/sch,3))
for nm, n, k in [("manual Au", [1e-3,0.470,1.439],[182.6,2.189,1.660]), ("manual Cu",[0.235,0.729,1.369],[5.666,2.562,2.227]), ("manual Al",[1.333,0.945,0.582],[7.434,6.340,5.181])]:
    n=np.array(n); k=np.array(k); F0 = fres(n,k,1.0); F82 = fres(n,k,1/7); sch = F0+(1-F0)*(6/7)**5
    print(nm, "F0", np.round(F0,3), "F82", np.round(F82,3), "ratio", np.round(F82/sch,3))
# sRGB display values helper for base colours
def enc(v): v=np.clip(v,0,1); return np.where(v<=0.0031308, 12.92*v, 1.055*v**(1/2.4)-0.055)
for nm, c in [("skill white", [0.86]*3), ("skill 14K", [1.0,0.78,0.45]), ("skill 18K",[1.0,0.76,0.38]), ("skill rose",[0.98,0.68,0.58])]:
    c = np.array(c); XYZ = np.linalg.inv(M)@(c*(M@(wXYZ/wXYZ[1])))
    print(nm, "linear", c, "-> sRGB8", np.round(enc(c)*255).astype(int), "Lab", np.round(lab(XYZ),1))
