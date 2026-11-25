"""Exp 3b (added at the coordinator's request): OpenEXR file bytes across two runs, and which header fields differ.
Single-layer EXR from Image.save_render() and multilayer EXR from render(write_still=True), with the default stamp
flags, with every use_stamp_* off, and with those off plus metadata_input='STRIPS'."""
from metrics import *
import struct
OFF = {"use_stamp_date": False, "use_stamp_render_time": False, "use_stamp_time": False, "use_stamp_frame": False,
       "use_stamp_camera": False, "use_stamp_scene": False, "use_stamp_filename": False, "use_stamp_memory": False}
V = {"default": None, "all_off": "all_off", "strips_flags_off": dict(OFF, metadata_input="STRIPS")}
for v, st in V.items():
    for rep in "ab":
        run(dict(name="e3x_%s_%s" % (v, rep), spp=16, stamp=st, exr_multilayer=True))
def headers(path):
    """Return a list (one per part) of {attribute name: (type, raw bytes)} from an OpenEXR file."""
    b = open(path, "rb").read()
    assert b[:4] == b"\x76\x2f\x31\x01"
    flags = struct.unpack("<I", b[4:8])[0]
    multipart = bool(flags & 0x1000)
    i = 8; parts = []; cur = {}
    while True:
        j = b.index(b"\0", i); name = b[i:j].decode("latin1"); i = j + 1
        if name == "":
            parts.append(cur); cur = {}
            if not multipart or b[i] == 0:
                break
            continue
        j = b.index(b"\0", i); typ = b[i:j].decode("latin1"); i = j + 1
        size = struct.unpack("<i", b[i:i + 4])[0]; i += 4
        cur[name] = (typ, b[i:i + size]); i += size
    return parts, i
for v in V:
    for kind, suffix in (("single-layer (save_render)", ".exr"), ("multilayer (write_still)", "_ml.exr")):
        pa, pb = (os.path.join(OUT, "e3x_%s_%s%s" % (v, rep, suffix)) for rep in "ab")
        (ha, ea), (hb, eb) = headers(pa), headers(pb)
        ba, bb = open(pa, "rb").read(), open(pb, "rb").read()
        diff = []
        for k, (x, y) in enumerate(zip(ha, hb)):
            for name in sorted(set(x) | set(y)):
                if x.get(name) != y.get(name):
                    val = lambda t: t[1][:40].decode("latin1", "replace") if t and t[0] == "string" else (t[0] if t else None)
                    diff.append("part%d %s: %r vs %r" % (k, name, val(x.get(name)), val(y.get(name))))
        strs = sorted({name for part in ha for name, (t, _) in part.items() if t == "string"})
        print("%-18s %-28s file bytes equal=%-5s size %d/%d | parts %d | pixel data after header equal=%s | differing header fields: %s | string attributes present: %s" % (
            v, kind, ba == bb, len(ba), len(bb), len(ha), ba[ea:] == bb[eb:] if len(ba) - ea == len(bb) - eb else "sizes differ", diff or "none", strs))
    a, b = res("e3x_%s_a" % v), res("e3x_%s_b" % v)
    print("%-18s decoded float pixels equal=%s; PNG (save_render) file equal=%s" % (v, a["px_sha"] == b["px_sha"], a["png_sha"] == b["png_sha"]))
