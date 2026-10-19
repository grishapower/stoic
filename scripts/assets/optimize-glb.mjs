#!/usr/bin/env node
// Optimize raw Meshy GLBs for the game and update src/data/generated/models.json.
//   node scripts/assets/optimize-glb.mjs <assetId>... | --all   [--in raw.glb --out outId]
// Pipeline: dedup -> weld -> (simplify if over budget) -> normalize (scale to real size, bottom-centre pivot,
// optional Y rotation, baked) -> WebP textures (sharp, capped size) -> meshopt (EXT_meshopt_compression). No Draco.
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup, weld, unweld, normals, prune, simplify, textureCompress, meshopt, getBounds, clearNodeTransform, listTextureSlots,
} from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { ROOT, MODELS_DIR, MANIFEST_FILE, REGISTRY_FILE, rel } from '../meshy/lib/paths.mjs';

export const LICENSE = 'Meshy-generated (account owner)';

export async function createIO() {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
}

export function defaultScene(doc) {
  const root = doc.getRoot();
  return root.getDefaultScene() || root.listScenes()[0];
}

// Triangles drawn by the scene (instanced meshes counted per node).
export function countTriangles(doc) {
  let tris = 0;
  defaultScene(doc).traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    for (const prim of mesh.listPrimitives()) {
      const n = prim.getIndices() ? prim.getIndices().getCount() : prim.getAttribute('POSITION').getCount();
      if (prim.getMode() === 4) tris += n / 3;
    }
  });
  return Math.round(tris);
}

export function boundsSize(doc) {
  const { min, max } = getBounds(defaultScene(doc));
  return { min, max, size: [0, 1, 2].map((i) => +(max[i] - min[i]).toFixed(3)) };
}

const yQuat = (deg) => {
  const r = (deg * Math.PI) / 180;
  return [0, Math.sin(r / 2), 0, Math.cos(r / 2)];
};

function bake(node) {
  clearNodeTransform(node);
  for (const child of node.listChildren()) bake(child);
}

// Quaternion multiply (a * b) and Euler XYZ degrees -> quaternion (applied X first, then Y, then Z).
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
export function eulerDegToQuat([x = 0, y = 0, z = 0]) {
  const h = (d) => (d * Math.PI) / 360;
  const qx = [Math.sin(h(x)), 0, 0, Math.cos(h(x))], qy = [0, Math.sin(h(y)), 0, Math.cos(h(y))], qz = [0, 0, Math.sin(h(z)), Math.cos(h(z))];
  return qmul(qz, qmul(qy, qx));
}

/**
 * Wrap scene content in a root node named `name`, rotate (Y degrees, Euler XYZ degrees or a quaternion), scale to the
 * target real-world size and move the pivot: 'bottom-center' (default: y=0 at the floor, centred in X/Z) or 'center'
 * (bounding-box centre). `pivotOffset` (final-frame metres) is then subtracted, i.e. that point becomes the origin.
 * `mirrorX` mirrors across the final X axis (winding is fixed when baking). Non-skinned content is baked into vertices.
 */
