#!/usr/bin/env node
// Merge the Meshy-rigged character with its animation GLBs into ONE game GLB:
// rigged textured mesh + skeleton + all clips (retargeted by bone name, renamed to stable ids),
// root motion removed where requested (speed recorded), WebP textures <= 2048, meshopt. Updates models.json.
//   node scripts/assets/merge-character.mjs [assetId=seneca] [--dry-run]
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resample, prune } from '@gltf-transform/functions';
import sharp from 'sharp';
import {
  createIO, defaultScene, countTriangles, compressTextures, finalizeAndWrite, updateManifest, texturesSummary, LICENSE,
} from './optimize-glb.mjs';
import { posedBounds, worldMatrices, clipDuration, invertLinear, xformDir, xform } from '../meshy/lib/pose.mjs';
import { ROOT, MODELS_DIR, REGISTRY_FILE, rel } from '../meshy/lib/paths.mjs';

const args = process.argv.slice(2);
const assetId = args.find((a) => !a.startsWith('--')) || 'seneca';
const dryRun = args.includes('--dry-run');
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const reg = JSON.parse(readFileSync(REGISTRY_FILE, 'utf8'));
const asset = reg.assets[assetId];
if (!asset?.rig?.files?.rigged) throw new Error(`${assetId}: no rigged GLB in registry`);

const io = await createIO();
const target = await io.read(path.join(ROOT, asset.rig.files.rigged));
const troot = target.getRoot();
const tscene = defaultScene(target);
const buffer = troot.listBuffers()[0];

const rest = posedBounds(tscene, null, 0);

for (const a of troot.listAnimations()) {
  console.log(`  removing pre-existing clip "${a.getName()}" from rigged model`);
  a.dispose();
}

// Target bones by name (must be unique for three.js PropertyBinding).
const tnodes = new Map();
for (const n of troot.listNodes()) {
  if (tnodes.has(n.getName())) console.warn(`  WARNING duplicate node name "${n.getName()}"`);
  tnodes.set(n.getName(), n);
}
const skin = troot.listSkins()[0];
if (!skin) throw new Error('rigged model has no skin');
const jointNames = skin.listJoints().map((j) => j.getName());
console.log(`target: ${countTriangles(target)} tris, ${jointNames.length} joints`);

// ---- clip sources ----
const sources = [];
if (asset.rig.files.walking_glb) {
  sources.push({ file: asset.rig.files.walking_glb, clips: [{ index: 0, name: 'walk_basic', loop: true, in_place: true }] });
}
for (const t of asset.animate_tasks || []) {
  if (!t.files?.glb) continue;
  const metas = t.action_ids.map((id) => (asset.animations || []).find((a) => a.action_id === id));
  sources.push({ file: t.files.glb, clips: metas.map((m, index) => ({ index, ...m })) });
}

const clipsMeta = [];
const skeletonReport = [];

function copyAccessor(src, cache) {
  if (cache.has(src)) return cache.get(src);
  const acc = target.createAccessor(src.getName())
    .setType(src.getType())
    .setArray(src.getArray().slice())
    .setNormalized(src.getNormalized())
    .setBuffer(buffer);
  cache.set(src, acc);
  return acc;
}

