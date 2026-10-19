#!/usr/bin/env node
// Meshy pipeline CLI. Resumable: task ids live in assets.json + ledger.json, so a succeeded step is never paid twice.
//   balance | library [search] [--category C] [--ids 1,2] | generate <id> [--variant v] [--preview-only]
//   image <id> [--variant v] | rig <id> | animate <id> | remesh <id> | retexture <id> [--variant v]
//   download <id> [--variant v] | status [id]
// Common flags: --dry-run (print the request, no paid call).
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { api, getBalance, getTask, waitForTask, download, FINAL } from './lib/api.mjs';
import { COSTS, paidCall, settleEntry, loadLedger, ledgerTotal, entryCredits, currentRun, runTotal } from './lib/budget.mjs';
import { getAsset, updateAsset, resolveVariant, buildPrompts, variantState, recomputeCredits, loadRegistry } from './lib/registry.mjs';
import { RAW_DIR, rel } from './lib/paths.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0];
const positional = argv.slice(1).filter((a, i, arr) => !a.startsWith('--') && !(arr[i - 1] || '').match(/^--(variant|category|ids|batch)$/));
const flag = (name) => argv.includes(`--${name}`);
const opt = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const dryRun = flag('dry-run');

const PREVIEW_COST = (model) => (model === 'meshy-6-lite' ? COSTS.preview_lite : COSTS.preview);

async function balanceAfter() {
  try {
    return (await getBalance()).balance;
  } catch {
    return undefined;
  }
}

// Reuse a task from the registry or an unsettled ledger entry instead of paying again.
async function existingTask(kind, record, assetId, operation) {
  let taskId = record?.task_id;
  if (!taskId) {
    const pending = loadLedger().entries.filter((e) => e.asset === assetId && e.operation === operation && e.task_id &&
      e.final_status !== 'FAILED' && e.final_status !== 'CANCELED');
    taskId = pending.at(-1)?.task_id;
    if (taskId) console.log(`  recovered ${operation} task ${taskId} from ledger`);
  }
  if (!taskId) return null;
  const task = await getTask(kind, taskId);
  if (task.status === 'FAILED' || task.status === 'CANCELED') {
    console.log(`  previous ${operation} task ${taskId} ${task.status} (${task.task_error?.message || 'no message'}); credits refunded`);
    settleEntry(taskId, task);
    return null;
  }
  return task;
}

function taskRecord(task, expected, extra = {}) {
  return {
    task_id: task.id,
    status: task.status,
    expected_credits: expected,
    consumed_credits: task.consumed_credits,
    created_at: task.created_at ? new Date(task.created_at).toISOString() : undefined,
    finished_at: task.finished_at ? new Date(task.finished_at).toISOString() : undefined,
    ...extra,
  };
}

async function runStep({ kind, assetId, operation, expected, record, body, details, onRecord }) {
  let task = await existingTask(kind, record, assetId, operation);
  if (task && task.status === 'SUCCEEDED') {
    console.log(`  ${operation}: reusing SUCCEEDED task ${task.id} (no charge)`);
  } else {
    if (!task) {
      console.log(`  ${operation} request:`, JSON.stringify(redactBody(body)));
      const taskId = await paidCall({ asset: assetId, operation, expected, details, dryRun }, async () => {
        const res = await api.post(endpointFor(kind), body);
        return res.result;
      });
      if (!taskId) return null; // dry run
      onRecord({ task_id: taskId, status: 'PENDING', expected_credits: expected });
      task = { id: taskId };
    }
    task = await waitForTask(kind, task.id, { label: `${assetId}/${operation}` });
    settleEntry(task.id, task, await balanceAfter());
  }
  onRecord(taskRecord(task, expected));
  if (task.status !== 'SUCCEEDED') throw new Error(`${operation} ${task.id} ended ${task.status}: ${task.task_error?.message || ''}`);
  return task;
}

function endpointFor(kind) {
  return { preview: '/openapi/v2/text-to-3d', refine: '/openapi/v2/text-to-3d', image: '/openapi/v1/image-to-3d', rig: '/openapi/v1/rigging', animate: '/openapi/v1/animations', remesh: '/openapi/v1/remesh', retexture: '/openapi/v1/retexture' }[kind];
}

function redactBody(body) {
  const b = { ...body };
  for (const k of ['image_url', 'texture_image_url', 'model_url']) if (typeof b[k] === 'string' && b[k].startsWith('data:')) b[k] = `${b[k].slice(0, 30)}…`;
  return b;
}

