// Minimal forward kinematics for glTF-Transform documents: TRS compose, animation sampling, world matrices.
export const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// Column-major 4x4 multiply (a * b).
export function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}

export function compose(t, q, s) {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}

export const xform = (m, v) => [
  m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
  m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
  m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
];
export const xformDir = (m, v) => [
  m[0] * v[0] + m[4] * v[1] + m[8] * v[2],
  m[1] * v[0] + m[5] * v[1] + m[9] * v[2],
  m[2] * v[0] + m[6] * v[1] + m[10] * v[2],
];

const norm4 = (q) => {
  const l = Math.hypot(...q) || 1;
  return q.map((x) => x / l);
};

export function slerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const bb = d < 0 ? b.map((x) => -x) : b;
  d = Math.abs(d);
  if (d > 0.9995) return norm4(a.map((x, i) => x + (bb[i] - x) * t));
  const th = Math.acos(d), s = Math.sin(th);
  return a.map((x, i) => (Math.sin((1 - t) * th) * x + Math.sin(t * th) * bb[i]) / s);
}

const cache = new WeakMap();
export function samplerData(s) {
  if (!cache.has(s)) {
    const inp = s.getInput(), out = s.getOutput();
    const times = Array.from({ length: inp.getCount() }, (_, i) => inp.getElement(i, [])[0]);
    const values = Array.from({ length: out.getCount() }, (_, i) => out.getElement(i, []));
    cache.set(s, { times, values, interp: s.getInterpolation() });
  }
  return cache.get(s);
}

export function sample(s, t, isRot) {
  const { times, values, interp } = samplerData(s);
  const cubic = interp === 'CUBICSPLINE';
  const val = (i) => (cubic ? values[i * 3 + 1] : values[i]);
  if (t <= times[0]) return val(0);
  if (t >= times[times.length - 1]) return val(times.length - 1);
  let lo = 0, hi = times.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid; else hi = mid;
  }
  const f = (t - times[lo]) / (times[hi] - times[lo]);
  if (interp === 'STEP') return val(lo);
  return isRot ? slerp(val(lo), val(hi), f) : val(lo).map((x, k) => x + (val(hi)[k] - x) * f);
}

export function clipDuration(anim) {
  let d = 0;
  for (const s of anim.listSamplers()) d = Math.max(d, s.getInput().getMax([])[0]);
  return d;
}

/** World matrix per node for the scene, with `anim` sampled at time t (null = rest pose). */
export function worldMatrices(scene, anim, t) {
  const overrides = new Map();
  if (anim) for (const ch of anim.listChannels()) {
    const node = ch.getTargetNode();
    const p = ch.getTargetPath();
    if (!node || p === 'weights') continue;
    if (!overrides.has(node)) overrides.set(node, {});
    overrides.get(node)[p] = sample(ch.getSampler(), t, p === 'rotation');
  }
  const world = new Map();
  const visit = (node, parentM) => {
    const o = overrides.get(node) || {};
    const m = mul(parentM, compose(o.translation || node.getTranslation(), o.rotation || node.getRotation(), o.scale || node.getScale()));
    world.set(node, m);
    for (const c of node.listChildren()) visit(c, m);
  };
  for (const n of scene.listChildren()) visit(n, IDENT);
  return world;
}

/** Bounds of the posed (skinned) scene at time t; also returns per-node world matrices. */
export function posedBounds(scene, anim, t) {
  const world = worldMatrices(scene, anim, t);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const [node, m] of world) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const skin = node.getSkin();
    let jm = null;
    if (skin) {
      const ibm = skin.getInverseBindMatrices();
      jm = skin.listJoints().map((j, i) => mul(world.get(j) || IDENT, ibm ? ibm.getElement(i, []) : IDENT));
    }
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0');
      for (let i = 0; i < pos.getCount(); i++) {
        const v = pos.getElement(i, []);
        let p;
        if (jm && J && W) {
          const j = J.getElement(i, []), w = W.getElement(i, []);
          p = [0, 0, 0];
          for (let k = 0; k < 4; k++) {
            if (!w[k]) continue;
            const q = xform(jm[j[k]], v);
            p[0] += q[0] * w[k]; p[1] += q[1] * w[k]; p[2] += q[2] * w[k];
          }
        } else p = xform(m, v);
        for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], p[a]); max[a] = Math.max(max[a], p[a]); }
      }
    }
  }
  return { min, max, world };
}

// Inverse of the upper-left 3x3 of a column-major 4x4 (returned as a 4x4 with zero translation).
export function invertLinear(m) {
  const a = m[0], b = m[4], c = m[8], d = m[1], e = m[5], f = m[9], g = m[2], h = m[6], i = m[10];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const r = 1 / det;
  return [
    A * r, B * r, C * r, 0,
    -(b * i - c * h) * r, (a * i - c * g) * r, -(a * h - b * g) * r, 0,
    (b * f - c * e) * r, -(a * f - c * d) * r, (a * e - b * d) * r, 0,
    0, 0, 0, 1,
  ];
}
