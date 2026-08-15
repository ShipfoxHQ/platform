import type {Meta, StoryObj} from '@storybook/react';
import {StatusBadge} from '#components/badge/index.js';
import {Button} from '#components/button/index.js';
import {EmptyState} from '#components/empty-state/index.js';
import {Icon} from '#components/icon/index.js';
import {LoadErrorState} from '#components/load-error-state/index.js';
import {Skeleton} from '#components/skeleton/index.js';
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
      <Panel>
        <PanelBody>
          <PanelRow>
            <Text size="sm">This panel has no header and starts directly with its body.</Text>
          </PanelRow>
        </PanelBody>
      </Panel>
    </div>
  ),
};

export const RowStates: Story = {
  render: () => (
    <Panel className="w-640">
      <PanelHeader>
        <PanelTitle>Workflow runs</PanelTitle>
      </PanelHeader>
      <PanelBody>
        <PanelRow className="panel-row-hover">
          <div className="flex min-w-0 items-center gap-inline">
            <input type="checkbox" readOnly aria-label="Select hovered row" />
            <div className="min-w-0">
              <Text size="sm" bold>
                Hovered row
              </Text>
              <Text size="xs" className="text-foreground-neutral-base">
                The row hover surface stays one step from the panel.
              </Text>
            </div>
          </div>
          <StatusBadge variant="info">Running</StatusBadge>
        </PanelRow>
        <PanelRow
          data-selected="true"
          className="data-[selected=true]:bg-background-neutral-pressed data-[selected=true]:hover:bg-background-neutral-pressed"
        >
          <div className="flex min-w-0 items-center gap-inline">
            <input type="checkbox" checked readOnly aria-label="Select selected row" />
            <div className="min-w-0">
              <Text size="sm" bold>
                Selected row
              </Text>
              <Text size="xs" className="text-foreground-neutral-base">
                Selection uses the pressed neutral surface.
              </Text>
            </div>
          </div>
          <StatusBadge variant="success">Succeeded</StatusBadge>
        </PanelRow>
        <PanelRow>
          <div className="flex min-w-0 items-center gap-inline">
            <input type="checkbox" readOnly aria-label="Select default row" />
            <Text size="sm">Default row</Text>
          </div>
        </PanelRow>
      </PanelBody>
    </Panel>
  ),
  parameters: {
    pseudo: {
      hover: '.panel-row-hover',
    },
  },
};

export const States: Story = {
  render: () => (
    <div className="flex w-640 flex-col gap-24">
      <Panel>
        <PanelHeader>
          <PanelTitle>Empty body</PanelTitle>
        </PanelHeader>
        <PanelBody>
          <EmptyState
            variant="panel"
            icon="inboxLine"
            title="No workflow runs yet"
            description="Runs from this project will appear here once one is launched."
          />
        </PanelBody>
      </Panel>
      <Panel>
        <PanelHeader>
          <PanelTitle>Error body</PanelTitle>
        </PanelHeader>
        <PanelBody>
          <LoadErrorState
            variant="panel"
            title="Couldn't load workflow runs"
            description="Something went wrong. Check your connection and try again."
            onRetry={() => undefined}
            retryLabel="Retry loading workflow runs"
          />
        </PanelBody>
      </Panel>
      <Panel>
        <PanelHeader>
          <PanelTitle>Compact empty body</PanelTitle>
        </PanelHeader>
        <PanelBody>
          <PanelEmpty compact>
            <Text size="sm" className="text-foreground-neutral-subtle">
              No filtered results
            </Text>
          </PanelEmpty>
        </PanelBody>
      </Panel>
      <Panel>
        <PanelHeader>
          <PanelTitle>Loading body</PanelTitle>
        </PanelHeader>
        <PanelBody aria-busy="true">
          <span className="sr-only" role="status" aria-live="polite">
            Loading workflow runs
          </span>
          <PanelRow className="justify-start gap-group">
            <div className="flex min-w-0 flex-1 flex-col gap-8">
              <Skeleton className="h-16 w-240" />
              <Skeleton className="h-12 w-160" />
            </div>
            <Skeleton className="h-20 w-80 shrink-0" />
          </PanelRow>
          <PanelRow className="justify-start gap-group">
            <div className="flex min-w-0 flex-1 flex-col gap-8">
              <Skeleton className="h-16 w-200" />
              <Skeleton className="h-12 w-120" />
            </div>
            <Skeleton className="h-20 w-80 shrink-0" />
          </PanelRow>
          <PanelRow className="justify-start gap-group">
            <div className="flex min-w-0 flex-1 flex-col gap-8">
              <Skeleton className="h-16 w-280" />
              <Skeleton className="h-12 w-144" />
            </div>
            <Skeleton className="h-20 w-80 shrink-0" />
          </PanelRow>
        </PanelBody>
      </Panel>
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
