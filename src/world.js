import { HEPHAESTUS_MAP } from './hephaestus_data.js';
// One build-time selection is shared by UI, renderer and simulation worker.
// Node regression fixtures opt into the earlier demo explicitly.
export const WORLD_ID = import.meta.env?.VITE_PLAYGROUND_MAP || globalThis.process?.env?.CENTORIA_MAP || 'hephaestus';
if (!['hephaestus', 'demo'].includes(WORLD_ID)) throw new Error(`Unknown playground map: ${WORLD_ID}`);
export const IS_HEPHAESTUS = WORLD_ID === 'hephaestus';
export const MAP = HEPHAESTUS_MAP;
export const HAS_ELEVATOR = !IS_HEPHAESTUS;
export const DEFAULT_TRANSFER = HAS_ELEVATOR ? 'elevator' : 'stairs';
export const MAP_TITLE = IS_HEPHAESTUS ? 'Hephaestus Tower' : 'Demo apartment';
export const MAP_SIZE = IS_HEPHAESTUS ? `${(MAP.bounds[1]-MAP.bounds[0]).toFixed(2)} × ${(MAP.bounds[3]-MAP.bounds[2]).toFixed(2)} m` : '19 × 14 m';
