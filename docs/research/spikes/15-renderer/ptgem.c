/* ptgem.c: a contained jewelry path tracer, as a spike.
 *
 * What it proves: a gem treated as a convex polyhedron (a list of half-spaces, no BVH, no
 * triangles), one wavelength per path (so dispersion is exact Snell refraction at that
 * wavelength), spectral gold from n,k data, rectangular studio lights, a diffuse ground with
 * next-event estimation and MIS, and metal as a triangle mesh in a small BVH.
 *
 * build: gcc -O3 -march=native -fopenmp ptgem.c -o ptgem -lm
 * usage: ./ptgem <scene dir> <camera> <res> <spp> <max depth> <out.raw> [nodisp] [meshgem]
 * Output: res*res*3 float32, linear sRGB, top row first.
 */
#include <math.h>
#include <omp.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

typedef struct { double x, y, z; } V;
static inline V v3(double x, double y, double z) { V r = {x, y, z}; return r; }
static inline V add(V a, V b) { return v3(a.x + b.x, a.y + b.y, a.z + b.z); }
static inline V sub(V a, V b) { return v3(a.x - b.x, a.y - b.y, a.z - b.z); }
static inline V mul(V a, double s) { return v3(a.x * s, a.y * s, a.z * s); }
static inline double dot(V a, V b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
static inline V cross(V a, V b) { return v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x); }
static inline V norm(V a) { return mul(a, 1.0 / sqrt(dot(a, a))); }

/* ------------------------------------------------------------------ scene */
#define MAXP 256
static int nplanes; static V pn[MAXP]; static double pd[MAXP];
static V gem_c; static double gem_r;
static double cauchyA, cauchyB, ground_z, ground_albedo, ground_half, env_L;
typedef struct { V c, n, u, v; double L, area, ulen2, vlen2; } Light;
static int nlights; static Light lights[16];
static V cam_o, cam_t; static double cam_fov;

typedef struct { int nv, nt; float *P, *N; int *F; } Mesh;
typedef struct { float lo[3], hi[3]; int left, right, first, count; } Node;
typedef struct { Mesh m; Node *nodes; int nnodes; int *order; } Bvh;
static Bvh metal, gemmesh;
static int use_meshgem = 0, use_disp = 1;

static void load_mesh(const char *path, Mesh *m) {
  FILE *f = fopen(path, "rb"); if (!f) { perror(path); exit(1); }
  if (fread(&m->nv, 4, 1, f) != 1 || fread(&m->nt, 4, 1, f) != 1) exit(1);
  m->P = malloc(12 * m->nv); m->N = malloc(12 * m->nv); m->F = malloc(12 * m->nt);
  if (fread(m->P, 12, m->nv, f) != (size_t)m->nv) exit(1);
  if (fread(m->N, 12, m->nv, f) != (size_t)m->nv) exit(1);
  if (fread(m->F, 12, m->nt, f) != (size_t)m->nt) exit(1);
  fclose(f);
}

static void tri_bounds(const Mesh *m, int t, float *lo, float *hi) {
  for (int a = 0; a < 3; a++) { lo[a] = 1e30f; hi[a] = -1e30f; }
  for (int k = 0; k < 3; k++) for (int a = 0; a < 3; a++) {
    float p = m->P[3 * m->F[3 * t + k] + a];
    if (p < lo[a]) lo[a] = p; if (p > hi[a]) hi[a] = p;
  }
}
static const Mesh *sort_mesh; static int sort_axis;
static int cmp_centroid(const void *a, const void *b) {
  float lo[3], hi[3], ca, cb;
  tri_bounds(sort_mesh, *(const int *)a, lo, hi); ca = lo[sort_axis] + hi[sort_axis];
  tri_bounds(sort_mesh, *(const int *)b, lo, hi); cb = lo[sort_axis] + hi[sort_axis];
  return (ca > cb) - (ca < cb);
}
static int build(Bvh *b, int first, int count) {
  int id = b->nnodes++; Node *n = &b->nodes[id];
  for (int a = 0; a < 3; a++) { n->lo[a] = 1e30f; n->hi[a] = -1e30f; }
  for (int i = first; i < first + count; i++) {
    float lo[3], hi[3]; tri_bounds(&b->m, b->order[i], lo, hi);
    for (int a = 0; a < 3; a++) { if (lo[a] < n->lo[a]) n->lo[a] = lo[a]; if (hi[a] > n->hi[a]) n->hi[a] = hi[a]; }
  }
  if (count <= 4) { n->left = n->right = -1; n->first = first; n->count = count; return id; }
  int axis = 0; float ext = n->hi[0] - n->lo[0];
  for (int a = 1; a < 3; a++) if (n->hi[a] - n->lo[a] > ext) { ext = n->hi[a] - n->lo[a]; axis = a; }
  sort_mesh = &b->m; sort_axis = axis;
  qsort(b->order + first, count, sizeof(int), cmp_centroid);
  int half = count / 2;
  int l = build(b, first, half), r = build(b, first + half, count - half);
  b->nodes[id].left = l; b->nodes[id].right = r; b->nodes[id].count = 0;
  return id;
}
static void make_bvh(Bvh *b) {
  b->nodes = malloc(sizeof(Node) * 2 * b->m.nt); b->order = malloc(sizeof(int) * b->m.nt); b->nnodes = 0;
  for (int i = 0; i < b->m.nt; i++) b->order[i] = i;
  build(b, 0, b->m.nt);
}


