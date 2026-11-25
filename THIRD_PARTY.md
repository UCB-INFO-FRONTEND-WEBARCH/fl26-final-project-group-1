# Third-party assets and libraries

## Berkeley Lite Pro model and policies

The policies come from Fluctlight (`tracker/ppo`), Berkeley Humanoids' policy repository, whose code is MIT-licensed.
`public/assets/lite_pro/manifest.json` records the Fluctlight commit, each checkpoint, and every file's hash.

- `public/assets/lite_pro/policies/*.onnx` are the exported actors of the walking (`walk`, `walk_stairs`), get-up
  (`getup_supine`, `getup_prone`) and sit (`sit`) policies; `*.json` are their runtime contracts. `src/fluctlight_policy.js` and
  `src/robot_controller.js` run them; both are written for this repository.
- The walking policies learned from the [LAFAN1](https://github.com/ubisoft/ubisoft-laforge-animation-dataset)
  locomotion clips (Ubisoft La Forge, CC BY-NC-ND 4.0), retargeted to Lite Pro. No LAFAN1 motion data ships with the
  app.
- The get-up policies follow the reward design of [HoST](https://arxiv.org/abs/2502.08378) (MIT); no HoST code is used.
- The sit policy (`sit`) tracks motion-captured chair clips from **BONES-SEED**, retargeted to Lite Pro by Berkeley
  Humanoids (`Lite-Motion-Retargeting`). Two clips ship with the app, because the policy reads the clip at run time:
  `public/assets/lite_pro/policies/sit.clips.bin` holds, per frame, the clip's goal pose (as the policy reads it),
  the reference chest and pelvis poses, and the reference joints of `sit_on_chair_start_R_003_A101` (sitting down)
  and `sit_on_chair_stop_R_001_A101` (standing up). The project owner included them for this course prototype; they
  are not covered by this repository's MIT license.
- The Lite Pro MJCF and meshes come from
  [lite_description](https://github.com/berkeley-humanoids/lite_description) 0.5.0, under MIT; its full license is in
  `public/assets/lite_pro/ROBOT_LICENSE`. `robot.xml` is the model as mjlab compiles it for the walking task, with the
  Fluctlight patches (collision names, IMU site, elevation-map site), without the training scene.
- `scripts/import_fluctlight.py` copies the bundle, checks the policy hashes, and generates `src/policy_constants.js`.
  `tests/fixtures/fluctlight/` holds the mjlab rollouts that `scripts/verify_policy_fixtures.js` replays.
- `visuals.bin` and `visuals.json` are derived render meshes, simplified offline with
  meshoptimizer at a 4 mm error target. Rays and physics use the imported meshes.
- `public/assets/explainer/` contains poses and elevation maps from three seeded runs of these policies in the demo
  apartment. `scripts/record_explainer.js` generates these recordings; `motion.json` records the source commit and the
  checkpoints.

## Character view

The direct joint-to-bone mapping follows
[Lite-Motion-Retargeting](https://github.com/berkeley-humanoids/lite-motion-retargeting/blob/8a732d145917c8f547cf3ae4e87aec0f36a02089/site/app.js)
and its [motion browser description](https://github.com/berkeley-humanoids/lite-motion-retargeting/blob/8a732d145917c8f547cf3ae4e87aec0f36a02089/docs/browser.md).
The app copies measured robot motion. It does not run the repository's motion-retargeting tools.

The default character is **NAI**, by **-T.K.-**, from the
[Lite-Motions Space](https://huggingface.co/spaces/Berkeley-Humanoids/Lite-Motions).
The project owner authorizes NAI use by Centoria visitors.
The UI displays the author and source. `src/character_asset.js` pins the model's
URL and SHA-256. The app downloads the original file from its source only when
Character mode is selected. The repository and Pages artifact do not contain the file.

NAI's original VRM Public License 1.0 metadata permits avatar use only by the author
and prohibits redistribution and modification. The project-specific authorization
does not change these restrictions for other uses. The original file and its
embedded metadata remain unchanged.

## Compatible IKEA seating

The lounge uses the supplied IKEA catalog mesh for
[KIVIK 694.997.04, Gunnared blue](https://www.ikea.com/us/en/p/kivik-sofa-gunnared-blue-s69499704/).
The app applies an 80% uniform runtime scale to match the sit policy; the downloaded model stays unchanged.
Its source hash is in `src/seating_assets.js`; the runtime uses the same pinned external catalog as the armchairs.
Generated convex hulls are contact approximations and receive the same scale and placement as the visual mesh.

## Aerial arrival

The 4000 × 4000 Bay Area overview is **Sentinel-2 cloudless** by
[EOX IT Services GmbH](https://eox.at), retrieved from its public WMS layer `s2cloudless_3857`.
Required attribution: [Sentinel-2 cloudless](https://s2maps.eu) by EOX IT Services GmbH
(Contains modified Copernicus Sentinel data 2016 & 2017). This vintage is licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); see the provider's
[license and attribution](https://eox.at/2025/03/sentinel-2-cloudless-2024/#license).
The closer Santa Clara, campus, and Building K views use public-domain
[USGS/USDA NAIP orthoimagery](https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer).
The downloaded JPEG images are unchanged. The app applies its color grade and
procedural cloud effect at render time.

The target is Building K at 2886 Scott Boulevard. Its roof was located using
[NVIDIA's visitor map](https://www.nvidia.com/content/dam/en-zz/Solutions/support/corp-facilities-visitor-map-2022.pdf)
and the aerial image. This is a visual arrival location; the indoor playground
is a separate scene and does not reproduce the real building's interior.

Night lights are an artistic rendering of real road centerlines from
© OpenStreetMap contributors, under [ODbL 1.0](https://www.openstreetmap.org/copyright).
`public/assets/arrival/lights.bin` is the derived point database, also under
ODbL 1.0. Its coordinate origin, binary layout, source, license, and hash are in
the adjacent `manifest.json`. `overview-lights.bin` is the regional-road subset
preloaded for the first view and has the same license.
`scripts/prepare_arrival_assets.py` records the Overpass extraction and point-spacing rules. The arrival displays imagery and
map credits. The night view is a stylized render of the daytime aerial images;
it is not nighttime satellite photography.

## Runtime libraries

| Library | Source | License |
| --- | --- | --- |
| MuJoCo WASM | [google-deepmind/mujoco](https://github.com/google-deepmind/mujoco) | Apache-2.0 |
| ONNX Runtime Web | [microsoft/onnxruntime](https://github.com/microsoft/onnxruntime) | MIT |
| Three.js | [mrdoob/three.js](https://github.com/mrdoob/three.js) | MIT |
| three-vrm | [pixiv/three-vrm](https://github.com/pixiv/three-vrm) | MIT |
| Draco (GLB mesh decoder) | [google/draco](https://github.com/google/draco) | Apache-2.0 |
| React / React DOM | [facebook/react](https://github.com/facebook/react) | MIT |
| Vite (build tooling) | [vitejs/vite](https://github.com/vitejs/vite) | MIT |
| meshoptimizer (offline visual asset tooling) | [zeux/meshoptimizer](https://github.com/zeux/meshoptimizer) | MIT |

`package-lock.json` locks dependency versions. The installed npm packages include
their license texts.

The bundled Draco decoder comes from the Three.js npm package.
Its license text is at `public/assets/licenses/draco.txt`.

## Local IKEA collection

The asset browser adapts the catalog draft supplied in
`IKEA_Furniture_and_Local_Catalog.zip`, snapshot 2026-10-28. It uses the archive's
prepared catalog rows, categories, cached photos, and original GLB files.
Product source URLs and model checksums remain in exported selection manifests.
The archive records [IKEA Browser](https://github.com/shish/blender-ikea-browser/)
as the collection tool. The catalog collection itself remains external. Selected derived models in the
Hephaestus scene are bundled as described below.

`scripts/prepare_furniture.py` derives compound convex collision meshes from
twelve selected GLBs with [CoACD](https://github.com/SarahWeiii/CoACD) (MIT).
The generated data in `src/furniture_assets.js` records each original file hash.
`src/furniture_layout.js` defines the apartment placements. Models retain their
original materials and metre scale. The renderer converts their Y up coordinates
to the same Z up frame as the collision meshes.

## Hephaestus Tower scene

`public/assets/hephaestus/` contains optimized exports of the project owner's
calibrated V20 Hephaestus Tower Blender scene. Its manifest pins the source file,
SHA-256, metre origin, output hashes, and limitations. The original Minecraft map
informed the layout; these exports contain the rebuilt Blender geometry, not
Minecraft textures or a Minecraft runtime.

Furniture includes previously downloaded IKEA models and the owner's existing
Tripo-generated replacements, including KIVIK-inspired seating. IKEA product names
identify the source/design references; they do not imply endorsement or a blanket
open-source license. Native construction, procedural plants, and baked oak/brick
finishes come from the authored scene. No new paid assets were generated for this
integration. These derived exports do not broaden the underlying asset rights.

The map uses meshoptimizer's MIT-licensed meshopt decoder from the installed
Three.js package. Collision preparation uses CoACD (MIT), NumPy, SciPy, trimesh,
and Shapely offline. See [map integration](docs/HEPHAESTUS.md) for export details.

## Fonts

The application includes DM Sans and IBM Plex Mono from the [Google Fonts repository](https://github.com/google/fonts).
The SIL Open Font License 1.1 covers these fonts. Their license texts are next to
the font files in `public/assets/fonts/`.

The project defines its own apartment walls, floor, and interface.
The project does not include BEHAVIOR, ReplicaCAD, or other gated scene datasets.

The performance design follows principles from the MicroDuck simulator and mjswan
sources in `docs/PERFORMANCE.md`. This repository does not contain implementation
code from those projects.