export function normalize(doc, {
  name, fit = 'height', value, rotateYDeg = 0, rotateDeg = null, rotationQuat = null, pivot = 'bottom-center',
  pivotOffset = null, mirrorX = false, bakeTransforms = true,
}) {
  const scene = defaultScene(doc);
  const wrapper = doc.createNode(name);
  for (const child of scene.listChildren()) {
    scene.removeChild(child);
    wrapper.addChild(child);
  }
  let outer = wrapper;
  if (mirrorX) {
    outer = doc.createNode(`${name}_mirror`).setScale([-1, 1, 1]).addChild(wrapper);
  }
  scene.addChild(outer);
  if (rotationQuat) wrapper.setRotation(rotationQuat);
  else if (rotateDeg) wrapper.setRotation(eulerDegToQuat(rotateDeg));
  else if (rotateYDeg) wrapper.setRotation(yQuat(rotateYDeg));
  let { size } = boundsSize(doc);
  let s = 1;
  if (value) {
    if (fit === 'height') s = value / size[1];
    else if (fit === 'longest_horizontal') s = value / Math.max(size[0], size[2]);
    else if (fit === 'x') s = value / size[0];
    else if (fit === 'z') s = value / size[2];
    else if (fit === 'scale') s = value; // explicit factor (e.g. measured fruit-body diameter)
    else throw new Error(`unknown fit ${fit}`);
  }
  wrapper.setScale([s, s, s]);
  const { min, max } = getBounds(scene);
  const t = [-(min[0] + max[0]) / 2, pivot === 'center' ? -(min[1] + max[1]) / 2 : -min[1], -(min[2] + max[2]) / 2];
  if (pivotOffset) for (let i = 0; i < 3; i++) t[i] -= pivotOffset[i];
  // The mirror node sits outside the wrapper, so its translation must be mirrored too.
  wrapper.setTranslation(mirrorX ? [-t[0], t[1], t[2]] : t);
  const skinned = doc.getRoot().listSkins().length > 0;
  if (bakeTransforms && !skinned) {
    bake(outer);
    if (mirrorX) {
      scene.removeChild(outer);
      outer.removeChild(wrapper);
      scene.addChild(wrapper);
      outer.dispose();
    }
  }
  return { scale: s, skinned };
}

// Drop emissive maps that are (near) black: Meshy-6 emits them even for non-glowing props.
async function dropBlackEmissive(doc) {
  for (const mat of doc.getRoot().listMaterials()) {
    const tex = mat.getEmissiveTexture();
    if (!tex) continue;
    const stats = await sharp(Buffer.from(tex.getImage())).stats();
    const maxChannel = Math.max(...stats.channels.slice(0, 3).map((c) => c.max));
    if (maxChannel < 10) {
      mat.setEmissiveTexture(null);
      mat.setEmissiveFactor([0, 0, 0]);
      console.log(`  dropped black emissive map on "${mat.getName()}"`);
    }
  }
}

// Optional art correction of base-colour textures (e.g. darker cypress foliage): sharp modulate.
// `max_saturation` (0-1, HSV) clamps only strongly coloured texels, e.g. paint-like drapery on a marble statue,
// and `clamp_value_mix` pulls those texels' brightness toward the median of the unclamped texels (0 = keep).
async function adjustAlbedo(doc, { brightness = 1, saturation = 1, max_saturation = null, clamp_value_mix = 0 } = {}) {
  for (const mat of doc.getRoot().listMaterials()) {
    const tex = mat.getBaseColorTexture();
    if (!tex) continue;
    let img = sharp(Buffer.from(tex.getImage()));
    if (max_saturation != null) {
      const { data, info } = await img.removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const vals = [];
      for (let i = 0; i < data.length; i += 3) {
        const mx = Math.max(data[i], data[i + 1], data[i + 2]), mn = Math.min(data[i], data[i + 1], data[i + 2]);
        if (mx > 0 && (mx - mn) / mx <= max_saturation) vals.push(mx);
      }
      vals.sort((a, b) => a - b);
      const vMed = vals[vals.length >> 1] ?? 200;
      let clamped = 0;
      for (let i = 0; i < data.length; i += 3) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if (!mx || (mx - mn) / mx <= max_saturation) continue;
        clamped++;
        const v = mx + (vMed - mx) * clamp_value_mix, k = v / mx;
        // Scale chroma down to max_saturation around the max channel, then rescale value.
        const f = (max_saturation * mx) / (mx - mn);
        data[i] = Math.min(255, (mx - (mx - r) * f) * k);
        data[i + 1] = Math.min(255, (mx - (mx - g) * f) * k);
        data[i + 2] = Math.min(255, (mx - (mx - b) * f) * k);
      }
      img = sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } });
      console.log(`  base colour: ${clamped} texels clamped to saturation ${max_saturation} (value mix ${clamp_value_mix} toward ${vMed})`);
    }
    if (brightness !== 1 || saturation !== 1) img = img.modulate({ brightness, saturation });
    tex.setImage(new Uint8Array(await img.png().toBuffer())).setMimeType('image/png');
    console.log(`  base colour adjusted (brightness ${brightness}, saturation ${saturation})`);
  }
}