/* Closest hit in a triangle BVH. Returns t or -1; fills triangle id and barycentrics. */
static double bvh_hit(const Bvh *b, V o, V d, double tmax, int *tri, double *bu, double *bv) {
  double inv[3] = {1 / d.x, 1 / d.y, 1 / d.z}, oo[3] = {o.x, o.y, o.z}, best = tmax; int hit = -1;
  int stack[64], sp = 0; stack[sp++] = 0;
  while (sp) {
    const Node *n = &b->nodes[stack[--sp]];
    double t0 = 1e-7, t1 = best; int ok = 1;
    for (int a = 0; a < 3; a++) {
      double ta = (n->lo[a] - oo[a]) * inv[a], tb = (n->hi[a] - oo[a]) * inv[a];
      if (ta > tb) { double s = ta; ta = tb; tb = s; }
      if (ta > t0) t0 = ta; if (tb < t1) t1 = tb;
      if (t0 > t1) { ok = 0; break; }
    }
    if (!ok) continue;
    if (n->left < 0) {
      for (int i = n->first; i < n->first + n->count; i++) {
        int t = b->order[i]; const float *p = b->m.P; const int *f = &b->m.F[3 * t];
        V a = v3(p[3 * f[0]], p[3 * f[0] + 1], p[3 * f[0] + 2]);
        V e1 = sub(v3(p[3 * f[1]], p[3 * f[1] + 1], p[3 * f[1] + 2]), a);
        V e2 = sub(v3(p[3 * f[2]], p[3 * f[2] + 1], p[3 * f[2] + 2]), a);
        V pv = cross(d, e2); double det = dot(e1, pv);
        if (fabs(det) < 1e-14) continue;
        double id = 1 / det; V tv = sub(o, a);
        double u = dot(tv, pv) * id; if (u < 0 || u > 1) continue;
        V qv = cross(tv, e1); double v = dot(d, qv) * id; if (v < 0 || u + v > 1) continue;
        double tt = dot(e2, qv) * id;
        if (tt > 1e-6 && tt < best) { best = tt; hit = t; *bu = u; *bv = v; }
      }
    } else { stack[sp++] = n->left; stack[sp++] = n->right; }
  }
  *tri = hit; return hit >= 0 ? best : -1;
}

/* The analytic gem: entering (from outside) or leaving (from inside) a convex polyhedron. */
static double gem_planes_hit(V o, V d, int inside, int *plane) {
  if (!inside) {
    V oc = sub(o, gem_c); double b = dot(oc, d), c = dot(oc, oc) - gem_r * gem_r;
    if (c > 0 && (b > 0 || b * b - c < 0)) return -1;   /* misses the bounding sphere */
  }
  double tnear = -1e30, tfar = 1e30; int in_idx = -1, out_idx = -1;
  for (int i = 0; i < nplanes; i++) {
    double den = dot(pn[i], d), dist = pd[i] - dot(pn[i], o);
    if (den < -1e-12) { double t = dist / den; if (t > tnear) { tnear = t; in_idx = i; } }
    else if (den > 1e-12) { double t = dist / den; if (t < tfar) { tfar = t; out_idx = i; } }
    else if (dist < 0 && !inside) return -1;
  }
  if (inside) { *plane = out_idx; return tfar > 0 ? tfar : 1e-9; }
  if (tnear < tfar && tnear > 1e-7) { *plane = in_idx; return tnear; }
  return -1;
}

