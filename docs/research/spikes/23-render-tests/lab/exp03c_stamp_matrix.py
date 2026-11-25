"""Exp 3c: which scene.render flags decide whether render(write_still=True) writes metadata into PNG/JPEG.
8 spp stone crop, two fresh processes per variant."""
from metrics import *
from PIL import Image
OFF = {"use_stamp_date": False, "use_stamp_render_time": False, "use_stamp_time": False, "use_stamp_frame": False,
       "use_stamp_camera": False, "use_stamp_scene": False, "use_stamp_filename": False, "use_stamp_memory": False}
ALL = dict(OFF, use_stamp_frame_range=False, use_stamp_lens=False, use_stamp_note=False, use_stamp_marker=False,
           use_stamp_sequencer_strip=False, use_stamp_hostname=False, use_stamp_labels=False, use_stamp=False)
V = {"scene_off8": OFF, "strips_off8": dict(OFF, metadata_input="STRIPS"), "scene_all": ALL, "strips_all": dict(ALL, metadata_input="STRIPS"),
     "off8_labels_off": dict(OFF, use_stamp_labels=False), "off7_memory_on": {k: v for k, v in OFF.items() if k != "use_stamp_memory"},
     "off8_hostname_on": dict(OFF, use_stamp_hostname=True), "off8_jpeg": OFF}
for v, st in V.items():
    f = "JPEG" if "jpeg" in v else "PNG"
    for rep in "ab":
        run(dict(name="e3m_%s_%s" % (v, rep), spp=8, stamp=st, write_still=f))
    a, b = res("e3m_%s_a" % v), res("e3m_%s_b" % v)
    if f == "PNG":
        print("%-18s write_still PNG bytes equal=%-5s | its text keys %s | save_render PNG bytes equal=%s, keys %s" % (
            v, a["ws_sha"] == b["ws_sha"], sorted(Image.open(os.path.join(OUT, "e3m_%s_a_ws.png" % v)).text),
            a["png_sha"] == b["png_sha"], sorted(Image.open(os.path.join(OUT, "e3m_%s_a.png" % v)).text)))
    else:
        raw = open(os.path.join(OUT, "e3m_%s_a_ws.jpg" % v), "rb").read()
        print("%-18s write_still JPEG bytes equal=%-5s | contains a 'Blender:' comment: %s" % (v, a["ws_sha"] == b["ws_sha"], b"Blender:" in raw))
