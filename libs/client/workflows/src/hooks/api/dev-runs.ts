import {ApiError, checkedApiRequest, type StandardSchema} from '@shipfox/client-api';
import {useMutation, useQueryClient} from '@tanstack/react-query';
import type {DefinitionAtRefListing, DefinitionAtRefTrigger} from '#core/definitions-at-ref.js';
import type {DevRunLaunch, WorkflowRunListItem, WorkflowRunListPage} from '#core/workflow-run.js';
import {
  WorkflowRunAttemptSummary,
  workflowRunTriggerDisplayLabel,
  workflowRunTriggerLabel,
} from '#core/workflow-run.js';
import {definitionsAtRefQueryKeys} from './definitions-at-ref.js';
import {
  cryptoRandomId,
  type RunListInfinite,
  readFiltersFromKey,
  type WorkflowRunFilters,
  workflowRunsQueryKeys,
} from './workflow-runs.js';

export interface CreateDevRunVariables {
  projectId: string;
  /** Branch or tag name the definition is read from. */
  ref: string;
  /** The commit the ref resolved to when the picker listed the file; a mismatch answers `ref-moved`. */
  commit?: string | undefined;
  configPath: string;
  /** Trigger key in the resolved workflow file's `triggers` map. */
  trigger: string;
  /** Manual triggers only; overrides the trigger's `with` block. */
  inputs?: Record<string, unknown> | undefined;
  /** Integration triggers only: the journaled event to replay. */
  replayEventId?: string | undefined;
}

const devRunResponseSchema: StandardSchema<unknown, {workflow_run_id: string; commit: string}> = {
  '~standard': {
    version: 1,
    vendor: 'client-workflows',
    validate: (value) => {
      if (
        typeof value === 'object' &&
        value !== null &&
        'workflow_run_id' in value &&
        typeof value.workflow_run_id === 'string' &&
        'commit' in value &&
        typeof value.commit === 'string'
      )
        return {value: {workflow_run_id: value.workflow_run_id, commit: value.commit}};
      return {issues: [{message: 'Expected workflow_run_id and commit.'}]};
    },
  },
};

/**
 * Create a dev run from a workflow file at a git ref. The server resolves the
 * ref, validates the file with the sync pipeline, and starts the run without
 * persisting anything per branch.
 */
export async function createDevRun(variables: CreateDevRunVariables): Promise<DevRunLaunch> {
  const {projectId, ref, commit, configPath, trigger, inputs, replayEventId} = variables;
  const response = await checkedApiRequest(devRunResponseSchema, '/dev-runs', {
    method: 'POST',
    body: {
      project_id: projectId,
      ref,
      ...(commit === undefined ? {} : {commit}),
      config_path: configPath,
      trigger,
      ...(inputs === undefined ? {} : {inputs}),
      ...(replayEventId === undefined ? {} : {replay_event_id: replayEventId}),
    },
  });
  return {workflowRunId: response.workflow_run_id, commit: response.commit};
}

function devRunTriggerEvent(trigger: DefinitionAtRefTrigger | undefined, source: string): string {
  if (trigger?.event) return trigger.event;
  if (source === 'manual') return 'fire';
  if (source === 'cron') return 'tick';
  return '';
}

function buildTempDevRun({
  projectId,
  ref,
  commit,
  configPath,
  name,
  triggerSource,
  triggerEvent,
  replayEventId,
  createdAt,
}: {
  projectId: string;
  ref: string;
  commit: string;
  configPath: string;
  name: string;
  triggerSource: string;
  triggerEvent: string;
  replayEventId: string | undefined;
  createdAt: string;
}): WorkflowRunListItem {
  const id = `temp-${cryptoRandomId()}`;
  return {
    id,
    projectId,
    // The workflow lineage id is server-side; the client cannot know it for a
    // file that may not exist on the default branch.
    definitionId: '',
    origin: 'dev',
    devSource: {
      ref,
      commit,
      configPath,
      // The run list renders no initiator when the id is empty; the real row
      // carries the acting user once the server has created the run.
      initiatedByUserId: '',
      replayOfEventId: replayEventId ?? null,
    },
    number: null,
    name,
    workflowName: name,
    status: 'pending',
    currentAttempt: 1,
    latestAttempt: 1,
    triggerProvider: null,
    triggerSource,
    triggerEvent,
    triggerPayload: {source: triggerSource, event: triggerEvent},
    triggerDisplayLabel: workflowRunTriggerDisplayLabel({triggerSource, triggerEvent}),
    triggerLabel: workflowRunTriggerLabel({triggerSource, triggerEvent}),
    triggerReference: null,
    inputs: null,
    sourceSnapshot: null,
    createdAt,
    updatedAt: createdAt,
    isTemporary: true,
    // The optimistic row genuinely has no jobs yet: the server has not planned the graph.
    jobs: {preview: [], statusCounts: [], hasStartedJobExecution: false, total: 0},
    runAttempt: new WorkflowRunAttemptSummary({
      workflowRunId: id,
      attempt: 1,
      status: 'pending',
      createdAt,
      startedAt: null,
      finishedAt: null,
    }),
  };
}

