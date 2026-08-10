import type {WebhookConnectionDto} from '@shipfox/api-integration-webhook-dto';
import {WEBHOOK_RECEIVED_EVENT} from '@shipfox/api-integration-webhook-dto';
import {configureApiClient} from '@shipfox/client-api';
import {Toaster} from '@shipfox/react-ui/toast';
import type {Meta, StoryObj} from '@storybook/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import {useMemo} from 'react';
import type {IntegrationConnection} from '#core/models.js';
import {IntegrationDeleteConfirmModal} from '../integration-delete-confirm-modal.js';
import {IntegrationUsageModal} from '../integration-usage-modal.js';
import {CopyableValue} from './copyable-value.js';
import {WebhookCreateModal} from './webhook-create-modal.js';
import {WebhookPublicEndpointAlert} from './webhook-public-endpoint-alert.js';
import {WebhookUsageDetails} from './webhook-usage-details.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const CONNECTION_ID = '77777777-7777-4777-8777-777777777777';

type Scenario =
  | 'create-form'
  | 'create-success'
  | 'usage-active'
  | 'usage-disabled'
  | 'delete-confirm'
  | 'copyable-value';

interface WebhookModalStoryProps {
  scenario: Scenario;
}

const activeConnection: WebhookConnectionDto = {
  id: CONNECTION_ID,
  workspace_id: WORKSPACE_ID,
  name: 'Stripe production',
  slug: 'stripe-prod',
  lifecycle_status: 'active',
  inbound_url: 'https://api.example.test/webhook/77777777-7777-4777-8777-777777777777',
  created_at: '2026-04-12T00:00:00.000Z',
  updated_at: '2026-04-12T00:00:00.000Z',
};

const disabledConnection: WebhookConnectionDto = {
  ...activeConnection,
  lifecycle_status: 'disabled',
};

const activeIntegrationConnection: IntegrationConnection = {
  id: CONNECTION_ID,
  workspaceId: WORKSPACE_ID,
  provider: 'webhook',
  externalAccountId: activeConnection.slug,
  slug: activeConnection.slug,
  displayName: activeConnection.name,
  lifecycleStatus: activeConnection.lifecycle_status,
  capabilities: [],
  createdAt: activeConnection.created_at,
  updatedAt: activeConnection.updated_at,
};

const disabledIntegrationConnection: IntegrationConnection = {
  ...activeIntegrationConnection,
  lifecycleStatus: 'disabled',
};

function WebhookModalStory({scenario}: WebhookModalStoryProps) {
  const connection = scenario === 'usage-disabled' ? disabledConnection : activeConnection;

  configureApiClient({
    baseUrl: 'https://api.example.test',
    fetchImpl: fetchForConnection(connection),
  });

  const queryClient = useMemo(
    () => new QueryClient({defaultOptions: {queries: {retry: false}}}),
    [],
  );
  const router = useMemo(() => createStoryRouter(scenario), [scenario]);

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>
  );
}

const meta = {
  title: 'Integrations/WebhookModals',
  component: WebhookModalStory,
  parameters: {layout: 'fullscreen'},
  args: {scenario: 'create-form'},
} satisfies Meta<typeof WebhookModalStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const CreateSuccess: Story = {
  args: {scenario: 'create-success'},
};

export const UsageActive: Story = {
  args: {scenario: 'usage-active'},
};

export const UsageDisabled: Story = {
  args: {scenario: 'usage-disabled'},
};

export const DeleteConfirm: Story = {
  args: {scenario: 'delete-confirm'},
};

export const CopyableValueState: Story = {
  args: {scenario: 'copyable-value'},
};

function StorySurface({scenario}: {scenario: Scenario}) {
  return (
    <div className="min-h-screen bg-background-subtle-base p-24">
      {scenario === 'create-form' ? (
        <WebhookCreateModal
          workspaceId={WORKSPACE_ID}
          open
          onOpenChange={() => undefined}
          onCreated={() => undefined}
        />
      ) : null}
      {scenario === 'create-success' ||
      scenario === 'usage-active' ||
      scenario === 'usage-disabled' ? (
        <IntegrationUsageModal
          connection={
            scenario === 'usage-disabled'
              ? disabledIntegrationConnection
              : activeIntegrationConnection
          }
          events={[{value: WEBHOOK_RECEIVED_EVENT, label: WEBHOOK_RECEIVED_EVENT}]}
          open
          onOpenChange={() => undefined}
        >
          <WebhookUsageDetails workspaceId={WORKSPACE_ID} connectionId={CONNECTION_ID} />
        </IntegrationUsageModal>
      ) : null}
      {scenario === 'delete-confirm' ? (
        <IntegrationDeleteConfirmModal
          connectionName={activeConnection.name}
          open
          isPending={false}
          onOpenChange={() => undefined}
          onConfirm={() => undefined}
        />
      ) : null}
      {scenario === 'copyable-value' ? (
        <div className="mx-auto max-w-[560px] rounded-8 border border-border-neutral-base bg-background-neutral-base p-24">
          <div className="flex flex-col gap-12">
            <CopyableValue label="inbound URL" value={activeConnection.inbound_url} />
            <WebhookPublicEndpointAlert />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function createStoryRouter(scenario: Scenario) {
  const rootRoute = createRootRoute({component: Outlet});
  const workspaceRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug',
    component: Outlet,
  });
  const integrationsRoute = createRoute({
    getParentRoute: () => workspaceRoute,
    path: 'settings/integrations',
    component: () => <StorySurface scenario={scenario} />,
  });
  const eventsRoute = createRoute({
    getParentRoute: () => workspaceRoute,
    path: 'settings/events',
    component: () => <div />,
  });

  return createRouter({
    history: createMemoryHistory({
      initialEntries: ['/w/acme/settings/integrations'],
    }),
    routeTree: rootRoute.addChildren([
      workspaceRoute.addChildren([integrationsRoute, eventsRoute]),
    ]),
  });
}

function fetchForConnection(connection: WebhookConnectionDto): typeof fetch {
  return (input) => {
    const url = requestUrl(input);
    if (url.pathname === '/integrations/webhook/connections') {
      return Promise.resolve(jsonResponse({connections: [connection]}));
    }
    return Promise.resolve(jsonResponse({}, {status: 404}));
  };
}

function requestUrl(input: RequestInfo | URL): URL {
  if (typeof input === 'string') return new URL(input);
  if (input instanceof URL) return input;
  return new URL(input.url);
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
    ...init,
  });
}
