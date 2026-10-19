#!/usr/bin/env node
/**
 * Fetch CC0 PBR textures from Poly Haven (+ the MIT-licensed three.js water
 * normal map) into public/assets/textures/<slot>/ and record provenance.
 *
 *   npm run assets:textures                 # fetch whatever is missing
 *   npm run assets:textures -- --force      # re-download everything
 *   npm run assets:textures -- --only=bark,marble
 *   npm run assets:textures -- --check      # offline: verify files + manifest
 *   npm run assets:textures -- --no-reencode
 *
 * Outputs
 *   public/assets/textures/<slot>/{color,normal,arm|rough}.jpg
 *   public/assets/textures/water/waternormals.jpg (+ three.js LICENSE copy)
 *   src/data/generated/textures.json   (manifest + provenance, site-relative paths)
 *   docs/assets/textures.md            (human-readable attribution table)
 *
 * Maps: color = sRGB albedo ("Diffuse"), normal = OpenGL normal ("nor_gl"),
 * arm = R:AO G:Roughness B:Metalness ("arm"); falls back to "Rough" -> rough.jpg.
 * Downloads are verified against the API's md5, written atomically, and any
 * 1k JPEG larger than ~700 KB is re-encoded (ffmpeg, else macOS sips):
 * albedo/ARM at ~IJG quality 81, normals at ~IJG 91 so lighting stays clean.
 * Plain Node ESM, global fetch, no dependencies.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const TEXTURE_DIR = path.join(PUBLIC_DIR, 'assets', 'textures');
const MANIFEST_PATH = path.join(ROOT, 'src', 'data', 'generated', 'textures.json');
const DOC_PATH = path.join(ROOT, 'docs', 'assets', 'textures.md');

const API = 'https://api.polyhaven.com';
const USER_AGENT = 'seneca-art-of-time-texture-fetch/1.0 (build script; CC0 asset pipeline)';
const RESOLUTION = '1k';
const REENCODE_THRESHOLD = 700 * 1024; // bytes
const BUDGET_BYTES = 15 * 1024 * 1024;

/**
 * Slot -> Poly Haven asset. Chosen by browsing the API by category/tags and
 * eyeballing the diffuse maps (see docs/assets/textures.md for the rationale).
 */
const SLOTS = [
  {
    slot: 'ground-meadow',
    id: 'withered_grass',
    why: 'Sun-bleached straw-coloured dry grass over soil; warm, late-summer Mediterranean, not lush green.',
  },
  {
    slot: 'ground-garden',
    id: 'yellow_flower_mulch',
    why: 'Fine, dark, even garden soil/mulch with tiny petal flecks; reads as tended peristyle beds.',
  },
  {
    slot: 'path-gravel',
    id: 'gravel_floor',
    why: 'Light warm tan fine gravel; compacted path look without large stones.',
  },
  {
    slot: 'paving-stone',
    id: 'marble_01',
    why: 'Cream travertine-like rectangular slabs with natural pitting; reads as Roman portico/terrace paving.',
  },
  {
    slot: 'plaster-wall',
    id: 'medieval_wall_01',
    why: 'Weathered cream/ochre lime plaster with soft patchy wear; tintable for villa walls.',
  },
  {
    slot: 'roof-tiles',
    id: 'clay_roof_tiles_02',
    why: 'Irregular orange barrel (coppi-style) terracotta tiles, the closest match to tegula/imbrex roofs.',
  },
  {
    slot: 'marble',
    id: 'marble_rock_02',
    why: 'Seamless cream marble with fine dark veining and no tile joints; works on columns, bench, fountain.',
  },
  {
    slot: 'rock-cliff',
    id: 'marble_cliff_04',
    why: 'Pale grey-beige fractured limestone cliff face with warm staining, like the Sorrento/Capri coast.',
  },
  {
    slot: 'wood-weathered',
    id: 'brown_planks_03',
    why: 'Silver-grey sun-weathered untreated planks (coastal/boat wood) for pergola, table and doors.',
  },
  {
    slot: 'bark',
    id: 'bark_willow_02',
    why: 'Grey-brown deeply fissured bark, close to old olive trunks.',
  },
  {
    slot: 'brick-roman',
    id: 'medieval_red_brick',
    why: 'Thin, long red bricks with wide mortar beds, proportioned like opus testaceum.',
  },
];

