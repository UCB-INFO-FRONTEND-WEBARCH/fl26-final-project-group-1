import * as THREE from 'three';
import { ArrivalMap } from './arrival_map.js';
import { ArrivalOpening } from './arrival_opening.js';
import { SITE_BASE } from './asset_paths.js';
import { get_theme, THEME_EVENT } from './theme.js';

export class ArrivalPreview {
  constructor() {
    this.abort = new AbortController();
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.setAttribute('aria-label', 'Aerial arrival over the Bay Area');
    this.map = new ArrivalMap();
    this.opening = new ArrivalOpening();
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color();
    this.camera = new THREE.Camera();
    this.first_frame = { level: 0, moving: false, elapsed: 0, dive_seconds: 1.05 };
    this.hold_seconds = 0;
    this.reduced_motion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.theme_handler = () => {
      this.map.night = get_theme() === 'dark';
      this.scene.background.set(this.map.night ? '#10151e' : '#ffffff');
      if (!this.active && this.map.ready) this.draw(0);
    };
    this.theme_handler();
    window.addEventListener(THEME_EVENT, this.theme_handler);
    this.resize_handler = () => {
      this.renderer.setSize(this.container?.clientWidth || window.innerWidth,
        this.container?.clientHeight || window.innerHeight);
      if (!this.active && this.map.ready) this.draw(0);
    };
    window.addEventListener('resize', this.resize_handler);
    this.resize_handler();
    this.loaded = this.map.load_overview(`${SITE_BASE}assets/arrival/`, this.abort.signal).then(() => {
      this.opening.overview_ready = true;
      // Compile shaders and upload the first image and lights while the landing page is visible.
      if (!this.active) this.draw(0);
    });
    // Play reports a preload failure. It must not become an unhandled background rejection.
    this.loaded.catch(() => {});
  }

  start(container, on_reveal, on_visible) {
    this.container = container;
    this.on_reveal = on_reveal;
    this.on_visible = on_visible;
    this.active = true;
    this.last_time = performance.now();
    container.appendChild(this.renderer.domElement);
    this.resize_handler();
    this.renderer.setAnimationLoop(time => this.render(time));
  }

  draw(seconds) {
    this.map.render(this.renderer, this.scene, this.camera, this.first_frame, this.reduced_motion ? 0 : seconds);
  }

  render(time) {
    const seconds = Math.max(0, Math.min((time - this.last_time) / 1000, 0.1));
    this.last_time = time;
    if (document.hidden) return;
    const previous_opacity = this.opening.opacity;
    const was_visible = this.opening.phase === 'complete';
    this.opening.update(seconds);
    if (previous_opacity !== this.opening.opacity) this.on_reveal(this.opening.opacity);
    if (was_visible) this.hold_seconds += seconds;
    this.draw(seconds);
    if (!this.loading_rest && this.opening.opacity >= 0.1) {
      this.loading_rest = true;
      // Give the complete overview a painted frame before starting the simulator.
      this.start_frame = requestAnimationFrame(() => this.on_visible());
    }
  }

  release() {
    this.transferred = true;
    this.stop();
    return this;
  }

  stop() {
    this.active = false;
    this.renderer.setAnimationLoop(null);
    cancelAnimationFrame(this.start_frame);
    window.removeEventListener(THEME_EVENT, this.theme_handler);
    window.removeEventListener('resize', this.resize_handler);
  }

  dispose() {
    if (this.transferred || this.disposed) return;
    this.disposed = true;
    this.abort.abort();
    this.stop();
    this.map.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