export async function compressTextures(doc, maxSize) {
  await dropBlackEmissive(doc);
  const resize = [maxSize, maxSize];
  await doc.transform(
    // Normal maps keep higher quality to avoid banding.
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize, slots: /^normalTexture$/, quality: 92, effort: 5 }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize, slots: /^(?!normalTexture$).+/, quality: 85, effort: 5 }),
  );
}

export async function finalizeAndWrite(io, doc, outFile) {
  await doc.transform(prune(), dedup(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  mkdirSync(path.dirname(outFile), { recursive: true });
  await io.write(outFile, doc);
  return statSync(outFile).size;
}

export async function texturesSummary(doc) {
  const out = [];
  for (const t of doc.getRoot().listTextures()) {
    const meta = await sharp(Buffer.from(t.getImage())).metadata();
    out.push({ slots: listTextureSlots(t), mime: t.getMimeType(), size: [meta.width, meta.height], bytes: t.getImage().byteLength });
  }
  return out;
}

export function updateManifest(id, entry) {
  const manifest = existsSync(MANIFEST_FILE) ? JSON.parse(readFileSync(MANIFEST_FILE, 'utf8')) : {};
  manifest[id] = entry;
  const sorted = Object.fromEntries(Object.keys(manifest).sort().map((k) => [k, manifest[k]]));
  mkdirSync(path.dirname(MANIFEST_FILE), { recursive: true });
  writeFileSync(MANIFEST_FILE, JSON.stringify(sorted, null, 2) + '\n');
}

function updateRegistryAsset(assetId, fn) {
  const reg = JSON.parse(readFileSync(REGISTRY_FILE, 'utf8'));
  fn(reg.assets[assetId]);
  writeFileSync(REGISTRY_FILE, JSON.stringify(reg, null, 2) + '\n');
}

// Every triangle primitive in the scene (after normalize() everything is baked into world space).
function listTrianglePrims(doc) {
  const prims = [];
  defaultScene(doc).traverse((node) => {
    for (const prim of node.getMesh()?.listPrimitives() || []) if (prim.getMode() === 4 && prim.getIndices()) prims.push(prim);
  });
  return prims;
}

/** Keep only triangles whose centroid lies inside box {min, max} (raw model coordinates, before normalize). */
function cropToBox(doc, { min, max }) {
  for (const prim of listTrianglePrims(doc)) {
    const pos = prim.getAttribute('POSITION');
    const idx = prim.getIndices().getArray();
    const keep = [];
    for (let t = 0; t < idx.length; t += 3) {
      const c = [0, 0, 0];
      for (let k = 0; k < 3; k++) { const p = pos.getElement(idx[t + k], []); for (let i = 0; i < 3; i++) c[i] += p[i] / 3; }
      if (c.every((v, i) => v >= min[i] && v <= max[i])) keep.push(idx[t], idx[t + 1], idx[t + 2]);
    }
    prim.getIndices().setArray(new Uint32Array(keep));
  }
}

/**
 * Vertex-clustering simplification (meshopt simplifySloppy) for meshes whose UV atlas is so fragmented that edge
 * collapse cannot proceed (e.g. Meshy foliage: ~2.4 vertices per triangle). Normals are dropped before welding and
 * recomputed flat afterwards (faceted look as in the source). Texture can smear where clusters span UV islands.
 */
async function simplifySloppyTo(doc, targetTris) {
  await MeshoptSimplifier.ready;
  for (const prim of listTrianglePrims(doc)) {
    const n = prim.getAttribute('NORMAL');
    if (n) { prim.setAttribute('NORMAL', null); if (!n.listParents().some((p) => p !== doc.getRoot())) n.dispose(); }
  }
  await doc.transform(dedup(), prune(), weld());
  for (const prim of listTrianglePrims(doc)) {
    const positions = new Float32Array(prim.getAttribute('POSITION').getArray());
    const indices = new Uint32Array(prim.getIndices().getArray());
    const share = targetTris / countTriangles(doc);
    const [out, err] = MeshoptSimplifier.simplifySloppy(indices, positions, 3, null, Math.floor((indices.length / 3) * share) * 3, 0.05);
    prim.getIndices().setArray(out);
    console.log(`  sloppy simplify: ${indices.length / 3} -> ${out.length / 3} tris (error ${err.toFixed(4)})`);
  }
  await doc.transform(prune(), unweld(), normals({ overwrite: true }));
}

/**
 * Circular bend in the final frame (used to curl a hand's fingers): vertices with z < start_z (toward -Z) are bent
 * up (+Y) around a line parallel to X through (y = neutral_y, z = start_z) with the given curvature (1/m), up to
 * max_angle_deg, then continue straight. `x_fade: [x0, x1]` scales the bend from full (x <= x0) to none (x >= x1),
 * e.g. to leave the thumb (+X on a palm-up right hand) unbent. Normals are rotated with the surface.
 */
export function bendMesh(doc, { start_z: z0, neutral_y: yn, curvature, max_angle_deg: maxDeg = 90, x_fade: fade = null }) {
  const phiMax = (maxDeg * Math.PI) / 180;
  for (const prim of listTrianglePrims(doc)) {
    const pos = prim.getAttribute('POSITION');
    const nrm = prim.getAttribute('NORMAL');
    for (let i = 0; i < pos.getCount(); i++) {
      const [x, y, z] = pos.getElement(i, []);
      const s = z0 - z;
      if (s <= 0) continue;
      let w = 1;
      if (fade) {
        const t = Math.min(1, Math.max(0, (x - fade[0]) / (fade[1] - fade[0])));
        w = 1 - t * t * (3 - 2 * t);
      }
      const k = curvature * w;
      if (k < 1e-6) continue;
      const R = 1 / k, h = y - yn;
      const sArc = Math.min(s, phiMax / k);
      const phi = k * sArc;
      const extra = s - sArc;
      const zz = z0 - (R - h) * Math.sin(phi) - extra * Math.cos(phi);
      const yy = yn + R - (R - h) * Math.cos(phi) + extra * Math.sin(phi);
      pos.setElement(i, [x, yy, zz]);
      if (nrm) {
        const [nx, ny, nz] = nrm.getElement(i, []);
        nrm.setElement(i, [nx, ny * Math.cos(phi) - nz * Math.sin(phi), ny * Math.sin(phi) + nz * Math.cos(phi)]);
      }
    }
  }
}

/**
 * Horizontal (XZ) stretch about the vertical axis through (0, 0), ramped by height in the final frame: factor 1 below
 * from_y, full `factor` above to_y (smoothstep between). Used to widen a tree crown without thickening the trunk.
 */
export function stretchXZ(doc, { from_y: y0, to_y: y1, factor }) {
  for (const prim of listTrianglePrims(doc)) {
    const pos = prim.getAttribute('POSITION');
    const nrm = prim.getAttribute('NORMAL');
    for (let i = 0; i < pos.getCount(); i++) {
      const [x, y, z] = pos.getElement(i, []);
      const t = Math.min(1, Math.max(0, (y - y0) / (y1 - y0)));
      const f = 1 + (factor - 1) * t * t * (3 - 2 * t);
      if (f === 1) continue;
      pos.setElement(i, [x * f, y, z * f]);
      if (nrm) {
        // Inverse-transpose of diag(f, 1, f) (ignoring the small ramp derivative).
        const [nx, ny, nz] = nrm.getElement(i, []);
        const m = [nx / f, ny, nz / f], l = Math.hypot(...m) || 1;
        nrm.setElement(i, m.map((v) => v / l));
      }
    }
  }
}

/** Non-uniform scale about the origin in the final frame (e.g. slimmer bench depth); normals use the inverse scale. */
export function scaleScene(doc, k) {
  for (const prim of listTrianglePrims(doc)) {
    const pos = prim.getAttribute('POSITION');
    const nrm = prim.getAttribute('NORMAL');
    for (let i = 0; i < pos.getCount(); i++) {
      const p = pos.getElement(i, []);
      pos.setElement(i, [p[0] * k[0], p[1] * k[1], p[2] * k[2]]);
      if (nrm) {
        const n = nrm.getElement(i, []), m = [n[0] / k[0], n[1] / k[1], n[2] / k[2]], l = Math.hypot(...m) || 1;
        nrm.setElement(i, m.map((v) => v / l));
      }
    }
  }
}

function translateScene(doc, t) {
  for (const prim of listTrianglePrims(doc)) {
    const pos = prim.getAttribute('POSITION');
    for (let i = 0; i < pos.getCount(); i++) {
      const p = pos.getElement(i, []);
      pos.setElement(i, [p[0] + t[0], p[1] + t[1], p[2] + t[2]]);
    }
  }
}

/** Optimize one prop GLB. Returns stats. */
export async function optimizeProp({ input, outId, assetId, settings, taskIds = {} }) {
  const io = await createIO();
  const doc = await io.read(input);
  const before = countTriangles(doc);
  if (settings.crop_box) {
    cropToBox(doc, settings.crop_box);
    await doc.transform(prune());
    console.log(`  cropped to box: ${before} -> ${countTriangles(doc)} tris`);
  }
  await doc.transform(dedup(), prune(), weld());
  const maxTris = settings.max_triangles;
  if (maxTris && countTriangles(doc) > maxTris) {
    if (settings.simplify_mode === 'sloppy') await simplifySloppyTo(doc, maxTris);
    else {
      const ratio = maxTris / countTriangles(doc);
      await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error: settings.simplify_error ?? 0.002, lockBorder: false }));
      console.log(`  simplified to ratio ${ratio.toFixed(3)} -> ${countTriangles(doc)} tris`);
    }
  }
  const tsm = settings.target_size_m || {};
  const { scale } = normalize(doc, {
    name: outId, fit: tsm.fit, value: tsm.value, rotateYDeg: settings.rotate_y_deg || 0, rotateDeg: settings.rotate_deg,
    rotationQuat: settings.rotation_quat, pivot: settings.pivot, mirrorX: !!settings.mirror_x,
  });
  // Deform in the normalized frame, then move the measured pivot (e.g. fruit-body centre, palm grip point) to the origin.
  if (settings.post_scale) scaleScene(doc, settings.post_scale);
  if (settings.bend) bendMesh(doc, settings.bend);
  if (settings.stretch_xz) stretchXZ(doc, settings.stretch_xz);
  if (settings.pivot_offset) translateScene(doc, settings.pivot_offset.map((v) => -v));
  const { size } = boundsSize(doc);
  const triangles = countTriangles(doc);
  if (settings.albedo_adjust) await adjustAlbedo(doc, settings.albedo_adjust);
  // Thin open shells (e.g. wicker strands) must render from both sides.
  if (settings.double_sided) for (const mat of doc.getRoot().listMaterials()) mat.setDoubleSided(true);
  await compressTextures(doc, settings.max_texture || 1024);
  const textures = await texturesSummary(doc);
  const outFile = path.join(MODELS_DIR, `${outId}.glb`);
  const bytes = await finalizeAndWrite(io, doc, outFile);
  console.log(`  ${outId}: ${before} -> ${triangles} tris, scale ${scale.toFixed(4)}, size [${size}] m, ${(bytes / 1024).toFixed(0)} KB`);
  updateManifest(outId, {
    file: `assets/models/${outId}.glb`,
    size,
    triangles,
    forward: settings.forward || '+Z',
    ...(settings.up ? { up: settings.up } : {}),
    ...(settings.forward_note ? { forwardNote: settings.forward_note } : {}),
    ...(settings.manifest_notes ? { notes: settings.manifest_notes } : {}),
    pivot: settings.pivot_label || settings.pivot || 'bottom-center',
    ...(settings.manifest_extra || {}),
    animations: [],
    source: settings.source_label || 'meshy',
    asset: assetId,
    taskIds,
    textures: textures.map((t) => ({ slots: t.slots, size: t.size })),
    bytes,
    license: settings.license_label || LICENSE,
  });
  return { outFile, bytes, triangles, size, scale };
}