const WATER = {
  slot: 'water',
  tags: ['r170', 'r171', 'r169', 'r172', 'r168', 'r173', 'r167'],
  file: 'examples/textures/waternormals.jpg',
};

// Map role -> Poly Haven map key and output basename.
const MAP_ROLES = [
  { role: 'color', keys: ['Diffuse', 'diff', 'Color'], out: 'color.jpg', kind: 'color' },
  { role: 'normal', keys: ['nor_gl'], out: 'normal.jpg', kind: 'normal' },
  { role: 'arm', keys: ['arm'], out: 'arm.jpg', kind: 'data', fallback: { role: 'rough', keys: ['Rough', 'rough'], out: 'rough.jpg' } },
];

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const flags = {
  force: args.includes('--force'),
  check: args.includes('--check'),
  reencode: !args.includes('--no-reencode'),
  only: (() => {
    const a = args.find((x) => x.startsWith('--only='));
    return a ? new Set(a.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean)) : null;
  })(),
};
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node scripts/assets/fetch-textures.mjs [--force] [--only=slot,slot] [--check] [--no-reencode]');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const toSiteRel = (abs) => path.relative(PUBLIC_DIR, abs).split(path.sep).join('/');
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
const mb = (n) => `${(n / (1024 * 1024)).toFixed(2)} MB`;

async function fetchWithRetry(url, { as = 'buffer', tries = 4, timeoutMs = 90_000 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 404) {
        const err = new Error(`404 Not Found: ${url}`);
        err.notFound = true;
        throw err;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return as === 'json' ? await res.json() : Buffer.from(await res.arrayBuffer());
    } catch (err) {
      lastErr = err;
      if (err.notFound) throw err;
      if (attempt < tries) {
        const wait = 1000 * 2 ** (attempt - 1);
        console.warn(`  ! ${err.message ?? err} — retry ${attempt}/${tries - 1} in ${wait} ms`);
        await sleep(wait);
      }
    }
  }
  throw lastErr;
}

const md5 = (buf) => createHash('md5').update(buf).digest('hex');

/** Minimal JPEG validation: SOI marker + SOF dimensions. Returns {width,height} or null. */
function jpegInfo(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    const len = buf.readUInt16BE(i + 2);
    const isSOF = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isSOF) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    if (marker === 0xda) return null; // start of scan without a frame header
    i += 2 + len;
  }
  return null;
}

async function fileSize(p) {
  try {
    return (await stat(p)).size;
  } catch {
    return null;
  }
}

async function readJson(p) {
  try {
    return JSON.parse(await readFile(p, 'utf8'));
  } catch {
    return null;
  }
}

let encoderCache;
async function findEncoder() {
  if (encoderCache !== undefined) return encoderCache;
  const candidates = [process.env.FFMPEG, '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', 'ffmpeg'].filter(Boolean);
  for (const bin of candidates) {
    try {
      await execFileAsync(bin, ['-hide_banner', '-version']);
      return (encoderCache = { tool: 'ffmpeg', bin });
    } catch {
      /* try next */
    }
  }
  if (process.platform === 'darwin' && existsSync('/usr/bin/sips')) return (encoderCache = { tool: 'sips', bin: '/usr/bin/sips' });
  return (encoderCache = null);
}

/**
 * Re-encode an oversized JPEG. ffmpeg keeps the source chroma layout (no RGB
 * round-trip); qscale 4 ~= IJG quality 81, qscale 2 ~= IJG 91 (measured from
 * the written DQT tables). sips formatOptions 55 / 70 land at the same IJG levels.
 */
