import type {BadgeVariant} from '@shipfox/react-ui/badge';
import type {DotVariant} from '@shipfox/react-ui/dot';
import type {WorkflowDisplayStatus} from '#core/workflow-run.js';

export type {WorkflowDisplayStatus};

export interface WorkflowStatusVisual {
  kind: WorkflowDisplayStatus;
  label: string;
  dot: DotVariant;
  badge: BadgeVariant;
}

// The status -> visual mapping shared by the run-header pill (color + label) and
// WorkflowStatusIcon (which renders the glyph per kind). The exhaustive switch turns any new
// status the API grows into (DESIGN.md section 9) into a compile error.
export function getWorkflowStatusVisual(status: WorkflowDisplayStatus): WorkflowStatusVisual {
  switch (status) {
    case 'pending':
      return {kind: 'pending', label: 'Pending', dot: 'neutral', badge: 'neutral'};
    // Waiting on a runner is the awaiting-* state the warning tone was held for: the run is
    // live but nothing is executing, which is the operator's problem to see, not ours to hide.
    case 'queued':
      return {kind: 'queued', label: 'Queued', dot: 'warning', badge: 'warning'};
    case 'running':
      return {kind: 'running', label: 'Running', dot: 'info', badge: 'info'};
    case 'listening':
      return {kind: 'listening', label: 'Listening', dot: 'info', badge: 'info'};
    case 'succeeded':
      return {kind: 'succeeded', label: 'Succeeded', dot: 'success', badge: 'success'};
    case 'failed':
      return {kind: 'failed', label: 'Failed', dot: 'error', badge: 'error'};
    case 'cancelled':
      return {kind: 'cancelled', label: 'Cancelled', dot: 'neutral', badge: 'neutral'};
    case 'skipped':
      return {kind: 'skipped', label: 'Skipped', dot: 'neutral', badge: 'neutral'};
  }

  const exhaustive: never = status;
  return exhaustive;
}
