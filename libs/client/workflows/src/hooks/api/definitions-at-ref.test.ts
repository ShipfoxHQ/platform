import {ApiError, configureApiClient} from '@shipfox/client-api';
import {
  definitionsAtRefErrorCopy,
  definitionsAtRefQueryKeys,
  definitionsAtRefQueryOptions,
  listDefinitionsAtRef,
} from './definitions-at-ref.js';

const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const REF = 'fix-triage-prompt';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {'content-type': 'application/json'},
    status: 200,
    ...init,
  });
}

function atRefResponseDto() {
  return {
    ref: REF,
    commit: 'abc123def456abc123def456abc123def456abc123',
    files: [
      {
        config_path: '.shipfox/workflows/triage-sentry.yml',
        name: 'triage-sentry',
        valid: true,
        errors: [],
        warnings: [],
        triggers: {on_issue: {source: 'cron', event: 'tick'}},
      },
    ],
  };
}

describe('definitionsAtRefQueryKeys', () => {
  test('keys a listing by project and ref', () => {
    expect(definitionsAtRefQueryKeys.atRef(PROJECT_ID, REF)).toEqual([
      'definitions-at-ref',
      PROJECT_ID,
      REF,
    ]);
    expect(definitionsAtRefQueryKeys.atRef(PROJECT_ID, 'main')).not.toEqual(
      definitionsAtRefQueryKeys.atRef(PROJECT_ID, REF),
    );
  });
});

describe('listDefinitionsAtRef', () => {
  beforeEach(() => {
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: undefined});
  });

  test('requests the listing for the project and ref and maps it to the client model', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL) => jsonResponse(atRefResponseDto()));
    configureApiClient({fetchImpl});

    const listing = await listDefinitionsAtRef({projectId: PROJECT_ID, ref: REF});

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(request.method).toBe('GET');
    const url = new URL(request.url);
    expect(url.pathname).toBe('/definitions/at-ref');
    expect(url.searchParams.get('project_id')).toBe(PROJECT_ID);
    expect(url.searchParams.get('ref')).toBe(REF);
    expect(listing).toEqual({
      ref: REF,
      commit: 'abc123def456abc123def456abc123def456abc123',
      files: [
        {
          configPath: '.shipfox/workflows/triage-sentry.yml',
          name: 'triage-sentry',
          valid: true,
          errors: [],
          warnings: [],
          triggers: {on_issue: {source: 'cron', event: 'tick'}},
        },
      ],
    });
  });
});

describe('definitionsAtRefQueryOptions', () => {
  test('is disabled until both project and ref are provided', () => {
    const empty = definitionsAtRefQueryOptions(undefined, undefined);
    const partial = definitionsAtRefQueryOptions(PROJECT_ID, undefined);
    const ready = definitionsAtRefQueryOptions(PROJECT_ID, REF);

    expect(empty.enabled).toBe(false);
    expect(partial.enabled).toBe(false);
    expect(ready.enabled).toBe(true);
    expect(ready.queryKey).toEqual(definitionsAtRefQueryKeys.atRef(PROJECT_ID, REF));
    expect(ready.staleTime).toBeUndefined();
  });

  test('retries transient failures with the default budget but skips ref verdicts', () => {
    const options = definitionsAtRefQueryOptions(PROJECT_ID, REF);
    const retry = options.retry as (failureCount: number, error: unknown) => boolean;

    // Server verdicts can never succeed on retry and surface immediately.
    expect(retry(0, apiError('ref-invalid', 400))).toBe(false);
    expect(retry(0, apiError('ref-not-found', 404))).toBe(false);
    // Transient server and network errors keep the default retry budget.
    expect(retry(0, apiError('source-unavailable', 502))).toBe(true);
    expect(retry(2, apiError('source-unavailable', 502))).toBe(true);
    expect(retry(3, apiError('source-unavailable', 502))).toBe(false);
    expect(retry(0, new Error('network down'))).toBe(true);
  });
});

function apiError(code: string, status: number, details: unknown = {}) {
  return new ApiError({
    message: `Server message for ${code}`,
    code,
    status,
    details: {message: `Server message for ${code}`, code, details},
  });
}

describe('definitionsAtRefErrorCopy', () => {
  test.each([
    ['ref-invalid', 400],
    ['ref-not-found', 404],
    ['project-not-found', 404],
    ['too-many-files', 422],
    ['source-unavailable', 502],
    ['integration-connection-inactive', 422],
    ['integration-connection-not-found', 404],
    ['forbidden', 403],
    ['rate-limited', 429],
  ] as const)('translates %s into user-facing copy', (code, status) => {
    const copy = definitionsAtRefErrorCopy(apiError(code, status));

    expect(copy.title.length).toBeGreaterThan(0);
    expect(copy.message.length).toBeGreaterThan(0);
    expect(copy.message).not.toContain('Server message');
  });

  test('translates network errors', () => {
    const copy = definitionsAtRefErrorCopy(apiError('network-error', 0));

    expect(copy.title).toBe('Network problem');
  });

  test('never renders non-API errors directly and keeps a stable fallback title', () => {
    const copy = definitionsAtRefErrorCopy(new Error('leaky internal detail'));
    const serverCopy = definitionsAtRefErrorCopy(apiError('unexpected-code', 500));

    expect(copy.message).not.toContain('leaky internal detail');
    expect(copy.message).toBe('Try again in a moment.');
    // A structured server response keeps its message, under the stable title.
    expect(serverCopy.title).toBe('Could not list workflow files');
    expect(serverCopy.message).toBe('Server message for unexpected-code');
  });
});
