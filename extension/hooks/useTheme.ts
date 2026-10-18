import { useState, useCallback, useEffect } from 'react';
import {
  applyTheme,
  persistTheme,
  readThemeSync,
  isTheme,
  THEME_STORAGE_KEY,
  type Theme,
} from '@/lib/theme';

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(readThemeSync);

  // One-time migrate: chrome.storage → localStorage when sync cache is empty.
  useEffect(() => {
    try {
      if (localStorage.getItem(THEME_STORAGE_KEY)) return;
    } catch {
      return;
    }
    if (typeof browser === 'undefined' || !browser.storage?.local) return;
    void browser.storage.local.get(THEME_STORAGE_KEY).then((stored) => {
      const saved = stored[THEME_STORAGE_KEY];
      if (!isTheme(saved)) return;
      setThemeState(saved);
      applyTheme(saved);
      persistTheme(saved);
    });
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    applyTheme(t);
    persistTheme(t);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      try {
        if (isTheme(localStorage.getItem(THEME_STORAGE_KEY))) return;
      } catch {
        return;
      }
      setThemeState(mq.matches ? 'dark' : 'light');
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const toggle = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  return { theme, setTheme, toggle };
}
