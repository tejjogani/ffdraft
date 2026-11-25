"""Builds the spike scene once: a 57-facet round brilliant in a four-prong gold ring.

Outputs (in ./scene): gem.ply (flat, unindexed), metal.ply (smooth normals), gem.obj, metal.obj,
scene.json (camera, lights, gem planes, materials) and metal.bin / scene.txt for the C tracer.
Units: millimetres, right-handed, Z up. Only numpy is needed.
"""
import json
import math
import os
import struct
import numpy as np

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "scene")
os.makedirs(OUT, exist_ok=True)

# ---------------------------------------------------------------- round brilliant proportions
DIAMETER = 6.5            # mm (about 1.0 ct)
TABLE_PCT = 0.57          # table width (corner to corner) / diameter
CROWN_ANGLE = 34.5        # degrees
PAVILION_ANGLE = 40.75    # degrees
GIRDLE_PCT = 0.035        # girdle thickness at the bezel/main positions / diameter
STAR_LENGTH = 0.50        # star facet length ratio
LOWER_HALF = 0.77         # lower girdle facet length ratio
GIRDLE_SIDES = 64         # vertical girdle facets (polished, faceted girdle)
# Culet: none (pointed) -> 1 table + 8 star + 8 bezel + 16 upper girdle + 8 main + 16 lower girdle = 57.

r = DIAMETER / 2
rt = TABLE_PCT * r
crown_h = (r - rt) * math.tan(math.radians(CROWN_ANGLE))
pav_d = r * math.tan(math.radians(PAVILION_ANGLE))
girdle_h = GIRDLE_PCT * DIAMETER


def pol(rho, deg, z):
    a = math.radians(deg)
    return np.array([rho * math.cos(a), rho * math.sin(a), z])


def plane_from_points(p0, p1, p2, inside):
    n = np.cross(p1 - p0, p2 - p0)
    n /= np.linalg.norm(n)
    d = float(n @ p0)
    if n @ inside > d:  # normal must point away from the inside point
        n, d = -n, -d
    return n, d


def gem_planes():
    """Half-spaces n.x <= d in the stone's own frame: girdle mid-plane at z = 0, table up."""
    zt = girdle_h / 2            # girdle top
    zb = -girdle_h / 2           # girdle bottom
    inside = np.zeros(3)
    planes = []                   # (kind, n, d)
    planes.append(("table", np.array([0, 0, 1.0]), zt + crown_h))
    ca, pa = math.radians(CROWN_ANGLE), math.radians(PAVILION_ANGLE)
    for k in range(8):
        phi = 45.0 * k
        a = math.radians(phi)
        radial = np.array([math.cos(a), math.sin(a), 0])
        # Bezel (kite) main: through the girdle point, rising inward at the crown angle.
        n = radial * math.sin(ca) + np.array([0, 0, math.cos(ca)])
        planes.append(("bezel", n, float(n @ pol(r, phi, zt))))
        # Pavilion main: through the girdle point, falling inward at the pavilion angle.
        n = radial * math.sin(pa) - np.array([0, 0, math.cos(pa)])
        planes.append(("main", n, float(n @ pol(r, phi, zb))))

    def bezel_z(rho, phi_k, phi):
        """Height of bezel plane k above azimuth phi at radius rho."""
        a, ak = math.radians(phi), math.radians(phi_k)
        s = rho * math.cos(a - ak)   # distance along the plane's own radial direction
        return zt + (r - s) * math.tan(ca)

    def main_z(rho, phi_k, phi):
        a, ak = math.radians(phi), math.radians(phi_k)
        s = rho * math.cos(a - ak)
        return zb - (r - s) * math.tan(pa)

    for k in range(8):
        phi0, phi1, mid = 45.0 * k, 45.0 * (k + 1), 45.0 * k + 22.5
        # Star: through two table corners and the point S where two bezels, a star and two
        # upper girdle facets meet. S sits STAR_LENGTH of the way from the table edge to the girdle.
        d_table_edge = rt * math.cos(math.radians(22.5))
        rho_s = d_table_edge + STAR_LENGTH * (r - d_table_edge)
        S = pol(rho_s, mid, bezel_z(rho_s, phi0, mid))
        T0, T1 = pol(rt, phi0, zt + crown_h), pol(rt, phi1, zt + crown_h)
        planes.append(("star", *plane_from_points(T0, T1, S, inside)))
        # Upper girdle (upper halves): S, the bezel's girdle point, and the girdle mid point.
        M = pol(r, mid, zt)
        planes.append(("upper", *plane_from_points(S, pol(r, phi0, zt), M, inside)))
        planes.append(("upper", *plane_from_points(S, M, pol(r, phi1, zt), inside)))
        # Lower girdle (lower halves): reach LOWER_HALF of the way from girdle to culet.
        rho_l = r * (1 - LOWER_HALF)
        L = pol(rho_l, mid, main_z(rho_l, phi0, mid))
        Mb = pol(r, mid, zb)
        planes.append(("lower", *plane_from_points(L, pol(r, phi0, zb), Mb, inside)))
        planes.append(("lower", *plane_from_points(L, Mb, pol(r, phi1, zb), inside)))
    for i in range(GIRDLE_SIDES):
        a = 2 * math.pi * i / GIRDLE_SIDES
        planes.append(("girdle", np.array([math.cos(a), math.sin(a), 0.0]), r))
    return planes


