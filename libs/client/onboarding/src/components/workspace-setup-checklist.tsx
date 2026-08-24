import {useClientAnalytics, useMaybeActiveWorkspace} from '@shipfox/client-shell/runtime';
import {Panel, PanelBody} from '@shipfox/react-ui/panel';
import {useCallback, useState} from 'react';
import type {SetupChecklistItem} from '#core/setup-checklist.js';
import {useSetupChecklistQueryState} from '#hooks/api/setup-checklist.js';
import {useCompletionTransition, useShownAnalytics} from '#hooks/use-checklist-analytics.js';
import {useChecklistDismissal} from '#hooks/use-checklist-dismissal.js';
import {SetupChecklistBody} from './setup-checklist-body.js';
import {
  ChecklistHeader,
  ChecklistSkeleton,
  checklistCountLabel,
} from './setup-checklist-host-primitives.js';
import type {WorkspaceReference, WorkspaceSetupHostProps} from './setup-checklist-types.js';

export function WorkspaceSetupChecklist(props: WorkspaceSetupHostProps = {}) {
  if (props.workspace) {
    return (
      <WorkspaceSetupChecklistForWorkspace key={props.workspace.id} workspace={props.workspace} />
    );
  }

  return <WorkspaceSetupChecklistFromShell />;
}

function WorkspaceSetupChecklistFromShell() {
  const workspace = useMaybeActiveWorkspace();
  return workspace ? (
    <WorkspaceSetupChecklistForWorkspace key={workspace.id} workspace={workspace} />
  ) : null;
}

function WorkspaceSetupChecklistForWorkspace({workspace}: {workspace: WorkspaceReference}) {
  const dismissal = useChecklistDismissal(workspace.id);
  const queryState = useSetupChecklistQueryState(workspace.id, !dismissal.dismissed);
  const [burstPending, setBurstPending] = useState(false);
  const handleCompleted = useCallback((completed: boolean) => {
    if (completed) setBurstPending(true);
  }, []);
  const showCompletion = useCompletionTransition(queryState, 'panel', handleCompleted);
  const analytics = useClientAnalytics();
  const consumeBurst = useCallback(() => setBurstPending(false), []);

  const dismiss = useCallback(() => {
    dismissal.dismiss();
    analytics.capture('onboarding_checklist_dismissed', {host: 'panel'});
  }, [analytics, dismissal]);
  const handleAction = useCallback(
    (item: SetupChecklistItem) => {
      analytics.capture('onboarding_checklist_row_clicked', {row_id: item.id});
    },
    [analytics],
  );
  const isVisible =
    !dismissal.dismissed &&
    queryState.baseSettled &&
    (!queryState.checklist.complete || showCompletion);
  useShownAnalytics('panel', isVisible);

  if (dismissal.dismissed) return null;

  if (queryState.baseSettled && queryState.checklist.complete && !showCompletion) return null;

  return (
    <Panel asChild className="w-full">
      <section aria-label="Get started">
        <ChecklistHeader
          count={queryState.baseSettled ? checklistCountLabel(queryState.checklist) : undefined}
          onDismiss={dismiss}
        />
        <PanelBody>
          {queryState.baseSettled ? (
            queryState.checklist.complete && !showCompletion ? null : (
              <SetupChecklistBody
                checklist={queryState.checklist}
                workspaceSlug={workspace.slug}
                completion={showCompletion}
                showBurst={burstPending}
                onBurstComplete={consumeBurst}
                onAction={handleAction}
                onDone={dismiss}
              />
            )
          ) : (
            <ChecklistSkeleton />
          )}
        </PanelBody>
      </section>
    </Panel>
  );
}
