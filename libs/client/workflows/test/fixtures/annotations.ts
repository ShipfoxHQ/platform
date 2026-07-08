import type {AnnotationDto, ReadAnnotationsResponseDto} from '@shipfox/annotations-dto';

let annotationSequence = 0;

export function runAnnotationDto(overrides: Partial<AnnotationDto> = {}): AnnotationDto {
  annotationSequence += 1;

  return {
    id: `11111111-1111-4111-8111-${String(annotationSequence).padStart(12, '0')}`,
    job_id: '22222222-2222-4222-8222-222222222222',
    job_execution_id: '33333333-3333-4333-8333-333333333333',
    origin_step_id: '44444444-4444-4444-8444-444444444444',
    origin_step_attempt: 1,
    context: 'summary',
    style: 'default',
    sequence: annotationSequence,
    body: 'Annotation body',
    ...overrides,
  };
}

export function readAnnotationsResponseDto(
  annotations: AnnotationDto[],
  overrides: Partial<Omit<ReadAnnotationsResponseDto, 'annotations'>> = {},
): ReadAnnotationsResponseDto {
  return {
    annotations,
    has_more: false,
    next_cursor: null,
    ...overrides,
  };
}