async function saveTaskFiles(task, dir, prefix) {
  const files = {};
  const glb = task.model_urls?.glb || task.result?.rigged_character_glb_url;
  if (glb) files.glb = rel(await download(glb, path.join(dir, `${prefix}.glb`)));
  if (task.model_urls?.fbx && prefix.startsWith('refine')) files.fbx = rel(await download(task.model_urls.fbx, path.join(dir, `${prefix}.fbx`)));
  if (task.thumbnail_url) files.thumbnail = rel(await download(task.thumbnail_url, path.join(dir, `${prefix}.png`)));
  const tex = task.texture_urls?.[0];
  if (tex) {
    files.textures = {};
    for (const [slot, url] of Object.entries(tex)) {
      if (typeof url !== 'string' || !url) continue;
      const ext = (new URL(url).pathname.match(/\.(png|jpe?g|webp)$/i)?.[1] || 'png').toLowerCase();
      files.textures[slot] = rel(await download(url, path.join(dir, 'textures', `${slot}.${ext}`)));
    }
  }
  writeFileSync(path.join(dir, `${prefix}.task.json`), JSON.stringify(stripUrls(task), null, 2));
  return files;
}

// Task JSON is kept for provenance, minus expiring signed URLs.
function stripUrls(obj) {
  if (Array.isArray(obj)) return obj.map(stripUrls);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = typeof v === 'string' && v.startsWith('http') ? '(url)' : stripUrls(v);
    return out;
  }
  return obj;
}

// ---------- commands ----------

async function cmdBalance() {
  const b = await getBalance();
  const ledger = loadLedger();
  console.log(JSON.stringify(b, null, 2));
  console.log(`ledger total: ${ledgerTotal(ledger)} / cap ${ledger.cap}; spent vs start balance ${ledger.start_balance}: ${ledger.start_balance - b.balance}`);
  const run = currentRun(ledger);
  if (run) console.log(`run ${run.id}: ${runTotal(ledger, run.id)} / cap ${run.cap} (balance at run start ${run.start_balance}, spent since ${run.start_balance - b.balance})`);
}

async function cmdLibrary() {
  const params = new URLSearchParams();
  if (positional[0]) params.set('search', positional[0]);
  if (opt('category')) params.set('category', opt('category'));
  if (opt('ids')) params.set('action_ids', opt('ids'));
  const items = await api.get(`/openapi/v1/animations/library?${params}`);
  for (const it of items) console.log(`${String(it.action_id).padStart(4)}  ${it.name.padEnd(36)} ${it.key.padEnd(40)} ${it.category}/${it.sub_category || ''}  ${flag('urls') ? it.preview_url : ''}`);
  console.log(`${items.length} actions`);
}

async function cmdGenerate() {
  const assetId = positional[0];
  if (!assetId) throw new Error('usage: generate <assetId> [--variant v] [--preview-only]');
  const { reg, asset } = getAsset(assetId);
  const variant = resolveVariant(asset, opt('variant'));
  const { prompt, texture } = buildPrompts(reg, asset, variant);
  const dir = path.join(RAW_DIR, assetId, variant.id);
  mkdirSync(dir, { recursive: true });
  console.log(`== ${assetId} [${variant.id}] model=${variant.ai_model} (${prompt.length} chars)\n${prompt}`);

  const st = variantState(asset, variant.id);
  const previewBody = {
    mode: 'preview',
    prompt,
    ai_model: variant.ai_model,
    topology: variant.topology,
    should_remesh: true,
    target_polycount: variant.target_polycount,
    ...(variant.pose_mode ? { pose_mode: variant.pose_mode } : {}),
    ...(asset.kind === 'character' ? {} : { target_formats: ['glb'] }),
  };
  const setRec = (step) => (r) => updateAsset(assetId, (a) => {
    const s = variantState(a, variant.id);
    s[step] = { ...(s[step] || {}), ...r };
    if (step === 'preview') s.prompt = prompt;
    if (step === 'refine') s.texture_prompt = texture;
    recomputeCredits(a);
  });

  const preview = await runStep({
    kind: 'preview', assetId, operation: `preview:${variant.id}`, expected: PREVIEW_COST(variant.ai_model),
    record: st.preview, body: previewBody, details: { variant: variant.id, ai_model: variant.ai_model }, onRecord: setRec('preview'),
  });
  if (!preview) return;
  if (!existsSync(path.join(dir, 'preview.glb'))) {
    const files = await saveTaskFiles(preview, dir, 'preview');
    updateAsset(assetId, (a) => { variantState(a, variant.id).preview_files = files; a.status = a.status === 'planned' ? 'preview' : a.status; });
  }
  if (flag('preview-only')) return console.log(`preview ready: ${rel(path.join(dir, 'preview.png'))}`);

  const refineBody = {
    mode: 'refine',
    preview_task_id: preview.id,
    enable_pbr: true,
    texture_prompt: texture,
    texture_resolution: variant.texture_resolution,
    ...(variant.ai_model === 'meshy-6' ? { remove_lighting: true } : {}),
    ...(asset.kind === 'character' ? {} : { target_formats: ['glb'] }),
  };
  const refine = await runStep({
    kind: 'refine', assetId, operation: `refine:${variant.id}`, expected: COSTS.refine,
    record: variantState(getAsset(assetId).asset, variant.id).refine, body: refineBody,
    details: { variant: variant.id }, onRecord: setRec('refine'),
  });
  if (!refine) return;
  const files = await saveTaskFiles(refine, dir, 'refine');
  updateAsset(assetId, (a) => {
    variantState(a, variant.id).refine_files = files;
    a.status = 'downloaded';
    a.raw_path ??= files.glb;
  });
  console.log(`refined model saved: ${files.glb}`);
}

