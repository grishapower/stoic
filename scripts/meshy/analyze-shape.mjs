#!/usr/bin/env node
// Geometry analysis for pivots that a bounding box cannot give (works on the optimized/normalized GLB).
//   fruit <glb> [--diameter m | --length m] [--apply assetId]
//     Fits an axis-aligned ellipsoid to the fruit body (iterative least squares with outlier rejection, so the stem and
//     leaves are ignored) and prints the body centre and diameters. --apply writes target_size_m {fit:'scale'} and
//     pivot_offset into assets.json so the next optimize run puts the origin at the body centre at real size.
//   hand <glb> [--region x0,x1,z0,z1] [--radii ..] [--radius R] [--apply assetId] | [--ellipsoid ax,by,cz]
//     Palm frame + grip point for a palm-up first-person hand: see analyzeHand() below. --ellipsoid reports where a
//     fruit body (axis-aligned semi-axes) settles in the cup.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createIO, defaultScene } from '../assets/optimize-glb.mjs';
import { REGISTRY_FILE } from './lib/paths.mjs';

const args = process.argv.slice(2);
const opt = (n) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined);
const [mode, file] = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => scl(a, 1 / (len(a) || 1));
const r4 = (v) => v.map((x) => +x.toFixed(4));

/** World-space triangles of the default scene: [{ a, b, c, n (unit normal), area, centroid }], plus vertices. */
export async function loadTriangles(glb) {
  const io = await createIO();
  const doc = await io.read(glb);
  const tris = [];
  const verts = [];
  defaultScene(doc).traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    const m = node.getWorldMatrix();
    const X = (v) => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4) continue;
      const pos = prim.getAttribute('POSITION');
      const base = verts.length;
      for (let i = 0; i < pos.getCount(); i++) verts.push(X(pos.getElement(i, [])));
      const idx = prim.getIndices();
      const count = idx ? idx.getCount() : pos.getCount();
      for (let k = 0; k < count; k += 3) {
        const [a, b, c] = [0, 1, 2].map((j) => verts[base + (idx ? idx.getScalar(k + j) : k + j)]);
        const cr = cross(sub(b, a), sub(c, a));
        const area = len(cr) / 2;
        if (area <= 0) continue;
        tris.push({ a, b, c, n: norm(cr), area, centroid: scl(add(add(a, b), c), 1 / 3) });
      }
    }
  });
  return { tris, verts };
}

// Solve a small dense linear system (Gaussian elimination with partial pivoting).
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** Area-weighted axis-aligned ellipsoid fit A x² + B y² + C z² + D x + E y + F z = 1, rejecting outliers iteratively. */
export function fitEllipsoid(points, weights, tolerances = [Infinity, 0.4, 0.25, 0.15, 0.1, 0.1]) {
  let keep = points.map(() => true);
  let fit = null;
  for (const tol of tolerances) {
    if (fit && Number.isFinite(tol)) {
      keep = points.map((p) => Math.abs(Math.hypot(...[0, 1, 2].map((i) => (p[i] - fit.center[i]) / fit.semi[i])) - 1) < tol);
    }
    const AtA = Array.from({ length: 6 }, () => new Array(6).fill(0));
    const Atb = new Array(6).fill(0);
    points.forEach((p, i) => {
      if (!keep[i]) return;
      const row = [p[0] * p[0], p[1] * p[1], p[2] * p[2], p[0], p[1], p[2]];
      const w = weights[i];
      for (let r = 0; r < 6; r++) {
        Atb[r] += w * row[r];
        for (let c = 0; c < 6; c++) AtA[r][c] += w * row[r] * row[c];
      }
    });
    const [A, B, C, D, E, F] = solve(AtA, Atb);
    const center = [-D / (2 * A), -E / (2 * B), -F / (2 * C)];
    const G = 1 + A * center[0] ** 2 + B * center[1] ** 2 + C * center[2] ** 2;
    fit = { center, semi: [Math.sqrt(G / A), Math.sqrt(G / B), Math.sqrt(G / C)], kept: keep.filter(Boolean).length, total: points.length };
  }
  return fit;
}

function updateRegistry(assetId, fn) {
  const reg = JSON.parse(readFileSync(REGISTRY_FILE, 'utf8'));
  fn(reg.assets[assetId]);
  writeFileSync(REGISTRY_FILE, JSON.stringify(reg, null, 2) + '\n');
}

