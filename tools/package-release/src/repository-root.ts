import {existsSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

export function getRepositoryRoot(entryPoint: string): string {
  let directory = dirname(fileURLToPath(entryPoint));
  while (true) {
    if (existsSync(join(directory, 'publication-closure.json'))) return directory;
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error('Could not find publication-closure.json above the package entrypoint');
    }
    directory = parent;
  }
}
