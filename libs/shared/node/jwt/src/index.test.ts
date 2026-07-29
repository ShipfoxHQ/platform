import {generateKeyPair, SignJWT, UnsecuredJWT} from 'jose';
import {z} from 'zod';
import {durationToSeconds, signHs256, verifyHs256} from './index.js';

const SECRET = 'test-secret-do-not-use-in-prod';

const authClaimsSchema = z.object({
  sub: z.string(),
  email: z.string().email(),
  iat: z.number().int(),
  exp: z.number().int(),
});

const leaseClaimsSchema = z.object({
  jobId: z.string().uuid(),
  sub: z.string().optional(),
  iat: z.number().int(),
  exp: z.number().int(),
});

const audiencedClaimsSchema = z.object({
  jobId: z.string().uuid(),
  aud: z.literal('runner-job-lease'),
  iat: z.number().int(),
  exp: z.number().int(),
});

const simpleClaimsSchema = z.object({
  a: z.literal(1),
  iat: z.number().int(),
  exp: z.number().int(),
});

function encodeSecret(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

describe('signHs256 / verifyHs256', () => {
  test('round-trips a token with a subject (auth shape)', async () => {
    const subject = crypto.randomUUID();

    const token = await signHs256({
      payload: {email: 'user@example.com'},
      secret: SECRET,
      expiresIn: '7d',
      subject,
    });
    const claims = await verifyHs256({token, secret: SECRET, schema: authClaimsSchema});

    expect(claims.sub).toBe(subject);
    expect(claims.email).toBe('user@example.com');
    expect(claims.iat).toBeTypeOf('number');
    expect(claims.exp).toBeGreaterThan(claims.iat);
  });

  test('round-trips a token without a subject (lease shape)', async () => {
    const jobId = crypto.randomUUID();

    const token = await signHs256({
      payload: {jobId},
      secret: SECRET,
      expiresIn: '90m',
    });
    const claims = await verifyHs256({token, secret: SECRET, schema: leaseClaimsSchema});

    expect(claims.sub).toBeUndefined();
    expect(claims.jobId).toBe(jobId);
  });

  test('round-trips a token with an audience that is then verified', async () => {
    const token = await signHs256({
      payload: {jobId: crypto.randomUUID()},
      secret: SECRET,
      expiresIn: '90m',
      audience: 'runner-job-lease',
    });
    const claims = await verifyHs256({
      token,
      secret: SECRET,
      schema: audiencedClaimsSchema,
      audience: 'runner-job-lease',
    });

    expect(claims.aud).toBe('runner-job-lease');
  });

  test('rejects a token whose audience does not match', async () => {
    const token = await signHs256({
      payload: {jobId: crypto.randomUUID()},
      secret: SECRET,
      expiresIn: '90m',
      audience: 'runner-job-lease',
    });

    await expect(
      verifyHs256({
        token,
        secret: SECRET,
        schema: audiencedClaimsSchema,
        audience: 'something-else',
      }),
    ).rejects.toThrow();
  });

  test('rejects a token with no audience when one is required', async () => {
    const token = await signHs256({
      payload: {jobId: crypto.randomUUID()},
      secret: SECRET,
      expiresIn: '90m',
    });

    await expect(
      verifyHs256({
        token,
        secret: SECRET,
        schema: audiencedClaimsSchema,
        audience: 'runner-job-lease',
      }),
    ).rejects.toThrow();
  });

  test('rejects a tampered signature', async () => {
    const token = await signHs256({payload: {a: 1}, secret: SECRET, expiresIn: '7d'});
    const tampered = `${token.slice(0, -4)}xxxx`;

    await expect(
      verifyHs256({token: tampered, secret: SECRET, schema: simpleClaimsSchema}),
    ).rejects.toThrow();
  });

  test('rejects a token signed with a different secret', async () => {
    const token = await signHs256({payload: {a: 1}, secret: SECRET, expiresIn: '7d'});

    await expect(
      verifyHs256({token, secret: 'different-secret', schema: simpleClaimsSchema}),
    ).rejects.toThrow();
  });

  test('rejects an expired token', async () => {
    const token = await signHs256({payload: {a: 1}, secret: SECRET, expiresIn: '-1s'});

    await expect(
      verifyHs256({token, secret: SECRET, schema: simpleClaimsSchema}),
    ).rejects.toThrow();
  });

  test('evaluates temporal claims against an explicit verification time', async () => {
    const token = await new SignJWT({a: 1})
      .setProtectedHeader({alg: 'HS256'})
      .setIssuedAt(1_800_000_000)
      .setExpirationTime(1_800_000_060)
      .sign(encodeSecret(SECRET));

    await expect(
      verifyHs256({
        token,
        secret: SECRET,
        schema: simpleClaimsSchema,
        verificationTime: new Date(1_800_000_030_000),
      }),
    ).resolves.toMatchObject({a: 1});

    await expect(
      verifyHs256({
        token,
        secret: SECRET,
        schema: simpleClaimsSchema,
        verificationTime: new Date(1_800_000_061_000),
      }),
    ).rejects.toThrow();
  });

  test('rejects a malformed token', async () => {
    await expect(
      verifyHs256({token: 'not.a.token', secret: SECRET, schema: simpleClaimsSchema}),
    ).rejects.toThrow();
  });

  test('propagates schema validation failures', async () => {
    // Valid signature, but the payload does not satisfy the schema.
    const token = await signHs256({payload: {a: 1}, secret: SECRET, expiresIn: '7d'});
    const mismatchedSchema = z.object({requiredField: z.string()});

    await expect(verifyHs256({token, secret: SECRET, schema: mismatchedSchema})).rejects.toThrow();
  });

  // Algorithm-confusion guard: nothing outside the HS256 allowlist may verify.
  test('rejects an unsecured (alg:none) token', async () => {
    const token = new UnsecuredJWT({a: 1}).setIssuedAt().setExpirationTime('7d').encode();

    await expect(
      verifyHs256({token, secret: SECRET, schema: simpleClaimsSchema}),
    ).rejects.toThrow();
  });

  test('rejects an RS256-signed token', async () => {
    const {privateKey} = await generateKeyPair('RS256');
    const token = await new SignJWT({a: 1})
      .setProtectedHeader({alg: 'RS256'})
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(privateKey);

    await expect(
      verifyHs256({token, secret: SECRET, schema: simpleClaimsSchema}),
    ).rejects.toThrow();
  });

  test('encodeSecret parity: a token signed manually with the same secret verifies', async () => {
    const token = await new SignJWT({a: 1})
      .setProtectedHeader({alg: 'HS256'})
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(encodeSecret(SECRET));

    const claims = await verifyHs256({token, secret: SECRET, schema: simpleClaimsSchema});

    expect(claims.a).toBe(1);
  });
});

describe('durationToSeconds', () => {
  test.each([
    ['90m', 5400],
    ['2h', 7200],
    ['3600s', 3600],
    ['7d', 604_800],
    ['1w', 604_800],
    ['1.5h', 5400],
    ['45 s', 45],
  ])('parses %s to %d seconds', (value, expected) => {
    expect(durationToSeconds(value)).toBe(expected);
  });

  test.each([
    '5400',
    'soon',
    '',
    'm',
    '1 fortnight',
  ])('throws on the invalid duration %j', (value) => {
    expect(() => durationToSeconds(value)).toThrow();
  });

  // Pins the parser to jose: the lifetime it reports must match the one jose actually stamps,
  // so a caller can size a window against a token's TTL without minting one.
  test.each(['90m', '2h', '7d'])('matches the exp jose stamps for %s', async (value) => {
    const token = await signHs256({payload: {a: 1}, secret: SECRET, expiresIn: value});

    const claims = await verifyHs256({token, secret: SECRET, schema: simpleClaimsSchema});

    expect(claims.exp - claims.iat).toBe(durationToSeconds(value));
  });
});
