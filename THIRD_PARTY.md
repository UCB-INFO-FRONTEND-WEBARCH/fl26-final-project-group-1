# Third-party assets and libraries

## Unitree G1 model and locomotion policy

Source: [Unitree Robotics — unitree_rl_gym](https://github.com/unitreerobotics/unitree_rl_gym)
at commit `276801e46c5d433564f24658bac64f254b7d2d4b`.
License: BSD-3-Clause; full upstream text is included at
`public/assets/g1/LICENSE`.

- `g1_12dof.xml` and `meshes/*.STL` are copied unchanged from
  `resources/robots/g1_description/`.
- `motion.pt` is copied unchanged from `deploy/pre_train/g1/motion.pt`.
- `reference/g1.yaml` and `reference/deploy_mujoco.py` are copied unchanged.
- `policy.onnx` is a derived export using unchanged network weights, with explicit
  LSTM hidden/cell inputs and outputs. See `scripts/export_policy.py` and
  `public/assets/g1/contract.json` for the transformation and parity evidence.
- `src/locomotion.js` and the controller portion of `src/simulation.worker.js`
  adapt the official deployment observation layout, timing, and PD controller.
  The official robot XML remains unchanged; the apartment is composed separately.
- `visuals.bin` and `visuals.json` are render-only derivatives, simplified offline
  with meshoptimizer from the official meshes in MuJoCo's compiled mesh frame.
  The simplification targets 4 mm geometric error and reduces 503,229 to 25,142
  triangles. The original files remain the source of the physics model.
- Source hashes are recorded in `public/assets/g1/manifest.json`.

## Runtime libraries

| Library | Source | License |
| --- | --- | --- |
| MuJoCo WASM | [google-deepmind/mujoco](https://github.com/google-deepmind/mujoco) | Apache-2.0 |
| ONNX Runtime Web | [microsoft/onnxruntime](https://github.com/microsoft/onnxruntime) | MIT |
| Three.js | [mrdoob/three.js](https://github.com/mrdoob/three.js) | MIT |
| React / React DOM | [facebook/react](https://github.com/facebook/react) | MIT |
| Vite (build tooling) | [vitejs/vite](https://github.com/vitejs/vite) | MIT |
| meshoptimizer (offline visual asset tooling) | [zeux/meshoptimizer](https://github.com/zeux/meshoptimizer) | MIT |

Dependency versions are locked in `package-lock.json`; license texts are included
in their installed npm packages.

## Fonts

DM Sans and IBM Plex Mono are bundled from the [Google Fonts repository](https://github.com/google/fonts)
under the SIL Open Font License 1.1. Their license texts are included alongside
the fonts in `public/assets/fonts/`.

The apartment gray-box geometry and interface are created for this project.
No BEHAVIOR, ReplicaCAD, or other gated scene dataset is included.

Performance architecture was informed by the MicroDuck simulator and mjswan
sources linked in `docs/PERFORMANCE.md`. No implementation code from those
projects is copied into this repository.
