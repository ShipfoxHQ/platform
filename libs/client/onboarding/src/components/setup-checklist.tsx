import {
  dismissWorkspaceSetupChecklist,
  isWorkspaceSetupChecklistDismissed,
  useClientAnalytics,
  useMaybeActiveWorkspace,
} from '@shipfox/client-shell/runtime';
import {Button, ButtonLink, IconButton} from '@shipfox/react-ui/button';
import {Icon} from '@shipfox/react-ui/icon';
import {Panel, PanelActions, PanelBody, PanelHeader, PanelTitle} from '@shipfox/react-ui/panel';
import {Popover, PopoverContent, PopoverTrigger} from '@shipfox/react-ui/popover';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {Text} from '@shipfox/react-ui/typography';
import {cn} from '@shipfox/react-ui/utils';
import {Link} from '@tanstack/react-router';
import {useCallback, useEffect, useId, useRef, useState} from 'react';
import type {SetupChecklist, SetupChecklistItem} from '#core/setup-checklist.js';
import {type ChecklistQueryState, useSetupChecklistQueryState} from '#hooks/api/setup-checklist.js';

const JSDOM_USER_AGENT_RE = /jsdom/u;
const CHECKLIST_DISMISSAL_EVENT = 'shipfox.workspaceSetupChecklist.dismissalChanged';

export interface WorkspaceReference {
  id: string;
  slug: string;
}

export interface WorkspaceSetupHostProps {
  /** A stable workspace makes the hosts easy to compose in isolated surfaces and stories. */
  workspace?: WorkspaceReference;
}

export interface SetupChecklistBodyProps {
  checklist: SetupChecklist;
  workspaceSlug: string;
  completion?: boolean;
  showBurst?: boolean;
  onBurstComplete?: () => void;
  onAction?: ((item: SetupChecklistItem) => void) | undefined;
  onDone?: () => void;
}

type ChecklistHost = 'panel' | 'popover';

export function SetupChecklistBody({
  checklist,
  workspaceSlug,
  completion = false,
  showBurst = false,
  onBurstComplete,
  onAction,
  onDone,
}: SetupChecklistBodyProps) {
  return (
    <div>
      {completion ? (
        <div className="relative overflow-hidden border-b border-border-neutral-base bg-background-highlight-base px-panel-compact py-row">
          <ConfettiBurst active={showBurst} onComplete={onBurstComplete} />
          <div className="relative flex items-center justify-between gap-group">
            <div className="min-w-0">
              <Text size="sm" bold>
                You're set up
              </Text>
              <Text size="xs" className="text-foreground-neutral-muted">
                Your workspace is ready for its first workflow.
              </Text>
            </div>
            <Button type="button" size="sm" variant="primary" onClick={onDone}>
              Done
            </Button>
          </div>
        </div>
      ) : null}
      <ol aria-label="Setup steps" className="m-0 list-none p-0">
        {checklist.items.map((item) => (
          <ChecklistRow
            key={item.id}
            item={item}
            workspaceSlug={workspaceSlug}
            onAction={onAction}
          />
        ))}
      </ol>
    </div>
  );
}

export function WorkspaceSetupChecklist(props: WorkspaceSetupHostProps = {}) {
  if (props.workspace) {
    return (
      <WorkspaceSetupChecklistForWorkspace key={props.workspace.id} workspace={props.workspace} />
    );
  }

  return <WorkspaceSetupChecklistFromShell />;
}

export function WorkspaceSetupIndicator(props: WorkspaceSetupHostProps = {}) {
  if (props.workspace) {
    return (
      <WorkspaceSetupIndicatorForWorkspace key={props.workspace.id} workspace={props.workspace} />
    );
  }

  return <WorkspaceSetupIndicatorFromShell />;
}

function WorkspaceSetupChecklistFromShell() {
  const workspace = useMaybeActiveWorkspace();
  return workspace ? (
    <WorkspaceSetupChecklistForWorkspace key={workspace.id} workspace={workspace} />
  ) : null;
}

function WorkspaceSetupIndicatorFromShell() {
  const workspace = useMaybeActiveWorkspace();
  return workspace ? (
    <WorkspaceSetupIndicatorForWorkspace key={workspace.id} workspace={workspace} />
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

function ChecklistDismissAction({onDismiss}: {onDismiss: () => void}) {
  return (
    <div className="flex justify-end border-t border-border-neutral-base px-row py-row">
      <Button type="button" size="sm" variant="transparentMuted" onClick={onDismiss}>
        Hide setup guide
      </Button>
    </div>
  );
}

function ChecklistHeader({count, onDismiss}: {count?: string | undefined; onDismiss: () => void}) {
  return (
    <PanelHeader>
      <div className="flex min-w-0 items-center gap-group">
        <PanelTitle>Get started</PanelTitle>
        {count ? (
          <Text as="span" size="sm" className="shrink-0 text-foreground-neutral-muted">
            {count}
          </Text>
        ) : null}
      </div>
      <PanelActions>
        <IconButton
          type="button"
          variant="transparent"
          size="sm"
          muted
          icon="close"
          aria-label="Hide setup guide"
          onClick={onDismiss}
        />
      </PanelActions>
    </PanelHeader>
  );
}

function ChecklistSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading setup guide"
      className="flex flex-col gap-inline p-panel"
    >
      <Skeleton className="h-16 w-3/4" />
      <Skeleton className="h-16 w-5/6" />
      <Skeleton className="h-16 w-2/3" />
    </div>
  );
}

