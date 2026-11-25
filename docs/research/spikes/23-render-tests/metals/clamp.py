import bpy
m = bpy.data.materials.new("m"); m.use_nodes = True
b = m.node_tree.nodes["Principled BSDF"]
for name, vals in [("Transmission Dispersion Scale",[1.5, 3.0, -1]), ("Transmission Dispersion Abbe Number",[5, 0.5, 200, -3]), ("Roughness",[1.5]), ("IOR",[2.417, 0.5])]:
    s = b.inputs[name]
    for v in vals:
        s.default_value = v; print(name, "set", v, "-> reads", round(s.default_value,4))
mb = m.node_tree.nodes.new("ShaderNodeBsdfMetallic"); mb.fresnel_type = 'PHYSICAL_CONDUCTOR'
mb.inputs["IOR"].default_value = (0.1, 0.5, 1.47); mb.inputs["Extinction"].default_value = (17.1, 2.26, 1.77)
print("metallic IOR", tuple(mb.inputs["IOR"].default_value), "k", tuple(round(x,3) for x in mb.inputs["Extinction"].default_value))
l = bpy.data.lights.new("a", 'AREA'); print("light normalize default:", l.normalize, "| shadow caustics flag:", l.cycles.is_caustics_light)
print("OIDN:", bpy.app.build_options.openimagedenoise if hasattr(bpy.app.build_options,'openimagedenoise') else '?')
sc = bpy.context.scene; sc.render.engine='CYCLES'
print("denoiser options:", [i.identifier for i in sc.cycles.bl_rna.properties['denoiser'].enum_items], sc.cycles.denoiser)
print("file formats w/ ICC? image_settings props:", [p.identifier for p in sc.render.image_settings.bl_rna.properties if 'icc' in p.identifier.lower() or 'profile' in p.identifier.lower() or 'cicp' in p.identifier.lower()])
print("view layer cryptomatte/denoise data:", [p.identifier for p in bpy.context.view_layer.cycles.bl_rna.properties if 'denois' in p.identifier])
