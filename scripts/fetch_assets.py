"""Fetch the pinned official G1 model and reference checkpoint. Run from any directory."""

import concurrent.futures
import hashlib
import json
from pathlib import Path
import urllib.request
import xml.etree.ElementTree as ET

COMMIT = "276801e46c5d433564f24658bac64f254b7d2d4b"
SOURCE = f"https://raw.githubusercontent.com/unitreerobotics/unitree_rl_gym/{COMMIT}"
ROOT = Path(__file__).resolve().parents[1]
DESTINATION = ROOT / "public" / "assets" / "g1"


def fetch_asset(source_path, destination):
  destination.parent.mkdir(parents=True, exist_ok=True)
  with urllib.request.urlopen(f"{SOURCE}/{source_path}", timeout=60) as response:
    content = response.read()
  destination.write_bytes(content)
  return {"file": str(destination.relative_to(DESTINATION)), "sha256": hashlib.sha256(content).hexdigest()}


def main():
  model_path = "resources/robots/g1_description"
  manifest = [fetch_asset(f"{model_path}/g1_12dof.xml", DESTINATION / "g1_12dof.xml")]
  model = ET.parse(DESTINATION / "g1_12dof.xml")
  mesh_files = sorted({mesh.attrib["file"] for mesh in model.findall(".//asset/mesh")})
  paths = [(f"{model_path}/meshes/{name}", DESTINATION / "meshes" / name) for name in mesh_files]
  paths += [
    ("LICENSE", DESTINATION / "LICENSE"),
    ("deploy/pre_train/g1/motion.pt", DESTINATION / "motion.pt"),
    ("deploy/deploy_mujoco/configs/g1.yaml", DESTINATION / "reference" / "g1.yaml"),
    ("deploy/deploy_mujoco/deploy_mujoco.py", DESTINATION / "reference" / "deploy_mujoco.py"),
  ]
  with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
    manifest += list(pool.map(lambda pair: fetch_asset(*pair), paths))
  (DESTINATION / "manifest.json").write_text(json.dumps({
    "repository": "https://github.com/unitreerobotics/unitree_rl_gym",
    "commit": COMMIT,
    "license": "BSD-3-Clause",
    "files": manifest,
  }, indent=2) + "\n")
  print(f"Fetched {len(manifest)} official model and policy files to {DESTINATION}")


if __name__ == "__main__":
  main()
