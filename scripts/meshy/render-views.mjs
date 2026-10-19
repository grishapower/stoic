#!/usr/bin/env node
// QA renderer (CPU rasterizer, no browser): orthographic views of a GLB with base-color texture + simple lighting.
// Supports skinned meshes and sampling an animation clip at given times, to check faces, hands, cloth and clips.
//   node scripts/meshy/render-views.mjs <in.glb> <out.png> [--views front,right,back,left,three,top]
//        [--size 512] [--crop 0.82:1] (vertical fraction of bounds) [--anim clipName --times 0,0.5,1 (fractions)]
import sharp from 'sharp';
import { createIO, defaultScene } from '../assets/optimize-glb.mjs';
import { IDENT, mul, xform, worldMatrices, clipDuration } from './lib/pose.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const [inFile, outFile] = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const SIZE = +opt('size', 512);

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// Collect world-space triangles (positions + uvs + material) for the posed scene.
async function collectTriangles(doc, anim, t) {
  const world = worldMatrices(defaultScene(doc), anim, t);
  const tris = [];
  const texCache = new Map();
  for (const [node, m] of world) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const skin = node.getSkin();
    let jointMats = null;
    if (skin) {
      const ibm = skin.getInverseBindMatrices();
      jointMats = skin.listJoints().map((j, i) => mul(world.get(j) || IDENT, ibm ? ibm.getElement(i, []) : IDENT));
    }
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4) continue;
      const pos = prim.getAttribute('POSITION');
      const uv = prim.getAttribute('TEXCOORD_0');
      const J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0');
      const n = pos.getCount();
      const P = new Array(n);
      for (let i = 0; i < n; i++) {
        const v = pos.getElement(i, []);
        if (jointMats && J && W) {
          const j = J.getElement(i, []), w = W.getElement(i, []);
          const acc = [0, 0, 0];
          for (let k = 0; k < 4; k++) {
            if (!w[k]) continue;
            const p = xform(jointMats[j[k]], v);
            acc[0] += p[0] * w[k]; acc[1] += p[1] * w[k]; acc[2] += p[2] * w[k];
          }
          P[i] = acc;
        } else P[i] = xform(m, v);
      }
      const UV = uv ? Array.from({ length: n }, (_, i) => uv.getElement(i, [])) : null;
      const mat = prim.getMaterial();
      const texObj = mat?.getBaseColorTexture();
      let tex = null;
      if (texObj) {
        if (!texCache.has(texObj)) {
          const { data, info } = await sharp(Buffer.from(texObj.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
          texCache.set(texObj, { data, w: info.width, h: info.height });
        }
        tex = texCache.get(texObj);
      }
      const factor = mat ? mat.getBaseColorFactor() : [0.8, 0.8, 0.8, 1];
      const idx = prim.getIndices();
      const count = idx ? idx.getCount() : n;
      const at = (k) => (idx ? idx.getScalar(k) : k);
      for (let k = 0; k < count; k += 3) {
        const a = at(k), b = at(k + 1), c = at(k + 2);
        tris.push({ p: [P[a], P[b], P[c]], uv: UV ? [UV[a], UV[b], UV[c]] : null, tex, factor });
      }
    }
  }
  return tris;
}

const VIEWS = {
  front: { dir: [0, 0, 1] }, // camera on +Z looking at -Z (sees the +Z-facing front)
  back: { dir: [0, 0, -1] },
  right: { dir: [1, 0, 0] },
  left: { dir: [-1, 0, 0] },
  three: { dir: norm([0.7, 0.15, 1]) },
  top: { dir: [0, 1, 0.0001] },
};

function bounds(tris) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (const p of t.p) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], p[i]); max[i] = Math.max(max[i], p[i]); }
  return { min, max };
}

