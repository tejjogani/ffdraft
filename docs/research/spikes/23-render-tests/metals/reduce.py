import sys, os, glob, json, warnings
warnings.filterwarnings("ignore")
import numpy as np, yaml, colour
from scipy.optimize import least_squares
DB = sys.argv[1]
lam = np.arange(380, 781, 1.0)
cmfs = colour.MSDS_CMFS['CIE 1931 2 Degree Standard Observer'].copy().align(colour.SpectralShape(380,780,1)).values
d65 = colour.SDS_ILLUMINANTS['D65'].copy().align(colour.SpectralShape(380,780,1)).values
M = np.array([[3.2404542,-1.5371385,-0.4985314],[-0.9692660,1.8760108,0.0415560],[0.0556434,-0.2040259,1.0572252]])
wXYZ = (cmfs*d65[:,None]).sum(0)
def spec_to_rgb(R):
    XYZ = (cmfs*(d65*R)[:,None]).sum(0)/wXYZ[1]
    rgb = M@XYZ; white = M@(wXYZ/wXYZ[1])
    return rgb/white, XYZ
def lab(XYZ):
    wn = wXYZ/wXYZ[1]; t = XYZ/wn
    f = np.where(t>(6/29)**3, np.cbrt(t), t/(3*(6/29)**2)+4/29)
    return 116*f[1]-16, 500*(f[0]-f[1]), 200*(f[1]-f[2])
def fres(n, k, mu):
    # exact unpolarised conductor Fresnel from air; n,k arrays, mu = cos(theta)
    mu2 = mu*mu; s2 = 1-mu2
    t0 = n*n - k*k - s2
    a2b2 = np.sqrt(t0*t0 + 4*n*n*k*k)
    t1 = a2b2 + mu2; a = np.sqrt(np.maximum(0.5*(a2b2+t0),0)); t2 = 2*a*mu
    Rs = (t1-t2)/(t1+t2)
    t3 = mu2*a2b2 + s2*s2; t4 = t2*s2
    Rp = Rs*(t3-t4)/(t3+t4)
    return 0.5*(Rs+Rp)
def load(path):
    d = yaml.safe_load(open(path, encoding='utf-8'))
    for blk in d['DATA']:
        if blk['type'].strip() == 'tabulated nk':
            arr = np.array([[float(x) for x in ln.split()] for ln in blk['data'].strip().splitlines()])
            return arr[:,0]*1000, arr[:,1], arr[:,2]
    return None
def interp(path):
    r = load(path)
    if r is None: return None
    w, n, k = r
    o = np.argsort(w); w, n, k = w[o], n[o], k[o]
    if w[0] > 385 or w[-1] < 770: return None
    return np.interp(lam, w, n), np.interp(lam, w, k)
MU82 = 1/7.0
thetas = np.radians(np.linspace(0, 88, 45)); mus = np.cos(thetas)
def analyse(n, k, fit=True):
    F0, XYZ0 = spec_to_rgb(fres(n, k, 1.0))
    F82, _ = spec_to_rgb(fres(n, k, MU82))
    sch = F0 + (1-F0)*(1-MU82)**5
    tint = F82/sch
    out = dict(F0=F0, F82=F82, tint=tint, lab=lab(XYZ0))
    if fit:
        curves = np.array([spec_to_rgb(fres(n,k,m))[0] for m in mus])  # (angles,3)
        nk = []
        for c in range(3):
            tgt = np.clip(curves[:,c], 0, 0.9995)
            best = None
            for n0,k0 in [(0.3,3),(1.5,3),(2,5),(0.1,2),(1.0,6)]:
                r = least_squares(lambda p: fres(p[0],p[1],mus)-tgt, [n0,k0], bounds=([0.01,0.0],[20,30]))
                if best is None or r.cost < best.cost: best = r
            nk.append((best.x[0], best.x[1], float(np.sqrt(2*best.cost/len(mus)))))
        out['fit'] = nk
    # 3-wavelength samples
    out['samp'] = [(float(np.interp(w, lam, n)), float(np.interp(w, lam, k))) for w in (645, 526, 444)]
    out['samp2'] = [(float(np.interp(w, lam, n)), float(np.interp(w, lam, k))) for w in (650, 550, 450)]
    return out
def show(name, a):
    f = lambda v: ", ".join(f"{x:.3f}" for x in v)
    s = f"{name:34s} F0=({f(a['F0'])}) tint82=({f(a['tint'])}) Lab=({a['lab'][0]:.1f},{a['lab'][1]:.1f},{a['lab'][2]:.1f})"
    if 'fit' in a:
        s += "\n" + " "*34 + " fit n=(" + f([x[0] for x in a['fit']]) + ") k=(" + f([x[1] for x in a['fit']]) + ") rms=(" + ", ".join(f"{x[2]:.4f}" for x in a['fit']) + ")"
    s += "\n" + " "*34 + " @645/526/444nm n=(" + f([x[0] for x in a['samp']]) + ") k=(" + f([x[1] for x in a['samp']]) + ")"
    s += "\n" + " "*34 + " @650/550/450nm n=(" + f([x[0] for x in a['samp2']]) + ") k=(" + f([x[1] for x in a['samp2']]) + ")"
    print(s)
sets = {
 'Au': ['Johnson','Babar','McPeak','Olmon-sc','Werner','Rakic-LD'],
 'Ag': ['Johnson','Babar','McPeak','Yang','Werner','Rakic-LD'],
 'Cu': ['Johnson','Babar','McPeak','Werner','Rakic-LD'],
 'Pt': ['Werner','Rakic-LD','Tselin','Rakic-BB'],
 'Pd': ['Johnson','Werner','Palm','Rakic-LD'],
 'Rh': ['Weaver','Arndt','Coulter-300','Windt'],
 'Ni': ['Johnson','Rakic-LD'],
 'Ti': None,
}
data = {}
for m, names in sets.items():
    base = os.path.join(DB, 'main', m, 'nk')
    if names is None: names = [os.path.basename(p)[:-4] for p in sorted(glob.glob(base+'/*.yml'))]
    for nm in names:
        p = os.path.join(base, nm+'.yml')
        if not os.path.exists(p): print(m, nm, 'missing'); continue
        r = interp(p)
        if r is None: print(m, nm, 'does not cover 380-780 nm or not tabulated nk'); continue
        data[(m,nm)] = r
        show(f"{m} {nm}", analyse(*r))
np.save('/home/claude/scratch/23/_lam.npy', lam)
import pickle; pickle.dump(data, open('/home/claude/scratch/23/_data.pkl','wb'))
