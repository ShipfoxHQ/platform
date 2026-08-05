import type {AnnotationStyleDto} from '@shipfox/annotations-dto';
import {Button} from '@shipfox/react-ui/button';
import {Callout, CalloutContent} from '@shipfox/react-ui/callout';
import {Markdown} from '@shipfox/react-ui/markdown';
import {cn} from '@shipfox/react-ui/utils';
import {type ReactNode, useEffect, useId, useRef, useState} from 'react';

/**
 * Rendered height of a body before it clamps, in pixels. The server permits 1 MiB per body and
 * 50 contexts per job execution, so one run can legitimately hold hundreds of megabytes of
 * Markdown. Nothing here may render unbounded.
 */
const DEFAULT_MAX_BODY_HEIGHT = 320;

/** Sub-pixel layout noise must not put a one-line body behind a disclosure. */
const OVERFLOW_TOLERANCE = 8;

/**
 * Source characters parsed while collapsed.
 *
 * Clipping with CSS bounds the layout but not the work: a 1 MiB body still runs the full
 * remark/rehype pipeline and mounts every node behind an `overflow: hidden`. Twenty-five of
 * those is tens of megabytes of DOM nobody can see. This is generous next to a 320px clamp
 * (roughly 16 lines) so the preview always overfills the visible box.
 */
const MAX_COLLAPSED_BODY_CHARS = 4_000;

const TRAILING_PARTIAL_LINE = /\n[^\n]*$/u;

/**
 * Cuts Markdown source at a line boundary.
 *
 * Only the line boundary needs handling: a mid-line cut can split a link or inline code and
 * render the fragment as literal text. An unterminated fence needs no repair, because
 * CommonMark closes an open fence at the end of the document, so the preview renders it as a
 * code block either way.
 */
function collapsedPreview(body: string): string {
  return body.slice(0, MAX_COLLAPSED_BODY_CHARS).replace(TRAILING_PARTIAL_LINE, '');
}

/**
 * Prose measure for the body. Tables and code fences opt out: they are scanned column-wise and
 * want the width, while a 150-character paragraph is simply hard to read.
 */
const BODY_MEASURE =
  '[&>p]:max-w-[75ch] [&>ul]:max-w-[75ch] [&>ol]:max-w-[75ch] [&>blockquote]:max-w-[75ch] [&>h1]:max-w-[75ch] [&>h2]:max-w-[75ch] [&>h3]:max-w-[75ch] [&>h4]:max-w-[75ch]';

type AnnotationCardProps = {
  style: AnnotationStyleDto;
  body: string;
  /** The annotation's `context`, shown as its title. */
  title?: string | undefined;
  /** Heading element for the title. Callers own the document outline. */
  titleAs?: 'h2' | 'h3' | 'h4' | undefined;
  /** Where the annotation came from, rendered under the title. */
  provenance?: ReactNode | undefined;
  /** A single action, such as a link back to the emitting step. */
  action?: ReactNode | undefined;
  maxBodyHeight?: number | undefined;
  id?: string | undefined;
};

/**
 * Deliberately not memoized: `provenance` and `action` are elements the caller builds fresh on
 * every render, so a shallow compare could never hit. The parse cost that actually matters is
 * held by `Markdown`, which memoizes on its primitive props.
 */
function AnnotationCard({
  style,
  body,
  title,
  titleAs: TitleTag = 'h3',
  provenance,
  action,
  maxBodyHeight = DEFAULT_MAX_BODY_HEIGHT,
  id,
}: AnnotationCardProps) {
  const bodyId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const [measurement, setMeasurement] = useState<{measured: boolean; overflows: boolean}>({
    measured: false,
    overflows: false,
  });
  const [expanded, setExpanded] = useState(false);
  const {measured, overflows} = measurement;
  const hasBody = Boolean(body.trim());
  const hasHeader = Boolean(title || provenance || action);

  useEffect(() => {
    const node = contentRef.current;
    if (!node || !hasBody) return;

    // Measured on the unclamped inner node so the reading stays true while the outer wrapper is
    // clipped, and observed rather than measured once because a code fence settles its height
    // only after syntax highlighting lands.
    function measure() {
      if (!node) return;
      setMeasurement({
        measured: true,
        overflows: node.scrollHeight > maxBodyHeight + OVERFLOW_TOLERANCE,
      });
    }

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
    // `hasBody` is a dependency because the measured node only exists once there is a body to
    // measure: an annotation that starts empty and is appended to during its step would
    // otherwise never install an observer, and would clip with no way to open it. Later edits
    // to a non-empty body need no re-run, since the observer already reports their height.
  }, [maxBodyHeight, hasBody]);

  if (!hasBody && !hasHeader) return null;

  // Truncation is known from the source, so an over-budget body needs no measurement to know
  // it overflows. That keeps the disclosure correct on the very first paint.
  const truncated = body.length > MAX_COLLAPSED_BODY_CHARS;
  const disclosable = hasBody && (truncated || overflows);

  // Clamped before the first measurement so a long body never paints full height and then
  // collapses under the reader, and released once measured within tolerance so a body just
  // over the budget is never clipped without a disclosure to open it.
  const collapsed = hasBody && !expanded && (!measured || disclosable);
  const rendered = collapsed && truncated ? collapsedPreview(body) : body;

  return (
    <Callout id={id} type={style}>
      <CalloutContent className="flex flex-col gap-6">
        {hasHeader ? (
          <div className="flex min-w-0 items-start justify-between gap-8">
            <div className="flex min-w-0 flex-col gap-2">
              {title ? (
                <TitleTag className="min-w-0 break-words font-code text-sm font-medium leading-20 text-foreground-neutral-base">
                  {title}
                </TitleTag>
              ) : null}
              {provenance}
            </div>
            {action ? <div className="shrink-0">{action}</div> : null}
          </div>
        ) : null}

        {hasBody ? (
          <div className="flex min-w-0 flex-col gap-4">
            <div
              id={bodyId}
              className={cn('relative min-w-0', collapsed && 'overflow-hidden')}
              style={collapsed ? {maxHeight: maxBodyHeight} : undefined}
              // Tabbing to a link inside a clipped body cannot scroll it into view, so reveal the
              // body rather than move focus somewhere invisible.
              onFocusCapture={collapsed && disclosable ? () => setExpanded(true) : undefined}
            >
              <div ref={contentRef}>
                <Markdown className={cn(BODY_MEASURE, '[&>*:last-child]:mb-0')}>
                  {rendered}
                </Markdown>
              </div>
              {collapsed && disclosable ? (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-linear-to-t from-background-components-base to-transparent"
                />
              ) : null}
            </div>
            {disclosable ? (
              // The fade above it carries the "there is more" signal, so the control itself
              // stays quiet rather than competing with the body it reveals.
              <Button
                type="button"
                size="xs"
                variant="transparent"
                aria-expanded={expanded}
                aria-controls={bodyId}
                onClick={() => setExpanded((current) => !current)}
                className="-mx-inline self-start [@media(pointer:coarse)]:min-h-44"
              >
                {expanded ? 'Show less' : 'Show more'}
              </Button>
            ) : null}
          </div>
        ) : null}
      </CalloutContent>
    </Callout>
  );
}

export {AnnotationCard, type AnnotationCardProps, DEFAULT_MAX_BODY_HEIGHT};
