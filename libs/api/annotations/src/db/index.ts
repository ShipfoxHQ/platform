import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const migrationsPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');

export type {
  AnnotationSummary,
  ListAnnotationsForRunAttemptParams,
  SummarizeAnnotationsForRunAttemptParams,
} from './annotations.js';
export {
  DEFAULT_ANNOTATIONS_READ_LIMIT,
  listAnnotationsForRunAttempt,
  summarizeAnnotationsForRunAttempt,
} from './annotations.js';
