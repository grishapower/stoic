#!/usr/bin/env node
/**
 * Fetch open-license (CC0) 3D models from Poly Haven, optimise them for the game and record provenance.
 *
 *   node scripts/assets/fetch-open-models.mjs                    # build whatever is missing or out of date
 *   node scripts/assets/fetch-open-models.mjs --force            # rebuild every output (downloads come from the cache)
 *   node scripts/assets/fetch-open-models.mjs --only=marble-bust,rock-coast-ledge
 *   node scripts/assets/fetch-open-models.mjs --cache=/some/dir  # download cache (default: $TMPDIR/seneca-open-models)
 *   node scripts/assets/fetch-open-models.mjs --check            # offline: verify outputs against the manifest
 *
 * Outputs
 *   public/assets/models/open/<id>.glb      (meshopt geometry, WebP textures <= 1024 px, metres, Y-up)
 *   src/data/generated/open-models.json     (manifest + provenance; paths are site-relative)
 *   docs/assets/open-models.md              (attribution table + rejected candidates)
 *
 * Pipeline per asset: Poly Haven glTF at 1k (md5-verified, cached) -> optional node subset -> optional alpha map
 * merged into base colour (alphaMode MASK) -> dedup/weld -> per-node meshopt simplification -> normalize()
 * (scale, bottom-centre pivot, baked) -> per-variant re-pivot -> ARM texture also bound as occlusion ->
 * compressTextures() + finalizeAndWrite() from optimize-glb.mjs (WebP + EXT_meshopt_compression).
 * Writes nothing to src/data/generated/models.json (that manifest belongs to the Meshy pipeline).
 * Downloaded files are treated as data only: they are parsed as glTF/images, never executed.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clearNodeTransform, dedup, getBounds, prune, simplifyPrimitive, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import {
  boundsSize, compressTextures, countTriangles, createIO, defaultScene, finalizeAndWrite, normalize, texturesSummary,
} from './optimize-glb.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_DIR = path.join(ROOT, 'public', 'assets', 'models', 'open');
const MANIFEST_PATH = path.join(ROOT, 'src', 'data', 'generated', 'open-models.json');
const DOC_PATH = path.join(ROOT, 'docs', 'assets', 'open-models.md');
const API = 'https://api.polyhaven.com';
const USER_AGENT = 'seneca-art-of-time-open-models/1.0 (build script; CC0 asset pipeline)';
const RESOLUTION = '1k';
const BUDGET_BYTES = 25 * 1024 * 1024;
const PIPELINE_VERSION = 6; // bump to force a rebuild when the processing below changes

/**
 * Output id -> Poly Haven asset + processing recipe. Chosen by browsing the Poly Haven API and judging the
 * renders against the concept art (docs/concept/*.png); rationale in `use` / `notes` and docs/assets/open-models.md.
 *   keepNodes      top-level node names to keep (others dropped)
 *   alpha          Poly Haven map key whose 1k PNG becomes the alpha channel of every non-opaque material
 *   maxTris        total triangle budget (uniform ratio across nodes)
 *   nodeTris       per top-level node budget (overrides maxTris for that node; '*' = every node)
 *   error          meshopt simplification error bound (fraction of mesh extent)
 *   scale          uniform scale applied after import (Poly Haven models are already in metres)
 *   variants       each top-level node is a separate variant, re-pivoted to its own bottom centre at the origin
 *   maxTexture     texture size cap in px (default 1024; 512 for hand-sized props)
 *   sourceGround   pivot Y at the scan's own ground plane (source y = 0) instead of the lowest vertex
 *   smoothNormals  drop the source's split (hard-edge) normals before welding so the mesh can be simplified, then
 *                  recompute smooth normals
 */
