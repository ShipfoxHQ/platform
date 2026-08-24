import {buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import {definitionsInterModuleContract} from '@shipfox/api-definitions-dto/inter-module';
import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import {workflowsInterModuleContract} from '@shipfox/api-workflows-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {eq} from 'drizzle-orm';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {
  DevRunInputsNotAllowedError,
  DevRunReplayEventRequiredError,
  DevRunTriggerNotFoundError,
} from '#core/errors.js';
import {db} from '#db/db.js';
import {triggerSubscriptions} from '#db/schema/subscriptions.js';

const createDevRunMock = vi.hoisted(() => vi.fn());
const getProjectByIdMock = vi.hoisted(() => vi.fn());

vi.mock('#core/create-dev-run.js', () => ({
  createDevRun: createDevRunMock,
}));

const {createDevRunRoute} = await import('./create-dev-run.js');

const workflows = {} as WorkflowsModuleClient;
const definitions = {} as never;
const projects = {getProjectById: (...args: unknown[]) => getProjectByIdMock(...args)} as never;

const COMMIT = 'b'.repeat(40);
const VALID_BODY = {
  project_id: crypto.randomUUID(),
  ref: 'fix-triage-prompt',
  commit: COMMIT,
  config_path: '.shipfox/workflows/triage-sentry.yml',
  trigger: 'on_demand',
};

