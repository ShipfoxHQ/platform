import type {DefinitionResponseDto} from '@shipfox/api-definitions-dto';
import type {ProjectResponseDto} from '@shipfox/api-projects-dto';
import {createApiClient} from '@shipfox/e2e-core';
import {type CreatedIssue, commitFiles, createIssue, createRepo} from '@shipfox/e2e-driver-gitea';
import {waitForDefinition} from '@shipfox/e2e-observe-definitions';
import {createProject, giteaExternalRepositoryId} from './create-project.js';
import type {SuiteContext} from './suite-context.js';

const GITEA_SOURCE_PLACEHOLDER = '__GITEA_SOURCE__';
const GITEA_REPOSITORY_PLACEHOLDER = '__GITEA_REPOSITORY__';
const GITEA_REPOSITORY_NAME_PLACEHOLDER = '__GITEA_REPOSITORY_NAME__';
const WEBHOOK_SOURCE_PLACEHOLDER = '__WEBHOOK_SOURCE__';
const RUNNER_LABEL_PLACEHOLDER = '__RUNNER_LABEL__';
const MODEL_PROVIDER_PLACEHOLDER = '__MODEL_PROVIDER__';
const AGENT_MODEL_PLACEHOLDER = '__AGENT_MODEL__';

export interface WorkflowProjectFile {
  path: string;
  content: string;
}

/**
 * How a seeded project gets its definition.
 *
 * `vcs` commits the workflow file and waits for the definition sync to apply it, which is
 * what a test of the sync itself needs. `api` posts the same YAML to `POST /definitions`,
 * for tests that only need a definition to exist before they exercise something else.
 */
export type DefinitionDelivery = 'vcs' | 'api';

// A job checks out the project repository unless it opts out, so an `api` delivery still
// needs the repo to hold a commit and therefore a default branch.
const CHECKOUT_PLACEHOLDER_FILE: WorkflowProjectFile = {
  path: 'README.md',
  content: '# Shipfox E2E fixture repository\n',
};

export interface SeededWorkflowProject {
  project: ProjectResponseDto;
  repo: string;
  renderedWorkflowYaml: string;
  giteaIssue?: CreatedIssue;
}

export interface ReadyWorkflowProject extends SeededWorkflowProject {
  definition: DefinitionResponseDto;
}

export function renderWorkflowYaml(params: {
  suite: SuiteContext;
  repo: string;
  runnerLabel: string;
  webhookSlug?: string | undefined;
  workflowYaml: string;
  replacements?: Record<string, string> | undefined;
}): string {
  let rendered = params.workflowYaml
    .replaceAll(GITEA_SOURCE_PLACEHOLDER, params.suite.connectionSlug)
    .replaceAll(GITEA_REPOSITORY_PLACEHOLDER, `${params.suite.org}/${params.repo}`)
    .replaceAll(GITEA_REPOSITORY_NAME_PLACEHOLDER, params.repo)
    .replaceAll(RUNNER_LABEL_PLACEHOLDER, params.runnerLabel)
    .replaceAll(MODEL_PROVIDER_PLACEHOLDER, params.suite.modelProviderId)
    .replaceAll(AGENT_MODEL_PLACEHOLDER, params.suite.agentModel);
  if (params.webhookSlug !== undefined) {
    rendered = rendered.replaceAll(WEBHOOK_SOURCE_PLACEHOLDER, params.webhookSlug);
  }
  for (const [placeholder, value] of Object.entries(params.replacements ?? {})) {
    rendered = rendered.replaceAll(placeholder, value);
  }
  return rendered;
}

