# Synthetic "turntable" proxy: ring of faceted stones rotating about a vertical axis, RGBA, seamless loop.
import math, sys, numpy as np
from PIL import Image, ImageDraw, ImageFilter
W,H,N = 1920,1080,150
out = sys.argv[1]
rng = np.random.default_rng(7)
NST = 28
# per-stone, per-facet light directions (flash when rotation angle passes a facet's angle)
facet_phase = rng.uniform(0, 2*math.pi, size=(NST, 9))
facet_width = rng.uniform(0.05, 0.18, size=(NST, 9))
for i in range(N):
    a = 2*math.pi*i/N
    img = Image.new("RGBA", (W*2, H*2), (0,0,0,0))
    d = ImageDraw.Draw(img)
    cx, cy, rx, ry = W, H, 620, 230
    # shadow
    sh = Image.new("L", (W*2, H*2), 0); ds = ImageDraw.Draw(sh)
    ds.ellipse([cx-rx-60, cy+ry-10, cx+rx+60, cy+ry+150], fill=90)
    sh = sh.filter(ImageFilter.GaussianBlur(40))
    img.paste((40,40,45,255), mask=sh)
    order = sorted(range(NST), key=lambda k: math.sin(a + 2*math.pi*k/NST))
    for k in order:
        t = a + 2*math.pi*k/NST
        x = cx + rx*math.cos(t); y = cy + ry*math.sin(t)
        depth = (math.sin(t)+1)/2
        s = 46 + 30*depth
        # metal head
        g = int(150 + 90*abs(math.cos(t*2+0.4)))
        d.ellipse([x-s*1.15, y-s*1.15, x+s*1.15, y+s*1.15], fill=(g, g, int(g*1.02) if g<250 else 255, 255))
        # 3x3 facets
        for f in range(9):
            fx = x + (f%3-1)*s*0.55; fy = y + (f//3-1)*s*0.55
            dphi = math.atan2(math.sin(t-facet_phase[k,f]), math.cos(t-facet_phase[k,f]))
            flash = math.exp(-(dphi/facet_width[k,f])**2)
            base = 70 + 60*math.cos(t*3 + f)
            v = int(max(10, min(255, base + 255*flash)))
            col = (v, v, v, 255)
            if flash > 0.6 and f % 4 == 0:   # occasional coloured fire
                col = (255, int(180+60*math.sin(f+k)), int(120+100*math.cos(k)), 255)
            d.polygon([(fx, fy-s*0.3), (fx+s*0.3, fy), (fx, fy+s*0.3), (fx-s*0.3, fy)], fill=col)
    img = img.resize((W, H), Image.LANCZOS)
    img.save(f"{out}/f_{i+1:04d}.png", compress_level=3)
print("done")