def clip_polygon(poly, n, d):
    """Sutherland-Hodgman: keep the part of a convex polygon with n.x <= d."""
    out = []
    m = len(poly)
    for i in range(m):
        a, b = poly[i], poly[(i + 1) % m]
        da, db = n @ a - d, n @ b - d
        if da <= 1e-12:
            out.append(a)
        if (da < -1e-12 and db > 1e-12) or (da > 1e-12 and db < -1e-12):
            t = da / (da - db)
            out.append(a + t * (b - a))
    return out


def polyhedron_faces(planes):
    faces = []
    for i, (kind, n, d) in enumerate(planes):
        # A large square on plane i, wound counter-clockwise seen from outside.
        u = np.cross(n, [0, 0, 1.0] if abs(n[2]) < 0.9 else [1.0, 0, 0])
        u /= np.linalg.norm(u)
        v = np.cross(n, u)
        c = n * d
        big = 50.0
        poly = [c + big * (-u - v), c + big * (u - v), c + big * (u + v), c + big * (-u + v)]
        for j, (_, nj, dj) in enumerate(planes):
            if j == i:
                continue
            poly = clip_polygon(poly, nj, dj)
            if len(poly) < 3:
                break
        # Drop duplicate points.
        clean = []
        for p in poly:
            if not clean or np.linalg.norm(p - clean[-1]) > 1e-7:
                clean.append(p)
        if len(clean) > 1 and np.linalg.norm(clean[0] - clean[-1]) < 1e-7:
            clean.pop()
        if len(clean) >= 3:
            faces.append((kind, n, clean))
    return faces


# ---------------------------------------------------------------- metal: band, rail, prongs
def torus(R, a_radial, a_axial, nu, nv, center, axis="y"):
    """Elliptical-section torus. axis 'y': ring lies in the XZ plane. 'z': in the XY plane."""
    V, N, F = [], [], []
    for i in range(nu):
        u = 2 * math.pi * i / nu
        cu, su = math.cos(u), math.sin(u)
        for j in range(nv):
            v = 2 * math.pi * j / nv
            cv, sv = math.cos(v), math.sin(v)
            rad = R + a_radial * cv
            ax = a_axial * sv
            # Normal of an ellipse (a cos v, b sin v) is (cos v / a, sin v / b), normalised.
            nr, na = cv / a_radial, sv / a_axial
            ln = math.hypot(nr, na)
            nr, na = nr / ln, na / ln
            if axis == "y":
                V.append([rad * cu, ax, rad * su]); N.append([nr * cu, na, nr * su])
            else:
                V.append([rad * cu, rad * su, ax]); N.append([nr * cu, nr * su, na])
    for i in range(nu):
        for j in range(nv):
            a = i * nv + j; b = ((i + 1) % nu) * nv + j
            c = ((i + 1) % nu) * nv + (j + 1) % nv; d = i * nv + (j + 1) % nv
            F += [[a, b, c], [a, c, d]]
    V = np.array(V) + np.array(center); N = np.array(N); F = np.array(F)
    return fix_winding(V, N, F)


def fix_winding(V, N, F):
    """Make each triangle's geometric normal agree with its vertex normals."""
    g = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    s = np.einsum("ij,ij->i", g, N[F[:, 0]] + N[F[:, 1]] + N[F[:, 2]])
    F = F.copy(); flip = s < 0
    F[flip] = F[flip][:, ::-1]
    return V, N, F


