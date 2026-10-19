#!/usr/bin/env node
// Procedural fallbacks for props Meshy could not produce (free, deterministic).
// Output: assets-src/meshy/raw/<asset>/procedural/<asset>.glb, picked up by optimize-glb.mjs through
// assets.json -> <asset>.source_glb + input_from: "source_glb".
//   node scripts/meshy/procedural.mjs oil-lamp
// oil-lamp: Roman bronze lucerna (closed round body with a sunken discus and filling hole, rounded nozzle with a wick
// hole, ring handle with a leaf thumb-rest). Bronze colour / metallic / roughness match the clepsydra's Meshy texture
// statistics (bronze sRGB 168,107,47, metallic 0.65, roughness 0.36; patina 55,51,32).
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { Document } from '@gltf-transform/core';
import sharp from 'sharp';
import { createIO } from '../assets/optimize-glb.mjs';
import { RAW_DIR, rel } from './lib/paths.mjs';
import { updateAsset } from './lib/registry.mjs';

// ---------- small indexed-mesh builders (metres; +Y up; nozzle toward +Z) ----------
function lathe(profile, segs = 48, dark = () => false) {
  // profile: [[r, y], ...] from the bottom centre to the top centre.
  const P = [], I = [], D = [];
  for (const [r, y] of profile) for (let s = 0; s < segs; s++) {
    const a = (s / segs) * Math.PI * 2;
    P.push([r * Math.sin(a), y, r * Math.cos(a)]);
    D.push(dark(r, y));
  }
  for (let k = 0; k + 1 < profile.length; k++) for (let s = 0; s < segs; s++) {
    const a = k * segs + s, b = k * segs + ((s + 1) % segs), c = (k + 1) * segs + s, d = (k + 1) * segs + ((s + 1) % segs);
    I.push([a, c, b], [b, c, d]);
  }
  return { P, I, D };
}

function superellipse(t, e) {
  const c = Math.cos(t), s = Math.sin(t);
  return [Math.sign(c) * Math.abs(c) ** (2 / e), Math.sign(s) * Math.abs(s) ** (2 / e)];
}

// Nozzle: superellipse cross-sections along +Z, closed by a rounded (superellipsoid) tip.
function nozzle({ z0, z1, w0, w1, h, yc, e = 3, rings = 10, tipRings = 8, segs = 32 }) {
  const P = [], I = [], D = [];
  const section = (z, w, hh) => { for (let s = 0; s < segs; s++) { const [cx, cy] = superellipse((s / segs) * Math.PI * 2, e); P.push([cx * w, yc + cy * hh, z]); D.push(false); } };
  for (let k = 0; k <= rings; k++) { const t = k / rings; section(z0 + (z1 - z0) * t, w0 + (w1 - w0) * t, h); }
  for (let k = 1; k <= tipRings; k++) { const phi = (k / tipRings) * (Math.PI / 2); const f = Math.cos(phi); section(z1 + w1 * Math.sin(phi), w1 * f, h * f); }
  const n = rings + tipRings + 1;
  for (let k = 0; k + 1 < n; k++) for (let s = 0; s < segs; s++) {
    const a = k * segs + s, b = k * segs + ((s + 1) % segs), c = (k + 1) * segs + s, d = (k + 1) * segs + ((s + 1) % segs);
    I.push([a, b, c], [b, d, c]);
  }
  return { P, I, D };
}

function torus({ center, R, r, axis = 'x', segs = 32, tube = 12, dark = false }) {
  const P = [], I = [], D = [];
  for (let i = 0; i < segs; i++) for (let j = 0; j < tube; j++) {
    const u = (i / segs) * Math.PI * 2, v = (j / tube) * Math.PI * 2;
    const a = (R + r * Math.cos(v)) * Math.cos(u), b = (R + r * Math.cos(v)) * Math.sin(u), c = r * Math.sin(v);
    // axis = ring axis: 'x' -> ring in the YZ plane, 'y' -> ring lying flat in XZ.
    const p = axis === 'x' ? [c, a, b] : [a, c, b];
    P.push([p[0] + center[0], p[1] + center[1], p[2] + center[2]]);
    D.push(dark);
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < tube; j++) {
    const a = i * tube + j, b = ((i + 1) % segs) * tube + j, c = i * tube + ((j + 1) % tube), d = ((i + 1) % segs) * tube + ((j + 1) % tube);
    I.push([a, b, c], [b, d, c]);
  }
  return { P, I, D };
}

