# Third-party assets and libraries

## Unitree G1 model and locomotion policy

Source: [Unitree Robotics — unitree_rl_gym](https://github.com/unitreerobotics/unitree_rl_gym)
at commit `276801e46c5d433564f24658bac64f254b7d2d4b`.
License: BSD-3-Clause. The full upstream license text is at `public/assets/g1/LICENSE`.

- `g1_12dof.xml` and `meshes/*.STL` contain unchanged copies from
  `resources/robots/g1_description/`.
- `motion.pt` contains an unchanged copy of `deploy/pre_train/g1/motion.pt`.
- `reference/g1.yaml` and `reference/deploy_mujoco.py` contain unchanged upstream files.
- `policy.onnx` is a derived export using unchanged network weights, with explicit
  LSTM hidden/cell inputs and outputs. See `scripts/export_policy.py` and
  `public/assets/g1/contract.json` for the transformation and parity evidence.
- `src/locomotion.js`, `src/simulation.js`, and `src/simulation.worker.js`
  adapt the official deployment observation layout, timing, and PD controller.
  The official robot XML remains unchanged. The application defines the apartment separately.
- `visuals.bin` and `visuals.json` contain meshes for rendering.
  Meshoptimizer simplifies the official meshes offline in MuJoCo's compiled mesh frame.
  The simplification targets 4 mm geometric error and reduces 503,229 to 25,142
  triangles. The original files remain the source of the physics model.
- `public/assets/g1/manifest.json` records the source hashes.

## Runtime libraries

| Library | Source | License |
| --- | --- | --- |
| MuJoCo WASM | [google-deepmind/mujoco](https://github.com/google-deepmind/mujoco) | Apache-2.0 |
| ONNX Runtime Web | [microsoft/onnxruntime](https://github.com/microsoft/onnxruntime) | MIT |
| Three.js | [mrdoob/three.js](https://github.com/mrdoob/three.js) | MIT |
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
