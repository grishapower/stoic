# Ambient life

Code: `src/game/life/`. Mount: `<AmbientLife />` (from `src/game/life/AmbientLife.tsx`) inside the scene, next to `<Vegetation />`. It needs no props. It reads `runtime.player.eye/pos`, `store.progress` and `settings.quality` on its own. It also configures and triggers its own sounds through `audio.life`.

## What lives where

| Species | Where (data) | Behaviour |
|---|---|---|
| Gulls (5/7/9) | `GULL_ZONE` | Pure-pursuit circling of "thermals" (banking into turns, glides, flap bursts, climbs need flapping). They move between thermals without U-turns. Every 55–120 s one gull flies in past the terrace, 9–20 m beyond the parapet near eye level, and cries once. Distant cries come every 20–60 s. |
| Swallows (2/3/4 per zone) | `SWALLOW_ZONES` | A wobbling, slowly rotating figure eight at 1–4 m. They rise smoothly over olive and citrus canopies (height-floor grid) and swerve around cypresses and the dovecote. Activity follows `progress`: early in the walk most of them hawk high (11–18 m) and slowly. By sunset all are low and faster. |
| Doves (7+2 / 10+4 / 13+5) | Perches from `HOUSE_BLOCKS` hip roofs (ridges, eaves), portico eaves, the south entablature, the `BIRD_BATH` rim and the `DOVECOTE` roof | Idle: head turns, pecking (drinking at the bath), body turns, hops, coo with a bow. When the player's eye comes within 3.5 m they take off with a flutter, and neighbours within 1.8 m follow. They fly a Bézier arc to a free perch at least 6.5 m from the player. Relaxed relocations happen out of sight. At `progress ≥ 1` the bath empties and the "+N" evening doves fly in to roost, preferring the dovecote. |
| Butterflies (2/3/4 per zone) | `BUTTERFLY_ZONES` | Erratic steering at 0.2–1.6 m that avoids trunks and canopies. They sometimes settle on a flower, wings slowly opening and closing. Species: cabbage white, swallowtail (glides), red admiral, common blue. |
| Bees (12+3+1 / 20+5+2 / 28+8+3) | `BEEHIVES`, `BUTTERFLY_ZONES` | A looping swarm around the hives at 0.5–1.6 m, bees hovering and darting over flowers, and commuters flying hive → flowers → hive. |
| Lizards (2) | Viewpoint parapet top (west end, `VIEWPOINT_DEF`) and the porch kerb (`PORCH_RECT.minZ`) | Basks, turns its head and does push-ups. When the player's feet come within 2.5 m it darts along the wall and slips over the edge. It returns stop-and-go 8–20 s after the player has moved more than 5 m away. |

Counts are per quality (`low/medium/high`) in `life/config.ts`.

## Structure

| File | Role |
|---|---|
| `config.ts` | Counts per quality, reaction radii, seed |
| `sim.ts` | `AmbientLifeSim`: owns the six systems and their instance buffers; `update(dt, {eye, feet, progress}, events)` |
| `gulls.ts`, `swallows.ts`, `doves.ts`, `insects.ts`, `lizards.ts` | Pure logic (no three.js). Each module starts with a tuning block. |
| `perches.ts` | Dove perches derived from `architecture.ts`/`props.ts` (`BATH_RIM`, `DOVECOTE_ROOF` are tunables matching the props) |
| `obstacles.ts` | Tree/fountain/hive/dovecote volumes for fliers |
| `math.ts` | Seeded rng, Bézier, height field, `writeTRS` (instance matrix writer) |
| `geometry.ts` | Procedural low-poly creatures with an `aPart` vertex tag (wing span, head weight, spine) |
| `material.ts` | `MeshStandardMaterial` vertex patch: wing flap/elbow/fold, head yaw/pitch, spine wave; butterfly wing atlas (canvas) |
| `AmbientLife.tsx` | Thin R3F wrapper: 6 `InstancedMesh`es sharing the simulation's typed arrays |

## Performance

- **6 draw calls** (one `InstancedMesh` per species), no shadow casting, frustum culling off (instances roam). 140–490 vertices per creature (about 25k vertices in total at high quality).
- The simulation is about 0.05 ms per frame for 100 agents (measured in node, high quality). It allocates nothing per frame; small closures are created only on rare events (perch choice, coo).
- The CPU writes matrices and the `aAnim`/`aAnim2` vec4s straight into the GPU attribute arrays (no copies). All wing and body animation runs in the vertex shader.

## Sounds (`src/game/audio/life.ts`, `audio.life`)

| Call | Sound | Level |
|---|---|---|
| `dove(p)` | Rock-dove "oo-roo-coo", throaty tremolo, HRTF ref 3 m | peak ≈ −29 dBFS at ≤ 3 m, −40 at 10 m; ≥ 1.2 s apart, ignored beyond 40 m |
| `flutter(p, n)` | Take-off wing claps, one stream per bird (≤ 4), beats slowing | short bursts ≈ −30 dBFS at 2 m |
| `gull(p, near)` | "kyow" series or laughing call, rasp, air absorption by distance | far ≈ −40 dBFS peak; the terrace visitor ≈ −31 |
| `configure({ beehives })` | Continuous swarm hum (detuned saws), built within 22 m, fades in under 16 m | ≈ −45 dBFS at 1–2 m |

Everything goes to the ambience input: it fades in after unlock and ducks 2 dB under the voice. The engine attaches it as the last init stage and updates the hive hum on its 10 Hz tick. All calls are no-ops before unlock. `life` is optional in `AudioEngineApi`, so older fakes still type-check.

## Tuning quick reference

- More or fewer creatures: `LIFE_COUNTS` in `config.ts`.
- Dove skittishness: `DOVE_FLEE_RADIUS`, plus `SAFE_DISTANCE`, `STARTLE_RADIUS` and `COO_EVERY` in `doves.ts`.
- Bird-bath and dovecote dimensions: `BATH_RIM` and `DOVECOTE_ROOF` in `perches.ts`. Keep them in sync with the props.
- Gull visits: `VISIT_EVERY` and `VISIT_PATH` in `gulls.ts`.
- Swallow height band and dusk behaviour: `LOW`, `HIGH` and `swallowActivity()` in `swallows.ts`.
- Lizard spots: `lizardSpots()` in `lizards.ts`.
- Sound levels: the tuning block at the top of `audio/life.ts`.

Tests: `src/__tests__/life.test.ts`.