export const ASSETS = [
  /* ------------------------------------------------------------------ 1. rocks */
  {
    id: 'rock-coast-ledge', src: 'coast_rocks_05', sourceGround: true, maxTris: 15000, error: 0.02,
    use: '1 · rocks — sea cove shoreline: weathered limestone ledge with an undercut boulder, pebbles and a little seaweed.',
    notes: 'Scan includes its own ground skirt (sand/pebbles). Pivot is the scan\'s ground plane: place y=0 on the beach surface (the skirt dips to -0.25 m). Real size, ~4 m across.',
  },
  {
    id: 'rock-boulder-block', src: 'namaqualand_boulder_03', maxTris: 12000, error: 0.01,
    use: '1 · rocks — big tan block boulder for the cliff foot / cove (reads as tuff or sandstone).',
    notes: 'Real size ~2.4 x 1.5 x 3.1 m. Scale 0.5-1.5 and rotate freely for variety.',
  },
  {
    id: 'rock-boulder-pale', src: 'namaqualand_boulder_05', maxTris: 9000, error: 0.01,
    use: '1 · rocks — low pale limestone-like boulder; garden edges, cove, path sides.',
    notes: 'Real size ~1.4 x 0.5 x 0.75 m.',
  },
  {
    id: 'rock-rubble-cluster', src: 'namaqualand_boulder_02', maxTris: 14000, error: 0.01,
    use: '1 · rocks — cluster of blocky fallen rocks for the cliff foot (rock-fall at the base of the stair).',
    notes: 'One mesh, ~2.5 x 0.9 x 1.2 m. Bottom is flat; sink slightly.',
  },
  {
    id: 'rock-boulder-jagged', src: 'boulder_01', smoothNormals: true, maxTris: 12000, error: 0.02,
    use: '1 · rocks — jagged weathered boulder (warm brown) for the cliff foot and cove.',
    notes: 'Real size ~1.3 x 1.0 x 1.8 m.',
  },
  {
    id: 'rock-limestone-slab', src: 'moon_rock_01', keepNodes: ['moon_rock_01_LOD0'], scale: 10, maxTris: 10000, error: 0.005,
    use: '1 · rocks — pale grey flat slab (Capri/Sorrento limestone look) for the cove and as a natural step/seat.',
    notes: 'Source is a 21 cm hand-sample scan (Poly Haven "Moon Rock 01"); scaled x10 to ~2.1 x 0.8 x 1.1 m. Texture is therefore softer up close; fine at >3 m.',
  },
  {
    id: 'stones-small', src: 'namaqualand_stones_01', variants: true, maxTexture: 512, nodeTris: { '*': 1200 }, error: 0.01,
    use: '1 · rocks — 5 small stones (8-15 cm) to scatter on paths, the beach and along wall bases (instancing).',
    notes: 'Variant nodes stones-small_a..e, each pivoted at its own bottom centre (all overlap at the origin). Scale up to x3 for cobbles.',
  },
  {
    id: 'beach-pebble-patch', src: 'sand_rocks_small_01', sourceGround: true, maxTris: 15000, error: 0.02,
    use: '1 · rocks — sandy shore patch with half-buried pale pebbles/rocks; dress the cove beach.',
    notes: 'Ground-patch scan ~4.6 x 3.9 m, rocks up to ~0.4 m high, irregular sandy rim. Pivot is the scan\'s ground plane: place y=0 on the beach surface.',
  },

  /* ------------------------------------------------------------------ 2. plants & ground cover */
  {
    id: 'helichrysum-clump', src: 'flower_stinkkruid', alpha: 'Alpha', variants: true, nodeTris: { '*': 3000 }, error: 0.01,
    use: '2 · plants — grey-green clumps with yellow button flowers: stand-in for Helichrysum italicum / Santolina (Mediterranean immortelle, cotton-lavender) on path edges and dry beds.',
    notes: 'Species is South African (Stinkkruid); visually close to Mediterranean helichrysum/santolina. 4 variants, 0.2-0.35 m wide; scale x1.5-2.5 for garden clumps. Alpha-tested leaves (MASK 0.5), double-sided.',
  },
  {
    id: 'calendula-wild', src: 'flower_ursinia', alpha: 'Alpha', variants: true, nodeTris: { '*': 2500 }, error: 0.01,
    use: '2 · plants — low sprawling plants with orange daisies: stand-in for field marigold (Calendula arvensis), a common Mediterranean wildflower; meadow, path edges.',
    notes: 'Species is South African (Ursinia). 5 variants, 0.15-0.45 m wide. Alpha-tested, double-sided.',
  },
  {
    id: 'iceplant-coastal', src: 'crystalline_iceplant', alpha: 'Alpha', maxTexture: 512, variants: true, nodeTris: { '*': 1500 }, error: 0.01,
    use: '2 · plants — succulent rosettes of the crystalline ice plant (Mesembryanthemum crystallinum, native to Mediterranean coasts) for cove rocks and the cliff-top edge.',
    notes: '8 variants, 5-30 cm. Alpha-tested, double-sided.',
  },
  {
    id: 'nettle-clump', src: 'nettle_plant', alpha: 'Alpha', maxTexture: 512, variants: true, nodeTris: { '*': 2500 }, error: 0.01,
    use: '2 · plants — nettle sprigs (Urtica, native) for wall bases, the goat pasture and neglected corners.',
    notes: '6 variants, 6-22 cm tall; scale x2-4 for mature clumps. Alpha-tested, double-sided.',
  },
  {
    id: 'dry-scrub', src: 'wild_rooibos_bush', alpha: 'Alpha', variants: true, nodeTris: { '*': 3000 }, error: 0.015,
    use: '2 · plants — dry, needle-leaved low bushes: stand-in for late-summer garrigue (thyme, savory, broom) on the cliff top, goat pasture and dry wall edges.',
    notes: 'Species is South African (wild rooibos). 5 variants, 0.3-0.85 m. Twigs/leaves alpha-tested, trunk opaque.',
  },
  {
    id: 'yellow-wildflower', src: 'flower_empodium', alpha: 'Alpha', maxTexture: 512, variants: true, error: 0.01,
    use: '2 · plants — tiny yellow star flowers in grass-like leaves (stand-in for Sternbergia / star-of-Bethlehem); lawn and meadow sprinkles.',
    notes: 'Species is South African (Empodium). 5 variants, 0.1-0.27 m. Very cheap (~3k tris for all). Alpha-tested.',
  },
  {
    id: 'dandelion', src: 'dandelion_01', alpha: 'Alpha', maxTexture: 512, variants: true, nodeTris: { '*': 2000 }, error: 0.01,
    use: '2 · plants — dandelion rosettes with yellow heads (native; eaten as a wild green) for lawn edges and path cracks.',
    notes: '5 variants, 0.12-0.22 m. Alpha-tested.',
  },

  /* ------------------------------------------------------------------ 3. sculpture, garden vessels */
  {
    id: 'marble-bust', src: 'marble_bust_01', maxTris: 14000, error: 0.002,
    use: '3 · sculpture — white marble male portrait bust on a round foot; study bust column (STUDY.bustColumn), niches, peristyle.',
    notes: 'Renaissance-style but reads as a Roman Republican/Julio-Claudian portrait. 0.27 x 0.51 x 0.30 m (life size). Face looks to +Z.',
  },
  {
    id: 'urn-planter', src: 'potted_plant_01', keepNodes: ['potted_plant_01_pot', 'potted_plant_01_pebbles'],
    nodeTris: { potted_plant_01_pebbles: 4000 }, error: 0.02,
    use: '3 · garden vessels — terracotta urn-shaped planter on a pedestal foot, filled with gravel; peristyle and terrace planters (plant your own shrub in it).',
    notes: 'The source houseplant (leaves/stem) is removed. 0.47 x 0.53 m. Gravel top sits ~0.45 m above the base.',
  },
  {
    id: 'terracotta-pot', src: 'planter_pot_clay', maxTexture: 512,
    use: '3 · garden vessels — weathered terracotta flower pot (Roman gardens used similar clay pots, ollae perforatae, for planting).',
    notes: '0.27 x 0.22 m. Empty (no soil).',
  },

  /* ------------------------------------------------------------------ 4. pottery & small props */
  {
    id: 'wooden-bowl', src: 'wooden_bowl_02', maxTexture: 512,
    use: '4 · props — small hand-carved wooden bowl (olives, figs, pomegranates) for the study table and kitchen corners.',
    notes: '0.13 x 0.07 m.',
  },
  {
    id: 'pomegranate', src: 'food_pomegranate_01', maxTris: 1500, maxTexture: 512, error: 0.01,
    use: '4 · props — pomegranate fruit (Punica granatum, ubiquitous in Pompeian frescoes) for bowls, the study table, a fruit tree.',
    notes: '11 cm. Decimated from 8k tris.',
  },
  {
    id: 'wooden-bucket', src: 'wooden_bucket_01',
    use: '4 · props — stave bucket with iron hoops and bail handle (wooden buckets of this type are known from Roman sites); garden, well, cove.',
    notes: '0.37 x 0.55 m including the raised handle.',
  },
  {
    id: 'wooden-tub', src: 'wooden_bucket_02',
    use: '4 · props — low stave tub with two side lugs; laundry / fish tub at the cove, garden watering.',
    notes: '0.62 x 0.35 m.',
  },
  {
    id: 'folding-stool', src: 'folding_wooden_stool',
    use: '4 · props — X-frame folding stool, a stand-in for the Roman sella plicatilis; study, portico, cove.',
    notes: '0.53 x 0.44 x 0.55 m. Slatted wooden seat (a Roman one would have leather) — fine at a glance.',
  },
  {
    id: 'wicker-basket', src: 'wicker_basket_01', maxTris: 9000, error: 0.003,
    use: '4 · props — shallow rectangular woven basket; fish at the cove, figs/herbs in the garden.',
    notes: '0.38 x 0.12 x 0.30 m. Decimated from 22k tris; the weave lives mostly in the normal map.',
  },

  /* ------------------------------------------------------------------ 6. other */
  {
    id: 'jetty-section', src: 'modular_wooden_pier', keepNodes: ['modular_wooden_pier_section_02'], maxTexture: 512,
    use: '6 · other — one bay of a timber landing stage on piles for the cove (where the boat moors); chain 2-3 copies.',
    notes: 'One module (section_02) of Poly Haven "Modular Wooden Pier": 2.5 m wide, deck 2.9 m long along Z, one pair of piles. Pile feet at y=0, deck top at 3.61 m, pile tops 3.84 m: sink it so the deck is ~1 m above the water. Chain copies every 2.91 m along Z and close the open end with rocks or a second module.',
  },
  {
    id: 'driftwood', src: 'dry_branches_medium_01', variants: true, nodeTris: { '*': 2500 }, error: 0.01,
    use: '6 · other — 3 gnarled dry branches: driftwood on the beach, prunings under olives and along the pergola.',
    notes: '3 variants, 0.8-1.3 m long.',
  },
  {
    id: 'stone-fire-pit', src: 'stone_fire_pit', sourceGround: true,
    use: '6 · other — ring of grey stones around ashes: fishermen\'s cooking fire at the cove (life detail).',
    notes: '1.45 m across. Pivot is the ground plane (the ash bowl dips ~0.19 m below it). Add a small flame/smoke effect at the centre if lit.',
  },
];