function filtersAcceptDevPendingRun(
  filters: WorkflowRunFilters,
  triggerSource: string,
  now: Date,
): boolean {
  if (filters.status && filters.status !== 'pending') return false;
  // A dev run never appears in a synced-only list.
  if (filters.origin === 'synced') return false;
  // The client cannot know the workflow lineage id of a file at a ref, so a
  // definition-scoped list cannot match the optimistic row.
  if (filters.definitionId) return false;
  if (filters.triggerSource && filters.triggerSource !== triggerSource) return false;
  if (filters.createdFrom && Date.parse(filters.createdFrom) > now.getTime()) return false;
  if (filters.createdTo && Date.parse(filters.createdTo) < now.getTime()) return false;
  return true;
}

function lookupAtRefListing(
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: string,
  ref: string,
) {
  return queryClient.getQueryData<DefinitionAtRefListing>(
    definitionsAtRefQueryKeys.atRef(projectId, ref),
  );
}

/**
 * Create a dev run and show it in the project run lists immediately.
 *
 * The optimistic pending row is derived from the at-ref listing the picker
 * already holds in the cache (name, trigger source and event, pinned commit),
 * inserted into every list page whose filters accept a pending dev run, and
 * removed again when the request fails. On success the project run lists are
 * invalidated so the real run replaces the temp row.
 */
export function useCreateDevRunMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createDevRun,
    onMutate: (variables) => {
      const listing = lookupAtRefListing(queryClient, variables.projectId, variables.ref);
      const file = listing?.files.find((entry) => entry.configPath === variables.configPath);
      const trigger = file?.triggers[variables.trigger];
      const triggerSource = trigger?.source ?? 'manual';
      const createdAt = new Date().toISOString();
      const tempRun = buildTempDevRun({
        projectId: variables.projectId,
        ref: variables.ref,
        commit: variables.commit ?? listing?.commit ?? '',
        configPath: variables.configPath,
        name: file?.name ?? 'New run',
        triggerSource,
        triggerEvent: devRunTriggerEvent(trigger, triggerSource),
        replayEventId: variables.replayEventId,
        createdAt,
      });

      const listsKey = workflowRunsQueryKeys.lists(variables.projectId);
      const touchedQueryKeys: Array<readonly unknown[]> = [];

      const entries = queryClient.getQueriesData<RunListInfinite>({queryKey: listsKey});
      const now = new Date(createdAt);
      for (const [queryKey] of entries) {
        const filters = readFiltersFromKey(queryKey);
        if (!filters) continue;
        if (!filtersAcceptDevPendingRun(filters, triggerSource, now)) continue;

        touchedQueryKeys.push(queryKey);
        queryClient.setQueryData<RunListInfinite>(queryKey, (current) => {
          if (!current || current.pages.length === 0) return current;
          const firstPage = current.pages[0];
          if (!firstPage) return current;
          const nextFirstPage: WorkflowRunListPage = {
            ...firstPage,
            runs: [tempRun, ...firstPage.runs],
            filteredTotalCount:
              firstPage.filteredTotalCount != null ? firstPage.filteredTotalCount + 1 : null,
          };
          return {...current, pages: [nextFirstPage, ...current.pages.slice(1)]};
        });
      }

      return {tempWorkflowRunId: tempRun.id, touchedQueryKeys};
    },
    onError: (_error, _variables, context) => {
      if (!context) return;
      for (const queryKey of context.touchedQueryKeys) {
        queryClient.setQueryData<RunListInfinite>(queryKey, (current) => {
          if (!current) return current;
          let removedCount = 0;
          const pages = current.pages.map((page) => {
            const runs = page.runs.filter((run) => {
              if (run.id !== context.tempWorkflowRunId) return true;
              removedCount += 1;
              return false;
            });
            if (runs.length === page.runs.length) return page;
            return {
              ...page,
              runs,
              filteredTotalCount:
                page.filteredTotalCount != null
                  ? Math.max(0, page.filteredTotalCount - removedCount)
                  : null,
            };
          });
          if (removedCount === 0) return current;
          return {...current, pages};
        });
      }
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: workflowRunsQueryKeys.lists(variables.projectId),
      });
    },
  });
}

