import {createHmac, randomInt, timingSafeEqual} from 'node:crypto';
import {emailSchema} from '@shipfox/api-common-dto';
import {emailChallengeKey} from '@shipfox/node-auth-root-key';
import {renderEmail} from '@shipfox/node-email';
import {mailer} from '@shipfox/node-mailer';
import {and, eq, gt, isNull, lt, sql} from 'drizzle-orm';
import {config} from '#config.js';
import {db, type Tx} from '#db/db.js';
import {challenges} from '#db/schema/challenges.js';
import {sendLimits} from '#db/schema/send-limits.js';
import {recordEmailChallenge} from '#metrics/instance.js';
import {EmailChallengeError} from './errors.js';

const ttlMs = 10 * 60 * 1000;
const ttlMinutes = ttlMs / 60_000;
const resendCooldownMs = 60 * 1000;
const maxSends = 3;
const maxFailedAttempts = 5;
const retentionMs = 24 * 60 * 60 * 1000;
const deliveryRecoveryMs = 30 * 1000;

function digest(domain: string, value: string) {
  return createHmac('sha256', emailChallengeKey()).update(`${domain}:${value}`).digest('hex');
}
function code() {
  return randomInt(0, 100_000_000).toString().padStart(8, '0');
}
function nextHour(now: Date) {
  return new Date(now.getTime() + 60 * 60 * 1000);
}
function nextDay(now: Date) {
  return new Date(now.getTime() + 24 * 60 * 60 * 1000);
}
function equal(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
function terminalUpdate(now: Date) {
  return {
    email: null,
    codeHmac: null,
    continuationHmac: null,
    proofExpiresAt: null,
    terminalAt: now,
  };
}

export interface CreateEmailChallengeParams {
  email: string;
  purpose: string;
  continuation: string;
  idempotencyKey: string;
  sourceIp: string;
}
export interface EmailChallengeHandle {
  id: string;
  expiresAt: Date;
  nextResendAvailableAt: Date;
}

export interface EmailChallengeContinuation {
  expiresAt: Date;
  nextResendAvailableAt: Date;
}

function handle(row: typeof challenges.$inferSelect): EmailChallengeHandle {
  return {
    id: row.id,
    expiresAt: row.expiresAt,
    nextResendAvailableAt: new Date(row.lastSentAt.getTime() + resendCooldownMs),
  };
}

function idempotencyDigest(
  params: Pick<CreateEmailChallengeParams, 'purpose' | 'continuation' | 'idempotencyKey'>,
) {
  return digest(
    'idempotency',
    JSON.stringify([params.purpose, params.continuation, params.idempotencyKey]),
  );
}

async function recordDeliveryOutcome(
  id: string,
  deliveryAttemptedAt: Date,
  outcome: 'delivered' | 'failed',
) {
  await db()
    .update(challenges)
    .set(
      outcome === 'delivered'
        ? {deliveryState: outcome, deliveredAt: new Date()}
        : {deliveryState: outcome, deliveryFailedAt: new Date()},
    )
    .where(and(eq(challenges.id, id), eq(challenges.deliveryAttemptedAt, deliveryAttemptedAt)));
}

async function consumeLimit(
  tx: Tx,
  scope: string,
  identifier: string,
  limit: number,
  expiresAt: Date,
  now: Date,
) {
  const key = digest(`limit:${scope}`, identifier);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${scope}:${key}`}))`);
  const rows = await tx
    .select()
    .from(sendLimits)
    .where(
      and(
        eq(sendLimits.scope, scope),
        eq(sendLimits.identifierHmac, key),
        gt(sendLimits.expiresAt, now),
      ),
    );
  const count = rows.reduce((total, row) => total + row.count, 0);
  if (count >= limit) {
    const retryAt = rows.reduce(
      (earliest, row) => (row.expiresAt < earliest ? row.expiresAt : earliest),
      rows[0]?.expiresAt ?? expiresAt,
    );
    throw new EmailChallengeError(
      'limited',
      'Email challenge delivery is temporarily limited',
      retryAt,
    );
  }
  await tx
    .insert(sendLimits)
    .values({scope, identifierHmac: key, windowStart: now, count: 1, expiresAt});
}

async function consumeSendLimits(tx: Tx, email: string, sourceIp: string, now: Date) {
  await consumeLimit(
    tx,
    'destination-hour',
    email,
    config.EMAIL_CHALLENGE_DESTINATION_HOURLY_LIMIT,
    nextHour(now),
    now,
  );
  await consumeLimit(
    tx,
    'destination-day',
    email,
    config.EMAIL_CHALLENGE_DESTINATION_DAILY_LIMIT,
    nextDay(now),
    now,
  );
  await consumeLimit(
    tx,
    'source-ip-hour',
    sourceIp,
    config.EMAIL_CHALLENGE_SOURCE_IP_HOURLY_LIMIT,
    nextHour(now),
    now,
  );
}

