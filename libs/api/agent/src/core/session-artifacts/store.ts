import {eq, sql} from 'drizzle-orm';
import {config} from '#config.js';
import type {AgentSession} from '#core/entities/agent-session.js';
import {type CommitSessionHeadResult, commitSessionHead, db, sessions} from '#db/index.js';
import {toAgentSession} from '#db/schema/sessions.js';
import {
  type SessionCommitOutcome,
  sessionCommitsCount,
  sessionCommittedBytes,
  sessionLoadFailureCount,
} from '#metrics/instance.js';
import {AgentSessionUnavailableError} from '../errors.js';
import {aadForSessionObject, openSessionBlob, sealSessionBlob} from './crypto.js';
import type {SessionDekManager} from './dek-manager.js';
import {deletableSessionObjectKeys} from './deletable-object-keys.js';
import {
  type SegmentManifest,
  segmentManifestFromMetadata,
  segmentManifestToMetadata,
} from './manifest.js';
import {parseSessionObjectKey, sessionObjectKey} from './object-key.js';
import {
  deleteSessionObjects,
  getSessionObject,
  listSessionObjectKeys,
  putSessionObject,
} from './object-storage.js';

export interface PutSessionSegmentParams {
  session: AgentSession;
  /** Segment number this object is written at (the committing attempt's base + 1). */
  segment: number;
  /** The complete harness-native session file, gzip-compressed by the runner. */
  blob: Buffer;
  manifest: SegmentManifest;
}

export interface PutSessionSegmentResult {
  objectKey: string;
  /** Compressed (pre-encryption) blob size, stored as `head_size_bytes`. */
  sizeBytes: number;
}

export interface CommitSessionSegmentParams {
  session: AgentSession;
  /** The step attempt reporting the segment; must hold the claim to commit. */
  stepAttemptId: string;
  /** The head segment the caller loaded (the segment being extended). */
  baseSegment: number;
  /** The complete harness-native session file, gzip-compressed by the runner. */
  blob: Buffer;
  manifest: SegmentManifest;
  /**
   * Harness-native session id reported by the runner for this commit. Stored on
   * the row when the head flips so the lease-authed GET can serve it back;
   * undefined preserves the row's existing value (no report from the runner).
   */
  harnessSessionId?: string | undefined;
  /** Checkout ref the segment ran on (preamble/audit metadata). */
  headRepoRef: string | null;
}

export interface ReadSessionHeadResult {
  /** The decrypted, still-gzipped harness-native session file. */
  blob: Buffer;
  manifest: SegmentManifest;
}

export interface SessionArtifactStore {
  /**
   * Writes one immutable transcript object: cap check, envelope encryption,
   * and upload. The head flip is a separate step (`commitSegment`) so a crash
   * between write and flip leaves an orphan the retention sweep collects.
   */
  putSegment(params: PutSessionSegmentParams): Promise<PutSessionSegmentResult>;
  /**
   * The B4 commit path: writes segment `baseSegment + 1` and advances the head
   * through the B1 CAS. The whole commit runs under the session row lock, so
   * the claim/base verification is authoritative (not a pre-check): the
   * request that wins the lock uploads exactly once and flips the head; every
   * concurrent duplicate of the same attempt re-reads the landed commit under
   * the same lock and is acked as a retry without ever touching the object
   * store, so an immutable object key is never re-uploaded or overwritten.
   */
  commitSegment(params: CommitSessionSegmentParams): Promise<CommitSessionHeadResult>;
  /**
   * Reads and decrypts the session's head object for a lease-authed GET. The
   * blob is returned still-gzipped with its manifest; null when the session has
   * no head yet.
   */
  readHeadSegment(session: AgentSession): Promise<ReadSessionHeadResult | null>;
  /**
   * Deletes every object under the session's prefix plus the exact head key of
   * a carried-over row (which points at another run attempt's prefix). The
   * head object is kept while another session row still references it,
   * mirroring the retention sweep's carried-over guard.
   */
  deleteSessionObjects(session: AgentSession): Promise<void>;
}

function sessionPrefix(session: AgentSession): string {
  return `${config.AGENT_SESSION_STORAGE_S3_PREFIX}/${session.workspaceId}/${session.workflowRunAttemptId}/${session.id}`;
}

