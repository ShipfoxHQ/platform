import {AnnotationCard} from '@shipfox/client-ui';
import {Button} from '@shipfox/react-ui/button';
import {Icon} from '@shipfox/react-ui/icon';
import {Text} from '@shipfox/react-ui/typography';
import {cn} from '@shipfox/react-ui/utils';
import {Link} from '@tanstack/react-router';
import {useEffect, useRef} from 'react';
import type {RunAnnotationEntry} from '#core/run-annotation.js';
import {workflowJobSearchParams} from '#routes/inputs.js';

export interface RunAnnotationItemProps {
  entry: RunAnnotationEntry;
  workspaceSlug?: string | undefined;
  projectSlug?: string | undefined;
  workflowRunId: string;
  runAttempt?: number | undefined;
  /** Deep-link target from `?annotation=`, which takes focus rather than only being scrolled to. */
  selected?: boolean | undefined;
}

/**
 * One annotation, and the only place in the product that renders an annotation body.
 *
 * The title is the annotation's `context`, which is what the emitting step named the block.
 * Everything below it exists so a reader can get from a diagnostic back to its cause.
 */
export function RunAnnotationItem({
  entry,
  workspaceSlug,
  projectSlug,
  workflowRunId,
  runAttempt,
  selected = false,
}: RunAnnotationItemProps) {
  const {annotation, origin} = entry;
  const canLink = Boolean(origin && workspaceSlug && projectSlug);
  const itemRef = useRef<HTMLLIElement>(null);
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!selected) {
      focusedRef.current = false;
      return;
    }
    if (focusedRef.current) return;

    // A deep link that only scrolls leaves a keyboard or screen-reader user at the document
    // start while the page moves under them.
    focusedRef.current = true;
    itemRef.current?.focus({preventScroll: true});
    itemRef.current?.scrollIntoView({block: 'nearest'});
  }, [selected]);

  return (
    <li
      ref={itemRef}
      tabIndex={-1}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'rounded-8 outline-none focus-visible:shadow-border-interactive-with-active',
        selected && 'shadow-border-interactive-with-active',
      )}
    >
      <AnnotationCard
        id={annotationElementId(annotation.id)}
        style={annotation.style}
        title={annotation.context}
        titleAs="h3"
        provenance={<RunAnnotationProvenance entry={entry} />}
        body={annotation.body}
        action={
          canLink && origin ? (
            <Button
              asChild
              size="xs"
              variant="transparent"
              className="[@media(pointer:coarse)]:min-h-44"
            >
              <Link
                to="/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId/jobs/$jobId"
                params={{
                  workspaceSlug: workspaceSlug ?? '',
                  projectSlug: projectSlug ?? '',
                  workflowRunId,
                  jobId: origin.jobId,
                }}
                search={
                  workflowJobSearchParams({
                    jobExecutionId: origin.jobExecutionId,
                    stepId: origin.stepId,
                    stepAttemptId: origin.stepAttemptId,
                    runAttempt,
                  }) as never
                }
              >
                Open step
                <Icon name="arrowRightLine" size={12} aria-hidden="true" />
              </Link>
            </Button>
          ) : null
        }
      />
    </li>
  );
}

/** `job · execution #2 · run tests · attempt 1`, dropping any part the run no longer resolves. */
function RunAnnotationProvenance({entry}: {entry: RunAnnotationEntry}) {
  const parts = [entry.jobName, entry.executionLabel, entry.stepLabel, entry.attemptLabel].filter(
    (part): part is string => Boolean(part),
  );

  return (
    <Text as="p" size="xs" className="min-w-0 break-words font-code text-foreground-neutral-subtle">
      {parts.join(' · ')}
    </Text>
  );
}

/** Stable element id so `?annotation=<id>` can scroll to and highlight one annotation. */
export function annotationElementId(annotationId: string): string {
  return `run-annotation-${annotationId}`;
}
