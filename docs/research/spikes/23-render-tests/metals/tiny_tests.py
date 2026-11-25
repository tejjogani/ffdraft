import bpy, numpy as np, os, math
from mathutils import Vector
OUT = "/home/claude/scratch/23/tt"; os.makedirs(OUT, exist_ok=True)
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'; sc.render.threads_mode = 'FIXED'; sc.render.threads = 2
    sc.cycles.use_denoising = False; sc.cycles.use_adaptive_sampling = False
    sc.view_settings.view_transform = 'Standard'
    sc.render.image_settings.file_format = 'OPEN_EXR'; sc.render.image_settings.color_depth = '32'
    w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (1,1,1,1); w.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    return sc
def render(sc, name):
    p = os.path.join(OUT, name + ".exr"); sc.render.filepath = p
    bpy.ops.render.render(write_still=True)
    im = bpy.data.images.load(p); w, h = im.size
    a = np.array(im.pixels[:]).reshape(h, w, 4); bpy.data.images.remove(im); return a
def emis(name, col):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    o = nt.nodes.new("ShaderNodeOutputMaterial"); e = nt.nodes.new("ShaderNodeEmission"); e.inputs[0].default_value = (*col,1); nt.links.new(e.outputs[0], o.inputs[0]); return m
def plane(name, loc, size, mat, rot=(0,0,0)):
    bpy.ops.mesh.primitive_plane_add(size=size, location=loc, rotation=rot); ob = bpy.context.object; ob.name = name; ob.data.materials.append(mat); return ob
# ---- Test 1: DoF vs unit scale
def dof_case(scale_length, fstop, tag):
    sc = reset(); sc.unit_settings.scale_length = scale_length
    sc.render.resolution_x = 256; sc.render.resolution_y = 32; sc.cycles.samples = 64
    sc.world.node_tree.nodes["Background"].inputs[0].default_value = (0,0,0,1)
    cam = bpy.data.cameras.new("c"); co = bpy.data.objects.new("c", cam); sc.collection.objects.link(co); sc.camera = co
    co.location = (0,0,250); cam.lens = 100; cam.sensor_width = 36; cam.clip_start = 1; cam.clip_end = 5000
    cam.dof.use_dof = True; cam.dof.focus_distance = 250; cam.dof.aperture_fstop = fstop
    # far half-plane (edge at x=0) 150 BU behind focus, white emissive, covering x>0
    plane("far", (200, 0, -150), 400, emis("white", (1,1,1)))
    a = render(sc, tag)
    row = a[a.shape[0]//2,:,0]
    # 10-90% edge width in pixels
    lo = np.argmax(row > 0.1); hi = np.argmax(row > 0.9)
    print(f"DoF {tag}: scale_length={scale_length} fstop={fstop} -> 10-90% edge width = {hi-lo} px of 256 (frame width at far plane = {36*400/100:.0f} BU)")
dof_case(0.001, 16, "mm_f16"); dof_case(0.001, 0.016, "mm_f0016"); dof_case(1.0, 0.016, "m_f0016"); dof_case(1.0, 16, "m_f16")
# ---- Test 2: Volume absorption law
sc = reset(); sc.render.resolution_x = 16; sc.render.resolution_y = 16; sc.cycles.samples = 16
sc.cycles.max_bounces = 16; sc.cycles.transmission_bounces = 16; sc.cycles.glossy_bounces = 16
cam = bpy.data.cameras.new("c"); co = bpy.data.objects.new("c", cam); sc.collection.objects.link(co); sc.camera = co
co.location = (0,0,100); cam.lens = 200; cam.clip_end = 5000
bpy.ops.mesh.primitive_cube_add(size=1, location=(0,0,0)); cube = bpy.context.object; cube.scale = (200,200,10)
m = bpy.data.materials.new("gem"); m.use_nodes = True; nt = m.node_tree
b = nt.nodes["Principled BSDF"]; b.inputs["Transmission Weight"].default_value = 1; b.inputs["IOR"].default_value = 1.0; b.inputs["Roughness"].default_value = 0
b.inputs["Specular IOR Level"].default_value = 0.0
va = nt.nodes.new("ShaderNodeVolumeAbsorption"); va.inputs["Color"].default_value = (0.5,0.8,0.2,1); va.inputs["Density"].default_value = 0.1
nt.links.new(va.outputs[0], nt.nodes["Material Output"].inputs["Volume"]); cube.data.materials.append(m)
a = render(sc, "absorb"); c = a[8,8,:3]
print("absorption measured T =", np.round(c,4), " expected exp(-density*(1-colour)*d) =", np.round(np.exp(-0.1*(1-np.array([0.5,0.8,0.2]))*10),4))