describe('POST /dev-runs', () => {
  let app: FastifyInstance;
  let workspaceId: string;
  let memberships: Array<{
    workspaceId: string;
    role: 'admin';
    workspaceStatus: 'active' | 'suspended' | 'deleted';
  }>;

  beforeAll(async () => {
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.addHook('onRequest', (request, _reply, done) => {
      setUserContext(
        request,
        buildUserContext({userId: crypto.randomUUID(), email: 'user@example.com', memberships}),
      );
      done();
    });
    app.post('/dev-runs', createDevRunRoute(workflows, definitions, projects));
    await app.ready();
  });

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    memberships = [{workspaceId, role: 'admin', workspaceStatus: 'active'}];
    createDevRunMock.mockReset();
    getProjectByIdMock.mockReset();
    getProjectByIdMock.mockResolvedValue({project: {id: VALID_BODY.project_id, workspaceId}});
  });

  test('returns 201 with the run id and pinned commit', async () => {
    const runId = crypto.randomUUID();
    createDevRunMock.mockResolvedValue({id: runId, commit: COMMIT});

    const res = await app.inject({
      method: 'POST',
      url: '/dev-runs',
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({workflow_run_id: runId, commit: COMMIT});
    expect(createDevRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        projectId: VALID_BODY.project_id,
        ref: VALID_BODY.ref,
        commit: VALID_BODY.commit,
        configPath: VALID_BODY.config_path,
        triggerKey: VALID_BODY.trigger,
      }),
    );
    expect(
      await db()
        .select()
        .from(triggerSubscriptions)
        .where(eq(triggerSubscriptions.workspaceId, workspaceId)),
    ).toHaveLength(0);
  });

  test('rejects a ref with a control character', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/dev-runs',
      payload: {...VALID_BODY, ref: 'fix-\u0000triage'},
    });

    expect(res.statusCode).toBe(400);
    expect(createDevRunMock).not.toHaveBeenCalled();
  });

  test('rejects a non-hex pinned commit', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/dev-runs',
      payload: {...VALID_BODY, commit: 'not-a-sha'},
    });

    expect(res.statusCode).toBe(400);
    expect(createDevRunMock).not.toHaveBeenCalled();
  });

  test('rejects an unknown body key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/dev-runs',
      payload: {...VALID_BODY, replay_event_id: crypto.randomUUID()},
    });

    expect(res.statusCode).toBe(400);
    expect(createDevRunMock).not.toHaveBeenCalled();
  });

  test('returns 404 project-not-found when the project is missing', async () => {
    getProjectByIdMock.mockResolvedValue({project: null});

    const res = await app.inject({
      method: 'POST',
      url: '/dev-runs',
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('project-not-found');
    expect(createDevRunMock).not.toHaveBeenCalled();
  });

  test('returns 409 workspace-suspended for a suspended membership claim', async () => {
    memberships = [{workspaceId, role: 'admin', workspaceStatus: 'suspended'}];

    const res = await app.inject({
      method: 'POST',
      url: '/dev-runs',
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('workspace-suspended');
    expect(createDevRunMock).not.toHaveBeenCalled();
  });

  test('maps a missing trigger key to 422 trigger-not-found', async () => {
    createDevRunMock.mockRejectedValue(new DevRunTriggerNotFoundError('missing'));

    const res = await app.inject({
      method: 'POST',
      url: '/dev-runs',
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('trigger-not-found');
  });

  test('maps request inputs on a cron trigger to 422 inputs-not-allowed', async () => {
    createDevRunMock.mockRejectedValue(new DevRunInputsNotAllowedError());

    const res = await app.inject({
      method: 'POST',
      url: '/dev-runs',
      payload: {...VALID_BODY, inputs: {timeout: 1}},
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('inputs-not-allowed');
  });

  test('maps integration triggers to 422 replay-event-required', async () => {
    createDevRunMock.mockRejectedValue(new DevRunReplayEventRequiredError('sentry_acme'));

    const res = await app.inject({
      method: 'POST',
      url: '/dev-runs',
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('replay-event-required');
  });

  test.each([
    ['ref-not-found', 404, 'ref-not-found', {ref: VALID_BODY.ref}],
    [
      'file-not-found',
      404,
      'file-not-found',
      {ref: VALID_BODY.ref, configPath: VALID_BODY.config_path},
    ],
    ['project-not-found', 404, 'project-not-found', {projectId: VALID_BODY.project_id}],
    ['ref-invalid', 400, 'ref-invalid', {ref: VALID_BODY.ref}],
    ['ref-moved', 409, 'ref-moved', {ref: VALID_BODY.ref, expectedCommit: COMMIT}],
    ['content-too-large', 422, 'content-too-large', {configPath: VALID_BODY.config_path}],
    ['source-unavailable', 502, 'source-unavailable', {}],
  ] as const)('maps a resolveDefinitionAtRef %s to %i %s', async (code, status, expectedCode, details) => {
    createDevRunMock.mockRejectedValue(
      createInterModuleKnownError(
        definitionsInterModuleContract.methods.resolveDefinitionAtRef,
        code,
        details,
      ),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/dev-runs',
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(status);
    expect(res.json().code).toBe(expectedCode);
  });

  test('maps an invalid definition to 422 invalid-workflow-definition with the errors', async () => {
    createDevRunMock.mockRejectedValue(
      createInterModuleKnownError(
        definitionsInterModuleContract.methods.resolveDefinitionAtRef,
        'invalid-definition',
        {errors: [{message: 'jobs must not be empty', path: 'jobs'}]},
      ),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/dev-runs',
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({
      code: 'invalid-workflow-definition',
      details: {errors: [{message: 'jobs must not be empty', path: 'jobs'}]},
    });
  });

  test('maps a suspended workspace from startDevRun to 409', async () => {
    createDevRunMock.mockRejectedValue(
      createInterModuleKnownError(
        workflowsInterModuleContract.methods.startDevRun,
        'workspace-suspended',
        {workspaceId},
      ),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/dev-runs',
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      code: 'workspace-suspended',
      message: 'Workspace is suspended',
    });
  });

  test('maps unresolvable interpolation to 422 workflow-interpolation-unresolvable', async () => {
    createDevRunMock.mockRejectedValue(
      createInterModuleKnownError(
        workflowsInterModuleContract.methods.startDevRun,
        'interpolation-unresolvable',
        {
          definitionId: crypto.randomUUID(),
          field: 'env',
          source: 'event.ref',
          envKey: 'REF',
        },
      ),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/dev-runs',
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({
      code: 'workflow-interpolation-unresolvable',
      details: {field: 'env', source: 'event.ref', env_key: 'REF'},
    });
  });
});
