import {z} from 'zod';

// Mirror the integrations inter-module ref predicate: control characters must
// be rejected at the HTTP boundary so they cannot surface as an inter-module
// input validation failure. The branch/tag grammar (no raw SHAs, no
// `refs/pull/`) is enforced by the ref resolution pipeline, which answers
// `ref-invalid`.
function isSafeRefInput(value: string): boolean {
  return [...value].every((character) => {
    const code = character.codePointAt(0) ?? 0;
    return !(code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029);
  });
}

export const createDevRunBodySchema = z
  .object({
    project_id: z.string().uuid(),
    // A branch or tag name in the project repository. Raw commit SHAs and
    // pull-request refs are rejected by the ref resolution pipeline.
    ref: z.string().min(1).max(256).refine(isSafeRefInput, 'Ref contains a control character'),
    // The commit the ref resolved to when the picker listed the file; a
    // mismatch answers 409 `ref-moved`.
    commit: z
      .string()
      .regex(/^[0-9a-f]{40}$/, 'Commit must be a 40-character hex sha')
      .optional(),
    config_path: z
      .string()
      .min(1)
      .max(1024)
      .refine(isSafeRefInput, 'Config path contains a control character'),
    // Trigger key in the resolved workflow file's `triggers` map.
    trigger: z.string().min(1),
    // Manual triggers only; rejected with `inputs-not-allowed` for cron and
    // integration triggers.
    inputs: z.record(z.string(), z.unknown()).optional(),
    // Integration triggers only; the journaled event to replay. Missing for an
    // integration source answers 422 `replay-event-required`.
    replay_event_id: z.string().uuid().optional(),
  })
  .strict();

export type CreateDevRunBodyDto = z.infer<typeof createDevRunBodySchema>;

export const createDevRunResponseSchema = z
  .object({
    workflow_run_id: z.string().uuid(),
    commit: z.string(),
  })
  .strict();

export type CreateDevRunResponseDto = z.infer<typeof createDevRunResponseSchema>;
