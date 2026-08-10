import {configureApiClient} from '@shipfox/client-api';
import {type AuthState, authStateAtom} from '@shipfox/client-auth';
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
import {createStore, Provider as JotaiProvider} from 'jotai';
import {useMemo} from 'react';
import {expect, screen, userEvent, within} from 'storybook/test';
import {ProjectSettingsPage} from './project-settings-page.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '99999999-9999-4999-8999-999999999999';
const OTHER_PROJECT_ID = '88888888-8888-4888-8888-888888888888';

type Scenario = 'default' | 'long-values' | 'taken-slug';

interface ProjectStoryResponse {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  source: {
    connection_id: string;
    external_repository_id: string;
  };
  created_at: string;
  updated_at: string;
}

interface ProjectSettingsPageStoryProps {
  scenario: Scenario;
}

const authState: AuthState = {
  status: 'authenticated',
  token: 'token',
  user: {
    id: '22222222-2222-4222-8222-222222222222',
    email: 'platform@example.com',
    name: 'Platform Engineer',
    emailVerifiedAt: '2026-01-01T00:00:00.000Z',
  },
  workspaces: [{id: WORKSPACE_ID, name: 'Acme', slug: 'acme', membershipId: 'membership-1'}],
};

function ProjectSettingsPageStory({scenario}: ProjectSettingsPageStoryProps) {
  configureApiClient({
    baseUrl: 'https://api.example.test',
    fetchImpl: fetchForScenario(scenario),
  });

  const queryClient = useMemo(
    () => new QueryClient({defaultOptions: {queries: {retry: false}}}),
    [],
  );
  const store = useMemo(() => {
    const nextStore = createStore();
    nextStore.set(authStateAtom, authState);
    return nextStore;
  }, []);
  const router = useMemo(() => createStoryRouter(scenario), [scenario]);

  return (
    <QueryClientProvider client={queryClient}>
      <JotaiProvider store={store}>
        <div className="min-h-screen bg-background-subtle-base px-24 py-32">
          <div className="mx-auto w-full max-w-[1120px]">
            <RouterProvider router={router} />
          </div>
        </div>
        <Toaster />
      </JotaiProvider>
    </QueryClientProvider>
  );
}

const meta = {
  title: 'Projects/ProjectSettingsPage',
  component: ProjectSettingsPageStory,
  parameters: {layout: 'fullscreen'},
  args: {scenario: 'default'},
} satisfies Meta<typeof ProjectSettingsPageStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const LongValues: Story = {
  args: {scenario: 'long-values'},
};

export const TakenSlug: Story = {
  args: {scenario: 'taken-slug'},
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    const slugInput = await canvas.findByLabelText('Project slug');
    await userEvent.clear(slugInput);
    await userEvent.type(slugInput, 'taken-platform');

    expect(await canvas.findByText('This slug is already taken.')).toBeInTheDocument();
  },
};

export const SlugChangeWarning: Story = {
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    const slugInput = await canvas.findByLabelText('Project slug');
    await userEvent.clear(slugInput);
    await userEvent.type(slugInput, 'renamed-platform');
    await canvas.findByText('Slug is available.');
    await userEvent.click(canvas.getByRole('button', {name: 'Save changes'}));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Change project slug?');
    expect(dialog).toHaveTextContent('Links and bookmarks pointing at the old URL stop working.');
    expect(dialog).toHaveTextContent(
      'Workflows that reference this project slug may stop working.',
    );
  },
};

function createStoryRouter(scenario: Scenario) {
  const project = projectForScenario(scenario);
  const rootRoute = createRootRoute({component: Outlet});
  const projectSettingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug/p/$projectSlug/settings/general',
    component: ProjectSettingsPage,
  });

  return createRouter({
    history: createMemoryHistory({
      initialEntries: [`/w/acme/p/${project.slug}/settings/general`],
    }),
    routeTree: rootRoute.addChildren([projectSettingsRoute]),
  });
}

function fetchForScenario(scenario: Scenario): typeof fetch {
  return async (input, init) => {
    const url = requestUrl(input);
    const method = input instanceof Request ? input.method : (init?.method ?? 'GET');

    if (url.pathname === '/projects' && method === 'GET') {
      const search = url.searchParams.get('search');
      if (scenario === 'taken-slug' && search === 'taken-platform') {
        return jsonResponse({
          projects: [projectForScenario(scenario, {id: OTHER_PROJECT_ID, slug: 'taken-platform'})],
          next_cursor: null,
        });
      }
      return jsonResponse({projects: [projectForScenario(scenario)], next_cursor: null});
    }

    if (url.pathname === `/projects/${PROJECT_ID}` && method === 'PATCH') {
      const body = (await (input as Request).clone().json()) as {
        name?: string;
        slug?: string;
      };
      const project = projectForScenario(scenario);
      return jsonResponse({
        ...project,
        name: body.name ?? project.name,
        slug: body.slug ?? project.slug,
      });
    }

    return jsonResponse({}, {status: 404});
  };
}

function projectForScenario(
  scenario: Scenario,
  overrides: Partial<ProjectStoryResponse> = {},
): ProjectStoryResponse {
  const project = {
    id: PROJECT_ID,
    workspace_id: WORKSPACE_ID,
    name:
      scenario === 'long-values'
        ? 'Infrastructure Control Plane and Workflow Automation'
        : 'Platform',
    slug: scenario === 'long-values' ? 'infrastructure-control-plane' : 'platform',
    source: {
      connection_id: '33333333-3333-4333-8333-333333333333',
      external_repository_id: 'platform',
    },
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
  return project;
}

function requestUrl(input: RequestInfo | URL): URL {
  if (input instanceof Request) return new URL(input.url);
  if (input instanceof URL) return input;
  return new URL(input, 'https://api.example.test');
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
    ...init,
  });
}
