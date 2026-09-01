import {useClientAnalytics, useMaybeActiveWorkspace} from '@shipfox/client-shell/runtime';
import {Panel, PanelBody} from '@shipfox/react-ui/panel';
import {useCallback, useId, useState} from 'react';
import {type SetupChecklistItem, selectNextSetupStep} from '#core/setup-checklist.js';
import {type ChecklistQueryState, useSetupChecklistQueryState} from '#hooks/api/setup-checklist.js';
import {useCompletionTransition, useShownAnalytics} from '#hooks/use-checklist-analytics.js';
import {useChecklistDismissal} from '#hooks/use-checklist-dismissal.js';
import {useChecklistExpansion} from '#hooks/use-checklist-expansion.js';
import {SetupChecklistBody} from './setup-checklist-body.js';
import {SetupChecklistCompletion} from './setup-checklist-completion.js';
import {
  type ChecklistExpansionControl,
  ChecklistHeader,
  ChecklistSkeleton,
  checklistCountLabel,
} from './setup-checklist-host-primitives.js';
import {SetupChecklistNextStep} from './setup-checklist-next-step.js';
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
  const {expanded, toggle: toggleExpansion} = useChecklistExpansion(workspace.id);
  const queryState = useSetupChecklistQueryState(workspace.id, !dismissal.dismissed);
  const bodyId = useId();
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
  const handleToggleExpansion = useCallback(() => {
    toggleExpansion();
    analytics.capture('onboarding_checklist_expansion_toggled', {
      host: 'panel',
      expanded: !expanded,
    });
  }, [analytics, expanded, toggleExpansion]);
  const isVisible =
    !dismissal.dismissed &&
    queryState.baseSettled &&
    (!queryState.checklist.complete || showCompletion);
  useShownAnalytics('panel', isVisible);

  if (dismissal.dismissed) return null;

  if (queryState.baseSettled && queryState.checklist.complete && !showCompletion) return null;

  const expandable =
    queryState.baseSettled && !showCompletion && queryState.checklist.items.length > 1;

  // `trackedCount` only stops moving once the runner and model-provider families
  // report, so a count shown before then can read "3 of 3 done" over rows that
  // have yet to arrive.
  const countLabel =
    queryState.baseSettled && queryState.trackedRowsSettled
      ? checklistCountLabel(queryState.checklist)
      : undefined;

  const expansionControl: ChecklistExpansionControl | undefined = expandable
    ? {
        expanded,
        stepCount: queryState.checklist.items.length,
        bodyId,
        onToggle: handleToggleExpansion,
      }
    : undefined;

  return (
    <Panel asChild className="w-full">
      <section aria-label="Get started">
        <ChecklistHeader count={countLabel} expansion={expansionControl} onDismiss={dismiss} />
        <PanelBody id={bodyId}>
          <ChecklistPanelBody
            queryState={queryState}
            workspaceSlug={workspace.slug}
            expanded={expanded}
            completion={showCompletion}
            showBurst={burstPending}
            onBurstComplete={consumeBurst}
            onAction={handleAction}
            onDone={dismiss}
          />
        </PanelBody>
      </section>
    </Panel>
  );
}

/**
 * The panel stays at one step until the reader asks for the list, because it
 * sits above the page's own content. The nav-bar indicator carries the full
 * checklist on every route.
 */
function ChecklistPanelBody({
  queryState,
  workspaceSlug,
  expanded,
  completion,
  showBurst,
  onBurstComplete,
  onAction,
  onDone,
}: {
  queryState: ChecklistQueryState;
  workspaceSlug: string;
  expanded: boolean;
  completion: boolean;
  showBurst: boolean;
  onBurstComplete: () => void;
  onAction: (item: SetupChecklistItem) => void;
  onDone: () => void;
}) {
  if (!queryState.baseSettled) return <ChecklistSkeleton />;

  if (completion) {
    return (
      <SetupChecklistCompletion
        standalone
        showBurst={showBurst}
        onBurstComplete={onBurstComplete}
        onDone={onDone}
      />
    );
  }

  if (expanded) {
    return (
      <SetupChecklistBody
        checklist={queryState.checklist}
        workspaceSlug={workspaceSlug}
        onAction={onAction}
      />
    );
  }

  const nextStep = selectNextSetupStep(queryState.checklist);
  if (!nextStep) return null;

  // A pointer only leads once nothing is left to ask for. The runner and
  // model-provider rows stay hidden while their families load, so promoting the
  // pointer then would call setup finished a moment too early.
  if (!nextStep.tracked && !queryState.trackedRowsSettled) return <ChecklistSkeleton />;

  return (
    <SetupChecklistNextStep item={nextStep} workspaceSlug={workspaceSlug} onAction={onAction} />
  );
}
