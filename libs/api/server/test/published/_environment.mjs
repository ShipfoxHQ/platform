export function publishedTestEnvironment() {
  // Use the active workspace's isolated Postgres instead of a fixed CI port, which
  // could point at an unrelated local database when this contract runs in a worktree.
  const postgresHost = process.env.POSTGRES_HOST ?? '127.0.0.1';
  const postgresPort = process.env.POSTGRES_PORT ?? '5432';
  const postgresUsername = process.env.POSTGRES_USERNAME ?? 'shipfox';
  const postgresPassword = process.env.POSTGRES_PASSWORD ?? 'password';
  const postgresDatabase = 'api_test';

  return {
    API_PUBLIC_URL: 'https://api.example.test',
    AUTH_ROOT_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
    DATABASE_URL: `postgres://${postgresUsername}:${postgresPassword}@${postgresHost}:${postgresPort}/${postgresDatabase}`,
    GITEA_BASE_URL: 'https://gitea.example.com',
    GITEA_SERVICE_TOKEN: 'external-consumer-token',
    GITEA_SERVICE_USERNAME: 'shipfox-bot',
    GITEA_WEBHOOK_SECRET: 'external-consumer-webhook-secret',
    GITHUB_API_BASE_URL: 'https://api.github.com',
    GITHUB_APP_CLIENT_ID: 'external-consumer-client-id',
    GITHUB_APP_CLIENT_SECRET: 'external-consumer-client-secret',
    GITHUB_APP_ID: '1',
    GITHUB_APP_PRIVATE_KEY: 'external-consumer-private-key',
    GITHUB_APP_SLUG: 'shipfox-external-consumer',
    GITHUB_APP_USERNAME: 'shipfox-external-consumer',
    GITHUB_APP_WEBHOOK_SECRET: 'external-consumer-webhook-secret',
    GITHUB_INSTALL_STATE_SECRET: 'external-consumer-install-state-secret',
    JIRA_OAUTH_CLIENT_ID: 'external-consumer-client-id',
    JIRA_OAUTH_CLIENT_SECRET: 'external-consumer-client-secret',
    JIRA_OAUTH_REDIRECT_URL: 'https://shipfox.example.com/integrations/jira/callback',
    JIRA_WEBHOOK_BASE_URL: 'https://shipfox.example.com',
    LINEAR_MCP_ENDPOINT: 'https://mcp.linear.app/mcp',
    LINEAR_OAUTH_CLIENT_ID: 'external-consumer-client-id',
    LINEAR_OAUTH_CLIENT_SECRET: 'external-consumer-client-secret',
    LINEAR_OAUTH_REDIRECT_URL: 'https://shipfox.example.com/integrations/linear/callback',
    LINEAR_WEBHOOK_SIGNING_SECRET: 'external-consumer-webhook-secret',
    SLACK_API_BASE_URL: 'https://slack.example.com/api',
    SLACK_OAUTH_CLIENT_ID: 'external-consumer-client-id',
    SLACK_OAUTH_CLIENT_SECRET: 'external-consumer-client-secret',
    SLACK_OAUTH_REDIRECT_URL: 'https://shipfox.example.com/integrations/slack/callback',
    SLACK_SIGNING_SECRET: 'external-consumer-signing-secret',
    OBJECT_STORAGE_S3_ACCESS_KEY_ID: 'external-consumer-access-key',
    OBJECT_STORAGE_S3_BUCKET: 'shipfox',
    OBJECT_STORAGE_S3_ENDPOINT: 'http://127.0.0.1:3900',
    OBJECT_STORAGE_S3_FORCE_PATH_STYLE: 'true',
    OBJECT_STORAGE_S3_REGION: 'garage',
    OBJECT_STORAGE_S3_SECRET_ACCESS_KEY: 'external-consumer-secret-key',
    AGENT_SESSION_ENCRYPTION_KEK: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
    POSTGRES_DATABASE: postgresDatabase,
    POSTGRES_HOST: postgresHost,
    POSTGRES_MAX_CONNECTIONS: '5',
    POSTGRES_PASSWORD: postgresPassword,
    POSTGRES_PORT: postgresPort,
    POSTGRES_USERNAME: postgresUsername,
    SECRETS_ENCRYPTION_KEK: 'ZmVkY2JhOTg3NjU0MzIxMGZlZGNiYTk4NzY1NDMyMTA=',
    SENTRY_APP_CLIENT_ID: 'external-consumer-client-id',
    SENTRY_APP_CLIENT_SECRET: 'external-consumer-client-secret',
    SENTRY_APP_SLUG: 'shipfox-external-consumer',
    SENTRY_APP_VERIFY_INSTALL: 'true',
    TEMPORAL_ADDRESS: '127.0.0.1:7233',
    WORKSPACE_JWT_SECRET: 'external-consumer-workspace-secret',
  };
}
