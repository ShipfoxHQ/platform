import {Button} from '@shipfox/react-ui/button';
import {Icon} from '@shipfox/react-ui/icon';
import {Input} from '@shipfox/react-ui/input';
import type {WorkflowRunListStatusFilter} from './types.js';

const STATUS_FILTERS: Array<{value: WorkflowRunListStatusFilter; label: string}> = [
  {value: 'all', label: 'All'},
  {value: 'failed', label: 'Failed'},
  {value: 'running', label: 'Running'},
];

interface WorkflowRunListHeaderProps {
  query: string;
  onQueryChange: (value: string) => void;
  statusFilter: WorkflowRunListStatusFilter;
  onStatusFilterChange: (value: WorkflowRunListStatusFilter) => void;
}

export function WorkflowRunListHeader({
  query,
  onQueryChange,
  statusFilter,
  onStatusFilterChange,
}: WorkflowRunListHeaderProps) {
  return (
    <div className="flex flex-col gap-8 border-b border-border-neutral-base px-12 py-12">
      <Input
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder="Run id, number, or trigger..."
        aria-label="Search runs"
        size="small"
        iconLeft={<Icon name="searchLine" className="size-14 text-foreground-neutral-muted" />}
      />

      <fieldset className="flex items-center gap-8">
        <legend className="sr-only">Run status filter</legend>
        {STATUS_FILTERS.map((filter) => (
          <Button
            key={filter.value}
            type="button"
            size="2xs"
            variant={statusFilter === filter.value ? 'primary' : 'transparent'}
            aria-pressed={statusFilter === filter.value}
            onClick={() => onStatusFilterChange(filter.value)}
          >
            {filter.label}
          </Button>
        ))}
      </fieldset>
    </div>
  );
}
