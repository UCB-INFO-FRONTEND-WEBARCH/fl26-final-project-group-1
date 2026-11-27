export const THEME_EVENT = 'centoria-theme-change';
const STORAGE_KEY = 'centoria-theme';

export function resolve_theme(stored, system_dark) {
  return stored === 'light' || stored === 'dark' ? stored : system_dark ? 'dark' : 'light';
}

function stored_theme() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

function apply_theme(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#10151e' : '#fafbfc');
  window.dispatchEvent(new Event(THEME_EVENT));
}

export function get_theme() {
  return document.documentElement.dataset.theme || 'light';
}

export function set_theme(theme) {
  if (theme !== 'light' && theme !== 'dark') return;
  try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* Keep the in-memory choice when storage is blocked. */ }
  apply_theme(theme);
}

if (typeof window !== 'undefined') {
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  apply_theme(resolve_theme(stored_theme(), system.matches));
  system.addEventListener('change', () => {
    if (!['light', 'dark'].includes(stored_theme())) apply_theme(resolve_theme(null, system.matches));
  });
  window.addEventListener('storage', event => {
    if (event.key === STORAGE_KEY) apply_theme(resolve_theme(event.newValue, system.matches));
  });
}
