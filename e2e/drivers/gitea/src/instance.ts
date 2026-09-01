import {Buffer} from 'node:buffer';
import {config, defaultWebhookTargetUrl} from './config.js';
import {encodeSegment, GiteaInstanceError, giteaFetch, giteaFetchJson} from './gitea-client.js';

// Scoped teams that include every repo, current and future, mirroring
// dev/gitea/bootstrap.sh. Keeping code read access and issue-comment write access
// separate means a leaked bot credential cannot push code or manage the org.
const READ_TEAM_NAME = 'shipfox-readers';
const ISSUE_WRITE_TEAM_NAME = 'shipfox-issue-writers';

export interface CreateOrgParams {
  name?: string;
  visibility?: 'public' | 'private' | 'limited';
  botUsername?: string;
  webhookTargetUrl?: string;
  webhookSecret?: string;
}

export interface CreatedOrg {
  org: string;
  teamId: number;
  webhookId: number;
}

export interface CreateRepoParams {
  org: string;
  name: string;
  private?: boolean;
  autoInit?: boolean;
  defaultBranch?: string;
}

export interface CreatedRepo {
  name: string;
  fullName: string;
  cloneUrl: string;
  defaultBranch: string;
}

export interface CreateIssueParams {
  org: string;
  repo: string;
  title: string;
  body?: string;
}

export interface CreatedIssue {
  number: number;
  title: string;
  body: string;
}

export interface IssueComment {
  id: number;
  body: string;
}

export type CommitFileOperation = 'create' | 'update' | 'delete';

export interface CommitFile {
  path: string;
  content?: string;
  operation?: CommitFileOperation;
  sha?: string;
}

export interface CommitFilesParams {
  org: string;
  repo: string;
  message: string;
  files: CommitFile[];
  branch?: string;
}

export function generateOrgName(): string {
  return `e2e-${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`;
}

// Org + scoped bot memberships + push webhook, mirroring
// dev/gitea/bootstrap.sh. A fresh org per suite run is required because an org
// can only ever be linked to one workspace (GiteaOrgAlreadyLinkedError). The org
// is public so the platform service account can see it exists while its repos
// stay private, exercising the checkout path's Basic auth. The bot can read repo
// code and write issue comments, but cannot push code or manage org hooks.
export async function createOrg(params: CreateOrgParams = {}): Promise<CreatedOrg> {
  const org = params.name ?? generateOrgName();

  await giteaFetch('orgs', {
    method: 'POST',
    json: {username: org, visibility: params.visibility ?? 'public'},
  });

  // A failure after the org exists (team, membership, or webhook) would strand it
  // in the shared instance with no handle for the caller to clean up, so undo the
  // half-built org here. It owns no repos yet, so deleteOrg always succeeds.
  try {
    const team = await giteaFetchJson<{id: number}>(`orgs/${encodeSegment(org)}/teams`, {
      method: 'POST',
      json: {
        name: READ_TEAM_NAME,
        permission: 'read',
        includes_all_repositories: true,
        units: ['repo.code'],
      },
    });

    const botUsername = params.botUsername ?? config.E2E_GITEA_BOT_USERNAME;
    await giteaFetch(`teams/${team.id}/members/${encodeSegment(botUsername)}`, {method: 'PUT'});

    const issueTeam = await giteaFetchJson<{id: number}>(`orgs/${encodeSegment(org)}/teams`, {
      method: 'POST',
      json: {
        name: ISSUE_WRITE_TEAM_NAME,
        permission: 'write',
        includes_all_repositories: true,
        units: ['repo.issues'],
      },
    });
    await giteaFetch(`teams/${issueTeam.id}/members/${encodeSegment(botUsername)}`, {
      method: 'PUT',
    });

    const hook = await giteaFetchJson<{id: number}>(`orgs/${encodeSegment(org)}/hooks`, {
      method: 'POST',
      json: {
        type: 'gitea',
        active: true,
        events: ['push'],
        config: {
          url: params.webhookTargetUrl ?? defaultWebhookTargetUrl(),
          content_type: 'json',
          secret: params.webhookSecret ?? config.E2E_GITEA_WEBHOOK_SECRET,
        },
      },
    });

    return {org, teamId: team.id, webhookId: hook.id};
  } catch (error) {
    await bestEffortDeleteOrg(org);
    throw error;
  }
}