/** Candidates looked at and not used (kept here so the generated doc stays in sync). */
export const REJECTED = [
  ['ship_pinnace, dutch_ship_large_01/02, dutch_ship_medium', '17th-century rigged ships; nothing on Poly Haven fits a 1st-century AD rowing/fishing boat (Meshy generates the boats).'],
  ['gothic_statue, horse_statue_01, concrete_cat_statue, garden_gnome', 'Gothic / porcelain / modern garden statuary.'],
  ['lion_head, bull_head, horse_head, bronze_*_statue', 'Modern bronze desk sculptures on square plinths.'],
  ['ceramic_vase_01-04, antique_ceramic_vase_01, jug_01, metal_jug', 'Modern glazed or painted ceramics (blue-and-white, floral transfer print), a milk churn.'],
  ['brass_vase_01-04, brass_goblets, brass_pot_01/02, brass_pan_01', 'Polished Indo-Persian / Victorian brassware; reads modern. (brass_pot_02 could pass as a bronze basin if ever needed.)'],
  ['ceramic_pot', 'Glazed lidded stoneware casserole; Roman kitchen ware was mostly unglazed.'],
  ['wooden_crate_01/02, CheeseBox_01, wooden_barrels_01, wine_barrel_01, barrel_03', 'Colonial chests with rivets/lettering, cheese box, steel-hooped wine barrels; barrels are Gallic and were skipped in favour of amphorae.'],
  ['wooden_stool_01/02, chinese_stool, painted_wooden_*', 'Turned Windsor-style / Chinese / painted modern furniture (wooden_stool_02 is only an 18 cm footstool).'],
  ['WoodenTable_*, round_wooden_table_*, gallinera_*, wooden_picnic_table', 'Modern or Victorian furniture.'],
  ['wooden_lantern_01, Lantern_01, vintage_oil_lamp, wooden_candlestick', 'Post-medieval lighting; Meshy generates a Roman oil lamp.'],
  ['potted_plant_02/04, anthurium, calathea, pachira', 'Tropical houseplants.'],
  ['grass_bermuda_01, grass_medium_01/02', '0.2-1 M triangles per tuft (geometry-nodes scatter); the game already draws procedural grass.'],
  ['celandine_01, searsia_lucida, othonna_cerarioides, leipoldtia_schultzei, flower_heliophila', '0.3-1.7 M triangles (or 13-20 MB at 1k); too heavy to decimate into foliage.'],
  ['flower_gazania, periwinkle_plant, shrub_sorrel_01, shrub_01-04, weed_plant_02, fern_02', 'Redundant with the chosen stand-ins, too small (sorrel sprigs are 2-7 cm), tropical-looking (pink Madagascar periwinkle) or northern woodland plants.'],
  ['coast_rocks_01-03, coast_land_rocks_02-04, coast_line_01/02, coastal_cliff_*', 'Large flat shoreline strips (1-3 M tris) with dark algae; coast_rocks_05 covers the cove.'],
  ['rock_face_01/02, mountainside, namaqualand_cliff_01/02, rock_moss_set_*', 'Green-grey schist / pink granite / mossy forest rocks; off-palette for Campanian limestone and tuff.'],
  ['moon_rock_02-07, rock_07/09, stone_01, namaqualand_boulder_04/06', 'Dark grey lunar-sample scans, dark brown or rusty-orange stones; the chosen set already covers the warm tan / pale grey range.'],
  ['modular_wooden_pier (full), modular_fort_01', 'Whole pier is 85k tris with scaffolding/ropes; only one plain bay is used. Colonial fort walls are off-period.'],
  ['lambis_shell', 'Indo-Pacific spider conch, not a Mediterranean shell.'],
  ['Quaternius / Kenney CC0 packs', 'Low-poly flat-shaded cartoon style clashes with the painterly-realistic look; not used.'],
  ['ambientCG 3D models', 'CC0 but only food scans (bread, pears, apples) - nothing needed now.'],
];

