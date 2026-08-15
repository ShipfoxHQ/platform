import type {Meta, StoryObj} from '@storybook/react';
import {StatusBadge} from '#components/badge/index.js';
import {Button} from '#components/button/index.js';
import {Code} from '#components/typography/index.js';
import {Panel} from '../panel/panel.js';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from './table.js';

const meta = {
  title: 'Components/Table',
  component: Table,
  tags: ['autodocs'],
} satisfies Meta<typeof Table>;

export default meta;

type Story = StoryObj<typeof meta>;

const workflows = [
  {
    name: 'Deploy production',
    path: '.shipfox/workflows/deploy.yml',
    status: 'Succeeded',
    statusVariant: 'success' as const,
    syncedAt: 'May 7, 2026 09:12',
  },
  {
    name: 'Nightly verification',
    path: '.shipfox/workflows/nightly.yml',
    status: 'Syncing',
    statusVariant: 'info' as const,
    syncedAt: 'In progress',
  },
  {
    name: 'Release candidate',
    path: '.shipfox/workflows/release.yml',
    status: 'Failed',
    statusVariant: 'error' as const,
    syncedAt: 'May 7, 2026 08:58',
  },
];

const selectedWorkflowPath = '.shipfox/workflows/nightly.yml';

export const Playground: Story = {
  render: () => (
    <Panel className="w-760">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Workflow</TableHead>
            <TableHead>Path</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Last sync</TableHead>
            <TableHead className="w-80 text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {workflows.map((workflow) => (
            <TableRow
              key={workflow.path}
              data-selected={workflow.path === selectedWorkflowPath ? 'true' : undefined}
              className={workflow.path === selectedWorkflowPath ? 'table-row-selected' : undefined}
            >
              <TableCell className="font-medium">{workflow.name}</TableCell>
              <TableCell>
                <Code>{workflow.path}</Code>
              </TableCell>
              <TableCell>
                <StatusBadge variant={workflow.statusVariant}>{workflow.status}</StatusBadge>
              </TableCell>
              <TableCell className="text-foreground-neutral-muted">{workflow.syncedAt}</TableCell>
              <TableCell className="text-right">
                <Button size="xs" variant="secondary">
                  Run
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Panel>
  ),
  parameters: {
    pseudo: {
      hover: '.table-row-selected',
    },
  },
};
