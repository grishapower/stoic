#!/usr/bin/env node
// Free, local "kitbash" recipes that turn refined Meshy meshes into assets Meshy could not produce directly.
// Output: assets-src/meshy/raw/<asset>/kitbash/<asset>.glb (same material/textures as the source; one mesh), which
// optimize-glb.mjs then picks up through assets.json -> <asset>.source_glb + input_from: "source_glb".
//   node scripts/meshy/kitbash.mjs <recipe> [--report]
// Recipes: exedra-bench (semicircular exedra from the round-1 stone-bench parts), merchant-ship (aft mast -> artemon),
// oscillum (high relief -> low relief on both faces).
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { createIO } from '../assets/optimize-glb.mjs';
import { ROOT, RAW_DIR, rel } from './lib/paths.mjs';
import { updateAsset } from './lib/registry.mjs';
import {
  readSoup, writeSoup, normalize, clip, clipBox, select, bounds, affine, translate, scale, rotY, rotZ, tessellate, deform, simplifyPart,
} from './lib/kitbash.mjs';

const recipeId = process.argv[2];

// ---------- exedra-bench ----------
// Semicircular schola built from stone-bench (round 1: plain slab on two lion-head trapezophoros supports):
//  * seat slab: slab end pieces + N tiled middle sections (block joints), scaled to seat 0.46 m high, 0.43 m deep;
//  * back wall + backrest: the same slab assembly turned upright (0.84 m tall, 0.12 m thick) behind the seat;
//  * 5 lion supports (pre-simplified copies of the right support, uniform scale ~0.749) placed rigidly along the arc;
//  * slab parts are simplified, tessellated along X (25 cm) and bent around a vertical axis: inner (seat-front) radius 2.10 m,
//    180 degrees, opening toward +Z (sitters face the centre / +Z).
const EX = {
  source: 'assets-src/meshy/raw/stone-bench/main/refine.glb',
  slabBottom: 0.188, slabTop: 0.305, floor: -0.306, slabZ: [-0.28, 0.281], slabEndX: 0.952, tileHalf: 0.45,
  support: { xMin: 0.5, center: 0.716, halfWidth: 0.163 },
  seatTop: 0.46, seatThickness: 0.09, seatFront: 0.26, seatBack: -0.17, backThickness: 0.12, backTop: 0.84,
  innerRadius: 2.1, supports: 5, supportTris: 1900, supportError: 0.03, slabPieceTris: 120, tessellate: 0.25,
};

