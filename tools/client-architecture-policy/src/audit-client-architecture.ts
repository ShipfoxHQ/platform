import {access, readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';

export interface ClientArchitectureViolation {
  file: string;
  occurrences: number;
  rule:
    | 'checked-api-request-outside-adapter'
    | 'non-owning-feature-contribution'
    | 'private-feature-import'
    | 'inline-query-policy'
    | 'query-policy-outside-adapter'
    | 'unregistered-query-client-operation'
    | 'unmapped-api-response'
    | 'unparsed-api-response';
}

export interface ClientArchitectureInventory {
  adapterFiles: string[];
  checkedApiRequestCalls: number;
  queryHooks: number;
  reusableQueryPolicies: number;
}

export interface ClientArchitectureException {
  file: string;
  owner: string;
  reason: string;
  test: string;
}

export interface ClientArchitectureExceptionRegistry {
  cacheOperation: readonly ClientArchitectureException[];
  queryPolicy: readonly ClientArchitectureException[];
}

/**
 * Narrow exceptions must identify the source owner, explain the boundary that
 * cannot use the default contract, and point to a focused test.
 */
const stepLogsQueryException = {
  file: 'libs/client/logs/src/hooks/api/step-logs.ts',
  owner: 'step-log query adapter',
  reason: 'The query merges a prior cursor snapshot and owns a per-view retry lifecycle.',
  test: 'libs/client/logs/src/hooks/api/step-logs-query.test.tsx',
} as const;

export const clientArchitectureExceptions = {
  cacheOperation: [
    {
      file: 'libs/client/shell/src/runtime/auth.tsx',
      owner: 'shell auth runtime',
      reason: 'Auth transitions clear and reseed private cache state across principal changes.',
      test: 'libs/client/auth/src/components/auth-provider.test.tsx',
    },
    {
      file: 'libs/client/onboarding/src/workspace-setup-route.ts',
      owner: 'workspace setup coordinator',
      reason:
        'Workspace setup combines query policies from several feature packages before routing.',
      test: 'libs/client/onboarding/src/workspace-setup-route.test.tsx',
    },
    {
      file: 'libs/client/integrations/src/application/complete-integration-callback.ts',
      owner: 'integration callback coordinator',
      reason:
        'OAuth callback completion refreshes the integration cache after a cross-route handoff.',
      test: 'libs/client/integrations/src/application/complete-integration-callback.test.ts',
    },
    {
      file: 'libs/client/auth/src/pages/signup-page.tsx',
      owner: 'signup page coordinator',
      reason:
        'Signup verifies the invitation membership from the auth cache before selecting the joined workspace.',
      test: 'libs/client/auth/src/pages/signup-page.test.tsx',
    },
    {
      file: 'libs/client/integrations/src/pages/linear-callback-page.tsx',
      owner: 'Linear callback coordinator',
      reason:
        'The OAuth callback passes the auth cache to the workspace navigation coordinator after completion.',
      test: 'libs/client/integrations/src/pages/linear-callback-page.test.tsx',
    },
    {
      file: 'libs/client/integrations/src/pages/jira-callback-page.tsx',
      owner: 'Jira callback coordinator',
      reason:
        'The OAuth callback passes the auth cache to the workspace navigation coordinator after multi-site completion.',
      test: 'libs/client/integrations/src/pages/jira-callback-page.test.tsx',
    },
    {
      file: 'libs/client/integrations/src/pages/sentry-callback-page.tsx',
      owner: 'Sentry callback coordinator',
      reason:
        'The OAuth callback passes the auth cache to the workspace navigation coordinator after completion.',
      test: 'libs/client/integrations/src/pages/sentry-callback-page.test.tsx',
    },
    {
      file: 'libs/client/integrations/src/pages/slack-callback-page.tsx',
      owner: 'Slack callback coordinator',
      reason:
        'The OAuth callback passes the auth cache to the workspace navigation coordinator after completion.',
      test: 'libs/client/integrations/src/pages/slack-callback-page.test.tsx',
    },
    {
      file: 'libs/client/projects/src/pages/create-project-page.tsx',
      owner: 'create-project page coordinator',
      reason:
        'Project creation reads workspace project existence from the query cache before the first-project mutation to pick the landing route and seeds the project list cache before landing the first project on the home.',
      test: 'libs/client/projects/src/pages/create-project-page.test.tsx',
    },
  ],
  queryPolicy: [stepLogsQueryException],
} as const satisfies ClientArchitectureExceptionRegistry;

const rootDirectory = fileURLToPath(new URL('../../../', import.meta.url));
const auditedDirectories = [
  path.join(rootDirectory, 'libs/client'),
  path.join(rootDirectory, 'libs/shared/react/ui'),
];
const sourceFilePattern = /\.(?:ts|tsx)$/;
const nonProductionSourcePattern = /\.(?:stories|test)\.(?:ts|tsx)$/;
const checkedApiRequestPattern = /\bcheckedApiRequest\s*(?:<[^>]*>)?\s*\(/;
const uncheckedApiRequestPattern = /\bapiRequest\s*(?:<[^>]*>)?\s*\(/;
const checkedApiRequestCallPattern = /\bcheckedApiRequest\s*(?:<[^>]*>)?\s*\(/g;
const unmappedApiResponsePattern =
  /(?:\breturn\s*(?:\(\s*)?|=>\s*(?:\(\s*)?)(?:await\s+)?checkedApiRequest\s*(?:<[^>]*>)?\s*\((?!\s*emptyResponseSchema\b)/g;
const queryHookPattern = /\b(?:useQuery|useInfiniteQuery)\s*(?:<[^>]*>)?\s*\(/g;
const queryPolicyFactoryPattern = /\b([A-Za-z_$][\w$]*(?:Infinite)?QueryOptions)\s*\(/g;
const inlineQueryPolicyFactories = new Set(['queryOptions', 'infiniteQueryOptions']);
const namedImportDeclarationPattern = /\bimport\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"]/g;
const namedImportSpecifierPattern =
  /(?:^|,)\s*(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*(?=,|$)/g;
const reactQueryModuleName = '@tanstack/react-query';
const queryClientHookName = 'useQueryClient';
const queryClientOperationNames = [
  'cancelQueries',
  'clear',
  'defaultQueryOptions',
  'ensureInfiniteQueryData',
  'ensureQueryData',
  'getDefaultOptions',
  'getMutationCache',
  'getMutationDefaults',
  'getQueryCache',
  'fetchInfiniteQuery',
  'fetchQuery',
  'getQueriesData',
  'getQueryData',
  'getQueryDefaults',
  'getQueryState',
  'invalidateQueries',
  'isFetching',
  'isMutating',
  'mount',
  'prefetchInfiniteQuery',
  'prefetchQuery',
  'refetchQueries',
  'removeQueries',
  'resumePausedMutations',
  'resetQueries',
  'setQueriesData',
  'setDefaultOptions',
  'setMutationDefaults',
  'setQueryData',
  'setQueryDefaults',
  'unmount',
] as const;
const queryClientParameterPattern = /\b([A-Za-z_$][\w$]*)\s*:\s*QueryClient\b/g;
const identifierStartPattern = /[A-Za-z_$]/;
const identifierPartPattern = /[A-Za-z0-9_$]/;
const regexFlagPattern = /[A-Za-z]/;
const whitespacePattern = /\s/;
const digitPattern = /[0-9]/;
const regexLiteralPrefixKeywords = new Set([
  'await',
  'case',
  'catch',
  'delete',
  'do',
  'else',
  'for',
  'if',
  'in',
  'instanceof',
  'of',
  'return',
  'switch',
  'throw',
  'typeof',
  'void',
  'while',
  'with',
  'yield',
]);
const excludedDirectoryNames = new Set([
  'dist',
  'node_modules',
  'test',
  'tests',
  '__tests__',
  'fixtures',
  '__fixtures__',
  'generated',
  '__generated__',
]);
const privateFeatureImportPattern =
  /(?:from\s+|import\s*\(\s*)['"]@shipfox\/client-[^/'"]+\/(?!feature(?:\/|['"])|routes(?:\/|['"])|continuation(?:\/|['"])|runtime(?:\/|['"])|testing(?:\/|['"])|vite(?:\/|['"]))(?:[^'"]+)['"]/;
const featureManifestPathPattern = /^libs\/client\/([^/]+)\/src\/feature\.ts$/u;
const featureDeclarationPattern = /defineClientFeature\(\s*\{\s*id\s*:\s*['"]([^'"]+)['"]/u;
const featureIdPattern = /\bid\s*:\s*['"]([^'"]+)['"]/u;
const coordinatorPattern = /\bcoordinator\s*:\s*['"]([^'"]+)['"]/u;
const routeImplementationPattern = /\bimpl\s*:\s*['"](@shipfox\/client-[^/'"]+)\/routes\//gu;
const routePathPattern = /\bpath\s*:\s*['"]([^'"]+)['"]/gu;
const navigationTargetPattern = /\bto\s*:\s*['"]([^'"]+)['"]/gu;
const settingsSectionPattern = /\{[^{}]*\bpathSegment\s*:\s*['"][^'"]+['"][^{}]*\}/gu;
const settingsPathSegmentPattern = /\bpathSegment\s*:\s*['"]([^'"]+)['"]/u;
const settingsScopePattern = /\bscope\s*:\s*['"](workspace|project)['"]/u;
const registryDefinitionPattern = /\b(?:navigation|settingsSections)\s*(?::|=)\s*\[/u;
const trailingSlashPattern = /\/+$/u;
const generatedFilePattern = /\.gen\.(?:ts|tsx)$/;

function toRepositoryPath(filePath: string): string {
  return path.relative(rootDirectory, filePath).split(path.sep).join('/');
}

export async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, {withFileTypes: true});
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return excludedDirectoryNames.has(entry.name) ? [] : await sourceFiles(entryPath);
      }
      return sourceFilePattern.test(entry.name) &&
        !nonProductionSourcePattern.test(entry.name) &&
        !generatedFilePattern.test(entry.name)
        ? [entryPath]
        : [];
    }),
  );
  return files.flat();
}

function countMatches(source: string, pattern: RegExp): number {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  return [...source.matchAll(new RegExp(pattern.source, flags))].length;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function importedBindings(source: string, moduleName: string, importedName: string): string[] {
  const bindings = new Set<string>();
  for (const match of source.matchAll(namedImportDeclarationPattern)) {
    if (match[2] !== moduleName) continue;
    for (const specifier of (match[1] ?? '').matchAll(namedImportSpecifierPattern)) {
      if (specifier[1] === importedName) bindings.add(specifier[2] ?? importedName);
    }
  }
  return [...bindings];
}

function queryPolicyFactoryNames(source: string): Set<string> {
  return new Set([
    ...inlineQueryPolicyFactories,
    ...importedBindings(source, reactQueryModuleName, 'queryOptions'),
    ...importedBindings(source, reactQueryModuleName, 'infiniteQueryOptions'),
  ]);
}

function queryClientHookNames(source: string): string[] {
  return [
    queryClientHookName,
    ...importedBindings(source, reactQueryModuleName, queryClientHookName),
  ].filter((hookName, index, hookNames) => hookNames.indexOf(hookName) === index);
}

function capturedMatches(source: string, pattern: RegExp): string[] {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  return [...source.matchAll(new RegExp(pattern.source, flags))].flatMap((match) =>
    match[1] ? [match[1]] : [],
  );
}

function capturedSettingsSections(
  source: string,
): Array<{segment: string; scope: 'workspace' | 'project'}> {
  return [
    ...source.matchAll(new RegExp(settingsSectionPattern.source, settingsSectionPattern.flags)),
  ].flatMap((match) => {
    const section = match[0];
    const segment = section.match(settingsPathSegmentPattern)?.[1];
    if (!segment) return [];
    return [
      {
        segment,
        scope: section.match(settingsScopePattern)?.[1] === 'project' ? 'project' : 'workspace',
      },
    ];
  });
}

function normalizeManifestPath(value: string): string {
  return value === '/' ? value : value.replace(trailingSlashPattern, '') || '/';
}

function featureContributionOccurrences(file: string, source: string): number {
  const manifest = file.match(featureManifestPathPattern);
  if (!manifest) return registryDefinitionPattern.test(source) ? 1 : 0;

  const packageName = `@shipfox/client-${manifest[1]}`;
  const featureId =
    source.match(featureDeclarationPattern)?.[1] ?? source.match(featureIdPattern)?.[1];
  const coordinatorId = source.match(coordinatorPattern)?.[1];
  const hasExplicitCoordinator = featureId !== undefined && coordinatorId === featureId;
  let occurrences = featureId === `shipfox.${manifest[1]}` ? 0 : 1;

  for (const implementationPackage of capturedMatches(source, routeImplementationPattern)) {
    if (implementationPackage !== packageName && !hasExplicitCoordinator) occurrences += 1;
  }

  const routes = new Set(capturedMatches(source, routePathPattern).map(normalizeManifestPath));
  for (const target of capturedMatches(source, navigationTargetPattern)) {
    if (!routes.has(normalizeManifestPath(target)) && !hasExplicitCoordinator) occurrences += 1;
  }
  for (const {segment, scope} of capturedSettingsSections(source)) {
    const workspaceTarget = normalizeManifestPath(`/w/$workspaceSlug/settings/${segment}`);
    const projectTarget = normalizeManifestPath(
      `/w/$workspaceSlug/p/$projectSlug/settings/${segment}`,
    );
    const target = scope === 'project' ? projectTarget : workspaceTarget;
    if (!routes.has(target) && !hasExplicitCoordinator) {
      occurrences += 1;
    }
  }

  return occurrences;
}

function isIdentifierStart(character: string | undefined): boolean {
  return character !== undefined && identifierStartPattern.test(character);
}

function isIdentifierPart(character: string | undefined): boolean {
  return character !== undefined && identifierPartPattern.test(character);
}

function findRegexLiteralEnd(source: string, start: number): number {
  let inCharacterClass = false;
  let escaped = false;

  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '\n' || character === '\r') return source.length;
    if (character === '[') {
      inCharacterClass = true;
      continue;
    }
    if (character === ']') {
      inCharacterClass = false;
      continue;
    }
    if (character === '/' && !inCharacterClass) {
      let end = index + 1;
      while (regexFlagPattern.test(source[end] ?? '')) end += 1;
      return end;
    }
  }
  return source.length;
}

function findMatchingCallEnd(source: string, openParen: number): number {
  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;
  let escaped = false;
  let canEndExpression = false;

  for (let index = openParen; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = null;
        canEndExpression = true;
      }
      continue;
    }
    if (whitespacePattern.test(character ?? '')) continue;
    if (character === '/' && nextCharacter === '/') {
      const newline = source.indexOf('\n', index + 2);
      if (newline === -1) return source.length;
      index = newline;
      continue;
    }
    if (character === '/' && nextCharacter === '*') {
      const commentEnd = source.indexOf('*/', index + 2);
      if (commentEnd === -1) return source.length;
      index = commentEnd + 1;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      escaped = false;
      canEndExpression = false;
      continue;
    }
    if (character === '/' && !canEndExpression) {
      index = findRegexLiteralEnd(source, index) - 1;
      canEndExpression = true;
      continue;
    }
    if (isIdentifierStart(character)) {
      let end = index + 1;
      while (isIdentifierPart(source[end])) end += 1;
      canEndExpression = !regexLiteralPrefixKeywords.has(source.slice(index, end));
      index = end - 1;
      continue;
    }
    if (digitPattern.test(character ?? '')) {
      canEndExpression = true;
      continue;
    }
    if (character === '(') {
      depth += 1;
      canEndExpression = false;
      continue;
    }
    if (character === ')' && --depth === 0) return index;
    if (character === ')') {
      canEndExpression = true;
      continue;
    }
    if (character === ']' || character === '}') {
      canEndExpression = true;
      continue;
    }
    if (character === '+' || character === '-') {
      if (nextCharacter === character) {
        index += 1;
        canEndExpression = true;
      } else {
        canEndExpression = false;
      }
      continue;
    }
    canEndExpression = false;
  }
  return source.length;
}

function queryHookCalls(source: string): Array<{hasPolicy: boolean}> {
  const inlineQueryPolicyNames = queryPolicyFactoryNames(source);
  return [...source.matchAll(new RegExp(queryHookPattern.source, 'g'))].map((match) => {
    const start = match.index ?? 0;
    const openParen = start + match[0].lastIndexOf('(');
    const end = findMatchingCallEnd(source, openParen);
    const argumentsSource = source.slice(openParen + 1, end);
    const hasPolicy = [...argumentsSource.matchAll(queryPolicyFactoryPattern)].some(
      ([, factoryName]) => !inlineQueryPolicyNames.has(factoryName ?? ''),
    );
    return {hasPolicy};
  });
}

function hasQueryPolicyException(file: string): boolean {
  return clientArchitectureExceptions.queryPolicy.some((exception) => exception.file === file);
}

function hasCacheOperationException(file: string): boolean {
  return clientArchitectureExceptions.cacheOperation.some((exception) => exception.file === file);
}

function queryClientIdentifiers(source: string): string[] {
  const identifiers = new Set<string>(['queryClient']);
  const hookNames = queryClientHookNames(source);
  const hookPattern = hookNames.map(escapeRegExp).join('|');
  const queryClientBindingPattern = new RegExp(
    `\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:${hookPattern})\\s*\\(`,
    'g',
  );
  for (const match of source.matchAll(queryClientBindingPattern)) {
    if (match[1]) identifiers.add(match[1]);
  }
  for (const match of source.matchAll(queryClientParameterPattern)) {
    if (match[1]) identifiers.add(match[1]);
  }
  const queryClientReturnTypePattern = new RegExp(
    `\\b([A-Za-z_$][\\w$]*)\\s*:\\s*ReturnType<\\s*typeof\\s+(?:${hookPattern})\\s*>`,
    'g',
  );
  for (const match of source.matchAll(queryClientReturnTypePattern)) {
    if (match[1]) identifiers.add(match[1]);
  }
  return [...identifiers];
}

function queryClientMethodOperationCount(source: string): number {
  const identifiers = queryClientIdentifiers(source).map(escapeRegExp).join('|');
  const hookNames = queryClientHookNames(source).map(escapeRegExp).join('|');
  const methods = queryClientOperationNames.join('|');
  const operationPattern = new RegExp(
    `\\b(?:${identifiers})(?:\\.|\\?\\.)(?:${methods})\\s*\\(`,
    'g',
  );
  const directHookOperationPattern = new RegExp(
    `\\b(?:${hookNames})\\s*\\(\\s*\\)(?:\\.|\\?\\.)(?:${methods})\\s*\\(`,
    'g',
  );
  return countMatches(source, operationPattern) + countMatches(source, directHookOperationPattern);
}

function queryClientOperationCount(source: string): number {
  const hookCallCount = queryClientHookNames(source).reduce(
    (total, hookName) =>
      total + countMatches(source, new RegExp(`\\b${escapeRegExp(hookName)}\\s*\\(`, 'g')),
    0,
  );
  return queryClientMethodOperationCount(source) + hookCallCount;
}

function allExceptions(
  registry: ClientArchitectureExceptionRegistry = clientArchitectureExceptions,
): ClientArchitectureException[] {
  return [...registry.cacheOperation, ...registry.queryPolicy];
}

export function validateExceptionRegistry(
  files: string[],
  testFiles: string[] | undefined = undefined,
  registry: ClientArchitectureExceptionRegistry = clientArchitectureExceptions,
): void {
  const fileSet = new Set(files);
  const testFileSet = new Set(testFiles ?? []);
  const seen = new Set<string>();
  for (const exception of allExceptions(registry)) {
    const key = `${exception.file}:${exception.test}`;
    if (seen.has(key)) throw new Error(`Duplicate client architecture exception: ${key}`);
    seen.add(key);
    if (!exception.file.trim()) throw new Error('Client architecture exception has no file');
    if (!exception.owner.trim())
      throw new Error(`Client architecture exception has no owner: ${exception.file}`);
    if (!exception.reason.trim())
      throw new Error(`Client architecture exception has no reason: ${exception.file}`);
    if (!exception.test.trim())
      throw new Error(`Client architecture exception has no focused test: ${exception.file}`);
    if (!fileSet.has(exception.file))
      throw new Error(`Client architecture exception file is not audited: ${exception.file}`);
    if (testFiles !== undefined && !testFileSet.has(exception.test))
      throw new Error(`Client architecture exception test does not exist: ${exception.test}`);
  }
}

export function validateExceptionSourceUsage(
  sources: ReadonlyMap<string, string>,
  registry: ClientArchitectureExceptionRegistry = clientArchitectureExceptions,
): void {
  for (const exception of registry.cacheOperation) {
    const source = sources.get(exception.file);
    if (!source || queryClientOperationCount(source) === 0) {
      throw new Error(`Client architecture cache-operation exception is stale: ${exception.file}`);
    }
  }
  for (const exception of registry.queryPolicy) {
    const source = sources.get(exception.file);
    const hasUnownedQueryPolicy =
      source !== undefined && queryHookCalls(source).some((call) => !call.hasPolicy);
    if (!source || !hasUnownedQueryPolicy) {
      throw new Error(`Client architecture query-policy exception is stale: ${exception.file}`);
    }
  }
}

async function existingPaths(paths: string[]): Promise<string[]> {
  const existing = await Promise.all(
    paths.map(async (relativePath) => {
      try {
        await access(path.join(rootDirectory, relativePath));
        return relativePath;
      } catch {
        return undefined;
      }
    }),
  );
  return existing.flatMap((relativePath) => (relativePath ? [relativePath] : []));
}

async function validateRepositoryExceptionRegistry(
  entries: Array<{file: string; source: string}>,
): Promise<void> {
  const exceptions = allExceptions();
  const testFiles = await existingPaths(exceptions.map((exception) => exception.test));
  validateExceptionRegistry(
    entries.map((entry) => entry.file),
    testFiles,
  );
  validateExceptionSourceUsage(new Map(entries.map((entry) => [entry.file, entry.source])));
}

export function inventoryClientSource(
  file: string,
  source: string,
): {
  isAdapter: boolean;
  checkedApiRequestCalls: number;
  queryHooks: number;
  reusableQueryPolicies: number;
} {
  const normalizedFile = file.split(path.sep).join('/');
  const isAdapter = normalizedFile.includes('/src/hooks/api/');
  const calls = queryHookCalls(source);
  const reusableQueryPolicies = calls.filter((call) => call.hasPolicy).length;
  return {
    isAdapter,
    checkedApiRequestCalls: countMatches(source, checkedApiRequestCallPattern),
    queryHooks: calls.length,
    reusableQueryPolicies,
  };
}

export function auditClientSource(file: string, source: string): ClientArchitectureViolation[] {
  const violations: ClientArchitectureViolation[] = [];
  const normalizedFile = file.split(path.sep).join('/');
  const isAdapter = normalizedFile.includes('/src/hooks/api/');
  const isClientApi = normalizedFile.startsWith('libs/client/api/');
  const addViolation = (rule: ClientArchitectureViolation['rule'], occurrences: number): void => {
    if (occurrences > 0) violations.push({file, rule, occurrences});
  };
  addViolation('private-feature-import', countMatches(source, privateFeatureImportPattern));
  addViolation(
    'non-owning-feature-contribution',
    featureContributionOccurrences(normalizedFile, source),
  );
  if (!isAdapter && !isClientApi)
    addViolation(
      'checked-api-request-outside-adapter',
      countMatches(source, checkedApiRequestPattern),
    );
  if (isAdapter && !isClientApi)
    addViolation('unparsed-api-response', countMatches(source, uncheckedApiRequestPattern));
  if (isAdapter && !isClientApi) {
    addViolation('unmapped-api-response', countMatches(source, unmappedApiResponsePattern));
    const queryCalls = queryHookCalls(source);
    if (!hasQueryPolicyException(normalizedFile)) {
      addViolation('inline-query-policy', queryCalls.filter((call) => !call.hasPolicy).length);
    }
  } else if (!isClientApi) {
    addViolation('query-policy-outside-adapter', queryHookCalls(source).length);
  }
  if (!isAdapter && !isClientApi && !hasCacheOperationException(normalizedFile)) {
    addViolation('unregistered-query-client-operation', queryClientOperationCount(source));
  }
  return violations;
}

export async function inventoryRepository(): Promise<ClientArchitectureInventory> {
  const files = (await Promise.all(auditedDirectories.map(sourceFiles))).flat();
  const entries = await Promise.all(
    files.map(async (file) => ({
      file: toRepositoryPath(file),
      source: await readFile(file, 'utf8'),
    })),
  );
  await validateRepositoryExceptionRegistry(entries);
  const inventories = entries.map(({file, source}) => ({
    file,
    ...inventoryClientSource(file, source),
  }));
  return {
    adapterFiles: inventories
      .filter(({isAdapter}) => isAdapter)
      .map(({file}) => file)
      .sort(),
    checkedApiRequestCalls: inventories.reduce(
      (total, {checkedApiRequestCalls}) => total + checkedApiRequestCalls,
      0,
    ),
    queryHooks: inventories.reduce((total, {queryHooks}) => total + queryHooks, 0),
    reusableQueryPolicies: inventories.reduce(
      (total, {reusableQueryPolicies}) => total + reusableQueryPolicies,
      0,
    ),
  };
}

export async function auditRepository(): Promise<ClientArchitectureViolation[]> {
  const files = (await Promise.all(auditedDirectories.map(sourceFiles))).flat();
  const entries = await Promise.all(
    files.map(async (file) => ({
      file: toRepositoryPath(file),
      source: await readFile(file, 'utf8'),
    })),
  );
  await validateRepositoryExceptionRegistry(entries);
  const violations = entries.map(({file, source}) => auditClientSource(file, source));
  return violations
    .flat()
    .sort((left, right) =>
      `${left.file}:${left.rule}`.localeCompare(`${right.file}:${right.rule}`),
    );
}

async function main(): Promise<void> {
  const violations = await auditRepository();
  if (violations.length === 0) {
    const inventory = await inventoryRepository();
    process.stdout.write(
      `Client architecture audit passed with zero violations (${inventory.checkedApiRequestCalls} checked API calls, ${inventory.queryHooks} query hooks, ${inventory.reusableQueryPolicies} reusable query policies, ${inventory.adapterFiles.length} adapter files)\n`,
    );
    return;
  }
  process.stderr.write(`Client architecture audit found ${violations.length} violation(s)\n`);
  for (const violation of violations)
    process.stderr.write(`- ${violation.file}: ${violation.rule}\n`);
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    process.stderr.write(`Client architecture audit failed: ${String(error)}\n`);
    process.exitCode = 1;
  });
}
