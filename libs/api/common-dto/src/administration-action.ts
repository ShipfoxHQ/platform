import {z} from 'zod';

const CONTROL_OR_FORMAT_CHARACTER_RE = /[\p{Cc}\p{Cf}]/u;
const safeIdentifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9._-]*$/u);

const safeReasonSchema = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => !CONTROL_OR_FORMAT_CHARACTER_RE.test(value), {
    message: 'must not contain control or format characters',
  });

const idempotencyKeyFingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/u);

export const ADMINISTRATION_ACTION_PERFORMED = 'administration.action.performed' as const;

export const ADMINISTRATION_ROLES = ['admin-observer', 'admin-operator', 'admin-owner'] as const;

export const administrationRoleSchema = z.enum(ADMINISTRATION_ROLES);
export type AdministrationRole = z.infer<typeof administrationRoleSchema>;

export const administrationActionResultSchema = z.enum(['succeeded', 'failed']);
export type AdministrationActionResult = z.infer<typeof administrationActionResultSchema>;

/**
 * The redacted event shared by source-available administration producers.
 * Strict parsing keeps producer mistakes from adding secrets, raw tokens, or
 * unbounded payloads to the event contract.
 */
export const administrationActionEventSchema = z
  .object({
    actorId: z.string().uuid(),
    actorRole: administrationRoleSchema,
    requiredRole: administrationRoleSchema,
    command: safeIdentifierSchema,
    targetType: safeIdentifierSchema,
    targetId: z.string().min(1).max(255),
    reason: safeReasonSchema,
    result: administrationActionResultSchema,
    correlationId: z.string().min(1).max(255),
    idempotencyKeyFingerprint: idempotencyKeyFingerprintSchema,
    occurredAt: z.string().datetime({offset: true}),
  })
  .strict();

export type AdministrationActionEvent = z.infer<typeof administrationActionEventSchema>;

export interface CreateAdministrationActionEventInput {
  actorId: string;
  actorRole: AdministrationRole;
  requiredRole: AdministrationRole;
  command: string;
  targetType: string;
  targetId: string;
  reason: string;
  result: AdministrationActionResult;
  correlationId: string;
  idempotencyKeyFingerprint: string;
  occurredAt: string;
}

/** Validates an event before a producer writes it through its transaction. */
export function createAdministrationActionEvent(
  input: CreateAdministrationActionEventInput,
): AdministrationActionEvent {
  return administrationActionEventSchema.parse(input);
}

/** Creates deterministic safe data for producer contract and outbox tests. */
export function createAdministrationActionEventFixture(
  overrides: Partial<CreateAdministrationActionEventInput> = {},
): AdministrationActionEvent {
  return createAdministrationActionEvent({
    actorId: '9b11d65a-f7e7-40ea-b421-06af012a9be5',
    actorRole: 'admin-operator',
    requiredRole: 'admin-operator',
    command: 'auth.user.suspend',
    targetType: 'user',
    targetId: 'c0a8012e-0b6d-4d8f-8d5c-6d74102602b0',
    reason: 'Requested by the support operator',
    result: 'succeeded',
    correlationId: 'request-123',
    idempotencyKeyFingerprint: 'a'.repeat(64),
    occurredAt: '2026-07-26T12:00:00.000Z',
    ...overrides,
  });
}

export interface AdministrationActionEventMap {
  [ADMINISTRATION_ACTION_PERFORMED]: AdministrationActionEvent;
}

export const administrationActionEventSchemas = {
  [ADMINISTRATION_ACTION_PERFORMED]: administrationActionEventSchema,
} satisfies Record<keyof AdministrationActionEventMap, z.ZodType>;