async function exedra() {
  const io = await createIO();
  const doc = await io.read(path.join(ROOT, EX.source));
  const all = readSoup(doc);
  const s = (EX.seatTop - EX.seatThickness) / (EX.slabBottom - EX.floor); // uniform support scale (support top = seat underside)
  const supportTop = (EX.slabBottom - EX.floor) * s;
  const Zc = EX.seatFront + EX.innerRadius; // arc centre (straight frame z)
  const seatMid = (EX.seatFront + EX.seatBack) / 2;
  const Rc = Zc - seatMid; // reference radius: arc length preserved along the seat centreline
  const L = Math.PI * Rc;

  // Slab pieces in raw coordinates (exact clips).
  const slab = clip(all, 'y', EX.slabBottom - 0.002, 'above');
  // Pieces are simplified first (flat slab; Meshy surface noise is carried by the normal map), 3 mm max error.
  const endR = await simplifyPart(clip(slab, 'x', EX.tileHalf, 'above'), EX.slabPieceTris, 0.003);
  const endL = await simplifyPart(clip(slab, 'x', -EX.tileHalf, 'below'), EX.slabPieceTris, 0.003);
  const mid = await simplifyPart(clipBox(slab, { min: [-EX.tileHalf, null, null], max: [EX.tileHalf, null, null] }), EX.slabPieceTris, 0.003);
  console.log(`slab ${slab.length} tris -> pieces L ${endL.length} / mid ${mid.length} / R ${endR.length}`);
  const endLen = EX.slabEndX - EX.tileHalf, tileLen = 2 * EX.tileHalf;
  const nTiles = Math.round((L - 2 * endLen) / tileLen);
  const kx = (L - 2 * endLen) / (nTiles * tileLen);
  // Lay the pieces out along x in [-L/2, L/2] (raw slab frame otherwise).
  const strip = [];
  strip.push(...translate(endL, [-L / 2 + EX.slabEndX, 0, 0]));
  for (let i = 0; i < nTiles; i++) {
    const x0 = -L / 2 + endLen + (i + 0.5) * tileLen * kx;
    // Odd tiles are mirrored in X: breaks up texture repetition and makes neighbouring joints continuous.
    const sx = i % 2 ? -kx : kx;
    strip.push(...affine(mid, [sx, 0, 0, 0, 1, 0, 0, 0, 1], [x0, 0, 0]));
  }
  strip.push(...translate(endR, [L / 2 - EX.slabEndX, 0, 0]));

  // Seat: y [slabBottom, slabTop] -> [supportTop, seatTop]; z [slabZ] -> [seatBack, seatFront].
  const [z0, z1] = EX.slabZ;
  const ky = (EX.seatTop - supportTop) / (EX.slabTop - EX.slabBottom);
  const kz = (EX.seatFront - EX.seatBack) / (z1 - z0);
  const seat = affine(strip, [1, 0, 0, 0, ky, 0, 0, 0, kz], [0, supportTop - EX.slabBottom * ky, EX.seatBack - z0 * kz]);
  // Back wall: slab turned upright. New y = (z - z0) * hy (slab front edge at the top), new z = seatBack - (slabTop - y) * tz
  // (seat surface faces the sitter, slab underside faces outward).
  const hy = EX.backTop / (z1 - z0);
  const tz = EX.backThickness / (EX.slabTop - EX.slabBottom);
  const back = affine(strip, [1, 0, 0, 0, 0, hy, 0, tz, 0], [0, -z0 * hy, EX.seatBack - EX.slabTop * tz]);

  // Bend seat + back around the arc.
  const bend = (v) => {
    const th = v.p[0] / Rc, d = Zc - v.p[2], c = Math.cos(th), sn = Math.sin(th);
    return { p: [d * sn, v.p[1], Zc - d * c], n: [c * v.n[0] - sn * v.n[2], v.n[1], sn * v.n[0] + c * v.n[2]] };
  };
  const bent = deform(tessellate([...seat, ...back], EX.tessellate, 0), bend); // split along the arc direction only

  // Supports: right support, simplified, centred, scaled; placed rigidly at arc positions.
  let sup = clip(all, 'y', EX.slabBottom - 0.002, 'below');
  sup = select(sup, (c) => c[0] > EX.support.xMin);
  sup = await simplifyPart(sup, EX.supportTris, EX.supportError);
  sup = scale(translate(sup, [-EX.support.center, -EX.floor, 0]), [s, s, s]);
  const inset = (EX.slabEndX - EX.support.center - EX.support.halfWidth) + EX.support.halfWidth * s;
  const xs = Array.from({ length: EX.supports }, (_, i) => -L / 2 + inset + (i * (L - 2 * inset)) / (EX.supports - 1));
  const supports = [];
  for (const x0 of xs) {
    const th = x0 / Rc, d = Zc - seatMid;
    supports.push(...rotY(sup, (-th * 180) / Math.PI, [d * Math.sin(th), 0, Zc - d * Math.cos(th)]));
  }
  // rotY turns each support about its own origin (centred, z=0) to face the arc centre, then moves it onto the seat centreline.

  const tris = [...bent, ...supports];
  writeSoup(doc, tris);
  const out = path.join(RAW_DIR, 'exedra-bench', 'kitbash', 'exedra-bench.glb');
  mkdirSync(path.dirname(out), { recursive: true });
  await io.write(out, doc);
  const b = bounds(tris);
  const report = {
    tris: tris.length, slabParts: bent.length, supportTris: sup.length, supports: xs.length, tiles: nTiles,
    supportScale: +s.toFixed(4), arcCenterRaw: [0, 0, +Zc.toFixed(3)], innerRadius: EX.innerRadius, Rc: +Rc.toFixed(3),
    outerRadius: +(Zc - (EX.seatBack - EX.backThickness)).toFixed(3), seatTop: EX.seatTop, backTop: EX.backTop,
    bounds: { min: b.min.map((v) => +v.toFixed(3)), max: b.max.map((v) => +v.toFixed(3)) },
    // Optimize recentres on the bounding box: arc centre in the shipped file = Zc - bbox centre z.
    arcCenterFinal: [0, 0, +(Zc - (b.min[2] + b.max[2]) / 2).toFixed(3)],
  };
  console.log(JSON.stringify(report, null, 1));
  updateAsset('exedra-bench', (a) => {
    a.source_glb = rel(out);
    a.input_from = 'source_glb';
    a.kitbash = { recipe: 'exedra-bench', source: EX.source, source_task_ids: { preview: '01a15434-ba49-7415-8e74-02e159ccba7c', refine: '01a15436-1fb8-75bb-aa92-5c58e6a58f05' }, report };
  });
}

