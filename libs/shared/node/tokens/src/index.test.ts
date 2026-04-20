import {
  extractDisplayPrefix,
  generateOpaqueToken,
  getTokenEnvironment,
  getTokenType,
  hashOpaqueToken,
  type TokenType,
  tokenTypeParts,
} from './index.js';

const tokenTypes = Object.keys(tokenTypeParts) as TokenType[];

describe('tokens', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  describe('generateOpaqueToken', () => {
    it('generates a token with the type prefix', () => {
      const token = generateOpaqueToken('apiKey');

      expect(token.startsWith('sf_k_')).toBe(true);
    });

    it('generates a token with consistent length', () => {
      const token = generateOpaqueToken('apiKey');

      expect(token).toHaveLength(48);
    });

    it('generates unique tokens', () => {
      const first = generateOpaqueToken('apiKey');
      const second = generateOpaqueToken('apiKey');

      expect(first).not.toBe(second);
    });

    it.each(tokenTypes)('generates a %s token', (type) => {
      const token = generateOpaqueToken(type);

      expect(token.startsWith(`sf_${tokenTypeParts[type]}_`)).toBe(true);
    });

    it('includes the configured environment in the token prefix', async () => {
      vi.stubEnv('TOKEN_ENVIRONMENT', 'staging');
      vi.resetModules();
      const {generateOpaqueToken} = await import('./index.js');

      const token = generateOpaqueToken('apiKey');

      expect(token.startsWith('sf_staging_k_')).toBe(true);
    });

    it.each([
      'prod',
      'production',
    ])('includes %s in the token prefix when configured', async (environment) => {
      vi.stubEnv('TOKEN_ENVIRONMENT', environment);
      vi.resetModules();
      const {generateOpaqueToken} = await import('./index.js');

      const token = generateOpaqueToken('apiKey');

      expect(token.startsWith(`sf_${environment}_k_`)).toBe(true);
    });
  });

  describe('hashOpaqueToken', () => {
    it('hashes the same token deterministically', () => {
      const first = hashOpaqueToken('test-key');
      const second = hashOpaqueToken('test-key');

      expect(first).toBe(second);
      expect(first).toHaveLength(64);
    });

    it('returns different hashes for different tokens', () => {
      const first = hashOpaqueToken('key-a');
      const second = hashOpaqueToken('key-b');

      expect(first).not.toBe(second);
    });
  });

  describe('getTokenType', () => {
    it.each(tokenTypes)('returns %s for its token prefix', (expectedType) => {
      const type = getTokenType(`sf_${tokenTypeParts[expectedType]}_Ab3xY7890123456789`);

      expect(type).toBe(expectedType);
    });

    it.each(tokenTypes)('returns %s for its environment-scoped token prefix', (expectedType) => {
      const type = getTokenType(`sf_prod_${tokenTypeParts[expectedType]}_Ab3xY7890123456789`);

      expect(type).toBe(expectedType);
    });

    it('returns undefined for an unknown token prefix', () => {
      const type = getTokenType('unknown_Ab3xY7890123456789');

      expect(type).toBeUndefined();
    });

    it('does not return a type for an unqualified token when an environment is configured', async () => {
      vi.stubEnv('TOKEN_ENVIRONMENT', 'staging');
      vi.resetModules();
      const {getTokenType} = await import('./index.js');

      const type = getTokenType('sf_k_Ab3xY7890123456789');

      expect(type).toBeUndefined();
    });

    it('does not return a type for another environment when an environment is configured', async () => {
      vi.stubEnv('TOKEN_ENVIRONMENT', 'staging');
      vi.resetModules();
      const {getTokenType} = await import('./index.js');

      const type = getTokenType('sf_prod_k_Ab3xY7890123456789');

      expect(type).toBeUndefined();
    });
  });

  describe('getTokenEnvironment', () => {
    it('returns production for an unqualified token prefix', () => {
      const environment = getTokenEnvironment('sf_k_Ab3xY7890123456789');

      expect(environment).toBe('production');
    });

    it('returns prod for a prod token prefix', () => {
      const environment = getTokenEnvironment('sf_prod_k_Ab3xY7890123456789');

      expect(environment).toBe('prod');
    });

    it('returns the environment for an environment-scoped token prefix', () => {
      const environment = getTokenEnvironment('sf_staging_k_Ab3xY7890123456789');

      expect(environment).toBe('staging');
    });

    it('returns undefined for an unknown token prefix', () => {
      const environment = getTokenEnvironment('unknown_Ab3xY7890123456789');

      expect(environment).toBeUndefined();
    });

    it('returns undefined for an unqualified token when an environment is configured', async () => {
      vi.stubEnv('TOKEN_ENVIRONMENT', 'staging');
      vi.resetModules();
      const {getTokenEnvironment} = await import('./index.js');

      const environment = getTokenEnvironment('sf_k_Ab3xY7890123456789');

      expect(environment).toBeUndefined();
    });
  });

  describe('extractDisplayPrefix', () => {
    it('returns the first twelve characters', () => {
      const prefix = extractDisplayPrefix('sf_k_Ab3xY7890123456789');

      expect(prefix).toBe('sf_k_Ab3xY78');
      expect(prefix).toHaveLength(12);
    });
  });
});