/* ------------------------------------------------------------------ optics */
static const double au_l[] = {397, 430.5, 450.9, 471.4, 495.9, 520.9, 548.6, 582.1, 616.8, 659.5, 704.5, 756};
static const double au_n[] = {1.47, 1.46, 1.38, 1.31, 1.04, 0.62, 0.43, 0.29, 0.21, 0.14, 0.13, 0.14};
static const double au_k[] = {1.95, 1.96, 1.91, 1.85, 1.83, 2.08, 2.46, 2.86, 3.27, 3.70, 4.10, 4.54};
static double conductor(double c, double lam) {
  int i = 0; while (i < 10 && lam > au_l[i + 1]) i++;
  double f = (lam - au_l[i]) / (au_l[i + 1] - au_l[i]); if (f < 0) f = 0; if (f > 1) f = 1;
  double n = au_n[i] + f * (au_n[i + 1] - au_n[i]), k = au_k[i] + f * (au_k[i + 1] - au_k[i]);
  double c2 = c * c, s2 = 1 - c2, n2 = n * n, k2 = k * k, t0 = n2 - k2 - s2;
  double ab = sqrt(t0 * t0 + 4 * n2 * k2), t1 = ab + c2, a = sqrt(0.5 * (ab + t0)), t2 = 2 * a * c;
  double rs = (t1 - t2) / (t1 + t2), t3 = c2 * ab + s2 * s2, t4 = t2 * s2;
  return 0.5 * (rs + rs * (t3 - t4) / (t3 + t4));
}
static double fresnel(double ci, double eta, double *ct) {   /* eta = n_t / n_i */
  double s2 = (1 - ci * ci) / (eta * eta);
  if (s2 >= 1) { *ct = 0; return 1; }
  *ct = sqrt(1 - s2);
  double rs = (ci - eta * *ct) / (ci + eta * *ct), rp = (eta * ci - *ct) / (eta * ci + *ct);
  return 0.5 * (rs * rs + rp * rp);
}
static double gs(double l, double m, double s1, double s2) { double t = (l - m) / (l < m ? s1 : s2); return exp(-0.5 * t * t); }
static void cmf(double l, double *x, double *y, double *z) {   /* Wyman, Sloan, Shirley 2013 fit */
  *x = 1.056 * gs(l, 599.8, 37.9, 31.0) + 0.362 * gs(l, 442.0, 16.0, 26.7) - 0.065 * gs(l, 501.1, 20.4, 26.2);
  *y = 0.821 * gs(l, 568.8, 46.9, 40.5) + 0.286 * gs(l, 530.9, 16.3, 31.1);
  *z = 1.217 * gs(l, 437.0, 11.8, 36.0) + 0.681 * gs(l, 459.0, 26.0, 13.8);
}

typedef struct { uint64_t s; } Rng;
static inline double rnd(Rng *r) {
  r->s = r->s * 6364136223846793005ULL + 1442695040888963407ULL;
  uint32_t x = (uint32_t)(((r->s >> 18u) ^ r->s) >> 27u), rot = (uint32_t)(r->s >> 59u);
  return ((x >> rot) | (x << ((-rot) & 31))) * (1.0 / 4294967296.0);
}

enum { MISS, GROUND, LIGHT, METAL, GEM };
typedef struct { int kind, id, front; double t; V n, ng; } Hit;

/* Returns 1 for the emitting face, 2 for the back (which is black but still blocks light). */
static int light_hit(const Light *L, V o, V d, double tmax, double *t) {
  double den = dot(L->n, d); if (fabs(den) < 1e-12) return 0;
  double tt = dot(sub(L->c, o), L->n) / den; if (tt < 1e-6 || tt > tmax) return 0;
  V p = sub(add(o, mul(d, tt)), L->c);
  if (fabs(dot(p, L->u)) > L->ulen2 || fabs(dot(p, L->v)) > L->vlen2) return 0;
  *t = tt; return den < 0 ? 1 : 2;
}

