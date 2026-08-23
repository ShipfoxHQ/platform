import {AUTH_USER, buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {type AuthMethod, ClientError, closeApp, createApp} from '@shipfox/node-fastify';
import type {FastifyRequest} from 'fastify';
import {agentValidationCatalog} from '#test/agent-validation-catalog.js';
import {createDefinitionRoutes} from './index.js';

const projects = {
  getProjectById: vi.fn(),
  requireProjectForWorkspace: vi.fn(),
} as unknown as ProjectsModuleClient;
const definitionRoutes = createDefinitionRoutes({
  projects,
  agent: {getValidationCatalog: vi.fn(() => agentValidationCatalog)} as never,
  integrations: {} as never,
});

const fakeUserAuth: AuthMethod = {
  name: AUTH_USER,
  authenticate: (request: FastifyRequest) => {
    if (request.headers.authorization !== 'Bearer user') {
      throw new ClientError('Invalid user token', 'unauthorized', {status: 401});
    }

    setUserContext(
      request,
      buildUserContext({userId: 'user-1', email: 'user@example.com', memberships: []}),
    );
    return Promise.resolve();
  },
};

afterEach(async () => {
  await closeApp();
});

describe('definition route auth', () => {
  test('uses user auth', () => {
    expect(definitionRoutes[0]?.auth).toBe(AUTH_USER);
  });

  test('rejects API-key-only requests', async () => {
    const app = await createApp({auth: [fakeUserAuth], routes: definitionRoutes, swagger: false});
    const res = await app.inject({
      method: 'GET',
      url: `/definitions?project_id=${crypto.randomUUID()}`,
      headers: {authorization: 'Bearer api-key'},
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('unauthorized');
  });
});
