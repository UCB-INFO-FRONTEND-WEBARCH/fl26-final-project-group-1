export const SITE_BASE = import.meta.env?.BASE_URL || '/';
const collection = import.meta.env?.VITE_IKEA_BASE_URL || `${SITE_BASE}assets/ikea/`;
export const IKEA_BASE = `${collection.replace(/\/+$/, '')}/`;