static void trace(V o, V d, int inside, Hit *h, int shadow) {
  h->kind = MISS; h->t = 1e30;
  int tri; double bu, bv, t;
  if (use_meshgem) {
    t = bvh_hit(&gemmesh, o, d, h->t, &tri, &bu, &bv);
    if (t > 0) { const float *N = gemmesh.m.N; int v0 = gemmesh.m.F[3 * tri];
      h->kind = GEM; h->t = t; h->n = h->ng = v3(N[3 * v0], N[3 * v0 + 1], N[3 * v0 + 2]); }
  } else {
    int pl; t = gem_planes_hit(o, d, inside, &pl);
    if (t > 0 && pl >= 0) { h->kind = GEM; h->t = t; h->n = h->ng = pn[pl]; }
  }
  t = bvh_hit(&metal, o, d, h->t, &tri, &bu, &bv);
  if (t > 0) {
    const Mesh *m = &metal.m; const int *f = &m->F[3 * tri]; const float *N = m->N, *P = m->P;
    double w = 1 - bu - bv;
    h->kind = METAL; h->t = t;
    h->n = norm(v3(w * N[3 * f[0]] + bu * N[3 * f[1]] + bv * N[3 * f[2]],
                   w * N[3 * f[0] + 1] + bu * N[3 * f[1] + 1] + bv * N[3 * f[2] + 1],
                   w * N[3 * f[0] + 2] + bu * N[3 * f[1] + 2] + bv * N[3 * f[2] + 2]));
    V a = v3(P[3 * f[0]], P[3 * f[0] + 1], P[3 * f[0] + 2]);
    h->ng = norm(cross(sub(v3(P[3 * f[1]], P[3 * f[1] + 1], P[3 * f[1] + 2]), a),
                       sub(v3(P[3 * f[2]], P[3 * f[2] + 1], P[3 * f[2] + 2]), a)));
  }
  if (inside) return;
  if (!shadow && d.z < -1e-12) {
    t = (ground_z - o.z) / d.z;
    if (t > 1e-6 && t < h->t) { V p = add(o, mul(d, t));
      if (fabs(p.x) < ground_half && fabs(p.y) < ground_half) { h->kind = GROUND; h->t = t; h->n = h->ng = v3(0, 0, 1); } }
  }
  for (int i = 0; i < nlights; i++) { int side = light_hit(&lights[i], o, d, h->t, &t);
    if (side) { h->kind = LIGHT; h->t = t; h->id = i; h->front = side == 1; h->n = lights[i].n; } }
}

