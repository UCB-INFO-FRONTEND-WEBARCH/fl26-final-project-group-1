# Third-party assets and libraries

## Berkeley Lite Pro model and S3 policy

Source: [Berkeley Humanoids — InstinctMJ](https://github.com/berkeley-humanoids/instinctmj/tree/07396764422e274e4316719f9dfb1fd734e9a516),
commit `07396764422e274e4316719f9dfb1fd734e9a516`, and the published
[Lite Pro Motion Tracking artifact](https://claude.ai/artifact/8nh5Z94mUcC7iCdg3cDGpo),
section 3.10. The checkpoint is the S3 goal-mode Mix run at iteration 20,000.

- `public/assets/lite_pro/policy.onnx` is the unchanged velocity-mode export.
  `constants.json` retains the matching joint, camera, normalization-layout, and motor settings.
- `src/lite_pro_policy.js` adapts the upstream browser controller, under
  CC BY-NC 4.0. The full license is in `public/assets/lite_pro/LICENSE`.
  The unchanged reference implementation is in `public/assets/lite_pro/reference/core.js`.
- Lite Pro MJCF and meshes originate from
  [lite_description](https://github.com/berkeley-humanoids/lite_description),
  under MIT; its full license is in `public/assets/lite_pro/ROBOT_LICENSE`.
  The imported browser model preserves the trained joint configuration and contacts.
  `robot.xml` removes the demo's terrain, origin markers, and lighting; the app supplies its own scene.
- `scripts/import_lite_pro.py` checks the source hashes, unpacks the original browser
  meshes, and generates `src/policy_constants.js`. The asset manifest records file hashes.
- `visuals.bin` and `visuals.json` are derived render meshes, simplified offline with
  meshoptimizer at a 4 mm error target. The camera and physics use the imported meshes.
- `public/assets/explainer/` contains poses and depth images from two seeded S3
  policy runs in the apartment. `scripts/record_explainer.js` generates these recordings.
  `motion.json` records the source commit, policy hash, and attribution. The
  explanation page reuses the Lite Pro render meshes and links to the original report.

## Character view

The direct joint-to-bone mapping follows
[Lite-Motion-Retargeting](https://github.com/berkeley-humanoids/lite-motion-retargeting/blob/8a732d145917c8f547cf3ae4e87aec0f36a02089/site/app.js)
and its [motion browser description](https://github.com/berkeley-humanoids/lite-motion-retargeting/blob/8a732d145917c8f547cf3ae4e87aec0f36a02089/docs/browser.md).
The app copies measured robot motion. It does not run the repository's motion-retargeting tools.

The default character is **Seed-san**, by **VirtualCast, Inc.**, from the
[VRM specification samples](https://github.com/vrm-c/vrm-specification/tree/94e82dd346fa6cf0337c4421728640e5252dd38e/samples/Seed-san).
Its embedded VRM Public License 1.0 metadata permits avatar use by everyone,
commercial use, redistribution, and modification, and requires credit.
The UI displays the author and source. `src/character_asset.js` pins the model's
URL and SHA-256. The app downloads the original file from its source only when
Character mode is selected. The repository and Pages artifact do not contain the file.

The Lite-Motions Space uses NAI by -T.K.-. Its embedded metadata permits avatar use
only by the author and prohibits redistribution and modification. NAI is not
included in this project or selected as its public character.

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
as the collection tool. No model or photo from this collection is tracked in Git.

`scripts/prepare_furniture.py` derives compound convex collision meshes from
twelve selected GLBs with [CoACD](https://github.com/SarahWeiii/CoACD) (MIT).
The generated data in `src/furniture_assets.js` records each original file hash.
`src/furniture_layout.js` defines the apartment placements. Models retain their
original materials and metre scale. The renderer converts their Y up coordinates
to the same Z up frame as the collision meshes.

## Fonts

The application includes DM Sans and IBM Plex Mono from the [Google Fonts repository](https://github.com/google/fonts).
The SIL Open Font License 1.1 covers these fonts. Their license texts are next to
the font files in `public/assets/fonts/`.

The project defines its own apartment walls, floor, and interface.
The project does not include BEHAVIOR, ReplicaCAD, or other gated scene datasets.

The performance design follows principles from the MicroDuck simulator and mjswan
sources in `docs/PERFORMANCE.md`. This repository does not contain implementation
code from those projects.