for (const source of sources) {
  const sdoc = await io.read(path.join(ROOT, source.file));
  const sroot = sdoc.getRoot();
  const sanims = sroot.listAnimations();
  console.log(`source ${source.file}: clips [${sanims.map((a) => `${a.getName()} ${clipDuration(a).toFixed(2)}s`).join(', ')}]`);

  // Skeleton compatibility: same bone names and rest transforms.
  const sskin = sroot.listSkins()[0];
  let missing = 0, maxT = 0, maxR = 0;
  for (const j of sskin ? sskin.listJoints() : []) {
    const tn = tnodes.get(j.getName());
    if (!tn) { missing++; continue; }
    const dt = Math.hypot(...j.getTranslation().map((v, i) => v - tn.getTranslation()[i]));
    const dr = 1 - Math.abs(j.getRotation().reduce((s, v, i) => s + v * tn.getRotation()[i], 0));
    maxT = Math.max(maxT, dt);
    maxR = Math.max(maxR, dr);
  }
  skeletonReport.push({ file: source.file, joints: sskin?.listJoints().length ?? 0, missing, maxRestTranslationDelta: +maxT.toFixed(5), maxRestRotationDelta: +maxR.toFixed(6) });
  console.log(`  skeleton: ${sskin?.listJoints().length} joints, missing in target ${missing}, max rest Δt ${maxT.toExponential(2)}, Δrot ${maxR.toExponential(2)}`);

  const cache = new Map();
  for (const meta of source.clips) {
    const sanim = sanims[meta.index];
    if (!sanim) throw new Error(`${source.file}: clip #${meta.index} missing`);
    const libOk = !meta.library_name || [slug(meta.library_name), slug(meta.library_key)].includes(slug(sanim.getName())) ||
      slug(sanim.getName()).startsWith(slug(meta.library_name));
    if (!libOk) console.warn(`  WARNING clip #${meta.index} is "${sanim.getName()}", expected "${meta.library_name}" (using order)`);
    const anim = target.createAnimation(meta.name);
    let skipped = 0;
    for (const ch of sanim.listChannels()) {
      const tn = tnodes.get(ch.getTargetNode()?.getName());
      if (!tn) { skipped++; continue; }
      const ss = ch.getSampler();
      const sampler = target.createAnimationSampler()
        .setInput(copyAccessor(ss.getInput(), cache))
        .setOutput(copyAccessor(ss.getOutput(), cache))
        .setInterpolation(ss.getInterpolation());
      anim.addSampler(sampler);
      anim.addChannel(target.createAnimationChannel().setTargetNode(tn).setTargetPath(ch.getTargetPath()).setSampler(sampler));
    }
    if (skipped) console.warn(`  WARNING ${meta.name}: ${skipped} channels had no matching bone`);
    clipsMeta.push({ name: meta.name, source: sanim.getName(), action_id: meta.action_id ?? null, loop: meta.loop !== false, in_place: !!meta.in_place, anim });
  }
}

// ---- head pitch correction: the generated mesh looks upward in its bind pose ----
// Rotate neck/Head about their local axis matching world +X (positive = chin down), in the rest pose and in
// every clip, so the gaze is level. Post-multiplying keeps all clip motion relative to the corrected pose.
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const mergeCfg = asset.merge || {};
if (mergeCfg.head_pitch_deg) {
  const restW = worldMatrices(tscene, null, 0);
  for (const [boneName, frac] of Object.entries(mergeCfg.head_pitch_split || { Head: 1 })) {
    const bone = tnodes.get(boneName);
    if (!bone) throw new Error(`head correction: bone ${boneName} missing`);
    let ax = xformDir(invertLinear(restW.get(bone)), [1, 0, 0]);
    const len = Math.hypot(...ax);
    ax = ax.map((x) => x / len);
    const h = (mergeCfg.head_pitch_deg * frac * Math.PI) / 360;
    const corr = [ax[0] * Math.sin(h), ax[1] * Math.sin(h), ax[2] * Math.sin(h), Math.cos(h)];
    bone.setRotation(qmul(bone.getRotation(), corr));
    for (const anim of troot.listAnimations()) {
      for (const ch of anim.listChannels()) {
        if (ch.getTargetNode() !== bone || ch.getTargetPath() !== 'rotation') continue;
        const out = ch.getSampler().getOutput().clone();
        for (let k = 0; k < out.getCount(); k++) out.setElement(k, qmul(out.getElement(k, []), corr));
        ch.getSampler().setOutput(out);
      }
    }
  }
  console.log(`head pitch correction ${mergeCfg.head_pitch_deg}° over ${JSON.stringify(mergeCfg.head_pitch_split)}`);
}

// ---- root motion: measure, and strip horizontal drift on the hips for in-place clips ----
const hipsName = jointNames.find((n) => /hips|pelvis/i.test(n));
const hips = tnodes.get(hipsName);
const restWorld = worldMatrices(tscene, null, 0);
const parentLinear = hips.getParentNode() ? restWorld.get(hips.getParentNode()) : null;

