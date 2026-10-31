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
| React / React DOM | [facebook/react](https://github.com/facebook/react) | MIT |
| Vite (build tooling) | [vitejs/vite](https://github.com/vitejs/vite) | MIT |
| meshoptimizer (offline visual asset tooling) | [zeux/meshoptimizer](https://github.com/zeux/meshoptimizer) | MIT |

`package-lock.json` locks dependency versions. The installed npm packages include
their license texts.

## Fonts

The application includes DM Sans and IBM Plex Mono from the [Google Fonts repository](https://github.com/google/fonts).
The SIL Open Font License 1.1 covers these fonts. Their license texts are next to
the font files in `public/assets/fonts/`.

The project defines its own apartment gray-box geometry and interface.
The project does not include BEHAVIOR, ReplicaCAD, or other gated scene datasets.

The performance design follows principles from the MicroDuck simulator and mjswan
sources in `docs/PERFORMANCE.md`. This repository does not contain implementation
code from those projects.
