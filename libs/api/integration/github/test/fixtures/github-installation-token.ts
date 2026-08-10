const JWT_SEGMENT_LENGTH = 169;

export const GITHUB_STATELESS_INSTALLATION_TOKEN =
  `ghs_123456_${'a'.repeat(JWT_SEGMENT_LENGTH)}` +
  `.${'b'.repeat(JWT_SEGMENT_LENGTH)}` +
  `.${'c'.repeat(JWT_SEGMENT_LENGTH)}`;

export const GITHUB_STATEFUL_INSTALLATION_TOKEN = `ghs_${'d'.repeat(36)}`;