/* ------------------------------------------------------------------ helpers */

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const CACHE = path.resolve(opt('cache') || path.join(os.tmpdir(), 'seneca-open-models'));
const md5 = (buf) => createHash('md5').update(buf).digest('hex');
const sha1 = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12);
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const kb = (b) => `${Math.round(b / 1024)} KB`;

async function getJSON(url, cacheFile) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const json = await res.json();
    await mkdir(path.dirname(cacheFile), { recursive: true });
    await writeFile(cacheFile, JSON.stringify(json, null, 1));
    return json;
  } catch (err) {
    if (existsSync(cacheFile)) {
      console.warn(`  ! ${url}: ${err.message} — using cached copy`);
      return JSON.parse(await readFile(cacheFile, 'utf8'));
    }
    throw new Error(`${url}: ${err.message}`);
  }
}

/** Download `url` to `file` unless a copy with the expected md5 is already there. Atomic write. */
async function download(url, file, expectedMd5) {
  if (existsSync(file) && (!expectedMd5 || md5(await readFile(file)) === expectedMd5)) return false;
  const { protocol, hostname } = new URL(url);
  if (protocol !== 'https:' || !/(^|\.)polyhaven\.(org|com)$/.test(hostname)) throw new Error(`refusing non-Poly Haven URL ${url}`);
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (expectedMd5 && md5(buf) !== expectedMd5) throw new Error(`${url}: md5 mismatch`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(`${file}.part`, buf);
  await rename(`${file}.part`, file);
  return true;
}

/** Fetch the 1k glTF (+ .bin + textures) and optional extra maps of one Poly Haven model into the cache. */
async function fetchSource(src, extraMaps = []) {
  const dir = path.join(CACHE, src);
  const info = await getJSON(`${API}/info/${src}`, path.join(dir, 'info.json'));
  const files = await getJSON(`${API}/files/${src}`, path.join(dir, 'files.json'));
  const g = files.gltf?.[RESOLUTION]?.gltf;
  if (!g) throw new Error(`${src}: no ${RESOLUTION} glTF on Poly Haven`);
  const gltfFile = path.join(dir, path.basename(new URL(g.url).pathname));
  let fetched = 0;
  if (await download(g.url, gltfFile, g.md5)) fetched++;
  for (const [relPath, f] of Object.entries(g.include)) {
    const target = path.resolve(dir, relPath);
    if (!target.startsWith(dir + path.sep)) throw new Error(`${src}: unsafe include path ${relPath}`);
    if (await download(f.url, target, f.md5)) fetched++;
  }
  const extras = {};
  for (const key of extraMaps) {
    const f = files[key]?.[RESOLUTION]?.png || files[key]?.[RESOLUTION]?.jpg;
    if (!f) throw new Error(`${src}: no ${RESOLUTION} "${key}" map`);
    const target = path.join(dir, 'extra', path.basename(new URL(f.url).pathname));
    if (await download(f.url, target, f.md5)) fetched++;
    extras[key] = target;
  }
  return { info, gltfFile, extras, fetched };
}

/**
 * RGBA from colour + alpha with "alpha bleeding": transparent texels take the colour of nearby opaque texels
 * (normalised convolution, falling back to the mean leaf colour), so mipmapping/filtering does not pull the black
 * atlas background into thin leaves and needles.
 */
async function bleedRGBA(rgb, alpha, width, height) {
  const n = width * height;
  const pre = Buffer.alloc(n * 3);
  const mean = [0, 0, 0];
  let wsum = 0;
  for (let i = 0; i < n; i++) {
    const a = alpha[i] / 255;
    for (let c = 0; c < 3; c++) {
      pre[i * 3 + c] = Math.round(rgb[i * 3 + c] * a);
      mean[c] += rgb[i * 3 + c] * a;
    }
    wsum += a;
  }
  for (let c = 0; c < 3; c++) mean[c] = wsum ? mean[c] / wsum : 0;
  const sigma = Math.max(2, width / 128);
  const preBlur = await sharp(pre, { raw: { width, height, channels: 3 } }).blur(sigma).raw().toBuffer();
  const aBlur = await sharp(alpha, { raw: { width, height, channels: 1 } }).blur(sigma).extractChannel(0).raw().toBuffer();
  const out = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    const a = alpha[i];
    const ab = aBlur[i] / 255;
    for (let c = 0; c < 3; c++) {
      const fill = ab > 0.02 ? Math.min(255, preBlur[i * 3 + c] / ab) : mean[c];
      out[i * 4 + c] = a >= 250 ? rgb[i * 3 + c] : Math.round((rgb[i * 3 + c] * a + fill * (255 - a)) / 255);
    }
    out[i * 4 + 3] = a;
  }
  return sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

/** Merge a greyscale alpha map into the base colour of every non-opaque material; switch them to MASK. */
async function applyAlpha(doc, alphaFile) {
  const { data: alphaData, info: ai } = await sharp(alphaFile).greyscale().raw().toBuffer({ resolveWithObject: true });
  const alphaRaw = { width: ai.width, height: ai.height, channels: ai.channels };
  const cache = new Map();
  for (const mat of doc.getRoot().listMaterials()) {
    if (mat.getAlphaMode() === 'OPAQUE') continue;
    const tex = mat.getBaseColorTexture();
    if (!tex) continue;
    if (!cache.has(tex)) {
      const { data: rgb, info } = await sharp(Buffer.from(tex.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const { width, height } = info;
      const a = await sharp(alphaData, { raw: alphaRaw }).resize(width, height).extractChannel(0).raw().toBuffer();
      const png = await bleedRGBA(rgb, a, width, height);
      cache.set(tex, doc.createTexture(`${tex.getName()}_rgba`).setImage(new Uint8Array(png)).setMimeType('image/png'));
    }
    mat.setBaseColorTexture(cache.get(tex)).setAlphaMode('MASK').setAlphaCutoff(0.5).setDoubleSided(true);
  }
}

/** Poly Haven packs AO/Roughness/Metal in one "arm" map but only binds it as metallicRoughness: add it as occlusion. */
function bindArmAsOcclusion(doc) {
  for (const mat of doc.getRoot().listMaterials()) {
    const mr = mat.getMetallicRoughnessTexture();
    if (mr && !mat.getOcclusionTexture() && /(^|_)arm($|_)/.test(mr.getURI() || mr.getName() || '')) mat.setOcclusionTexture(mr);
  }
}

/** Area-weighted smooth vertex normals, shared across UV seams (vertices with the same position). */
function smoothNormals(doc, prim) {
  const pos = prim.getAttribute('POSITION');
  const idx = prim.getIndices().getArray();
  const n = pos.getCount();
  const key = new Array(n);
  const acc = new Map();
  for (let i = 0; i < n; i++) key[i] = pos.getElement(i, []).map((v) => Math.round(v * 1e5)).join(',');
  const p = [[], [], []];
  for (let t = 0; t < idx.length; t += 3) {
    for (let k = 0; k < 3; k++) pos.getElement(idx[t + k], p[k]);
    const e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
    const e2 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
    const fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    for (let k = 0; k < 3; k++) {
      const a = acc.get(key[idx[t + k]]) || [0, 0, 0];
      a[0] += fn[0]; a[1] += fn[1]; a[2] += fn[2];
      acc.set(key[idx[t + k]], a);
    }
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = acc.get(key[i]) || [0, 1, 0];
    const l = Math.hypot(...a) || 1;
    out.set([a[0] / l, a[1] / l, a[2] / l], i * 3);
  }
  prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(out).setBuffer(pos.getBuffer()));
}

function nodeTriangles(node) {
  let t = 0;
  node.traverse((n) => {
    for (const p of n.getMesh()?.listPrimitives() || []) if (p.getMode() === 4) t += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
  });
  return t;
}

/** Simplify each top-level node to its own budget (nodeTris[name] | nodeTris['*'] | share of maxTris). */
async function simplifyNodes(doc, { maxTris, nodeTris = {}, error = 0.01 }) {
  await MeshoptSimplifier.ready;
  const total = countTriangles(doc);
  for (const node of defaultScene(doc).listChildren()) {
    const tris = nodeTriangles(node);
    const budget = nodeTris[node.getName()] ?? nodeTris['*'] ?? (maxTris ? (tris * maxTris) / total : Infinity);
    if (!(tris > budget)) continue;
    const ratio = budget / tris;
    node.traverse((n) => {
      for (const prim of n.getMesh()?.listPrimitives() || []) {
        if (prim.getMode() === 4) simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio, error, lockBorder: false });
      }
    });
    console.log(`  simplify ${node.getName()}: ${tris} -> ${nodeTriangles(node)} tris`);
  }
}

