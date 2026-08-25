export {
  BINARY_ENVELOPE_OVERHEAD_BYTES,
  type BinaryEnvelopeOpenParams,
  decodeBase64Key,
  type EnvelopeSealParams,
  openEnvelopeBinary,
  openEnvelopeText,
  sealEnvelopeBinary,
  sealEnvelopeText,
  type TextEnvelopeOpenParams,
} from './crypto.js';
export {
  type DataKeyAccessOutcome,
  DataKeyManager,
  type DataKeyRecord,
  type DataKeyRepository,
  type PlaintextDataKey,
} from './dek-manager.js';
export {
  DataKeyUnwrapError,
  DataKeyVersionStrandedError,
  DataKeyWrapError,
  EnvelopeDecryptionError,
  KeyConfigurationError,
} from './errors.js';
export {
  createLocalKeyProvider,
  deriveLocalKeyVersion,
  type EnvelopeKeyProvider,
  type LocalKeyProviderParams,
  type WrappedDataKey,
} from './key-provider.js';
export {
  type DataKeyRotationRepository,
  type RotatableDataKeyRecord,
  type RotateDataKeysResult,
  rotateDataKeys,
} from './rotation.js';