async function cmdImage() {
  const assetId = positional[0];
  const { reg, asset } = getAsset(assetId);
  const variant = resolveVariant(asset, opt('variant'));
  const img = variant.image;
  if (!img?.path && !img?.url) throw new Error('asset/variant needs image.path or image.url');
  let imageUrl = img.url;
  if (img.path) {
    const buf = readFileSync(path.resolve(img.path));
    const mime = img.path.endsWith('.png') ? 'image/png' : img.path.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    imageUrl = `data:${mime};base64,${buf.toString('base64')}`;
  }
  const { texture } = buildPrompts(reg, asset, variant);
  const dir = path.join(RAW_DIR, assetId, variant.id);
  const body = {
    image_url: imageUrl, ai_model: variant.ai_model, topology: variant.topology, should_remesh: true,
    target_polycount: variant.target_polycount, should_texture: true, enable_pbr: true, texture_prompt: texture,
    ...(variant.pose_mode ? { pose_mode: variant.pose_mode } : {}),
  };
  const task = await runStep({
    kind: 'image', assetId, operation: `image:${variant.id}`, expected: COSTS.image,
    record: variantState(asset, variant.id).image, body, details: { variant: variant.id },
    onRecord: (r) => updateAsset(assetId, (a) => { const s = variantState(a, variant.id); s.image = { ...(s.image || {}), ...r }; recomputeCredits(a); }),
  });
  if (!task) return;
  const files = await saveTaskFiles(task, dir, 'refine');
  updateAsset(assetId, (a) => { variantState(a, variant.id).refine_files = files; a.status = 'downloaded'; });
}

function selectedSourceTask(asset) {
  const v = asset.selected_variant;
  if (!v) throw new Error('set selected_variant in assets.json first');
  const st = asset.attempts?.[v];
  const t = st?.refine?.status === 'SUCCEEDED' ? st.refine : st?.image?.status === 'SUCCEEDED' ? st.image : null;
  if (!t) throw new Error(`variant ${v} has no succeeded textured task`);
  return { variant: v, taskId: t.task_id };
}

async function cmdRig() {
  const assetId = positional[0];
  const { asset } = getAsset(assetId);
  const src = selectedSourceTask(asset);
  const body = { input_task_id: src.taskId, height_meters: asset.height_meters ?? 1.7 };
  const dir = path.join(RAW_DIR, assetId, 'rig');
  const task = await runStep({
    kind: 'rig', assetId, operation: 'rig', expected: COSTS.rig, record: asset.rig, body,
    details: { source_variant: src.variant, source_task: src.taskId },
    onRecord: (r) => updateAsset(assetId, (a) => { a.rig = { ...(a.rig || {}), ...r, source_task: src.taskId }; recomputeCredits(a); }),
  });
  if (!task) return;
  const r = task.result || {};
  const files = { rigged: rel(await download(r.rigged_character_glb_url, path.join(dir, 'rigged.glb'))) };
  if (r.rigged_character_fbx_url) files.rigged_fbx = rel(await download(r.rigged_character_fbx_url, path.join(dir, 'rigged.fbx')));
  for (const [k, url] of Object.entries(r.basic_animations || {})) {
    if (k.endsWith('_glb_url') && url) files[k.replace('_url', '')] = rel(await download(url, path.join(dir, `${k.replace('_glb_url', '')}.glb`)));
  }
  writeFileSync(path.join(dir, 'rig.task.json'), JSON.stringify(stripUrls(task), null, 2));
  updateAsset(assetId, (a) => { a.rig.files = files; a.status = 'rigged'; });
}