def catmull(points, per_seg):
    P = [points[0]] + list(points) + [points[-1]]
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for s in range(per_seg):
            t = s / per_seg
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(points[-1])
    return np.array(out)


def tube(path, radius, sides=16, cap_rings=6):
    """A round wire along `path` with hemispherical ends, smooth normals."""
    path = np.asarray(path)
    tang = np.gradient(path, axis=0)
    tang /= np.linalg.norm(tang, axis=1)[:, None]
    # Parallel-transport frame.
    n0 = np.cross(tang[0], [0, 0, 1.0])
    if np.linalg.norm(n0) < 1e-6:
        n0 = np.cross(tang[0], [1.0, 0, 0])
    n0 /= np.linalg.norm(n0)
    frames = [n0]
    for i in range(1, len(path)):
        n = frames[-1] - tang[i] * (frames[-1] @ tang[i])
        frames.append(n / np.linalg.norm(n))
    rings_c, rings_r, rings_ax, rings_n, rings_b = [], [], [], [], []
    # start cap (from the pole outwards), body, end cap
    for q in range(cap_rings, 0, -1):
        a = (math.pi / 2) * q / cap_rings
        rings_c.append(path[0] - tang[0] * radius * math.sin(a)); rings_r.append(math.cos(a))
        rings_ax.append(-math.sin(a)); rings_n.append(frames[0]); rings_b.append(tang[0])
    for i in range(len(path)):
        rings_c.append(path[i]); rings_r.append(1.0); rings_ax.append(0.0)
        rings_n.append(frames[i]); rings_b.append(tang[i])
    for q in range(1, cap_rings + 1):
        a = (math.pi / 2) * q / cap_rings
        rings_c.append(path[-1] + tang[-1] * radius * math.sin(a)); rings_r.append(math.cos(a))
        rings_ax.append(math.sin(a)); rings_n.append(frames[-1]); rings_b.append(tang[-1])
    V, N = [], []
    for c, rr, ax, n, t in zip(rings_c, rings_r, rings_ax, rings_n, rings_b):
        b = np.cross(t, n)
        for s in range(sides):
            a = 2 * math.pi * s / sides
            radial = math.cos(a) * n + math.sin(a) * b
            V.append(c + radius * max(rr, 1e-4) * radial)
            nn = rr * radial + ax * t
            N.append(nn / np.linalg.norm(nn))
    F = []
    nr = len(rings_c)
    for i in range(nr - 1):
        for s in range(sides):
            a = i * sides + s; b = i * sides + (s + 1) % sides
            c = (i + 1) * sides + (s + 1) % sides; d = (i + 1) * sides + s
            F += [[a, b, c], [a, c, d]]
    return fix_winding(np.array(V), np.array(N), np.array(F))


def merge(parts):
    V, N, F, off = [], [], [], 0
    for v, n, f in parts:
        V.append(v); N.append(n); F.append(f + off); off += len(v)
    return np.vstack(V), np.vstack(N), np.vstack(F)


# ---------------------------------------------------------------- assemble
BAND_INNER_R = 8.5        # 17.0 mm inner diameter (about US 6.5)
BAND_HALF_T = 0.85        # radial half thickness
BAND_HALF_W = 1.2         # half width along the ring axis
BAND_RC = BAND_INNER_R + BAND_HALF_T
BAND_OUT = BAND_RC + BAND_HALF_T
band_top = 2 * BAND_OUT
CULET_Z = band_top + 0.25
GEM_Z = CULET_Z + pav_d + girdle_h / 2     # girdle mid-plane height in the scene
PRONG_R = 0.42

planes = gem_planes()
faces = polyhedron_faces(planes)
kinds = {}
for k, _, _ in faces:
    kinds[k] = kinds.get(k, 0) + 1
gem_offset = np.array([0, 0, GEM_Z])

gem_tris, gem_norms = [], []
for kind, n, poly in faces:
    for i in range(1, len(poly) - 1):
        tri = [poly[0] + gem_offset, poly[i] + gem_offset, poly[i + 1] + gem_offset]
        if np.cross(tri[1] - tri[0], tri[2] - tri[0]) @ n < 0:
            tri = tri[::-1]
        gem_tris.append(tri); gem_norms.append(n)
gem_tris = np.array(gem_tris); gem_norms = np.array(gem_norms)

zt_s = GEM_Z + girdle_h / 2
parts = [torus(BAND_RC, BAND_HALF_T, BAND_HALF_W, 160, 32, (0, 0, BAND_OUT), "y"),
         torus(2.55, 0.30, 0.30, 72, 16, (0, 0, CULET_Z + 1.30), "z")]
