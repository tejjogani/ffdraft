import bpy, numpy as np, os, tempfile
sc = bpy.context.scene
vals = [0.0, 0.01, 0.045, 0.18, 0.5, 0.8, 0.9, 1.0, 1.5, 2.0, 4.0, 8.0, 16.0, 64.0]
cols = [(v,v,v) for v in vals] + [(1.0,0.766,0.336),(2.0,1.532,0.672),(4.0,3.064,1.344),(0.5,0.383,0.168),(0.797,0.765,0.742),(0.97,0.68,0.48),(1.594,1.53,1.484)]
names = [f"grey {v}" for v in vals] + ["gold x1","gold x2","gold x4","gold x0.5","rhodium x1","rose18 x1","rhodium x2"]
W = len(cols)
img = bpy.data.images.new("t", W, 1, alpha=False, float_buffer=True)
img.colorspace_settings.name = 'Linear Rec.709'
px = np.ones((1, W, 4), np.float32)
for i,c in enumerate(cols): px[0,i,:3] = c
img.pixels.foreach_set(px.ravel())
out = {}
sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGB'; sc.render.image_settings.color_depth = '16'
for vt, look in [('Standard','None'),('Khronos PBR Neutral','None'),('AgX','None'),('AgX','AgX - Base Contrast'),('AgX','AgX - Medium High Contrast'),('AgX','AgX - Punchy'),('Filmic','None'),('ACES 2.0','None')]:
    sc.view_settings.view_transform = vt
    try: sc.view_settings.look = look
    except Exception as e:
        print("look fail", vt, look, e); continue
    sc.view_settings.exposure = 0; sc.view_settings.gamma = 1
    p = os.path.join(tempfile.gettempdir(), "cm_test.png")
    img.save_render(p, scene=sc)
    r = bpy.data.images.load(p, check_existing=False); r.colorspace_settings.name = 'Non-Color'
    a = np.array(r.pixels[:]).reshape(1, W, 4)[0,:,:3]
    out[(vt,look)] = a
    bpy.data.images.remove(r)
print("%-14s" % "input", *["%-22s" % (k[0][:10]+"/"+k[1][-14:]) for k in out])
for i,n in enumerate(names):
    print("%-14s" % n, *["%-22s" % ",".join(str(int(round(x*255))) for x in out[k][i]) for k in out])
