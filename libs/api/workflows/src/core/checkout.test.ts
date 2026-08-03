import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {projectFactory} from '#test/factories/project.js';
import {createStepCheckoutSpec} from './checkout.js';
import type {Step} from './entities/step.js';
import {CheckoutConfigInvalidError, CheckoutIntentUnresolvedError} from './errors.js';

const getProjectById = vi.fn();
const resolveCheckoutTarget = vi.fn();
const projects = {
  getProjectById,
  resolveCheckoutTarget,
} as Pick<ProjectsModuleClient, 'getProjectById' | 'resolveCheckoutTarget'>;

const resolveConnection = vi.fn();
const createCheckoutSpec = vi.fn();
const integrations = {
  resolveConnection,
  createCheckoutSpec,
} as Pick<IntegrationsModuleClient, 'createCheckoutSpec' | 'resolveConnection'>;

describe('createStepCheckoutSpec', () => {
  beforeEach(() => {
    getProjectById.mockReset();
    resolveCheckoutTarget.mockReset();
    resolveConnection.mockReset();
    createCheckoutSpec.mockReset();
  });

  it('resolves the default project target and setup-step defaults', async () => {
    const project = projectFactory.build();
    const step = checkoutStep({
      permissions: {contents: 'read'},
      persist_credentials: true,
    });
    getProjectById.mockResolvedValue({project});
    resolveCheckoutTarget.mockResolvedValue({
      projectId: project.id,
      connectionId: project.sourceConnectionId,
      externalRepositoryId: project.sourceExternalRepositoryId,
    });
    createCheckoutSpec.mockResolvedValue({
      repositoryUrl: 'https://github.com/acme/repo.git',
      ref: 'main',
    });

    const result = await createStepCheckoutSpec({
      step,
      workspaceId: project.workspaceId,
      projectId: project.id,
      integrations: integrations as IntegrationsModuleClient,
      projects: projects as ProjectsModuleClient,
    });

    expect(result).toEqual({
      spec: {
        repositoryUrl: 'https://github.com/acme/repo.git',
        ref: 'main',
      },
      fetchDepth: 1,
      persistCredentials: true,
    });
    expect(resolveCheckoutTarget).toHaveBeenCalledWith({
      workspaceId: project.workspaceId,
      defaults: {connectionId: project.sourceConnectionId, owner: 'acme'},
      target: {project: project.id},
    });
    expect(createCheckoutSpec).toHaveBeenCalledWith({
      workspaceId: project.workspaceId,
      connectionId: project.sourceConnectionId,
      externalRepositoryId: project.sourceExternalRepositoryId,
      permissions: {contents: 'read'},
    });
  });

  it('passes an explicit frozen target, ref, permissions, and fetch depth', async () => {
    const project = projectFactory.build();
    const targetProjectId = crypto.randomUUID();
    const step = checkoutStep({
      project: targetProjectId,
      ref: 'refs/pull/412/head',
      fetch_depth: 0,
      permissions: {contents: 'write'},
      persist_credentials: false,
    });
    getProjectById.mockResolvedValue({project});
    resolveCheckoutTarget.mockResolvedValue({
      projectId: targetProjectId,
      connectionId: crypto.randomUUID(),
      externalRepositoryId: 'github:412',
    });
    createCheckoutSpec.mockResolvedValue({
      repositoryUrl: 'https://github.com/acme/repo.git',
      ref: 'refs/pull/412/head',
    });

    const result = await createStepCheckoutSpec({
      step,
      workspaceId: project.workspaceId,
      projectId: project.id,
      integrations: integrations as IntegrationsModuleClient,
      projects: projects as ProjectsModuleClient,
    });

    expect(result.fetchDepth).toBe(0);
    expect(result.persistCredentials).toBe(false);
    expect(resolveCheckoutTarget).toHaveBeenCalledWith(
      expect.objectContaining({target: {project: targetProjectId}}),
    );
    expect(createCheckoutSpec).toHaveBeenCalledWith({
      workspaceId: project.workspaceId,
      connectionId: expect.any(String),
      externalRepositoryId: 'github:412',
      ref: 'refs/pull/412/head',
      permissions: {contents: 'write'},
    });
  });

  it('resolves a repository target using the frozen project owner as the default', async () => {
    const project = projectFactory.build();
    const step = checkoutStep({repository: 'repo', persist_credentials: true});
    getProjectById.mockResolvedValue({project});
    resolveCheckoutTarget.mockResolvedValue({
      projectId: project.id,
      connectionId: project.sourceConnectionId,
      externalRepositoryId: project.sourceExternalRepositoryId,
    });
    createCheckoutSpec.mockResolvedValue({
      repositoryUrl: 'https://github.com/acme/repo.git',
      ref: 'main',
    });

    await createStepCheckoutSpec({
      step,
      workspaceId: project.workspaceId,
      projectId: project.id,
      integrations: integrations as IntegrationsModuleClient,
      projects: projects as ProjectsModuleClient,
    });

    expect(resolveCheckoutTarget).toHaveBeenCalledWith({
      workspaceId: project.workspaceId,
      defaults: {connectionId: project.sourceConnectionId, owner: 'acme'},
      target: {repository: 'repo'},
    });
  });

  it('resolves an explicit connection slug before resolving a repository target', async () => {
    const project = projectFactory.build();
    const connectionId = crypto.randomUUID();
    const step = checkoutStep({connection: 'github', repository: 'acme/repo'});
    getProjectById.mockResolvedValue({project});
    resolveConnection.mockResolvedValue({id: connectionId, provider: 'github', slug: 'github'});
    resolveCheckoutTarget.mockResolvedValue({
      projectId: project.id,
      connectionId,
      externalRepositoryId: project.sourceExternalRepositoryId,
    });
    createCheckoutSpec.mockResolvedValue({
      repositoryUrl: 'https://github.com/acme/repo.git',
      ref: 'main',
    });

    await createStepCheckoutSpec({
      step,
      workspaceId: project.workspaceId,
      projectId: project.id,
      integrations: integrations as IntegrationsModuleClient,
      projects: projects as ProjectsModuleClient,
    });

    expect(resolveConnection).toHaveBeenCalledWith({
      workspaceId: project.workspaceId,
      slug: 'github',
    });
    expect(resolveCheckoutTarget).toHaveBeenCalledWith({
      workspaceId: project.workspaceId,
      defaults: {connectionId: project.sourceConnectionId, owner: 'acme'},
      target: {connection: connectionId, repository: 'acme/repo'},
    });
  });

  it.each([
    {repository: 'octocat/repo', owner: 'octocat'},
    {repository: 'repo', owner: 'unknown'},
  ])('derives the repository owner fallback for $repository', async ({repository, owner}) => {
    const project = projectFactory.build({sourceRepositoryOwner: null});
    const step = checkoutStep({repository});
    getProjectById.mockResolvedValue({project});
    resolveCheckoutTarget.mockResolvedValue({
      projectId: project.id,
      connectionId: project.sourceConnectionId,
      externalRepositoryId: project.sourceExternalRepositoryId,
    });
    createCheckoutSpec.mockResolvedValue({
      repositoryUrl: 'https://github.com/acme/repo.git',
      ref: 'main',
    });

    await createStepCheckoutSpec({
      step,
      workspaceId: project.workspaceId,
      projectId: project.id,
      integrations: integrations as IntegrationsModuleClient,
      projects: projects as ProjectsModuleClient,
    });

    expect(resolveCheckoutTarget).toHaveBeenCalledWith({
      workspaceId: project.workspaceId,
      defaults: {connectionId: project.sourceConnectionId, owner},
      target: {repository},
    });
  });

  it.each([
    {project: crypto.randomUUID(), connection: 'github'},
    {project: crypto.randomUUID(), repository: 'acme/repo'},
    {connection: 'github'},
  ])('rejects invalid checkout target shape: %j', async (checkout) => {
    const act = createStepCheckoutSpec({
      step: checkoutStep(checkout),
      workspaceId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      integrations: integrations as IntegrationsModuleClient,
      projects: projects as ProjectsModuleClient,
    });

    await expect(act).rejects.toBeInstanceOf(CheckoutConfigInvalidError);
    expect(getProjectById).not.toHaveBeenCalled();
    expect(resolveCheckoutTarget).not.toHaveBeenCalled();
    expect(createCheckoutSpec).not.toHaveBeenCalled();
  });

  it('throws when the run project is missing', async () => {
    const projectId = crypto.randomUUID();
    getProjectById.mockResolvedValue({project: null});

    const act = createStepCheckoutSpec({
      step: checkoutStep({}),
      workspaceId: crypto.randomUUID(),
      projectId,
      integrations: integrations as IntegrationsModuleClient,
      projects: projects as ProjectsModuleClient,
    });

    await expect(act).rejects.toBeInstanceOf(CheckoutIntentUnresolvedError);
    expect(resolveCheckoutTarget).not.toHaveBeenCalled();
    expect(createCheckoutSpec).not.toHaveBeenCalled();
  });

  it('identifies a missing explicit connection in the unresolved error', async () => {
    const project = projectFactory.build();
    const step = checkoutStep({connection: 'missing', repository: 'acme/repo'});
    getProjectById.mockResolvedValue({project});
    resolveConnection.mockResolvedValue(null);

    const act = createStepCheckoutSpec({
      step,
      workspaceId: project.workspaceId,
      projectId: project.id,
      integrations: integrations as IntegrationsModuleClient,
      projects: projects as ProjectsModuleClient,
    });

    await expect(act).rejects.toThrow('Checkout intent unresolved: connection missing not found');
    expect(resolveCheckoutTarget).not.toHaveBeenCalled();
    expect(createCheckoutSpec).not.toHaveBeenCalled();
  });
});

function checkoutStep(checkout: Record<string, unknown>): Step {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    jobExecutionId: crypto.randomUUID(),
    key: null,
    name: 'Checkout',
    sourceLocation: null,
    status: 'running',
    statusReason: null,
    evaluationTrace: null,
    type: 'checkout',
    config: {checkout},
    condition: null,
    configPlan: null,
    authoredConfig: null,
    error: null,
    position: 1,
    version: 1,
    currentAttempt: 1,
    createdAt: now,
    updatedAt: now,
  };
}
