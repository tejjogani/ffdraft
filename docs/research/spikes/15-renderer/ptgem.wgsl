// ptgem.wgsl: the same contained jewelry path tracer as ptgem.c, as one WebGPU compute shader.
// Gem = convex polyhedron (half-spaces, no BVH). Metal = triangle BVH in storage buffers.
// One wavelength per path. Runs in a browser (WebGPU), in Node (Dawn) or natively (wgpu).

struct Params {
  cam_o: vec4<f32>,
  fw: vec4<f32>,
  rt: vec4<f32>,
  up: vec4<f32>,
  gem_sphere: vec4<f32>,   // xyz centre, w radius
  misc: vec4<f32>,         // tan(half fov), cauchy A, cauchy B (nm^2), environment radiance
  ground: vec4<f32>,       // z, albedo, half size, unused
  counts: vec4<u32>,       // resolution, planes, lights, max depth
  pass_info: vec4<u32>,    // first sample index, samples this pass, seed, dispersion on
};
struct Light { c: vec4<f32>, n: vec4<f32>, u: vec4<f32>, v: vec4<f32> };  // w: radiance, area, |u|^2, |v|^2

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> planes: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> lights: array<Light>;
@group(0) @binding(3) var<storage, read> node_lo: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> node_hi: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read> node_i: array<vec4<i32>>;   // left, right, first, count
@group(0) @binding(6) var<storage, read> tri_p: array<vec4<f32>>;    // per triangle: v0, e1, e2
@group(0) @binding(7) var<storage, read> tri_n: array<vec4<f32>>;    // per triangle: n0, n1, n2
@group(0) @binding(8) var<storage, read_write> accum: array<vec4<f32>>;

const PI = 3.14159265358979;
const MISS = 0; const GROUND = 1; const LIGHT = 2; const METAL = 3; const GEM = 4;

fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn rnd(s: ptr<function, u32>) -> f32 {
  *s = pcg(*s);
  return f32(*s >> 8u) * (1.0 / 16777216.0);
}

struct Hit { kind: i32, id: i32, front: bool, t: f32, n: vec3<f32>, ng: vec3<f32> };

// Entering (from outside) or leaving (from inside) the convex gem.
fn gem_hit(o: vec3<f32>, d: vec3<f32>, inside: bool) -> vec4<f32> {   // xyz = outward normal, w = t (or -1)
  if (!inside) {
    let oc = o - P.gem_sphere.xyz;
    let b = dot(oc, d);
    let c = dot(oc, oc) - P.gem_sphere.w * P.gem_sphere.w;
    if (c > 0.0 && (b > 0.0 || b * b - c < 0.0)) { return vec4<f32>(0.0, 0.0, 0.0, -1.0); }
  }
  var tnear = -1e30; var tfar = 1e30; var n_in = vec3<f32>(0.0); var n_out = vec3<f32>(0.0);
  let np = P.counts.y;
  for (var i = 0u; i < np; i++) {
    let pl = planes[i];
    let den = dot(pl.xyz, d);
    let dist = pl.w - dot(pl.xyz, o);
    if (den < -1e-9) { let t = dist / den; if (t > tnear) { tnear = t; n_in = pl.xyz; } }
    else if (den > 1e-9) { let t = dist / den; if (t < tfar) { tfar = t; n_out = pl.xyz; } }
    else if (dist < 0.0 && !inside) { return vec4<f32>(0.0, 0.0, 0.0, -1.0); }
  }
  if (inside) { return vec4<f32>(n_out, max(tfar, 1e-6)); }
  if (tnear < tfar && tnear > 1e-5) { return vec4<f32>(n_in, tnear); }
  return vec4<f32>(0.0, 0.0, 0.0, -1.0);
}

struct TriHit { t: f32, tri: i32, u: f32, v: f32 };

fn bvh_hit(o: vec3<f32>, d: vec3<f32>, tmax: f32) -> TriHit {
  var best = TriHit(tmax, -1, 0.0, 0.0);
  let inv = 1.0 / d;
  var stack: array<i32, 40>;
  var sp = 0;
  stack[0] = 0; sp = 1;
  while (sp > 0) {
    sp -= 1;
    let ni = stack[sp];
    let ta = (node_lo[ni].xyz - o) * inv;
    let tb = (node_hi[ni].xyz - o) * inv;
    let tmin3 = min(ta, tb); let tmax3 = max(ta, tb);
    let t0 = max(max(tmin3.x, tmin3.y), max(tmin3.z, 1e-5));
    let t1 = min(min(tmax3.x, tmax3.y), min(tmax3.z, best.t));
    if (t0 > t1) { continue; }
    let nd = node_i[ni];
    if (nd.x < 0) {
      for (var k = nd.z; k < nd.z + nd.w; k++) {
        let a = tri_p[3 * k].xyz; let e1 = tri_p[3 * k + 1].xyz; let e2 = tri_p[3 * k + 2].xyz;
        let pv = cross(d, e2);
        let det = dot(e1, pv);
        if (abs(det) < 1e-12) { continue; }
        let idet = 1.0 / det;
        let tv = o - a;
        let u = dot(tv, pv) * idet;
        if (u < 0.0 || u > 1.0) { continue; }
        let qv = cross(tv, e1);
        let v = dot(d, qv) * idet;
        if (v < 0.0 || u + v > 1.0) { continue; }
        let t = dot(e2, qv) * idet;
        if (t > 1e-4 && t < best.t) { best = TriHit(t, k, u, v); }
      }
    } else if (sp < 38) {
      stack[sp] = nd.x; stack[sp + 1] = nd.y; sp += 2;
    }
  }
  return best;
}

