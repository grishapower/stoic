#!/usr/bin/env node
// Inspect a GLB: bounds, triangles, materials, textures, skins/bones, animation clips (+ root motion), validation.
//   node scripts/assets/inspect-glb.mjs <file.glb>... [--bones] [--json] [--no-validate]
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getBounds, listTextureSlots } from '@gltf-transform/functions';
import sharp from 'sharp';
import { createIO, countTriangles, defaultScene } from './optimize-glb.mjs';
import { posedBounds } from '../meshy/lib/pose.mjs';

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith('--'));
const showBones = args.includes('--bones');
const asJson = args.includes('--json');
const fmt = (v) => v.map((x) => x.toFixed(3)).join(', ');

// 4x4 column-major helpers (only what root-motion needs).
function mulVec3Linear(m, v) {
  return [m[0] * v[0] + m[4] * v[1] + m[8] * v[2], m[1] * v[0] + m[5] * v[1] + m[9] * v[2], m[2] * v[0] + m[6] * v[1] + m[10] * v[2]];
}

async function validate(buf) {
  try {
    const validator = await import('gltf-validator');
    const report = await validator.validateBytes(new Uint8Array(buf), { maxIssues: 50 });
    const msgs = report.issues.messages.filter((m) => m.severity <= 1).slice(0, 8).map((m) => `${m.severity === 0 ? 'E' : 'W'} ${m.code}: ${m.message} ${m.pointer || ''}`);
    return { errors: report.issues.numErrors, warnings: report.issues.numWarnings, infos: report.issues.numInfos, messages: msgs };
  } catch (err) {
    return { skipped: err.message };
  }
}

export async function inspectFile(file, { validateFile = true } = {}) {
  const io = await createIO();
  const buf = readFileSync(file);
  const doc = await io.readBinary(new Uint8Array(buf));
  const root = doc.getRoot();
  const scene = defaultScene(doc);
  // Skinned meshes: static bounds ignore skinning, so use the FK rest pose instead.
  const skinned = root.listSkins().length > 0;
  const { min, max } = skinned ? posedBounds(scene, null, 0) : getBounds(scene);
  const out = {
    file: path.relative(process.cwd(), file),
    bytes: statSync(file).size,
    extensionsUsed: root.listExtensionsUsed().map((e) => e.extensionName),
    bounds: { skinnedRestPose: skinned, min, max, size: [0, 1, 2].map((i) => max[i] - min[i]), center: [0, 1, 2].map((i) => (min[i] + max[i]) / 2) },
    triangles: countTriangles(doc),
    nodes: root.listNodes().length,
    meshes: root.listMeshes().map((m) => ({
      name: m.getName(),
      primitives: m.listPrimitives().map((p) => ({
        vertices: p.getAttribute('POSITION').getCount(),
        attributes: p.listSemantics(),
        material: p.getMaterial()?.getName() ?? null,
      })),
    })),
    materials: root.listMaterials().map((m) => ({
      name: m.getName(),
      baseColorFactor: m.getBaseColorFactor().map((x) => +x.toFixed(3)),
      metallic: m.getMetallicFactor(),
      roughness: m.getRoughnessFactor(),
      alphaMode: m.getAlphaMode(),
      doubleSided: m.getDoubleSided(),
      textures: {
        baseColor: !!m.getBaseColorTexture(), normal: !!m.getNormalTexture(), metallicRoughness: !!m.getMetallicRoughnessTexture(),
        occlusion: !!m.getOcclusionTexture(), emissive: !!m.getEmissiveTexture(),
      },
    })),
    textures: [],
    skins: root.listSkins().map((s) => ({
      name: s.getName(),
      joints: s.listJoints().length,
      skeletonRoot: s.getSkeleton()?.getName() ?? null,
      jointNames: s.listJoints().map((j) => j.getName()),
    })),
    animations: [],
  };
  for (const t of root.listTextures()) {
    let size = null;
    try {
      const meta = await sharp(Buffer.from(t.getImage())).metadata();
      size = [meta.width, meta.height];
    } catch {
      /* unsupported image */
    }
    out.textures.push({ name: t.getName(), slots: listTextureSlots(t), mime: t.getMimeType(), size, bytes: t.getImage()?.byteLength });
  }
  for (const anim of root.listAnimations()) {
    let duration = 0;
    let keyframes = 0;
    for (const s of anim.listSamplers()) {
      const input = s.getInput();
      duration = Math.max(duration, input.getMax([])[0]);
      keyframes = Math.max(keyframes, input.getCount());
    }
    const clip = { name: anim.getName(), duration: +duration.toFixed(3), channels: anim.listChannels().length, keyframes };
    // Root motion: horizontal displacement of the hips translation track, in world units.
    const hipsCh = anim.listChannels().find((c) => c.getTargetPath() === 'translation' && /hips|pelvis/i.test(c.getTargetNode()?.getName() || ''));
    if (hipsCh) {
      const node = hipsCh.getTargetNode();
      const out3 = hipsCh.getSampler().getOutput();
      const first = out3.getElement(0, []);
      const last = out3.getElement(out3.getCount() - 1, []);
      const parent = node.getParentNode();
      const m = parent ? parent.getWorldMatrix() : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
      const d = mulVec3Linear(m, [last[0] - first[0], last[1] - first[1], last[2] - first[2]]);
      const horiz = Math.hypot(d[0], d[2]);
      clip.rootMotion = { node: node.getName(), displacement: d.map((x) => +x.toFixed(3)), horizontal: +horiz.toFixed(3), speed_mps: duration ? +(horiz / duration).toFixed(3) : 0 };
    }
    out.animations.push(clip);
  }
  if (validateFile) out.validation = await validate(buf);
  return out;
}

