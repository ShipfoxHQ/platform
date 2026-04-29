import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const migrationsPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');