async function analyzeFruit() {
  const { tris } = await loadTriangles(file);
  const fit = fitEllipsoid(tris.map((t) => t.centroid), tris.map((t) => t.area));
  const diam = [0, 1, 2].map((i) => 2 * fit.semi[i]);
  const width = (diam[0] + diam[2]) / 2;
  console.log(`body ellipsoid: centre [${r4(fit.center)}], diameters x ${diam[0].toFixed(4)} y ${diam[1].toFixed(4)} z ${diam[2].toFixed(4)} ` +
    `(width ${width.toFixed(4)}, flattening h/w ${(diam[1] / width).toFixed(3)}); ${fit.kept}/${fit.total} triangles on the body`);
  const target = opt('diameter') ? { m: +opt('diameter'), cur: width, what: 'width' } : opt('length') ? { m: +opt('length'), cur: diam[1], what: 'length' } : null;
  const k = target ? target.m / target.cur : 1;
  if (target) console.log(`rescale x${k.toFixed(5)} so the body ${target.what} becomes ${target.m} m`);
  const assetId = opt('apply');
  if (assetId) {
    updateRegistry(assetId, (a) => {
      const prev = a.pivot_offset || [0, 0, 0];
      const s = a.target_size_m?.fit === 'scale' ? a.target_size_m.value : null;
      if (!s && target) throw new Error('set target_size_m {fit:"scale", value} first (the current scale factor of the analyzed file)');
      if (target) a.target_size_m = { fit: 'scale', value: +(s * k).toPrecision(6) };
      a.pivot_offset = r4(add(prev, fit.center).map((x) => x * k));
      a.body = { diameters_m: r4(diam.map((d) => d * k)), center_note: 'origin = centre of the fitted body ellipsoid (stem/leaves excluded)' };
      console.log(`assets.json ${assetId}: target_size_m ${JSON.stringify(a.target_size_m)}, pivot_offset [${a.pivot_offset}]`);
    });
  }
  return { fit, diam };
}

// Highest surface point of the mesh on the vertical line (x, z) below yMax (ray cast against triangles).
function surfaceBelow(tris, x, z, yMax) {
  let best = -Infinity;
  for (const t of tris) {
    const [a, b, c] = [t.a, t.b, t.c];
    const d = (b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2]);
    if (Math.abs(d) < 1e-14) continue;
    const u = ((x - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (z - a[2])) / d;
    const v = ((b[0] - a[0]) * (z - a[2]) - (x - a[0]) * (b[2] - a[2])) / d;
    if (u < 0 || v < 0 || u + v > 1) continue;
    const y = a[1] + u * (b[1] - a[1]) + v * (c[1] - a[1]);
    if (y <= yMax && y > best) best = y;
  }
  return best;
}

/**
 * Palm-up hand in its normalized frame (+Y palm normal, fingers -Z). For each radius R a sphere is "dropped" onto the
 * mesh at every (x, z) of a 1 mm grid over the palm zone: its rest height is max over vertices of y + sqrt(R² - d²).
 * The lowest rest position is where a fruit settles in the cup. The grip point is the palm surface under the sphere
 * centre; the recommended fruit radius is the largest R that is held by both palm and fingers (not by the thumb) with
 * its centre no higher than the curled fingertips. The sphere never intersects the mesh vertices by construction.
 */
