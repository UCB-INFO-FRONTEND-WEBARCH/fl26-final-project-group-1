import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SiteHeader } from './site_header.jsx';
import { Icon } from './icons.jsx';
import { SITE_BASE } from './asset_paths.js';
import {
  ASSET_BASE, DEFAULT_FILTERS, prepare_catalog, filter_catalog,
  format_article, format_bytes, selection_manifest,
} from './catalog_data.js';
import './style.css';
import './catalog.css';

const PAGE_SIZE = 24;
const SELECTION_KEY = 'roboplay-ikea-selection';
const DEPARTMENTS = ['700640', 'st001', 'fu002', 'fu004', 'bm001', 'li001', 'ka001', 'de001', 'bc001', 'od001'];

async function read_catalog(path, signal) {
  const response = await fetch(`${ASSET_BASE}data/${path}`, { signal });
  if (!response.ok) throw new Error('The asset collection could not be loaded. Check the connection and try again.');
  return response.json();
}

function Catalog() {
  const results_ref = useRef(null);
  const [library, set_library] = useState(null);
  const [error, set_error] = useState('');
  const [progress, set_progress] = useState(0);
  const [filters, set_filters] = useState(DEFAULT_FILTERS);
  const [page, set_page] = useState(0);
  const [current, set_current] = useState(null);
  const [all_departments, set_all_departments] = useState(false);
  const [filters_open, set_filters_open] = useState(false);
  const [notice, set_notice] = useState('');
  const [selection, set_selection] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SELECTION_KEY) || '[]');
      return new Set(Array.isArray(saved) ? saved.filter((id) => /^\d{8}$/.test(id)) : []);
    } catch { return new Set(); }
  });
  const deferred_query = useDeferredValue(filters.query);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const manifest = await read_catalog('manifest.json', controller.signal);
        let loaded = 0;
        const chunks = await Promise.all(manifest.chunks.map(async (name) => {
          const rows = await read_catalog(name, controller.signal);
          set_progress(++loaded / manifest.chunks.length);
          return rows;
        }));
        const assets = prepare_catalog(chunks.flat(), manifest.columns, manifest.categories);
        set_library({ ...manifest, assets });
      } catch (exception) {
        if (!controller.signal.aborted) set_error(exception.message);
      }
    }
    load();
    return () => controller.abort();
  }, []);

  const results = useMemo(() => library
    ? filter_catalog(library.assets, { ...filters, query: deferred_query }, selection) : [],
  [library, filters, deferred_query, selection]);
  const page_count = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const current_page = Math.min(page, page_count - 1);
  const category = library?.categories.find((item) => item.path.join('/') === filters.category);
  const departments = library?.categories.filter((item) => item.path.length === 1).sort((a, b) => {
    const first = DEPARTMENTS.indexOf(a.path[0]);
    const second = DEPARTMENTS.indexOf(b.path[0]);
    return (first < 0 ? 100 : first) - (second < 0 ? 100 : second) || a.name.localeCompare(b.name);
  }) || [];
  const subcategories = library?.categories.filter((item) =>
    item.path.slice(0, -1).join('/') === filters.category && item.path.length > 1) || [];

  function update_filter(key, value) {
    set_filters((previous) => ({ ...previous, [key]: value }));
    set_page(0);
  }

  function reset_filters() {
    set_filters({ ...DEFAULT_FILTERS, saved: filters.saved });
    set_page(0);
  }

  function change_page(next) {
    set_page(next);
    results_ref.current.scrollIntoView({ block: 'start' });
  }

  function toggle_selection(id) {
    const updated = new Set(selection);
    if (updated.has(id)) updated.delete(id);
    else updated.add(id);
    set_selection(updated);
    try { localStorage.setItem(SELECTION_KEY, JSON.stringify([...updated])); }
    catch { set_notice('Your selection could not be saved in this browser. Export a copy to keep it.'); }
  }

  function export_selection() {
    const chosen = library.assets.filter((asset) => selection.has(asset.id));
    const url = URL.createObjectURL(new Blob([`${JSON.stringify(selection_manifest(chosen), null, 2)}\n`],
      { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'roboplay-ikea-selection.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    set_notice(`Exported ${chosen.length.toLocaleString()} assets. Placement and collision geometry are assigned when importing a scene.`);
  }

  return (
    <div className="app-shell catalog-shell">
      <SiteHeader current="catalog">
        <div className={`live-status ${error ? 'inactive' : ''}`}><i />{error ? 'Library unavailable' : library ? 'Collection ready' : 'Connecting library'}</div>
        <a className="nav-cta" href={`${SITE_BASE}#playground`}>Open playground <span aria-hidden="true">↗</span></a>
      </SiteHeader>

      <section className="workspace-title catalog-title" aria-labelledby="page-title">
        <div className="eyebrow">The building blocks of your next world.</div>
        <h1 id="page-title">Every piece. <span>More possibilities.</span></h1>
        <p>Explore the IKEA collection. Inspect in 3D. Make it your own.</p>
        <div className="collection-stats" aria-label="Collection summary">
          <span><strong>{library?.total.toLocaleString() || '36,447'}</strong> models</span>
          <span><strong>{library?.uniqueGeometry.toLocaleString() || '26,561'}</strong> unique files</span>
          <span><strong>{library?.photographed.toLocaleString() || '33,763'}</strong> with photos</span>
          <span className="collection-format">GLB · METRES · Y UP</span>
        </div>
      </section>

      <main className="catalog-workspace" id="library">
        <button className="mobile-filters secondary-button" aria-expanded={filters_open} aria-controls="catalog-filters" onClick={() => set_filters_open(!filters_open)}>
          {filters_open ? 'Hide filters' : 'Filters & saved assets'}<span>{filters_open ? '−' : '+'}</span>
        </button>
        <aside className={`catalog-sidebar ${filters_open ? 'is-open' : ''}`} id="catalog-filters" aria-label="Asset filters">
          <div className="filter-heading"><h2>Find your pieces.</h2><button onClick={reset_filters}>Reset</button></div>
          <div className="library-tabs" role="group" aria-label="Collection view">
            <button aria-pressed={!filters.saved} onClick={() => update_filter('saved', false)}>All assets</button>
            <button aria-pressed={filters.saved} onClick={() => update_filter('saved', true)}>Saved <span>{selection.size}</span></button>
          </div>
          <section className="catalog-filter-section departments">
            <h3>Departments</h3>
            <button className={!filters.category ? 'active' : ''} onClick={() => update_filter('category', '')}>
              <span>All departments</span><small>{library?.total.toLocaleString() || '—'}</small>
            </button>
            {departments.filter((item, index) => all_departments || index < 10 || filters.category.split('/')[0] === item.path[0]).map((item) => (
              <button key={item.path[0]} className={filters.category.split('/')[0] === item.path[0] ? 'active' : ''}
                onClick={() => update_filter('category', item.path[0])}>
                <span>{item.name}</span><small>{item.count.toLocaleString()}</small>
              </button>
            ))}
            {library && <button className="more-departments" onClick={() => set_all_departments(!all_departments)}>
              {all_departments ? 'Show fewer' : 'All departments'}<span>{all_departments ? '−' : '+'}</span>
            </button>}
          </section>
          <section className="catalog-filter-section">
            <h3>Color <span>{filters.colors.length ? `${filters.colors.length} selected` : 'Any color'}</span></h3>
            <div className="color-filters">
              {library?.colors.map((color) => (
                <button key={color.id} className="color-swatch" title={color.name} aria-label={color.name}
                  aria-pressed={filters.colors.includes(color.id)}
                  style={{ '--swatch': color.hex ? `#${color.hex}` : 'conic-gradient(#e8bd6c, #c77d8c, #85a991, #88a8d6, #e8bd6c)' }}
                  onClick={() => update_filter('colors', filters.colors.includes(color.id)
                    ? filters.colors.filter((id) => id !== color.id) : [...filters.colors, color.id])} />
              ))}
            </div>
            <p className="filter-note">Colors follow the product variant description.</p>
          </section>
          <section className="catalog-filter-section filter-limits">
            <h3>Narrow it down</h3>
            <label>Model file size
              <select value={filters.max_file} onChange={(event) => update_filter('max_file', event.target.value)}>
                <option value="">Any file size</option><option value="100000">Up to 100 KB</option>
                <option value="500000">Up to 500 KB</option><option value="1000000">Up to 1 MB</option><option value="5000000">Up to 5 MB</option>
              </select>
            </label>
            <label>Longest dimension
              <select value={filters.max_dimension} onChange={(event) => update_filter('max_dimension', event.target.value)}>
                <option value="">Any dimension</option><option value="0.5">Up to 0.5 m</option>
                <option value="1">Up to 1 m</option><option value="2">Up to 2 m</option><option value="3">Up to 3 m</option>
              </select>
            </label>
            <label className="filter-checkbox"><input type="checkbox" checked={filters.photo}
              onChange={(event) => update_filter('photo', event.target.checked)} />With product photos</label>
            <label className="filter-checkbox"><input type="checkbox" checked={filters.unique}
              onChange={(event) => update_filter('unique', event.target.checked)} />Unique model files</label>
          </section>
          <div className="library-note"><Icon name="info" size={17} /><p>Save the pieces you love. Export your selection for a future scene.</p></div>
        </aside>

        <section className="catalog-results" aria-label="Asset catalog" ref={results_ref}>
          <div className="catalog-search-row">
            <label className="catalog-search">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg>
              <input type="search" aria-label="Search assets" placeholder="Search a piece, a series, an article number…"
                value={filters.query} onChange={(event) => update_filter('query', event.target.value)} />
              {filters.query && <button className="clear-search" aria-label="Clear search" onClick={() => update_filter('query', '')}>×</button>}
            </label>
            <button className="secondary-button export-selection" disabled={!library || !selection.size} onClick={export_selection}>
              Export selection <span aria-hidden="true">↗</span>
            </button>
          </div>
          <div className="catalog-breadcrumbs" aria-label="Category path">
            <button onClick={() => update_filter('category', '')}>{filters.saved ? 'Saved assets' : 'All assets'}</button>
            {category?.path.map((_, index) => {
              const path = category.path.slice(0, index + 1).join('/');
              const label = library.categories.find((item) => item.path.join('/') === path)?.name;
              return <React.Fragment key={path}><span>/</span><button onClick={() => update_filter('category', path)}>{label}</button></React.Fragment>;
            })}
          </div>
          <div className="catalog-result-heading">
            <div><h2>{filters.saved ? 'Your collection.' : category?.name || 'A world of possibilities.'}</h2>
              <p role="status">{library ? `${results.length.toLocaleString()} ${results.length === 1 ? 'asset' : 'assets'}${filters.query ? ` matching “${filters.query}”` : ' to explore'}` : 'Preparing the local collection…'}</p>
            </div>
            <label className="catalog-sort">Sort by
              <select value={filters.sort} onChange={(event) => update_filter('sort', event.target.value)}>
                <option value="featured">Featured</option><option value="name">Name A–Z</option>
                <option value="smallest">Smallest file</option><option value="largest">Largest file</option>
              </select>
            </label>
          </div>
          {subcategories.length > 0 && <div className="subcategory-list" aria-label="Subcategories">
            {subcategories.map((item) => <button key={item.path.join('/')} onClick={() => update_filter('category', item.path.join('/'))}>
              {item.name}<small>{item.count.toLocaleString()}</small>
            </button>)}
          </div>}
          {(filters.colors.length > 0 || filters.photo || filters.unique || filters.max_file || filters.max_dimension) && (
            <div className="active-filters">
              {filters.colors.map((id) => <button key={id} onClick={() => update_filter('colors', filters.colors.filter((color) => color !== id))}>
                {library?.colors.find((color) => color.id === id)?.name} ×</button>)}
              {filters.photo && <button onClick={() => update_filter('photo', false)}>With photos ×</button>}
              {filters.unique && <button onClick={() => update_filter('unique', false)}>Unique files ×</button>}
              {filters.max_file && <button onClick={() => update_filter('max_file', '')}>Up to {format_bytes(Number(filters.max_file))} ×</button>}
              {filters.max_dimension && <button onClick={() => update_filter('max_dimension', '')}>Up to {filters.max_dimension} m ×</button>}
              <button className="clear-filters" onClick={reset_filters}>Clear filters</button>
            </div>
          )}
          {error ? <div className="catalog-empty" role="alert"><Icon name="info" size={28} /><h3>The library could not load.</h3><p>{error}</p>
            <button className="primary-button" onClick={() => location.reload()}>Try again</button></div>
            : !library ? <div className="catalog-loading" role="status"><span className="loader" /><p>Opening your collection…</p><progress value={progress} max="1" aria-label="Loading catalog" /></div>
              : !results.length ? <div className="catalog-empty"><Icon name="grid" size={32} /><h3>{filters.saved ? 'Your next scene starts here.' : 'No pieces found.'}</h3>
                <p>{filters.saved && !selection.size ? 'Use + on any piece to save it to your collection.' : 'Try another search or reset your filters.'}</p>
                <button className="secondary-button" onClick={reset_filters}>Reset filters</button></div>
                : <>
                  <div className="asset-grid" aria-busy={deferred_query !== filters.query}>
                    {results.slice(current_page * PAGE_SIZE, (current_page + 1) * PAGE_SIZE).map((asset) => (
                      <AssetCard key={asset.id} asset={asset} selected={selection.has(asset.id)}
                        on_preview={() => set_current(asset)} on_select={() => toggle_selection(asset.id)} />
                    ))}
                  </div>
                  <div className="catalog-pagination">
                    <span>Showing {(current_page * PAGE_SIZE + 1).toLocaleString()}–{Math.min((current_page + 1) * PAGE_SIZE, results.length).toLocaleString()} of {results.length.toLocaleString()}</span>
                    <div><button className="secondary-button" disabled={current_page === 0} onClick={() => change_page(current_page - 1)}>← Previous</button>
                      <span>{current_page + 1} / {page_count.toLocaleString()}</span>
                      <button className="secondary-button" disabled={current_page + 1 >= page_count} onClick={() => change_page(current_page + 1)}>Next →</button></div>
                  </div>
                </>}
          {notice && <div className="catalog-notice" role="status"><span>{notice}</span><button aria-label="Dismiss notice" onClick={() => set_notice('')}>×</button></div>}
          <footer className="catalog-footer"><span>Original materials. Real proportions.</span><span>IKEA collection · Snapshot {library?.snapshot || '2026-10-28'}</span></footer>
        </section>
      </main>
      {current && <AssetPreview asset={current} selected={selection.has(current.id)} on_select={() => toggle_selection(current.id)} on_close={() => set_current(null)} />}
    </div>
  );
}

function AssetCard({ asset, selected, on_preview, on_select }) {
  const [image_failed, set_image_failed] = useState(false);
  return (
    <article className="asset-card">
      <div className="asset-image">
        <button className="asset-preview-button" onClick={on_preview} aria-label={`Preview ${asset.name} ${asset.type}, article ${format_article(asset.id)}`}>
          {asset.image && !image_failed ? <img src={asset.image} alt={`${asset.name} ${asset.variant}`} loading="lazy" decoding="async" onError={() => set_image_failed(true)} />
            : <span className="asset-placeholder"><Icon name="grid" size={42} /><span>Explore in 3D</span></span>}
          <span className="asset-preview-hint">Explore in 3D <span>↗</span></span>
        </button>
        <span className="asset-format">3D / GLB</span>
        <button className="asset-save" onClick={on_select} aria-pressed={selected}
          aria-label={`${selected ? 'Remove' : 'Save'} ${asset.name}, article ${format_article(asset.id)}`}>{selected ? '✓' : '+'}</button>
      </div>
      <div className="asset-info">
        <div className="asset-heading"><button onClick={on_preview}>{asset.name}</button><span>{format_bytes(asset.bytes)}</span></div>
        <p className="asset-type" title={asset.type}>{asset.type}</p>
        <p className="asset-variant" title={asset.variant}>{asset.variant || 'Original product model'}</p>
        <div className="asset-meta"><code>{format_article(asset.id)}</code><span>View asset ↗</span></div>
      </div>
    </article>
  );
}

function AssetPreview({ asset, selected, on_select, on_close }) {
  const dialog_ref = useRef(null);
  const viewport_ref = useRef(null);
  const view_ref = useRef(null);
  const [bounds, set_bounds] = useState(null);
  const [error, set_error] = useState('');
  const [attempt, set_attempt] = useState(0);
  const [camera, set_camera] = useState('perspective');
  const [options, set_options] = useState({ wireframe: false, grid: true, rotate: false });

  useEffect(() => {
    const dialog = dialog_ref.current;
    dialog.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = overflow; dialog.close(); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let view;
    set_bounds(null);
    set_error('');
    async function load() {
      try {
        const { AssetView } = await import('./asset_view.js');
        if (controller.signal.aborted) return;
        view = new AssetView(viewport_ref.current);
        view_ref.current = view;
        const measured = await view.load(asset.model_url, controller.signal);
        if (!controller.signal.aborted) {
          set_bounds(measured);
          set_camera('perspective');
        }
      } catch (exception) {
        if (!controller.signal.aborted) set_error(exception.message);
      }
    }
    load();
    return () => { controller.abort(); view?.dispose(); view_ref.current = null; };
  }, [asset.id, attempt]);

  useEffect(() => { view_ref.current?.set_options(options); }, [options, bounds]);

  return (
    <dialog className="asset-dialog" ref={dialog_ref} aria-labelledby="preview-title" onCancel={(event) => { event.preventDefault(); on_close(); }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) on_close();
      }}>
      <div className="asset-dialog-header"><span>THE ASSET INSPECTOR</span><button className="icon-button" aria-label="Close preview" onClick={on_close} autoFocus><Icon name="close" /></button></div>
      <div className="asset-dialog-body">
        <div className="asset-viewport-shell">
          <div className="asset-viewport" ref={viewport_ref} />
          <span className="preview-mode">{options.wireframe ? 'WIREFRAME' : 'MATERIAL VIEW'} / GLB</span>
          {!bounds && <div className="preview-loading" role={error ? 'alert' : 'status'}>
            {error ? <><Icon name="info" size={28} /><strong>This preview could not load.</strong><p>{error}</p><button className="secondary-button" onClick={() => set_attempt(attempt + 1)}>Retry preview</button></>
              : <><span className="loader" /><p>Opening geometry and materials…</p></>}
          </div>}
          <div className="preview-cameras" role="group" aria-label="Preview camera">
            {[['perspective', 'Orbit'], ['front', 'Front'], ['top', 'Top']].map(([mode, label]) =>
              <button key={mode} aria-pressed={camera === mode} onClick={() => { view_ref.current?.set_camera(mode); set_camera(mode); }}>{label}</button>)}
          </div>
          <div className="preview-tools" role="group" aria-label="Preview display">
            {[['rotate', 'Auto-rotate'], ['wireframe', 'Wireframe'], ['grid', 'Grid']].map(([key, label]) =>
              <button key={key} aria-pressed={options[key]} onClick={() => set_options({ ...options, [key]: !options[key] })}>{label}</button>)}
          </div>
          <span className="preview-mouse-hint">Drag to orbit · scroll to zoom · right-drag to pan</span>
        </div>
        <div className="asset-details">
          <span className="eyebrow">IKEA COLLECTION</span><h2 id="preview-title">{asset.name}</h2>
          <p className="preview-type">{asset.type}</p><p className="preview-variant">{asset.variant}</p>
          {asset.inferred && <p className="inferred-note">Variant description inferred from the product series.</p>}
          <div className="preview-article"><span>ARTICLE NUMBER</span><code>{format_article(asset.id)}</code></div>
          <button className="primary-button preview-save" aria-pressed={selected} onClick={on_select}>{selected ? 'Saved to your collection' : 'Save to collection'}<span>{selected ? '✓' : '+'}</span></button>
          <a className="secondary-button model-download" href={asset.model_url} download={`ikea-${asset.id}.glb`}>Download GLB <span>↓</span></a>
          <section className="preview-specs"><h3>Made to measure.</h3>
            {bounds ? <><div className="model-dimensions">{['Width', 'Height', 'Depth'].map((label, index) => <div key={label}><strong>{bounds.size[index].toFixed(2)}</strong><span>{label} / m</span></div>)}</div>
              <p>Measured model bounds. Metres, with Y up.</p><dl><div><dt>Geometry</dt><dd>{bounds.triangles.toLocaleString()} triangles</dd></div><div><dt>File size</dt><dd>{format_bytes(asset.bytes)}</dd></div></dl></>
              : <p>Model measurements appear after the preview loads.</p>}
            {Object.keys(asset.dimensions).length > 0 && <details><summary>Product dimensions</summary><dl>{Object.entries(asset.dimensions).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value.toFixed(2)} m</dd></div>)}</dl></details>}
          </section>
          <div className="preview-provenance"><span>{asset.category_labels.join(' / ')}</span><p>Original model and materials. Placement and collision geometry are assigned when importing a scene.</p>
            {asset.productUrl && <a href={asset.productUrl} target="_blank" rel="noreferrer">View original product <Icon name="external" size={13} /></a>}
          </div>
        </div>
      </div>
    </dialog>
  );
}

createRoot(document.getElementById('root')).render(<Catalog />);
