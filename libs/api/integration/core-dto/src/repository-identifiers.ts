const REPOSITORY_PART_UNSAFE_PATTERN = /[\s/:\\\p{Cc}\p{Cf}]/u;
const EXTERNAL_REPOSITORY_VALUE_UNSAFE_PATTERN = /[\s\p{Cc}\p{Cf}]/u;

export function isSafeRepositoryPart(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length > 0 && !REPOSITORY_PART_UNSAFE_PATTERN.test(value)
  );
}

export function isSafeExternalRepositoryValue(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !EXTERNAL_REPOSITORY_VALUE_UNSAFE_PATTERN.test(value)
  );
}
