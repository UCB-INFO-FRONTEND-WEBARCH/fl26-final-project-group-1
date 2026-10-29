import { IKEA_BASE } from './asset_paths.js';
export { IKEA_BASE as ASSET_BASE };
export const DEFAULT_FILTERS = {
  query: '', category: '', colors: [], max_file: '', max_dimension: '',
  photo: false, unique: false, sort: 'featured', saved: false,
};
const FEATURED = ['MARKUS', 'LACK', 'KIVIK', 'BILLY', 'KALLAX', 'POÄNG', 'HEMNES', 'PAX',
  'MALM', 'LISABO', 'RÅSKOG', 'STOCKHOLM', 'BESTÅ', 'VIMLE', 'EKET', 'STRANDMON'];

export function normalize(value) {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/ø/g, 'o').replace(/ł/g, 'l').replace(/\./g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function format_bytes(bytes) {
  return bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

export function format_article(id) {
  return `${id.slice(0, 3)}.${id.slice(3, 6)}.${id.slice(6)}`;
}

export function prepare_catalog(rows, columns, categories) {
  const labels = new Map(categories.map((category) => [category.path.join('/'), category.name]));
  const assets = rows.map((row) => {
    const asset = Object.fromEntries(columns.map((column, index) => [column, row[index]]));
    asset.category = asset.path.join('/');
    asset.category_labels = asset.path.map((_, index) => labels.get(asset.path.slice(0, index + 1).join('/')));
    asset.search = normalize([asset.name, asset.type, asset.variant, asset.id, ...asset.category_labels].join(' '));
    asset.max_dimension = Math.max(0, ...Object.values(asset.dimensions));
    asset.model_url = `${IKEA_BASE}raw/${asset.id}/model.glb`;
    asset.image = asset.image ? `${IKEA_BASE}${asset.image.slice(1)}` : '';
    const rank = FEATURED.indexOf(asset.name);
    asset.rank = rank < 0 ? 2000 : rank + 1000;
    return asset;
  });
  for (const [rank, name] of FEATURED.entries()) {
    const candidates = assets.filter((asset) => asset.name === name);
    const english = candidates.filter((asset) => /\/(us|gb)\/en\//.test(asset.productUrl));
    const ordered = [...english, ...candidates.filter((asset) => !english.includes(asset))];
    // Feature complete furniture before covers, spare parts, and color variants.
    const first = ordered.find((asset) => asset.image && !/cover|cushion|door|front|leg|shelf|insert|mirror/i.test(asset.type))
      || ordered.find((asset) => asset.image) || ordered[0];
    if (first) first.rank = rank;
  }
  return assets;
}

export function filter_catalog(assets, filters, selection) {
  const words = normalize(filters.query).split(' ').filter(Boolean);
  const matches = assets.filter((asset) =>
    (!filters.saved || selection.has(asset.id)) &&
    (!filters.category || asset.category === filters.category || asset.category.startsWith(`${filters.category}/`)) &&
    words.every((word) => asset.search.includes(word)) &&
    (!filters.colors.length || asset.colors.some((color) => filters.colors.includes(color))) &&
    (!filters.max_file || asset.bytes <= Number(filters.max_file)) &&
    (!filters.max_dimension || (asset.max_dimension > 0 && asset.max_dimension <= Number(filters.max_dimension))) &&
    (!filters.photo || asset.image));
  matches.sort((a, b) => {
    if (filters.sort === 'smallest') return a.bytes - b.bytes || a.id.localeCompare(b.id);
    if (filters.sort === 'largest') return b.bytes - a.bytes || a.id.localeCompare(b.id);
    if (filters.sort === 'featured' && a.rank !== b.rank) return a.rank - b.rank;
    return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });
  if (!filters.unique) return matches;
  const seen = new Set();
  return matches.filter((asset) => {
    if (seen.has(asset.hash)) return false;
    seen.add(asset.hash);
    return true;
  });
}

export function selection_manifest(assets) {
  return {
    schema: 'roboplay.asset-selection/v1', createdAt: new Date().toISOString(),
    units: 'meters', upAxis: 'Y', assetCount: assets.length,
    assets: assets.map((asset) => ({
      articleId: asset.id, name: asset.name, type: asset.type, variant: asset.variant,
      categoryIds: asset.path, categoryPath: asset.category_labels, sourceUrl: asset.url,
      modelUrl: asset.model_url,
      localRelativePath: `raw/${asset.id}/model.glb`, bytes: asset.bytes, sha256: asset.hash,
      productDimensionsMeters: asset.dimensions, metadataInferred: asset.inferred,
    })),
  };
}