for k in range(4):
    az = 45 + 90 * k
    def P(rho, z):
        return pol(rho, az, z)
    crown_z = lambda rho: zt_s + (r - rho) * math.tan(math.radians(CROWN_ANGLE))
    path = catmull([P(0.95, band_top - 0.55), P(1.55, CULET_Z + 0.45), P(2.55, CULET_Z + 1.30),
                    P(r + PRONG_R - 0.06, GEM_Z - 0.55), P(r + PRONG_R - 0.06, GEM_Z + 0.15),
                    P(r + 0.12, zt_s + 0.42), P(r - 0.42, crown_z(r - 0.42) + PRONG_R - 0.07)], 8)
    parts.append(tube(path, PRONG_R, 16, 6))
mV, mN, mF = merge(parts)


def write_ply(path, V, N, F):
    with open(path, "wb") as f:
        f.write(("ply\nformat binary_little_endian 1.0\nelement vertex %d\n"
                 "property float x\nproperty float y\nproperty float z\n"
                 "property float nx\nproperty float ny\nproperty float nz\n"
                 "element face %d\nproperty list uchar int vertex_indices\nend_header\n"
                 % (len(V), len(F))).encode())
        f.write(np.hstack([V, N]).astype("<f4").tobytes())
        for tri in F:
            f.write(struct.pack("<Biii", 3, *[int(i) for i in tri]))


def write_obj(path, V, N, F):
    with open(path, "w") as f:
        for v in V: f.write("v %.6f %.6f %.6f\n" % tuple(v))
        for n in N: f.write("vn %.6f %.6f %.6f\n" % tuple(n))
        for a, b, c in F + 1: f.write("f %d//%d %d//%d %d//%d\n" % (a, a, b, b, c, c))


gV = gem_tris.reshape(-1, 3); gN = np.repeat(gem_norms, 3, axis=0)
gF = np.arange(len(gV)).reshape(-1, 3)
write_ply(os.path.join(OUT, "gem.ply"), gV, gN, gF)
write_ply(os.path.join(OUT, "metal.ply"), mV, mN, mF)
write_obj(os.path.join(OUT, "gem.obj"), gV, gN, gF)
write_obj(os.path.join(OUT, "metal.obj"), mV, mN, mF)

# ---------------------------------------------------------------- camera and studio
def camera(az_deg, el_deg, dist, target, vfov):
    a, e = math.radians(az_deg), math.radians(el_deg)
    pos = np.array(target) + dist * np.array([math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e)])
    return {"origin": pos.tolist(), "target": list(target), "up": [0, 0, 1], "vfov": vfov}

CAM_AZ = -55.0
cameras = {
    "hero": camera(CAM_AZ, 25.0, 105.0, (0, 0, 13.3), 18.0),
    "macro": camera(CAM_AZ, 52.0, 105.0, (0, 0, GEM_Z + 0.25), 5.6),
}


def panel(name, az_deg, el_deg, dist, w, h, radiance, target=(0, 0, 12.0)):
    """A one-sided rectangular emitter facing the target. Returns centre and half-edge vectors."""
    a, e = math.radians(az_deg), math.radians(el_deg)
    c = np.array(target) + dist * np.array([math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e)])
    n = (np.array(target) - c); n /= np.linalg.norm(n)
    u = np.cross(n, [0, 0, 1.0])
    if np.linalg.norm(u) < 1e-6:
        u = np.array([1.0, 0, 0])
    u /= np.linalg.norm(u)
    v = np.cross(u, n)
    return {"name": name, "center": c.tolist(), "normal": n.tolist(),
            "u": (u * w / 2).tolist(), "v": (v * h / 2).tolist(), "radiance": radiance}

lights = [
    panel("top", 0, 90, 170, 130, 130, 5.0),
    panel("key", CAM_AZ - 55, 38, 210, 110, 150, 9.0),
    panel("fill", CAM_AZ + 70, 22, 210, 45, 170, 3.5),
    panel("rim", CAM_AZ + 170, 32, 210, 35, 160, 8.0),
    panel("spark1", CAM_AZ - 20, 62, 260, 7, 7, 900.0),
    panel("spark2", CAM_AZ + 35, 48, 260, 7, 7, 900.0),
    panel("spark3", CAM_AZ - 95, 70, 260, 7, 7, 900.0),
]

