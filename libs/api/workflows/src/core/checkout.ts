import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {checkoutTargetValidationIssues} from '@shipfox/workflow-document';
import {z} from 'zod';
import {
  type CheckoutRenewalSubject,
  normalizeRepositoryUrl,
} from '#core/entities/checkout-renewal-subject.js';
import type {Step} from '#core/entities/step.js';
import type {
  WorkflowRunOriginState,
  WorkflowRunTriggerReference,
} from '#core/entities/workflow-run.js';
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
      let message = 'Checkout connection requires a repository.';
      if (validationIssue.kind === 'project-with-connection') {
        message = 'Checkout project cannot be combined with a connection.';
      } else if (validationIssue.kind === 'project-with-repository') {
        message = 'Checkout project cannot be combined with a repository.';
      }
      context.addIssue({
        code: 'custom',
        path: [validationIssue.path],
        message,
      });
    }
  });

type CheckoutConfig = z.infer<typeof checkoutConfigSchema>;

export interface CheckoutPolicy {
  persistCredentials: boolean;
  permissionsContents: 'read' | 'write';
}

export function getCheckoutPolicy(stepConfig: unknown): CheckoutPolicy | null {
  if (typeof stepConfig !== 'object' || stepConfig === null || Array.isArray(stepConfig))
    return null;
  const checkout = (stepConfig as {checkout?: unknown}).checkout;
  const result = checkoutConfigSchema.safeParse(checkout);
  if (!result.success) return null;
  return {
    persistCredentials: result.data.persist_credentials ?? true,
    permissionsContents: result.data.permissions?.contents ?? 'read',
  };
}

export async function createStepCheckoutSpec({
  step,
  workspaceId,
  projectId,
  triggerReference,
  run,
  integrations,
  projects,
}: {
  step: Step;
  workspaceId: string;
  projectId: string;
  triggerReference?: WorkflowRunTriggerReference | null | undefined;
  /** The run's origin state; a dev run checks out its dev commit by default. */
  run: WorkflowRunOriginState;
  integrations: IntegrationsModuleClient;
  projects: ProjectsModuleClient;
}): Promise<{
  spec: {
    repositoryUrl: string;
    ref: string;
    credentials?: {
      username: string;
      token: string;
      expiresAt: Date;
      generation?: string | undefined;
      renewal?: {mode: 'refresh-at'; refreshAt: Date} | {mode: 'on-rejection'} | undefined;
    };
    gitAuthor?: {name: string; email: string};
  };
  fetchDepth: number;
  persistCredentials: boolean;
  renewalSubject?: Omit<CheckoutRenewalSubject, 'stepId' | 'attempt'>;
}> {
  const checkout = parseCheckoutConfig(step);
  const {project: defaultProject} = await projects.getProjectById({projectId});
  if (defaultProject === null || defaultProject === undefined) {
    throw new CheckoutIntentUnresolvedError({kind: 'project', value: projectId});
  }

  const target = await checkoutTarget({
    checkout,
    defaultProjectId: projectId,
    defaultConnectionId: defaultProject.sourceConnectionId,
    integrations,
    workspaceId,
  });
  const resolvedTarget = await projects.resolveCheckoutTarget({
    workspaceId,
    defaults: {
      connectionId: defaultProject.sourceConnectionId,
      owner: defaultOwner(defaultProject.sourceRepositoryOwner, checkout.repository),
    },
    target,
  });
  const ref = resolveCheckoutRef({checkout, triggerReference, run, resolvedTarget, projectId});
  const permissions = checkout.permissions ?? {contents: 'read'};
  const response = await integrations.createCheckoutSpec({
    workspaceId,
    connectionId: resolvedTarget.connectionId,
    externalRepositoryId: resolvedTarget.externalRepositoryId,
    ...(ref === undefined ? {} : {ref}),
    permissions,
  });

  return checkoutResult(checkout, response, {
    connectionId: resolvedTarget.connectionId,
    externalRepositoryId: resolvedTarget.externalRepositoryId,
    permissions,
  });
}

export function renewStepCheckoutCredentials({
  integrations,
  workspaceId,
  subject,
  rejectedGeneration,
}: {
  integrations: Pick<IntegrationsModuleClient, 'createCheckoutCredentials'>;
  workspaceId: string;
  subject: Pick<CheckoutRenewalSubject, 'connectionId' | 'externalRepositoryId' | 'permissions'>;
  rejectedGeneration?: string | undefined;
}) {
  return integrations.createCheckoutCredentials({
    workspaceId,
    connectionId: subject.connectionId,
    externalRepositoryId: subject.externalRepositoryId,
    permissions: subject.permissions,
    ...(rejectedGeneration === undefined ? {} : {rejectedGeneration}),
  });
}