function stripDrift(meta) {
  const ch = meta.anim.listChannels().find((c) => c.getTargetNode() === hips && c.getTargetPath() === 'translation');
  if (!ch) return 0;
  const sampler = ch.getSampler();
  // Copy the output before editing: it may be shared with other clips.
  const out = sampler.getOutput().clone();
  sampler.setOutput(out);
  const times = sampler.getInput();
  const n = out.getCount();
  const T = times.getElement(n - 1, [])[0] - times.getElement(0, [])[0];
  const first = out.getElement(0, []), last = out.getElement(n - 1, []);
  const dLocal = [0, 1, 2].map((i) => last[i] - first[i]);
  const dWorld = parentLinear ? xformDir(parentLinear, dLocal) : dLocal;
  const hWorld = [dWorld[0], 0, dWorld[2]];
  const horizontal = Math.hypot(hWorld[0], hWorld[2]);
  if (!meta.in_place || horizontal < 0.05) return { distance: horizontal, T };
  const hLocal = parentLinear ? xformDir(invertLinear(parentLinear), hWorld) : hWorld;
  const t0 = times.getElement(0, [])[0];
  for (let k = 0; k < n; k++) {
    const f = (times.getElement(k, [])[0] - t0) / T;
    const v = out.getElement(k, []);
    out.setElement(k, [v[0] - hLocal[0] * f, v[1] - hLocal[1] * f, v[2] - hLocal[2] * f]);
  }
  return { distance: horizontal, T, stripped: true, direction: hWorld.map((x) => +(x / horizontal).toFixed(3)) };
}

// Foot-plant speed for walk cycles: stance foot slides backward at the walking speed in an in-place clip.
function footSpeed(anim) {
  const feet = jointNames.filter((n) => /(left|right).*foot$|foot.*(left|right)|^(l|r)_?foot/i.test(n)).map((n) => tnodes.get(n));
  if (!feet.length) return null;
  const D = clipDuration(anim), dt = 1 / 120;
  const samples = feet.map(() => []);
  for (let t = 0; t <= D; t += dt) {
    const w = worldMatrices(tscene, anim, t);
    feet.forEach((f, i) => samples[i].push(xform(w.get(f), [0, 0, 0])));
  }
  const speeds = [];
  for (const s of samples) {
    const minY = Math.min(...s.map((p) => p[1]));
    for (let k = 1; k < s.length; k++) {
      if (s[k][1] < minY + 0.02 && s[k - 1][1] < minY + 0.02) speeds.push(Math.hypot(s[k][0] - s[k - 1][0], s[k][2] - s[k - 1][2]) / dt);
    }
  }
  speeds.sort((a, b) => a - b);
  return speeds.length ? +speeds[Math.floor(speeds.length / 2)].toFixed(3) : null;
}

for (const meta of clipsMeta) {
  meta.duration = +clipDuration(meta.anim).toFixed(3);
  const rm = stripDrift(meta);
  if (rm) {
    meta.root_motion_m = +rm.distance.toFixed(3);
    meta.root_speed_mps = rm.T ? +(rm.distance / rm.T).toFixed(3) : 0;
    if (rm.stripped) meta.root_motion_stripped = true;
  }
  if (/walk/.test(meta.name)) meta.foot_speed_mps = footSpeed(meta.anim);
}

// ---- normalize: feet on y=0, centred, height check (no baking: skinned); measured before head correction ----
const height = rest.max[1] - rest.min[1];
const wantH = asset.target_size_m?.value ?? asset.height_meters ?? 1.72;
console.log(`rest bounds min [${rest.min.map((x) => x.toFixed(3))}] max [${rest.max.map((x) => x.toFixed(3))}] height ${height.toFixed(3)} (target ${wantH})`);
const s = Math.abs(height - wantH) / wantH > 0.01 ? wantH / height : 1;
const offset = [-(rest.min[0] + rest.max[0]) / 2 * s, -rest.min[1] * s, -(rest.min[2] + rest.max[2]) / 2 * s];
if (s !== 1 || Math.hypot(...offset) > 0.005) {
  const wrapper = target.createNode(assetId).setScale([s, s, s]).setTranslation(offset);
  for (const c of tscene.listChildren()) { tscene.removeChild(c); wrapper.addChild(c); }
  tscene.addChild(wrapper);
  console.log(`  wrapper "${assetId}": scale ${s.toFixed(4)}, offset [${offset.map((x) => x.toFixed(3))}]`);
}
const speedScale = s; // speeds were measured before the wrapper scale
for (const m of clipsMeta) {
  for (const k of ['root_motion_m', 'root_speed_mps', 'foot_speed_mps']) if (typeof m[k] === 'number') m[k] = +(m[k] * speedScale).toFixed(3);
}

