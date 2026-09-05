import {createApiClient} from '@shipfox/e2e-core';
import {test as base} from '@shipfox/e2e-core/playwright';
import {
  type CreateTestVcsConnectionParams,
  createTestVcsConnection,
  type IntegrationConnectionDto,
} from '@shipfox/e2e-setup-integrations';
import {markSuiteFailed, readSuiteContext, type SuiteContext} from '#suite-context.js';

export interface SuiteFixtures {
  suite: SuiteContext;
  createIsolatedTestVcsConnection: (
    params: Omit<CreateTestVcsConnectionParams, 'workspaceId'>,
  ) => Promise<IntegrationConnectionDto>;
  failureTracker: undefined;
}

type FixtureUse<T> = (value: T) => Promise<void>;
type FixtureRequest = {request: unknown};
type FixtureTestInfo = {status?: string; expectedStatus?: string};

export const test = base.extend<SuiteFixtures>({
  suite: async ({request: _request}: FixtureRequest, use: FixtureUse<SuiteContext>) => {
    await use(readSuiteContext());
  },
  createIsolatedTestVcsConnection: async (
    {suite}: Pick<SuiteFixtures, 'suite'>,
    use: FixtureUse<SuiteFixtures['createIsolatedTestVcsConnection']>,
  ) => {
    const connectionIds: string[] = [];
    try {
      await use(async (params) => {
        const connection = await createTestVcsConnection({
          workspaceId: suite.workspaceId,
          ...params,
        });
        connectionIds.push(connection.id);
        return connection;
      });
    } finally {
      const client = createApiClient({token: suite.sessionToken});
      for (const connectionId of connectionIds.reverse()) {
        await client
          .request('delete', `/integration-connections/${connectionId}`)
          .catch((error: unknown) => {
            process.stderr.write(
              `renewable-credentials-e2e: deleting Test VCS connection ${connectionId} failed: ${String(error)}\n`,
            );
          });
      }
    }
  },
  // Auto fixture: a worker touches the shared failure sentinel when its test does not
  // reach the expected status, so global teardown keeps the run's gitea org for
  // inspection instead of deleting it.
  failureTracker: [
    async (
      {request: _request}: FixtureRequest,
      use: FixtureUse<undefined>,
      testInfo: FixtureTestInfo,
    ) => {
      await use(undefined);
      if (testInfo.status !== testInfo.expectedStatus) markSuiteFailed();
    },
    {auto: true},
  ],
});

export {expect} from '@shipfox/e2e-core/playwright';
