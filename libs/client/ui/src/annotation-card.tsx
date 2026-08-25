import type {AnnotationStyleDto} from '@shipfox/annotations-dto';
import {Button} from '@shipfox/react-ui/button';
import {Icon, type IconName} from '@shipfox/react-ui/icon';
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

/**
 * The glyph vocabulary for annotation style.
 *
 * One map, so the mark beside `1 error` in a summary line is the mark on the error row below it.
 */
const ANNOTATION_STYLE_ICON = {
  default: 'fileTextLine',
  info: 'info',
  success: 'checkboxCircleFill',
  warning: 'errorWarningFill',
  error: 'closeCircleFill',
} as const satisfies Record<AnnotationStyleDto, IconName>;

/**
 * Style tone lives in the glyph, never in the surface behind it.
 *
 * A row tinted to match its severity turns a list of warnings into one warning band, and leaves
 * the reader no calm ground to scan.
 */
const ANNOTATION_STYLE_TONE = {
  default: 'text-tag-neutral-icon',
  info: 'text-tag-blue-icon',
  success: 'text-tag-success-icon',
  warning: 'text-tag-warning-icon',
  error: 'text-tag-error-icon',
} as const satisfies Record<AnnotationStyleDto, string>;

/** Severity is carried by a colored glyph, which a screen reader cannot see. */
const ANNOTATION_STYLE_LABEL = {
  default: null,
  info: 'Info',
  success: 'Success',
  warning: 'Warning',
  error: 'Error',
} as const satisfies Record<AnnotationStyleDto, string | null>;

/**
 * Cuts Markdown source at a line boundary.
 *
 * Only the line boundary needs handling: a mid-line cut can split a link or inline code and
 * render the fragment as literal text. An unterminated fence needs no repair, because
 * CommonMark closes an open fence at the end of the document, so the preview renders it as a
 * code block either way.
 */
function collapsedPreview(body: string): string {
  const preview = body.slice(0, MAX_COLLAPSED_BODY_CHARS);
  const lastLineBreak = preview.lastIndexOf('\n');
  return lastLineBreak === -1 ? '' : preview.slice(0, lastLineBreak);
}

/**
 * Prose measure for the body. Tables and code fences opt out: they are scanned column-wise and
 * want the width, while a 150-character paragraph is simply hard to read.
 */
const BODY_MEASURE =
  '[&>p]:max-w-[75ch] [&>ul]:max-w-[75ch] [&>ol]:max-w-[75ch] [&>blockquote]:max-w-[75ch] [&>h1]:max-w-[75ch] [&>h2]:max-w-[75ch] [&>h3]:max-w-[75ch] [&>h4]:max-w-[75ch]';

/**
 * Fades the clipped body into whatever is behind it.
 *
 * A mask rather than a gradient overlay because the card draws no surface of its own: the row
 * behind it belongs to the caller, so there is no color here to fade a painted overlay to.
 */
const BODY_CLAMP_FADE =
  '[mask-image:linear-gradient(to_bottom,#000_calc(100%_-_48px),transparent)]';

type AnnotationCardProps = {
  style: AnnotationStyleDto;
  body: string;
  /** The row's heading, which is the job the annotation came from. */
  title?: string | undefined;
  /** Heading element for the title. Callers own the document outline. */
  titleAs?: 'h2' | 'h3' | 'h4' | undefined;
  /** Where the annotation came from, rendered under the title. */
  provenance?: ReactNode | undefined;
  /** A single action, such as a link back to the emitting step. */
  action?: ReactNode | undefined;
  maxBodyHeight?: number | undefined;
};

/**
 * One annotation's content: severity glyph, heading, provenance, and body.
 *
 * It renders no frame of its own. The list it belongs to owns the row padding and the hairline
 * that separates one annotation from the next, because a bordered tile inside the annotations
 * panel would be two frames around one thing.
 *
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
  const styleLabel = ANNOTATION_STYLE_LABEL[style];

  return (
    <div className="flex min-w-0 flex-1 gap-cluster">
      {styleLabel ? <span className="sr-only">{styleLabel}: </span> : null}
      <Icon
        data-slot="annotation-style-icon"
        name={ANNOTATION_STYLE_ICON[style]}
        size={16}
        aria-hidden="true"
        // Optically centered on the 20px line box of the title beside it, not on the column.
        className={cn('mt-2 shrink-0', ANNOTATION_STYLE_TONE[style])}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-inline">
        {hasHeader ? (
          <div className="flex min-w-0 items-start justify-between gap-cluster">
            <div className="flex min-w-0 flex-col gap-tight">
              {title ? (
                <TitleTag className="min-w-0 break-words text-sm font-medium leading-20 text-foreground-neutral-base">
                  {title}
                </TitleTag>
              ) : null}
              {provenance}
            </div>
            {action ? <div className="shrink-0">{action}</div> : null}
          </div>
        ) : null}

        {hasBody ? (
          <div className="flex min-w-0 flex-col gap-tight">
            <div
              id={bodyId}
              className={cn(
                'relative min-w-0',
                collapsed && 'overflow-hidden',
                collapsed && disclosable && BODY_CLAMP_FADE,
              )}
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
      </div>
    </div>
  );
}

export {
  ANNOTATION_STYLE_ICON,
  ANNOTATION_STYLE_TONE,
  AnnotationCard,
  type AnnotationCardProps,
  DEFAULT_MAX_BODY_HEIGHT,
};
