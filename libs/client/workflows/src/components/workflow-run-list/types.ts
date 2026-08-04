import type {QueryLoadErrorQuery} from '@shipfox/client-ui';
import type {WorkflowRunListItem} from '#core/workflow-run.js';
import type {WorkflowRunFilterPatch, WorkflowRunsSearch} from '#routes/inputs.js';

export type WorkflowRunListQuery = QueryLoadErrorQuery & {isPending: boolean};

interface WorkflowRunListCommonProps {
  workspaceSlug?: string | undefined;
  projectSlug?: string | undefined;
  className?: string | undefined;
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
