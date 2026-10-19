// Asset registry (assets-src/meshy/assets.json): prompts, settings, task ids, files, status.
import { readFileSync, writeFileSync } from 'node:fs';
import { REGISTRY_FILE } from './paths.mjs';

export function loadRegistry() {
  return JSON.parse(readFileSync(REGISTRY_FILE, 'utf8'));
}

export function saveRegistry(reg) {
  writeFileSync(REGISTRY_FILE, JSON.stringify(reg, null, 2) + '\n');
}

// Read-modify-write so concurrent steps never clobber task ids written moments earlier.
export function updateAsset(assetId, fn) {
  const reg = loadRegistry();
  const asset = reg.assets[assetId];
  if (!asset) throw new Error(`Unknown asset ${assetId}`);
  fn(asset, reg);
  saveRegistry(reg);
  return asset;
}

export function getAsset(assetId) {
  const reg = loadRegistry();
  const asset = reg.assets[assetId];
  if (!asset) throw new Error(`Unknown asset "${assetId}". Known: ${Object.keys(reg.assets).join(', ')}`);
  return { reg, asset };
}

// Variant settings fall back to the asset defaults.
export function resolveVariant(asset, variantId) {
  const id = variantId || asset.selected_variant || Object.keys(asset.variants || {})[0] || 'main';
  const v = asset.variants?.[id] || {};
  return {
    id,
    prompt: v.prompt ?? asset.prompt,
    texture_prompt: v.texture_prompt ?? asset.texture_prompt,
    ai_model: v.ai_model ?? asset.ai_model,
    topology: v.topology ?? asset.topology ?? 'triangle',
    target_polycount: v.target_polycount ?? asset.polycount_target,
    pose_mode: v.pose_mode ?? asset.pose_mode ?? '',
    texture_resolution: v.texture_resolution ?? asset.texture_resolution ?? '2k',
    image: v.image ?? asset.image,
    // Optional preamble overrides (e.g. animals or ships, where "seaside villa" would invite a scene).
    // A string replaces the shared art_direction preamble; a key of art_direction.preambles selects a named one.
    prompt_preamble: v.prompt_preamble ?? asset.prompt_preamble,
    texture_preamble: v.texture_preamble ?? asset.texture_preamble,
  };
}

function resolvePreamble(reg, value, fallback) {
  if (value == null) return fallback;
  return reg.art_direction.preambles?.[value] ?? value;
}

export function buildPrompts(reg, asset, variant) {
  const pre = reg.art_direction;
  const promptPre = resolvePreamble(reg, variant.prompt_preamble, pre.prompt_preamble);
  const texturePre = resolvePreamble(reg, variant.texture_preamble, pre.texture_preamble);
  const prompt = `${promptPre} ${variant.prompt}`.replace(/\s+/g, ' ').trim();
  const texture = `${variant.texture_prompt} ${texturePre}`.replace(/\s+/g, ' ').trim();
  if (prompt.length > 800) throw new Error(`Prompt too long (${prompt.length} > 800)`);
  if (texture.length > 800) throw new Error(`Texture prompt too long (${texture.length} > 800)`);
  return { prompt, texture };
}

export function variantState(asset, variantId) {
  asset.attempts ??= {};
  asset.attempts[variantId] ??= {};
  return asset.attempts[variantId];
}

export function recomputeCredits(asset) {
  let sum = 0;
  const add = (t) => {
    if (t && t.status !== 'FAILED' && t.status !== 'CANCELED') sum += t.consumed_credits ?? t.expected_credits ?? 0;
  };
  for (const a of Object.values(asset.attempts || {})) {
    add(a.preview);
    add(a.refine);
    add(a.image);
    add(a.retexture);
  }
  add(asset.rig);
  add(asset.remesh_task);
  for (const t of asset.animate_tasks || []) add(t);
  asset.credits_spent = sum;
}
