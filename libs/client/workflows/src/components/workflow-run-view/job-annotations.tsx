import {Text} from '@shipfox/react-ui/typography';
import {useMemo} from 'react';
import {type RunAnnotation, selectJobExecutionAnnotations} from '#core/run-annotation.js';
import {AnnotationCardBlock} from './annotation-card-block.js';

export function JobAnnotations({
  annotations,
  jobExecutionId,
}: {
  annotations: readonly RunAnnotation[];
  jobExecutionId: string | undefined;
}) {
  const jobAnnotations = useMemo(
    () => selectJobExecutionAnnotations(annotations, {jobExecutionId}),
    [annotations, jobExecutionId],
  );

  if (jobAnnotations.length === 0) return null;

  return (
    <section aria-label="Job annotations" className="flex flex-col gap-8 px-16 py-12">
      <Text as="h2" size="sm" bold className="text-foreground-neutral-base">
        Job annotations
      </Text>
      <div className="flex min-w-0 flex-col gap-8">
        {jobAnnotations.map((annotation) => (
          <AnnotationCardBlock key={annotation.id} annotation={annotation} />
        ))}
      </div>
    </section>
  );
}