# Diamond: Cauchy fit n = A + B / lambda^2 (nm) from n_d = 2.417 and Abbe 55.3.
ND, ABBE = 2.417, 55.3
B = ((ND - 1) / ABBE) / (1 / 486.13 ** 2 - 1 / 656.27 ** 2)
A = ND - B / 589.3 ** 2

scene = {
    "units": "mm",
    "proportions": {"diameter": DIAMETER, "table": TABLE_PCT, "crownAngle": CROWN_ANGLE,
                    "pavilionAngle": PAVILION_ANGLE, "girdle": GIRDLE_PCT, "starLength": STAR_LENGTH,
                    "lowerHalf": LOWER_HALF, "crownHeightPct": crown_h / DIAMETER,
                    "pavilionDepthPct": pav_d / DIAMETER,
                    "totalDepthPct": (crown_h + pav_d + girdle_h) / DIAMETER, "facets": kinds},
    "gem": {"offset": gem_offset.tolist(), "ior": ND, "abbe": ABBE, "cauchyA": A, "cauchyB_nm2": B,
            "planes": [{"kind": k, "n": n.tolist(), "d": float(d + n @ gem_offset)} for k, n, d in planes]},
    "metal": {"name": "Au", "roughnessAlpha": 0.01, "rgb": [1.0, 0.766, 0.336], "edgeTint": [0.97, 1.0, 0.98]},
    "ground": {"z": 0.0, "albedo": 0.8, "halfSize": 400.0},
    "environment": {"radiance": 0.35},
    "cameras": cameras,
    "lights": lights,
    "counts": {"gemTriangles": int(len(gF)), "metalTriangles": int(len(mF)), "metalVertices": int(len(mV))},
}
with open(os.path.join(OUT, "scene.json"), "w") as f:
    json.dump(scene, f, indent=1)

# Flat files for the C tracer.
with open(os.path.join(OUT, "metal.bin"), "wb") as f:
    f.write(struct.pack("<ii", len(mV), len(mF)))
    f.write(mV.astype("<f4").tobytes()); f.write(mN.astype("<f4").tobytes())
    f.write(mF.astype("<i4").tobytes())
with open(os.path.join(OUT, "gem.bin"), "wb") as f:
    f.write(struct.pack("<ii", len(gV), len(gF)))
    f.write(gV.astype("<f4").tobytes()); f.write(gN.astype("<f4").tobytes())
    f.write(gF.astype("<i4").tobytes())
gem_centre = gV.mean(axis=0)
gem_radius = float(np.linalg.norm(gV - gem_centre, axis=1).max()) * 1.001
with open(os.path.join(OUT, "scene.txt"), "w") as f:
    f.write("gemsphere %.6f %.6f %.6f %.6f\n" % (*gem_centre, gem_radius))
    f.write("planes %d\n" % len(planes))
    for k, n, d in planes:
        f.write("%.9f %.9f %.9f %.9f\n" % (n[0], n[1], n[2], d + n @ gem_offset))
    f.write("cauchy %.9f %.6f\n" % (A, B))
    f.write("ground %.3f %.3f %.1f\n" % (0.0, 0.8, 400.0))
    f.write("env %.4f\n" % 0.35)
    f.write("lights %d\n" % len(lights))
    for L in lights:
        f.write(" ".join("%.6f" % x for x in L["center"] + L["normal"] + L["u"] + L["v"] + [L["radiance"]]) + "\n")
    for name, c in cameras.items():
        f.write("camera %s %s %.4f\n" % (name, " ".join("%.6f" % x for x in c["origin"] + c["target"]), c["vfov"]))

print("facets:", kinds, "total non-girdle:", sum(v for k, v in kinds.items() if k != "girdle"))
print("crown height %.2f%%  pavilion depth %.2f%%  total depth %.2f%%" %
      (100 * crown_h / DIAMETER, 100 * pav_d / DIAMETER, 100 * (crown_h + pav_d + girdle_h) / DIAMETER))
print("gem triangles", len(gF), "metal triangles", len(mF))
print("cauchy A=%.5f B=%.1f nm^2  n(430.8)-n(686.7)=%.4f" % (A, B, B * (1 / 430.8 ** 2 - 1 / 686.7 ** 2)))
print("gem z: culet %.3f girdle %.3f table %.3f" % (CULET_Z, GEM_Z, GEM_Z + girdle_h / 2 + crown_h))
