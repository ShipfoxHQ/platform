import '@testing-library/jest-dom/vitest';

Object.defineProperty(window, 'scrollTo', {
  configurable: true,
  value: () => undefined,
});

Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: (query: string) => ({
    addEventListener: () => undefined,
    addListener: () => undefined,
    dispatchEvent: () => false,
    matches: false,
    media: query,
    onchange: null,
    removeEventListener: () => undefined,
    removeListener: () => undefined,
  }),
});
