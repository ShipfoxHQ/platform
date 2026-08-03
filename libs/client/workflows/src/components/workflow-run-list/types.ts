import type {QueryLoadErrorQuery} from '@shipfox/client-ui';
import type {WorkflowRunListItem} from '#core/workflow-run.js';

export type WorkflowRunListStatusFilter = 'all' | 'failed' | 'running';

export interface WorkflowRunListProps {
  projectId: string;
  workspaceSlug?: string | undefined;
  projectSlug?: string | undefined;
  selectedWorkflowRunId?: string | undefined;
  className?: string | undefined;
  search?: string;
  statusFilter?: WorkflowRunListStatusFilter;
  onFiltersChange?: (filters: {search?: string; status?: WorkflowRunListStatusFilter}) => void;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  isFetchNextPageError?: boolean;
  onLoadMore?: () => void;
}

export type WorkflowRunListQuery = QueryLoadErrorQuery & {isPending: boolean};

export interface WorkflowRunListViewProps {
  runs: WorkflowRunListItem[];
  query: WorkflowRunListQuery;
  workspaceSlug?: string | undefined;
  projectSlug?: string | undefined;
  selectedWorkflowRunId?: string | undefined;
  className?: string | undefined;
  search?: string;
  statusFilter?: WorkflowRunListStatusFilter;
  onFiltersChange?: (filters: {search?: string; status?: WorkflowRunListStatusFilter}) => void;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  isFetchNextPageError?: boolean;
  onLoadMore?: () => void;
}