/** After normalize(): pivot each variant node at its own bottom centre, rename to `<id>_<suffix>`. */
function splitVariants(doc, id) {
  const wrapper = defaultScene(doc).listChildren()[0];
  const variants = [];
  const used = new Set();
  wrapper.listChildren().forEach((node, i) => {
    const { min, max } = getBounds(node);
    node.setTranslation([-(min[0] + max[0]) / 2, -min[1], -(min[2] + max[2]) / 2]);
    clearNodeTransform(node);
    // Source names end in _a/_b/... (optionally _LOD0); nettle uses size words. Fall back to letters.
    const m = node.getName().replace(/_LOD\d+$/, '').match(/(?:_(medium|small|tall))?_([a-z])$/);
    let suffix = m ? (m[1] ? `${m[1]}_${m[2]}` : m[2]) : String.fromCharCode(97 + i);
    if (used.has(suffix)) suffix = `${suffix}${i}`;
    used.add(suffix);
    const name = `${id}_${suffix}`;
    node.setName(name);
    node.getMesh()?.setName(name);
    variants.push({ node: name, size: [0, 1, 2].map((k) => +(max[k] - min[k]).toFixed(3)), triangles: Math.round(nodeTriangles(node)) });
  });
  return variants;
}

async function buildAsset(asset, source) {
  const io = await createIO();
  const doc = await io.read(source.gltfFile);
  const scene = defaultScene(doc);
  const sourceTris = countTriangles(doc);
  if (asset.keepNodes) {
    for (const node of scene.listChildren()) if (!asset.keepNodes.includes(node.getName())) node.dispose();
    await doc.transform(prune());
    if (!scene.listChildren().length) throw new Error(`${asset.id}: keepNodes matched nothing`);
  }
  if (asset.alpha) await applyAlpha(doc, source.extras[asset.alpha]);
  if (asset.smoothNormals) for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) prim.setAttribute('NORMAL', null);
  await doc.transform(dedup(), prune(), weld());
  if (asset.maxTris || asset.nodeTris) await simplifyNodes(doc, asset);
  if (asset.smoothNormals) for (const mesh of doc.getRoot().listMeshes()) mesh.listPrimitives().forEach((p) => smoothNormals(doc, p));
  const srcMinY = getBounds(scene).min[1];
  const { scale } = normalize(doc, { name: asset.id, fit: 'scale', value: asset.scale || 1, rotateYDeg: asset.rotateY || 0 });
  // Scanned ground patches: keep the author's ground plane (source y = 0) instead of the lowest vertex.
  const groundDepth = asset.sourceGround && srcMinY < 0 ? +(-srcMinY * scale).toFixed(3) : 0;
  if (groundDepth) {
    scene.traverse((node) => {
      if (!node.getMesh()) return;
      node.setTranslation([0, -groundDepth, 0]);
      clearNodeTransform(node);
    });
  }
  const variants = asset.variants ? splitVariants(doc, asset.id) : null;
  bindArmAsOcclusion(doc);
  const { size } = boundsSize(doc);
  const triangles = countTriangles(doc);
  await compressTextures(doc, asset.maxTexture || 1024);
  const textures = await texturesSummary(doc);
  const alphaMode = [...new Set(doc.getRoot().listMaterials().map((m) => m.getAlphaMode()))];
  const outFile = path.join(OUT_DIR, `${asset.id}.glb`);
  const bytes = await finalizeAndWrite(io, doc, outFile);
  console.log(`  ${asset.id}: ${sourceTris} -> ${triangles} tris, size [${size}] m, ${kb(bytes)}`);
  return { outFile, bytes, triangles, size, scale, variants, textures, alphaMode, groundDepth };
}

