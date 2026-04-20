import {setApiKeyContext} from '@shipfox/api-auth-context';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {createWorkflowRun} from '#db/workflow-runs.js';
import {getRunRoute} from './get-run.js';

describe('GET /api/workflows/runs/:id', () => {
  let app: FastifyInstance;
  let workspaceId: string;

  beforeAll(async () => {
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.addHook('onRequest', (request, _reply, done) => {
      setApiKeyContext(request, {
        apiKeyId: crypto.randomUUID(),
        workspaceId,
        workspaceStatus: 'active',
        scopes: ['*'],
      });
      done();
    });
    app.get('/api/workflows/runs/:id', getRunRoute);
    await app.ready();
  });

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
  });

  test('returns 200 with run, jobs, and steps', async () => {
    const projectId = crypto.randomUUID();
    const definitionId = crypto.randomUUID();

    const run = await createWorkflowRun({
      workspaceId,
      projectId,
      definitionId,
      definition: {
        name: 'Test',
        jobs: {
          build: {steps: [{name: 'Install', run: 'npm install'}, {run: 'npm build'}]},
        },
      },
      triggerContext: {type: 'manual'},
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/${run.id}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(run.id);
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0].name).toBe('build');
    expect(body.jobs[0].steps).toHaveLength(2);
    expect(body.jobs[0].steps[0].name).toBe('Install');
    expect(body.jobs[0].steps[1].name).toBeNull();
  });

  test('returns 404 for non-existent run', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/${crypto.randomUUID()}`,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not-found');
  });
});
