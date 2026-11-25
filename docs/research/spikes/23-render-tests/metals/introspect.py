import bpy, sys
print("VERSION", bpy.app.version_string, bpy.app.build_date)
mat = bpy.data.materials.new("m"); mat.use_nodes = True
nt = mat.node_tree
def dump(idname):
    n = nt.nodes.new(idname)
    print("\n==", idname, n.bl_label)
    for p in n.bl_rna.properties:
        if p.identifier in ("rna_type",) : continue
        if p.type == 'ENUM' and not p.is_readonly and p.identifier not in ('type','warning_propagation','color_tag','bl_icon','bl_static_type'):
            print("  PROP", p.identifier, "default=", p.default, "items=", [(i.identifier, i.name, i.description) for i in p.enum_items])
    for s in n.inputs:
        dv = getattr(s, "default_value", None)
        try: dv = tuple(round(x,5) for x in dv)
        except TypeError: pass
        rng = ""
        try:
            pr = s.bl_rna.properties['default_value']; rng = f"[{pr.soft_min},{pr.soft_max}] hard[{pr.hard_min},{pr.hard_max}]"
        except Exception: pass
        print("  IN", repr(s.name), s.identifier, s.type, dv, rng, "enabled" if s.enabled else "disabled", "|", s.description)
for i in ["ShaderNodeBsdfMetallic","ShaderNodeBsdfPrincipled","ShaderNodeBsdfGlass","ShaderNodeBsdfRefraction","ShaderNodeVolumeAbsorption","ShaderNodeBevel","ShaderNodeBsdfGlossy"]:
    try: dump(i)
    except Exception as e: print("ERR", i, e)
# metallic physical conductor sockets
n = nt.nodes.new("ShaderNodeBsdfMetallic")
for ft in [i.identifier for i in n.bl_rna.properties['fresnel_type'].enum_items]:
    n.fresnel_type = ft
    print("fresnel", ft, [(s.name, s.enabled) for s in n.inputs])
