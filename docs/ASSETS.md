# Реестр ассетов, источников и лицензий

Сводка всех материалов, которые использует прототип. Подробности по каждому конвейеру:
- модели — [assets/meshy.md](assets/meshy.md);
- текстуры — [assets/textures.md](assets/textures.md);
- голос — [audio/voice.md](audio/voice.md) и [audio/voice-qa.md](audio/voice-qa.md);
- окружающий звук — [audio/engine.md](audio/engine.md).

Игра работает полностью офлайн от локальных файлов. Платные AI-API вызываются только скриптами в `scripts/` и только вручную.

## 3D-модели (Meshy AI)

Все модели сгенерированы через Meshy API скриптом `scripts/meshy/meshy.mjs`. Затем они оптимизированы скриптом `scripts/assets/optimize-glb.mjs`: meshopt, квантование, WebP-текстуры, метры, опорная точка внизу по центру, вперёд +Z. Промпты и task id хранятся в `assets-src/meshy/assets.json`, расход кредитов — в `assets-src/meshy/ledger.json`. Исходные GLB лежат локально в `assets-src/meshy/raw/` (около 242 МБ) и в git не попадают.

**Расход:** 607 кредитов из согласованных 1500 (баланс 4120 → 3513, 19.10.2026):
- раунд 1 — персонаж и пропсы, 382 кредита;
- раунд 2 — плоды, рука и деревья, 225 кредитов.

**Лицензия:** результаты Meshy принадлежат владельцу аккаунта на платном тарифе. На бесплатном тарифе это CC BY 4.0. Перед публичным релизом тариф нужно подтвердить.

| Модель | Размер, м (Ш×В×Г) | Треугольники | Файл | Анимации |
|---|---|---|---|---|
| `amphora-planter` | 0.95×0.85×0.95 | 8215 | `assets/models/amphora-planter.glb` (322 КБ) | — |
| `amphora-planter-tall` | 0.611×1×0.611 | 8092 | `assets/models/amphora-planter-tall.glb` (360 КБ) | — |
| `fountain` | 2.6×1.862×2.6 | 19566 | `assets/models/fountain.glb` (543 КБ) | — |
| `herm-bust` | 0.277×0.7×0.309 | 15565 | `assets/models/herm-bust.glb` (633 КБ) | — |
| `olive-tree` | 4.184×5×4.348 | 24173 | `assets/models/olive-tree.glb` (1.05 МБ) | — |
| `seneca` | 1.223×1.743×0.47 | 36143 | `assets/models/seneca.glb` (2.51 МБ) | walk_basic, idle, walk, walk_thoughtful, talk_open, talk_right, talk_chat, shrug, look_around, listen |
| `stone-bench` | 1.9×0.61×0.561 | 11994 | `assets/models/stone-bench.glb` (310 КБ) | — |
| `writing-table` | 1.2×0.82×0.921 | 13445 | `assets/models/writing-table.glb` (640 КБ) | — |

В сцене используются:
- `seneca`;
- `stone-bench`, `writing-table`, `herm-bust` (на процедурном пилоне);
- `amphora-planter` и `amphora-planter-tall` (кашпо и кадки для цитрусов);
- `mandarin-fruit` — плоды на деревьях и в руке;
- `hand-fp` — рука от первого лица.

`citron-fruit` подключается вместе с исторически точным вариантом `FRUIT_KIND = 'citron'`.

Сгенерированы, проверены в сцене и **не используются**:
- `olive-tree` и `olive-tree-lite` — в движке выглядят «оплавленными», процедурные оливы смотрятся цельнее;
- `umbrella-pine` — низкополигональная крона, похожа на акацию;
- `italian-cypress` — читается как светлое перо, а не как кипарис. Модель `fountain` сгенерирована и проверена, но в саду пока стоит процедурный фонтан-лабрум: его анимированная вода и водяная завеса привязаны к процедурной геометрии.

Тосканская колонна, сгенерированная Meshy, отклонена: обе попытки вышли ионическими или вычурными. Колонны перистиля процедурные, см. `src/game/scenes/geom/column.ts`.

## Открытые модели

