"""Export the official TorchScript policy with explicit recurrent state; check parity.

Requires torch==2.6.0, onnx==1.17.0, numpy, and onnxruntime. This is an offline
build tool; running the website does not require Python or a model service.
"""

import hashlib
import json
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import torch
from torch import nn

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "public" / "assets" / "g1"


class WalkingPolicy(nn.Module):
  def __init__(self, checkpoint):
    super().__init__()
    self.memory = nn.LSTM(47, 64, 1)
    self.actor = nn.Sequential(nn.Linear(64, 32), nn.ELU(), nn.Linear(32, 12))
    self.memory.load_state_dict(checkpoint.memory.state_dict())
    self.actor.load_state_dict(checkpoint.actor.state_dict())

  def forward(self, observation, hidden, cell):
    output, (next_hidden, next_cell) = self.memory(observation.unsqueeze(0), (hidden, cell))
    return self.actor(output.squeeze(0)), next_hidden, next_cell


def main():
  torch.set_num_threads(1)
  checkpoint = torch.jit.load(str(ASSETS / "motion.pt"), map_location="cpu").eval()
  policy = WalkingPolicy(checkpoint).eval()
  destination = ASSETS / "policy.onnx"
  zeros = (torch.zeros(1, 47), torch.zeros(1, 1, 64), torch.zeros(1, 1, 64))
  with torch.no_grad():
    torch.onnx.export(policy, zeros, str(destination), opset_version=17, dynamo=False,
      input_names=["observation", "hidden", "cell"],
      output_names=["action", "next_hidden", "next_cell"])
  onnx.checker.check_model(onnx.load(str(destination)))
  session = ort.InferenceSession(str(destination), providers=["CPUExecutionProvider"])
  hidden = np.zeros((1, 1, 64), dtype=np.float32)
  cell = hidden.copy()
  generator = np.random.default_rng(42)
  max_error = 0.0
  with torch.no_grad():
    checkpoint.hidden_state.zero_()
    checkpoint.cell_state.zero_()
    for _ in range(200):
      observation = generator.normal(size=(1, 47)).astype(np.float32)
      expected = checkpoint(torch.from_numpy(observation)).numpy()
      action, hidden, cell = session.run(None, {"observation": observation, "hidden": hidden, "cell": cell})
      max_error = max(max_error, float(np.max(np.abs(expected - action))))
  if max_error > 1e-4:
    raise RuntimeError(f"ONNX export parity failed: {max_error}")
  contract = {
    "source": "https://github.com/unitreerobotics/unitree_rl_gym",
    "commit": "276801e46c5d433564f24658bac64f254b7d2d4b",
    "checkpoint": "deploy/pre_train/g1/motion.pt",
    "license": "BSD-3-Clause",
    "observation_size": 47,
    "action_size": 12,
    "hidden_shape": [1, 1, 64],
    "physics_dt": 0.002,
    "control_decimation": 10,
    "action_scale": 0.25,
    "export": "Unchanged weights; explicit LSTM hidden/cell inputs and outputs; ONNX opset 17",
    "parity_steps": 200,
    "parity_max_absolute_error": max_error,
    "sha256": hashlib.sha256(destination.read_bytes()).hexdigest(),
  }
  (ASSETS / "contract.json").write_text(json.dumps(contract, indent=2) + "\n")
  print(f"Exported {destination.stat().st_size:,} bytes; 200-step maximum error: {max_error:.8g}")


if __name__ == "__main__":
  main()
