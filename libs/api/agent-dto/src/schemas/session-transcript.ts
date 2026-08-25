import {z} from 'zod';

/**
 * Resolved session identity handed to workflows dispatch: which registry row
 * the step runs against, in which mode, and which head segment it loads.
 * `segment` is the current head segment (0 = fresh session). The dispatch
 * payload embeds it so the runner knows to fetch before invoking the harness
 * and to upload before reporting; the lease-authed transcript routes resolve
 * the same descriptor back from the recorded step attempt config.
 */
export const agentSessionDescriptorSchema = z.object({
  id: z.string().uuid(),
  key: z.string().min(1),
  mode: z.enum(['resume', 'fork']),
  segment: z.number().int().nonnegative(),
});

export type AgentSessionDescriptorDto = z.infer<typeof agentSessionDescriptorSchema>;

/**
 * Lease-authed session transcript transport contract, mirroring the logs
 * append contract: the runner talks to the agent module's routes over the
 * job-lease token, and the DTO package carries the wire schemas so the runner
 * client and the server routes share one contract.
 */

/** Content type of a session transcript body: the raw, still-gzipped harness session file. */
export const SESSION_TRANSCRIPT_CONTENT_TYPE = 'application/octet-stream' as const;

/**
 * Response headers carrying the head-snapshot manifest on the lease-authed
 * GET, so the runner learns the loaded segment, the pinned harness, and the
 * harness-native session id without parsing the gzipped blob.
 */
export const SESSION_TRANSCRIPT_SEGMENT_HEADER = 'x-session-segment' as const;
export const SESSION_TRANSCRIPT_HARNESS_HEADER = 'x-session-harness' as const;

/**
 * Request headers carrying the segment manifest inputs on the lease-authed
 * POST. The runner is the only authority on the harness SDK version, the
 * model/provider actually used by the invocation, and the harness-native
 * session id, so the commit route reads them here rather than guessing from
 * dispatch-time state. `x-session-harness-session-id` is optional; when the
 * runner reports it, the server persists it on the session row when the head
 * flips so the GET can serve it back.
 */
export const SESSION_TRANSCRIPT_SDK_VERSION_HEADER = 'x-session-sdk-version' as const;
export const SESSION_TRANSCRIPT_MODEL_HEADER = 'x-session-model' as const;
export const SESSION_TRANSCRIPT_PROVIDER_HEADER = 'x-session-provider' as const;
export const SESSION_TRANSCRIPT_HARNESS_SESSION_ID_HEADER = 'x-session-harness-session-id' as const;

/** GET query: the step attempt whose session head snapshot is being loaded. */
export const sessionTranscriptQuerySchema = z.object({
  attempt: z.coerce
    .number()
    .int()
    .min(1)
    .max(2_147_483_647)
    .describe('Attempt number of the step whose session transcript is being read.'),
});

export type SessionTranscriptQueryDto = z.infer<typeof sessionTranscriptQuerySchema>;

/**
 * POST query: `base_segment` is the head segment the runner loaded (the CAS
 * token); the commit writes `base_segment + 1` and flips the head. The max is
 * one below the int4 head_segment column's max, because the commit computes
 * `base_segment + 1` before storing it: a schema-accepted base must always
 * land.
 */
export const commitSessionTranscriptQuerySchema = sessionTranscriptQuerySchema.extend({
  base_segment: z.coerce
    .number()
    .int()
    .min(0)
    .max(2_147_483_646)
    .describe(
      'Head segment the caller loaded (0 = fresh session). The commit applies only when it equals the current head; otherwise the server returns 409.',
    ),
});

export type CommitSessionTranscriptQueryDto = z.infer<typeof commitSessionTranscriptQuerySchema>;

export const commitSessionTranscriptResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('committed'),
    segment: z
      .number()
      .int()
      .min(1)
      .describe('New head segment (`base_segment + 1`) this commit advanced the session to.'),
  }),
  z.object({
    status: z.literal('retry-acked'),
    segment: z
      .number()
      .int()
      .min(1)
      .describe(
        'Head segment already committed by this attempt on a previous POST; nothing was rewritten.',
      ),
  }),
]);

export type CommitSessionTranscriptResponseDto = z.infer<
  typeof commitSessionTranscriptResponseSchema
>;

/** Body of the 409 returned when a commit cannot land: no claim, stale base, or a superseded attempt. */
export const sessionCommitConflictResponseSchema = z.object({
  code: z.literal('session-commit-conflict'),
  details: z.object({
    head_segment: z
      .number()
      .int()
      .min(0)
      .describe('Current head segment the caller must reload before committing again.'),
  }),
});

export type SessionCommitConflictResponseDto = z.infer<typeof sessionCommitConflictResponseSchema>;
