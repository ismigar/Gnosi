import { useEffect, useState } from 'react';

import { subscribeAppEvent } from '../platform/app-events';
import {
  defineStorageKey,
  readStorage,
  stringStorageCodec,
} from '../platform/browser-storage';


export type ThemePreference = 'dark' | 'light' | 'system';
export type EffectiveTheme = Exclude<ThemePreference, 'system'>;


export interface ThemeState {
  readonly effectiveTheme: EffectiveTheme;
  readonly isDark: boolean;
  readonly themePreference: ThemePreference;
}


const THEME_KEY = defineStorageKey('db-theme', stringStorageCodec);


function readThemePreference(): ThemePreference {
  const preference = readStorage(THEME_KEY);
  return preference === 'dark' || preference === 'light' ? preference : 'system';
}


function resolveEffectiveTheme(preference: ThemePreference): EffectiveTheme {
  if (preference === 'dark' || preference === 'light') return preference;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}


export function useTheme(): ThemeState {
  const [themePreference, setThemePreference] = useState(readThemePreference);
  const [effectiveTheme, setEffectiveTheme] = useState<EffectiveTheme>('light');

  useEffect(() => {
    const updateEffectiveTheme = () => {
      const preference = readThemePreference();
      setThemePreference(preference);
      setEffectiveTheme(resolveEffectiveTheme(preference));
    };

    updateEffectiveTheme();

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemChange = () => {
      if (readThemePreference() === 'system') updateEffectiveTheme();
    };
    const unsubscribeTheme = subscribeAppEvent('db-theme-changed', updateEffectiveTheme);
    mediaQuery.addEventListener('change', handleSystemChange);

    return () => {
      unsubscribeTheme();
      mediaQuery.removeEventListener('change', handleSystemChange);
    };
  }, []);

  return {
    themePreference,
    effectiveTheme,
    isDark: effectiveTheme === 'dark',
  };
}