function ellipsoid({ center, radii, tiltXDeg = 0, segs = 24, rings = 12 }) {
  const P = [], I = [], D = [];
  const t = (tiltXDeg * Math.PI) / 180;
  for (let k = 0; k <= rings; k++) for (let s = 0; s < segs; s++) {
    const th = (k / rings) * Math.PI, ph = (s / segs) * Math.PI * 2;
    const x = radii[0] * Math.sin(th) * Math.cos(ph), y = radii[1] * Math.cos(th), z = radii[2] * Math.sin(th) * Math.sin(ph);
    const yy = y * Math.cos(t) - z * Math.sin(t), zz = y * Math.sin(t) + z * Math.cos(t);
    P.push([x + center[0], yy + center[1], zz + center[2]]);
    D.push(false);
  }
  for (let k = 0; k < rings; k++) for (let s = 0; s < segs; s++) {
    const a = k * segs + s, b = k * segs + ((s + 1) % segs), c = (k + 1) * segs + s, d = (k + 1) * segs + ((s + 1) % segs);
    I.push([a, c, b], [b, c, d]);
  }
  return { P, I, D };
}

// Smooth normals per part (area-weighted), box-projected UVs into [0,0.85]x[0,1]; "dark" vertices map to the soot strip.
function finish(part, span = 0.22) {
  const N = part.P.map(() => [0, 0, 0]);
  for (const [a, b, c] of part.I) {
    const pa = part.P[a], pb = part.P[b], pc = part.P[c];
    const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], v = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    for (const i of [a, b, c]) for (let k = 0; k < 3; k++) N[i][k] += n[k];
  }
  const NN = N.map((n) => { const l = Math.hypot(...n) || 1; return n.map((x) => x / l); });
  const UV = part.P.map((p, i) => {
    if (part.D[i]) return [0.93, 0.5];
    const n = NN[i].map(Math.abs);
    const [a, b] = n[0] >= n[1] && n[0] >= n[2] ? [p[2], p[1]] : n[1] >= n[2] ? [p[0], p[2]] : [p[0], p[1]];
    return [((a / span + 0.5) % 1) * 0.85, (b / span + 0.5) % 1];
  });
  return { ...part, N: NN, UV };
}

async function bronzeTextures(size = 256) {
  // Low-frequency mottling + patina blotches (seeded LCG -> deterministic), soot strip at u > 0.88.
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const noise = async (blur) => {
    const raw = Buffer.alloc(size * size);
    for (let i = 0; i < raw.length; i++) raw[i] = Math.floor(rnd() * 255);
    const { data } = await sharp(raw, { raw: { width: size, height: size, channels: 1 } }).blur(blur).normalise().raw().toBuffer({ resolveWithObject: true });
    return data;
  };
  const n1 = await noise(6), n2 = await noise(3);
  const bronze = [168, 107, 47], patina = [72, 74, 48], soot = [28, 24, 20];
  const bc = Buffer.alloc(size * size * 3), mr = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const sootStrip = x / size > 0.88;
    const shade = 0.82 + 0.3 * (n1[i] / 255);
    const pat = Math.max(0, Math.min(1, (n2[i] / 255 - 0.68) * 5)); // ~15% patina coverage
    const c = sootStrip ? soot : bronze.map((v, k) => (v * shade) * (1 - pat) + patina[k] * pat);
    bc[i * 3] = c[0]; bc[i * 3 + 1] = c[1]; bc[i * 3 + 2] = c[2];
    const metal = sootStrip ? 0.05 : 0.65 * (1 - pat) + 0.08 * pat, rough = sootStrip ? 0.9 : 0.34 + 0.25 * pat + 0.06 * (n1[i] / 255);
    mr[i * 3] = 255; mr[i * 3 + 1] = Math.round(rough * 255); mr[i * 3 + 2] = Math.round(metal * 255);
  }
  const png = (buf) => sharp(buf, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
  return { baseColor: await png(bc), metallicRoughness: await png(mr) };
}