export interface DevRunErrorCopy {
  title: string;
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function apiDetails(error: ApiError): Record<string, unknown> {
  if (!isRecord(error.details)) return {};
  const details = error.details.details;
  return isRecord(details) ? details : {};
}

function stringDetail(error: ApiError, key: string): string | undefined {
  const value = apiDetails(error)[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * User-facing copy for a failed `POST /dev-runs` request, following the
 * client error-handling guidance: known server codes map to stable copy,
 * structured server responses keep their message under a stable title, and
 * non-API failures never render their raw message.
 */
export function devRunErrorCopy(error: unknown): DevRunErrorCopy {
  if (!(error instanceof ApiError)) {
    return {
      title: 'Something went wrong',
      message: 'Try again in a moment.',
    };
  }

  switch (error.code) {
    case 'network-error':
      return {
        title: 'Network problem',
        message: 'We could not reach the API. Check your connection and try again.',
      };
    case 'ref-invalid':
      return {
        title: 'Ref is not a branch or tag',
        message: 'Enter a branch or tag name in this repository.',
      };
    case 'ref-not-found':
      return {
        title: 'Ref not found',
        message: 'This branch or tag no longer exists in the repository.',
      };
    case 'ref-moved':
      return {
        title: 'Ref moved',
        message:
          'The ref no longer points at the commit you selected. Confirm the new commit and try again.',
      };
    case 'file-not-found':
      return {
        title: 'Workflow file not found',
        message: 'This workflow file no longer exists at the ref.',
      };
    case 'project-not-found':
      return {
        title: 'Project not found',
        message: 'This project does not exist, or you no longer have access to it.',
      };
    case 'invalid-workflow-definition':
      return {
        title: 'Invalid workflow definition',
        message:
          'The workflow file at this ref did not validate. Fix the errors on the branch and try again.',
      };
    case 'content-too-large':
      return {
        title: 'Workflow file too large',
        message: 'The workflow file at this ref is too large to run.',
      };
    case 'trigger-not-found':
      return {
        title: 'Trigger not found',
        message: 'This workflow file does not declare the selected trigger.',
      };
    case 'trigger-filtered': {
      const reason = stringDetail(error, 'reason');
      return {
        title: 'Trigger filter refused the event',
        message: reason
          ? `The trigger filter did not match this event: ${reason}`
          : 'The trigger filter did not match this event.',
      };
    }
    case 'replay-event-not-found':
      return {
        title: 'Event not found',
        message: 'This event is no longer available for replay.',
      };
    case 'replay-event-required':
      return {
        title: 'Replay event required',
        message: 'Pick a journaled event to replay for this trigger.',
      };
    case 'replay-event-mismatch':
      return {
        title: 'Event does not match the trigger',
        message: 'This event does not match the trigger source and event.',
      };
    case 'replay-event-unavailable':
      return {
        title: 'Event no longer available',
        message: "This event's payload was pruned and cannot be replayed.",
      };
    case 'inputs-not-allowed':
      return {
        title: 'Inputs not allowed',
        message: 'This trigger does not accept inputs.',
      };
    case 'workflow-interpolation-unresolvable':
      return {
        title: 'Workflow inputs unresolved',
        message:
          'The workflow references inputs that could not be resolved. Check the trigger inputs and try again.',
      };
    case 'workspace-suspended':
      return {
        title: 'Workspace suspended',
        message: 'Your workspace is suspended. Runs cannot start until it is active again.',
      };
    case 'source-unavailable':
      return {
        title: 'Source repository unavailable',
        message: 'Shipfox could not read the repository right now. Try again in a moment.',
      };
    default:
      return {
        title: 'Could not start the run',
        message: error.message || 'Try again in a moment.',
      };
  }
}
