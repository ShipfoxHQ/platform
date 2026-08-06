import {useCopyToClipboard} from '@shipfox/react-ui/hooks';
import {Icon} from '@shipfox/react-ui/icon';
import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui/tooltip';
import {Code} from '@shipfox/react-ui/typography';
import {cn} from '@shipfox/react-ui/utils';
import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';

const COPY_FEEDBACK_OFFSET_PX = 8;

type CopyState = 'idle' | 'copied' | 'failed';

interface FeedbackAnchor {
  bottom: number;
  left: number;
  top: number;
}

export function Identifier({
  display,
  value,
  label = 'identifier',
}: {
  display: string;
  value: string;
  label?: string | undefined;
}) {
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const [feedbackAnchor, setFeedbackAnchor] = useState<FeedbackAnchor | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const {copy} = useCopyToClipboard({
    text: value,
    onCopy: () => {
      setTemporaryCopyState('copied', 2500);
    },
  });

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const resetCopyFeedback = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setCopyState('idle');
    setTooltipOpen(false);
    setFeedbackAnchor(null);
  }, []);

  useEffect(() => {
    if (copyState === 'idle') return;

    window.addEventListener('scroll', resetCopyFeedback, true);
    window.addEventListener('resize', resetCopyFeedback);

    return () => {
      window.removeEventListener('scroll', resetCopyFeedback, true);
      window.removeEventListener('resize', resetCopyFeedback);
    };
  }, [copyState, resetCopyFeedback]);

  function setTemporaryCopyState(state: Exclude<CopyState, 'idle'>, timeout: number) {
    const rect = buttonRef.current?.getBoundingClientRect();
    setCopyState(state);
    setTooltipOpen(false);
    setFeedbackAnchor(
      rect
        ? {
            left: rect.left + rect.width / 2,
            top: rect.top,
            bottom: rect.bottom,
          }
        : null,
    );
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(resetCopyFeedback, timeout);
  }

  async function handleCopy() {
    try {
      await copy();
    } catch {
      setTemporaryCopyState('failed', 2500);
    }
  }

  const ariaLabel =
    copyState === 'copied'
      ? `Copied ${label} ${value}`
      : copyState === 'failed'
        ? `Could not copy ${label} ${value}`
        : `Copy ${label} ${value}`;

  const feedback =
    copyState === 'copied'
      ? {kind: copyState, label: 'Copied'}
      : copyState === 'failed'
        ? {kind: copyState, label: 'Could not copy'}
        : null;

  return (
    <>
      <Tooltip open={copyState === 'idle' ? tooltipOpen : false} onOpenChange={setTooltipOpen}>
        <TooltipTrigger asChild>
          <button
            ref={buttonRef}
            type="button"
            aria-label={ariaLabel}
            onClick={() => {
              void handleCopy();
            }}
            className="inline-flex h-20 min-w-0 shrink-0 items-center gap-tight rounded-4 px-[2px] text-foreground-neutral-muted outline-none transition-colors hover:bg-background-components-hover hover:text-foreground-neutral-base focus-visible:shadow-border-interactive-with-active"
          >
            <Icon name="copy" aria-hidden="true" className="size-12 shrink-0" />
            <Code as="span" variant="label" className="truncate">
              {display}
            </Code>
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <Code as="span" variant="label" className="block max-w-[360px] truncate">
            {value}
          </Code>
        </TooltipContent>
      </Tooltip>
      {feedback && feedbackAnchor ? (
        <CopyFeedbackPortal anchor={feedbackAnchor} kind={feedback.kind}>
          {feedback.label}
        </CopyFeedbackPortal>
      ) : null}
    </>
  );
}

function CopyFeedbackPortal({
  anchor,
  children,
  kind,
}: {
  anchor: FeedbackAnchor;
  children: string;
  kind: Exclude<CopyState, 'idle'>;
}) {
  const feedbackRef = useRef<HTMLSpanElement | null>(null);
  const [placement, setPlacement] = useState<'top' | 'bottom'>('bottom');

  useLayoutEffect(() => {
    const height = feedbackRef.current?.offsetHeight ?? 0;
    setPlacement(anchor.top >= height + COPY_FEEDBACK_OFFSET_PX ? 'top' : 'bottom');
  }, [anchor.top]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <span
      ref={feedbackRef}
      role="status"
      style={{
        left: anchor.left,
        top: placement === 'top' ? anchor.top : anchor.bottom,
        transform:
          placement === 'top'
            ? `translate(-50%, calc(-100% - ${COPY_FEEDBACK_OFFSET_PX}px))`
            : `translate(-50%, ${COPY_FEEDBACK_OFFSET_PX}px)`,
      }}
      className={cn(
        'pointer-events-none fixed z-50 whitespace-nowrap rounded-8 bg-background-components-base px-tight py-[4px] text-xs font-display font-medium leading-20 shadow-tooltip',
        kind === 'failed' ? 'text-foreground-highlight-error' : 'text-foreground-neutral-base',
      )}
    >
      {children}
    </span>,
    document.body,
  );
}