async function reencode(src, kind) {
  const enc = await findEncoder();
  if (!enc) return null;
  const isNormal = kind === 'normal';
  const out = `${src}.reenc.jpg`;
  try {
    if (enc.tool === 'ffmpeg') {
      const q = isNormal ? '2' : '4';
      await execFileAsync(enc.bin, [
        '-hide_banner', '-loglevel', 'error', '-y', '-i', src,
        '-map_metadata', '-1', '-c:v', 'mjpeg', '-q:v', q, '-frames:v', '1', '-update', '1', out,
      ]);
      return { out, note: `ffmpeg mjpeg -q:v ${q} (~IJG ${isNormal ? 91 : 81})` };
    }
    const q = isNormal ? '70' : '55';
    await execFileAsync(enc.bin, ['-s', 'format', 'jpeg', '-s', 'formatOptions', q, src, '--out', out]);
    return { out, note: `sips formatOptions ${q} (~IJG ${isNormal ? 90 : 81})` };
  } catch (err) {
    console.warn(`  ! re-encode failed (${enc.tool}): ${err.message}`);
    await rm(out, { force: true });
    return null;
  }
}

/**
 * Download `url` to `dest` atomically. Verifies md5 when given, validates JPEG,
 * optionally re-encodes when larger than the threshold. Returns provenance.
 */
async function downloadJpeg({ url, dest, expectedMd5, kind }) {
  const buf = await fetchWithRetry(url);
  if (expectedMd5 && md5(buf) !== expectedMd5) throw new Error(`md5 mismatch for ${url}`);
  const dims = jpegInfo(buf);
  if (!dims) throw new Error(`not a valid JPEG: ${url}`);
  const part = `${dest}.part`;
  await writeFile(part, buf);
  const prov = {
    from: url,
    md5: md5(buf),
    originalBytes: buf.length,
    width: dims.width,
    height: dims.height,
    reencoded: null,
  };
  if (flags.reencode && kind && buf.length > REENCODE_THRESHOLD) {
    const res = await reencode(part, kind);
    if (res) {
      const smaller = await readFile(res.out);
      const info = jpegInfo(smaller);
      if (info && info.width === dims.width && info.height === dims.height && smaller.length < buf.length) {
        await rename(res.out, part);
        prov.reencoded = res.note;
      } else {
        await rm(res.out, { force: true });
      }
    }
  }
  await rename(part, dest);
  prov.bytes = (await stat(dest)).size;
  return prov;
}