fn trace(o: vec3<f32>, d: vec3<f32>, inside: bool, shadow: bool) -> Hit {
  var h = Hit(MISS, 0, false, 1e30, vec3<f32>(0.0), vec3<f32>(0.0));
  let g = gem_hit(o, d, inside);
  if (g.w > 0.0) { h.kind = GEM; h.t = g.w; h.n = g.xyz; h.ng = g.xyz; }
  let m = bvh_hit(o, d, h.t);
  if (m.tri >= 0) {
    let w = 1.0 - m.u - m.v;
    h.kind = METAL; h.t = m.t;
    h.n = normalize(w * tri_n[3 * m.tri].xyz + m.u * tri_n[3 * m.tri + 1].xyz + m.v * tri_n[3 * m.tri + 2].xyz);
    h.ng = normalize(cross(tri_p[3 * m.tri + 1].xyz, tri_p[3 * m.tri + 2].xyz));
  }
  if (inside) { return h; }
  if (!shadow && d.z < -1e-9) {
    let t = (P.ground.x - o.z) / d.z;
    if (t > 1e-4 && t < h.t) {
      let p = o + d * t;
      if (abs(p.x) < P.ground.z && abs(p.y) < P.ground.z) { h.kind = GROUND; h.t = t; h.n = vec3<f32>(0.0, 0.0, 1.0); h.ng = h.n; }
    }
  }
  let nl = i32(P.counts.z);
  for (var i = 0; i < nl; i++) {
    let L = lights[i];
    let den = dot(L.n.xyz, d);
    if (abs(den) < 1e-9) { continue; }
    let t = dot(L.c.xyz - o, L.n.xyz) / den;
    if (t < 1e-4 || t > h.t) { continue; }
    let q = o + d * t - L.c.xyz;
    if (abs(dot(q, L.u.xyz)) > L.u.w || abs(dot(q, L.v.xyz)) > L.v.w) { continue; }
    h.kind = LIGHT; h.t = t; h.id = i; h.front = den < 0.0; h.n = L.n.xyz;   // the back is black but blocks
  }
  return h;
}

fn gold(c: f32, lam: f32) -> f32 {
  var al = array<f32, 12>(397.0, 430.5, 450.9, 471.4, 495.9, 520.9, 548.6, 582.1, 616.8, 659.5, 704.5, 756.0);
  var an = array<f32, 12>(1.47, 1.46, 1.38, 1.31, 1.04, 0.62, 0.43, 0.29, 0.21, 0.14, 0.13, 0.14);
  var ak = array<f32, 12>(1.95, 1.96, 1.91, 1.85, 1.83, 2.08, 2.46, 2.86, 3.27, 3.70, 4.10, 4.54);
  var i = 0;
  while (i < 10 && lam > al[i + 1]) { i += 1; }
  let f = clamp((lam - al[i]) / (al[i + 1] - al[i]), 0.0, 1.0);
  let n = mix(an[i], an[i + 1], f); let k = mix(ak[i], ak[i + 1], f);
  let c2 = c * c; let s2 = 1.0 - c2; let n2 = n * n; let k2 = k * k; let t0 = n2 - k2 - s2;
  let ab = sqrt(t0 * t0 + 4.0 * n2 * k2); let t1 = ab + c2; let a = sqrt(0.5 * (ab + t0)); let t2 = 2.0 * a * c;
  let rs = (t1 - t2) / (t1 + t2); let t3 = c2 * ab + s2 * s2; let t4 = t2 * s2;
  return 0.5 * (rs + rs * (t3 - t4) / (t3 + t4));
}

fn fresnel(ci: f32, eta: f32) -> vec2<f32> {   // (reflectance, cos theta_t)
  let s2 = (1.0 - ci * ci) / (eta * eta);
  if (s2 >= 1.0) { return vec2<f32>(1.0, 0.0); }
  let ct = sqrt(1.0 - s2);
  let rs = (ci - eta * ct) / (ci + eta * ct); let rp = (eta * ci - ct) / (eta * ci + ct);
  return vec2<f32>(0.5 * (rs * rs + rp * rp), ct);
}

fn lobe(l: f32, m: f32, s1: f32, s2: f32) -> f32 { let t = (l - m) / select(s2, s1, l < m); return exp(-0.5 * t * t); }
fn cmf(l: f32) -> vec3<f32> {
  return vec3<f32>(
    1.056 * lobe(l, 599.8, 37.9, 31.0) + 0.362 * lobe(l, 442.0, 16.0, 26.7) - 0.065 * lobe(l, 501.1, 20.4, 26.2),
    0.821 * lobe(l, 568.8, 46.9, 40.5) + 0.286 * lobe(l, 530.9, 16.3, 31.1),
    1.217 * lobe(l, 437.0, 11.8, 36.0) + 0.681 * lobe(l, 459.0, 26.0, 13.8));
}

