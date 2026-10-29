import React from 'react';
import { Icon } from './icons.jsx';
import { SITE_BASE } from './asset_paths.js';

export function SiteHeader({ current, children }) {
  return (
    <header className="app-header">
      <a className="brand" href={SITE_BASE} aria-label="RoboPlay home">
        <span className="brand-symbol"><Icon name="robot" size={23} /></span>
        RoboPlay
      </a>
      <nav className="header-nav" aria-label="Main navigation">
        <a href={`${SITE_BASE}#playground`} aria-current={current === 'playground' ? 'page' : undefined}>Playground</a>
        <a href={`${SITE_BASE}catalog/`} aria-current={current === 'catalog' ? 'page' : undefined}>Asset library</a>
      </nav>
      {children}
    </header>
  );
}
