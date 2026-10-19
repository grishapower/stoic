// Triangle-soup helpers for local, free "kitbash" edits of single-material Meshy GLBs: cut parts out of a refined mesh,
// clip them exactly against planes, transform / copy them, tessellate and bend them, then write them back into the
// source document (keeps its material + textures, so the result is still one mesh / one draw call).
// A vertex is { p: [x,y,z], n: [x,y,z], uv: [u,v] }; a triangle is an array of 3 vertices (no sharing).
import { defaultScene } from '../../assets/optimize-glb.mjs';
import { xform, xformDir } from './pose.mjs';

const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const lerpV = (a, b, t) => ({ p: lerp(a.p, b.p, t), n: normalize(lerp(a.n, b.n, t)), uv: lerp(a.uv, b.uv, t) });
export const normalize = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
export const centroid = (t) => [0, 1, 2].map((i) => (t[0].p[i] + t[1].p[i] + t[2].p[i]) / 3);

/** Read every triangle primitive of the default scene (world space). All primitives must share one material. */
export function readSoup(doc) {
  const tris = [];
  let material = null;
  defaultScene(doc).traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4) continue;
      if (material && prim.getMaterial() !== material) throw new Error('kitbash: more than one material');
      material = prim.getMaterial();
      const pos = prim.getAttribute('POSITION'), nrm = prim.getAttribute('NORMAL'), uv = prim.getAttribute('TEXCOORD_0');
      const idx = prim.getIndices()?.getArray() ?? Uint32Array.from({ length: pos.getCount() }, (_, i) => i);
      const vert = (i) => ({ p: xform(m, pos.getElement(i, [])), n: nrm ? normalize(xformDir(m, nrm.getElement(i, []))) : [0, 1, 0], uv: uv ? uv.getElement(i, []) : [0, 0] });
      for (let t = 0; t < idx.length; t += 3) tris.push([vert(idx[t]), vert(idx[t + 1]), vert(idx[t + 2])]);
    }
  });
  return tris;
}

/** Replace the document's geometry with `tris` (one primitive on the first mesh node, identity transforms). */
export function writeSoup(doc, tris) {
  const scene = defaultScene(doc);
  let target = null;
  scene.traverse((node) => { if (!target && node.getMesh()) target = node; });
  const prim = target.getMesh().listPrimitives()[0];
  for (const extra of target.getMesh().listPrimitives().slice(1)) target.getMesh().removePrimitive(extra);
  scene.traverse((node) => { node.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]); if (node !== target && node.getMesh()) node.setMesh(null); });
  const n = tris.length * 3;
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), UV = new Float32Array(n * 2);
  tris.forEach((t, i) => t.forEach((v, k) => { const j = i * 3 + k; P.set(v.p, j * 3); N.set(v.n, j * 3); UV.set(v.uv, j * 2); }));
  const buffer = doc.getRoot().listBuffers()[0];
  const acc = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  for (const sem of prim.listSemantics()) prim.setAttribute(sem, null);
  prim.setAttribute('POSITION', acc('VEC3', P)).setAttribute('NORMAL', acc('VEC3', N)).setAttribute('TEXCOORD_0', acc('VEC2', UV));
  prim.setIndices(acc('SCALAR', Uint32Array.from({ length: n }, (_, i) => i)));
}

/** Keep the part of each triangle on one side of an axis-aligned plane (exact clip, attributes interpolated). */
export function clip(tris, axis, value, keep = 'above') {
  const ax = { x: 0, y: 1, z: 2 }[axis] ?? axis;
  const sd = (v) => (keep === 'above' ? v.p[ax] - value : value - v.p[ax]);
  const out = [];
  for (const t of tris) {
    const poly = [];
    for (let i = 0; i < 3; i++) {
      const a = t[i], b = t[(i + 1) % 3], da = sd(a), db = sd(b);
      if (da >= 0) poly.push(a);
      if ((da >= 0) !== (db >= 0)) poly.push(lerpV(a, b, da / (da - db)));
    }
    for (let i = 1; i + 1 < poly.length; i++) out.push([poly[0], poly[i], poly[i + 1]]);
  }
  return out;
}

export const clipBox = (tris, { min, max }) => {
  let r = tris;
  for (let i = 0; i < 3; i++) {
    if (min?.[i] != null) r = clip(r, i, min[i], 'above');
    if (max?.[i] != null) r = clip(r, i, max[i], 'below');
  }
  return r;
};

export const select = (tris, pred) => tris.filter((t) => pred(centroid(t), t));
export const bounds = (tris) => {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (const v of t) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], v.p[i]); max[i] = Math.max(max[i], v.p[i]); }
  return { min, max, size: max.map((v, i) => v - min[i]), center: max.map((v, i) => (v + min[i]) / 2) };
};

/**
 * Affine map: p' = M p + t (M row-major 3x3). Normals use the inverse transpose; winding flips when det(M) < 0.
 */
