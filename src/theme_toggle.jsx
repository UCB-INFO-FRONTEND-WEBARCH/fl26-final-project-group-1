import React, { useEffect, useState } from 'react';
import { Icon } from './icons.jsx';
import { get_theme, set_theme, THEME_EVENT } from './theme.js';
import './theme.css';

export function ThemeToggle() {
  const [theme, update_theme] = useState(get_theme);
  useEffect(() => {
    const changed = () => update_theme(get_theme());
    window.addEventListener(THEME_EVENT, changed);
    return () => window.removeEventListener(THEME_EVENT, changed);
  }, []);
  const next = theme === 'dark' ? 'light' : 'dark';
  return <button className="theme-toggle" aria-label={`Switch to ${next} theme`}
    title={`Switch to ${next} theme`} onClick={() => set_theme(next)}>
    <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
  </button>;
}
