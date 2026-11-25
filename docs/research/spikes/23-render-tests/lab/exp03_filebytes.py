"""Exp 3: are the saved file bytes the same across two runs? Which scene.render stamp flags make them so?
Each variant is rendered twice in two fresh processes (stone crop, 16 spp, fixed seed, denoise off).
Files compared: PNG and JPEG written by render(write_still=True), PNG/JPEG/EXR written by Image.save_render()."""
from metrics import *
from PIL import Image
B = {"spp": 16, "jpeg": True}
V = {
    "default": None,
    "no_date": {"use_stamp_date": False},
    "no_rtime": {"use_stamp_render_time": False},
    "no_date_rtime": {"use_stamp_date": False, "use_stamp_render_time": False},
    "all_off": "all_off",
}
for v, st in V.items():
    for rep in "ab":
        run(dict(B, name="e3_%s_png_%s" % (v, rep), stamp=st, write_still="PNG"))
        run(dict(B, name="e3_%s_jpg_%s" % (v, rep), stamp=st, write_still="JPEG"))
print("%-14s %-10s %-10s %-10s %-10s %-10s %-8s | metadata keys that differ / all keys" % (
    "variant", "ws PNG", "ws JPEG", "sr PNG", "sr JPEG", "sr EXR", "pixels"))
for v in V:
    a, b = res("e3_%s_png_a" % v), res("e3_%s_png_b" % v)
    ja, jb = res("e3_%s_jpg_a" % v), res("e3_%s_jpg_b" % v)
    ta = dict(Image.open(os.path.join(OUT, "e3_%s_png_a_ws.png" % v)).text)
    tb = dict(Image.open(os.path.join(OUT, "e3_%s_png_b_ws.png" % v)).text)
    diff = sorted(k for k in set(ta) | set(tb) if ta.get(k) != tb.get(k))
    jpx = np.array_equal(png("e3_%s_jpg_a_ws" % v, ".jpg"), png("e3_%s_jpg_b_ws" % v, ".jpg"))
    print("%-14s %-10s %-10s %-10s %-10s %-10s %-8s | differ: %s | all: %s" % (
        v, a["ws_sha"] == b["ws_sha"], ja["ws_sha"] == jb["ws_sha"], a["png_sha"] == b["png_sha"],
        a["jpg_sha"] == b["jpg_sha"], a["exr_sha"] == b["exr_sha"],
        "%s/%s" % (a["px_sha"] == b["px_sha"], jpx), diff, sorted(ta)))
# JPEG metadata: list the comment / APP segments of one default file
def jpeg_segments(path):
    b = open(path, "rb").read(); i = 2; out = []
    while i < len(b) and b[i] == 0xFF and b[i + 1] not in (0xDA,):
        m = b[i + 1]; L = int.from_bytes(b[i + 2:i + 4], "big")
        if m == 0xFE or 0xE0 <= m <= 0xEF:
            out.append(("COM" if m == 0xFE else "APP%d" % (m - 0xE0), b[i + 4:i + 2 + L][:70]))
        i += 2 + L
    return out
for v in ("default", "all_off"):
    print("JPEG segments,", v, ":", jpeg_segments(os.path.join(OUT, "e3_%s_jpg_a_ws.jpg" % v)))
# Fallback that needs no Blender setting: strip metadata by re-saving pixels only.
for v in ("default",):
    hs = []
    for rep in "ab":
        im = Image.open(os.path.join(OUT, "e3_%s_png_%s_ws.png" % (v, rep))).convert("RGB")
        p = os.path.join(OUT, "e3_%s_png_%s_stripped.png" % (v, rep))
        Image.fromarray(np.asarray(im)).save(p, optimize=False)
        hs.append(fsha(p))
    print("default PNGs re-saved with Pillow from pixels only: file sha equal =", hs[0] == hs[1])

# Second part: scene.render.metadata_input = 'STRIPS' (take metadata from sequencer strips; there are none).
print("\nmetadata_input='STRIPS':")
OFF = {"use_stamp_date": False, "use_stamp_render_time": False, "use_stamp_time": False, "use_stamp_frame": False,
       "use_stamp_camera": False, "use_stamp_scene": False, "use_stamp_filename": False, "use_stamp_memory": False}
for v, st in (("strips_only", {"metadata_input": "STRIPS"}), ("strips_flags_off", dict(OFF, metadata_input="STRIPS"))):
    for rep in "ab":
        run(dict(B, name="e3_%s_png_%s" % (v, rep), stamp=st, write_still="PNG"))
        run(dict(B, name="e3_%s_jpg_%s" % (v, rep), stamp=st, write_still="JPEG"))
    a, b = res("e3_%s_png_a" % v), res("e3_%s_png_b" % v)
    ja, jb = res("e3_%s_jpg_a" % v), res("e3_%s_jpg_b" % v)
    print("%-18s write_still PNG equal=%s  write_still JPEG equal=%s  save_render PNG equal=%s  save_render JPEG equal=%s  EXR equal=%s  | PNG text: %s | JPEG: %s" % (
        v, a["ws_sha"] == b["ws_sha"], ja["ws_sha"] == jb["ws_sha"], a["png_sha"] == b["png_sha"], a["jpg_sha"] == b["jpg_sha"],
        a["exr_sha"] == b["exr_sha"], dict(Image.open(os.path.join(OUT, "e3_%s_png_a_ws.png" % v)).text),
        [s for s in jpeg_segments(os.path.join(OUT, "e3_%s_jpg_a_ws.jpg" % v)) if s[0] == "COM"]))
