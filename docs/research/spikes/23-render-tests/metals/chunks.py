import bpy, struct, os, tempfile, numpy as np
sc = bpy.context.scene
img = bpy.data.images.new("t", 8, 8, alpha=True, float_buffer=True); img.pixels.foreach_set(np.full(8*8*4, 0.5, np.float32))
d = tempfile.mkdtemp()
def png_chunks(p):
    b = open(p,'rb').read(); i = 8; out = []
    while i < len(b):
        n, t = struct.unpack(">I4s", b[i:i+8]); out.append((t.decode(), n)); i += 12+n
    return out
def jpg_markers(p):
    b = open(p,'rb').read(); i = 2; out = []
    while i < len(b)-4 and b[i] == 0xFF:
        m = b[i+1]; n = struct.unpack(">H", b[i+2:i+4])[0]
        seg = b[i+4:i+4+min(n,16)]
        out.append((hex(m), n, seg[:12]))
        if m == 0xDA: break
        i += 2+n
    return out
for vt in ('Standard','AgX','Khronos PBR Neutral'):
    sc.view_settings.view_transform = vt
    for fmt, depth, ext in (('PNG','8','png'),('PNG','16','png'),('JPEG','8','jpg')):
        s = sc.render.image_settings; s.file_format = fmt; s.color_mode = 'RGBA' if fmt=='PNG' else 'RGB'; s.color_depth = depth
        p = os.path.join(d, f"{vt}_{depth}.{ext}"); img.save_render(p, scene=sc)
        print(vt, fmt, depth, png_chunks(p) if ext=='png' else jpg_markers(p))
