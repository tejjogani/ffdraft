import bpy
sc = bpy.context.scene
vs = sc.view_settings
for vt in ['Standard','ACES 1.3','ACES 2.0','Khronos PBR Neutral','AgX','Filmic','Raw']:
    vs.view_transform = vt
    print("VT", vt, "looks:", [i.identifier for i in vs.bl_rna.properties['look'].enum_items if True][:40])
ds = sc.display_settings
print("displays:", [i.identifier for i in ds.bl_rna.properties['display_device'].enum_items])
print("working space:", getattr(bpy.data, 'colorspace', None))
try:
    print([ (p.identifier, getattr(sc.render.image_settings.view_settings, p.identifier, None)) for p in []])
except Exception as e: print(e)
import os
p = os.path.join(os.path.dirname(bpy.__file__), )
for root, d, f in os.walk(os.path.dirname(bpy.__file__)):
    if 'colormanagement' in root and root.endswith('colormanagement'):
        print(root, f, d)
print("blend working space prop:", [pp.identifier for pp in bpy.types.BlendData.bl_rna.properties if 'color' in pp.identifier])
try:
    print("scene linear/working:", [(pp.identifier) for pp in bpy.types.BlendFileColorspace.bl_rna.properties])
    print(bpy.data.colorspace.working_space, [i.identifier for i in bpy.data.colorspace.bl_rna.properties['working_space'].enum_items])
except Exception as e: print("E", e)