function print(r) {
  console.log(`\n=== ${r.file}  (${(r.bytes / 1024).toFixed(0)} KB)`);
  console.log(`extensions: ${r.extensionsUsed.join(', ') || '-'}`);
  console.log(`bounds${r.bounds.skinnedRestPose ? ' (skinned rest pose)' : ''} min [${fmt(r.bounds.min)}] max [${fmt(r.bounds.max)}]`);
  console.log(`size (w,h,d) [${fmt(r.bounds.size)}] m   center [${fmt(r.bounds.center)}]`);
  console.log(`triangles ${r.triangles}   nodes ${r.nodes}   meshes ${r.meshes.length}`);
  for (const m of r.meshes) for (const p of m.primitives) console.log(`  mesh "${m.name}": ${p.vertices} verts [${p.attributes.join(' ')}] mat=${p.material}`);
  for (const m of r.materials) {
    const tex = Object.entries(m.textures).filter(([, v]) => v).map(([k]) => k).join('+');
    console.log(`  material "${m.name}": baseColor(${m.baseColorFactor}) metal ${m.metallic} rough ${m.roughness} ${m.alphaMode}${m.doubleSided ? ' double-sided' : ''} tex[${tex}]`);
  }
  for (const t of r.textures) console.log(`  texture ${t.slots.join('/')}: ${t.mime} ${t.size?.join('x')} ${(t.bytes / 1024).toFixed(0)} KB`);
  for (const s of r.skins) {
    console.log(`  skin "${s.name}": ${s.joints} joints, skeleton root ${s.skeletonRoot}`);
    if (showBones) console.log(`    ${s.jointNames.join(', ')}`);
  }
  for (const a of r.animations) {
    const rm = a.rootMotion ? `  root(${a.rootMotion.node}) Δ[${a.rootMotion.displacement}] → ${a.rootMotion.speed_mps} m/s` : '';
    console.log(`  clip "${a.name}": ${a.duration}s, ${a.channels} channels, ${a.keyframes} keys${rm}`);
  }
  if (r.validation) {
    const v = r.validation;
    if (v.skipped) console.log(`validation skipped: ${v.skipped}`);
    else {
      console.log(`validation: ${v.errors} errors, ${v.warnings} warnings, ${v.infos} infos`);
      for (const m of v.messages) console.log(`  ${m}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!files.length) {
    console.log('usage: inspect-glb.mjs <file.glb>... [--bones] [--json] [--no-validate]');
    process.exit(1);
  }
  const results = [];
  for (const f of files) results.push(await inspectFile(path.resolve(f), { validateFile: !args.includes('--no-validate') }));
  if (asJson) console.log(JSON.stringify(results, null, 2));
  else results.forEach(print);
}
