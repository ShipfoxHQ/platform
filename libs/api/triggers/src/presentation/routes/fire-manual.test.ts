import {buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import {
  type WorkflowsModuleClient,
  workflowsInterModuleContract,
} from '@shipfox/api-workflows-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {triggerSubscriptionFactory} from '#test/index.js';

const fireManualSubscriptionMock = vi.hoisted(() => vi.fn());

vi.mock('#core/fire-manual.js', () => ({
  fireManualSubscription: fireManualSubscriptionMock,
}));

const {createFireManualTriggerRoute} = await import('./fire-manual.js');

const workflows = {} as WorkflowsModuleClient;

describe('POST /:definitionId/fire-manual', () => {
  let app: FastifyInstance;
  let workspaceId: string;
  let memberships: Array<{workspaceId: string; role: 'admin'}>;

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
    app.post('/:definitionId/fire-manual', createFireManualTriggerRoute(workflows));
    await app.ready();
  });

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    memberships = [{workspaceId, role: 'admin'}];
    fireManualSubscriptionMock.mockReset();
  });

  test('returns 201 with the created run id', async () => {
    const definitionId = crypto.randomUUID();
    const runId = crypto.randomUUID();
    await triggerSubscriptionFactory.create({workspaceId, workflowDefinitionId: definitionId});
    fireManualSubscriptionMock.mockResolvedValue({id: runId, name: 'Manual run'});

    const res = await app.inject({
      method: 'POST',
      url: `/${definitionId}/fire-manual`,
      payload: {},
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({workflow_run_id: runId});
  });

  test('maps unresolvable workflow interpolation to 422', async () => {
    const definitionId = crypto.randomUUID();
    await triggerSubscriptionFactory.create({workspaceId, workflowDefinitionId: definitionId});
    fireManualSubscriptionMock.mockRejectedValue(
      createInterModuleKnownError(
        workflowsInterModuleContract.methods.startRunFromTrigger,
        'interpolation-unresolvable',
        {definitionId, field: 'env', source: 'event.ref', envKey: 'REF'},
      ),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/${definitionId}/fire-manual`,
      payload: {},
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({
      code: 'workflow-interpolation-unresolvable',
      details: {
        field: 'env',
        source: 'event.ref',
        env_key: 'REF',
      },
    });
  });

  test('maps suspended workspace to 409', async () => {
    const definitionId = crypto.randomUUID();
    await triggerSubscriptionFactory.create({workspaceId, workflowDefinitionId: definitionId});
    fireManualSubscriptionMock.mockRejectedValue(
      createInterModuleKnownError(
        workflowsInterModuleContract.methods.startRunFromTrigger,
        'workspace-suspended',
        {workspaceId},
      ),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/${definitionId}/fire-manual`,
      payload: {},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      code: 'workspace-suspended',
      message: 'Workspace is suspended',
    });
  });

  test('maps missing workspace to 404', async () => {
    const definitionId = crypto.randomUUID();
    await triggerSubscriptionFactory.create({workspaceId, workflowDefinitionId: definitionId});
    fireManualSubscriptionMock.mockRejectedValue(
      createInterModuleKnownError(
        workflowsInterModuleContract.methods.startRunFromTrigger,
        'workspace-not-found',
        {workspaceId},
      ),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/${definitionId}/fire-manual`,
      payload: {},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({code: 'workspace-not-found', message: 'Workspace not found'});
  });

  test('maps deleted workspace to 404', async () => {
    const definitionId = crypto.randomUUID();
    await triggerSubscriptionFactory.create({workspaceId, workflowDefinitionId: definitionId});
    fireManualSubscriptionMock.mockRejectedValue(
      createInterModuleKnownError(
        workflowsInterModuleContract.methods.startRunFromTrigger,
        'workspace-deleted',
        {workspaceId},
      ),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/${definitionId}/fire-manual`,
      payload: {},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({code: 'workspace-deleted', message: 'Workspace is deleted'});
  });

  test('returns 404 when the manual trigger is unavailable', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/${crypto.randomUUID()}/fire-manual`,
      payload: {},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('manual-trigger-not-found');
  });
});
