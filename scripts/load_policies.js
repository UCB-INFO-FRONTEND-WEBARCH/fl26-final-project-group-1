// Loads the bundled Fluctlight policies for the Node scripts, as the browser worker does.
import { readFile } from 'node:fs/promises';
import * as ort from 'onnxruntime-web/wasm';
import { POLICY } from '../src/policy_constants.js';

export const ASSET_BASE = new URL('../public/assets/lite_pro/', import.meta.url);

ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = {
  wasm: new URL('../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', import.meta.url).href,
  mjs: new URL('../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', import.meta.url).href,
};

/** {name: {session, contract}} for every policy in src/policy_constants.js. */
export async function load_policies() {
  const policies = {};
  for (const [name, path] of Object.entries(POLICY.policies)) {
    const contract = JSON.parse(await readFile(new URL(path, ASSET_BASE), 'utf8'));
    const bytes = new Uint8Array(await readFile(new URL(`policies/${contract.onnx}`, ASSET_BASE)));
    policies[name] = { contract, session: await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] }) };
  }
  return policies;
}

export async function release_policies(policies) {
  for (const { session } of Object.values(policies)) await session.release();
}

export function seeded_random(seed = 1) {
  return () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 4294967296; };
}
