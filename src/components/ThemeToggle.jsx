import React from 'react';
import { useStore } from '../lib/store.js';

export default function ThemeToggle() {
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const isDark = theme === 'dark';
  return (
    <button
      className="btn ghost icon-btn"
      onClick={toggleTheme}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-label="Toggle theme"
    >
      {isDark ? '☀︎ Light' : '☾ Dark'}
    </button>
  );
}