async function deliver(email: string, value: string) {
  const message = await renderEmail('verification-code', {
    verificationCode: value,
    expiresInMinutes: ttlMinutes,
  });
  await mailer.send({to: email, ...message});
}

type ChallengeRow = typeof challenges.$inferSelect;
type CreatedChallenge =
  | {handle: EmailChallengeHandle; deliver: false}
  | {
      handle: EmailChallengeHandle;
      email: string;
      value: string;
      deliveryAttemptedAt: Date;
      deliver: true;
    };

async function recoverExistingChallenge(
  tx: Tx,
  current: ChallengeRow,
  params: CreateEmailChallengeParams,
  now: Date,
): Promise<CreatedChallenge> {
  if (
    !current.email ||
    current.purpose !== params.purpose ||
    !current.continuationHmac ||
    !equal(current.continuationHmac, digest('continuation', params.continuation))
  ) {
    throw new EmailChallengeError('invalid', 'Email challenge is invalid');
  }
  if (current.expiresAt <= now) {
    await tx
      .update(challenges)
      .set({...terminalUpdate(now), invalidatedAt: now})
      .where(eq(challenges.id, current.id));
    throw new EmailChallengeError('expired', 'Email challenge has expired');
  }
  if (current.terminalAt || current.confirmedAt) {
    throw new EmailChallengeError('invalid', 'Email challenge is invalid');
  }
  const deliveryStale =
    current.deliveryState === 'pending' &&
    (!current.deliveryAttemptedAt ||
      current.deliveryAttemptedAt.getTime() + deliveryRecoveryMs <= now.getTime());
  if (current.deliveryState !== 'failed' && !deliveryStale) {
    return {handle: handle(current), deliver: false};
  }
  if (current.sentCount >= maxSends) {
    throw new EmailChallengeError('exhausted', 'Email challenge resends are exhausted');
  }

  const value = code();
  await consumeSendLimits(tx, current.email, params.sourceIp, now);
  const updated = await tx
    .update(challenges)
    .set({
      codeHmac: digest('code', value),
      sentCount: current.sentCount + 1,
      resendCount: current.resendCount + 1,
      lastSentAt: now,
      expiresAt: new Date(now.getTime() + ttlMs),
      deliveryState: 'pending',
      deliveryAttemptedAt: now,
      deliveryFailedAt: null,
    })
    .where(eq(challenges.id, current.id))
    .returning();
  if (!updated[0]) throw new Error('Update returned no email challenge');
  return {
    handle: handle(updated[0]),
    email: current.email,
    value,
    deliveryAttemptedAt: now,
    deliver: true,
  };
}

async function insertEmailChallenge(
  tx: Tx,
  email: string,
  params: CreateEmailChallengeParams,
  idempotencyHmac: string,
  now: Date,
): Promise<CreatedChallenge> {
  const value = code();
  await consumeSendLimits(tx, email, params.sourceIp, now);
  const inserted = await tx
    .insert(challenges)
    .values({
      email,
      purpose: params.purpose,
      continuationHmac: digest('continuation', params.continuation),
      idempotencyHmac,
      codeHmac: digest('code', value),
      expiresAt: new Date(now.getTime() + ttlMs),
      lastSentAt: now,
      deliveryAttemptedAt: now,
    })
    .returning();
  if (!inserted[0]) throw new Error('Insert returned no email challenge');
  return {handle: handle(inserted[0]), email, value, deliveryAttemptedAt: now, deliver: true};
}