// ---------- merchant-ship ----------
// Meshy gave a two-master (big square mainsail slightly forward of midship + a smaller braced square sail on an aft
// mast). A corbita has the mainmast plus a small forward-raked artemon at the bow, so the aft mast assembly (mast,
// yard, sail, pennant, its own rigging) is cut out, scaled x0.6, raked 35 degrees forward and stepped in the bow.
// Raw frame: length along X, stern (swan neck) at -X, bow at +X; optimize rotates bow to +Z.
const MS = {
  source: 'assets-src/meshy/raw/merchant-ship/main/refine.glb',
  box: { x: [-0.42, 0.06], yMin: -0.36 }, mast: { x: -0.15, r: 0.03, step: -0.497 }, rigTop: -0.3,
  artemon: { scale: 0.6, rakeDeg: 35, foot: [0.64, -0.40, 0] },
};

async function merchant() {
  const io = await createIO();
  const doc = await io.read(path.join(ROOT, MS.source));
  const all = readSoup(doc);
  const len = (a, b) => Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1], a.p[2] - b.p[2]);
  const isRigging = (t) => {
    const e = [len(t[0], t[1]), len(t[1], t[2]), len(t[2], t[0])].sort((a, b) => a - b);
    return e[2] > 0.06 && e[0] < 0.012; // long, very thin sliver = rope
  };
  const inX = (v, pad = 0) => v.p[0] > MS.box.x[0] - pad && v.p[0] < MS.box.x[1] + pad;
  const mastCol = (v) => Math.abs(v.p[0] - MS.mast.x) < MS.mast.r && Math.abs(v.p[2]) < MS.mast.r && v.p[1] >= MS.mast.step - 0.01;
  const inA = (t) => {
    if (t.every(mastCol)) return true;
    if (isRigging(t)) return t.some((v) => inX(v) && v.p[1] > MS.rigTop) && t.every((v) => inX(v, 0.02));
    return t.every((v) => inX(v) && v.p[1] > MS.box.yMin);
  };
  const A = all.filter(inA);
  // Rope stubs left on deck at the old mast position are dropped.
  const stub = (t) => isRigging(t) && t.every((v) => inX(v) && v.p[1] < MS.rigTop + 0.05);
  const rest = all.filter((t) => !inA(t) && !stub(t));
  const { scale: k, rakeDeg, foot } = MS.artemon;
  // Foot of the mast to the origin, scale, rake forward (top toward +X), move to the bow.
  const art = rotZ(scale(translate(A, [-MS.mast.x, -MS.mast.step, 0]), [k, k, k]), -rakeDeg, foot);
  const tris = [...rest, ...art];
  writeSoup(doc, tris);
  const out = path.join(RAW_DIR, 'merchant-ship', 'kitbash', 'merchant-ship.glb');
  mkdirSync(path.dirname(out), { recursive: true });
  await io.write(out, doc);
  const report = { moved: A.length, kept: rest.length, droppedStubs: all.length - A.length - rest.length, tris: tris.length, artemon: MS.artemon };
  console.log(JSON.stringify(report));
  updateAsset('merchant-ship', (a) => { a.source_glb = rel(out); a.input_from = 'source_glb'; a.kitbash = { recipe: 'merchant-ship', source: MS.source, report }; });
}

