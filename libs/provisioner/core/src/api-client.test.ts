import {
  RECONCILE_RUNNER_INSTANCES_INTENDED_RESERVATION_HEADER,
  RECONCILE_RUNNER_INSTANCES_INTENDED_RESERVATION_HEADER_VALUE,
} from '@shipfox/api-runners-dto';
import {createProvisionerClient, ProvisionerAuthenticationError} from '#api-client.js';

const BASE_URL = 'https://api.test';
const TOKEN = 'sfpt_test-token';
const RUNNER_INSTANCE_ID = '00000000-0000-4000-8000-000000000001';
const RESERVATION_ID = '00000000-0000-4000-8000-000000000002';

let originalFetch: typeof globalThis.fetch;
let calls: Array<{url: string; method: string; body: string; headers: Headers}>;

beforeAll(() => {
  originalFetch = globalThis.fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

beforeEach(() => {
  calls = [];
});

describe('createProvisionerClient', () => {
  it('creates instances before launch with bootstrap tokens', async () => {
    stubFetch(() =>
      jsonResponse({
        runner_instances: [
          {runner_instance_id: RUNNER_INSTANCE_ID, bootstrap_token: 'sf_rbt_test'},
        ],
      }),
    );

    const result = await client().createRunnerInstances({
      runner_instances: [{template_key: 'linux'}],
    });

    expect(result.runner_instances[0]?.bootstrap_token).toBe('sf_rbt_test');
    expect(calls[0]).toMatchObject({method: 'POST'});
    expect(calls[0]?.url).toContain('provisioners/runner-instances/batch');
  });

  it('attaches a provider identity and assigns enrolled instances through explicit routes', async () => {
    stubFetch((url) =>
      jsonResponse(
        url.includes('/assignments')
          ? {runner_instance_ids: [RUNNER_INSTANCE_ID]}
          : {attached: true},
      ),
    );

    const attached = await client().attachRunnerInstanceProviderId(
      RUNNER_INSTANCE_ID,
      'container-1',
    );
    const assigned = await client().assignRunnerInstances(RESERVATION_ID, [RUNNER_INSTANCE_ID]);

    expect(attached).toEqual({attached: true});
    expect(assigned).toEqual({runner_instance_ids: [RUNNER_INSTANCE_ID]});
    expect(calls.map((call) => call.url)).toEqual([
      expect.stringContaining(`/runner-instances/${RUNNER_INSTANCE_ID}/provider-runner`),
      expect.stringContaining('/runner-instances/assignments'),
    ]);
    expect(JSON.parse(calls[1]?.body ?? '{}')).toEqual({
      reservation_id: RESERVATION_ID,
      runner_instance_ids: [RUNNER_INSTANCE_ID],
    });
  });

  it('maps rejected provisioner credentials consistently', async () => {
    stubFetch(() => new Response(null, {status: 401}));

    await expect(client().createRunnerInstances({runner_instances: [{}]})).rejects.toThrow(
      ProvisionerAuthenticationError,
    );
  });

  it('requests the intended reservation field during reconciliation', async () => {
    stubFetch(() =>
      jsonResponse({
        runners: [],
        terminated_absent_provider_runner_ids: [],
      }),
    );

    await client().reconcileRunnerInstances({observed_provider_runner_ids: []});

    expect(calls[0]?.headers.get(RECONCILE_RUNNER_INSTANCES_INTENDED_RESERVATION_HEADER)).toBe(
      RECONCILE_RUNNER_INSTANCES_INTENDED_RESERVATION_HEADER_VALUE,
    );
  });
});

function client() {
  return createProvisionerClient({baseUrl: BASE_URL, token: TOKEN});
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {headers: {'content-type': 'application/json'}});
}

function stubFetch(handler: (url: string) => Response): void {
  globalThis.fetch = vi.fn(async (input: Request | string | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    calls.push({
      url: request.url,
      method: request.method,
      body: await request.clone().text(),
      headers: request.headers,
    });
    return handler(request.url);
  }) as unknown as typeof globalThis.fetch;
}
