import {AnnotationCard} from '@shipfox/client-ui';
import {Button} from '@shipfox/react-ui/button';
import {useState} from 'react';
import type {RunAnnotation} from '#core/run-annotation.js';

const MAX_COLLAPSED_BODY_LENGTH = 10_000;

export function AnnotationCardBlock({annotation}: {annotation: RunAnnotation}) {
  const [expanded, setExpanded] = useState(false);
  if (!annotation.body.trim()) return null;

  const truncated = annotation.body.length > MAX_COLLAPSED_BODY_LENGTH;
  const body =
    truncated && !expanded
      ? `${annotation.body.slice(0, MAX_COLLAPSED_BODY_LENGTH)}\n\n...`
      : annotation.body;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <AnnotationCard style={annotation.style} body={body} />
      {truncated ? (
        <div>
          <Button
            type="button"
            variant="transparentMuted"
            size="2xs"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? 'Show less' : 'Show more'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
