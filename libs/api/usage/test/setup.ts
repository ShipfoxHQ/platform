import './env.js';
import {closePostgresClient, createPostgresClient} from '@shipfox/node-postgres';
import {afterAll, afterEach, beforeAll, vi} from '@shipfox/vitest/vi';
import {closeDb} from '#db/index.js';

beforeAll(() => {
  createPostgresClient();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  closeDb();
  await closePostgresClient();
});
