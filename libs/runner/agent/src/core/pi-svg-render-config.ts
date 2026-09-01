export const PI_SVG_RASTERIZATION_LIMITS = {
  maxInputBytes: 1 * 1024 * 1024,
  maxOutputEdge: 2_000,
  maxOutputPixels: 4_000_000,
  maxPngBytes: 3 * 1024 * 1024,
  workerDeadlineMs: 2_000,
  resultBudgetMs: 5_000,
  maxWorkers: 2,
  maxQueuedRenders: 32,
} as const;

export const PI_SVG_FONT_ASSET_FILENAMES = [
  'ibm-plex-sans-var-roman-latin1.woff2',
  'ibm-plex-sans-var-roman-latin2.woff2',
  'ibm-plex-sans-var-roman-latin3.woff2',
  'ibm-plex-sans-var-roman-pi.woff2',
] as const;

export const PI_SVG_LICENSE_ASSET_FILENAME = 'ibm-plex-sans-OFL.txt';
