import {readFileSync} from 'node:fs';
import {createConfig, str} from '@shipfox/config';
import {MAX_RUNNER_LABELS, parseRunnerCatalog, type RunnerCatalog} from '@shipfox/runner-labels';
import yaml from 'js-yaml';

export const config = createConfig({
  RUNNER_CATALOG_PATH: str({
    desc: 'Path to the YAML file that maps runner catalog names to complete label sets. Leave it empty to use every job runner value as a literal label. The file is loaded at startup; restart the API after changing it.',
    default: '',
  }),
});

/** Raised when the configured runner catalog cannot be read, parsed, or validated. */
export class RunnerCatalogConfigError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RunnerCatalogConfigError';
  }
}

export function loadRunnerCatalog(filePath: string): RunnerCatalog {
  if (filePath === '') return {};

  let contents: string;
  try {
    contents = readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new RunnerCatalogConfigError(
      `Cannot read runner catalog config at ${filePath}: ${errorMessage(error)}`,
      {cause: error},
    );
  }

  if (contents.trim() === '') return {};

  let raw: unknown;
  try {
    raw = yaml.load(contents);
  } catch (error) {
    throw new RunnerCatalogConfigError(
      `Cannot parse runner catalog config at ${filePath}: ${errorMessage(error)}`,
      {cause: error},
    );
  }

  let catalog: RunnerCatalog;
  try {
    catalog = parseRunnerCatalog(raw);
  } catch (error) {
    throw new RunnerCatalogConfigError(
      `Invalid runner catalog config at ${filePath}: ${errorMessage(error)}`,
      {cause: error},
    );
  }

  for (const [name, labels] of Object.entries(catalog)) {
    if (labels.length > MAX_RUNNER_LABELS) {
      throw new RunnerCatalogConfigError(
        `Runner catalog entry "${name}" in ${filePath} has ${labels.length} labels; the maximum is ${MAX_RUNNER_LABELS}.`,
      );
    }
  }

  return catalog;
}

export const runnerCatalog = loadRunnerCatalog(config.RUNNER_CATALOG_PATH);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