async function cmdAnimate() {
  const assetId = positional[0];
  const { asset } = getAsset(assetId);
  if (asset.rig?.status !== 'SUCCEEDED') throw new Error('rig first');
  const actions = asset.animations || [];
  if (!actions.length || actions.length > 10) throw new Error('assets.json animations must list 1-10 actions');
  const ids = actions.map((a) => a.action_id);
  // Free sanity check: every id exists in the library and the name matches.
  const lib = await api.get(`/openapi/v1/animations/library?action_ids=${ids.join(',')}`);
  for (const a of actions) {
    const hit = lib.find((x) => x.action_id === a.action_id);
    if (!hit) throw new Error(`action ${a.action_id} not in library`);
    if (a.library_name && hit.name !== a.library_name) throw new Error(`action ${a.action_id} is "${hit.name}", expected "${a.library_name}"`);
    console.log(`  ${a.action_id} ${hit.name} -> ${a.name}`);
  }
  const body = { rig_task_id: asset.rig.task_id, action_ids: ids };
  const dir = path.join(RAW_DIR, assetId, 'animations');
  const batch = opt('batch') || 'a1';
  const prev = (asset.animate_tasks || []).find((t) => t.batch === batch);
  const task = await runStep({
    kind: 'animate', assetId, operation: `animate:${batch}`, expected: COSTS.animate_per_action * ids.length, record: prev, body,
    details: { action_ids: ids },
    onRecord: (r) => updateAsset(assetId, (a) => {
      a.animate_tasks ??= [];
      const i = a.animate_tasks.findIndex((t) => t.batch === batch);
      const rec = { ...(i >= 0 ? a.animate_tasks[i] : {}), ...r, batch, action_ids: ids };
      if (i >= 0) a.animate_tasks[i] = rec; else a.animate_tasks.push(rec);
      recomputeCredits(a);
    }),
  });
  if (!task) return;
  const r = task.result || {};
  const files = { glb: rel(await download(r.animation_glb_url, path.join(dir, `${batch}.glb`))) };
  if (r.animation_fbx_url) files.fbx = rel(await download(r.animation_fbx_url, path.join(dir, `${batch}.fbx`)));
  writeFileSync(path.join(dir, `${batch}.task.json`), JSON.stringify(stripUrls(task), null, 2));
  updateAsset(assetId, (a) => { a.animate_tasks.find((t) => t.batch === batch).files = files; a.status = 'animated'; });
}

// Remesh an existing textured task (assets.json -> <id>.remesh: source_task | source_asset, topology, target_polycount).
async function cmdRemesh() {
  const assetId = positional[0];
  const { asset } = getAsset(assetId);
  const rm = asset.remesh;
  if (!rm?.target_polycount) throw new Error(`${assetId}: assets.json needs remesh.target_polycount`);
  const sourceTask = rm.source_task || selectedSourceTask(getAsset(rm.source_asset).asset).taskId;
  const body = { input_task_id: sourceTask, topology: rm.topology || 'triangle', target_polycount: rm.target_polycount, target_formats: ['glb'] };
  const dir = path.join(RAW_DIR, assetId, 'remesh');
  const task = await runStep({
    kind: 'remesh', assetId, operation: 'remesh', expected: COSTS.remesh, record: asset.remesh_task, body,
    details: { source_task: sourceTask, target_polycount: rm.target_polycount },
    onRecord: (r) => updateAsset(assetId, (a) => { a.remesh_task = { ...(a.remesh_task || {}), ...r, source_task: sourceTask }; recomputeCredits(a); }),
  });
  if (!task) return;
  const files = await saveTaskFiles(task, dir, 'remesh');
  updateAsset(assetId, (a) => { a.remesh_task.files = files; a.source_glb = files.glb; a.status = 'downloaded'; });
  console.log(`remeshed model saved: ${files.glb}`);
}

