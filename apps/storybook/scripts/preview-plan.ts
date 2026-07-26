import {execFileSync} from 'node:child_process';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {storybookTurboFilters} from '../preview-manifest.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const forcePaths = [
  '.github/workflows/preview.yml',
  'apps/storybook',
  'mise.toml',
  'pnpm-lock.yaml',
  'turbo.jsonc',
];

type TurboPackage = {name?: unknown};
type TurboList = {packages?: {items?: TurboPackage[]}};

function getChangedFiles(): string[] {
  const base = process.env.TURBO_SCM_BASE;
  const head = process.env.TURBO_SCM_HEAD ?? 'HEAD';
  if (base === undefined || base.length === 0) return [];

  try {
    return execFileSync('git', ['diff', '--name-only', `${base}...${head}`], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    })
      .split('\n')
      .map((file) => file.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function getAffectedPackages(): string[] {
  const output = execFileSync('pnpm', ['exec', 'turbo', 'ls', '--affected', '--output=json'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  const jsonStart = output.indexOf('{');
  if (jsonStart === -1) throw new Error('Turbo did not return a JSON package list');

  const turboList = JSON.parse(output.slice(jsonStart)) as TurboList;
  return (turboList.packages?.items ?? [])
    .map((item) => item.name)
    .filter((name): name is string => typeof name === 'string');
}

const changedFiles = getChangedFiles();
const affectedPackages = getAffectedPackages();
const affectedStorybooks = affectedPackages.filter((packageName) =>
  storybookTurboFilters.includes(packageName as (typeof storybookTurboFilters)[number]),
);
const forcedByFile = changedFiles.some((file) =>
  forcePaths.some((path) => file === path || file.startsWith(`${path}/`)),
);
const isMainPush = process.env.GITHUB_EVENT_NAME === 'push';
const shouldDeploy = isMainPush || forcedByFile || affectedStorybooks.length > 0;

process.stdout.write(
  `${JSON.stringify(
    {
      shouldDeploy,
      reason: isMainPush
        ? 'main push'
        : forcedByFile
          ? 'preview workflow or composition configuration changed'
          : affectedStorybooks.length > 0
            ? 'Turbo affected Storybook package detected'
            : 'no Storybook package is affected',
      affectedPackages,
      affectedStorybooks,
      changedFiles,
    },
    null,
    2,
  )}\n`,
);