// ---- report ----
console.log('\nclips:');
for (const m of clipsMeta) {
  console.log(`  ${m.name.padEnd(16)} ${String(m.duration).padStart(6)}s  src="${m.source}"  loop=${m.loop}` +
    (m.root_motion_m != null ? `  root Δ ${m.root_motion_m} m (${m.root_speed_mps} m/s)${m.root_motion_stripped ? ' stripped' : ''}` : '') +
    (m.foot_speed_mps != null ? `  foot-plant speed ${m.foot_speed_mps} m/s` : ''));
}
if (dryRun) process.exit(0);

// ---- textures + compression ----
await target.transform(prune({ keepLeaves: true }), resample({ tolerance: 1e-4 }));
if (mergeCfg.base_color_saturation && mergeCfg.base_color_saturation !== 1) {
  for (const mat of troot.listMaterials()) {
    const tex = mat.getBaseColorTexture();
    if (!tex) continue;
    tex.setImage(new Uint8Array(await sharp(Buffer.from(tex.getImage())).modulate({ saturation: mergeCfg.base_color_saturation }).png().toBuffer()));
    tex.setMimeType('image/png');
  }
  console.log(`base colour saturation x${mergeCfg.base_color_saturation}`);
}
await compressTextures(target, asset.max_texture || 2048);
const textures = await texturesSummary(target);
const triangles = countTriangles(target);
const outFile = path.join(MODELS_DIR, `${assetId}.glb`);
const bytes = await finalizeAndWrite(io, target, outFile);
const finalBounds = posedBounds(defaultScene(target), null, 0);
const size = [0, 1, 2].map((i) => +(finalBounds.max[i] - finalBounds.min[i]).toFixed(3));
console.log(`\nwrote ${rel(outFile)} ${(bytes / 1024).toFixed(0)} KB, ${triangles} tris, size [${size}]`);

const notes = asset.clip_notes || {};
updateManifest(assetId, {
  file: `assets/models/${assetId}.glb`,
  size,
  triangles,
  forward: '+Z',
  pivot: 'bottom-center',
  ...(asset.manifest_notes ? { notes: asset.manifest_notes } : {}),
  skeleton: { joints: jointNames.length, hips: hipsName, boneNames: jointNames },
  animations: clipsMeta.map((m) => ({
    name: m.name,
    duration: m.duration,
    loop: m.loop,
    source: m.source,
    ...(m.action_id != null ? { meshyActionId: m.action_id } : {}),
    ...(m.root_motion_m != null ? { rootMotionMeters: m.root_motion_m, rootMotionStripped: !!m.root_motion_stripped } : {}),
    ...(m.foot_speed_mps != null ? { walkSpeedMps: m.foot_speed_mps } : {}),
    ...(notes[m.name] ? { notes: notes[m.name] } : {}),
  })),
  source: 'meshy',
  asset: assetId,
  taskIds: {
    preview: asset.attempts?.[asset.selected_variant]?.preview?.task_id,
    refine: asset.attempts?.[asset.selected_variant]?.refine?.task_id,
    rig: asset.rig.task_id,
    animate: (asset.animate_tasks || []).map((t) => t.task_id),
  },
  textures: textures.map((t) => ({ slots: t.slots, size: t.size })),
  bytes,
  license: LICENSE,
});

// Re-read the registry so concurrent pipeline writes are not clobbered.
const fresh = JSON.parse(readFileSync(REGISTRY_FILE, 'utf8'));
const fa = fresh.assets[assetId];
fa.optimized_path = rel(outFile);
fa.optimized = { [assetId]: { path: rel(outFile), bytes, triangles, size } };
fa.merge_report = { skeleton: skeletonReport, clips: clipsMeta.map(({ anim: _anim, ...m }) => m) };
fa.status = 'optimized';
writeFileSync(REGISTRY_FILE, JSON.stringify(fresh, null, 2) + '\n');