// Resolve outputs for a registry asset: { outId: variantId }.
function outputsFor(asset, assetId) {
  return asset.outputs || { [assetId]: asset.selected_variant || Object.keys(asset.attempts || {})[0] || 'main' };
}

async function optimizeAsset(assetId) {
  const reg = JSON.parse(readFileSync(REGISTRY_FILE, 'utf8'));
  const asset = reg.assets[assetId];
  if (!asset) throw new Error(`unknown asset ${assetId}`);
  if (asset.kind === 'character') throw new Error(`${assetId} is a character: use scripts/assets/merge-character.mjs`);
  const results = {};
  for (const [outId, variantId] of Object.entries(outputsFor(asset, assetId))) {
    const att = asset.attempts?.[variantId];
    // Remesh-only assets have no attempts: their input is the downloaded remesh (assets.json -> source_glb).
    const inputFrom = asset.input_from || asset.variants?.[variantId]?.input_from;
    const fromRetexture = inputFrom === 'retexture';
    // Kitbash results (scripts/meshy/kitbash.mjs) are read from assets.json -> source_glb.
    const fromSource = inputFrom === 'source_glb';
    const input = fromSource ? asset.source_glb : (fromRetexture ? att?.retexture_files?.glb : att?.refine_files?.glb) || (!att && asset.source_glb);
    if (!input) throw new Error(`${assetId}/${variantId}: no refined GLB downloaded`);
    const v = asset.variants?.[variantId] || {};
    const settings = { ...asset, ...v, target_size_m: v.target_size_m || asset.target_size_m };
    console.log(`optimize ${assetId}/${variantId} -> ${outId}`);
    const taskIds = asset.task_ids_override ? asset.task_ids_override : asset.kitbash?.source_task_ids
      ? { ...asset.kitbash.source_task_ids, kitbash: asset.kitbash.recipe }
      : att
        ? { preview: att.preview?.task_id, refine: att.refine?.task_id, ...(fromRetexture ? { retexture: att.retexture?.task_id } : {}), ...(fromSource ? { kitbash: asset.kitbash?.recipe } : {}) }
        : { remesh: asset.remesh_task?.task_id, remeshSource: asset.remesh_task?.source_task };
    results[outId] = await optimizeProp({ input: path.join(ROOT, input), outId, assetId, settings, taskIds });
  }
  updateRegistryAsset(assetId, (a) => {
    a.optimized = Object.fromEntries(Object.entries(results).map(([k, r]) => [k, { path: rel(r.outFile), bytes: r.bytes, triangles: r.triangles, size: r.size, scale: +r.scale.toFixed(5) }]));
    a.optimized_path = Object.values(a.optimized)[0].path;
    a.status = 'optimized';
  });
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (n) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined);
  if (opt('in')) {
    // Ad-hoc mode: optimize an arbitrary GLB with explicit settings.
    const outId = opt('out') || path.basename(opt('in'), '.glb');
    const settings = { target_size_m: opt('height') ? { fit: 'height', value: +opt('height') } : {}, max_texture: +(opt('max-texture') || 1024) };
    await optimizeProp({ input: path.resolve(opt('in')), outId, assetId: outId, settings });
    return;
  }
  let ids = args.filter((a) => !a.startsWith('--'));
  if (args.includes('--all')) {
    const reg = JSON.parse(readFileSync(REGISTRY_FILE, 'utf8'));
    ids = Object.entries(reg.assets).filter(([, a]) => a.kind !== 'character' && ['downloaded', 'optimized'].includes(a.status)).map(([id]) => id);
  }
  if (!ids.length) throw new Error('usage: optimize-glb.mjs <assetId>... | --all | --in file.glb [--out id --height m]');
  for (const id of ids) await optimizeAsset(id);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`ERROR: ${err.stack || err.message}`);
    process.exit(1);
  });
}
