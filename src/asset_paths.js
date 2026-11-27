export const SITE_BASE = import.meta.env?.BASE_URL || '/';
const collection = import.meta.env?.VITE_IKEA_BASE_URL || `${SITE_BASE}assets/ikea/`;
export const IKEA_BASE = `${collection.replace(/\/+$/, '')}/`;

export function model_path(article) {
  return `raw/${article.slice(0, 2)}/${article}/model.glb`;
}

export function image_path(path) {
  const filename = path.split('/').pop();
  return `thumbnails/${filename.slice(0, 2)}/${filename}`;
}
