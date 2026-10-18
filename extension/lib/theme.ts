const STORAGE_KEY = 'theme';

export type Theme = 'light' | 'dark';

export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark';
}

/** Sync read for React initial state (mirrors boot script). */
export function readThemeSync(): Theme {
  try {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (isTheme(cached)) return cached;
  } catch {
    // ignore
  }
  const attr = document.documentElement.getAttribute('data-theme');
  if (isTheme(attr)) return attr;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

export function persistTheme(theme: Theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // ignore
  }
  if (typeof browser !== 'undefined' && browser.storage?.local) {
    void browser.storage.local.set({ [STORAGE_KEY]: theme });
  }
}

export { STORAGE_KEY as THEME_STORAGE_KEY };
