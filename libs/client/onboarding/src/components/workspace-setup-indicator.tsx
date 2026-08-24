import {useClientAnalytics, useMaybeActiveWorkspace} from '@shipfox/client-shell/runtime';
import {Button} from '@shipfox/react-ui/button';
import {Icon} from '@shipfox/react-ui/icon';
import {Panel, PanelBody} from '@shipfox/react-ui/panel';
import {Popover, PopoverContent, PopoverTrigger} from '@shipfox/react-ui/popover';
import {cn} from '@shipfox/react-ui/utils';
import {useCallback, useId, useState} from 'react';
import type {SetupChecklistItem} from '#core/setup-checklist.js';
import {useSetupChecklistQueryState} from '#hooks/api/setup-checklist.js';
import {useCompletionTransition, useShownAnalytics} from '#hooks/use-checklist-analytics.js';
import {useChecklistDismissal} from '#hooks/use-checklist-dismissal.js';
import {SetupChecklistBody} from './setup-checklist-body.js';
import {ChecklistDismissAction, checklistCountLabel} from './setup-checklist-host-primitives.js';
import type {WorkspaceReference, WorkspaceSetupHostProps} from './setup-checklist-types.js';

export function WorkspaceSetupIndicator(props: WorkspaceSetupHostProps = {}) {
  if (props.workspace) {
    return (
      <WorkspaceSetupIndicatorForWorkspace key={props.workspace.id} workspace={props.workspace} />
    );
  }

  return <WorkspaceSetupIndicatorFromShell />;
}

function WorkspaceSetupIndicatorFromShell() {
  const workspace = useMaybeActiveWorkspace();
  return workspace ? (
    <WorkspaceSetupIndicatorForWorkspace key={workspace.id} workspace={workspace} />
  ) : null;
}

function WorkspaceSetupIndicatorForWorkspace({workspace}: {workspace: WorkspaceReference}) {
  const dismissal = useChecklistDismissal(workspace.id);
  const queryState = useSetupChecklistQueryState(workspace.id, !dismissal.dismissed);
  const analytics = useClientAnalytics();
  const [open, setOpen] = useState(false);
  const [pulseKey, setPulseKey] = useState(0);
  const [burstPending, setBurstPending] = useState(false);
  const handleCompleted = useCallback(
    (completed: boolean) => {
      if (!completed) return;
      setBurstPending(true);
      if (!open) setPulseKey((key) => key + 1);
    },
    [open],
  );
  const showCompletion = useCompletionTransition(queryState, 'popover', handleCompleted);
  const consumeBurst = useCallback(() => setBurstPending(false), []);
  const triggerId = useId();

  const dismiss = useCallback(() => {
    dismissal.dismiss();
    setOpen(false);
    analytics.capture('onboarding_checklist_dismissed', {host: 'popover'});
  }, [analytics, dismissal]);
  const handleAction = useCallback(
    (item: SetupChecklistItem) => {
      analytics.capture('onboarding_checklist_row_clicked', {row_id: item.id});
      setOpen(false);
    },
    [analytics],
  );

  const isVisible =
    !dismissal.dismissed &&
    queryState.baseSettled &&
    (!queryState.checklist.complete || showCompletion);
  useShownAnalytics('popover', isVisible);

  if (dismissal.dismissed || !queryState.baseSettled) return null;
  if (queryState.checklist.complete && !showCompletion) return null;

  const countLabel = checklistCountLabel(queryState.checklist);
  const ariaLabel = `Get started, ${countLabel}`;

  return (
    <Popover modal={false} open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="transparent"
          size="sm"
          id={triggerId}
          aria-label={ariaLabel}
          className="gap-inline"
        >
          <span
            key={pulseKey}
            className={cn(
              'inline-flex items-center',
              pulseKey > 0 && 'motion-safe:animate-[pulse_1s_ease-in-out_1]',
            )}
          >
            <Icon name="circleDottedLine" size={16} aria-hidden="true" />
          </span>
          <span>Get started · {countLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[360px] max-w-[calc(100vw-32px)] p-0"
        aria-labelledby={triggerId}
      >
        <Panel asChild>
          <section aria-label="Get started">
            <PanelBody>
              <SetupChecklistBody
                checklist={queryState.checklist}
                workspaceSlug={workspace.slug}
                completion={showCompletion}
                showBurst={burstPending}
                onBurstComplete={consumeBurst}
                onAction={handleAction}
                onDone={dismiss}
              />
            </PanelBody>
            <ChecklistDismissAction onDismiss={dismiss} />
          </section>
        </Panel>
      </PopoverContent>
    </Popover>
  );
}