export async function seedWorkflowProject(params: {
  suite: SuiteContext;
  token: string;
  name: string;
  repo: string;
  runnerLabel: string;
  workflowYaml: string;
  configPath: string;
  webhookSlug?: string | undefined;
  replacements?: Record<string, string> | undefined;
  extraFiles?: WorkflowProjectFile[] | undefined;
  giteaIssue?: {title: string; body: string} | undefined;
  definitionDelivery?: DefinitionDelivery | undefined;
}): Promise<SeededWorkflowProject> {
  await createRepo({org: params.suite.org, name: params.repo});
  const giteaIssue =
    params.giteaIssue === undefined
      ? undefined
      : await createIssue({
          org: params.suite.org,
          repo: params.repo,
          title: params.giteaIssue.title,
          body: params.giteaIssue.body,
        });
  const renderedWorkflowYaml = renderWorkflowYaml({
    ...params,
    replacements: {
      ...(params.replacements ?? {}),
      ...(giteaIssue === undefined ? {} : {__GITEA_ISSUE_NUMBER__: String(giteaIssue.number)}),
    },
  });
  await commitFiles({
    org: params.suite.org,
    repo: params.repo,
    message: `seed ${params.name}`,
    files: [
      // An `api` delivery deliberately leaves the workflow file out of the repo. A synced
      // VCS definition at the same path is a second row with the same triggers, so it
      // subscribes twice and one event starts two runs.
      params.definitionDelivery === 'api'
        ? CHECKOUT_PLACEHOLDER_FILE
        : {path: params.configPath, content: renderedWorkflowYaml},
      ...(params.extraFiles ?? []).map((file) => ({path: file.path, content: file.content})),
    ],
  });

  const project = await createProject({
    workspaceId: params.suite.workspaceId,
    sessionToken: params.token,
    name: params.repo,
    connectionId: params.suite.connectionId,
    externalRepositoryId: giteaExternalRepositoryId(params.suite.org, params.repo),
  });

  return {
    project,
    repo: params.repo,
    renderedWorkflowYaml,
    ...(giteaIssue === undefined ? {} : {giteaIssue}),
  };
}

export async function seedAndWaitForDefinition(params: Parameters<typeof seedWorkflowProject>[0]) {
  const seeded = await seedWorkflowProject(params);
  const definition = await waitForDefinition({
    projectId: seeded.project.id,
    configPath: params.configPath,
    token: params.token,
  });
  return {...seeded, definition};
}

/**
 * Seeds a project and creates its definition over the API in one round trip.
 *
 * Prefer this over `seedAndWaitForDefinition` unless the definition sync is the subject of
 * the test. Waiting for a sync makes an arrangement step depend on gitea, the outbox, and
 * a Temporal workflow whose provider activities retry with 5s/10s/20s/40s backoff, so a
 * transient failure holds the sync in `syncing` far longer than the arrangement is worth
 * waiting for. `POST /definitions` runs the same parsing and integration validation
 * synchronously, so a workflow this suite got wrong fails as a 400 naming the problem
 * instead of a poll timing out with no error to report.
 */
export async function seedProjectWithApiDefinition(
  params: Parameters<typeof seedWorkflowProject>[0],
): Promise<ReadyWorkflowProject> {
  const seeded = await seedWorkflowProject({...params, definitionDelivery: 'api'});
  const definition = await createApiClient({
    token: params.token,
  }).requestJson<DefinitionResponseDto>('post', '/definitions', {
    json: {
      project_id: seeded.project.id,
      source: 'manual',
      yaml: seeded.renderedWorkflowYaml,
    },
  });
  assertResolvedReferences(definition, params.name);
  return {...seeded, definition};
}

/**
 * A workflow naming a connection, tool, or method the workspace does not have is only a
 * warning, because a definition stays authorable while its integration is being connected.
 * A seeded fixture has no such excuse: its trigger would never fire and its tools would
 * never be offered, so the run fails minutes later with nothing pointing back at the
 * arrangement. Failing on the diagnostic names the missing reference instead.
 */
function assertResolvedReferences(definition: DefinitionResponseDto, scenario: string): void {
  const unresolved = (definition.diagnostics ?? []).filter((diagnostic) =>
    diagnostic.code.startsWith('unknown-'),
  );
  if (unresolved.length === 0) return;

  const detail = unresolved
    .map((diagnostic) => `${diagnostic.code} at ${diagnostic.path ?? 'unknown path'}`)
    .join(', ');
  throw new Error(`Seeded ${scenario} definition references unresolved integrations: ${detail}`);
}
