import {configureApiClient} from '@shipfox/client-api';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, cleanup, renderHook, waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
import {useWorkflowFilterOptions} from './workflow-filter-options.js';

const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const SECOND_PROJECT_ID = '44444444-4444-4444-8444-000000000002';
const DEFINITION_ID = '55555555-5555-4555-8555-555555555555';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {'content-type': 'application/json'},
    status: 200,
    ...init,
  });
}

function renderWithQueryClient<TProps>(
  callback: (props: TProps) => ReturnType<typeof useWorkflowFilterOptions>,
  initialProps: TProps,
) {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const wrapper = ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(callback, {wrapper, initialProps});
}

describe('useWorkflowFilterOptions', () => {
  afterEach(() => {
    cleanup();
    configureApiClient({baseUrl: '', fetchImpl: undefined});
  });

  test('stops with an error when the API repeats a pagination cursor', async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(requestInputUrl(input));
      const secondPage = url.searchParams.get('cursor') === 'repeat-cursor';
      return Promise.resolve(
        jsonResponse({
          definitions: [definitionDto(secondPage ? 'Second' : 'First')],
          next_cursor: 'repeat-cursor',
          sync: null,
        }),
      );
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    const {result} = renderWithQueryClient(
      ({projectId}: {projectId: string}) => useWorkflowFilterOptions(projectId),
      {projectId: PROJECT_ID},
    );

    expect(result.current.workflowOptions).toEqual([]);
    expect(result.current.workflowOptionsStatus).toBe('ready');
    expect(fetchImpl).not.toHaveBeenCalled();

    act(() => result.current.onOpenWorkflowOptions());

    await waitFor(() => expect(result.current.workflowOptionsStatus).toBe('error'));
    expect(result.current.workflowOptions).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('does not expose the previous project while the next project loads', async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(requestInputUrl(input));
      if (url.searchParams.get('project_id') === SECOND_PROJECT_ID) {
        return new Promise<Response>(() => undefined);
      }
      return Promise.resolve(
        jsonResponse({
          definitions: [definitionDto('First project workflow')],
          next_cursor: null,
          sync: null,
        }),
      );
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    const {result, rerender} = renderWithQueryClient(
      ({projectId}: {projectId: string}) => useWorkflowFilterOptions(projectId),
      {projectId: PROJECT_ID},
    );

    act(() => result.current.onOpenWorkflowOptions());
    await waitFor(() =>
      expect(result.current.workflowOptions).toEqual([
        {value: DEFINITION_ID, label: 'First project workflow'},
      ]),
    );

    rerender({projectId: SECOND_PROJECT_ID});

    expect(result.current.workflowOptions).toEqual([]);
    expect(result.current.workflowOptionsStatus).toBe('ready');

    act(() => result.current.onOpenWorkflowOptions());

    expect(result.current.workflowOptions).toEqual([]);
    expect(result.current.workflowOptionsStatus).toBe('loading');
  });
});

function definitionDto(name: string) {
  return {
    id: DEFINITION_ID,
    project_id: PROJECT_ID,
    config_path: `.shipfox/workflows/${name.toLowerCase().replaceAll(' ', '-')}.yml`,
    source: 'vcs',
    sha: 'abc123',
    ref: 'main',
    name,
    workflow_document: {name, jobs: {}},
    workflow_model: {kind: 'workflow', name},
    manual_trigger: null,
    fetched_at: '2026-05-07T01:00:00.000Z',
    created_at: '2026-05-07T01:00:00.000Z',
    updated_at: '2026-05-07T01:00:00.000Z',
  };
}

function requestInputUrl(input: RequestInfo | URL): string {
  if (input instanceof Request) return input.url;
  return String(input);
}