async function analyzeHand() {
  const { tris, verts } = await loadTriangles(file);
  const min = [0, 1, 2].map((i) => Math.min(...verts.map((v) => v[i])));
  const max = [0, 1, 2].map((i) => Math.max(...verts.map((v) => v[i])));
  const region = (opt('region') || '').split(',').map(Number);
  const [x0, x1, z0, z1] = region.length === 4 ? region
    : [min[0] + 0.2 * (max[0] - min[0]), max[0] - 0.3 * (max[0] - min[0]), min[2] + 0.25 * (max[2] - min[2]), min[2] + 0.6 * (max[2] - min[2])];
  console.log(`search region x [${x0.toFixed(3)}, ${x1.toFixed(3)}] z [${z0.toFixed(3)}, ${z1.toFixed(3)}]`);
  // --ellipsoid ax,by,cz: drop an axis-aligned ellipsoid (semi-axes in metres, e.g. a fruit body) instead of spheres.
  const ell = opt('ellipsoid') ? opt('ellipsoid').split(',').map(Number) : null;
  if (ell) {
    const [ea, eb, ec] = ell;
    let best = null;
    for (let x = x0; x <= x1 + 1e-9; x += 0.001) for (let z = z0; z <= z1 + 1e-9; z += 0.001) {
      let h = -Infinity;
      for (const v of verts) {
        const q = 1 - ((v[0] - x) / ea) ** 2 - ((v[2] - z) / ec) ** 2;
        if (q > 0) h = Math.max(h, v[1] + eb * Math.sqrt(q));
      }
      if (h > -Infinity && (!best || h < best.h)) best = { x, z, h };
    }
    const C = [best.x, best.h, best.z];
    const onEdge = Math.abs(best.x - x0) < 1e-3 || Math.abs(best.x - x1) < 1e-3 || Math.abs(best.z - z0) < 1e-3 || Math.abs(best.z - z1) < 1e-3;
    console.log(`ellipsoid [${ell}] rests with its centre at [${r4(C)}]${onEdge ? ' (ON REGION EDGE)' : ''}; lowest point y ${(best.h - eb).toFixed(4)}`);
    return;
  }
  const radii = (opt('radii') || '0.02,0.025,0.03,0.0325,0.035,0.0375,0.04,0.045,0.05').split(',').map(Number);
  const results = [];
  for (const R of radii) {
    let best = null;
    for (let x = x0; x <= x1 + 1e-9; x += 0.001) {
      for (let z = z0; z <= z1 + 1e-9; z += 0.001) {
        let h = -Infinity;
        for (const v of verts) {
          const d2 = (v[0] - x) ** 2 + (v[2] - z) ** 2;
          if (d2 < R * R) h = Math.max(h, v[1] + Math.sqrt(R * R - d2));
        }
        if (h > -Infinity && (!best || h < best.h)) best = { x, z, h };
      }
    }
    const C = [best.x, best.h, best.z];
    const ySurf = surfaceBelow(tris, best.x, best.z, best.h);
    const gap = best.h - R - ySurf;
    const onEdge = Math.abs(best.x - x0) < 1e-3 || Math.abs(best.x - x1) < 1e-3 || Math.abs(best.z - z0) < 1e-3 || Math.abs(best.z - z1) < 1e-3;
    const contacts = verts.filter((v) => Math.abs(len(sub(v, C)) - R) < 0.0015);
    const where = { palm: 0, fingers: 0, thumbSide: 0 };
    for (const v of contacts) {
      if (v[2] < (opt('knuckle-z') ? +opt('knuckle-z') : -0.035)) where.fingers++;
      else if (v[0] > (opt('thumb-x') ? +opt('thumb-x') : 0.03)) where.thumbSide++;
      else where.palm++;
    }
    results.push({ R, center: C, palmPoint: [best.x, ySurf, best.z], gap, onEdge, contacts: where });
    console.log(`R ${R.toFixed(4)}: rests at centre [${r4(C)}], palm surface y ${ySurf.toFixed(4)}, gap ${(gap * 1000).toFixed(1)} mm` +
      `${onEdge ? ' (ON REGION EDGE)' : ''}, contacts palm ${where.palm} fingers ${where.fingers} thumb-side ${where.thumbSide}`);
  }
  // "Sits nicely": held by palm AND fingers, not lifted by the thumb, and the curled fingertips reach the fruit's equator.
  const knuckleZ = opt('knuckle-z') ? +opt('knuckle-z') : -0.035, thumbX = opt('thumb-x') ? +opt('thumb-x') : 0.03;
  const tipY = Math.max(...verts.filter((v) => v[2] < knuckleZ && v[0] < thumbX).map((v) => v[1]));
  console.log(`fingertip top y ${tipY.toFixed(4)}`);
  const seated = results.filter((r) => !r.onEdge && r.contacts.palm > 0 && r.contacts.fingers > 0 && r.contacts.thumbSide === 0 && r.center[1] <= tipY);
  const pick = opt('radius') ? results.find((r) => Math.abs(r.R - +opt('radius')) < 1e-6) : seated.at(-1);
  if (!pick) throw new Error('no radius is cradled by palm and fingers inside the region');
  // Palm normal: area-weighted normal of upward-facing palm triangles within 2.5 cm of the grip point (near the surface).
  let n = [0, 0, 0];
  for (const t of tris) {
    const d = Math.hypot(t.centroid[0] - pick.palmPoint[0], t.centroid[2] - pick.palmPoint[2]);
    if (d < 0.025 && t.n[1] > 0.3 && Math.abs(t.centroid[1] - pick.palmPoint[1]) < 0.012) n = add(n, scl(t.n, t.area));
  }
  n = norm(n);
  const tiltDeg = (Math.acos(Math.min(1, n[1])) * 180) / Math.PI;
  console.log(`\nrecommended fruitRadius ${pick.R} (largest R cradled by palm + fingers up to its equator); grip point (palm surface) [${r4(pick.palmPoint)}], ` +
    `sphere centre [${r4(pick.center)}]; local palm normal [${r4(n)}] = ${tiltDeg.toFixed(1)}° from +Y`);
  const assetId = opt('apply');
  if (assetId) {
    updateRegistry(assetId, (a) => {
      const prev = a.pivot_offset || [0, 0, 0];
      a.pivot_offset = r4(add(prev, pick.palmPoint));
      const centre = r4(sub(pick.center, pick.palmPoint));
      a.manifest_extra = {
        ...(a.manifest_extra || {}),
        gripPoint: [0, 0, 0],
        fruitRadius: pick.R,
        fruitCenter: centre,
        palmNormal: r4(n),
      };
      a.grip_analysis = { radii: results.map((r) => ({ R: r.R, gap_mm: +(r.gap * 1000).toFixed(1), center: r4(sub(r.center, pick.palmPoint)), contacts: r.contacts, onEdge: r.onEdge })) };
      console.log(`assets.json ${assetId}: pivot_offset [${a.pivot_offset}], fruitCenter [${centre}]`);
    });
  }
}

const modes = { fruit: analyzeFruit, hand: analyzeHand };
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!modes[mode] || !file) {
    console.log('usage: analyze-shape.mjs <fruit|hand> <file.glb> [--diameter m | --length m] [--apply assetId]');
    process.exit(1);
  }
  modes[mode]().catch((err) => {
    console.error(`ERROR: ${err.stack || err.message}`);
    process.exit(1);
  });
}