async function oilLamp() {
  const hole = 0.0062;
  const body = lathe([
    [0, 0], [0.026, 0], [0.028, 0.002], [0.029, 0.005], [0.034, 0.007], [0.041, 0.011], [0.045, 0.017], [0.045, 0.022],
    [0.043, 0.027], [0.039, 0.031], [0.036, 0.0335], [0.033, 0.034], [0.03, 0.0325], [0.022, 0.0298], [0.012, 0.0288],
    [hole, 0.0286], [hole, 0.022], [hole * 0.6, 0.0205], [0, 0.0205],
  ], 48, (r, y) => r <= hole + 1e-6 && y < 0.028);
  const noz = nozzle({ z0: 0.02, z1: 0.088, w0: 0.024, w1: 0.016, h: 0.0115, yc: 0.0205, e: 3.2 });
  const wickRim = torus({ center: [0, 0.0318, 0.089], R: 0.0072, r: 0.0019, axis: 'y', segs: 24, tube: 8 });
  const wickHole = lathe([[0, 0.0322], [0.0055, 0.0322], [0.0055, 0.0315], [0, 0.0315]], 20, () => true);
  wickHole.P.forEach((p) => { p[2] += 0.089; });
  const handle = torus({ center: [0, 0.027, -0.058], R: 0.0155, r: 0.0045, axis: 'x' });
  const leaf = ellipsoid({ center: [0, 0.047, -0.068], radii: [0.011, 0.015, 0.0025], tiltXDeg: -28 });
  const parts = [body, noz, wickRim, wickHole, handle, leaf].map((p) => finish(p));

  const doc = new Document();
  const buffer = doc.createBuffer();
  const tex = await bronzeTextures();
  const bcTex = doc.createTexture('bronze_basecolor').setImage(new Uint8Array(tex.baseColor)).setMimeType('image/png');
  const mrTex = doc.createTexture('bronze_metallic_roughness').setImage(new Uint8Array(tex.metallicRoughness)).setMimeType('image/png');
  const mat = doc.createMaterial('bronze').setBaseColorTexture(bcTex).setMetallicRoughnessTexture(mrTex).setMetallicFactor(1).setRoughnessFactor(1);
  const P = [], N = [], UV = [], I = [];
  for (const part of parts) {
    const base = P.length / 3;
    part.P.forEach((p, i) => { P.push(...p); N.push(...part.N[i]); UV.push(...part.UV[i]); });
    for (const t of part.I) I.push(base + t[0], base + t[1], base + t[2]);
  }
  const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', acc('VEC3', new Float32Array(P)))
    .setAttribute('NORMAL', acc('VEC3', new Float32Array(N)))
    .setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(UV)))
    .setIndices(acc('SCALAR', new Uint32Array(I)))
    .setMaterial(mat);
  const mesh = doc.createMesh('oil-lamp').addPrimitive(prim);
  doc.createScene('scene').addChild(doc.createNode('oil-lamp').setMesh(mesh));
  doc.getRoot().setDefaultScene(doc.getRoot().listScenes()[0]);
  const io = await createIO();
  const out = path.join(RAW_DIR, 'oil-lamp', 'procedural', 'oil-lamp.glb');
  mkdirSync(path.dirname(out), { recursive: true });
  await io.write(out, doc);
  const wick = [0, 0.0322, 0.089];
  console.log(`wrote ${rel(out)}: ${I.length / 3} tris; wick hole (raw frame) at ${wick}`);
  updateAsset('oil-lamp', (a) => {
    a.source_glb = rel(out);
    a.input_from = 'source_glb';
    a.procedural = { script: 'scripts/meshy/procedural.mjs oil-lamp', wick_raw: wick, note: 'Both Meshy attempts failed (teapot / tureen shapes); procedural lucerna with bronze values sampled from the clepsydra texture.' };
  });
}

const recipes = { 'oil-lamp': oilLamp };
const id = process.argv[2];
if (!recipes[id]) {
  console.log(`usage: procedural.mjs <${Object.keys(recipes).join('|')}>`);
  process.exit(1);
}
recipes[id]().catch((err) => {
  console.error(`ERROR: ${err.stack || err.message}`);
  process.exit(1);
});
