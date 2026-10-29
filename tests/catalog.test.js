import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FILTERS, prepare_catalog, filter_catalog, format_article, selection_manifest,
} from '../src/catalog_data.js';

const columns = ['id', 'name', 'type', 'path', 'variant', 'image', 'url', 'bytes', 'hash', 'dimensions', 'colors', 'productUrl', 'inferred'];
const categories = [
  { path: ['chairs'], name: 'Chairs' },
  { path: ['chairs', 'office'], name: 'Office chairs' },
  { path: ['chairs-other'], name: 'Other furniture' },
];
const assets = prepare_catalog([
  ['00000001', 'POÄNG', 'Chair', ['chairs', 'office'], 'white', '/thumbnails/example.jpg', 'https://example.com/1.glb', 100, 'same', { height: 1 }, ['white'], 'https://example.com/product/1', false],
  ['00000002', 'POÄNG', 'Chair', ['chairs', 'office'], 'black', '', 'https://example.com/2.glb', 200, 'same', { height: 1.2 }, ['black'], 'https://example.com/product/2', false],
  ['00000003', 'LACK', 'Table', ['chairs-other'], 'white', '', 'https://example.com/3.glb', 300, 'different', {}, ['white'], 'https://example.com/product/3', true],
], columns, categories);

test('catalog search handles accents and dotted article numbers and keeps model requests local', () => {
  assert.equal(filter_catalog(assets, { ...DEFAULT_FILTERS, query: 'poang white' }, new Set())[0].id, '00000001');
  assert.equal(filter_catalog(assets, { ...DEFAULT_FILTERS, query: '000.000.02' }, new Set())[0].id, '00000002');
  assert.equal(assets[0].model_url, '/assets/ikea/raw/00/00000001/model.glb');
  assert.equal(assets[0].image, '/assets/ikea/thumbnails/ex/example.jpg');
  assert.equal(format_article(assets[0].id), '000.000.01');
});

test('category boundaries and constraints apply before identical model files are removed', () => {
  const filtered = filter_catalog(assets, {
    ...DEFAULT_FILTERS, category: 'chairs', unique: true, colors: ['black'], max_file: 250,
  }, new Set());
  assert.deepEqual(filtered.map((asset) => asset.id), ['00000002']);
  assert.equal(filter_catalog(assets, { ...DEFAULT_FILTERS, category: 'chairs' }, new Set()).length, 2);
  assert.equal(filter_catalog(assets, { ...DEFAULT_FILTERS, max_dimension: 1 }, new Set()).length, 1);
  assert.equal(filter_catalog(assets, { ...DEFAULT_FILTERS, photo: true }, new Set()).length, 1);
  assert.equal(filter_catalog(assets, { ...DEFAULT_FILTERS, unique: true }, new Set()).length, 2);
});

test('saved selections and exports retain asset identity, provenance, scale, and local paths', () => {
  const selected = filter_catalog(assets, { ...DEFAULT_FILTERS, saved: true }, new Set(['00000002']));
  const manifest = selection_manifest(selected);
  assert.equal(manifest.assetCount, 1);
  assert.equal(manifest.units, 'meters');
  assert.equal(manifest.upAxis, 'Y');
  assert.equal(manifest.assets[0].sha256, 'same');
  assert.equal(manifest.assets[0].sourceUrl, 'https://example.com/2.glb');
  assert.equal(manifest.assets[0].localRelativePath, 'raw/00000002/model.glb');
  assert.deepEqual(manifest.assets[0].categoryPath, ['Chairs', 'Office chairs']);
});
