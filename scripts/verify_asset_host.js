import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { FURNITURE_ASSETS } from '../src/furniture_assets.js';
import { model_path, image_path } from '../src/asset_paths.js';

const [base, site] = process.argv.slice(2);
if (!base || !site) throw new Error('Usage: node scripts/verify_asset_host.js ASSET_BASE_URL SITE_ORIGIN');
const root = new URL(`${base.replace(/\/+$/, '')}/`);
const origin = new URL(site).origin;

async function read(path) {
  const response = await fetch(new URL(path, root), { headers: { Origin: origin }, signal: AbortSignal.timeout(30000) });
  assert.ok(response.ok, `${path}: HTTP ${response.status}`);
  const allowed = response.headers.get('access-control-allow-origin');
  assert.ok(allowed === '*' || allowed === origin, `${path}: CORS must allow ${origin}`);
  return response;
}

const manifest = await (await read('data/manifest.json')).json();
const chunks = await Promise.all(manifest.chunks.map(async (name) => (await read(`data/${name}`)).json()));
const rows = chunks.flat();
assert.equal(rows.length, manifest.total, 'Catalog row count does not match its manifest');
const id_column = manifest.columns.indexOf('id');
const image_column = manifest.columns.indexOf('image');
assert.ok(id_column >= 0 && image_column >= 0, 'Catalog identity or image columns are missing');
const articles = new Map(rows.map((row) => [row[id_column], row]));

await Promise.all(Object.entries(FURNITURE_ASSETS).map(async ([article, asset]) => {
  const row = articles.get(article);
  assert.ok(row, `Playground article ${article} is missing from the catalog`);
  const response = await read(model_path(article));
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256,
    `${article}: hosted model differs from its collision geometry source`);
  if (row[image_column]) {
    const image = await read(image_path(row[image_column]));
    assert.match(image.headers.get('content-type') || '', /^image\//, `${article}: invalid product photo`);
    await image.body?.cancel();
  }
}));
console.log(`PASS: ${rows.length.toLocaleString()} catalog rows, CORS, playground model hashes, and product photos.`);
