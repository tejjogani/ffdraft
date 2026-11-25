import bpy
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
def props(obj, names=None, label=""):
    rna = obj.bl_rna
    for p in rna.properties:
        if names and not any(n in p.identifier for n in names): continue
        if p.identifier in ('rna_type','name'): continue
        try: val = getattr(obj, p.identifier)
        except Exception: val = '?'
        extra = ""
        if p.type == 'ENUM': extra = " items=" + str([(i.identifier, i.description[:120]) for i in p.enum_items][:14])
        if p.type in ('FLOAT','INT'): 
            try: extra = f" range[{p.hard_min},{p.hard_max}] soft[{p.soft_min},{p.soft_max}]"
            except Exception: pass
        if hasattr(val, '__len__') and not isinstance(val, str):
            try: val = tuple(val)
            except Exception: pass
        print(f"{label}{p.identifier} = {val!r}{extra} | {p.name} :: {p.description}")
print("### CYCLES SCENE")
props(sc.cycles, ['bounces','clamp','caustics','blur_glossy','guiding','adaptive','samples','denois','light_threshold','light_tree','film_transparent','pixel_filter','filter_width','seed','min_light','use_layer_samples','sampling_pattern','scrambling','auto_scrambling','device','film_exposure','use_fast_gi','ao_bounces','tile','volume'])
print("### RENDER film"); props(sc.render, ['film_transparent','filter_size','dither','use_persistent_data','threads_mode'])
print("### VIEW SETTINGS"); props(sc.view_settings); 
print("### DISPLAY"); props(sc.display_settings)
print("### SEQ colorspace"); 
print("### image settings"); props(sc.render.image_settings, ['file_format','color_mode','color_depth','compression','quality','color_management','exr','linear','media'])
try:
    print("looks AgX etc:")
    for vt in [i.identifier for i in sc.view_settings.bl_rna.properties['view_transform'].enum_items]:
        sc.view_settings.view_transform = vt
        print("  VT", vt, "looks:", [i.identifier for i in sc.view_settings.bl_rna.properties['look'].enum_items])
except Exception as e: print("ERR looks", e)
print("### LIGHT cycles")
l = bpy.data.lights.new("a", 'AREA'); props(l, ['shape','size','spread','energy','normalize','use_shadow','shadow_soft','diffuse_factor','specular_factor','transmission_factor','volume_factor','use_temperature','temperature','exposure','color'])
props(l.cycles, None, "light.cycles.")
p = bpy.data.lights.new("p", 'POINT'); props(p, ['shadow_soft_size','use_soft_falloff','energy','radius'], "point.")
print("### OBJECT")
me = bpy.data.meshes.new("m"); ob = bpy.data.objects.new("o", me)
props(ob, ['visible_','is_shadow_catcher','is_holdout','light_linking','lightgroup','hide_render'])
props(ob.cycles, None, "ob.cycles.")
props(ob.light_linking, None, "ob.light_linking.")
print("### CAMERA"); cam = bpy.data.cameras.new("c"); props(cam, ['lens','sensor','type','ortho','shift','clip']); props(cam.dof, None, "dof.")
print("### VIEWLAYER"); vl = bpy.context.view_layer; props(vl, ['use_pass_','pass_']); props(vl.cycles, None, "vl.cycles.")
print("### WORLD cycles"); w = bpy.data.worlds.new("w"); props(w.cycles, None, "w.cycles."); props(w.cycles_visibility, None, "w.vis.")
print("### MATERIAL"); m = bpy.data.materials.new("x"); props(m.cycles, None, "mat.cycles."); props(m, ['displacement','use_backface','volume_intersection','surface_render','thickness_mode','use_transparency_overlap','blend'])
print("### mesh/bevel modifier");
bm = ob.modifiers.new("b", 'BEVEL'); props(bm, ['width','segments','limit_method','angle_limit','harden_normals','profile','offset_type','miter','affect'])
