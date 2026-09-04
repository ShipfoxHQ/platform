import {EmptyState} from '@shipfox/react-ui/empty-state';
import {cn} from '@shipfox/react-ui/utils';
import {useMemo} from 'react';
import {buildJobGraphModel} from './graph-model.js';
import {JobGraphView} from './job-graph-view.js';
import type {JobGraphProps} from './types.js';

export function JobGraph({
  run,
  selectedJobId,
  defaultSelectedJobId,
  onSelectedJobChange,
  className,
}: JobGraphProps) {
  const model = useMemo(() => buildJobGraphModel({run}), [run]);

  if (run.jobs.kind === 'large') {
    return (
      <EmptyState
        className={cn('min-h-160', className)}
        icon="nodeTree"
        title="Workflow graph unavailable"
        description="This workflow is too large to render as a complete graph. Use the Jobs list to inspect every job."
      />
    );
  }

  return (
    <JobGraphView
      model={model}
      trigger={run}
      selectedJobId={selectedJobId}
      defaultSelectedJobId={defaultSelectedJobId}
      onSelectedJobChange={onSelectedJobChange}
      className={className}
    />
  );
}
