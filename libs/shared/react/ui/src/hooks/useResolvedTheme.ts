import {useSyncExternalStore} from 'react';
import {useTheme} from './useTheme.js';

export function useResolvedTheme(): 'light' | 'dark' {
  const {theme} = useTheme();

  const systemTheme = useSyncExternalStore<'light' | 'dark'>(
    (callback) => {
      if (typeof window === 'undefined' || theme !== 'system') {
        return () => {
          // No-op unsubscribe
        };
      }
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      mql.addEventListener('change', callback);
      return () => {
        mql.removeEventListener('change', callback);
      };
    },
    (): 'light' | 'dark' =>
      typeof window !== 'undefined' && theme === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : 'light',
    (): 'light' | 'dark' => 'light', // Server snapshot
  );

  if (theme === 'system') {
    return systemTheme;
  }
  // TypeScript should narrow theme to 'light' | 'dark' here
  return theme as 'light' | 'dark';
}