// ---------- oscillum ----------
// Meshy made the masks as two protruding high-relief heads on one face only. Here the relief is flattened to low
// relief (x0.11 in depth, pulled 8% toward the centre so it stays inside the rim), the disc is thickened to 3 cm and the
// relief is mirrored onto the back face, so both faces carry the masks. The bronze ring (top centre) is untouched.
// Raw frame: disc in the XY plane, back face z=-0.34, front face z=-0.28, relief toward +Z.
const OS = {
  source: 'assets-src/meshy/raw/oscillum/main/refine.glb',
  zBack: -0.34, zFront: -0.28, relief: 0.11, thicken: 2.2, shrinkXY: 0.92, ring: { x: 0.12, y: 0.6 }, reliefTris: 2100,
};

async function oscillum() {
  const io = await createIO();
  const doc = await io.read(path.join(ROOT, OS.source));
  const all = readSoup(doc);
  const zm = (OS.zBack + OS.zFront) / 2, half = (OS.zFront - zm) * OS.thicken;
  const isRing = (v) => Math.abs(v.p[0]) < OS.ring.x && v.p[1] > OS.ring.y && v.p[2] > OS.zFront;
  const ringTri = (t) => t.every(isRing);
  // The ring stood ~3.4 cm in front of the disc; recentre it on the disc mid-plane so it hangs plumb from the top edge.
  const rb = bounds(all.filter(ringTri));
  const ringShift = zm - (rb.min[2] + rb.max[2]) / 2;
  // Piecewise-linear depth map: disc slab thickened, relief above the front face compressed.
  const mapV = (v) => {
    const [x, y, z] = v.p;
    const h = z - OS.zFront;
    if (h <= 0) {
      const zz = zm + (z - zm) * OS.thicken;
      return { p: [x, y, zz], n: normalize([v.n[0], v.n[1], v.n[2] / OS.thicken]) };
    }
    const w = Math.min(1, h / 0.04); // fade in the XY pull over the first 4 cm of relief height
    const f = 1 - (1 - OS.shrinkXY) * w;
    return { p: [x * f, y * f, zm + half + h * OS.relief], n: normalize([v.n[0], v.n[1], v.n[2] / OS.relief]) };
  };
  const mapped = all.map((t) => (ringTri(t) ? translate([t], [0, 0, ringShift])[0] : t.map((v) => ({ ...mapV(v), uv: v.uv }))));
  // The flattened relief is simplified where seams allow (Meshy's fragmented atlas limits it: ~6.5k tris total).
  const inRelief = (t) => !ringTri(t) && t.every((v) => v.p[2] > zm + half + 0.001);
  const reliefTris = await simplifyPart(mapped.filter(inRelief), OS.reliefTris, 0.02); // permissive collapses garble the mask texture (tested)
  const front = [...mapped.filter((t) => !inRelief(t)), ...reliefTris];
  // Mirror the relief (everything in front of the front face, minus the ring) onto the back.
  const back = affine(reliefTris, [1, 0, 0, 0, 1, 0, 0, 0, -1], [0, 0, 2 * zm]);
  const tris = [...front, ...back];
  writeSoup(doc, tris);
  const out = path.join(RAW_DIR, 'oscillum', 'kitbash', 'oscillum.glb');
  mkdirSync(path.dirname(out), { recursive: true });
  await io.write(out, doc);
  const top = tris.flat().reduce((m, v) => (v.p[1] > m.p[1] ? v : m));
  const b = bounds(tris);
  const report = { tris: tris.length, mirrored: back.length, ringShift: +ringShift.toFixed(4), ringTopRaw: top.p.map((v) => +v.toFixed(4)), bounds: { min: b.min.map((v) => +v.toFixed(3)), max: b.max.map((v) => +v.toFixed(3)) } };
  console.log(JSON.stringify(report));
  updateAsset('oscillum', (a) => { a.source_glb = rel(out); a.input_from = 'source_glb'; a.kitbash = { recipe: 'oscillum', source: OS.source, settings: OS, report }; });
}

const recipes = { 'exedra-bench': exedra, 'merchant-ship': merchant, oscillum };
if (!recipes[recipeId]) {
  console.log(`usage: kitbash.mjs <${Object.keys(recipes).join('|')}>`);
  process.exit(1);
}
recipes[recipeId]().catch((err) => {
  console.error(`ERROR: ${err.stack || err.message}`);
  process.exit(1);
});