export function affine(tris, M, t = [0, 0, 0]) {
  const det = M[0] * (M[4] * M[8] - M[5] * M[7]) - M[1] * (M[3] * M[8] - M[5] * M[6]) + M[2] * (M[3] * M[7] - M[4] * M[6]);
  // cofactor matrix = det * inverse transpose
  const C = [
    M[4] * M[8] - M[5] * M[7], M[5] * M[6] - M[3] * M[8], M[3] * M[7] - M[4] * M[6],
    M[2] * M[7] - M[1] * M[8], M[0] * M[8] - M[2] * M[6], M[1] * M[6] - M[0] * M[7],
    M[1] * M[5] - M[2] * M[4], M[2] * M[3] - M[0] * M[5], M[0] * M[4] - M[1] * M[3],
  ];
  const mv = (A, v) => [A[0] * v[0] + A[1] * v[1] + A[2] * v[2], A[3] * v[0] + A[4] * v[1] + A[5] * v[2], A[6] * v[0] + A[7] * v[1] + A[8] * v[2]];
  const s = Math.sign(det) || 1;
  return tris.map((tri) => {
    const r = tri.map((v) => ({ p: mv(M, v.p).map((x, i) => x + t[i]), n: normalize(mv(C, v.n).map((x) => x * s)), uv: v.uv }));
    return det < 0 ? [r[0], r[2], r[1]] : r;
  });
}

export const translate = (tris, t) => affine(tris, [1, 0, 0, 0, 1, 0, 0, 0, 1], t);
export const scale = (tris, s, t = [0, 0, 0]) => affine(tris, [s[0], 0, 0, 0, s[1], 0, 0, 0, s[2]], t);
export function rotY(tris, deg, t = [0, 0, 0]) {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return affine(tris, [c, 0, s, 0, 1, 0, -s, 0, c], t);
}
export function rotZ(tris, deg, t = [0, 0, 0]) {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return affine(tris, [c, -s, 0, s, c, 0, 0, 0, 1], t);
}
export function rotX(tris, deg, t = [0, 0, 0]) {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return affine(tris, [1, 0, 0, 0, c, -s, 0, s, c], t);
}

/**
 * Split triangles at longest-edge midpoints until no edge exceeds maxLen (conforming: an edge's split depends only on
 * the edge itself, so neighbours split it identically). `axis` measures only that coordinate's extent (e.g. 0 = X,
 * enough before bending around a vertical axis); default is the Euclidean length.
 */
export function tessellate(tris, maxLen, axis = null) {
  const out = [];
  const stack = [...tris];
  const len = axis == null ? (a, b) => Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1], a.p[2] - b.p[2]) : (a, b) => Math.abs(a.p[axis] - b.p[axis]);
  while (stack.length) {
    const t = stack.pop();
    const l = [len(t[0], t[1]), len(t[1], t[2]), len(t[2], t[0])];
    const i = l.indexOf(Math.max(...l));
    if (l[i] <= maxLen) { out.push(t); continue; }
    const a = t[i], b = t[(i + 1) % 3], c = t[(i + 2) % 3], m = lerpV(a, b, 0.5);
    stack.push([a, m, c], [m, b, c]);
  }
  return out;
}

/** Per-vertex position/normal map (non-affine deformations). fn(v) -> { p, n }. */
export const deform = (tris, fn) => tris.map((t) => t.map((v) => ({ ...fn(v), uv: v.uv })));

/**
 * Simplify one part with meshoptimizer (edge collapse). Vertices are welded on exact attribute equality first, so UV
 * seams keep coincident positions and the simplifier treats them as seams (no cracks). `permissive` also collapses
 * across seams (needed on Meshy's very fragmented atlases; slight texture distortion).
 */
export async function simplifyPart(tris, targetTris, maxError = 0.01, { lockBorder = false, permissive = false } = {}) {
  const { MeshoptSimplifier } = await import('meshoptimizer');
  await MeshoptSimplifier.ready;
  const map = new Map(), verts = [], idx = [];
  for (const t of tris) for (const v of t) {
    const key = [...v.p, ...v.n, ...v.uv].join(',');
    let i = map.get(key);
    if (i == null) { i = verts.length; verts.push(v); map.set(key, i); }
    idx.push(i);
  }
  const P = new Float32Array(verts.length * 3);
  verts.forEach((v, i) => P.set(v.p, i * 3));
  const [out] = MeshoptSimplifier.simplify(new Uint32Array(idx), P, 3, Math.floor(targetTris) * 3, maxError, [...(lockBorder ? ['LockBorder'] : []), ...(permissive ? ['Permissive'] : [])]);
  const res = [];
  for (let i = 0; i < out.length; i += 3) res.push([verts[out[i]], verts[out[i + 1]], verts[out[i + 2]]]);
  return res;
}
