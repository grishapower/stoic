# Meshy asset pipeline: Seneca and villa props

Run date: 2026-10-19. This run spent **382 credits** (my cap was 900, out of the 1500 approved for the whole prototype). The Meshy balance went from **4120 to 3738**, and the ledger total matches the balance drop exactly.

> **Round 2** (same day, 225 credits): mandarin and citron fruits, a first-person hand, a light olive tree for instancing, a stone pine and a cypress. See [Round 2](#round-2-fruits-first-person-hand-trees) at the end. Project total: **607 / 1500** credits.
>
> **Round 3** (same day, 720 credits, run cap 780): 19 world-fill assets (exedra, statues, boats, peristyle, walk and study props). See [Round 3](#round-3-world-fill) at the end. Project total: **1381 / 1500** credits (54 of them went to concept art); balance 2739.

## Results

| model (game file) | source | size w×h×d (m) | tris | file | verdict |
|---|---|---|---|---|---|
| `assets/models/seneca.glb` | v1, rigged, 10 clips | 1.22 × 1.74 × 0.47 (rest A-pose) | 36,143 | 2.5 MB | **Good**: see the Seneca section |
| `assets/models/stone-bench.glb` | main | 1.90 × 0.61 × 0.56 | 11,994 | 310 KB | Good |
| `assets/models/fountain.glb` | v2 (retry) | 2.60 × 1.86 × 2.60 | 19,566 | 543 KB | Good |
| `assets/models/amphora-planter.glb` | v1 wide pot | 0.95 × 0.85 × 0.95 | 8,215 | 322 KB | Good |
| `assets/models/amphora-planter-tall.glb` | v2 tall jar | 0.61 × 1.00 × 0.61 | 8,092 | 360 KB | Good |
| `assets/models/writing-table.glb` | main | 1.20 × 0.82 × 0.92 | 13,445 | 640 KB | Acceptable |
| `assets/models/herm-bust.glb` | v2 (retry) | 0.28 × 0.70 × 0.31 | 15,565 | 633 KB | Acceptable, with a caveat: it is a bust on a block, not a full herm |
| `assets/models/olive-tree.glb` | main | 4.18 × 5.00 × 4.35 | 24,173 | 1.0 MB | Good (stylized) |
| column-tuscan | n/a | n/a | n/a | n/a | **Rejected**: both previews were off-brief. Use the procedural columns. |

The manifest is in `src/data/generated/models.json`. It lists the file, size, triangles, forward axis, pivot, animations (with durations, loop flags and walk speeds), task ids, texture sizes, byte size and licence for each model. Every GLB has:

- passed `gltf-validator` with 0 errors;
- been loaded back with gltf-transform and the meshopt decoder;
- been rendered from the compressed file by the QA renderer.

## Integration notes (three.js)

- **Compression.** Every file uses `EXT_meshopt_compression`, `KHR_mesh_quantization` and `EXT_texture_webp`. Call `gltfLoader.setMeshoptDecoder(MeshoptDecoder)` (from `three/examples/jsm/libs/meshopt_decoder.module.js`). Draco is not used.
- **Units and pivot.** Units are metres. Every round-1 prop is baked so the pivot is at the bottom centre (y = 0 at the floor, centred in X and Z), with identity root transforms. Seneca's feet rest at y = 0 and he is centred. (Round 2 exceptions: the fruits pivot at the fruit-body centre and the hand at its grip point; see Round 2.)
- **Forward axis.** Forward is **+Z**:
  - Seneca faces +Z.
  - The bench is long along X; its front, with the lion faces, faces +Z, and it is symmetric front to back.
  - The writing table is long along X; the diptych and the writer's side are on +Z.
  - The herm's face looks toward +Z.
  - The fountain, pots and tree are radially symmetric.
- **Texture sizes.** Prop textures are capped at 1024 px and character textures at 2048 px (WebP).
- **Normal maps.** Materials have normal maps but no tangents, except Seneca, who has them. three.js derives tangents in the shader, so this is fine. The validator only gives a warning.
- **Materials.** Each model is a single mesh with a single material, which keeps the draw-call count low. Every material uses `metallicFactor` 1 × the metallicRoughness texture. The metallic channel is near-black everywhere except on intentionally metal parts: the fountain's bronze pine-cone finial, the table's inkwell and stylus, and a few tiny islands.

### Seneca clips (`seneca.glb`, one skeleton of 24 joints, names Mixamo-like: `Hips`, `Spine02`, `Spine01`, `Spine`, `neck`, `Head`, `LeftArm`, …)

| clip | duration (s) | loop | source (Meshy action) | notes |
|---|---|---|---|---|
| `idle` | 9.97 | yes | Idle_3 (243) | Calm standing idle |
| `walk` | 4.13 | yes | Casual_Walk_inplace (613) | In place, **0.71 m/s** |
| `walk_thoughtful` | 4.70 | yes | Thoughtful_Walk (121) | In place, **0.59 m/s**. Recommended default for strolling. |
| `walk_basic` | 1.07 | yes | Basic walk from the rig task (free) | In place, **1.45 m/s** (brisk) |
| `talk_open` | 3.97 | yes | Talk_with_Hands_Open (313) | |
| `talk_right` | 3.73 | yes | Talk_with_Right_Hand_Open (314) | |
| `talk_chat` | 5.17 | yes | Stand_and_Chat (56) | Relaxed; good while narrating |
| `shrug` | 1.97 | no | Shrug (317) | Play once, then crossfade back to idle or talk |
| `look_around` | 7.83 | no | Short_Breathe_and_Look_Around (338) | Idle variation |
| `listen` | 9.33 | yes | Listening_Gesture (47) | Subtle nods. Used as "agree/nod". |

All clips are **in place**: Meshy had already removed the hips' horizontal travel, so the measured root displacement is ≤ 2 mm.

Walk speeds come from foot plants. I measured the horizontal speed of a planted foot (at the lowest 2 cm of foot height, sampled at 120 Hz) with forward kinematics in `merge-character.mjs`. To avoid foot sliding, set `action.timeScale = moveSpeed / walkSpeedMps`.

I rejected `Agree_Gesture` (25) because its preview GIF shows emphatic raised and crossed arms, which is wrong for Seneca.

## Seneca: quality assessment

- **Selection.** I generated two previews: v1 on meshy-7.1 and v2 on meshy-6, with different wording, and refined both (10 credits each) so I could judge them with real textures.
  - **v1 was selected.** It follows the brief: an undyed cream tunic to the knee, a leather belt, and a brown wool mantle over the left shoulder hanging down the back. He has a short grey beard, short grey hair with receding temples, a kind and thoughtful face, and plain sandals. There is no staff, jewellery or laurel.
  - v2 had better drapery, but its texture ignored the colour brief (brown tunic, grey mantle). It also gave him full white "sage" hair and a longer beard, which pushes toward the wizard archetype. Its long side drape is also riskier to skin.
- **Face.** The face detail comes almost entirely from the texture, which is good at play distance: believable eyes, wrinkles and beard. The geometry is coarse, because a 20k-quad remesh leaves the head with only a few hundred triangles, so the face silhouette is faceted in a tight close-up. The face island in the 2048 atlas is about 160 px.
  - The generated mesh looked about 20° upward. I fixed this in `merge-character.mjs` by pitching `neck` (40%) and `Head` (60%) down 20° about their local axis that matches world +X, in the rest pose and in every rotation key. This gives a level gaze with no neck artefacts.
  - Because of the correction, the crown now sits at 1.74 m; the body was rigged at 1.72 m.
- **Skin and colour.** Meshy's skin was saturated orange, so I multiplied base-colour saturation by 0.85 at merge time. It still reads warm and tanned. Check it under the game's golden-hour lighting and tone mapping.
- **Rig.** The Meshy auto-rig is a 24-joint biped with no finger bones, so the hands are rigid "mittens" (fingers are painted on and modelled, but not articulated). The skin weights hold up across the walks and gestures I checked: the tunic follows the thighs with mild stretching at full stride, there is no fused cloth between the legs, the mantle stays on the shoulder, and the sandals stay intact.
  - In `idle` the arms rest a little away from the body, a bias from the A-pose bind.
  - A small pale fold of the tunic's underside is visible between the knees from the front.
- **Topology.** The mesh is quad-remeshed (36k triangles) and has one auto-UV atlas with typical seams. I saw no visible seams on the face in QA renders. Overall this is a solid indie-game NPC, not a hero-quality close-up character.

## Process

1. `npm run meshy:balance`, plus `node scripts/meshy/meshy.mjs library [search] [--ids 1,2] [--urls]`. These calls are free.
2. `node scripts/meshy/meshy.mjs generate <asset> [--variant v] [--preview-only] [--dry-run]` runs preview → wait → refine (PBR, 2K) → download.
   - Raw files go to `assets-src/meshy/raw/<asset>/<variant>/`: `preview.glb/png`, `refine.glb/png/fbx`, `textures/*.png`, and `*.task.json` (stripped of signed URLs).
   - Every created task id is written to `assets-src/meshy/assets.json` and to the ledger immediately.
   - Re-running a step reuses a SUCCEEDED or in-flight task (registry first, then the ledger), so no step is ever paid twice. FAILED or CANCELED tasks are refunded and recreated.
3. `meshy.mjs rig <asset>` uses `selected_variant`'s refine task with `height_meters`. It saves `rigged.glb/.fbx` and the basic walking and running GLBs.
4. `meshy.mjs animate <asset>` sends one `action_ids` request from `assets.json → animations`. It first checks the IDs and names against the free library endpoint.
5. `meshy.mjs status [asset] [--refresh]` prints a status summary. `node scripts/meshy/report.mjs` prints the Markdown tables used in this document.
6. `npm run assets:optimize -- <asset>... | --all` handles props; `node scripts/assets/merge-character.mjs seneca` handles the character.
7. `node scripts/assets/inspect-glb.mjs <glb>... [--bones] [--json]` prints bounds (rest pose via forward kinematics for skinned meshes), triangles, materials, texture sizes, skins and bones, clips with durations and root motion, and the gltf-validator result.
8. QA: `node scripts/meshy/render-views.mjs <glb> <out.png> [--views front,right,back,three,top] [--crop 0.8:1] [--anim clip --times 0,0.5]`. This is a CPU rasteriser that renders textured, skinned and animated views without a browser. I used it for every accept/reject decision below.

**Budget guard** (`scripts/meshy/lib/budget.mjs`). Before every paid call it prints the expected cost and the running total and checks `GET /openapi/v1/balance`. It refuses if `max(ledger total, start balance − live balance) + cost` would exceed the cap of 900, or if the balance is too low. The guard writes `assets-src/meshy/ledger.json` with:

- timestamp, asset, operation and task id;
- expected credits, and the consumed credits once the task settles;
- balance before and after creation, and after settling.

Several jobs ran in parallel, so the per-row balance before and after also reflects other tasks that were in flight. The API key is read from `.env.local` and is only ever sent to `api.meshy.ai`. Downloads use the pre-signed URLs without credentials.

## Prompts

All prompts share an art-direction preamble (`assets.json → art_direction`):

- Geometry: *"Single isolated game-ready 3D model, cinematic stylized realism like a quality indie game. Ancient Roman, mid-1st century AD, Campanian seaside villa. Realistic proportions, plain authentic design, no fantasy ornament, no modern elements."*
- Texture suffix: *"Warm sun-bleached natural materials, matte, subtle weathering, soft painterly realism, warm Mediterranean palette, no text, no logos, no modern elements."*

Settings: meshy-7.1 for everything except Seneca v2 (meshy-6), with `should_remesh: true`. Props use triangle topology with polycount targets of 6–30k; Seneca uses quad topology at 20k with `pose_mode: "a-pose"`. Refines use `enable_pbr`, 2K textures and `remove_lighting` on meshy-6. The exact subject and texture prompts per variant are stored in `assets.json`, under `variants` and under `attempts.<v>.prompt` / `texture_prompt` (the full prompt as sent).

The text-to-3D API has no working negative prompt. I kept the "negative" notes as review criteria only, because naming unwanted things in the prompt tends to invite them.

Retries and rejections:

- **fountain/main → rejected.** It came out as a wall fountain with a backdrop panel and a raised birdbath. The retry v2 said "freestanding, open on all sides, directly on the ground", which fixed it.
- **herm-bust/main → rejected.** It came out as a fluted round column with the head embedded under an abacus slab. Retry v2 is a good head on a short block, with the head oversized relative to the shaft. That used up the one allowed retry, so I accepted v2 and normalized it so the head is life-size: the whole piece is 0.7 m tall. **Put it on a ~1.0 m square pillar to form a herm.** The head has generic Antonine-style curls and is not modelled on a specific person.
- **column-tuscan/main** had an Ionic volute capital. **column-tuscan/v2** was squat and fluted, with a round abacus decorated with egg-and-dart and beads. Both were rejected and not refined. Meshy consistently adds ornament to classical capitals, so the procedural Tuscan columns are the better choice.
- **seneca/v2** was refined for comparison and then rejected, for the reasons in the Seneca section.

## Credits per asset

| asset | credits | breakdown |
|---|---|---|
| stone-bench | 30 | preview 20 + refine 10 |
| seneca | 92 | 2 previews 40 + 2 refines 20 + rig 5 + 9 actions 27 |
| fountain | 50 | 2 previews 40 + refine 10 |
| amphora-planter (2 variants) | 60 | 2 × (20 + 10) |
| writing-table | 30 | 20 + 10 |
| herm-bust | 50 | 2 previews 40 + refine 10 |
| olive-tree | 30 | 20 + 10 |
| column-tuscan | 40 | 2 previews, nothing shipped |
| **total** | **382** | final balance 3738 |

## All paid tasks

| # | asset | operation | task id | credits |
|---|---|---|---|---|
| 1 | stone-bench | preview:main | `01a15434-ba49-7415-8e74-02e159ccba7c` | 20 |
| 2 | stone-bench | refine:main | `01a15436-1fb8-75bb-aa92-5c58e6a58f05` | 10 |
| 3 | seneca | preview:v1 | `01a15438-ae5b-71e0-b34f-9327b4c01a20` | 20 |
| 4 | seneca | preview:v2 | `01a15439-b2b8-731f-8a4e-72d609a5b3c4` | 20 |
| 5 | fountain | preview:main (rejected) | `01a1543b-53d5-7637-9a75-04b23fadcdb1` | 20 |
| 6 | seneca | refine:v1 | `01a1543c-05cc-76c5-aa87-a63add1661a9` | 10 |
| 7 | writing-table | preview:main | `01a1543c-1312-72f1-8b79-33f8a6500f3e` | 20 |
| 8 | fountain | preview:v2 | `01a1543c-6e4d-7022-a7b8-5ebcabb43a9a` | 20 |
| 9 | amphora-planter | preview:v1 | `01a1543c-d60f-7126-b6b8-b9de218445a7` | 20 |
| 10 | seneca | refine:v2 (rejected) | `01a1543d-138c-7537-9d73-7f37225e6379` | 10 |
| 11 | herm-bust | preview:main (rejected) | `01a1543d-78c3-75aa-b70a-3943aa85714f` | 20 |
| 12 | fountain | refine:v2 | `01a1543d-8d2c-701f-8608-ee7bf32c7a3d` | 10 |
| 13 | amphora-planter | preview:v2 | `01a1543d-d92b-7295-8ce7-f4f25d4e720d` | 20 |
| 14 | writing-table | refine:main | `01a1543d-e1c0-7673-b66e-be3e5c862a13` | 10 |
| 15 | olive-tree | preview:main | `01a1543e-34b9-754a-9779-af0a075f14a8` | 20 |
| 16 | amphora-planter | refine:v1 | `01a1543e-9721-71cb-8fcd-bac74e04af3c` | 10 |
| 17 | seneca | rig | `01a1543f-71e9-769a-842f-833841cd1e9e` | 5 |
| 18 | herm-bust | preview:v2 | `01a1543f-d51d-7762-9e3c-8915dba532e4` | 20 |
| 19 | amphora-planter | refine:v2 | `01a15440-dbb1-746e-a0c9-81874342644c` | 10 |
| 20 | seneca | animate:a1 (9 actions) | `01a15440-fd38-77c9-ad6c-18bc77aeccd1` | 27 |
| 21 | herm-bust | refine:v2 | `01a15441-5d48-73e6-9e8c-0d91f98fff3e` | 10 |
| 22 | olive-tree | refine:main | `01a15442-5b15-75e1-9ba2-290f070a851b` | 10 |
| 23 | column-tuscan | preview:main (rejected) | `01a15442-9192-70b1-89e7-d541ff80eb72` | 20 |
| 24 | column-tuscan | preview:v2 (rejected) | `01a15444-2f5f-74dc-8a07-8330c9c7a413` | 20 |

Every task SUCCEEDED, and `consumed_credits` equalled the expected cost each time. Meshy charges at task creation. `ledger.json` has the timestamps and balances.

## Optimization settings

**Props** (`scripts/assets/optimize-glb.mjs`) go through these steps in order:

1. `dedup`, `prune` and `weld` (exact match). Optional meshopt `simplify` runs if a model exceeds `max_triangles`; no model needed it, because the Meshy remesh already hits its target.
2. Normalize:
   1. wrap the scene in a root node named after the asset;
   2. apply an optional Y rotation;
   3. apply a uniform scale, from `target_size_m`: `height`, `longest_horizontal`, `x` or `z`;
   4. translate to the bottom centre;
   5. bake the transforms into the vertices.
3. Drop emissive maps that are near-black.
4. Convert textures to WebP with sharp, capped at 1024 px (character 2048 px): normal maps at quality 92, other maps at 85.
5. Apply `meshopt` (gltf-transform level `medium`: reorder + quantize + `EXT_meshopt_compression`).

**Character** (`scripts/assets/merge-character.mjs`):

- Start from the rigged GLB, with its pre-existing "clip0" removed.
- Copy every clip from the animation GLBs, retargeted **by bone name**. The script checks the skeletons first: all 24 joints were present, rest-pose translation differed by at most 2.6e-5, and rotation by at most 6.6e-8.
- Rename clips to the stable ids and apply the head-pitch correction.
- Strip root drift where requested (only applies if the drift is > 5 cm; no clip needed it) and measure walk speed from foot plants.
- Run `resample` (tolerance 1e-4), set saturation to 0.85, convert textures to WebP at 2048, and apply meshopt.

Raw downloads total about 242 MB and are kept locally; `assets-src/meshy/raw/` is in `.gitignore`. The shipped models total 7.3 MB.

## Known issues

- Seneca:
  - the hands have no finger bones;
  - the face geometry is coarse (the texture carries it);
  - the idle arms rest slightly away from the body;
  - a small tunic underside fold is visible between the knees;
  - with the head correction, the crown is at 1.74 m.
- The bench seat is about 0.6 m high. Its proportions are as generated once fitted to 1.9 m length, which is slightly tall for a seat.
- The writing table's open diptych overhangs the +Z edge a little, and there are two small decorative rings on the table.
- The fountain's basin floor is solid and recessed, at about y = 0.13 m, and the rim top is at y = 0.655 m. Put the game's water plane at about y = 0.58–0.60 m, with radius about 1.15 m. The small bowl and finial are solid.
- The herm is a bust on a block (0.7 m), not a full-height herm.
- The olive tree's foliage is opaque faceted geometry (24k tris). It reads as stylized and has no alpha cards.
- There is no Tuscan column.

## Licence and ownership

All models are AI-generated with Meshy under the project owner's account. Per Meshy's published terms, ownership depends on the plan:

- **Paid plans:** the subscriber owns the outputs, which are private and usable commercially.
- **Free plan:** outputs are public and licensed CC BY 4.0, with attribution to Meshy required.

The account's balance shows `monthly_credits: 3100`, which indicates a paid subscription. **Confirm the plan in the Meshy account settings before any public or commercial release.** The manifest marks every asset as `"license": "Meshy-generated (account owner)"`. The animation clips come from Meshy's preset library and are applied to our rig. The herm head is generic and not modelled on an identifiable person.

## Round 2: fruits, first-person hand, trees

Run date: 2026-10-19 (same day as round 1). This run spent **225 credits** against a run cap of 350. The project-wide ledger cap is now 732, which equals 382 already spent plus 350 for this run, out of the 1500 approved. The balance went from **3738 to 3513**. Ledger total: **607**, which matches 4120 − 3513 exactly, with no unsettled tasks.

### Results

| model (game file) | source | size w×h×d (m) | tris | file | verdict |
|---|---|---|---|---|---|
| `assets/models/mandarin-fruit.glb` | main | 0.069 × 0.069 × 0.064 (body Ø 6.5 cm, h 5.3 cm) | 3,000 | 110 KB | **Good** |
| `assets/models/citron-fruit.glb` | v2 (retry) | 0.090 × 0.162 × 0.082 (body 12.0 × 8.2 cm) | 2,999 | 112 KB | **Good** |
| `assets/models/hand-fp.glb` | v2 (retry), retextured, mirrored, curled | 0.123 × 0.081 × 0.210 | 8,000 | 329 KB | **Good, with fixes** (see the hand section) |
| `assets/models/olive-tree-lite.glb` | local sloppy simplify of `olive-tree` | 4.17 × 5.00 × 4.23 | 7,458 | 580 KB | **Good for instancing** (LOD quality). The Meshy remesh was rejected. |
| `assets/models/umbrella-pine.glb` | main, crown widened | 7.29 × 8.00 × 7.87 | 9,857 | 501 KB | **Acceptable (stylized)** |
| `assets/models/italian-cypress.glb` | main, one tree cropped | 1.32 × 10.00 × 1.31 | 2,241 | 316 KB | **Good (stylized)** |

All six files:

- passed `gltf-validator` with 0 errors (the only warning is the usual runtime-generated tangent space);
- use meshopt, quantization and WebP;
- have one mesh and one material;
- have a metallic channel at about 0 (mean ≤ 0.004).

Textures are 512 px for the fruits and 1024 px for everything else. The fruits and the hand have smooth, welded normals. The trees are flat-shaded and faceted, like `olive-tree`. I checked each accept/reject decision with the QA renderer, from the compressed file as shipped.

### Conventions (new in round 2)

- **Fruits** (`pivot: "center"`):
  - The origin is the **centre of the fruit body**. It comes from an area-weighted, axis-aligned ellipsoid fit with outlier rejection, so the stem and leaves are ignored. This is not the bounding-box centre.
  - The stem points **+Y**.
  - Scale is real, set from the fitted body. The mandarin body measures 6.5 cm wide, and the citron body 12 cm long.
  - The manifest adds `bodySize` (the ellipsoid diameters).
  - **Mandarin**: the stem tip is at y = +4.5 cm, and the two leaves lie along ±X.
  - **Citron**: the long axis is vertical. The stem tip is at y = +9.7 cm, the nipple at y = −6.5 cm, and the leaf lies against the +X side.
- **Hand** (`hand-fp`, `pivot: "grip-point"`): see the next section for its axes, grip point and fruit seats.

### The first-person hand (`hand-fp.glb`)

**Axes.** It is a right hand, with units in metres and a static mesh (no rig).

- The fingers point **−Z** (`forward: "-Z fingers"`).
- The palm normal is **+Y** (`up: "+Y palm normal"`). Measured on the back-of-hand surface, the metacarpal plane is within 2.3° of +Y in pitch and 4.5° in roll.
- The thumb is at **+X**.
- The wrist stub is at **+Z**.

**Size.**

- From the distal wrist crease to the middle fingertip, the hand measures 19 cm before the curl.
- The whole mesh is 0.21 m long after the curl, including a stub of about 5.5 cm past the wrist crease.
- The palm is about 8 cm wide.

**Grip and fruit placement.**

- **The origin is the grip point**: `gripPoint: [0,0,0]` is the palm surface directly under a fruit resting in the cupped hand.
- **The recommended `fruitRadius` is 0.035**. Any radius in `fruitRadiusRange` [0.030, 0.0375] is cradled.
- A sphere of that radius rests with its centre at **`fruitCenter: [0, 0.0394, 0]`**. The palm pads and the finger bases hold it, with about 4 mm of air under its lowest point, and the curled fingertips (top at y ≈ 0.047) reach above its equator.
- For a fruit of radius *r* in that range, put its centre at about `[0, r + 0.004, 0]`.

**Fruit seats** (`fruitSeats`). These come from dropping each real fruit body (as an ellipsoid) into the hand, and were checked visually with the actual GLBs:

| fruit | position | rotation (deg) | note |
|---|---|---|---|
| `mandarin-fruit` | [0.002, 0.031, −0.003] | [0, 0, 0] | upright |
| `citron-fruit` | [−0.014, 0.0553, 0.019] | [90, 0, 0] | lying along the fingers, stem toward the wrist |
| `citron-fruit`, upright alternative | [−0.001, 0.0644, 0.003] | [0, 0, 0] | (not in the manifest) |

**How the grip point was computed** (`node scripts/meshy/analyze-shape.mjs hand public/assets/models/hand-fp.glb --region x0,x1,z0,z1 [--radius R] [--apply hand-fp]`):

1. For each candidate radius R, a sphere is dropped over a 1 mm grid of the palm zone. Its rest height is max over vertices of (y + √(R² − d²)), where d is the horizontal distance to the vertex.
2. The lowest rest position is where the fruit settles.
3. The grip point is the palm surface under that position, found by a ray cast.
4. "Sits nicely" means three things: palm *and* finger contacts, no thumb contact, and the fingertips reach the sphere's equator.
5. By construction, the sphere never penetrates any mesh vertex.
6. `--ellipsoid ax,by,cz` gives the seat of a non-spherical fruit.

**Fixes applied.** In order:

1. **Retry v2.** Both previews (meshy-7.1 main and meshy-6 v2) came out as an upright hand with nearly straight fingers, so this is a Meshy prior and wording didn't change it. I picked **v2** for its anatomy: palm creases, nails, a clean wrist cut and closed fingers.
2. **Retexture (+10 credits).** The v2 refine (meshy-6, `remove_lighting`) produced a **near-black, glove-like albedo** (mean 40/255). I fixed it with `meshy.mjs retexture` (meshy-7, `enable_original_uv`), which gives warm tanned skin, a pinker palm and natural nails, on the same geometry and UVs. This is a texture repair of the accepted mesh, not a second geometry retry.
3. **Mirror.** Both previews were **left hands**: with the palm toward +Z and the fingers +Y, the thumb was at −X. Optimize therefore mirrors X (`mirror_x`; winding is fixed when baking), which is exact and free.
4. **Rotation.** `rotate_deg [-81,0,0]` makes the fingers point −Z and the palm face +Y. The 9° beyond 90 levels the metacarpal plane.
5. **Curl.** The finger curl is a **procedural bend** (`bend` in assets.json). It is a circular bend about the knuckle line (z = −0.03 in the pre-pivot frame) with curvature 13.5 /m, capped at 75°, and it fades out over the thumb (x 0.029 → 0.034) so the thumb stays relaxed. The fingertips end up about 70° up, which gives a gentle cradle.

**Integrator notes.**

- The **wrist cut is a closed cap with a dark-red albedo**, facing +Z (toward a first-person camera). Keep the stub off-screen: let it leave the frame at the bottom edge, or tilt the hand.
- The palm-side surface slopes down from the heel to the finger crease, which is natural. The local palm-surface normal at the grip point is 15° from +Y.
- Texture smoothing depends on the normal map. Meshy normals are smooth, with three.js-derived tangents as for the other props.

### Per-asset notes

- **mandarin-fruit / main.** Accepted on the first try: an oblate, dimpled deep-orange body, an olive-green stem and two glossy leaves. The stem is about 2 cm long, a little long for a mandarin. The preview remesh at a 3k target is clean once smooth-shaded. It was simplified from 3,112 to 3,000 tris.
- **citron-fruit.**
  - **main was rejected at preview**: the body was cucumber-thin (about 3.3:1) and the leaf floated detached beside the fruit.
  - **v2** asked for a "plump fat oval … only about 1.6 times longer than wide … leaf lying against the fruit". It came out as a knobbly lemon-yellow citron with a bottom nipple, an attached leaf and a woody stem.
  - At real scale (12 cm body length) it is 8.2 cm wide (1.46:1). The stem is about 3.5 cm long.
  - Citrus medica is historically plausible for 1st-century Campania, so this is the period-accurate choice. The mandarin is not period-accurate.
- **olive-tree-lite.**
  - **The Meshy remesh** (`remesh` of olive refine `01a15442…`, target 7,000, 5 credits) **was rejected**. It returned 5,661 tris with the **trunk and branches gone** and only scattered leaf fragments, and the bounds shrank to 1.25 units tall.
  - **Normal edge-collapse simplification also fails on this mesh.** Meshy's fragmented UV atlas plus flat normals give about 2.4 vertices per triangle, so every edge is a seam: gltf-transform `simplify` only got from 24.2k to 22.2k, and the `Permissive` and attribute-aware variants destroyed the trunk.
  - **meshopt `simplifySloppy`** (vertex clustering, `simplify_mode: "sloppy"`) keeps the silhouette, trunk and branches at 7,458 tris. Some foliage texels smear onto trunk triangles where clusters span UV islands. That is fine at instancing distance; use the full `olive-tree.glb` for hero trees by the path.
  - Size and pivot are identical to `olive-tree.glb` (5 m, bottom centre).
  - A colour-based bark/leaf split before clustering was tried and dropped, because the bark albedo is too green to classify.
- **umbrella-pine.**
  - **main** has the iconic stone-pine silhouette (a bare trunk under a flat parasol crown), but its crown was only about half as wide as the tree is tall.
  - **v2** (retry, "as wide as the tree is tall") was wide but read as a generic layered conifer or broadleaf, so it was **rejected at preview**.
  - I refined main and widened only the crown in post: `stretch_xz` ×1.8 in XZ, ramped between y = 5.6 and 6.4 m, so the trunk is untouched. The crown is now 7.3–7.9 m wide at 6–8 m height.
  - Honest verdict: a recognisable, stylized parasol pine and better than a primitive tree. The crown is thin and flat, which reads a bit acacia-like, and the trunk is unbranched. Mark it **Acceptable**.
- **italian-cypress.**
  - The preview came out as a **group of three**: two columnar cypresses (about 7.5:1) and a spindly sapling.
  - Instead of paying for a retry, I refined it once and kept **one cypress** (the left tree, `crop_box`), at 2,241 tris against the ≤ 6k target.
  - The base colour was darkened (`albedo_adjust`: brightness 0.72, saturation 0.9) so that it reads as the very dark green of *Cupressus sempervirens*.
  - It is a convincing flame-shaped column at 1.3 × 10 m.

### Prompts (round 2)

All prompts are the shared `art_direction.prompt_preamble` followed by the subject. All texture prompts are the subject's texture text followed by `art_direction.texture_preamble`, unchanged from round 1. Settings: meshy-7.1, triangle topology, `should_remesh`, PBR 2K refine. The hand's v2 used meshy-6. Polycount targets: 3k for the fruits, 8k for the hand, 10k for the pine and 6k for the cypress. The full prompts as sent are in `assets.json → attempts.<v>.prompt / texture_prompt`.

- **mandarin-fruit / main**: *"One single ripe mandarin orange fruit (Citrus reticulata) on its own, about 6.5 cm across, a slightly flattened sphere wider than tall, with a finely dimpled glossy deep-orange peel. On top a short green stem with two small glossy dark-green pointed citrus leaves attached. Stem on top pointing straight up. Isolated object, no plate, no base, no ground."*
  - Texture: *"Glossy deep-orange mandarin peel with fine dimpled pores and subtle colour variation, short olive-green stem, glossy dark-green citrus leaves with lighter veins."*
- **citron-fruit / v2**: *"One single large citron fruit (Citrus medica) on its own: a plump fat oval lemon shape about 12 cm long and 7.5 cm wide, only about 1.6 times longer than wide, with a thick, bumpy, knobbly, wrinkled lemon-yellow rind and a small pointed nipple at the bottom tip. At the top end a short woody green stem with one glossy dark-green citrus leaf growing from the stem and lying against the fruit. Long axis vertical, stem on top. …"*
  - main used the same idea with "about 12 cm long and 7 cm wide, an elongated oval lemon-like shape".
- **hand-fp / v2** (meshy-6): *"A single realistic adult man's right hand only, held horizontally palm up and cupped like a shallow bowl, as if scooping water: fingers together and curved upward at every joint so the fingertips rise, thumb relaxed and slightly raised at the side. Cut cleanly a few centimetres past the wrist, about 19 cm long, no arm. Natural anatomy, five distinct fingers, visible knuckles, short clean fingernails. Bare skin only."*
  - main (meshy-7.1) asked for an "empty relaxed cupped hand: palm facing up, the four fingers gently curved upward forming a shallow bowl".
  - Retexture prompt (meshy-7, original UVs): *"Realistic adult male hand with bare natural skin: warm light olive-tanned Mediterranean skin tone with natural subtle tone variation, slightly pinker palm, palm creases, knuckles and fingertips, short clean pale-pink natural fingernails, fine realistic skin detail."*
  - The prompts avoid naming the fruit, so Meshy would not fuse one into the hand.
- **umbrella-pine / main**: *"Italian stone pine tree (Pinus pinea) about 8 m tall: a straight, slightly leaning bare trunk with grey-brown plated bark, forking high up into a few upward-spreading limbs that carry one broad, dense, flat-topped umbrella-shaped canopy about 8 m wide, like a wide green parasol, made of game-friendly stylized clumps of dark green needles. Standing on a small flat patch of dry earth."*
  - v2 (rejected) added "as wide as the tree is tall … limbs that spread outward like the ribs of an open parasol".
- **italian-cypress / main**: *"Tall slender Italian cypress tree (Cupressus sempervirens 'Stricta') about 10 m tall and only about 1.6 m wide: one narrow, dense, columnar flame-shaped crown of dark green foliage from near the ground up to a pointed top, made of game-friendly stylized vertical foliage clumps, a short straight trunk just visible at the base. Standing on a small flat patch of dry earth."*

### Paid tasks (round 2)

| # | asset | operation | task id | credits |
|---|---|---|---|---|
| 25 | mandarin-fruit | preview:main | `01a15484-3ff3-7709-8ab5-e7e49f6b10b2` | 20 |
| 26 | citron-fruit | preview:main (rejected) | `01a15484-583a-75ab-9b76-55fc098de177` | 20 |
| 27 | hand-fp | preview:main (not used) | `01a15484-7015-7074-8f59-1203676d09c3` | 20 |
| 28 | mandarin-fruit | refine:main | `01a15486-914a-7515-ab3a-affd45f4f19a` | 10 |
| 29 | citron-fruit | preview:v2 | `01a15486-a634-736a-9664-db63e65c8682` | 20 |
| 30 | hand-fp | preview:v2 | `01a15486-bdf1-723d-b52e-2795fce76d5f` | 20 |
| 31 | olive-tree-lite | remesh (rejected) | `01a15486-e560-7789-aec5-451d164e7721` | 5 |
| 32 | umbrella-pine | preview:main | `01a15488-85a6-7173-84c6-456b46e6b3cc` | 20 |
| 33 | italian-cypress | preview:main | `01a15488-9c30-74b4-a776-525552b65bd1` | 20 |
| 34 | citron-fruit | refine:v2 | `01a15489-2b25-7329-86ce-b9c6c24c2315` | 10 |
| 35 | hand-fp | refine:v2 (texture unusable) | `01a15489-3f89-7507-9f17-79e44fd3a473` | 10 |
| 36 | italian-cypress | refine:main | `01a1548d-71ad-770f-be32-bc55356ff176` | 10 |
| 37 | umbrella-pine | preview:v2 (rejected) | `01a1548d-87ce-778b-98c5-014d9214ce60` | 20 |
| 38 | hand-fp | retexture:v2 | `01a1548d-cc2c-73d1-949b-1dbaf4c0afad` | 10 |
| 39 | umbrella-pine | refine:main | `01a15494-bdf0-75f6-b47f-a47f15190d4c` | 10 |

Every task SUCCEEDED, and `consumed_credits` equalled the expected cost each time.

| asset | credits | breakdown |
|---|---|---|
| mandarin-fruit | 30 | preview 20 + refine 10 |
| citron-fruit | 50 | 2 previews 40 + refine 10 |
| hand-fp | 60 | 2 previews 40 + refine 10 + retexture 10 |
| olive-tree-lite | 5 | remesh 5 (rejected; the shipped file is a free local simplify) |
| umbrella-pine | 50 | 2 previews 40 + refine 10 |
| italian-cypress | 30 | preview 20 + refine 10 |
| **total** | **225** | run cap 350; project total 607 / 732 cap (1500 approved); balance 3513 |

### Pipeline additions (round 2)

**Budget guard.** `ledger.json` now has `runs[]` and `current_run`. Every paid call:

- prints the project total and the run total (for example `run round2: 205 -> 215/350`);
- refuses if either cap would be exceeded;
- tags its ledger entry with `run`.

`meshy:balance` prints the run status.

**New `meshy.mjs` commands:**

- `remesh <asset>`, configured by `assets.json → <asset>.remesh` (source task or asset, topology, target), with output in `raw/<asset>/remesh/`;
- `retexture <asset> [--variant v]`, which re-textures the variant's refine with `enable_original_uv`, configured by `<asset>.retexture` (prompt, model), with output in `raw/<asset>/<v>/retexture/`.

Both reuse the resumable `runStep` and ledger logic.

**New `scripts/meshy/analyze-shape.mjs`** (free, local):

- `fruit <glb> --diameter m | --length m --apply id` fits the fruit-body ellipsoid and writes the scale and `pivot_offset`;
- `hand <glb> … --apply id` runs the grip-point and fruit-radius analysis described in the hand section.

**New `optimize-glb.mjs` settings in `assets.json`** (the defaults are unchanged for round-1 assets):

| setting | effect |
|---|---|
| `rotate_deg [x,y,z]` / `rotation_quat` | arbitrary orientation (Euler XYZ) |
| `mirror_x` | mirror across X |
| `pivot: "center"` | bounding-box centre pivot |
| `pivot_offset` | a measured point becomes the origin; applied after any deformation |
| `target_size_m.fit: "scale"` | explicit scale factor |
| `crop_box` | keep only the triangles inside a raw-space box |
| `simplify_mode: "sloppy"` | `simplifySloppy` for seam-heavy meshes; normals are recomputed flat |
| `bend` | circular bend with an X fade mask; used for the finger curl |
| `stretch_xz` | height-ramped horizontal stretch; used for the crown |
| `albedo_adjust` | base-colour brightness and saturation |
| `input_from: "retexture"` | use the retextured GLB as input |
| `source_glb` | input path for assets without attempts |
| `pivot_label`, `up`, `manifest_extra` | extra manifest fields, such as the hand's grip data |

**Re-running.** `npm run assets:optimize -- mandarin-fruit citron-fruit hand-fp olive-tree-lite umbrella-pine italian-cypress` reproduces all six files from the raw downloads, deterministically and for free.

### Known issues (round 2)

- **hand-fp**:
  - The curl is procedural (one smooth arc from the knuckles), not true per-joint flexion. It reads as a gentle cradle at first-person distance.
  - The wrist cap is visible if the stub is on screen.
  - The roll is about 4.5° (it was not corrected).
  - The palm albedo is fairly pink.
- **mandarin-fruit**: the stem is slightly long; the leaves stick out about 3.6 cm along ±X. Yaw it freely in the hand if a leaf clips the thumb.
- **citron-fruit**: the stem is about 3.5 cm long, and it is a big fruit for the hand (12 cm). The lying seat sits about 1.4 cm above the palm because the fruit bridges the fingers and the palm heel.
- **olive-tree-lite**: some texture smearing on the trunk and flat-shaded facets. It is meant for mid and far instancing.
- **umbrella-pine**: the crown is thin and flat (a little acacia-like), the trunk is unbranched, and the leaf clumps are stretched horizontally by the crown widening.
- **italian-cypress**: low poly (2.2k). The atlas is shared with the two discarded trees, so the effective texel density is lower.

## Round 3: world fill

Run date: 2026-10-19 (same day). This run spent **720 credits** against a run cap of **780** (ledger run `round3`). The balance went from **3459 to 2739**, and the ledger total is **1381**, which equals 4120 − 2739 exactly: round 1 382 + round 2 225 + concept art 54 + round 3 720. All 45 round-3 tasks SUCCEEDED and `consumed_credits` equalled the expected cost every time. 60 credits of the run cap were left unused, plus 119 below the 1500 approved.

Visual reference: `docs/concept/*.png`. Where the concepts drift from the brief, I followed the brief: c01 has a Viking-like ship, c03/c06 have straw skeps, and c04 has a clepsydra with a clock face.

### Results

| model (`public/assets/models/…`) | source | size w×h×d (m) | tris | file | verdict |
|---|---|---|---|---|---|
| `exedra-bench.glb` | **kitbash** of round-1 `stone-bench` parts | 5.30 × 0.84 × 2.65 | 14,999 | 436 KB | **Good (kitbash)**. Both Meshy attempts were rejected. |
| `statue-muse.glb` | main | 0.45 × 1.75 × 0.38 | 14,126 | 675 KB | **Good** |
| `statue-youth.glb` | main, albedo fix | 0.47 × 1.75 × 0.38 | 14,313 | 546 KB | **Acceptable**: the cloak is only a small bunch on the shoulder |
| `fishing-boat.glb` | main | 2.75 × 3.23 × 6.00 | 13,439 | 779 KB | **Acceptable**: square sail, not lateen |
| `merchant-ship.glb` | main + kitbash (mizzen moved to the bow as an artemon) | 8.11 × 12.95 × 18.00 | 13,752 | 819 KB | **Good (kitbash fix)** |
| `eros-sleeping.glb` | v2 (retry) | 0.90 × 0.55 × 0.49 | 10,397 | 423 KB | **Good** |
| `cat-sleeping.glb` | main | 0.45 × 0.23 × 0.41 | 4,999 | 194 KB | **Good** |
| `citron-basket.glb` | main | 0.45 × 0.33 × 0.41 | 3,947 | 230 KB | **Acceptable**: faceted low-poly fruit |
| `oscillum.glb` | main + kitbash (relief flattened and mirrored) | 0.42 × 0.43 × 0.06 | 6,568 | 277 KB | **Acceptable (kitbash fix)**: over the 5k budget |
| `aedicula.glb` | v2 (retry) | 0.44 × 0.80 × 0.42 | 7,086 | 548 KB | **Acceptable**: upper shrine only, needs a ~0.92 m pillar |
| `dovecote.glb` | main | 2.32 × 4.50 × 2.32 | 10,092 | 723 KB | **Good** |
| `beehives-roman.glb` | main | 1.60 × 0.54 × 0.41 | 8,287 | 518 KB | **Good** |
| `goat.glb` | main | 0.32 × 0.78 × 1.00 | 8,353 | 643 KB | **Acceptable**: slender, with a long bushy tail |
| `amphora.glb` | main | 0.43 × 1.10 × 0.43 | 5,000 | 247 KB | **Good**: ovoid body, closer to Dressel 1 |
| `wooden-bench.glb` | main, depth ×0.5 | 1.60 × 0.47 × 0.40 | 3,493 | 377 KB | **Good** |
| `clepsydra.glb` | main | 0.48 × 0.30 × 0.55 | 4,999 | 226 KB | **Acceptable**: a basin on paw feet, two spouts |
| `oil-lamp.glb` | **procedural** (`scripts/meshy/procedural.mjs`) | 0.09 × 0.06 × 0.18 | 4,728 | 38 KB | **Good (procedural fallback)**. Both Meshy attempts were rejected. |
| `wicker-chair.glb` | v2 (retry), footprint ×0.75 | 0.69 × 0.90 × 0.65 | 4,987 | 312 KB | **Acceptable**: openwork back made of thin strands |
| `jug-cup.glb` | main | 0.49 × 0.30 × 0.24 | 4,179 | 143 KB | **Good** |

All 19 files:

- passed `gltf-validator` with 0 errors (the only warning is the usual runtime tangent space; the lamp has no normal map and no warning);
- have one mesh and one material each;
- use meshopt + quantization + WebP.

Textures are capped at 1024 px, and at 512 px for the small items (cat, basket, oscillum, clepsydra, jug-cup); the lamp uses 256 px. The shipped round-3 models total **8.0 MB**. Every accept/reject decision was made on QA renders: the preview thumbnail, orthographic geometry views, textured views of the refine and, at the end, views rendered from the compressed file as shipped.

### Integration notes (round 3)

Same conventions as before: metres, +Z forward, and pivot at the **bottom centre** of the bounding box, except where noted. Every Meshy material is double-sided (Meshy's default; the sails and wicker need it).

| model | pivot / special points |
|---|---|
| `exedra-bench` | Bottom centre. Exact 180° arc opening toward +Z. **Arc centre at (0, 0, +1.325)**, and the chord between the two ends lies on z = +1.325. Seat front (inner) radius 2.10 m, seat top y = 0.46 m, seat depth 0.43 m. The back wall/backrest is 0.12 m thick, its top at y = 0.84 m, outer radius 2.65 m. 5 lion-head supports. The manifest has `arcCenter`, `innerRadius`, `outerRadius`, `seatHeight` and `backTop`. |
| `fishing-boat` | **Waterline centre**: y = 0 is the waterline, the keel is at −0.38 m, the gunwale is at about +0.57 m amidships and the masthead at +2.85 m. Bow (mast end) +Z. The 2.75 m width includes the two oars hanging outboard. |
| `merchant-ship` | **Waterline centre**: y = 0 is the waterline (laden), the keel is at −1.0 m, the sheer is at about +1.35 m amidships and the masthead at +11.95 m. The bow, with the artemon, is at +Z; the swan-neck stern at −Z. The 8.1 m width is the main yard; the hull beam is about 5.5 m. |
| `oscillum` | **Pivot exception: the origin is the hang point** (top of the bronze ring). The disc hangs below, its centre at about (0, −0.224, 0). The disc lies in the XY plane, Ø 0.42 m and 3 cm thick, with relief on both faces (6.3 cm overall). Hang it from a string to the beam at the origin. |
| `oil-lamp` | Bottom centre, nozzle +Z. **Flame point (0, 0.036, 0.075)**, just above the wick hole at (0, 0.031, 0.075). The filling hole is at (0, 0.017, −0.013). Manifest: `flamePoint`, `wickHole`. |
| `aedicula` | Bottom centre, niche opening +Z. The niche floor is at y = 0.081 m. **Put it on a plain plastered pillar about 0.92 m tall, at least 0.48 × 0.45 m** (a procedural box with the cream plaster texture). That puts the niche floor at about 1.0 m and the total height at about 1.72 m. The niche is about 0.20 m wide and 0.40 m tall and empty, for the lamp and flowers. The lamp is 18 cm long, so set it with the nozzle facing out (+Z). |
| `clepsydra` | Bottom centre. The outflow **spout tip is at about (0, 0.19, 0.265)**, facing +Z: start the drip there into a basin below. The rim is at y = 0.30 m, Ø 0.49 m. There is a second rosette spout at −Z. No dial. |
| `statue-muse` / `statue-youth` | Bottom centre, face +Z. Each has an integral plinth: the muse's top (feet) is at 0.075 m and 0.29 × 0.36 m; the youth's is stepped, top at 0.155 m and 0.41 × 0.38 m. Neither has a pedestal: stand them on the game's pedestals. |
| `wicker-chair` | Front +Z. The cushion top (seat) is at y = 0.44 m. |
| `wooden-bench` | Long along X; the seat top is at y ≈ 0.465 m. |
| `amphora` | The toe tip is at y = 0. It cannot stand: lean it, sink the toe into the ground, or use a ring stand. |
| `jug-cup` | One mesh: the jug at +X (handle toward +X) and the cup at −X. |
| others | `eros-sleeping` faces +Z with the figure along X. `cat-sleeping` has its head toward +Z. `goat` has its head toward +Z. `dovecote` has its door at +Z. `beehives-roman` has its hive entrances at +Z. `citron-basket` is radially symmetric. |

### Per-asset notes (round 3)

- **exedra-bench (kitbash).**
  - Meshy attempts:
    - **main was rejected**: a D-shaped half-moon *table top* on two lion supports, not a curved bench.
    - **v2 was rejected**: I asked for a straight bench to bend, but it came out as a slab on two whole standing-lion statues, with no backrest.
  - The exedra was then built locally and for free (`node scripts/meshy/kitbash.mjs exedra-bench`) from the round-1 `stone-bench` refine. That bench has a slab and lion-head trapezophoros supports with paws, which is also the style of the terrace bench, so the two match.
  - The seat is assembled from exact clips of the slab: 2 end pieces with closed end faces and 7 middle sections. Alternate sections are mirrored, which breaks up texture repetition and leaves joints where real blocks would meet.
  - The same strip is turned upright as the back wall and backrest. The strip is tessellated along X (25 cm) and bent around a vertical axis through 180°, preserving arc length on the seat centreline (R = 2.315 m).
  - The 5 supports are pre-simplified copies (about 2.1k tris each) at uniform scale 0.749 (seat 0.46 m). They are placed rigidly, not bent, and turned to face the arc centre.
  - The user's fallback (one instanced 1.3 m segment) was not needed. One mesh covers the whole semicircle and keeps lion supports only where they belong.
- **statue-muse.** Accepted at first try: a draped chiton and himation, a calm idealised face, hair in a knot, contrapposto. It is a generic figure, not a portrait.
- **statue-youth.**
  - Accepted at first try: an athletic youth in contrapposto. The tunic came out as a short hip wrap, and the chlamys is only a small bunch of cloth on the left shoulder.
  - Meshy painted the drapery ochre, as if it were real cloth. The new `albedo_adjust.max_saturation: 0.25` setting clamps only the strongly coloured texels and pulls their brightness halfway to the marble median, so it now reads as marble.
- **fishing-boat.**
  - **main** has a double-ended plank hull with blue/ochre strakes, an upswept stem and sternpost, a net and a basket. It has a **square** sail on a yard, and its oars hang outboard.
  - **v2** asked explicitly for a "TRIANGULAR lateen sail … long diagonal yard". It was **rejected**: it was still square-rigged, with curled Viking-like ends and oars sticking out.
  - I shipped main. A square sail is historically fine for a 1st-century boat (lateen rigs are attested in the Roman Mediterranean, but mostly later), but it does not match the brief or concept c01.
- **merchant-ship.**
  - **main** has a deep rounded cargo hull with a swan-neck stern, a deckhouse, a big square red-ochre mainsail set slightly forward of midships, and a *second, aft* mast with a smaller braced square sail. It has no artemon.
  - **v2** was **rejected**: three masts and Viking-style curled posts.
  - Kitbash fix (free): the aft-mast assembly is cut out, selected by an X window plus the mast column, with rope slivers handled separately (97 dangling stubs dropped). It is scaled ×0.6, raked 35° forward and stepped at the bow as the **artemon**.
  - The result has the corbita rig the brief asks for, no oars and no Viking look. There is a row of small round ports (decorative) along the sheer.
- **eros-sleeping.** **main was rejected**: it had two putti (a second winged head). **v2** ("one single … infant alone … a single figure on a single rock") is one sleeping winged infant on a rock, in weathered marble with ochre lichen.
- **cat-sleeping.** Accepted first try: a realistic tabby with mackerel stripes, curled, with the tail around it.
- **citron-basket.** Accepted first try: a willow basket with a handle, heaped with knobbly yellow citrons. At the 5k budget each fruit is a faceted polyhedron, so the silhouette is low-poly. Smooth normals and the texture carry it at stylobate distance.
- **oscillum (kitbash fix).**
  - **main** was a thin disc with a ring and two tragic masks. They came out as full heads protruding about 14 cm on one face only, with a plain back.
  - **v2** was **rejected**: a coin-like disc with pseudo-lettering around the rim.
  - Fix (`kitbash.mjs oscillum`):
    - relief depth ×0.11 (about 1.5 cm), pulled 8% toward the centre so it stays inside the rim;
    - disc thickened ×2.2 (to 3 cm);
    - relief mirrored onto the back face;
    - ring re-centred on the disc plane so it hangs plumb.
  - It ships at 6.6k tris, which is **over the 5k small-item budget**. Meshy's fragmented atlas leaves almost every edge on a UV seam. The only way under 5k was meshopt `Permissive` collapses, which I tested and which visibly garbled the mask textures.
- **aedicula.**
  - **main**: a temple-front tabernacle with its niche starting at ground level.
  - **v2** ("pillar 1 m tall … shrine box on top") made the same type again, but with an arched niche and a tiled pediment, so v2 was selected.
  - It ships as the **upper shrine at 0.80 m**, to sit on a 0.92 m procedural pillar (see the integration notes).
- **dovecote.** Accepted first try: a plastered tower with a grid of square nesting holes, a door and a conical tiled roof with a finial.
- **beehives-roman.** Accepted first try: four horizontal clay-plastered wicker hives with entrance discs, on a dry-stone shelf with a top slab. They are not skeps. The hives are a little barrel-shaped rather than long tubes.
- **goat.** Accepted first try: brown and white, with backswept horns, its head lowered as if grazing. The legs are slender and the tail is too long and bushy for a goat. Fine at walk distance.
- **amphora.** Accepted first try: plain terracotta, long neck, vertical handles, a toe. The body is ovoid and the handles are single, not bifid, so it is closer to a Dressel 1 than to a sharp-shouldered Dressel 2–4. It is still a period-correct Roman transport amphora.
- **wooden-bench.** Accepted first try: a plank on two trestle frames. Meshy made it 0.8 m deep, so the new `post_scale: [1, 1, 0.5]` setting brings it to 0.40 m.
- **clepsydra.**
  - Accepted first try: a bronze basin with engraved level rings inside and a spout with a rosette, on three lion-paw feet. There is no dial.
  - It is wide and shallow, so I scaled it by footprint (0.55 m including the spouts, height 0.30 m) rather than to a 0.45 m height, which would have made a 0.8 m cauldron.
  - The feet act as the "three-legged stand". The spout is at mid-height rather than near the base.
- **oil-lamp (procedural).**
  - **main** (a teapot or genie lamp with a lid and leaf finial) and **v2** (a lidded tureen with a pipe spout) were both **rejected**. With the one retry used, the lamp was built for free by `node scripts/meshy/procedural.mjs oil-lamp`.
  - It is a closed round body with a sunken discus and a filling hole, a rounded nozzle with a wick hole, a ring handle and a leaf thumb-rest.
  - Its bronze base colour, metallic (0.65) and roughness (0.36) are sampled from the clepsydra's Meshy texture, with about 15% patina mottling, so it matches the other bronzes. The wick and filling holes map to a soot-black strip of the texture.
- **wicker-chair.**
  - **main** was refined and then judged crude: a lumpy faceted shell with a ragged lower edge.
  - **v2** ("as seen on Roman reliefs … drum base … rolled rim") has the Roman tub-chair silhouette and an openwork back of thin strands; 15% of its edges are open (single sheets), so its material must stay double-sided. It was selected.
  - Footprint scaled ×0.75 to 0.69 × 0.65 m; the seat stays at 0.44 m.
- **jug-cup.** Accepted first try: a round-bellied jug with a handle and a small footed cup in one mesh. The jug mouth is round, not trefoil.

### Prompts (round 3)

Settings as before: meshy-7.1, triangle topology, `should_remesh`, PBR 2K refine. The polycount targets were 14k for the big statues and ships, 10k for the eros and dovecote, 8k for the aedicula, beehives, goat and chair, and 3–5k for the small items.

New this round are **preamble overrides** (`assets.json → art_direction.preambles`, selected per asset or variant with `prompt_preamble` / `texture_preamble`):

- `ship`: "…Ancient Roman, mid-1st century AD, Bay of Naples…", with no villa;
- `animal`: realistic anatomy, with no Roman setting;
- `animal_texture` and `bronze_texture`.

Full prompts as sent are in `assets.json → attempts.<v>.prompt / texture_prompt`. Key subject wording:

- **exedra main**: "semicircular marble exedra bench (schola): one continuous curved stone seat bent into an exact half circle, 5.4 m across … low solid curved backrest … lion-leg support with a lion paw … From above it is a C shape." **v2**: "Very long straight Roman marble bench, 6 m long … low solid backrest slab … lion-leg support…".
- **statue-muse**: "Life-size marble statue of a standing draped woman, a generic classical muse, not a portrait: a long belted chiton … himation … Relaxed contrapposto, feet on a very thin flat marble plinth. No pedestal, complete arms and head."
- **statue-youth**: "…a generic classical youth, not a portrait … short belted tunic to mid-thigh and a short cloak (chlamys) pinned at the right shoulder…".
- **fishing-boat main**: "Small ancient Roman wooden fishing boat, 6 m long … a single triangular lateen sail … on a long slanted yard. Two wooden oars lying along the inside of the hull, a coiled brown fishing net…". **v2** stressed "a single large TRIANGULAR lateen sail … very long diagonal yard … Two wooden oars lying flat inside the boat".
- **merchant-ship main**: "…corbita, 18 m long: a deep, broad, rounded wooden cargo hull … One tall mast amidships with one large square red-ochre sail … a small forward-raked bow mast (artemon) … sternpost curves up and back into a carved swan neck…". **v2**: "Exactly in the middle of the ship one tall mast … At the bow a short mast leaning steeply forward over the bow like a bowsprit…".
- **eros v2**: "…one single sleeping winged Eros: one chubby infant boy alone, with two small feathered wings folded behind his back, sprawled asleep on his back on a rough rock … A single figure on a single rock…".
- **cat**: "A realistic domestic tabby cat curled up asleep in a tight round ball … tail wrapped around its body up to its nose. About 45 cm across."
- **citron-basket**: "Round shallow wicker basket woven of brown willow rods … heaped full above the rim with large knobbly yellow citron fruits…".
- **oscillum main**: "…a round flat marble disc 42 cm in diameter and only 3 cm thick … Each face is carved in low relief with a theatre mask … A small bronze ring for hanging is fixed at the top edge." **v2** stressed "one single theatre mask … very shallow low relief, almost flat…".
- **aedicula v2**: "…made of two parts stacked: below, a plain solid rectangular plastered stone pillar 1 m tall … on top of that pillar a small shrine box 0.6 m tall with an empty round-arched niche…".
- **dovecote**: "Ancient Roman dovecote tower (columbarium): a round cylindrical tower of rough stone and lime plaster, 4.5 m tall … rows of small square nesting holes … conical roof of overlapping terracotta tiles…".
- **beehives-roman**: "Ancient Roman horizontal beehives: four long tube-shaped hives of woven wicker plastered with clay … lying on their sides parallel … on a low rustic dry-stone shelf 1.6 m long…". The word "skep" was deliberately avoided.
- **goat**: "A domestic goat standing on all four legs, about 1 m long … short backward-curved horns, small chin beard … head lowered toward the ground as if grazing. Patchy coat of warm brown and white."
- **amphora**: "Ancient Roman transport amphora of Dressel 2-4 type, 1.1 m tall … long solid pointed foot spike, a sharp angular shoulder … two long vertical handles made of two joined rods (bifid handles)…".
- **wooden-bench**: "Rustic ancient Roman wooden garden bench, 1.6 m long, 0.45 m high and 0.4 m deep: one thick hand-hewn plank seat on four sturdy slightly splayed square legs…".
- **clepsydra**: "Ancient Roman bronze outflow water vessel: a deep bronze basin shaped like a wide bucket … on a small bronze three-legged stand with animal-paw feet … a small bronze spout with a tap … near the bottom … Thin horizontal level lines are engraved around the inner wall. A plain functional vessel." The words "clock" and "dial" were deliberately not used.
- **oil-lamp main**: "Ancient Roman bronze oil lamp (lucerna), 18 cm long, standing flat: a closed round shallow body with a small filling hole … a long rounded nozzle … ring handle at the back…". **v2**: "…only 5 cm tall, low and flat like a slipper … Low and flat, no neck, no lid." Both came back as teapot/tureen shapes, so this looks like a strong Meshy prior.
- **wicker-chair v2**: "Ancient Roman wicker armchair as seen on Roman reliefs: a round tub-shaped chair woven from willow. Its tall curved back is a smooth half cylinder … continues straight down to the floor as a solid woven drum base … thick rolled rim … plump round cushion…".
- **jug-cup**: "A simple ancient Roman terracotta jug, 30 cm tall, with a round belly, a narrow neck, a pinched three-lobed pouring mouth and one curved strap handle, standing … next to a small plain terracotta drinking cup 9 cm tall…".

### Paid tasks (round 3)

Numbering continues from round 2. The 6 concept-art images (54 credits, ledger run `concept`) are listed in `docs/concept/prompts.json`.

| # | asset | operation | task id | credits |
|---|---|---|---|---|
| 40 | exedra-bench | preview:main (rejected) | `01a154b0-2b05-738c-9e91-e6f630a5af57` | 20 |
| 41 | statue-muse | preview:main | `01a154b0-3af3-75b4-8859-e81268ca6619` | 20 |
| 42 | statue-youth | preview:main | `01a154b0-4a6b-76f1-a385-99c328ff385e` | 20 |
| 43 | fishing-boat | preview:main | `01a154b0-59f9-7270-98f7-79dbfd4790c6` | 20 |
| 44 | merchant-ship | preview:main | `01a154b0-69ad-71bf-b220-c984456b7981` | 20 |
| 45 | eros-sleeping | preview:main (rejected) | `01a154b0-79a7-7788-848c-9b838add439a` | 20 |
| 46 | cat-sleeping | preview:main | `01a154b0-8932-7656-bb24-2857202012cc` | 20 |
| 47 | citron-basket | preview:main | `01a154b0-9a49-7249-8728-72c9fad3c0df` | 20 |
| 48 | oscillum | preview:main | `01a154b0-a8cb-709e-a341-f67fcca9a205` | 20 |
| 49 | statue-muse | refine:main | `01a154b6-de9c-7666-b05e-d8e4cb381df0` | 10 |
| 50 | statue-youth | refine:main | `01a154b6-f18a-7191-a296-efba4c5c74e2` | 10 |
| 51 | cat-sleeping | refine:main | `01a154b7-060c-7273-8e3b-aa193dfc739a` | 10 |
| 52 | citron-basket | refine:main | `01a154b7-190c-723b-854d-d40a071d2727` | 10 |
| 53 | exedra-bench | preview:v2 (rejected) | `01a154b7-2c3a-707b-836b-701ec22a062f` | 20 |
| 54 | fishing-boat | preview:v2 (rejected) | `01a154b7-3eef-74b3-aaa9-abaebb6ed004` | 20 |
| 55 | merchant-ship | preview:v2 (rejected) | `01a154b7-5294-701b-b095-3c8cea845301` | 20 |
| 56 | eros-sleeping | preview:v2 | `01a154b7-695d-735d-9a68-904cb3becc1e` | 20 |
| 57 | oscillum | preview:v2 (rejected) | `01a154b7-7993-706b-93a0-b155968ee150` | 20 |
| 58 | aedicula | preview:main (rejected) | `01a154b7-8d83-7472-b800-016d353de770` | 20 |
| 59 | dovecote | preview:main | `01a154b7-a276-72fe-80e2-78049fed8998` | 20 |
| 60 | beehives-roman | preview:main | `01a154b7-b4cc-72e5-8699-81af03727c1e` | 20 |
| 61 | goat | preview:main | `01a154b7-c83b-72c3-8c72-21cf4ca27089` | 20 |
| 62 | amphora | preview:main | `01a154b7-dc3e-7524-8ef6-e4dde06a28d3` | 20 |
| 63 | wooden-bench | preview:main | `01a154b7-ef5d-71f9-b67f-672dd064b280` | 20 |
| 64 | clepsydra | preview:main | `01a154b8-030b-70b9-bb18-8572870ba71a` | 20 |
| 65 | oil-lamp | preview:main (rejected) | `01a154b8-1686-7783-9776-42dee671f0a8` | 20 |
| 66 | wicker-chair | preview:main | `01a154b8-2a37-7056-9ca6-8666179a2cae` | 20 |
| 67 | jug-cup | preview:main | `01a154b8-3d9e-741a-86e0-24fc9e26356b` | 20 |
| 68 | fishing-boat | refine:main | `01a154c0-c6ea-7541-b68c-5a7069d3b394` | 10 |
| 69 | merchant-ship | refine:main | `01a154c0-da26-76ef-9541-45edad2eb901` | 10 |
| 70 | oscillum | refine:main | `01a154c0-edec-72b2-8801-61aa712f83ac` | 10 |
| 71 | dovecote | refine:main | `01a154c1-0165-72a8-84cd-f09958262674` | 10 |
| 72 | beehives-roman | refine:main | `01a154c1-1492-70e1-8d5c-6235529beab2` | 10 |
| 73 | goat | refine:main | `01a154c1-282f-75fc-b33e-85f96eb11883` | 10 |
| 74 | amphora | refine:main | `01a154c1-3d5a-7644-8df4-92c096b5622b` | 10 |
| 75 | wooden-bench | refine:main | `01a154c1-4f73-7096-bb90-ff5ee23039ec` | 10 |
| 76 | clepsydra | refine:main | `01a154c1-62e4-709d-8560-d049fbcd7c82` | 10 |
| 77 | wicker-chair | refine:main (not used) | `01a154c1-765c-7025-ac0d-7888e2cdf1c7` | 10 |
| 78 | jug-cup | refine:main | `01a154c1-8a94-7481-8a97-f38b40068107` | 10 |
| 79 | eros-sleeping | refine:v2 | `01a154c1-9db9-749a-aa32-5ac83205e5ba` | 10 |
| 80 | aedicula | preview:v2 | `01a154c1-b083-71c0-811e-2f0f47112fda` | 20 |
| 81 | oil-lamp | preview:v2 (rejected) | `01a154c1-c3dd-7287-9fe0-879268d52342` | 20 |
| 82 | aedicula | refine:v2 | `01a154c4-2cab-74da-99cd-0fd798610053` | 10 |
| 83 | wicker-chair | preview:v2 | `01a154c6-0142-72ec-8607-8506b0c1c095` | 20 |
| 84 | wicker-chair | refine:v2 | `01a154cf-314d-74fa-8cd8-8f3a811c87d7` | 10 |

| asset | credits | breakdown |
|---|---|---|
| exedra-bench | 40 | 2 previews (both rejected; the shipped file is a free kitbash) |
| statue-muse, statue-youth, cat-sleeping, citron-basket, dovecote, beehives-roman, goat, amphora, wooden-bench, clepsydra, jug-cup | 11 × 30 = 330 | preview 20 + refine 10 each |
| fishing-boat, merchant-ship, eros-sleeping, oscillum, aedicula | 5 × 50 = 250 | 2 previews + 1 refine each |
| oil-lamp | 40 | 2 previews (both rejected; the shipped file is procedural) |
| wicker-chair | 60 | 2 previews + 2 refines |
| **total** | **720** | run cap 780; project total 1381 / 1500 approved; balance 2739 |

### Pipeline additions (round 3)

- **`scripts/meshy/lib/registry.mjs`**: per-asset or per-variant `prompt_preamble` / `texture_preamble`. Each is either a literal string or a key of `art_direction.preambles`.
- **`scripts/meshy/lib/kitbash.mjs`** (new): triangle-soup editing of single-material GLBs, keeping the source material and textures. It provides:
  - exact plane clipping, with attributes interpolated;
  - affine transforms with inverse-transpose normals and winding flips;
  - X-only conforming tessellation, used before bending;
  - deformation and part simplification (seam-aware, with optional `LockBorder` / `Permissive`);
  - write-back.
- **`scripts/meshy/kitbash.mjs <exedra-bench|merchant-ship|oscillum>`** (new, free): the three recipes described above. Each writes `raw/<id>/kitbash/<id>.glb` and sets `source_glb` + `input_from: "source_glb"` in `assets.json`, along with a `kitbash` record (recipe, source, report).
- **`scripts/meshy/procedural.mjs oil-lamp`** (new, free): the lucerna generator.
- **`scripts/meshy/contact-sheet.mjs`** (new): labelled image grids (`--tile 420` or `--tile 900x300`) for reviewing thumbnails and renders side by side.
- **`scripts/assets/optimize-glb.mjs`** settings:

| setting | effect |
|---|---|
| `input_from: "source_glb"` | read kitbash or procedural output |
| `post_scale [x,y,z]` | non-uniform scale in the final frame, with normals corrected |
| `albedo_adjust.max_saturation` / `clamp_value_mix` | clamp only strongly coloured texels |
| `double_sided` | force double-sided materials |
| `source_label` / `license_label` | manifest provenance for non-Meshy assets |
| `task_ids_override` | explicit `taskIds` in the manifest |

**Re-running.** `node scripts/meshy/kitbash.mjs exedra-bench && node scripts/meshy/kitbash.mjs merchant-ship && node scripts/meshy/kitbash.mjs oscillum && node scripts/meshy/procedural.mjs oil-lamp`, then `npm run assets:optimize -- <the 19 ids>`, reproduces every round-3 file from the raw downloads, deterministically and for free. Raw downloads are now about 743 MB, all git-ignored.

### Known issues (round 3)

- **fishing-boat**: square sail, not lateen. The oars hang outboard instead of lying inside. The upswept ends are a little Nordic-looking.
- **oscillum**: 6.6k tris, over the 5k small-item budget. The relief is two masks side by side (not one centred mask), and their outline slightly overhangs the rim at the bottom. The back is a mirror image of the front.
- **aedicula**: the pillar has to be added (procedural box). The niche is small (about 0.20 m wide).
- **statue-youth**: the chlamys is minimal, and the texture fix leaves the hip wrap slightly darker than the skin marble.
- **citron-basket**: faceted fruit silhouette.
- **wicker-chair**: irregular openwork strands; the side profile slopes like a scoop.
- **goat**: the tail is too long and bushy and the legs are slender.
- **clepsydra**: wide basin (0.55 m) with the spout at mid-height; a second spout at the back.
- **amphora**: ovoid body with single handles; not strictly Dressel 2–4.
- **merchant-ship**: decorative round ports along the sheer. The artemon's rigging is the old mizzen's, scaled down.
- **exedra-bench**: identical block texture repeats (mirrored) every about 0.9 m. The back wall's outer face shows the slab underside texture. The lion supports are simplified to about 2.1k tris each.
