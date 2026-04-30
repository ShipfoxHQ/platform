import './env.js';
import {closeDb as closeGithubDb} from '@shipfox/api-integration-github';
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
  await closePostgresClient();
});
