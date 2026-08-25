import {EmptyState} from '@shipfox/react-ui/empty-state';

export function RunAnnotationsEmpty({jobName}: {jobName?: string | undefined} = {}) {
  return (
    <EmptyState
      variant="panel"
      icon="fileDamageLine"
      title="No annotations"
      description={
        jobName
          ? `${jobName} has no annotations to show in this run.`
          : 'This run has no annotations to show.'
      }
    />
  );
}
