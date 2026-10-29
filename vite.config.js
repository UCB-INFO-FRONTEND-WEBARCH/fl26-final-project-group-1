import { defineConfig } from 'vite';
import { ikea_assets } from './scripts/serve_ikea.js';

export default defineConfig({
  plugins: [ikea_assets()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@mujoco/mujoco', 'onnxruntime-web'] },
  build: {
    target: 'es2022',
    rollupOptions: { input: ['index.html', 'catalog/index.html'] },
  },
});
