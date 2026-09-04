import type {DefinitionDto, DefinitionListResponseDto} from '@shipfox/api-definitions-dto';
import {type ApiFetch, createApiClient, pollUntil} from '@shipfox/e2e-core';

// No budget here is really safe: the server holds a sync in `syncing` for as long as its
// Temporal workflow is recovering, and provider activities retry 5 times with 5s/10s/20s/40s
// backoff. Callers that do not test the sync itself should seed definitions over the API
// instead of waiting on one.
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_INITIAL_DELAY_MS = 250;
const DEFAULT_MAX_DELAY_MS = 4_000;
const DEFAULT_BACKOFF_FACTOR = 1.5;

type DefinitionSelector =
  | {
      configPath: string;
      definitionId?: never;
    }
  | {
      configPath?: never;
      definitionId: string;
    };

export type WaitForDefinitionOptions = DefinitionSelector & {
  apiUrl?: string | undefined;
  backoffFactor?: number | undefined;
  fetch?: ApiFetch | undefined;
  initialDelayMs?: number | undefined;
  maxDelayMs?: number | undefined;
  projectId: string;
  signal?: AbortSignal | undefined;
  timeoutMs?: number | undefined;
  token: string;
};

type DefinitionPollResult =
  | {
      kind: 'definition';
      definition: DefinitionDto;
    }
  | {
      kind: 'sync-failed';
      error: Error;
    };

function assertDefinitionSelector(options: WaitForDefinitionOptions): void {
  if (!options.configPath && !options.definitionId) {
    throw new Error('waitForDefinition requires configPath or definitionId');
  }
}

function matchesDefinition(definition: DefinitionDto, selector: DefinitionSelector): boolean {
  if (selector.definitionId) return definition.id === selector.definitionId;
  return definition.config_path === selector.configPath;
}

function selectorLabel(selector: DefinitionSelector): string {
  if (selector.definitionId) return `definitionId=${selector.definitionId}`;
  return `configPath=${selector.configPath}`;
}

function formatObserved(response: DefinitionListResponseDto | null, selector: DefinitionSelector) {
  if (!response) return 'no definitions response observed';
  const definitions = response.definitions
    .slice(0, 5)
    .map((definition) =>
      [
        `id=${definition.id}`,
        `configPath=${definition.config_path ?? 'null'}`,
        `source=${definition.source}`,
        `fetchedAt=${definition.fetched_at}`,
      ].join(' '),
    );
  const more = response.definitions.length > definitions.length ? ', ...' : '';
  const sync = response.sync
    ? [
        `syncStatus=${response.sync.status}`,
        `syncRef=${response.sync.ref ?? 'null'}`,
        // A stuck sync and a sync that only just restarted both read `syncing`; the
        // timestamps say which one a timeout actually observed.
        `syncStartedAt=${response.sync.started_at ?? 'null'}`,
        `syncLastSyncAt=${response.sync.last_sync_at}`,
        `syncErrorCode=${response.sync.last_error_code ?? 'null'}`,
        `syncErrorMessage=${response.sync.last_error_message ?? 'null'}`,
      ].join(' ')
    : 'sync=null';
  return `${selectorLabel(selector)} ${sync} definitions=[${definitions.join(', ')}${more}]`;
}

export async function waitForDefinition(options: WaitForDefinitionOptions): Promise<DefinitionDto> {
  assertDefinitionSelector(options);
  const selector = {
    configPath: options.configPath,
    definitionId: options.definitionId,
  } as DefinitionSelector;
  const client = createApiClient({
    apiUrl: options.apiUrl,
    fetch: options.fetch,
    token: options.token,
  });
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let lastResponse: DefinitionListResponseDto | null = null;

  const result = await pollUntil<DefinitionPollResult>(
    {
      timeoutMs,
      intervalMs: options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS,
      maxIntervalMs: options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS,
      backoffFactor: options.backoffFactor ?? DEFAULT_BACKOFF_FACTOR,
      ...(options.signal ? {signal: options.signal} : {}),
      describe: () => `Timed out waiting for definition: ${formatObserved(lastResponse, selector)}`,
    },
    async () => {
      options.signal?.throwIfAborted();
      const params = new URLSearchParams({project_id: options.projectId, limit: '100'});
      lastResponse = await client.requestJson<DefinitionListResponseDto>(
        'get',
        `/definitions?${params}`,
        {
          signal: options.signal,
        },
      );

      if (lastResponse.sync?.status === 'failed') {
        return {
          kind: 'sync-failed',
          error: new Error(
            `Definition sync failed while waiting: ${formatObserved(lastResponse, selector)}`,
          ),
        };
      }

      const definition = lastResponse.definitions.find((candidate) =>
        matchesDefinition(candidate, selector),
      );
      return definition ? {kind: 'definition', definition} : null;
    },
  );

  if (result.kind === 'sync-failed') throw result.error;
  return result.definition;
}

export function createDefinitionsHelper(options: {
  apiUrl?: string | undefined;
  fetch?: ApiFetch | undefined;
  token: string;
}) {
  return {
    waitForDefinition: (params: Omit<WaitForDefinitionOptions, 'apiUrl' | 'fetch' | 'token'>) =>
      waitForDefinition({...options, ...params} as WaitForDefinitionOptions),
  };
}

export type DefinitionsHelper = ReturnType<typeof createDefinitionsHelper>;