function manifestEntry(asset, info, built, recipe) {
  return {
    file: `assets/models/open/${asset.id}.glb`,
    source: 'polyhaven',
    sourceId: asset.src,
    name: info.name,
    authors: Object.keys(info.authors || {}),
    license: 'CC0',
    url: `https://polyhaven.com/a/${asset.src}`,
    size: built.size,
    triangles: built.triangles,
    use: asset.use,
    notes: asset.notes,
    forward: '+Z',
    pivot: asset.variants ? 'bottom-center (per variant)' : built.groundDepth ? `center XZ, source ground plane at y=0 (mesh reaches y=-${built.groundDepth})` : 'bottom-center',
    ...(built.variants ? { variants: built.variants } : {}),
    alphaMode: built.alphaMode.length === 1 ? built.alphaMode[0] : built.alphaMode,
    ...(asset.scale && asset.scale !== 1 ? { sourceScale: asset.scale } : {}),
    textures: built.textures.map((t) => ({ slots: t.slots, size: t.size })),
    bytes: built.bytes,
    sourceFilesHash: info.files_hash,
    recipe,
  };
}

/* ------------------------------------------------------------------ doc */

function renderDoc(manifest) {
  const rows = ASSETS.filter((a) => manifest[a.id]).map((a) => {
    const e = manifest[a.id];
    return `| \`${a.id}\` | [${e.name}](${e.url}) | ${e.authors.join(', ')} | ${e.license} | ${a.use.replace(/\|/g, '/')} | ${e.size.join(' × ')} | ${e.triangles.toLocaleString('en-US')}${e.variants ? ` (${e.variants.length} var.)` : ''} | ${kb(e.bytes)} |`;
  });
  const total = ASSETS.reduce((s, a) => s + (manifest[a.id]?.bytes || 0), 0);
  const notes = ASSETS.filter((a) => manifest[a.id]).map((a) => `- \`${a.id}\` — ${a.notes}`);
  return `<!-- Generated by scripts/assets/fetch-open-models.mjs — do not edit by hand. -->
# Open-license 3D models

Ready-made **CC0** (public domain) models from [Poly Haven](https://polyhaven.com) that complement the
Meshy-generated props (see [meshy.md](meshy.md)). No attribution is required for CC0; authors are credited anyway.
Machine-readable manifest: \`src/data/generated/open-models.json\` (separate from \`models.json\`).

Rebuild / extend: \`node scripts/assets/fetch-open-models.mjs\` (\`--force\`, \`--only=id,…\`, \`--cache=dir\`, \`--check\`).
Sources are the Poly Haven 1k glTF downloads (md5-verified against the API) plus, for foliage, the 1k alpha map.

## Conventions

- Files: \`public/assets/models/open/<id>.glb\` — meshopt-compressed geometry (\`EXT_meshopt_compression\`,
  \`KHR_mesh_quantization\`; drei \`useGLTF\` decodes it by default), WebP textures ≤ 1024 px.
- Units metres, Y up, real-world size (except \`rock-limestone-slab\`, scaled ×10). Pivot at the bottom centre,
  except the ground-patch scans \`rock-coast-ledge\`, \`beach-pebble-patch\` and \`stone-fire-pit\`, whose pivot is the
  scan's own ground plane (they dip below y = 0; see \`pivot\` in the manifest). Transforms baked. "Forward" is the
  source's front view (+Z); most of these are rotation-agnostic.
- Materials: base colour + OpenGL normal map + Poly Haven ARM map bound as metallicRoughness **and** occlusion
  (R = AO, G = roughness, B = metal). Poly Haven marks every material double-sided; for closed opaque props
  (rocks, vessels) \`side = FrontSide\` is safe and cheaper. Normal maps need runtime tangents (three.js derives them).
- Foliage: the source alpha map is merged into the base colour, \`alphaMode: MASK\` (cutoff 0.5), double-sided.
  Prefer \`alphaToCoverage\` with MSAA, or keep \`alphaTest\`; avoid transparent sorting.
- **Variant sets** (\`variants\` in the manifest): each variant is its own top-level node named \`<id>_<suffix>\`,
  pivoted at its own bottom centre, so all variants **overlap at the origin**. Pick one with
  \`gltf.scene.getObjectByName(name)\` (clone or use its geometry for \`InstancedMesh\`); do not add the whole scene.

## Models

| Id | Source | Authors | License | Use (need) | Size m (W × H × D) | Triangles | File |
| --- | --- | --- | --- | --- | --- | --- | --- |
${rows.join('\n')}

**Total:** ${(total / 1024 / 1024).toFixed(2)} MB (budget ${(BUDGET_BYTES / 1024 / 1024).toFixed(0)} MB).

### Integration notes

${notes.join('\n')}

## Gaps (not found as open models)

Nothing suitable (CC0/CC-BY, direct download, matching style) was found for: roses, lilies, irises, lavender,
rosemary, poppies, wild fennel, ivy, acanthus, vines; a 1st-century boat; Roman-style statues, pedestals and
garden urns/kraters (beyond the bust and the urn planter); amphorae, jugs, oil lamps; ropes and fishing nets;
stone well-head, sundial, column fragments, pergola beams. These are left to Meshy or procedural geometry.

## Rejected candidates

| Candidate(s) | Why not |
| --- | --- |
${REJECTED.map(([c, why]) => `| ${c} | ${why} |`).join('\n')}
`;
}

