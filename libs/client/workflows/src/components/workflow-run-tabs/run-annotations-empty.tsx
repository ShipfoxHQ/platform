import {EmptyState} from '@shipfox/react-ui/empty-state';

export function RunAnnotationsEmpty() {
  return (
    <EmptyState
      icon="fileDamageLine"
      title="No annotations"
      description="This run has no annotations to show."
    />
  );
}
