import type {DefinitionResponseDto} from '@shipfox/api-definitions-dto';
import type {ProjectResponseDto} from '@shipfox/api-projects-dto';
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
      {path: params.configPath, content: renderedWorkflowYaml},
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
