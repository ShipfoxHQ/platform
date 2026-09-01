import {z} from 'zod';
import {
  integrationCapabilitySchema,
  integrationConnectionRepositoryAccessModeSchema,
} from './schemas/integrations.js';

export const INTEGRATION_EVENT_RECEIVED = 'integrations.event.received' as const;
export const INTEGRATION_CONNECTION_AVAILABLE = 'integrations.connection.available' as const;
export const CONNECTION_REPOSITORY_ACCESS_CHANGED =
  'integrations.connection.repository_access_changed' as const;
export const CONNECTION_REPOSITORY_GRANTED = 'integrations.connection.repository_granted' as const;
export const CONNECTION_REPOSITORY_REVOKED = 'integrations.connection.repository_revoked' as const;

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
  // Provider registry capabilities, so subscribers can tell a tool connection
  // from a source-control connection without their own provider table.
  // Defaulting keeps availability events written before this field existed
  // deliverable while every new event is still constrained to known capabilities.
  capabilities: z.array(integrationCapabilitySchema).max(16).default([]),
});
export type IntegrationConnectionAvailableEvent = z.infer<
  typeof integrationConnectionAvailableSchema
>;

const repositoryAccessAuditBaseSchema = z.object({
  actorId: nonEmptyStringSchema.max(255),
  workspaceId: nonEmptyStringSchema.max(255),
  connectionId: nonEmptyStringSchema.max(255),
  provider: nonEmptyStringSchema.max(128),
  correlationId: nonEmptyStringSchema.max(255),
  occurredAt: isoDateTimeSchema,
});

export const connectionRepositoryAccessChangedSchema = repositoryAccessAuditBaseSchema.extend({
  mode: integrationConnectionRepositoryAccessModeSchema,
});
export type ConnectionRepositoryAccessChangedEvent = z.infer<
  typeof connectionRepositoryAccessChangedSchema
>;

const repositoryGrantAuditFields = {
  grantId: nonEmptyStringSchema.max(255),
  externalRepositoryId: nonEmptyStringSchema.max(255),
  repositoryOwner: nonEmptyStringSchema.max(255),
  repositoryName: nonEmptyStringSchema.max(255),
};

export const connectionRepositoryGrantedSchema = repositoryAccessAuditBaseSchema.extend(
  repositoryGrantAuditFields,
);
export type ConnectionRepositoryGrantedEvent = z.infer<typeof connectionRepositoryGrantedSchema>;

export const connectionRepositoryRevokedSchema = repositoryAccessAuditBaseSchema.extend(
  repositoryGrantAuditFields,
);
export type ConnectionRepositoryRevokedEvent = z.infer<typeof connectionRepositoryRevokedSchema>;

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
  [CONNECTION_REPOSITORY_ACCESS_CHANGED]: ConnectionRepositoryAccessChangedEvent;
  [CONNECTION_REPOSITORY_GRANTED]: ConnectionRepositoryGrantedEvent;
  [CONNECTION_REPOSITORY_REVOKED]: ConnectionRepositoryRevokedEvent;
  [INTEGRATION_CONNECTION_AVAILABLE]: IntegrationConnectionAvailableEvent;
  [INTEGRATION_EVENT_RECEIVED]: IntegrationEventReceivedEvent;
  [INTEGRATION_SOURCE_COMMIT_PUSHED]: IntegrationSourceCommitPushedEvent;
  [INTEGRATION_SOURCE_REPOSITORY_UPDATED]: IntegrationSourceRepositoryUpdatedEvent;
}

export const integrationsEventSchemas = {
  [CONNECTION_REPOSITORY_ACCESS_CHANGED]: connectionRepositoryAccessChangedSchema,
  [CONNECTION_REPOSITORY_GRANTED]: connectionRepositoryGrantedSchema,
  [CONNECTION_REPOSITORY_REVOKED]: connectionRepositoryRevokedSchema,
  [INTEGRATION_CONNECTION_AVAILABLE]: integrationConnectionAvailableSchema,
  [INTEGRATION_EVENT_RECEIVED]: integrationEventReceivedSchema,
  [INTEGRATION_SOURCE_COMMIT_PUSHED]: integrationSourceCommitPushedSchema,
  [INTEGRATION_SOURCE_REPOSITORY_UPDATED]: integrationSourceRepositoryUpdatedSchema,
} satisfies Record<keyof IntegrationsEventMap, z.ZodType>;
