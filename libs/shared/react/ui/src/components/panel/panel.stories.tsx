import type {Meta, StoryObj} from '@storybook/react';
import {StatusBadge} from '#components/badge/index.js';
import {Button} from '#components/button/index.js';
import {Icon} from '#components/icon/index.js';
import {Code, Text} from '#components/typography/index.js';
import {
  Panel,
  PanelActions,
  PanelBody,
  PanelCell,
  PanelCellAction,
  PanelEmpty,
  PanelGrid,
  PanelHeader,
  PanelRow,
  PanelTitle,
} from './panel.js';

const headerVariants = ['strip', 'plain'] as const;

const workflows = [
  {
    name: 'Deploy production',
    path: '.shipfox/workflows/deploy.yml',
    status: 'Succeeded',
    statusVariant: 'success' as const,
  },
  {
    name: 'Nightly verification',
    path: '.shipfox/workflows/nightly.yml',
    status: 'Syncing',
    statusVariant: 'info' as const,
  },
  {
    name: 'Release candidate',
    path: '.shipfox/workflows/release.yml',
    status: 'Failed',
    statusVariant: 'error' as const,
  },
];

const gridProjects = [
  {name: 'Platform', path: 'platform'},
  {name: 'Agent runtime', path: 'agent-runtime'},
  {name: 'Workflows', path: 'workflows'},
  {name: 'Docs site', path: 'docs-site'},
  {name: 'Provisioner', path: 'provisioner'},
];

const meta = {
  title: 'Components/Panel',
  component: Panel,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof Panel>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: () => (
    <Panel className="w-640">
      <PanelHeader>
        <PanelTitle>Workflow runs</PanelTitle>
        <PanelActions>
          <Button size="sm">New run</Button>
        </PanelActions>
      </PanelHeader>
      <PanelBody>
        {workflows.map((workflow) => (
          <PanelRow key={workflow.path}>
            <div className="min-w-0">
              <Text size="sm" bold className="truncate">
                {workflow.name}
              </Text>
              <Code variant="label" className="truncate text-foreground-neutral-subtle">
                {workflow.path}
              </Code>
            </div>
            <StatusBadge variant={workflow.statusVariant}>{workflow.status}</StatusBadge>
          </PanelRow>
        ))}
      </PanelBody>
    </Panel>
  ),
};

export const Variants: Story = {
  render: () => (
    <div className="flex w-640 flex-col gap-24">
      {headerVariants.map((variant) => (
        <Panel key={variant}>
          <PanelHeader variant={variant}>
            <PanelTitle>{variant === 'strip' ? 'Strip header' : 'Plain header'}</PanelTitle>
          </PanelHeader>
          <PanelBody>
            <PanelRow>
              <Text size="sm">Rows keep the panel surface and use internal hairlines.</Text>
            </PanelRow>
          </PanelBody>
        </Panel>
      ))}
    </div>
  ),
};

export const Grid: Story = {
  render: () => (
    <Panel className="w-640">
      <PanelHeader>
        <PanelTitle>Projects</PanelTitle>
      </PanelHeader>
      <PanelBody>
        <PanelGrid aria-label="Projects">
          {gridProjects.map((project) => (
            <PanelCell key={project.path}>
              <PanelCellAction>
                <Icon name="folderLine" className="size-24 shrink-0" aria-hidden />
                <Text as="span" size="md" bold className="truncate">
                  {project.name}
                </Text>
              </PanelCellAction>
            </PanelCell>
          ))}
        </PanelGrid>
      </PanelBody>
    </Panel>
  ),
};

export const Compositions: Story = {
  render: () => (
    <div className="flex w-640 flex-col gap-24">
      <Panel>
        <PanelHeader variant="plain">
          <PanelTitle>Recent deployments</PanelTitle>
          <PanelActions>
            <Button size="sm" variant="secondary">
              View all
            </Button>
          </PanelActions>
        </PanelHeader>
        <PanelBody>
          <PanelEmpty>No deployments yet</PanelEmpty>
        </PanelBody>
      </Panel>
      <Panel>
        <PanelBody>
          <PanelEmpty compact>No filtered results</PanelEmpty>
        </PanelBody>
      </Panel>
    </div>
  ),
};