function ChecklistRow({
  item,
  workspaceSlug,
  onAction,
}: {
  item: SetupChecklistItem;
  workspaceSlug: string;
  onAction?: ((item: SetupChecklistItem) => void) | undefined;
}) {
  const pointer = !item.tracked;
  const showDetails = pointer || item.status === 'open';
  const statusLabel = pointer
    ? 'next step'
    : item.status === 'done'
      ? 'done'
      : item.attention
        ? 'needs attention'
        : 'to do';

  return (
    <li className="flex min-w-0 items-start gap-group border-b border-border-neutral-base px-row py-row last:border-b-0">
      <ChecklistStatus item={item} pointer={pointer} label={statusLabel} />
      <div className="min-w-0 flex-1">
        <Text
          as="span"
          size="sm"
          className={cn(
            'block',
            item.status === 'done' && !pointer
              ? 'text-foreground-neutral-muted'
              : 'text-foreground-neutral-base',
          )}
        >
          {item.title}
        </Text>
        {showDetails && item.purpose ? (
          <Text as="span" size="xs" className="mt-tight block text-foreground-neutral-muted">
            {item.purpose}
          </Text>
        ) : null}
        {showDetails && item.action ? (
          <div className="mt-inline">
            <ChecklistActionLink
              item={item}
              action={item.action}
              pointer={pointer}
              workspaceSlug={workspaceSlug}
              onAction={onAction}
            />
          </div>
        ) : null}
      </div>
    </li>
  );
}

