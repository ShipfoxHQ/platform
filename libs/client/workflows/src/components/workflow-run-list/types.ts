import type {QueryLoadErrorQuery} from '@shipfox/client-ui';
import type {WorkflowRunListItem} from '#core/workflow-run.js';
import type {WorkflowRunFilterPatch, WorkflowRunsSearch} from '#routes/inputs.js';
import type {WorkflowRunWorkflowFacet} from './run-display.js';

export type WorkflowRunListQuery = QueryLoadErrorQuery & {isPending: boolean};
export type WorkflowOptionsStatus = 'loading' | 'ready' | 'error';

interface WorkflowRunListCommonProps {
  workspaceSlug?: string | undefined;
  projectSlug?: string | undefined;
  className?: string | undefined;
  /** Project workflows available even when their runs are outside the loaded history. */
  workflowOptions?: WorkflowRunWorkflowFacet[];
  workflowOptionsStatus?: WorkflowOptionsStatus;
  onOpenWorkflowOptions?: () => void;
  onRetryWorkflowOptions?: () => void;
  /**
   * The parsed URL search. Pair with `onFiltersChange` to keep it in the URL; omit the
   * handler and the view holds filter state itself, which is what stories and isolated tests
   * mount against.
   */
  search?: WorkflowRunsSearch;
  onFiltersChange?: (patch: WorkflowRunFilterPatch) => void;
  onClearFilters?: () => void;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  isFetchNextPageError?: boolean;
  onLoadMore?: () => void;
}

export interface WorkflowRunListProps extends WorkflowRunListCommonProps {
  projectId: string;
}

export interface WorkflowRunListViewProps extends WorkflowRunListCommonProps {
  runs: WorkflowRunListItem[];
  query: WorkflowRunListQuery;
}
