import {readFileSync} from 'node:fs';
import {createConfig, num, str} from '@shipfox/config';
import {MAX_RUNNER_LABELS, parseRunnerCatalog, type RunnerCatalog} from '@shipfox/runner-labels';
import yaml from 'js-yaml';

export const config = createConfig({
  RUNNER_CATALOG_PATH: str({
    desc: 'Path to the YAML file that maps runner catalog names to complete label sets. Leave it empty to use every job runner value as a literal label. The file is loaded at startup; restart the API after changing it.',
    default: '',
  }),
  WORKFLOWS_TOOL_STEP_POLL_INTERVAL_MS: num({
    desc: 'Delay, in milliseconds, between scans for due server-executed tool-step invocations.',
    default: 1000,
  }),
  WORKFLOWS_TOOL_STEP_EXECUTOR_CONCURRENCY: num({
    desc: 'Maximum number of server-executed tool-step invocations claimed in one executor pass.',
    default: 8,
  }),
  WORKFLOWS_TOOL_STEP_CALL_TIMEOUT_MS: num({
    desc: 'Maximum duration, in milliseconds, of one server-executed tool provider call.',
    default: 30_000,
  }),
});

if (
  !Number.isInteger(config.WORKFLOWS_TOOL_STEP_POLL_INTERVAL_MS) ||
  config.WORKFLOWS_TOOL_STEP_POLL_INTERVAL_MS < 1
) {
  throw new Error(
    `WORKFLOWS_TOOL_STEP_POLL_INTERVAL_MS (${config.WORKFLOWS_TOOL_STEP_POLL_INTERVAL_MS}) must be a whole number greater than 0.`,
  );
}
if (
  !Number.isInteger(config.WORKFLOWS_TOOL_STEP_EXECUTOR_CONCURRENCY) ||
  config.WORKFLOWS_TOOL_STEP_EXECUTOR_CONCURRENCY < 1
) {
  throw new Error(
    `WORKFLOWS_TOOL_STEP_EXECUTOR_CONCURRENCY (${config.WORKFLOWS_TOOL_STEP_EXECUTOR_CONCURRENCY}) must be a whole number greater than 0.`,
  );
}
if (
  !Number.isInteger(config.WORKFLOWS_TOOL_STEP_CALL_TIMEOUT_MS) ||
  config.WORKFLOWS_TOOL_STEP_CALL_TIMEOUT_MS < 1
) {
  throw new Error(
    `WORKFLOWS_TOOL_STEP_CALL_TIMEOUT_MS (${config.WORKFLOWS_TOOL_STEP_CALL_TIMEOUT_MS}) must be a whole number greater than 0.`,
  );
}

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