function pickMap(files, keys) {
  for (const k of keys) {
    const entry = files?.[k]?.[RESOLUTION]?.jpg;
    if (entry?.url) return { key: k, ...entry };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Poly Haven slots
// ---------------------------------------------------------------------------

async function processSlot({ slot, id, why }, prev) {
  const dir = path.join(TEXTURE_DIR, slot);
  await mkdir(dir, { recursive: true });
  const prevEntry = prev?.[slot];
  const sameAsset = prevEntry?.id === id;

  // Fast path: every expected file exists and the manifest already describes it.
  if (!flags.force && sameAsset && prevEntry?.files && prevEntry?.provenance?.maps) {
    const roles = Object.keys(prevEntry.files);
    const present = await Promise.all(roles.map((r) => fileSize(path.join(PUBLIC_DIR, prevEntry.files[r]))));
    if (roles.length >= 3 && present.every((s) => s !== null)) {
      console.log(`= ${slot}: ${id} already present, skipping (use --force to refresh)`);
      roles.forEach((r, i) => {
        prevEntry.provenance.maps[r].bytes = present[i];
      });
      return prevEntry;
    }
  }

  console.log(`> ${slot}: ${id}`);
  const [info, files] = await Promise.all([
    fetchWithRetry(`${API}/info/${id}`, { as: 'json' }),
    fetchWithRetry(`${API}/files/${id}`, { as: 'json' }),
  ]);
  if (!info || info.type !== 1) throw new Error(`${id} is not a Poly Haven texture asset`);

  const entry = {
    id,
    name: info.name,
    authors: Object.keys(info.authors ?? {}),
    license: 'CC0',
    url: `https://polyhaven.com/a/${id}`,
    files: {},
    ...(Array.isArray(info.dimensions) && info.dimensions.length >= 2
      ? { physicalSize: Math.round((info.dimensions[0] / 1000) * 100) / 100 }
      : {}),
    resolution: RESOLUTION,
    note: why,
    provenance: {
      source: 'Poly Haven (https://polyhaven.com), via api.polyhaven.com',
      licenseUrl: 'https://polyhaven.com/license',
      filesHash: info.files_hash ?? null,
      maps: {},
    },
  };

  const tasks = [];
  for (const spec of MAP_ROLES) {
    let role = spec.role;
    let out = spec.out;
    let map = pickMap(files, spec.keys);
    if (!map && spec.fallback) {
      role = spec.fallback.role;
      out = spec.fallback.out;
      map = pickMap(files, spec.fallback.keys);
      if (map) console.log(`  · ${id}: no ARM map, using ${spec.fallback.out}`);
    }
    if (!map) {
      console.warn(`  ! ${id}: no ${RESOLUTION} JPG for ${spec.role}`);
      continue;
    }
    const dest = path.join(dir, out);
    entry.files[role] = toSiteRel(dest);
    tasks.push(
      (async () => {
        const existing = await fileSize(dest);
        const prevMap = prevEntry?.provenance?.maps?.[role];
        if (!flags.force && existing !== null && sameAsset && prevMap) {
          entry.provenance.maps[role] = { ...prevMap, bytes: existing };
          console.log(`  = ${out} exists (${kb(existing)})`);
          return;
        }
        if (!flags.force && existing !== null && !prevEntry) {
          // File exists but no manifest record: keep it, record what we can.
          const buf = await readFile(dest);
          const dims = jpegInfo(buf);
          if (dims) {
            entry.provenance.maps[role] = { from: map.url, md5: map.md5, originalBytes: map.size, ...dims, reencoded: 'unknown (pre-existing file)', bytes: existing };
            console.log(`  = ${out} exists (${kb(existing)}), no manifest record — kept`);
            return;
          }
        }
        const prov = await downloadJpeg({ url: map.url, dest, expectedMd5: map.md5, kind: spec.kind });
        entry.provenance.maps[role] = prov;
        console.log(`  + ${out} ${kb(prov.originalBytes)}${prov.reencoded ? ` -> ${kb(prov.bytes)} [${prov.reencoded}]` : ''}`);
      })(),
    );
  }
  await Promise.all(tasks);

  // Remove a stale alternative (e.g. rough.jpg left over after arm.jpg became available).
  for (const stale of ['arm.jpg', 'rough.jpg']) {
    const p = path.join(dir, stale);
    if (!Object.values(entry.files).includes(toSiteRel(p)) && existsSync(p)) await rm(p);
  }
  // Keep key order stable: color, normal, arm|rough.
  const order = ['color', 'normal', 'arm', 'rough'];
  entry.files = Object.fromEntries(order.filter((k) => entry.files[k]).map((k) => [k, entry.files[k]]));
  entry.provenance.maps = Object.fromEntries(order.filter((k) => entry.provenance.maps[k]).map((k) => [k, entry.provenance.maps[k]]));
  return entry;
}

// ---------------------------------------------------------------------------
// three.js water normals (MIT)
// ---------------------------------------------------------------------------

async function processWater(prev) {
  const dir = path.join(TEXTURE_DIR, WATER.slot);
  await mkdir(dir, { recursive: true });
  const dest = path.join(dir, 'waternormals.jpg');
  const licenseDest = path.join(dir, 'LICENSE-three.js.txt');
  const prevEntry = prev?.[WATER.slot];
  const existing = await fileSize(dest);
  if (!flags.force && existing !== null && prevEntry?.provenance && existsSync(licenseDest)) {
    console.log('= water: waternormals.jpg already present, skipping');
    prevEntry.provenance.maps.normal.bytes = existing;
    return prevEntry;
  }

  console.log('> water: three.js waternormals.jpg');
  let tag;
  let prov;
  for (const t of WATER.tags) {
    const url = `https://raw.githubusercontent.com/mrdoob/three.js/${t}/${WATER.file}`;
    try {
      prov = await downloadJpeg({ url, dest, kind: null });
      tag = t;
      break;
    } catch (err) {
      if (!err.notFound) throw err;
      console.warn(`  · ${t}: not found, trying next tag`);
    }
  }
  if (!prov) throw new Error('waternormals.jpg not found on any candidate three.js tag');
  console.log(`  + waternormals.jpg ${kb(prov.bytes)} (three.js ${tag})`);

  // MIT requires the copyright + permission notice to travel with the file.
  const license = await fetchWithRetry(`https://raw.githubusercontent.com/mrdoob/three.js/${tag}/LICENSE`);
  await writeFile(
    licenseDest,
    `waternormals.jpg is taken from the three.js repository (${tag}, ${WATER.file}).\n` +
      `https://github.com/mrdoob/three.js/blob/${tag}/${WATER.file}\n\n${license.toString('utf8')}`,
  );
  const copyright = license.toString('utf8').match(/Copyright[^\n]*/)?.[0] ?? 'Copyright three.js authors';

  return {
    id: 'waternormals',
    name: 'three.js Water Normals',
    authors: ['three.js authors'],
    license: 'MIT',
    url: `https://github.com/mrdoob/three.js/blob/${tag}/${WATER.file}`,
    files: { normal: toSiteRel(dest) },
    resolution: prov.width >= 1000 ? `${Math.round(prov.width / 1024)}k` : `${prov.width}px`,
    note: 'Tiling ocean normal map used by three.js examples (Water shader).',
    provenance: {
      source: `three.js repository @ ${tag}`,
      licenseUrl: `https://github.com/mrdoob/three.js/blob/${tag}/LICENSE`,
      copyright,
      licenseFile: toSiteRel(licenseDest),
      maps: { normal: prov },
    },
  };
}

// ---------------------------------------------------------------------------
// Verification, manifest, docs
// ---------------------------------------------------------------------------

async function dirSize(dir) {
  let total = 0;
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    total += e.isDirectory() ? await dirSize(p) : (await stat(p)).size;
  }
  return total;
}

async function verify(manifest) {
  const problems = [];
  for (const [slot, entry] of Object.entries(manifest)) {
    for (const [role, rel] of Object.entries(entry.files ?? {})) {
      const abs = path.join(PUBLIC_DIR, rel);
      if (!existsSync(abs)) {
        problems.push(`${slot}.${role}: missing ${rel}`);
        continue;
      }
      const dims = jpegInfo(await readFile(abs));
      if (!dims) problems.push(`${slot}.${role}: not a decodable JPEG header (${rel})`);
    }
  }
  return problems;
}

function renderDoc(manifest, totalBytes) {
  const rows = [];
  let sum = 0;
  for (const [slot, e] of Object.entries(manifest)) {
    const maps = e.provenance?.maps ?? {};
    const sizes = Object.entries(e.files)
      .map(([role]) => {
        const b = maps[role]?.bytes ?? 0;
        sum += b;
        return `${role} ${kb(b)}`;
      })
      .join(', ');
    const slotBytes = Object.keys(e.files).reduce((a, r) => a + (maps[r]?.bytes ?? 0), 0);
    const anyMap = Object.values(maps)[0];
    const res = anyMap ? `${anyMap.width}×${anyMap.height}` : e.resolution;
    const phys = e.physicalSize ? `${e.physicalSize} m` : '—';
    rows.push(
      `| \`${slot}\` | ${e.name} (\`${e.id}\`) | ${e.authors.join(', ')} | ${e.license} | [${e.url.replace(/^https:\/\//, '')}](${e.url}) | ${res} | ${phys} | ${sizes} | ${kb(slotBytes)} |`,
    );
  }
  const notes = Object.entries(manifest)
    .map(([slot, e]) => `- **${slot}** — ${e.note ?? ''}`)
    .join('\n');
  const reenc = Object.entries(manifest)
    .flatMap(([slot, e]) =>
      Object.entries(e.provenance?.maps ?? {})
        .filter(([, m]) => m.reencoded)
        .map(([role, m]) => `\`${slot}/${role}\` ${kb(m.originalBytes)} → ${kb(m.bytes)}`),
    );

  return `<!-- Generated by scripts/assets/fetch-textures.mjs — do not edit by hand. -->
# Textures

PBR texture sets for the villa scene. Poly Haven assets are **CC0** (public domain, no attribution
required — credited here anyway); the water normal map comes from the **MIT**-licensed three.js
repository and ships with its license notice (\`public/assets/textures/water/LICENSE-three.js.txt\`).

Regenerate / extend with \`npm run assets:textures\` (\`--force\`, \`--only=slot,…\`, \`--check\`).
Machine-readable manifest: \`src/data/generated/textures.json\` (paths are site-relative).

## Conventions

- \`color.jpg\` — albedo, **sRGB** (\`texture.colorSpace = SRGBColorSpace\`).
- \`normal.jpg\` — tangent-space normal, **OpenGL** (+Y) convention (three.js default; linear).
- \`arm.jpg\` — packed **R = ambient occlusion, G = roughness, B = metalness** (linear). Plug the same
  texture into \`aoMap\`, \`roughnessMap\` and \`metalnessMap\` (three.js reads AO from R, roughness from G,
  metalness from B; since r152 \`aoMap\` uses \`texture.channel\`, default UV set 0, so no \`uv2\` is needed).
  Slots without an ARM map ship \`rough.jpg\` (grayscale roughness) instead.
- \`physicalSize\` — real-world width covered by one tile, in metres (from Poly Haven \`dimensions\`).
- Source resolution ${RESOLUTION} JPG. Files over ~700 KB were re-encoded (ffmpeg, chroma layout kept):
  albedo/ARM at ≈ IJG quality 81, normals at ≈ IJG 91 to avoid blocky shading.

## Slots

| Slot | Asset | Authors | License | Source | Resolution | Tile size | Files | Slot total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
${rows.join('\n')}

**Total of listed maps:** ${mb(sum)} · **\`public/assets/textures/\` on disk:** ${mb(totalBytes)} (budget ${mb(BUDGET_BYTES)}).

## Why these assets

${notes}

## Re-encoded files

${reenc.length ? reenc.map((r) => `- ${r}`).join('\n') : '- none'}
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const prev = (await readJson(MANIFEST_PATH)) ?? {};

  if (flags.check) {
    const problems = await verify(prev);
    const missingSlots = [...SLOTS.map((s) => s.slot), WATER.slot].filter((s) => !prev[s]);
    missingSlots.forEach((s) => problems.push(`${s}: not in manifest`));
    const total = await dirSize(TEXTURE_DIR);
    console.log(`textures on disk: ${mb(total)}`);
    if (problems.length) {
      console.error(problems.map((p) => `✗ ${p}`).join('\n'));
      process.exit(1);
    }
    console.log(`✓ ${Object.keys(prev).length} texture sets verified`);
    return;
  }

  await mkdir(TEXTURE_DIR, { recursive: true });
  const manifest = {};
  const failures = [];

  for (const spec of SLOTS) {
    if (flags.only && !flags.only.has(spec.slot)) {
      if (prev[spec.slot]) manifest[spec.slot] = prev[spec.slot];
      continue;
    }
    try {
      manifest[spec.slot] = await processSlot(spec, prev);
    } catch (err) {
      failures.push(`${spec.slot}: ${err.message}`);
      console.error(`✗ ${spec.slot}: ${err.message}`);
      if (prev[spec.slot]) manifest[spec.slot] = prev[spec.slot];
    }
  }

  if (!flags.only || flags.only.has(WATER.slot)) {
    try {
      manifest[WATER.slot] = await processWater(prev);
    } catch (err) {
      failures.push(`water: ${err.message}`);
      console.error(`✗ water: ${err.message}`);
      if (prev[WATER.slot]) manifest[WATER.slot] = prev[WATER.slot];
    }
  } else if (prev[WATER.slot]) {
    manifest[WATER.slot] = prev[WATER.slot];
  }

  const problems = await verify(manifest);
  const total = await dirSize(TEXTURE_DIR);

  await mkdir(path.dirname(MANIFEST_PATH), { recursive: true });
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  await mkdir(path.dirname(DOC_PATH), { recursive: true });
  await writeFile(DOC_PATH, renderDoc(manifest, total));

  console.log(`\nmanifest: ${path.relative(ROOT, MANIFEST_PATH)}`);
  console.log(`doc:      ${path.relative(ROOT, DOC_PATH)}`);
  console.log(`total:    ${mb(total)} in public/assets/textures/${total > BUDGET_BYTES ? '  ⚠ over budget' : ''}`);

  const all = [...failures, ...problems];
  if (all.length) {
    console.error(`\n${all.length} problem(s):\n${all.map((p) => `  ✗ ${p}`).join('\n')}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
