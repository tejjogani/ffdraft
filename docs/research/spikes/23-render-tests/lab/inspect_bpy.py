"""Lists what the installed bpy module offers: version, Cycles defaults, view transforms and looks, Principled sockets.
Run with the interpreter that has bpy:  /home/claude/scratch/15/venv-bpy/bin/python inspect_bpy.py"""
import sys, bpy
bpy.ops.wm.read_factory_settings(use_empty=True)
s = bpy.context.scene
print("python", sys.version.split()[0], "| bpy", bpy.app.version_string, bpy.app.build_hash.decode(), "built", bpy.app.build_date.decode(),
      "branch", bpy.app.build_branch.decode(), "| OCIO", bpy.app.ocio.version_string, "| OIIO", bpy.app.oiio.version_string)
vs = s.view_settings
print("default view transform:", vs.view_transform, "/ look:", vs.look, "/ exposure", vs.exposure, "/ display", s.display_settings.display_device)
for v in ("Standard", "AgX", "Filmic", "Khronos PBR Neutral", "Raw", "False Color", "ACES 1.3", "ACES 2.0", "Filmic Log"):
    try:
        vs.view_transform = v
    except TypeError as e:
        print("view", v, "NOT AVAILABLE"); continue
    ok = []
    for l in ("None", "AgX - Base Contrast", "AgX - Medium High Contrast", "AgX - High Contrast", "AgX - Very High Contrast", "AgX - Punchy",
              "AgX - Greyscale", "Medium High Contrast", "Medium Contrast", "High Contrast", "Very High Contrast", "Base Contrast"):
        try:
            vs.look = l; ok.append(l)
        except TypeError:
            pass
    print("view", v, "| looks accepted:", ok)
s.render.engine = "CYCLES"
c = s.cycles
P = type(c).bl_rna.properties
for k in ("samples", "seed", "use_animated_seed", "use_adaptive_sampling", "adaptive_threshold", "adaptive_min_samples", "time_limit",
          "max_bounces", "diffuse_bounces", "glossy_bounces", "transmission_bounces", "volume_bounces", "transparent_max_bounces",
          "sample_clamp_direct", "sample_clamp_indirect", "blur_glossy", "caustics_reflective", "caustics_refractive", "use_denoising",
          "denoiser", "denoising_input_passes", "denoising_prefilter", "denoising_quality", "pixel_filter_type", "filter_width",
          "use_light_tree", "use_guiding", "use_deterministic_guiding"):
    p = P[k]
    print("cycles.%s = %r %s | %s" % (k, getattr(c, k), [i.identifier for i in p.enum_items] if p.type == "ENUM" else "", p.description))
vl = s.view_layers[0].cycles
for k in ("denoising_store_passes", "denoising_pass_follow_reflections", "denoising_pass_use_albedo_roughness_weighting"):
    print("view_layer.cycles.%s = %r | %s" % (k, getattr(vl, k), type(vl).bl_rna.properties[k].description))
R = bpy.types.RenderSettings.bl_rna.properties
for p in R:
    if p.identifier.startswith("use_stamp") or p.identifier in ("metadata_input", "dither_intensity", "threads_mode", "threads", "use_persistent_data"):
        print("render.%s = %r | %s" % (p.identifier, getattr(s.render, p.identifier), p.description))
m = bpy.data.materials.new("m"); m.use_nodes = True
n = m.node_tree.nodes.get("Principled BSDF") or m.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
print("Principled BSDF sockets:", [i.name for i in n.inputs])
for k in ("IOR", "Transmission Weight", "Transmission Dispersion Scale", "Transmission Dispersion Abbe Number"):
    i = n.inputs[k]; pr = i.bl_rna.properties["default_value"]
    print("  %s default %r, soft range %r..%r, hard range %r..%r, description %r" % (k, i.default_value, pr.soft_min, pr.soft_max, pr.hard_min, pr.hard_max, i.description))
print("has a socket named 'Dispersion':", "Dispersion" in n.inputs)
