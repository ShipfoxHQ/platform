import {config} from '#config.js';
import type {AgentSession} from '#core/entities/agent-session.js';
import {type CommitSessionHeadResult, commitSessionHead, getSessionById} from '#db/index.js';
import {sessionCommitsCount, sessionCommittedBytes} from '#metrics/instance.js';
import {AgentSessionUnavailableError} from '../errors.js';
import {aadForSessionObject, openSessionBlob, sealSessionBlob} from './crypto.js';
import type {SessionDekManager} from './dek-manager.js';
import {
  type SegmentManifest,
  segmentManifestFromMetadata,
  segmentManifestToMetadata,
} from './manifest.js';
import {parseSessionObjectKey, sessionObjectKey} from './object-key.js';
import {
  deleteSessionObject,
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
   * through the B1 CAS. Before any upload, the caller's claim and base segment
   * are verified against the live row, so a stale-base or claim-less write never
   * touches the object store: a retry of the caller's own landed commit is acked
   * without rewriting (objects stay immutable), and every other combination is
   * `conflict` with nothing written. The B1 CAS remains the authoritative guard;
   * the pre-check only keeps unreferenced bytes out of the bucket.
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
   * a carried-over row (which points at another run attempt's prefix).
   */
  deleteSessionObjects(session: AgentSession): Promise<void>;
}

function sessionPrefix(session: AgentSession): string {
  return `${config.AGENT_SESSION_STORAGE_S3_PREFIX}/${session.workspaceId}/${session.workflowRunAttemptId}/${session.id}`;
}

export function createSessionArtifactStore(params: {
  dekManager: SessionDekManager;
}): SessionArtifactStore {
  return {
    async putSegment({session, segment, blob, manifest}) {
      if (blob.length > config.AGENT_SESSION_BLOB_CAP_BYTES) {
        throw new AgentSessionUnavailableError('blob_cap_exceeded');
      }

      const dek = await params.dekManager.getPlaintextDek(session.workspaceId);
      const sealed = sealSessionBlob({
        key: dek,
        plaintext: blob,
        aad: aadForSessionObject({
          workspaceId: session.workspaceId,
          sessionId: session.id,
          segment,
        }),
      });

      const objectKey = sessionObjectKey(config.AGENT_SESSION_STORAGE_S3_PREFIX, {
        workspaceId: session.workspaceId,
        workflowRunAttemptId: session.workflowRunAttemptId,
        sessionId: session.id,
        segment,
      });

      await putSessionObject({
        key: objectKey,
        body: sealed,
        metadata: segmentManifestToMetadata(manifest),
      });

      return {objectKey, sizeBytes: blob.length};
    },

    async commitSegment({session, stepAttemptId, baseSegment, blob, manifest, headRepoRef}) {
      const segment = baseSegment + 1;

      // Pre-check against the live row, before any upload: while the caller holds
      // the claim, only its own commits can move the head, so this read is stable
      // for the duration of the request. A retry of the caller's own landed
      // commit is acked without rewriting; anything else conflicts without
      // writing, keeping every existing object immutable.
      const current = await getSessionById(session.id);
      if (current === null) return {outcome: 'conflict', session: null};
      if (current.headSegment === segment && current.headCommittedByAttempt === stepAttemptId) {
        sessionCommitsCount.add(1, {outcome: 'retry_acked'});
        return {outcome: 'retry-acked', session: current};
      }
      if (current.claimedByStepAttempt !== stepAttemptId || current.headSegment !== baseSegment) {
        sessionCommitsCount.add(1, {outcome: 'conflict'});
        return {outcome: 'conflict', session: current};
      }

      const put = await this.putSegment({session: current, segment, blob, manifest});

      const result = await commitSessionHead({
        sessionId: session.id,
        stepAttemptId,
        baseSegment,
        headObjectKey: put.objectKey,
        headSizeBytes: put.sizeBytes,
        headRepoRef,
      });

      sessionCommitsCount.add(1, {
        outcome:
          result.outcome === 'committed'
            ? 'committed'
            : result.outcome === 'retry-acked'
              ? 'retry_acked'
              : 'conflict',
      });
      if (result.outcome === 'committed') {
        sessionCommittedBytes.record(put.sizeBytes);
      }
      return result;
    },

    async readHeadSegment(session) {
      if (session.headObjectKey === null || session.headSegment === 0) return null;

      const object = await getSessionObject(session.headObjectKey);
      if (object === null) {
        throw new AgentSessionUnavailableError('object_missing');
      }

      const dek = await params.dekManager.getPlaintextDek(session.workspaceId);
      // The AAD binds the session that WROTE the object. A carried-over row's
      // head points into the source session's prefix, so the session id comes
      // from the key, not the row.
      const keySessionId = parseSessionObjectKey(session.headObjectKey)?.sessionId;
      const blob = openSessionBlob({
        key: dek,
        sealed: object.body,
        aad: aadForSessionObject({
          workspaceId: session.workspaceId,
          sessionId: keySessionId ?? session.id,
          segment: session.headSegment,
        }),
      });

      return {blob, manifest: segmentManifestFromMetadata(object.metadata)};
    },

    async deleteSessionObjects(session) {
      const prefix = sessionPrefix(session);
      const keys = await listSessionObjectKeys(prefix);
      if (keys.length > 0) await deleteSessionObjects(keys);

      // Carried-over rows point at the source run attempt's prefix; the exact
      // head key must be removed here because the source prefix is not ours.
      if (
        session.headObjectKey !== null &&
        !session.headObjectKey.startsWith(`${prefix}/`) &&
        !keys.includes(session.headObjectKey)
      ) {
        await deleteSessionObject(session.headObjectKey);
      }
    },
  };
}
