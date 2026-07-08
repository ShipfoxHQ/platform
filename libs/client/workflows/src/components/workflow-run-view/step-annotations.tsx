import {Text} from '@shipfox/react-ui/typography';
import {useMemo} from 'react';
import {type RunAnnotation, selectStepAnnotations} from '#core/run-annotation.js';
import {AnnotationCardBlock} from './annotation-card-block.js';

export function StepAnnotations({
  annotations,
  stepId,
  attempt,
}: {
  annotations: readonly RunAnnotation[];
  stepId: string;
  attempt: number;
}) {
  const stepAnnotations = useMemo(
    () => selectStepAnnotations(annotations, {stepId, attempt}),
    [annotations, stepId, attempt],
  );

  if (stepAnnotations.length === 0) return null;

  return (
    <section aria-label="Step annotations" className="flex flex-col gap-8">
      <Text as="h2" size="sm" bold className="text-foreground-neutral-base">
        Step annotations
      </Text>
      <div className="flex min-w-0 flex-col gap-8">
        {stepAnnotations.map((annotation) => (
          <AnnotationCardBlock key={annotation.id} annotation={annotation} />
        ))}
      </div>
    </section>
  );
}