export async function createRepo(params: CreateRepoParams): Promise<CreatedRepo> {
  const repo = await giteaFetchJson<{
    name: string;
    full_name: string;
    clone_url: string;
    default_branch: string;
  }>(`orgs/${encodeSegment(params.org)}/repos`, {
    method: 'POST',
    json: {
      name: params.name,
      private: params.private ?? true,
      auto_init: params.autoInit ?? true,
      default_branch: params.defaultBranch ?? 'main',
    },
  });

  return {
    name: repo.name,
    fullName: repo.full_name,
    cloneUrl: repo.clone_url,
    defaultBranch: repo.default_branch,
  };
}

export async function createIssue(params: CreateIssueParams): Promise<CreatedIssue> {
  const issue = await giteaFetchJson<{
    number: number;
    title: string;
    body?: string | null;
  }>(`repos/${encodeSegment(params.org)}/${encodeSegment(params.repo)}/issues`, {
    method: 'POST',
    json: {title: params.title, body: params.body ?? ''},
  });

  return {
    number: issue.number,
    title: issue.title,
    body: issue.body ?? '',
  };
}

export async function listIssueComments(params: {
  org: string;
  repo: string;
  index: number;
}): Promise<IssueComment[]> {
  const comments = await giteaFetchJson<Array<{id: number; body?: string | null}>>(
    `repos/${encodeSegment(params.org)}/${encodeSegment(params.repo)}/issues/${params.index}/comments`,
  );

  return comments.map((comment) => ({
    id: comment.id,
    body: comment.body ?? '',
  }));
}

// One commit for the whole batch through Gitea's change-files contents API,
// returning the resulting commit SHA (the push correlation key in the suite).
export async function commitFiles(params: CommitFilesParams): Promise<string> {
  const files = params.files.map((file) => ({
    operation: file.operation ?? 'create',
    path: file.path,
    content:
      file.content === undefined ? undefined : Buffer.from(file.content, 'utf8').toString('base64'),
    sha: file.sha,
  }));

  const response = await giteaFetchJson<{commit?: {sha?: string}}>(
    `repos/${encodeSegment(params.org)}/${encodeSegment(params.repo)}/contents`,
    {method: 'POST', json: {branch: params.branch ?? 'main', message: params.message, files}},
  );

  const sha = response.commit?.sha;
  if (!sha) {
    throw new GiteaInstanceError({
      message: 'Gitea change-files response did not include a commit SHA',
      status: 200,
      details: response,
    });
  }

  return sha;
}

export async function deleteRepo(params: {org: string; repo: string}): Promise<void> {
  await giteaFetch(`repos/${encodeSegment(params.org)}/${encodeSegment(params.repo)}`, {
    method: 'DELETE',
  });
}

// Deletes the org and every repo it owns. Gitea's DELETE /orgs/{org} rejects an
// org that still owns repositories, so the repos go first.
export async function deleteOrg(params: {org: string}): Promise<void> {
  for (const repo of await listOrgRepoNames(params.org)) {
    await deleteRepo({org: params.org, repo});
  }
  await giteaFetch(`orgs/${encodeSegment(params.org)}`, {method: 'DELETE'});
}

const ORG_REPOS_PAGE_SIZE = 50;

async function listOrgRepoNames(org: string): Promise<string[]> {
  const names: string[] = [];
  for (let page = 1; ; page++) {
    const repos = await giteaFetchJson<Array<{name: string}>>(
      `orgs/${encodeSegment(org)}/repos?page=${page}&limit=${ORG_REPOS_PAGE_SIZE}`,
    );
    for (const repo of repos) names.push(repo.name);
    if (repos.length < ORG_REPOS_PAGE_SIZE) break;
  }
  return names;
}

// Removes an org on a failure path, where surfacing the original error matters
// more than a cleanup that itself fails; used to keep half-built orgs out of the
// shared instance.
export async function bestEffortDeleteOrg(org: string): Promise<void> {
  try {
    await deleteOrg({org});
  } catch {
    // Swallowed on purpose: the caller is already rethrowing the root cause.
  }
}