function render(tris, viewName, { size, region }) {
  const toCam = VIEWS[viewName].dir;
  const worldUp = Math.abs(toCam[1]) > 0.99 ? [0, 0, -1] : [0, 1, 0];
  const right = norm(cross(worldUp, toCam));
  const up = cross(toCam, right);
  const light = norm([right[0] * -0.45 + up[0] * 0.6 + toCam[0] * 0.75, right[1] * -0.45 + up[1] * 0.6 + toCam[1] * 0.75, right[2] * -0.45 + up[2] * 0.6 + toCam[2] * 0.75]);
  // Fit the region (world bounds) in view.
  const corners = [];
  for (const x of [region.min[0], region.max[0]]) for (const y of [region.min[1], region.max[1]]) for (const z of [region.min[2], region.max[2]]) corners.push([x, y, z]);
  const xs = corners.map((c) => dot(c, right)), ys = corners.map((c) => dot(c, up));
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 1.06;
  const scale = size / span;
  const W = size, H = size;
  const zbuf = new Float32Array(W * H).fill(-Infinity);
  const img = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) { img[i * 3] = 70; img[i * 3 + 1] = 74; img[i * 3 + 2] = 80; }
  for (const tri of tris) {
    const s = tri.p.map((p) => [(dot(p, right) - cx) * scale + W / 2, H / 2 - (dot(p, up) - cy) * scale, dot(p, toCam)]);
    let nrm = norm(cross(sub(tri.p[1], tri.p[0]), sub(tri.p[2], tri.p[0])));
    if (dot(nrm, toCam) < 0) nrm = nrm.map((x) => -x);
    const shade = 0.32 + 0.68 * Math.max(0, dot(nrm, light));
    const minX = Math.max(0, Math.floor(Math.min(s[0][0], s[1][0], s[2][0]))), maxX = Math.min(W - 1, Math.ceil(Math.max(s[0][0], s[1][0], s[2][0])));
    const minY = Math.max(0, Math.floor(Math.min(s[0][1], s[1][1], s[2][1]))), maxY = Math.min(H - 1, Math.ceil(Math.max(s[0][1], s[1][1], s[2][1])));
    const area = (s[1][0] - s[0][0]) * (s[2][1] - s[0][1]) - (s[2][0] - s[0][0]) * (s[1][1] - s[0][1]);
    if (Math.abs(area) < 1e-12) continue;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((s[1][0] - px) * (s[2][1] - py) - (s[2][0] - px) * (s[1][1] - py)) / area;
      const w1 = ((s[2][0] - px) * (s[0][1] - py) - (s[0][0] - px) * (s[2][1] - py)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = w0 * s[0][2] + w1 * s[1][2] + w2 * s[2][2];
      const o = y * W + x;
      if (z <= zbuf[o]) continue;
      zbuf[o] = z;
      let col = [tri.factor[0] * 255, tri.factor[1] * 255, tri.factor[2] * 255];
      if (tri.tex && tri.uv) {
        let u = w0 * tri.uv[0][0] + w1 * tri.uv[1][0] + w2 * tri.uv[2][0];
        let v = w0 * tri.uv[0][1] + w1 * tri.uv[1][1] + w2 * tri.uv[2][1];
        u -= Math.floor(u); v -= Math.floor(v);
        const tx = Math.min(tri.tex.w - 1, Math.floor(u * tri.tex.w)), ty = Math.min(tri.tex.h - 1, Math.floor(v * tri.tex.h));
        const ti = (ty * tri.tex.w + tx) * 4;
        col = [tri.tex.data[ti] * tri.factor[0], tri.tex.data[ti + 1] * tri.factor[1], tri.tex.data[ti + 2] * tri.factor[2]];
      }
      img[o * 3] = Math.min(255, col[0] * shade);
      img[o * 3 + 1] = Math.min(255, col[1] * shade);
      img[o * 3 + 2] = Math.min(255, col[2] * shade);
    }
  }
  return sharp(img, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
}

async function label(text, w) {
  const svg = `<svg width="${w}" height="26"><rect width="100%" height="100%" fill="#111"/><text x="6" y="18" font-size="15" fill="#eee" font-family="Arial">${text}</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function main() {
  if (!inFile || !outFile) throw new Error('usage: render-views.mjs <in.glb> <out.png> [--views ..] [--crop a:b] [--anim clip --times 0,0.5]');
  const io = await createIO();
  const doc = await io.read(inFile);
  const views = opt('views', 'front,right,back,three').split(',');
  const animName = opt('anim');
  const anim = animName ? doc.getRoot().listAnimations().find((a) => a.getName() === animName) : null;
  if (animName && !anim) throw new Error(`clip ${animName} not found: ${doc.getRoot().listAnimations().map((a) => a.getName())}`);
  const duration = anim ? clipDuration(anim) : 0;
  const times = anim ? opt('times', '0,0.25,0.5,0.75').split(',').map((f) => +f * duration) : [null];
  const tiles = [];
  for (const t of times) {
    const tris = await collectTriangles(doc, anim, t ?? 0);
    const b = bounds(tris);
    let region = b;
    const crop = opt('crop');
    if (crop) {
      const [a, c] = crop.split(':').map(Number);
      const h = b.max[1] - b.min[1];
      const tmp = { min: [...b.min], max: [...b.max] };
      tmp.min[1] = b.min[1] + a * h; tmp.max[1] = b.min[1] + c * h;
      // Keep only triangles inside the crop band so the horizontal fit is tight.
      const inside = tris.filter((tr) => tr.p.some((p) => p[1] >= tmp.min[1] && p[1] <= tmp.max[1]));
      const ib = bounds(inside);
      region = { min: [ib.min[0], tmp.min[1], ib.min[2]], max: [ib.max[0], tmp.max[1], ib.max[2]] };
    }
    for (const v of views) {
      tiles.push({ buf: await render(tris, v, { size: SIZE, region }), text: `${v}${t != null ? ` t=${t.toFixed(2)}s` : ''} ${tris.length} tris  h=${(b.max[1] - b.min[1]).toFixed(2)}` });
    }
  }
  const cols = views.length, rows = times.length;
  const comps = [];
  for (let i = 0; i < tiles.length; i++) {
    const x = (i % cols) * SIZE, y = Math.floor(i / cols) * (SIZE + 26);
    comps.push({ input: await label(tiles[i].text, SIZE), left: x, top: y }, { input: tiles[i].buf, left: x, top: y + 26 });
  }
  await sharp({ create: { width: cols * SIZE, height: rows * (SIZE + 26), channels: 3, background: '#000' } }).composite(comps).png().toFile(outFile);
  console.log(`wrote ${outFile}`);
}

main().catch((err) => {
  console.error(`ERROR: ${err.stack || err.message}`);
  process.exit(1);
});
