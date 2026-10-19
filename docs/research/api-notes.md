# Meshy AI & ElevenLabs — API notes (checked 2026-10-19)

Compiled from the official docs (docs.meshy.ai, elevenlabs.io/docs). Items marked
UNVERIFIED could not be confirmed from the docs.

## Meshy

- Base URL `https://api.meshy.ai`, header `Authorization: Bearer msy_…`.
- Create calls return `{"result":"<task_id>"}`. Status: `PENDING | IN_PROGRESS | SUCCEEDED | FAILED | CANCELED`, `progress` 0–100. Failed tasks are refunded (`consumed_credits` = 0).
- Balance: `GET /openapi/v1/balance` → `{balance, monthly_credits, permanent_credits, monthly_resets_at}`.

### Text-to-3D — `POST /openapi/v2/text-to-3d`, `GET /openapi/v2/text-to-3d/:id`
- Preview: `mode:"preview"`, `prompt` (≤800 chars), `ai_model`: `meshy-6-lite | meshy-6 | meshy-7.1 | latest` (=7.1).
  `topology` triangle|quad, `should_remesh`, `target_polycount` (100–300k), `decimation_mode` 1–4,
  `pose_mode` `"a-pose"|"t-pose"|""`, `geometry_resolution` standard|2k|4k (7.1), `target_formats`, `auto_size`, `origin_at`.
  `art_style`/`symmetry_mode` are deprecated.
- Refine: `mode:"refine"`, `preview_task_id`, `enable_pbr`, `texture_prompt`, `texture_image_url` (URL or data URI), `texture_resolution` 2k|4k|8k.
- Result: `model_urls.glb`, `thumbnail_url`, `texture_urls[]`.

### Image-to-3D — `POST/GET /openapi/v1/image-to-3d`
- `image_url` public URL **or data URI**; same model/pose/remesh fields; `should_texture`, `enable_pbr`, `texture_prompt`.
- Multi-image: `POST /openapi/v1/multi-image-to-3d`, `image_urls` 1–4.

### Rigging — `POST/GET /openapi/v1/rigging`
- `input_task_id` or `model_url` (GLB URL/data URI), `height_meters` (default 1.7).
- Result: `rigged_character_glb_url`, `rigged_character_fbx_url`, `basic_animations.{walking,running}_{glb,fbx,armature_glb}_url`.
- Textured standard humanoids only, ≤300k faces, must face +Z.

### Animation — `POST/GET /openapi/v1/animations`
- `rig_task_id` + one of `action_id` | `action_ids` (1–10, merged, one clip each) | `motion_task_id`.
- Result: `animation_glb_url`, `animation_fbx_url`, …
- Library (free): `GET /openapi/v1/animations/library?search=&category=` → `action_id, name, key, category, preview_url`.
- Candidate IDs (confirm via the library endpoint): Idle 0 / 11 / 12 / 243–254; Casual_Walk 30, Casual_Walk_inplace 613,
  Thoughtful_Walk 121; Stand_and_Chat 56, Talk_with_Hands_Open 313, Talk_with_Right_Hand_Open 314,
  Talk_with_Left_Hand_Raised 310, Discuss_While_Moving 37; Listening_Gesture 47, Agree_Gesture 25, Shrug 317;
  Long_Breathe_and_Look_Around 336, Short_Breathe_and_Look_Around 338, Walk_Slowly_and_Look_Around 341.

### Remesh — `POST/GET /openapi/v1/remesh` (`input_task_id`|`model_url`, `topology`, `target_polycount`, `target_formats`).

### Credits
| Operation | Credits |
|---|---|
| Text-to-3D preview (meshy-7.1 / meshy-6) | 20 |
| Preview (meshy-6-lite / t2 / t2.5) | 5 |
| Refine (2K/4K) | 10 |
| Image-to-3D textured (2K/4K) | 30 (20 mesh-only) |
| Rigging | 5 |
| Animation | 3 per action |
| Remesh | 5 |
| Retexture | 10 |

### MCP server
`@meshy-ai/meshy-mcp-server` (env `MESHY_API_KEY`). Claude Code:
`claude mcp add-json meshy '{"command":"npx","args":["-y","@meshy-ai/meshy-mcp-server"],"env":{"MESHY_API_KEY":"…"}}' --scope local`

## ElevenLabs

- Header `xi-api-key`.
- Models: **`eleven_v4`** (flagship, most expressive, Russian, 10k chars/request; only stability + similarity apply),
  `eleven_v3` (previous gen, 5k chars, no request stitching), `eleven_multilingual_v2`, `eleven_flash_v2_5`.
- Audio tags (v3/v4): `[curious] [sad] [happily] [sarcastic] [whispers] [sighs] [exhales] [laughs] [pause] [short pause] [long pause]`,
  `[thoughtful]`; free-form descriptions such as `[quiet, reflective]` also work. Tags are not voiced (implied by the docs; verify by listening / ASR).
- `POST /v1/text-to-speech/{voice_id}/with-timestamps?output_format=mp3_44100_128`
  body `{text, model_id, language_code, voice_settings{stability, similarity_boost, style, use_speaker_boost, speed}, seed, previous_text, next_text, apply_text_normalization}`
  → `{audio_base64, alignment{characters[], character_start_times_seconds[], character_end_times_seconds[]}, normalized_alignment}`.
  UNVERIFIED: support for v4 on this endpoint, and whether tag characters appear in `alignment.characters` (the script must handle both).
- Voices: `GET /v1/shared-voices?language=ru&gender=male&age=…&use_cases=…`, add with `POST /v1/voices/add/{public_user_id}/{voice_id}`; own voices `GET /v2/voices`.
- Quota: `GET /v1/user/subscription` → `character_count`, `character_limit`.
- Price (API): $0.08 / 1K characters for v4/v3/multilingual_v2.

Raw doc snapshots were saved during research; the facts above are the distilled version.