fn radiance(o_in: vec3<f32>, d_in: vec3<f32>, lam: f32, rng: ptr<function, u32>) -> f32 {
  var o = o_in; var d = d_in;
  var T = 1.0; var L = 0.0; var last_pdf = 0.0; var inside = false; var specular = true;
  let lam_n = select(589.3, lam, P.pass_info.w == 1u);
  let n_gem = P.misc.y + P.misc.z / (lam_n * lam_n);
  let nl = f32(P.counts.z);
  let maxdepth = i32(P.counts.w);
  for (var depth = 0; depth < maxdepth; depth++) {
    let h = trace(o, d, inside, false);
    if (h.kind == MISS) { L += T * P.misc.w; break; }
    let p = o + d * h.t;
    if (h.kind == LIGHT) {
      if (!h.front) { break; }
      var w = 1.0;
      if (!specular) {
        let Lt = lights[h.id];
        let pl = h.t * h.t / (Lt.n.w * abs(dot(Lt.n.xyz, d)) * nl);
        w = last_pdf * last_pdf / (last_pdf * last_pdf + pl * pl);
      }
      L += T * w * lights[h.id].c.w; break;
    }
    if (h.kind == GROUND) {
      let li = min(i32(rnd(rng) * nl), i32(P.counts.z) - 1);
      let Lt = lights[li];
      let q = Lt.c.xyz + Lt.u.xyz * (2.0 * rnd(rng) - 1.0) + Lt.v.xyz * (2.0 * rnd(rng) - 1.0);
      var w = q - p; let r2 = dot(w, w); w = w / sqrt(r2);
      let cs = w.z; let cl = -dot(Lt.n.xyz, w);
      let po = p + vec3<f32>(0.0, 0.0, 1e-3);
      if (cs > 0.0 && cl > 0.0) {
        let s = trace(po, w, false, true);
        if (s.kind == MISS || s.t > sqrt(r2) - 1e-2) {
          let pl = r2 / (Lt.n.w * cl * nl); let pb = cs / PI;
          L += T * (P.ground.y / PI) * Lt.c.w * cs / pl * (pl * pl / (pl * pl + pb * pb));
        }
      }
      let u1 = rnd(rng); let u2 = rnd(rng); let rr = sqrt(u1); let ph = 2.0 * PI * u2;
      d = vec3<f32>(rr * cos(ph), rr * sin(ph), sqrt(max(1.0 - u1, 1e-8)));
      o = po; T *= P.ground.y; last_pdf = d.z / PI; specular = false;
    } else if (h.kind == METAL) {
      var n = h.n; if (dot(n, d) > 0.0) { n = -n; }
      var ng = h.ng; if (dot(ng, d) > 0.0) { ng = -ng; }
      var r = d - n * (2.0 * dot(d, n));
      if (dot(r, ng) <= 0.0) { r = d - ng * (2.0 * dot(d, ng)); }
      T *= gold(abs(dot(d, n)), lam);
      o = p + ng * 1e-3; d = normalize(r); specular = true;
    } else {
      let entering = !inside;
      let n = select(-h.n, h.n, entering);
      let ci = -dot(d, n);
      let eta = select(1.0 / n_gem, n_gem, entering);
      let F = fresnel(ci, eta);
      if (rnd(rng) < F.x) { d = d + n * (2.0 * ci); o = p + n * 1e-4; }
      else { d = normalize(d / eta + n * (ci / eta - F.y)); o = p - n * 1e-4; inside = entering; }
      specular = true;
    }
    if (depth >= 8) { let q = min(T, 0.95); if (rnd(rng) > q) { break; } T /= q; }
  }
  return L;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let res = P.counts.x;
  if (gid.x >= res || gid.y >= res) { return; }
  let idx = gid.y * res + gid.x;
  var rng = pcg(idx ^ pcg(P.pass_info.x * 7919u + P.pass_info.z));
  let off = f32(pcg(idx * 2654435761u + 17u) >> 8u) * (1.0 / 16777216.0);
  var acc = vec3<f32>(0.0);
  for (var s = 0u; s < P.pass_info.y; s++) {
    let u = fract(off + f32(P.pass_info.x + s) * 0.61803398875);
    let lam = 380.0 + 350.0 * u;
    let px = (2.0 * (f32(gid.x) + rnd(&rng)) / f32(res) - 1.0) * P.misc.x;
    let py = (1.0 - 2.0 * (f32(gid.y) + rnd(&rng)) / f32(res)) * P.misc.x;
    let d = normalize(P.fw.xyz + P.rt.xyz * px + P.up.xyz * py);
    acc += radiance(P.cam_o.xyz, d, lam, &rng) * cmf(lam);
  }
  accum[idx] = accum[idx] + vec4<f32>(acc, f32(P.pass_info.y));
}