function ChecklistStatus({
  item,
  pointer,
  label,
}: {
  item: SetupChecklistItem;
  pointer: boolean;
  label: string;
}) {
  if (pointer) {
    return (
      <span className="mt-1 min-w-28 shrink-0 text-xs font-medium text-foreground-neutral-muted">
        <span aria-hidden="true">Next</span>
        <span className="sr-only">{label}</span>
      </span>
    );
  }

  if (item.status === 'done') {
    return (
      <span className="mt-1 shrink-0">
        <Icon
          name="checkCircleSolid"
          className="size-16 text-foreground-highlight-interactive"
          aria-hidden="true"
        />
        <span className="sr-only">{label}</span>
      </span>
    );
  }

  return (
    <span className="mt-1 shrink-0">
      <span
        aria-hidden="true"
        className="block size-16 rounded-full border-2 border-foreground-neutral-subtle"
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}

function ChecklistActionLink({
  item,
  action,
  pointer,
  workspaceSlug,
  onAction,
}: {
  item: SetupChecklistItem;
  action: NonNullable<SetupChecklistItem['action']>;
  pointer: boolean;
  workspaceSlug: string;
  onAction?: ((item: SetupChecklistItem) => void) | undefined;
}) {
  const handleClick = () => onAction?.(item);
  const variant = pointer ? 'muted' : 'interactive';

  if (action.href === '/docs/getting-started') {
    return (
      <ButtonLink asChild variant={variant} underline iconRight="chevronRight">
        <a href={action.href} onClick={handleClick}>
          {action.label}
        </a>
      </ButtonLink>
    );
  }

  if (action.href === '/settings/integrations') {
    return (
      <ButtonLink asChild variant={variant} underline iconRight="chevronRight">
        <Link
          to="/w/$workspaceSlug/settings/integrations"
          params={{workspaceSlug}}
          onClick={handleClick}
        >
          {action.label}
        </Link>
      </ButtonLink>
    );
  }

  if (action.href === '/settings/runners') {
    return (
      <ButtonLink asChild variant={variant} underline iconRight="chevronRight">
        <Link
          to="/w/$workspaceSlug/settings/runners"
          params={{workspaceSlug}}
          onClick={handleClick}
        >
          {action.label}
        </Link>
      </ButtonLink>
    );
  }

  if (action.href === '/settings/agents') {
    return (
      <ButtonLink asChild variant={variant} underline iconRight="chevronRight">
        <Link to="/w/$workspaceSlug/settings/agents" params={{workspaceSlug}} onClick={handleClick}>
          {action.label}
        </Link>
      </ButtonLink>
    );
  }

  return (
    <ButtonLink asChild variant={variant} underline iconRight="chevronRight">
      <Link to="/w/$workspaceSlug/settings/members" params={{workspaceSlug}} onClick={handleClick}>
        {action.label}
      </Link>
    </ButtonLink>
  );
}

function useChecklistDismissal(workspaceId: string) {
  const [dismissed, setDismissed] = useState(() => isWorkspaceSetupChecklistDismissed(workspaceId));

  useEffect(() => {
    const refresh = () => setDismissed(isWorkspaceSetupChecklistDismissed(workspaceId));
    refresh();
    window.addEventListener('storage', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener(CHECKLIST_DISMISSAL_EVENT, refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener(CHECKLIST_DISMISSAL_EVENT, refresh);
    };
  }, [workspaceId]);

  const dismiss = useCallback(() => {
    dismissWorkspaceSetupChecklist(workspaceId);
    setDismissed(true);
    window.dispatchEvent(new Event(CHECKLIST_DISMISSAL_EVENT));
  }, [workspaceId]);

  return {dismissed, dismiss};
}

function useCompletionTransition(
  queryState: ChecklistQueryState,
  host: ChecklistHost,
  onCompleted?: (completed: boolean) => void,
) {
  const analytics = useClientAnalytics();
  const observedIncomplete = useRef(false);
  const completionHandled = useRef(false);
  const [showCompletion, setShowCompletion] = useState(false);

  useEffect(() => {
    if (
      queryState.baseSettled &&
      !queryState.checklist.complete &&
      queryState.checklist.openCount > 0
    ) {
      observedIncomplete.current = true;
    }

    if (!queryState.completionReady) return;

    if (!queryState.checklist.complete) {
      setShowCompletion(false);
      return;
    }

    if (!observedIncomplete.current || completionHandled.current) return;
    completionHandled.current = true;
    setShowCompletion(true);
    onCompleted?.(true);
    analytics.capture('onboarding_checklist_completed', {host});
  }, [
    analytics,
    host,
    onCompleted,
    queryState.baseSettled,
    queryState.checklist.complete,
    queryState.checklist.openCount,
    queryState.completionReady,
  ]);

  return showCompletion;
}

function useShownAnalytics(host: ChecklistHost, visible: boolean) {
  const analytics = useClientAnalytics();
  const shown = useRef(false);

  useEffect(() => {
    if (!visible || shown.current) return;
    shown.current = true;
    analytics.capture('onboarding_checklist_shown', {host});
  }, [analytics, host, visible]);
}

function checklistCountLabel(checklist: SetupChecklist) {
  return `${checklist.trackedCount - checklist.openCount} of ${checklist.trackedCount} done`;
}

function ConfettiBurst({
  active,
  onComplete,
}: {
  active: boolean;
  onComplete?: (() => void) | undefined;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!active || typeof window === 'undefined') return;
    let completed = false;
    const finish = () => {
      if (completed) return;
      completed = true;
      onComplete?.();
    };

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      finish();
      return;
    }
    if (typeof navigator !== 'undefined' && JSDOM_USER_AGENT_RE.test(navigator.userAgent)) {
      finish();
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      finish();
      return;
    }
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width === 0 && bounds.height === 0) {
      finish();
      return;
    }
    const context = canvas.getContext('2d');
    if (!context) {
      finish();
      return;
    }

    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(bounds.width, 1);
    const height = Math.max(bounds.height, 1);
    canvas.width = Math.floor(width * pixelRatio);
    canvas.height = Math.floor(height * pixelRatio);
    context.scale(pixelRatio, pixelRatio);

    const styles = getComputedStyle(canvas);
    const colors = [
      styles.getPropertyValue('--color-background-accent-blue-base').trim(),
      styles.getPropertyValue('--color-background-accent-purple-base').trim(),
      styles.getPropertyValue('--color-background-accent-success-base').trim(),
      styles.getPropertyValue('--color-background-accent-warning-base').trim(),
    ].filter(Boolean);
    if (colors.length === 0) {
      finish();
      return;
    }
    const palette = colors;
    const particles = Array.from({length: 32}, (_, index) => ({
      x: width / 2 + (Math.random() - 0.5) * width * 0.3,
      y: height * 0.15,
      vx: (Math.random() - 0.5) * 3,
      vy: -(Math.random() * 3 + 2),
      rotation: Math.random() * Math.PI,
      size: Math.random() * 4 + 3,
      color: palette[index % palette.length] ?? palette[0] ?? '',
    }));
    let frame = 0;
    let startedAt = performance.now();

    const draw = (now: number) => {
      const elapsed = now - startedAt;
      context.clearRect(0, 0, width, height);
      context.globalAlpha = Math.max(0, 1 - elapsed / 1500);
      for (const particle of particles) {
        particle.vy += 0.12;
        particle.vx *= 0.99;
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.rotation += 0.12;
        context.save();
        context.translate(particle.x, particle.y);
        context.rotate(particle.rotation);
        context.fillStyle = particle.color;
        context.fillRect(
          -particle.size / 2,
          -particle.size / 2,
          particle.size,
          particle.size * 0.6,
        );
        context.restore();
      }
      context.globalAlpha = 1;
      if (elapsed < 1500) {
        frame = requestAnimationFrame(draw);
      } else {
        finish();
      }
    };

    startedAt = performance.now();
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      context.clearRect(0, 0, width, height);
    };
  }, [active, onComplete]);

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 size-full">
      <canvas ref={canvasRef} className="size-full" />
    </div>
  );
}