export async function createEmailChallenge(
  params: CreateEmailChallengeParams,
): Promise<EmailChallengeHandle> {
  const email = emailSchema.parse(params.email);
  if (!params.purpose || !params.continuation || !params.idempotencyKey)
    throw new EmailChallengeError(
      'invalid',
      'Email challenge purpose, continuation, and idempotency key are required',
    );
  const now = new Date();
  const idempotencyHmac = idempotencyDigest(params);
  try {
    const created = await db().transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`challenge:${idempotencyHmac}`}))`,
      );
      const existing = await tx
        .select()
        .from(challenges)
        .where(and(eq(challenges.idempotencyHmac, idempotencyHmac), isNull(challenges.terminalAt)))
        .limit(1)
        .for('update');
      const current = existing[0];
      if (current) return await recoverExistingChallenge(tx, current, params, now);
      return await insertEmailChallenge(tx, email, params, idempotencyHmac, now);
    });
    if (!created.deliver) return created.handle;
    try {
      await deliver(created.email, created.value);
      await recordDeliveryOutcome(created.handle.id, created.deliveryAttemptedAt, 'delivered');
    } catch (error) {
      await recordDeliveryOutcome(created.handle.id, created.deliveryAttemptedAt, 'failed');
      throw error;
    }
    recordEmailChallenge('send', 'ok');
    return created.handle;
  } catch (error) {
    recordEmailChallenge('send', 'rejected');
    throw error;
  }
}

export async function getEmailChallengeContinuation(params: {
  purpose: string;
  continuation: string;
  idempotencyKey: string;
}): Promise<EmailChallengeContinuation> {
  const now = new Date();
  if (!params.purpose || !params.continuation || !params.idempotencyKey)
    throw new EmailChallengeError('invalid', 'Email challenge is invalid');
  const idempotencyHmac = idempotencyDigest(params);
  const result = await db().transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`challenge:${idempotencyHmac}`}))`,
    );
    const rows = await tx
      .select()
      .from(challenges)
      .where(and(eq(challenges.idempotencyHmac, idempotencyHmac), isNull(challenges.terminalAt)))
      .limit(1)
      .for('update');
    const current = rows[0];
    if (
      !current ||
      current.purpose !== params.purpose ||
      !current.continuationHmac ||
      !equal(current.continuationHmac, digest('continuation', params.continuation)) ||
      current.terminalAt ||
      current.confirmedAt
    )
      return 'invalid' as const;
    if (current.expiresAt <= now) {
      await tx
        .update(challenges)
        .set({...terminalUpdate(now), invalidatedAt: now})
        .where(eq(challenges.id, current.id));
      return 'expired' as const;
    }
    return handle(current);
  });
  if (result === 'expired') throw new EmailChallengeError('expired', 'Email challenge has expired');
  if (result === 'invalid') throw new EmailChallengeError('invalid', 'Email challenge is invalid');
  return {expiresAt: result.expiresAt, nextResendAvailableAt: result.nextResendAvailableAt};
}

export async function resendEmailChallenge(params: {
  id: string;
  continuation: string;
  sourceIp: string;
}): Promise<EmailChallengeHandle> {
  const now = new Date();
  const value = code();
  try {
    const row = await db().transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(challenges)
        .where(eq(challenges.id, params.id))
        .limit(1)
        .for('update');
      const current = rows[0];
      if (
        !current?.email ||
        !current.codeHmac ||
        !current.continuationHmac ||
        !equal(current.continuationHmac, digest('continuation', params.continuation))
      )
        throw new EmailChallengeError('invalid', 'Email challenge is invalid');
      if (current.expiresAt <= now) {
        await tx
          .update(challenges)
          .set({...terminalUpdate(now), invalidatedAt: now})
          .where(eq(challenges.id, current.id));
        throw new EmailChallengeError('expired', 'Email challenge has expired');
      }
      const retryAt = new Date(current.lastSentAt.getTime() + resendCooldownMs);
      if (retryAt > now)
        throw new EmailChallengeError(
          'cooldown',
          'Email challenge resend is cooling down',
          retryAt,
        );
      if (current.sentCount >= maxSends)
        throw new EmailChallengeError('exhausted', 'Email challenge resends are exhausted');
      await consumeSendLimits(tx, current.email, params.sourceIp, now);
      const updated = await tx
        .update(challenges)
        .set({
          codeHmac: digest('code', value),
          sentCount: current.sentCount + 1,
          resendCount: current.resendCount + 1,
          lastSentAt: now,
          expiresAt: new Date(now.getTime() + ttlMs),
          failedAttemptCount: 0,
          deliveryState: 'pending',
          deliveryAttemptedAt: now,
          deliveryFailedAt: null,
        })
        .where(eq(challenges.id, current.id))
        .returning();
      if (!updated[0]) throw new Error('Update returned no email challenge');
      return {challenge: updated[0], email: current.email, deliveryAttemptedAt: now};
    });
    try {
      await deliver(row.email, value);
      await recordDeliveryOutcome(row.challenge.id, row.deliveryAttemptedAt, 'delivered');
    } catch (error) {
      await recordDeliveryOutcome(row.challenge.id, row.deliveryAttemptedAt, 'failed');
      throw error;
    }
    recordEmailChallenge('resend', 'ok');
    return {
      id: row.challenge.id,
      expiresAt: row.challenge.expiresAt,
      nextResendAvailableAt: new Date(now.getTime() + resendCooldownMs),
    };
  } catch (error) {
    recordEmailChallenge('resend', 'rejected');
    throw error;
  }
}

