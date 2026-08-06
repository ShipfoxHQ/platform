import './env.js';
import {closeDb as closeGiteaDb} from '@shipfox/api-integration-gitea';
import {closeDb as closeGithubDb} from '@shipfox/api-integration-github';
import {closeDb as closeJiraDb} from '@shipfox/api-integration-jira';
import {closeDb as closeLinearDb} from '@shipfox/api-integration-linear';
import {closeDb as closeSentryDb} from '@shipfox/api-integration-sentry';
import {closeDb as closeSlackDb} from '@shipfox/api-integration-slack';
import {closePostgresClient, createPostgresClient} from '@shipfox/node-postgres';
import {afterAll, afterEach, beforeAll, vi} from '@shipfox/vitest/vi';
import {closeDb} from '#db/db.js';

beforeAll(() => {
  createPostgresClient();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  closeDb();
  closeGithubDb();
  // isolate:false shares provider module state across files, so every memoized
  // Drizzle handle must be cleared before the shared pool is ended.
  closeLinearDb();
  closeSlackDb();
  closeJiraDb();
  closeSentryDb();
  closeGiteaDb();
  await closePostgresClient();
});