/* ------------------------------------------------------------------ main */

async function check(manifest) {
  let ok = true;
  for (const a of ASSETS) {
    const e = manifest[a.id];
    const file = path.join(ROOT, 'public', e?.file || `assets/models/open/${a.id}.glb`);
    if (!e || !existsSync(file)) { console.log(`MISSING ${a.id}`); ok = false; continue; }
    const bytes = (await stat(file)).size;
    if (bytes !== e.bytes) { console.log(`SIZE MISMATCH ${a.id}: ${bytes} != ${e.bytes}`); ok = false; }
  }
  const total = Object.values(manifest).reduce((s, e) => s + e.bytes, 0);
  console.log(`${Object.keys(manifest).length} models, ${(total / 1024 / 1024).toFixed(2)} MB`);
  if (!ok) process.exit(1);
}

async function main() {
  const manifest = existsSync(MANIFEST_PATH) ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) : {};
  if (flag('check')) return check(manifest);
  const only = opt('only')?.split(',');
  const list = only ? ASSETS.filter((a) => only.includes(a.id)) : ASSETS;
  if (only && list.length !== only.length) throw new Error(`unknown id in --only: ${only.filter((i) => !ASSETS.some((a) => a.id === i))}`);
  console.log(`cache: ${CACHE}`);
  for (const asset of list) {
    const source = await fetchSource(asset.src, asset.alpha ? [asset.alpha] : []);
    const recipe = sha1(JSON.stringify({ asset: { ...asset, use: undefined, notes: undefined }, files: source.info.files_hash, v: PIPELINE_VERSION }));
    const outFile = path.join(OUT_DIR, `${asset.id}.glb`);
    if (!flag('force') && manifest[asset.id]?.recipe === recipe && existsSync(outFile)) {
      manifest[asset.id] = { ...manifest[asset.id], use: asset.use, notes: asset.notes };
      console.log(`= ${asset.id} up to date`);
      continue;
    }
    console.log(`> ${asset.id} <- polyhaven/${asset.src}${source.fetched ? ` (${source.fetched} files downloaded)` : ''}`);
    const built = await buildAsset(asset, source);
    manifest[asset.id] = manifestEntry(asset, source.info, built, recipe);
  }
  // Drop entries no longer configured; keep the configured order.
  const ordered = Object.fromEntries(ASSETS.filter((a) => manifest[a.id]).map((a) => [a.id, manifest[a.id]]));
  await mkdir(path.dirname(MANIFEST_PATH), { recursive: true });
  await writeFile(MANIFEST_PATH, JSON.stringify(ordered, null, 2) + '\n');
  await mkdir(path.dirname(DOC_PATH), { recursive: true });
  await writeFile(DOC_PATH, renderDoc(ordered));
  const total = Object.values(ordered).reduce((s, e) => s + e.bytes, 0);
  console.log(`\n${Object.keys(ordered).length} models, ${(total / 1024 / 1024).toFixed(2)} MB -> ${rel(OUT_DIR)}, ${rel(MANIFEST_PATH)}, ${rel(DOC_PATH)}`);
  if (total > BUDGET_BYTES) console.warn(`WARNING: over the ${BUDGET_BYTES / 1024 / 1024} MB budget`);
}

main().catch((err) => {
  console.error(`ERROR: ${err.stack || err.message}`);
  process.exit(1);
});
