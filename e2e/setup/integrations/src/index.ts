import type {
  CreateE2eTestVcsConnectionBodyDto,
  IntegrationConnectionDto,
  RepositoryDto,
  TestVcsRenewalModeDto,
  TestVcsStatsDto,
} from '@shipfox/api-integration-core-dto';
import type {
  CreateE2eGithubConnectionBodyDto,
  CreateE2eGithubConnectionResponseDto,
} from '@shipfox/api-integration-github-dto';
import type {
  CreateE2eLinearConnectionBodyDto,
  CreateE2eLinearConnectionResponseDto,
} from '@shipfox/api-integration-linear-dto';
import type {
  CreateE2eSlackConnectionBodyDto,
  CreateE2eSlackConnectionResponseDto,
} from '@shipfox/api-integration-slack-dto';
import {request, requestJson} from '@shipfox/e2e-core';

export type {
  CreateE2eTestVcsConnectionBodyDto,
  IntegrationConnectionDto,
  RepositoryDto,
  TestVcsRenewalModeDto,
  TestVcsStatsDto,
} from '@shipfox/api-integration-core-dto';
export type {
  CreateE2eGithubConnectionBodyDto,
  CreateE2eGithubConnectionResponseDto,
} from '@shipfox/api-integration-github-dto';
export type {
  CreateE2eLinearConnectionBodyDto,
  CreateE2eLinearConnectionResponseDto,
} from '@shipfox/api-integration-linear-dto';
export type {
  CreateE2eSlackConnectionBodyDto,
  CreateE2eSlackConnectionResponseDto,
} from '@shipfox/api-integration-slack-dto';

export type TestVcsRenewalMode = TestVcsRenewalModeDto;

export interface TestVcsFile {
  path: string;
  content: string;
}

export type TestVcsStats = TestVcsStatsDto;

export interface CreateTestVcsConnectionParams {
  workspaceId: string;
  accountId: string;
  displayName?: string | undefined;
  renewalMode?: TestVcsRenewalMode | undefined;
  refreshAfterSeconds?: number | undefined;
}

export interface CreateTestVcsRepositoryParams {
  connectionId: string;
  name: string;
  defaultBranch?: string | undefined;
  files: TestVcsFile[];
}

export interface CreateGithubConnectionParams {
  workspaceId: string;
  installationId: number;
  accountLogin: string;
  displayName: string;
  installerUserId: string;
  lifecycleStatus?: 'active' | 'disabled' | undefined;
}

function githubConnectionBody(
  params: CreateGithubConnectionParams,
): CreateE2eGithubConnectionBodyDto {
  return {
    workspace_id: params.workspaceId,
    installation_id: params.installationId,
    account_login: params.accountLogin,
    display_name: params.displayName,
    installer_user_id: params.installerUserId,
    ...(params.lifecycleStatus === undefined ? {} : {lifecycle_status: params.lifecycleStatus}),
  };
}

export async function createGithubConnection(
  params: CreateGithubConnectionParams,
): Promise<CreateE2eGithubConnectionResponseDto> {
  return await requestJson<CreateE2eGithubConnectionResponseDto>(
    'post',
    '/__e2e/integrations/github-connections',
    {json: githubConnectionBody(params)},
  );
}

export interface CreateLinearConnectionParams {
  workspaceId: string;
  organizationId: string;
  organizationUrlKey: string;
  appUserId: string;
  displayName: string;
  accessToken: string;
  scopes?: string[] | undefined;
}

function linearConnectionBody(
  params: CreateLinearConnectionParams,
): CreateE2eLinearConnectionBodyDto {
  return {
    workspace_id: params.workspaceId,
    organization_id: params.organizationId,
    organization_url_key: params.organizationUrlKey,
    app_user_id: params.appUserId,
    display_name: params.displayName,
    access_token: params.accessToken,
    scopes: params.scopes ?? ['read', 'write'],
  };
}

export async function createLinearConnection(
  params: CreateLinearConnectionParams,
): Promise<CreateE2eLinearConnectionResponseDto> {
  return await requestJson<CreateE2eLinearConnectionResponseDto>(
    'post',
    '/__e2e/integrations/linear-connections',
    {json: linearConnectionBody(params)},
  );
}

export interface CreateSlackConnectionParams {
  workspaceId: string;
  teamId: string;
  teamName: string;
  appId: string;
  botUserId: string;
  botToken: string;
  scopes?: string[] | undefined;
}

function slackConnectionBody(params: CreateSlackConnectionParams): CreateE2eSlackConnectionBodyDto {
  return {
    workspace_id: params.workspaceId,
    team_id: params.teamId,
    team_name: params.teamName,
    app_id: params.appId,
    bot_user_id: params.botUserId,
    bot_token: params.botToken,
    scopes: params.scopes ?? ['app_mentions:read', 'chat:write'],
  };
}

export async function createSlackConnection(
  params: CreateSlackConnectionParams,
): Promise<CreateE2eSlackConnectionResponseDto> {
  return await requestJson<CreateE2eSlackConnectionResponseDto>(
    'post',
    '/__e2e/integrations/slack-connections',
    {json: slackConnectionBody(params)},
  );
}

export async function createTestVcsConnection(
  params: CreateTestVcsConnectionParams,
): Promise<IntegrationConnectionDto> {
  const body: CreateE2eTestVcsConnectionBodyDto = {
    workspace_id: params.workspaceId,
    account_id: params.accountId,
    renewal_mode: params.renewalMode ?? 'on-rejection',
    ...(params.displayName === undefined ? {} : {display_name: params.displayName}),
    ...(params.refreshAfterSeconds === undefined
      ? {}
      : {refresh_after_seconds: params.refreshAfterSeconds}),
  };
  return await requestJson<IntegrationConnectionDto>(
    'post',
    '/__e2e/integrations/test-vcs/connections',
    {json: body},
  );
}

export async function createTestVcsRepository(
  params: CreateTestVcsRepositoryParams,
): Promise<RepositoryDto> {
  return await requestJson<RepositoryDto>('post', '/__e2e/integrations/test-vcs/repositories', {
    json: {
      connection_id: params.connectionId,
      name: params.name,
      ...(params.defaultBranch === undefined ? {} : {default_branch: params.defaultBranch}),
      files: params.files,
    },
  });
}

export async function getTestVcsStats(
  params: {connectionId?: string | undefined} = {},
): Promise<TestVcsStats> {
  const query = params.connectionId
    ? `?connection_id=${encodeURIComponent(params.connectionId)}`
    : '';
  return await requestJson<TestVcsStats>('get', `/__e2e/integrations/test-vcs/stats${query}`, {});
}

export async function failNextTestVcsMints(count: number): Promise<void> {
  await request('post', '/__e2e/integrations/test-vcs/fail-next-mints', {
    json: {count},
  });
}

export function testVcsExternalRepositoryId(owner: string, name: string): string {
  return `test-vcs:${owner}/${name}`;
}