- **Poly Haven (CC0):** 27 моделей — камни бухты, растения-заместители, бюст, утварь, мостки, кострище. Полный список с авторами и ссылками — [docs/assets/open-models.md](assets/open-models.md), манифест `src/data/generated/open-models.json`, воспроизводимая загрузка `scripts/assets/fetch-open-models.mjs`.
- **Рука для трекинга рук в VR:** `public/assets/models/xr/generic-hand/left.glb`, `right.glb` — профиль `generic-hand` из [WebXR Input Profiles](https://github.com/immersive-web/webxr-input-profiles) (`@webxr-input-profiles/assets@1.0.20`), © 2019 Amazon, лицензия MIT (текст рядом, `LICENSE.md`). Скиннинг-модель, 2,3 тыс. треугольников; кости ведёт `XRHandMeshModel` из three.js по суставам руки. В игре перекрашена в телесный цвет.

## Процедурная геометрия (собственный код)

Создаётся в рантайме кодом проекта, без внешних файлов:
- рельеф и маска дорожек;
- вилла: колонны, стилобат, антаблемент, стены с росписью в помпейском стиле (canvas-текстура), кровли, двери;
- сад: живые изгороди и фонтан-лабрум с водяной завесой;
- пергола, смотровой парапет, терраса с подпорной стеной, сухая каменная ограда;
- кипарисы, оливы, пинии, кустарники, трава (листовые атласы рисуются на canvas);
- цитрусовые деревья, плоды, рука-заглушка от первого лица;
- валуны у подножия обрыва;
- дальние горы и остров, процедурная фигура-заглушка Сенеки (резервная).

## Текстуры (Poly Haven, CC0)

Загружаются скриптом `scripts/assets/fetch-textures.mjs` в разрешении 1k JPG (color, normal GL, ARM).
| Слот | Ассет | Авторы | Лицензия |
|---|---|---|---|
| `ground-meadow` | [Withered Grass](https://polyhaven.com/a/withered_grass) | Charlotte Baglioni | CC0 |
| `ground-garden` | [Yellow Flower Mulch](https://polyhaven.com/a/yellow_flower_mulch) | Dimitrios Savva | CC0 |
| `path-gravel` | [Gravel Floor](https://polyhaven.com/a/gravel_floor) | Jenelle van Heerden, Matterfield | CC0 |
| `paving-stone` | [Marble 01](https://polyhaven.com/a/marble_01) | Rob Tuytel | CC0 |
| `plaster-wall` | [Medieval Wall 01](https://polyhaven.com/a/medieval_wall_01) | Rob Tuytel | CC0 |
| `roof-tiles` | [Clay Roof Tiles 02](https://polyhaven.com/a/clay_roof_tiles_02) | Amal Kumar | CC0 |
| `marble` | [Marble Rock 02](https://polyhaven.com/a/marble_rock_02) | Amal Kumar | CC0 |
| `rock-cliff` | [Marble Cliff 04](https://polyhaven.com/a/marble_cliff_04) | Amal Kumar | CC0 |
| `wood-weathered` | [Brown Planks 03](https://polyhaven.com/a/brown_planks_03) | Rob Tuytel | CC0 |
| `bark` | [Bark Willow 02](https://polyhaven.com/a/bark_willow_02) | Charlotte Baglioni | CC0 |
| `brick-roman` | [Medieval Red Brick](https://polyhaven.com/a/medieval_red_brick) | Rob Tuytel | CC0 |
| `water` | [three.js Water Normals](https://github.com/mrdoob/three.js/blob/r170/examples/textures/waternormals.jpg) | three.js authors | MIT |

Общий размер текстур: 11.39 МБ. Карта нормалей воды `waternormals.jpg` взята из репозитория three.js (MIT); текст лицензии лежит рядом: `public/assets/textures/water/LICENSE-three.js.txt`.

## Голос (временная заглушка)

**Сейчас:** офлайн-синтез [Piper TTS](https://github.com/OHF-Voice/piper1-gpl), голос `ru_RU-denis-medium`. Обработка: понижение высоты тона, тёплый эквалайзер, нормализация до −18 LUFS. Всего 30 клипов, 2.62 МБ, файлы в `public/assets/audio/voice/`. В манифесте записано `placeholder: true`, и игра честно сообщает об этом в настройках.

Лицензии:
- пакет `piper-tts` распространяется под GPL-3.0, но используется только как инструмент сборки, сгенерированное аудио им не покрывается;
- датасет голоса denis — CC0;
- модель дообучена с голоса en_US lessac, данные которого лицензированы только для некоммерческих исследований. **Поэтому эта озвучка допустима только для прототипа и должна быть заменена до любого коммерческого использования.**

**Финальная озвучка:** скрипт `scripts/voice/generate-elevenlabs.mjs` (модель `eleven_v4`) готов, но не запускался — ключа и бюджета пока нет. Полный текст сценария — 3 212 символов, около $0.26 за прогон.

## Окружающий звук и музыка

Генерируются в реальном времени через Web Audio API (`src/game/audio/`), без аудиофайлов и внешних лицензий:
- ветер и шелест листвы;
- фонтан, морской прибой;
- птицы, вечерние цикады;
- шаги;
- шорох листвы при срывании плода и стук упавшего плода;
- очень тихие щипки «лиры» (Karplus–Strong) на модальном бурдоне.

## Шрифты (SIL Open Font License 1.1)

Подключены из npm-пакетов `@fontsource`, хранятся локально, без CDN:
- Cormorant Garamond — заголовки;
- Spectral — текст письма и субтитры;
- Inter — служебные подписи.

## Текст

- Латинский оригинал письма — общественное достояние ([la.wikisource](https://la.wikisource.org/wiki/Epistulae_morales_ad_Lucilium/Liber_I)).
- Русский перевод — новый рабочий перевод проекта, см. [TRANSLATION.md](TRANSLATION.md).
- Перевод С. А. Ошерова использовался только как ориентир и не воспроизводится.
- Приветствия и реплики Сенеки вне письма — авторский текст проекта.
