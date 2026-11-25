import bpy
vl = bpy.context.view_layer
for p in vl.cycles.bl_rna.properties:
    if 'denois' in p.identifier: print(p.identifier, "=", getattr(vl.cycles, p.identifier), "|", p.name, "::", p.description)
sc = bpy.context.scene
for p in sc.cycles.bl_rna.properties:
    if any(k in p.identifier for k in ('direct_light_sampling','sample_offset','time_limit','use_sample_subset','sample_subset','min_samples','fast_gi','texture_limit','use_auto_tile','sampling_pattern','light_sampling_threshold','dicing','rolling','offscreen','shadow_catcher')):
        print("scene.cycles."+p.identifier, "=", getattr(sc.cycles, p.identifier), "|", p.name, "::", p.description[:220])
for p in bpy.types.CompositorNodeDenoise.bl_rna.properties:
    if p.identifier in ('prefilter','quality','use_hdr'): print("CompositorNodeDenoise", p.identifier, p.description[:200])
n = None
try:
    ng = bpy.data.node_groups.new("c", "CompositorNodeTree"); n = ng.nodes.new("CompositorNodeDenoise"); print("Denoise node inputs:", [(s.name, s.type) for s in n.inputs])
    for t in ("CompositorNodeAlphaOver","CompositorNodeGlare","CompositorNodeConvertColorSpace","CompositorNodeCryptomatteV2","CompositorNodePremulKey","CompositorNodeLensdist"):
        try:
            x = ng.nodes.new(t); print(t, "inputs:", [(s.name) for s in x.inputs][:16])
        except Exception as e: print(t, "ERR", e)
except Exception as e: print("ERR", e)
