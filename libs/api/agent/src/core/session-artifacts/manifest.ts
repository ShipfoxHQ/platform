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
  return {
    [METADATA_KEYS.harness]: manifest.harness,
    [METADATA_KEYS.sdkVersion]: manifest.sdkVersion,
    [METADATA_KEYS.model]: manifest.model,
    [METADATA_KEYS.provider]: manifest.provider,
    [METADATA_KEYS.committedByStepAttempt]: manifest.committedByStepAttempt,
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