function resolveCheckoutRef(params: {
  checkout: CheckoutConfig;
  triggerReference: WorkflowRunTriggerReference | null | undefined;
  run: WorkflowRunOriginState;
  resolvedTarget: {projectId?: string | undefined};
  projectId: string;
}): string | undefined {
  // Explicit step refs win, followed by same-project event commits (including
  // replays), then the pinned dev commit for the run's own project. Other targets
  // intentionally use the provider default branch.
  let triggerCommitRef: string | undefined;
  const {triggerReference} = params;
  if (
    triggerReference !== null &&
    triggerReference !== undefined &&
    triggerReference.project?.id === params.resolvedTarget.projectId
  ) {
    triggerCommitRef = triggerReference.commit ?? undefined;
  }
  let devCommitRef: string | undefined;
  if (params.run.origin === 'dev' && params.resolvedTarget.projectId === params.projectId) {
    devCommitRef = params.run.devSource.commit;
  }
  return params.checkout.ref ?? triggerCommitRef ?? devCommitRef;
}

type CheckoutSpecResponse = Awaited<ReturnType<IntegrationsModuleClient['createCheckoutSpec']>>;

function checkoutResult(
  checkout: CheckoutConfig,
  response: CheckoutSpecResponse,
  target: Pick<CheckoutRenewalSubject, 'connectionId' | 'externalRepositoryId' | 'permissions'>,
) {
  const credentials = checkoutCredentials(response.credentials);
  const persistCredentials = checkout.persist_credentials ?? true;
  return {
    spec: {
      repositoryUrl: response.repositoryUrl,
      ref: response.ref,
      ...(credentials === undefined ? {} : {credentials}),
      ...(response.gitAuthor === undefined ? {} : {gitAuthor: response.gitAuthor}),
    },
    fetchDepth: checkout.fetch_depth ?? 1,
    persistCredentials,
    ...(credentials === undefined || !persistCredentials
      ? {}
      : {
          renewalSubject: {
            repositoryUrl: normalizeRepositoryUrl(response.repositoryUrl),
            connectionId: target.connectionId,
            externalRepositoryId: target.externalRepositoryId,
            permissions: target.permissions,
          },
        }),
  };
}

function checkoutCredentials(credentials: CheckoutSpecResponse['credentials']) {
  if (credentials === undefined) return undefined;
  const renewal = checkoutCredentialRenewal(credentials.renewal);
  return {
    username: credentials.username,
    token: credentials.token,
    expiresAt: new Date(credentials.expiresAt),
    ...(credentials.generation === undefined ? {} : {generation: credentials.generation}),
    ...(renewal === undefined ? {} : {renewal}),
  };
}

function checkoutCredentialRenewal(
  renewal: NonNullable<CheckoutSpecResponse['credentials']>['renewal'],
) {
  if (renewal === undefined) return undefined;
  if (renewal.mode === 'refresh-at') {
    return {mode: 'refresh-at' as const, refreshAt: new Date(renewal.refreshAt)};
  }
  return {mode: 'on-rejection' as const};
}

function parseCheckoutConfig(step: Step): CheckoutConfig {
  const result = checkoutConfigSchema.safeParse(step.config.checkout);
  if (!result.success) {
    throw new CheckoutConfigInvalidError(step.id);
  }
  return result.data;
}

async function checkoutTarget(params: {
  checkout: CheckoutConfig;
  defaultProjectId: string;
  defaultConnectionId: string;
  integrations: IntegrationsModuleClient;
  workspaceId: string;
}) {
  const {checkout} = params;
  if (checkout.project !== undefined) return {project: checkout.project};
  if (checkout.repository !== undefined) {
    const connection =
      checkout.connection === undefined
        ? undefined
        : await resolveConnectionId({
            integrations: params.integrations,
            workspaceId: params.workspaceId,
            defaultConnectionId: params.defaultConnectionId,
            slug: checkout.connection,
          });
    return {
      ...(connection === undefined ? {} : {connection}),
      repository: checkout.repository,
    };
  }
  return {project: params.defaultProjectId};
}

async function resolveConnectionId(params: {
  integrations: IntegrationsModuleClient;
  workspaceId: string;
  defaultConnectionId: string;
  slug: string;
}): Promise<string> {
  const connection = await params.integrations.resolveConnection({
    workspaceId: params.workspaceId,
    slug: params.slug,
  });
  if (connection === null) {
    throw new CheckoutIntentUnresolvedError({kind: 'connection', value: params.slug});
  }
  return connection.id;
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
