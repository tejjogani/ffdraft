# No rendering: checks that the keyframing recipes work on this Blender and that the loop maths is right.
import bpy, math
from bpy_extras import anim_utils
from mathutils import Vector
print("BLENDER", bpy.app.version_string)
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene; N = 144; sc.render.fps = 24; sc.frame_start, sc.frame_end = 1, N

def fcurves_of(id_):                      # Blender >= 5.0: Action.fcurves is gone
    ad = id_.animation_data
    return anim_utils.action_get_channelbag_for_slot(ad.action, ad.action_slot).fcurves

# 1. turntable: pivot empty at the visual centre, piece parented to it
piv = bpy.data.objects.new("pivot", None); sc.collection.objects.link(piv); piv.location = (0.0, 0.0, 0.004)
me = bpy.data.meshes.new("m"); me.from_pydata([(0.01,0,0),(0,0.01,0),(0,0,0.01)], [], [(0,1,2)])
ring = bpy.data.objects.new("ring", me); sc.collection.objects.link(ring); ring.location = (0.002, 0.001, 0.004)
bpy.context.view_layer.update()
w0 = ring.matrix_world.copy(); ring.parent = piv; ring.matrix_parent_inverse = piv.matrix_world.inverted(); bpy.context.view_layer.update()
print("parenting kept world matrix:", (ring.matrix_world - w0).to_3x3().median_scale < 1e-7 and (ring.matrix_world.translation - w0.translation).length < 1e-7)
piv.rotation_euler[2] = 0.0;      piv.keyframe_insert("rotation_euler", index=2, frame=1)
piv.rotation_euler[2] = math.tau; piv.keyframe_insert("rotation_euler", index=2, frame=N + 1)   # frame N+1 == frame 1, NOT rendered
fc = fcurves_of(piv).find("rotation_euler", index=2)
print("default interpolation of new keys:", [k.interpolation for k in fc.keyframe_points])
for k in fc.keyframe_points: k.interpolation = 'LINEAR'
fc.extrapolation = 'LINEAR'
deg = lambda f: round(math.degrees(fc.evaluate(f)), 4)
print("linear: f1", deg(1), "f2", deg(2), "fN", deg(N), "fN+1", deg(N+1), "fN+2", deg(N+2), "| step", 360/N)
# same with a Cycles f-modifier instead of linear extrapolation
fc.extrapolation = 'CONSTANT'; m = fc.modifiers.new('CYCLES'); m.mode_before = m.mode_after = 'REPEAT_OFFSET'
print("cycles modifier: fN+2", deg(N+2), "f3N+1", deg(3*N+1), "is_trivially_cyclic-ish modes:", m.mode_before, m.mode_after)
# wrong version for comparison: last key on frame N (duplicate pose at the wrap)
print("WRONG (keys 1..N): step would be", round(360/(N-1), 4), "deg and frame N repeats frame 1 -> one-frame stutter each loop")

# 2. camera orbit: camera parented to a second empty, Track To the pivot
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
cam.location = (0.0, -0.25, 0.12); con = cam.constraints.new('TRACK_TO'); con.target = piv; con.track_axis = 'TRACK_NEGATIVE_Z'; con.up_axis = 'UP_Y'
# 3. eased push-in (dolly) + rack focus: Bezier default gives ease in/out; SINE + EASE_IN_OUT is explicit
cam.keyframe_insert("location", frame=1); cam.location = (0.0, -0.12, 0.06); cam.keyframe_insert("location", frame=72)
for f in fcurves_of(cam):
    for k in f.keyframe_points: k.interpolation = 'SINE'; k.easing = 'EASE_IN_OUT'
cam.data.dof.use_dof = True; cam.data.dof.aperture_fstop = 4.0
cam.data.dof.focus_distance = 0.25; cam.data.dof.keyframe_insert("focus_distance", frame=1)
cam.data.dof.focus_distance = 0.12; cam.data.dof.keyframe_insert("focus_distance", frame=72)
print("camera-data fcurves:", [f.data_path for f in fcurves_of(cam.data)], "| object fcurves:", sorted({f.data_path for f in fcurves_of(cam)}))
sc.frame_set(36); print("push-in at f36 (eased midpoint) y =", round(cam.matrix_world.translation.y, 4))
# 4. light sweep: keyframe a light's rotation about the pivot, and world mapping rotation
lp = bpy.data.objects.new("light_pivot", None); sc.collection.objects.link(lp)
L = bpy.data.objects.new("strip", bpy.data.lights.new("strip", 'AREA')); sc.collection.objects.link(L); L.parent = lp; L.location = (0.3, 0, 0.2)
lp.rotation_euler[2] = math.radians(-60); lp.keyframe_insert("rotation_euler", index=2, frame=1)
lp.rotation_euler[2] = math.radians(60);  lp.keyframe_insert("rotation_euler", index=2, frame=N)
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True if hasattr(w, "use_nodes") else None
nt = w.node_tree; mp = nt.nodes.new("ShaderNodeMapping"); mp.inputs["Rotation"].default_value[2] = 0.0
mp.inputs["Rotation"].keyframe_insert("default_value", index=2, frame=1); mp.inputs["Rotation"].default_value[2] = math.tau
mp.inputs["Rotation"].keyframe_insert("default_value", index=2, frame=N + 1)
print("world node fcurve path:", [f.data_path for f in fcurves_of(nt)])
# 5. rigid per-link posing baked to keyframes: set matrix_world per frame then keyframe loc+rot (quaternion to avoid euler flips)
ring.rotation_mode = 'QUATERNION'
for f in (1, 10, 20):
    sc.frame_set(f); ring.keyframe_insert("location", frame=f); ring.keyframe_insert("rotation_quaternion", frame=f)
print("link fcurves:", len(list(fcurves_of(ring))))
# 6. render settings for a resumable, shareable sequence
r = sc.render; r.use_persistent_data = True; r.use_overwrite = False; r.use_placeholder = True
r.image_settings.media_type = 'IMAGE'; r.image_settings.file_format = 'PNG'; r.image_settings.color_mode = 'RGBA'; r.image_settings.color_depth = '16'
r.filepath = "//frames/tt_####"; print("frame path for f7:", r.frame_path(frame=7))
sc.cycles.use_animated_seed = True; print("animated seed set:", sc.cycles.use_animated_seed)
# 7. compositor Glare node in this version
tree = bpy.data.node_groups.new("comp", "CompositorNodeTree"); g = tree.nodes.new("CompositorNodeGlare")
print("Glare inputs:", [(s.name, getattr(s, "default_value", None) if s.type in ('VALUE','MENU','BOOLEAN','INT') else s.type) for s in g.inputs])
print("Glare outputs:", [s.name for s in g.outputs])
dn = tree.nodes.new("CompositorNodeDenoise"); print("Denoise inputs:", [(s.name, getattr(s, "default_value", None) if s.type in ('MENU','BOOLEAN') else s.type) for s in dn.inputs])
try:
    it = g.inputs["Type"]; print("Glare types:", [i.identifier for i in it.bl_rna.properties['default_value'].enum_items] if 'default_value' in it.bl_rna.properties else "n/a")
except Exception as e: print("glare types?", e)
