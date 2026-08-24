import type {Harness} from '@shipfox/api-agent-dto';

/**
 * Segment manifest, recorded on every committed transcript object so drift is
 * auditable: harness, SDK version, model, provider, and the committing step
 * attempt. Stored as S3 user metadata on the object, so the lease-authed GET
 * can return manifest headers without decrypting the still-gzipped blob.
 */
export interface SegmentManifest {
  harness: Harness;
  /** Harness SDK version that produced the transcript. */
  sdkVersion: string;
  model: string;
  provider: string;
  /** Step attempt that committed the segment. */
  committedByStepAttempt: string;
}

const METADATA_KEYS: Record<keyof SegmentManifest, string> = {
  harness: 'harness',
  sdkVersion: 'sdk-version',
  model: 'model',
  provider: 'provider',
  committedByStepAttempt: 'committed-by-step-attempt',
};

export function segmentManifestToMetadata(manifest: SegmentManifest): Record<string, string> {
  // Mirror the read side: an empty field would be written here but rejected by
  // segmentManifestFromMetadata, so reject it at the write boundary instead of
  // persisting metadata this module cannot read back.
  const requireValue = (key: keyof SegmentManifest): string => {
    const value = manifest[key];
    if (value === '') {
      throw new Error(`Session segment manifest ${key} must be non-empty`);
    }
    return value;
  };

  return {
    [METADATA_KEYS.harness]: requireValue('harness'),
    [METADATA_KEYS.sdkVersion]: requireValue('sdkVersion'),
    [METADATA_KEYS.model]: requireValue('model'),
    [METADATA_KEYS.provider]: requireValue('provider'),
    [METADATA_KEYS.committedByStepAttempt]: requireValue('committedByStepAttempt'),
  };
}

export function segmentManifestFromMetadata(metadata: Record<string, string>): SegmentManifest {
  const read = (key: keyof SegmentManifest): string => {
    const value = metadata[METADATA_KEYS[key]];
    if (value === undefined || value === '') {
      throw new Error(`Session segment manifest metadata is missing ${METADATA_KEYS[key]}`);
    }
    return value;
  };

  const harness = read('harness');
  if (harness !== 'pi' && harness !== 'claude') {
    throw new Error(`Session segment manifest metadata has an invalid harness: ${harness}`);
  }

  return {
    harness,
    sdkVersion: read('sdkVersion'),
    model: read('model'),
    provider: read('provider'),
    committedByStepAttempt: read('committedByStepAttempt'),
  };
}