/* Radiance along one path at one wavelength (nm). */
static double radiance(V o, V d, double lam, int maxdepth, Rng *rng, uint64_t *rays) {
  double T = 1, L = 0, last_pdf = 0; int inside = 0, specular = 1;
  double n_gem = use_disp ? cauchyA + cauchyB / (lam * lam) : cauchyA + cauchyB / (589.3 * 589.3);
  for (int depth = 0; depth < maxdepth; depth++) {
    Hit h; trace(o, d, inside, &h, 0); (*rays)++;
    if (h.kind == MISS) { L += T * env_L; break; }
    V p = add(o, mul(d, h.t));
    if (h.kind == LIGHT) {
      if (!h.front) break;                                  /* the back of a soft box is black */
      double w = 1;
      if (!specular) { const Light *Lt = &lights[h.id];
        double pl = h.t * h.t / (Lt->area * fabs(dot(Lt->n, d)) * nlights);
        w = last_pdf * last_pdf / (last_pdf * last_pdf + pl * pl); }
      L += T * w * lights[h.id].L; break;
    }
    if (h.kind == GROUND) {
      /* Next-event estimation: one light, one point, MIS with the cosine lobe. */
      int li = (int)(rnd(rng) * nlights); if (li >= nlights) li = nlights - 1;
      const Light *Lt = &lights[li];
      V q = add(Lt->c, add(mul(Lt->u, 2 * rnd(rng) - 1), mul(Lt->v, 2 * rnd(rng) - 1)));
      V w = sub(q, p); double r2 = dot(w, w); w = mul(w, 1 / sqrt(r2));
      double cs = w.z, cl = -dot(Lt->n, w);
      if (cs > 0 && cl > 0) {
        Hit s; trace(add(p, v3(0, 0, 1e-5)), w, 0, &s, 1); (*rays)++;
        if (s.kind == MISS || s.t > sqrt(r2) - 1e-3) {
          double pl = r2 / (Lt->area * cl * nlights), pb = cs / M_PI;
          L += T * (ground_albedo / M_PI) * Lt->L * cs / pl * (pl * pl / (pl * pl + pb * pb));
        }
      }
      double u1 = rnd(rng), u2 = rnd(rng), rr = sqrt(u1), ph = 2 * M_PI * u2;
      d = v3(rr * cos(ph), rr * sin(ph), sqrt(1 - u1));
      o = add(p, v3(0, 0, 1e-5)); T *= ground_albedo; last_pdf = d.z / M_PI; specular = 0;
    } else if (h.kind == METAL) {
      V n = h.n; if (dot(n, d) > 0) n = mul(n, -1);
      V ng = h.ng; if (dot(ng, d) > 0) ng = mul(ng, -1);
      V r = sub(d, mul(n, 2 * dot(d, n)));
      if (dot(r, ng) <= 0) r = sub(d, mul(ng, 2 * dot(d, ng)));   /* shading normal leak guard */
      T *= conductor(fabs(dot(d, n)), lam);
      o = add(p, mul(ng, 1e-5)); d = norm(r); specular = 1;
    } else { /* GEM: h.n is the outward facet normal */
      int entering = use_meshgem ? dot(h.n, d) < 0 : !inside;
      V n = entering ? h.n : mul(h.n, -1);                 /* n faces the incoming ray */
      double ci = -dot(d, n), eta = entering ? n_gem : 1 / n_gem, ct;
      double F = fresnel(ci, eta, &ct);
      if (rnd(rng) < F) { d = add(d, mul(n, 2 * ci)); o = add(p, mul(n, 1e-6)); }
      else { d = norm(add(mul(d, 1 / eta), mul(n, ci / eta - ct))); o = sub(p, mul(n, 1e-6)); inside = entering; }
      specular = 1;
    }
    if (depth >= 8) { double q = T < 0.95 ? T : 0.95; if (rnd(rng) > q) break; T /= q; }
  }
  return L;
}

