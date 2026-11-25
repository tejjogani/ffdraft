import bpy, sys
print("BLENDER", bpy.app.version_string, "ffmpeg supported:", bpy.app.ffmpeg.supported, getattr(bpy.app.ffmpeg, "avcodec_version_string", ""))
try: print("OIDN:", bpy.app.oidn.version_string if hasattr(bpy.app, "oidn") else "n/a")
except Exception as e: print("oidn?", e)
s = bpy.context.scene; c = s.cycles; r = s.render
def d(owner, name):
    p = owner.bl_rna.properties.get(name)
    if p is None: print(f"  MISSING {owner.bl_rna.identifier}.{name}"); return
    extra = ""
    if p.type == 'ENUM': extra = " enum=" + ",".join(i.identifier for i in p.enum_items)
    try: default = getattr(p, "default", None)
    except Exception: default = None
    print(f"  {owner.bl_rna.identifier}.{name} = {getattr(owner, name, None)!r} (default {default}){extra} :: {p.description}")
print("== cycles")
for n in ["samples","use_adaptive_sampling","adaptive_threshold","adaptive_min_samples","time_limit","seed","use_animated_seed","sampling_pattern",
          "use_denoising","denoiser","denoising_input_passes","denoising_prefilter","denoising_quality","denoising_use_gpu","use_temporal_denoising",
          "sample_clamp_direct","sample_clamp_indirect","blur_glossy","caustics_reflective","caustics_refractive","filter_width","pixel_filter_type",
          "motion_blur_position","rolling_shutter_type","use_light_tree","light_sampling_threshold","sample_offset","sample_subset_length","use_sample_subset","auto_scrambling_distance","min_light_bounces","max_bounces","transmission_bounces","use_guiding","device"]:
    d(c, n)
print("== render")
for n in ["use_persistent_data","use_overwrite","use_placeholder","use_file_extension","use_render_cache","fps","fps_base","frame_map_old","use_motion_blur","motion_blur_shutter","motion_blur_position","film_transparent","use_border","use_compositing","use_sequencer","threads_mode","resolution_percentage","filter_size","dither_intensity"]:
    d(r, n)
print("== scene")
for n in ["frame_start","frame_end","frame_step","frame_current","compositing_node_group","use_nodes"]:
    d(s, n)
print("== image_settings")
for n in ["media_type","file_format","color_mode","color_depth","compression","exr_codec","quality","color_management"]:
    d(r.image_settings, n)
print("== view layer passes")
vl = bpy.context.view_layer
for n in ["use_pass_vector","use_pass_combined"]: d(vl, n)
for n in ["denoising_store_passes","use_denoising"]: d(vl.cycles, n)
print("== operators")
for op in ["denoise_animation","merge_images","use_shading_nodes"]:
    o = getattr(bpy.ops.cycles, op, None)
    try: rna = o.get_rna_type(); print("  cycles."+op, "::", rna.description, "| props:", [(p.identifier, p.description) for p in rna.properties if p.identifier!='rna_type'])
    except Exception as e: print("  cycles."+op, "ERR", e)
print("== fcurve enums")
print("  extrapolation:", [i.identifier for i in bpy.types.FCurve.bl_rna.properties['extrapolation'].enum_items])
print("  interpolation:", [i.identifier for i in bpy.types.Keyframe.bl_rna.properties['interpolation'].enum_items])
print("  easing:", [i.identifier for i in bpy.types.Keyframe.bl_rna.properties['easing'].enum_items])
print("  fmodifier types:", [i.identifier for i in bpy.types.FModifier.bl_rna.properties['type'].enum_items])
print("  cycles modes:", [i.identifier for i in bpy.types.FModifierCycles.bl_rna.properties['mode_after'].enum_items])
print("  constraint types has TRACK_TO/DAMPED_TRACK/FOLLOW_PATH:", [i.identifier for i in bpy.types.Constraint.bl_rna.properties['type'].enum_items if i.identifier in ('TRACK_TO','DAMPED_TRACK','FOLLOW_PATH','CHILD_OF','COPY_ROTATION')])
print("  Action has fcurves:", hasattr(bpy.types.Action, "fcurves") or 'fcurves' in bpy.types.Action.bl_rna.properties, "| layers:", 'layers' in bpy.types.Action.bl_rna.properties, "| slots:", 'slots' in bpy.types.Action.bl_rna.properties)
import bpy_extras.anim_utils as au
print("  anim_utils:", [n for n in dir(au) if 'channelbag' in n or 'bake' in n.lower()])
print("== prefs keyframe defaults:", bpy.context.preferences.edit.keyframe_new_interpolation_type, bpy.context.preferences.edit.keyframe_new_handle_type)
print("== camera dof:", [p.identifier for p in bpy.types.CameraDOFSettings.bl_rna.properties if p.identifier!='rna_type'])
