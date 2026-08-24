export type StorybookManifestEntry = {
  readonly id: string;
  readonly title: string;
  readonly package: string;
  readonly order: number;
  readonly source: string;
  readonly path: `/${string}/`;
  readonly url: `/${string}/index.html`;
};

export const storybookManifestVersion = 1;

export const storybooks = [
  {
    id: 'react-ui',
    title: 'React UI',
    package: '@shipfox/react-ui',
    order: 1,
    source: 'libs/shared/react/ui/storybook-static',
    path: '/react-ui/',
    url: '/react-ui/index.html',
  },
  {
    id: 'client-agent',
    title: 'Client Agent',
    package: '@shipfox/client-agent',
    order: 2,
    source: 'libs/client/agent/storybook-static',
    path: '/client-agent/',
    url: '/client-agent/index.html',
  },
  {
    id: 'client-auth',
    title: 'Client Auth',
    package: '@shipfox/client-auth',
    order: 3,
    source: 'libs/client/auth/storybook-static',
    path: '/client-auth/',
    url: '/client-auth/index.html',
  },
  {
    id: 'client-integrations',
    title: 'Client Integrations',
    package: '@shipfox/client-integrations',
    order: 4,
    source: 'libs/client/integrations/storybook-static',
    path: '/client-integrations/',
    url: '/client-integrations/index.html',
  },
  {
    id: 'client-logs',
    title: 'Client Logs',
    package: '@shipfox/client-logs',
    order: 5,
    source: 'libs/client/logs/storybook-static',
    path: '/client-logs/',
    url: '/client-logs/index.html',
  },
  {
    id: 'client-onboarding',
    title: 'Client Onboarding',
    package: '@shipfox/client-onboarding',
    order: 6,
    source: 'libs/client/onboarding/storybook-static',
    path: '/client-onboarding/',
    url: '/client-onboarding/index.html',
  },
  {
    id: 'client-projects',
    title: 'Client Projects',
    package: '@shipfox/client-projects',
    order: 7,
    source: 'libs/client/projects/storybook-static',
    path: '/client-projects/',
    url: '/client-projects/index.html',
  },
  {
    id: 'client-runners',
    title: 'Client Runners',
    package: '@shipfox/client-runners',
    order: 8,
    source: 'libs/client/runners/storybook-static',
    path: '/client-runners/',
    url: '/client-runners/index.html',
  },
  {
    id: 'client-secrets',
    title: 'Client Secrets',
    package: '@shipfox/client-secrets',
    order: 9,
    source: 'libs/client/secrets/storybook-static',
    path: '/client-secrets/',
    url: '/client-secrets/index.html',
  },
  {
    id: 'client-triggers',
    title: 'Client Triggers',
    package: '@shipfox/client-triggers',
    order: 10,
    source: 'libs/client/triggers/storybook-static',
    path: '/client-triggers/',
    url: '/client-triggers/index.html',
  },
  {
    id: 'client-workflows',
    title: 'Client Workflows',
    package: '@shipfox/client-workflows',
    order: 11,
    source: 'libs/client/workflows/storybook-static',
    path: '/client-workflows/',
    url: '/client-workflows/index.html',
  },
] as const satisfies readonly StorybookManifestEntry[];

export const storybookManifest = storybooks;

export type StorybookId = (typeof storybooks)[number]['id'];

export type StorybookRef = {
  title: string;
  url: string;
};

export const storybookRefs = Object.fromEntries(
  storybooks.map(({id, title, path}) => [id, {title, url: path}]),
) as Record<StorybookId, StorybookRef>;

export const storybookLinks = storybooks.map(({id, title, url}) => ({
  id,
  title,
  url,
}));

export const storybookTurboFilters = storybooks.map(({package: packageName}) => packageName);
