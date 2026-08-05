import {z} from 'zod';

export const INTEGRATION_EVENT_RECEIVED = 'integrations.event.received' as const;
export const INTEGRATION_CONNECTION_AVAILABLE = 'integrations.connection.available' as const;

const nonEmptyStringSchema = z.string().nonempty();
const isoDateTimeSchema = z.string().datetime();
const requiredUnknownSchema = z.custom<unknown>((value) => value !== undefined);
const nullableConnectionNameSchema = nonEmptyStringSchema.nullish().default(null);

export const integrationEventReceivedSchema = z.object({
  provider: nonEmptyStringSchema,
  source: nonEmptyStringSchema,
  event: nonEmptyStringSchema,
  workspaceId: nonEmptyStringSchema,
  connectionId: nonEmptyStringSchema,
  // Denormalized so trigger consumers can render the connection name without a
  // synchronous callback into the integrations module.
  connectionName: nullableConnectionNameSchema,
  deliveryId: nonEmptyStringSchema,
  receivedAt: isoDateTimeSchema,
  payload: requiredUnknownSchema,
});
export type IntegrationEventReceivedEvent = z.infer<typeof integrationEventReceivedSchema>;

export const integrationConnectionAvailableSchema = z.object({
  provider: nonEmptyStringSchema,
  workspaceId: nonEmptyStringSchema,
  connectionId: nonEmptyStringSchema,
  slug: nonEmptyStringSchema,
});
export type IntegrationConnectionAvailableEvent = z.infer<
  typeof integrationConnectionAvailableSchema
>;

// A source-control push, normalized by the producing provider and carried by
// `INTEGRATION_SOURCE_COMMIT_PUSHED` for domain consumers.
export const sourcePushSchema = z.object({
  externalRepositoryId: nonEmptyStringSchema,
  ref: nonEmptyStringSchema,
  headCommitSha: nonEmptyStringSchema,
  defaultBranch: nonEmptyStringSchema,
  isDefaultBranch: z.boolean(),
});
export type SourcePushPayload = z.infer<typeof sourcePushSchema>;

export const INTEGRATION_SOURCE_COMMIT_PUSHED =
  'integrations.source_control.commit_pushed' as const;

// Typed, provider-agnostic source-control event. The producing provider owns the
// translation from its raw webhook into this shape, so domain consumers never decode
// provider payloads. `isDefaultBranch` is a fact; the branch policy lives in the consumer.
export const integrationSourceCommitPushedSchema = z.object({
  provider: nonEmptyStringSchema,
  workspaceId: nonEmptyStringSchema,
  connectionId: nonEmptyStringSchema,
  deliveryId: nonEmptyStringSchema,
  receivedAt: isoDateTimeSchema,
  push: sourcePushSchema,
});
export type IntegrationSourceCommitPushedEvent = z.infer<
  typeof integrationSourceCommitPushedSchema
>;

export const sourceRepositoryIdentitySchema = z.object({
  externalRepositoryId: nonEmptyStringSchema,
  owner: nonEmptyStringSchema,
  name: nonEmptyStringSchema,
  defaultBranch: nonEmptyStringSchema,
});
export type SourceRepositoryIdentity = z.infer<typeof sourceRepositoryIdentitySchema>;

export const INTEGRATION_SOURCE_REPOSITORY_UPDATED =
  'integrations.source_control.repository_updated' as const;

// Typed, provider-agnostic source-control event. The producing provider owns the
// translation from its raw webhook into this shape, so domain consumers never decode
// provider payloads.
export const integrationSourceRepositoryUpdatedSchema = z.object({
  provider: nonEmptyStringSchema,
  workspaceId: nonEmptyStringSchema,
  connectionId: nonEmptyStringSchema,
  deliveryId: nonEmptyStringSchema,
  receivedAt: isoDateTimeSchema,
  repository: sourceRepositoryIdentitySchema,
});
export type IntegrationSourceRepositoryUpdatedEvent = z.infer<
  typeof integrationSourceRepositoryUpdatedSchema
>;

export interface SentryIssuePayload {
  action: SentryIssueAction;
  issueId: string;
  shortId: string | null;
  title: string;
  culprit: string | null;
  level: string | null;
  status: string | null;
  platform: string | null;
  webUrl: string | null;
  issueUrl: string | null;
  projectUrl: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
}

// Single source of truth for Sentry issue actions: the sentry-dto webhook schema
// builds its z.enum from this tuple, so accepted webhook actions and the published
// SentryIssuePayload contract cannot drift.
export const SENTRY_ISSUE_ACTIONS = [
  'created',
  'resolved',
  'assigned',
  'archived',
  'unresolved',
] as const;

export type SentryIssueAction = (typeof SENTRY_ISSUE_ACTIONS)[number];

export interface IntegrationsEventMap {
  [INTEGRATION_CONNECTION_AVAILABLE]: IntegrationConnectionAvailableEvent;
  [INTEGRATION_EVENT_RECEIVED]: IntegrationEventReceivedEvent;
  [INTEGRATION_SOURCE_COMMIT_PUSHED]: IntegrationSourceCommitPushedEvent;
  [INTEGRATION_SOURCE_REPOSITORY_UPDATED]: IntegrationSourceRepositoryUpdatedEvent;
}

export const integrationsEventSchemas = {
  [INTEGRATION_CONNECTION_AVAILABLE]: integrationConnectionAvailableSchema,
  [INTEGRATION_EVENT_RECEIVED]: integrationEventReceivedSchema,
  [INTEGRATION_SOURCE_COMMIT_PUSHED]: integrationSourceCommitPushedSchema,
  [INTEGRATION_SOURCE_REPOSITORY_UPDATED]: integrationSourceRepositoryUpdatedSchema,
} satisfies Record<keyof IntegrationsEventMap, z.ZodType>;
