import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const LIBRARY = new URL('../local_assets/ikea/', import.meta.url);
const PREFIX = '/assets/ikea/';
const FILES = /^(data\/(manifest|catalog-\d+)\.json|raw\/\d{8}\/model\.glb|thumbnails\/[a-f0-9]{24}\.jpg)$/;
const MIME_TYPES = { json: 'application/json', glb: 'model/gltf-binary', jpg: 'image/jpeg' };

async function serve_ikea(request, response, next) {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (!pathname.startsWith(PREFIX)) return next();
  const relative = pathname.slice(PREFIX.length);
  if (!FILES.test(relative) || !['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(404).end();
    return;
  }
  const path = fileURLToPath(new URL(relative, LIBRARY));
  let size;
  try {
    size = (await stat(path)).size;
  } catch (error) {
    if (error.code !== 'ENOENT') return next(error);
    response.writeHead(404).end('The local IKEA collection has not been imported.');
    return;
  }
  response.writeHead(200, {
    'Content-Type': MIME_TYPES[relative.split('.').pop()],
    'Content-Length': size,
    'Cache-Control': 'public, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
  });
  if (request.method === 'HEAD') return response.end();
  const stream = createReadStream(path);
  stream.on('error', (error) => response.destroy(error));
  response.on('close', () => stream.destroy());
  stream.pipe(response);
}

export function ikea_assets() {
  return {
    name: 'local-ikea-assets',
    configureServer(server) { server.middlewares.use(serve_ikea); },
    configurePreviewServer(server) { server.middlewares.use(serve_ikea); },
  };
}
