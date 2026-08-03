import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {checkoutTargetValidationIssues} from '@shipfox/workflow-document';
import {z} from 'zod';
import type {Step} from '#core/entities/step.js';
import {CheckoutConfigInvalidError, CheckoutIntentUnresolvedError} from './errors.js';

const checkoutConfigSchema = z
  .object({
    project: z.string().uuid().optional(),
    connection: z.string().min(1).optional(),
    repository: z.string().min(1).optional(),
    ref: z.string().min(1).optional(),
    fetch_depth: z.number().int().nonnegative().optional(),
    permissions: z.object({contents: z.enum(['read', 'write'])}).optional(),
    persist_credentials: z.boolean().optional(),
  })
  .superRefine((checkout, context) => {
    for (const validationIssue of checkoutTargetValidationIssues(checkout)) {
      const message =
        validationIssue.kind === 'project-with-connection'
          ? 'Checkout project cannot be combined with a connection.'
          : validationIssue.kind === 'project-with-repository'
            ? 'Checkout project cannot be combined with a repository.'
            : 'Checkout connection requires a repository.';
      context.addIssue({
        code: 'custom',
        path: [validationIssue.path],
        message,
      });
    }
  });

type CheckoutConfig = z.infer<typeof checkoutConfigSchema>;

export async function createStepCheckoutSpec({
  step,
  workspaceId,
  projectId,
  integrations,
  projects,
}: {
  step: Step;
  workspaceId: string;
  projectId: string;
  integrations: IntegrationsModuleClient;
  projects: ProjectsModuleClient;
}): Promise<{
  spec: {
    repositoryUrl: string;
    ref: string;
    credentials?: {username: string; token: string; expiresAt: Date};
    gitAuthor?: {name: string; email: string};
  };
  fetchDepth: number;
  persistCredentials: boolean;
}> {
  const checkout = parseCheckoutConfig(step);
  const {project: defaultProject} = await projects.getProjectById({projectId});
  if (defaultProject === null || defaultProject === undefined) {
    throw new CheckoutIntentUnresolvedError(projectId);
  }

  const target = checkoutTarget(checkout, projectId);
  const resolvedTarget = await projects.resolveCheckoutTarget({
    workspaceId,
    defaults: {
      connectionId: defaultProject.sourceConnectionId,
      owner: defaultOwner(defaultProject.sourceRepositoryOwner, checkout.repository),
    },
    target,
  });
  const response = await integrations.createCheckoutSpec({
    workspaceId,
    connectionId: resolvedTarget.connectionId,
    externalRepositoryId: resolvedTarget.externalRepositoryId,
    ...(checkout.ref === undefined ? {} : {ref: checkout.ref}),
    permissions: checkout.permissions ?? {contents: 'read'},
  });

  return {
    spec: {
      repositoryUrl: response.repositoryUrl,
      ref: response.ref,
      ...(response.credentials
        ? {
            credentials: {
              ...response.credentials,
              expiresAt: new Date(response.credentials.expiresAt),
            },
          }
        : {}),
      ...(response.gitAuthor === undefined ? {} : {gitAuthor: response.gitAuthor}),
    },
    fetchDepth: checkout.fetch_depth ?? 1,
    persistCredentials: checkout.persist_credentials ?? true,
  };
}

function parseCheckoutConfig(step: Step): CheckoutConfig {
  const result = checkoutConfigSchema.safeParse(step.config.checkout);
  if (!result.success) {
    throw new CheckoutConfigInvalidError(step.id);
  }
  return result.data;
}

function checkoutTarget(checkout: CheckoutConfig, defaultProjectId: string) {
  if (checkout.project !== undefined) return {project: checkout.project};
  if (checkout.repository !== undefined) {
    return {
      ...(checkout.connection === undefined ? {} : {connection: checkout.connection}),
      repository: checkout.repository,
    };
  }
  return {project: defaultProjectId};
}

function defaultOwner(
  projectOwner: string | null | undefined,
  repository: string | undefined,
): string {
  if (projectOwner) return projectOwner;
  const separator = repository?.indexOf('/') ?? -1;
  if (separator > 0 && repository !== undefined) return repository.slice(0, separator);
  return 'unknown';
}
