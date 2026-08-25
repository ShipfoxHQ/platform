import {AnnotationCard} from '@shipfox/client-ui';
import {Button} from '@shipfox/react-ui/button';
import {Icon} from '@shipfox/react-ui/icon';
import {PanelRow} from '@shipfox/react-ui/panel';
import {Text} from '@shipfox/react-ui/typography';
import {Link} from '@tanstack/react-router';
import type {ReactNode} from 'react';
import type {RunAnnotationEntry, RunAnnotationStyle} from '#core/run-annotation.js';
import {workflowJobSearchParams} from '#routes/inputs.js';

/**
 * Annotations are cells inside the run's annotations panel, separated by the panel's own
 * hairlines. `items-start` because a row holds a block of Markdown rather than a single line,
 * and the row hover fill is cancelled because the row is not itself a target: the only thing to
 * open is the button inside it.
 */
const ANNOTATION_ROW_CLASS =
  'items-start justify-start gap-cluster hover:bg-background-neutral-base';

/**
 * The server mints `failure:step:<uuid>` and `failure:job:<uuid>` for annotations it derives
 * from a failure. Those are routing keys, not something a reader named, and the row already
 * links to the step they point at.
 */
const GENERATED_CONTEXT = /^failure:(?:job|step):/;

export interface RunAnnotationItemProps {
  entry: RunAnnotationEntry;
  workspaceSlug?: string | undefined;
  projectSlug?: string | undefined;
  workflowRunId: string;
  runAttempt?: number | undefined;
}

/**
 * One annotation, and the only place in the product that renders an annotation body.
 *
 * The heading answers "what is this", which is the block the emitting step named when it chose
 * one, and the job that produced it otherwise. Everything below it exists so a reader can get
 * from a diagnostic back to its cause.
 */
export function RunAnnotationItem({
  entry,
  workspaceSlug,
  projectSlug,
  workflowRunId,
  runAttempt,
}: RunAnnotationItemProps) {
  const {annotation, origin} = entry;
  const canLink = Boolean(origin && workspaceSlug && projectSlug);
  const namedContext = GENERATED_CONTEXT.test(annotation.context) ? null : annotation.context;
  const title = namedContext ?? entry.jobName ?? annotation.context;

  return (
    <AnnotationRow>
      <AnnotationCard
        style={annotation.style}
        title={title}
        titleAs="h3"
        provenance={<RunAnnotationProvenance entry={entry} showJobName={Boolean(namedContext)} />}
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
    </AnnotationRow>
  );
}

export interface RunDerivedAnnotationItemProps {
  style: RunAnnotationStyle;
  jobName: string;
  body: string;
}

/**
 * A terminal job that never created an execution record.
 *
 * It has no step to link to and no context of its own, so it is titled by its job and says
 * plainly that no execution exists. It renders in the same row as every other annotation, since
 * a job that failed before it started is a diagnostic like any other, and often the first one
 * worth reading.
 */
export function RunDerivedAnnotationItem({style, jobName, body}: RunDerivedAnnotationItemProps) {
  return (
    <AnnotationRow>
      <AnnotationCard
        style={style}
        title={jobName}
        titleAs="h3"
        provenance={
          <Text
            as="p"
            size="xs"
            className="min-w-0 truncate font-code text-foreground-neutral-subtle"
          >
            no execution recorded
          </Text>
        }
        body={body}
      />
    </AnnotationRow>
  );
}

function AnnotationRow({children}: {children: ReactNode}) {
  return (
    <PanelRow asChild className={ANNOTATION_ROW_CLASS}>
      <li>{children}</li>
    </PanelRow>
  );
}

/**
 * `execution #2 · run tests · attempt 1`, dropping any part the run no longer resolves.
 *
 * Held to one line. A step with no `name` is labelled by its prompt, which arrives already cut
 * by the server, and letting that sprawl over three wrapped lines presents a severed sentence as
 * if it were a complete label. Truncating says the value was cut; the title attribute returns
 * the rest.
 */
function RunAnnotationProvenance({
  entry,
  showJobName,
}: {
  entry: RunAnnotationEntry;
  showJobName: boolean;
}) {
  const parts = [
    showJobName ? entry.jobName : null,
    entry.executionLabel,
    entry.stepLabel,
    entry.attemptLabel,
  ].filter((part): part is string => Boolean(part));

  if (parts.length === 0) return null;

  const label = parts.join(' · ');

  return (
    <Text
      as="p"
      size="xs"
      title={label}
      className="min-w-0 truncate font-code text-foreground-neutral-subtle"
    >
      {label}
    </Text>
  );
}
