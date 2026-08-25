export class EnvelopeDecryptionError extends Error {
  constructor() {
    super('Envelope could not be decrypted.');
    this.name = 'EnvelopeDecryptionError';
  }
}

export class DataKeyWrapError extends Error {
  constructor() {
    super('Data encryption key could not be wrapped.');
    this.name = 'DataKeyWrapError';
  }
}

export class DataKeyUnwrapError extends Error {
  constructor() {
    super('Data encryption key could not be unwrapped.');
    this.name = 'DataKeyUnwrapError';
  }
}

export class KeyConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeyConfigurationError';
  }
}

export class DataKeyVersionStrandedError extends Error {
  constructor(public readonly keyVersion: string) {
    super(`Data key is stranded on unknown key version: ${keyVersion}`);
    this.name = 'DataKeyVersionStrandedError';
  }
}