// Re-texture a variant's refined mesh, keeping its UVs (assets.json -> <id>.retexture: texture_prompt?, ai_model?).
// Used when a refine produced an unusable texture; the geometry is unchanged.
async function cmdRetexture() {
  const assetId = positional[0];
  const { reg, asset } = getAsset(assetId);
  const variant = resolveVariant(asset, opt('variant'));
  const st = variantState(asset, variant.id);
  if (st.refine?.status !== 'SUCCEEDED') throw new Error(`${assetId}/${variant.id}: no succeeded refine to retexture`);
  const rt = asset.retexture || {};
  const { texture } = buildPrompts(reg, asset, { ...variant, texture_prompt: rt.texture_prompt ?? variant.texture_prompt });
  const body = {
    input_task_id: st.refine.task_id, text_style_prompt: texture, ai_model: rt.ai_model || 'latest',
    enable_original_uv: true, enable_pbr: true, target_formats: ['glb'],
  };
  const dir = path.join(RAW_DIR, assetId, variant.id);
  const task = await runStep({
    kind: 'retexture', assetId, operation: `retexture:${variant.id}`, expected: COSTS.retexture, record: st.retexture, body,
    details: { variant: variant.id, source_task: st.refine.task_id },
    onRecord: (r) => updateAsset(assetId, (a) => {
      const s = variantState(a, variant.id);
      s.retexture = { ...(s.retexture || {}), ...r, source_task: st.refine.task_id, texture_prompt: texture };
      recomputeCredits(a);
    }),
  });
  if (!task) return;
  const files = await saveTaskFiles(task, path.join(dir, 'retexture'), 'retexture');
  updateAsset(assetId, (a) => { variantState(a, variant.id).retexture_files = files; });
  console.log(`retextured model saved: ${files.glb}`);
}

// Re-download files of succeeded tasks (fresh signed URLs come with each GET).
async function cmdDownload() {
  const assetId = positional[0];
  const { asset } = getAsset(assetId);
  const variant = resolveVariant(asset, opt('variant'));
  const st = asset.attempts?.[variant.id] || {};
  const dir = path.join(RAW_DIR, assetId, variant.id);
  for (const step of ['preview', 'refine']) {
    if (st[step]?.status !== 'SUCCEEDED') continue;
    const task = await getTask(step, st[step].task_id);
    const files = await saveTaskFiles(task, dir, step);
    updateAsset(assetId, (a) => { variantState(a, variant.id)[`${step}_files`] = files; });
  }
}

async function cmdStatus() {
  const reg = loadRegistry();
  const ledger = loadLedger();
  const ids = positional[0] ? [positional[0]] : Object.keys(reg.assets);
  for (const id of ids) {
    const a = reg.assets[id];
    console.log(`\n${id}  [${a.status}]  credits ${a.credits_spent ?? 0}  selected=${a.selected_variant ?? '-'}`);
    for (const [v, st] of Object.entries(a.attempts || {})) {
      for (const step of ['preview', 'refine', 'image', 'retexture']) {
        const t = st[step];
        if (!t) continue;
        let live = '';
        if (flag('refresh') && !FINAL.has(t.status)) live = ` -> live ${(await getTask(step, t.task_id)).status}`;
        console.log(`   ${v}.${step.padEnd(8)} ${t.task_id} ${t.status}${live} ${t.consumed_credits ?? t.expected_credits}cr`);
      }
    }
    if (a.rig) console.log(`   rig       ${a.rig.task_id} ${a.rig.status}`);
    if (a.remesh_task) console.log(`   remesh    ${a.remesh_task.task_id} ${a.remesh_task.status} (source ${a.remesh_task.source_task})`);
    for (const t of a.animate_tasks || []) console.log(`   animate   ${t.task_id} ${t.status} [${t.action_ids}]`);
  }
  const unsettled = ledger.entries.filter((e) => !e.final_status);
  console.log(`\nledger: ${ledger.entries.length} paid calls, total ${ledgerTotal(ledger)} / cap ${ledger.cap}` +
    (unsettled.length ? `, ${unsettled.length} unsettled` : ''));
  for (const e of ledger.entries) console.log(`   ${e.timestamp} ${e.asset.padEnd(16)} ${e.operation.padEnd(14)} ${entryCredits(e)}cr ${e.final_status ?? '…'} ${e.task_id}`);
  const b = await getBalance();
  console.log(`balance ${b.balance} (spent vs start ${ledger.start_balance - b.balance})`);
}

const commands = { balance: cmdBalance, library: cmdLibrary, generate: cmdGenerate, image: cmdImage, rig: cmdRig, animate: cmdAnimate, remesh: cmdRemesh, retexture: cmdRetexture, download: cmdDownload, status: cmdStatus };

if (!commands[cmd]) {
  console.log('usage: meshy.mjs <balance|library|generate|image|rig|animate|remesh|retexture|download|status> [args]');
  process.exit(cmd ? 1 : 0);
}
commands[cmd]().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