int main(int argc, char **argv) {
  if (argc < 7) { fprintf(stderr, "usage: ptgem dir camera res spp depth out.raw [nodisp] [meshgem]\n"); return 1; }
  const char *dir = argv[1], *camname = argv[2]; int res = atoi(argv[3]), spp = atoi(argv[4]), maxdepth = atoi(argv[5]);
  for (int i = 7; i < argc; i++) { if (!strcmp(argv[i], "nodisp")) use_disp = 0; if (!strcmp(argv[i], "meshgem")) use_meshgem = 1; }
  char path[1024], word[64]; snprintf(path, sizeof path, "%s/scene.txt", dir);
  FILE *f = fopen(path, "r"); if (!f) { perror(path); return 1; }
  while (fscanf(f, "%63s", word) == 1) {
    if (!strcmp(word, "planes")) { if (fscanf(f, "%d", &nplanes) != 1) return 1;
      for (int i = 0; i < nplanes; i++) if (fscanf(f, "%lf %lf %lf %lf", &pn[i].x, &pn[i].y, &pn[i].z, &pd[i]) != 4) return 1; }
    else if (!strcmp(word, "cauchy")) { if (fscanf(f, "%lf %lf", &cauchyA, &cauchyB) != 2) return 1; }
    else if (!strcmp(word, "ground")) { if (fscanf(f, "%lf %lf %lf", &ground_z, &ground_albedo, &ground_half) != 3) return 1; }
    else if (!strcmp(word, "env")) { if (fscanf(f, "%lf", &env_L) != 1) return 1; }
    else if (!strcmp(word, "gemsphere")) { if (fscanf(f, "%lf %lf %lf %lf", &gem_c.x, &gem_c.y, &gem_c.z, &gem_r) != 4) return 1; }
    else if (!strcmp(word, "lights")) { if (fscanf(f, "%d", &nlights) != 1) return 1;
      for (int i = 0; i < nlights; i++) { Light *L = &lights[i];
        if (fscanf(f, "%lf %lf %lf %lf %lf %lf %lf %lf %lf %lf %lf %lf %lf", &L->c.x, &L->c.y, &L->c.z, &L->n.x, &L->n.y, &L->n.z,
                   &L->u.x, &L->u.y, &L->u.z, &L->v.x, &L->v.y, &L->v.z, &L->L) != 13) return 1;
        L->ulen2 = dot(L->u, L->u); L->vlen2 = dot(L->v, L->v); L->area = 4 * sqrt(L->ulen2) * sqrt(L->vlen2); } }
    else if (!strcmp(word, "camera")) { char nm[64]; V o, t; double fov;
      if (fscanf(f, "%63s %lf %lf %lf %lf %lf %lf %lf", nm, &o.x, &o.y, &o.z, &t.x, &t.y, &t.z, &fov) != 8) return 1;
      if (!strcmp(nm, camname)) { cam_o = o; cam_t = t; cam_fov = fov; } }
  }
  fclose(f);
  snprintf(path, sizeof path, "%s/metal.bin", dir); load_mesh(path, &metal.m);
  snprintf(path, sizeof path, "%s/gem.bin", dir); load_mesh(path, &gemmesh.m);
  double t0 = omp_get_wtime();
  make_bvh(&metal); make_bvh(&gemmesh);
  double t_build = omp_get_wtime() - t0;

  V fw = norm(sub(cam_t, cam_o)), rt = norm(cross(fw, v3(0, 0, 1))), up = cross(rt, fw);
  double half = tan(cam_fov * M_PI / 360);
  /* White: a flat spectrum must come out as sRGB (1,1,1). */
  double XE = 0, YE = 0, ZE = 0;
  for (int i = 0; i < 3500; i++) { double x, y, z; cmf(380 + 0.1 * (i + 0.5), &x, &y, &z); XE += x; YE += y; ZE += z; }
  XE /= 3500; YE /= 3500; ZE /= 3500;
  float *img = calloc((size_t)res * res * 3, 4); uint64_t total_rays = 0;
  t0 = omp_get_wtime(); clock_t c0 = clock();
  #pragma omp parallel for schedule(dynamic, 4) reduction(+ : total_rays)
  for (int y = 0; y < res; y++) for (int x = 0; x < res; x++) {
    Rng rng = {0x853c49e6748fea9bULL ^ ((uint64_t)(y * res + x) * 0x9E3779B97F4A7C15ULL)}; rnd(&rng); rnd(&rng);
    double X = 0, Y = 0, Z = 0, off = rnd(&rng); uint64_t rays = 0;
    for (int s = 0; s < spp; s++) {
      double u = off + s * 0.6180339887498949; u -= floor(u);
      double lam = 380 + 350 * u, cx, cy, cz; cmf(lam, &cx, &cy, &cz);
      double px = (2 * (x + rnd(&rng)) / res - 1) * half, py = (1 - 2 * (y + rnd(&rng)) / res) * half;
      V d = norm(add(fw, add(mul(rt, px), mul(up, py))));
      double Lr = radiance(cam_o, d, lam, maxdepth, &rng, &rays);
      X += Lr * cx; Y += Lr * cy; Z += Lr * cz;
    }
    X = X / spp / XE * 0.95047; Y = Y / spp / YE; Z = Z / spp / ZE * 1.08883;
    float *p = &img[3 * (y * res + x)];
    p[0] = (float)(3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z);
    p[1] = (float)(-0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z);
    p[2] = (float)(0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z);
    total_rays += rays;
  }
  double t_render = omp_get_wtime() - t0, cpu = (double)(clock() - c0) / CLOCKS_PER_SEC;
  f = fopen(argv[6], "wb"); fwrite(img, 4, (size_t)res * res * 3, f); fclose(f);
  printf("{\"engine\": \"ptgem (own spike)\", \"camera\": \"%s\", \"res\": %d, \"spp\": %d, \"max_depth\": %d, "
         "\"dispersion\": %d, \"gem\": \"%s\", \"threads\": %d, \"bvh_build_s\": %.3f, \"render_s\": %.2f, \"cpu_s\": %.1f, "
         "\"rays\": %llu, \"mrays_per_s\": %.2f}\n",
         camname, res, spp, maxdepth, use_disp, use_meshgem ? "triangles+bvh" : "half-spaces", omp_get_max_threads(),
         t_build, t_render, cpu, (unsigned long long)total_rays, total_rays / t_render / 1e6);
  return 0;
}