export async function confirmEmailChallenge(params: {
  id: string;
  code: string;
  continuation: string;
}): Promise<{confirmed: true}> {
  const now = new Date();
  try {
    const outcome = await db().transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(challenges)
        .where(eq(challenges.id, params.id))
        .limit(1)
        .for('update');
      const current = rows[0];
      if (
        !current?.continuationHmac ||
        !equal(current.continuationHmac, digest('continuation', params.continuation))
      )
        return 'invalid' as const;
      if (current.confirmedAt) return 'confirmed' as const;
      if (current.expiresAt <= now) {
        await tx
          .update(challenges)
          .set({...terminalUpdate(now), invalidatedAt: now})
          .where(eq(challenges.id, current.id));
        return 'expired' as const;
      }
      if (!current.codeHmac || !equal(current.codeHmac, digest('code', params.code))) {
        return await recordFailedConfirmation(tx, current, now);
      }
      await tx
        .update(challenges)
        .set({confirmedAt: now, proofExpiresAt: current.expiresAt, codeHmac: null})
        .where(eq(challenges.id, current.id));
      return 'confirmed' as const;
    });
    if (outcome === 'expired')
      throw new EmailChallengeError('expired', 'Email challenge has expired');
    if (outcome === 'exhausted')
      throw new EmailChallengeError('exhausted', 'Email challenge code is invalid');
    if (outcome === 'invalid')
      throw new EmailChallengeError('invalid', 'Email challenge is invalid');
    recordEmailChallenge('confirm', 'ok');
    return {confirmed: true};
  } catch (error) {
    recordEmailChallenge('confirm', 'rejected');
    throw error;
  }
}

async function recordFailedConfirmation(
  tx: Tx,
  current: ChallengeRow,
  now: Date,
): Promise<'exhausted' | 'invalid'> {
  const failedAttemptCount = current.failedAttemptCount + 1;
  if (failedAttemptCount >= maxFailedAttempts) {
    await tx
      .update(challenges)
      .set({...terminalUpdate(now), failedAttemptCount, invalidatedAt: now})
      .where(eq(challenges.id, current.id));
    return 'exhausted';
  }
  await tx.update(challenges).set({failedAttemptCount}).where(eq(challenges.id, current.id));
  return 'invalid';
}

export async function consumeEmailChallengeProof(params: {
  id: string;
  purpose: string;
  continuation: string;
}): Promise<{consumed: true; idempotent: boolean}> {
  const now = new Date();
  const continuationHmac = digest('continuation', params.continuation);
  try {
    const result = await db().transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(challenges)
        .where(eq(challenges.id, params.id))
        .limit(1)
        .for('update');
      const current = rows[0];
      if (!current || current.purpose !== params.purpose)
        throw new EmailChallengeError('invalid', 'Email challenge proof is invalid');
      if (current.consumedAt) {
        if (
          current.consumedContinuationHmac &&
          equal(current.consumedContinuationHmac, continuationHmac)
        )
          return true;
        throw new EmailChallengeError('consumed', 'Email challenge proof is already consumed');
      }
      if (
        !current.confirmedAt ||
        !current.proofExpiresAt ||
        current.proofExpiresAt <= now ||
        !current.continuationHmac ||
        !equal(current.continuationHmac, continuationHmac)
      )
        throw new EmailChallengeError('invalid', 'Email challenge proof is invalid');
      await tx
        .update(challenges)
        .set({...terminalUpdate(now), consumedAt: now, consumedContinuationHmac: continuationHmac})
        .where(eq(challenges.id, current.id));
      return false;
    });
    recordEmailChallenge('consume', 'ok');
    return {consumed: true, idempotent: result};
  } catch (error) {
    recordEmailChallenge('consume', 'rejected');
    throw error;
  }
}

export async function cleanupEmailChallenges(now = new Date()): Promise<number> {
  await db()
    .update(challenges)
    .set({...terminalUpdate(now), invalidatedAt: now})
    .where(and(isNull(challenges.terminalAt), lt(challenges.expiresAt, now)));
  const deleted = await db()
    .delete(challenges)
    .where(
      and(
        sql`${challenges.terminalAt} is not null`,
        lt(challenges.terminalAt, new Date(now.getTime() - retentionMs)),
      ),
    );
  await db().delete(sendLimits).where(lt(sendLimits.expiresAt, now));
  return deleted.rowCount ?? 0;
}
