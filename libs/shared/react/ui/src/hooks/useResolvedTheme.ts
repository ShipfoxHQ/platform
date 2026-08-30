'use client';

import {useSyncExternalStore} from 'react';
import {useTheme} from './useTheme.js';

const noop = () => undefined;

export function useResolvedTheme(): 'light' | 'dark' {
  const {theme} = useTheme();

  const systemTheme = useSyncExternalStore<'light' | 'dark'>(
    (callback) => {
      if (typeof window === 'undefined' || theme !== 'system') {
        return noop;
      }
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      mql.addEventListener('change', callback);
      return () => {
        mql.removeEventListener('change', callback);
      };
    },
    (): 'light' | 'dark' => {
      if (typeof window === 'undefined' || theme !== 'system') return 'light';
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    },
    (): 'light' | 'dark' => 'light',
  );

  if (theme === 'system') {
    return systemTheme;
  }
  return theme as 'light' | 'dark';
}