export function createSessionArtifactStore(params: {
  dekManager: SessionDekManager;
}): SessionArtifactStore {
  const sealAndPut = async (
    input: PutSessionSegmentParams & {dek: Buffer},
  ): Promise<PutSessionSegmentResult> => {
    if (input.blob.length > config.AGENT_SESSION_BLOB_CAP_BYTES) {
      throw new AgentSessionUnavailableError('blob_cap_exceeded');
    }

    const sealed = sealSessionBlob({
      key: input.dek,
      plaintext: input.blob,
      aad: aadForSessionObject({
        workspaceId: input.session.workspaceId,
        sessionId: input.session.id,
        segment: input.segment,
      }),
    });

    const objectKey = sessionObjectKey(config.AGENT_SESSION_STORAGE_S3_PREFIX, {
      workspaceId: input.session.workspaceId,
      workflowRunAttemptId: input.session.workflowRunAttemptId,
      sessionId: input.session.id,
      segment: input.segment,
    });

    await putSessionObject({
      key: objectKey,
      body: sealed,
      metadata: segmentManifestToMetadata(input.manifest),
    });

    return {objectKey, sizeBytes: input.blob.length};
  };

  return {
    async putSegment({session, segment, blob, manifest}) {
      return sealAndPut({
        session,
        segment,
        blob,
        manifest,
        dek: await params.dekManager.getPlaintextDek(session.workspaceId),
      });
    },

    async commitSegment({
      session,
      stepAttemptId,
      baseSegment,
      blob,
      manifest,
      harnessSessionId,
      headRepoRef,
    }) {
      const segment = baseSegment + 1;

      // Resolve the workspace DEK before opening the commit transaction:
      // `getPlaintextDek` may read or create the data-key row through the shared
      // pool, which must not happen while the transaction already holds a pooled
      // connection (concurrent first commits for one workspace could exhaust the
      // pool waiting for a second connection).
      const dek = await params.dekManager.getPlaintextDek(session.workspaceId);

      let committedSizeBytes: number | undefined;
      const result = await db().transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(sessions)
          .where(eq(sessions.id, session.id))
          .for('update');
        if (!row) return {outcome: 'conflict', session: null} as const;

        const current = toAgentSession(row);
        if (current.headSegment === segment && current.headCommittedByAttempt === stepAttemptId) {
          return {outcome: 'retry-acked', session: current} as const;
        }
        if (current.claimedByStepAttempt !== stepAttemptId || current.headSegment !== baseSegment) {
          return {outcome: 'conflict', session: current} as const;
        }

        const put = await sealAndPut({session: current, segment, blob, manifest, dek});
        committedSizeBytes = put.sizeBytes;
        return commitSessionHead(
          {
            sessionId: session.id,
            stepAttemptId,
            baseSegment,
            headObjectKey: put.objectKey,
            headSizeBytes: put.sizeBytes,
            harnessSessionId,
            headRepoRef,
          },
          tx,
        );
      });

      let metricOutcome: SessionCommitOutcome = 'conflict';
      if (result.outcome === 'committed') metricOutcome = 'committed';
      else if (result.outcome === 'retry-acked') metricOutcome = 'retry_acked';
      sessionCommitsCount.add(1, {outcome: metricOutcome});
      if (result.outcome === 'committed' && committedSizeBytes !== undefined) {
        sessionCommittedBytes.record(committedSizeBytes);
      }
      return result;
    },

    async readHeadSegment(session) {
      if (session.headObjectKey === null || session.headSegment === 0) return null;

      try {
        const object = await getSessionObject(session.headObjectKey);
        if (object === null) {
          throw new AgentSessionUnavailableError('object_missing');
        }

        const dek = await params.dekManager.getPlaintextDek(session.workspaceId);
        // The AAD binds the session that WROTE the object. A carried-over row's
        // head points into the source session's prefix, so the session id comes
        // from the key, not the row.
        const keySessionId = parseSessionObjectKey(
          session.headObjectKey,
          config.AGENT_SESSION_STORAGE_S3_PREFIX,
        )?.sessionId;
        const blob = openSessionBlob({
          key: dek,
          sealed: object.body,
          aad: aadForSessionObject({
            workspaceId: session.workspaceId,
            sessionId: keySessionId ?? session.id,
            segment: session.headSegment,
          }),
        });

        let manifest: SegmentManifest;
        try {
          manifest = segmentManifestFromMetadata(object.metadata);
        } catch {
          throw new AgentSessionUnavailableError('invalid_manifest');
        }

        return {blob, manifest};
      } catch (error) {
        try {
          sessionLoadFailureCount.add(1, {
            outcome: error instanceof AgentSessionUnavailableError ? error.reason : 'unavailable',
          });
        } catch {
          // Metrics must not change session load outcomes.
        }
        throw error;
      }
    },

    async deleteSessionObjects(session) {
      await db().transaction(async (tx) => {
        // Lock the source row through the reference check and the object
        // deletion, mirroring the retention sweep's `deleteExpiredSession`: a
        // concurrent carry-over (which locks the same source rows) can never
        // copy this head pointer between the check and the deletion.
        const [row] = await tx
          .select({id: sessions.id, headObjectKey: sessions.headObjectKey})
          .from(sessions)
          .where(eq(sessions.id, session.id))
          .for('update');
        if (!row) return;

        if (row.headObjectKey !== null) {
          // Serialize the shared-head ownership decision with concurrent sweeps
          // and store-level deletions, exactly like the retention sweep does.
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${row.headObjectKey}, 0))`,
          );
        }

        const prefix = sessionPrefix(session);
        const keys = await listSessionObjectKeys(prefix);

        // A referenced head belongs to a carried-over rerun and stays until the
        // last row is gone. A head outside this session's prefix is added explicitly.
        const deletable = await deletableSessionObjectKeys(tx, session.id, row.headObjectKey, keys);

        if (deletable.length > 0) await deleteSessionObjects(deletable);
      });
    },
  };
}
