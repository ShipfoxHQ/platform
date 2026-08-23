import type {DefinitionDto, DefinitionListResponseDto} from '@shipfox/api-definitions-dto';
import {waitForDefinition} from './index.js';

const projectId = '11111111-1111-4111-8111-111111111111';
const definitionId = '22222222-2222-4222-8222-222222222222';
const DEFINITION_SYNC_FAILED_RE =
  /Definition sync failed.*syncStatus=failed.*syncErrorCode=no-workflow-files/u;
const DEFINITION_TIMEOUT_RE =
  /Timed out waiting for definition: configPath=.shipfox\/workflows\/missing.yml/u;
const DEFINITION_TIMEOUT_OBSERVED_RE = /definitions=\[id=22222222/u;

function definition(params: Partial<DefinitionDto> = {}): DefinitionDto {
  return {
    id: params.id ?? definitionId,
    project_id: params.project_id ?? projectId,
    config_path: params.config_path ?? '.shipfox/workflows/build.yml',
    source: params.source ?? 'vcs',
    sha: params.sha ?? 'abc123',
    ref: params.ref ?? 'main',
    name: params.name ?? 'Build',
    workflow_document: params.workflow_document ?? {},
    workflow_model: params.workflow_model ?? {},
    manual_trigger: params.manual_trigger ?? null,
    fetched_at: params.fetched_at ?? '2026-07-02T08:00:00.000Z',
    created_at: params.created_at ?? '2026-07-02T08:00:00.000Z',
    updated_at: params.updated_at ?? '2026-07-02T08:00:00.000Z',
  };
}

function listResponse(params: Partial<DefinitionListResponseDto> = {}): DefinitionListResponseDto {
  return {
    definitions: params.definitions ?? [],
    sync:
      params.sync === undefined
        ? {
            ref: 'main',
            status: 'succeeded',
            last_sync_at: '2026-07-02T08:00:00.000Z',
            started_at: '2026-07-02T08:00:00.000Z',
            finished_at: '2026-07-02T08:00:01.000Z',
            last_error_code: null,
            last_error_message: null,
            diagnostics: [],
          }
        : params.sync,
    next_cursor: params.next_cursor ?? null,
  };
}

function response(body: unknown): Response {
  return Response.json(body);
}

describe('waitForDefinition', () => {
  test('requires an explicit selector', async () => {
    const result = waitForDefinition({
      projectId,
      token: 'user-token',
    } as never);

    await expect(result).rejects.toThrow('requires configPath or definitionId');
  });

  test('polls until the selected definition appears by config path', async () => {
    let calls = 0;

    const result = await waitForDefinition({
      configPath: '.shipfox/workflows/build.yml',
      fetch: () => {
        calls += 1;
        return Promise.resolve(
          response(calls === 1 ? listResponse() : listResponse({definitions: [definition()]})),
        );
      },
      initialDelayMs: 1,
      projectId,
      token: 'user-token',
    });

    expect(result.id).toBe(definitionId);
    expect(calls).toBe(2);
  });

  test('polls until the selected definition appears by id', async () => {
    const result = await waitForDefinition({
      definitionId,
      fetch: () => response(listResponse({definitions: [definition()]})),
      projectId,
      token: 'user-token',
    });

    expect(result.config_path).toBe('.shipfox/workflows/build.yml');
  });

  test('fails immediately when sync fails', async () => {
    const result = waitForDefinition({
      configPath: '.shipfox/workflows/missing.yml',
      fetch: () =>
        response(
          listResponse({
            sync: {
              ref: 'main',
              status: 'failed',
              last_sync_at: '2026-07-02T08:00:00.000Z',
              started_at: '2026-07-02T08:00:00.000Z',
              finished_at: '2026-07-02T08:00:01.000Z',
              last_error_code: 'no-workflow-files',
              last_error_message: 'No workflow files found',
              diagnostics: [],
            },
          }),
        ),
      projectId,
      token: 'user-token',
    });

    await expect(result).rejects.toThrow(DEFINITION_SYNC_FAILED_RE);
  });

  test('does not return a stale matching definition when sync fails', async () => {
    const result = waitForDefinition({
      configPath: '.shipfox/workflows/build.yml',
      fetch: () =>
        response(
          listResponse({
            definitions: [definition()],
            sync: {
              ref: 'main',
              status: 'failed',
              last_sync_at: '2026-07-02T08:00:00.000Z',
              started_at: '2026-07-02T08:00:00.000Z',
              finished_at: '2026-07-02T08:00:01.000Z',
              last_error_code: 'no-workflow-files',
              last_error_message: 'No workflow files found',
              diagnostics: [],
            },
          }),
        ),
      projectId,
      token: 'user-token',
    });

    await expect(result).rejects.toThrow(DEFINITION_SYNC_FAILED_RE);
  });

  test('times out with a bounded observation summary', async () => {
    const result = waitForDefinition({
      configPath: '.shipfox/workflows/missing.yml',
      fetch: () =>
        response(
          listResponse({
            definitions: [definition({config_path: '.shipfox/workflows/other.yml'})],
          }),
        ),
      initialDelayMs: 1,
      projectId,
      timeoutMs: 10,
      token: 'user-token',
    });

    await expect(result).rejects.toThrow(DEFINITION_TIMEOUT_RE);
    await expect(result).rejects.toThrow(DEFINITION_TIMEOUT_OBSERVED_RE);
  });

  test('passes abort signals through polling', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = waitForDefinition({
      configPath: '.shipfox/workflows/build.yml',
      fetch: () => response(listResponse()),
      projectId,
      signal: controller.signal,
      token: 'user-token',
    });

    await expect(result).rejects.toThrow('Stopped waiting for Timed out waiting for definition');
  });
});
