import {jwtVerify, SignJWT} from 'jose';

function keyMaterial(secret: string | Uint8Array): Uint8Array {
  return typeof secret === 'string' ? new TextEncoder().encode(secret) : secret;
}

const UNIT_SECONDS: Record<string, number> = {
  sec: 1,
  secs: 1,
  second: 1,
  seconds: 1,
  s: 1,
  minute: 60,
  minutes: 60,
  min: 60,
  mins: 60,
  m: 60,
  hour: 3600,
  hours: 3600,
  hr: 3600,
  hrs: 3600,
  h: 3600,
  day: 86_400,
  days: 86_400,
  d: 86_400,
  week: 604_800,
  weeks: 604_800,
  w: 604_800,
  year: 31_557_600,
  years: 31_557_600,
  yr: 31_557_600,
  yrs: 31_557_600,
  y: 31_557_600,
};

const DURATION_PATTERN = /^(\d+(?:\.\d+)?) ?([a-z]+)$/i;

/**
 * Converts a jose timespan string (the same `expiresIn` values {@link signHs256} accepts, e.g.
 * `90m`, `7d`, `3600s`) into whole seconds, so callers can reason about a token's lifetime
 * without minting one. Units and rounding mirror jose's own parser. Throws on an unrecognized
 * format, which a bare number (`5400`) is, exactly as jose rejects it.
 */
export function durationToSeconds(value: string): number {
  const match = DURATION_PATTERN.exec(value.trim());
  const [, amount, unit] = match ?? [];
  const unitSeconds = unit === undefined ? undefined : UNIT_SECONDS[unit.toLowerCase()];
  if (amount === undefined || unitSeconds === undefined) {
    throw new TypeError(`Invalid duration: "${value}"`);
  }
  return Math.round(Number.parseFloat(amount) * unitSeconds);
}

export interface SignHs256Params {
  payload: Record<string, unknown>;
  secret: string | Uint8Array;
  expiresIn: string;
  subject?: string;
  audience?: string;
}

export async function signHs256(params: SignHs256Params): Promise<string> {
  const jwt = new SignJWT(params.payload)
    .setProtectedHeader({alg: 'HS256'})
    .setIssuedAt()
    .setExpirationTime(params.expiresIn);

  if (params.subject !== undefined) {
    jwt.setSubject(params.subject);
  }
  if (params.audience !== undefined) {
    jwt.setAudience(params.audience);
  }

  return await jwt.sign(keyMaterial(params.secret));
}

export interface VerifyHs256Params<T> {
  token: string;
  secret: string | Uint8Array;
  // Structural so any Zod schema (or equivalent) satisfies it without coupling
  // this package to a validation library.
  schema: {parse(data: unknown): T};
  // When set, jose throws on an `aud` mismatch before the schema runs.
  audience?: string;
  /** Evaluate temporal claims against this time instead of the current clock. */
  verificationTime?: Date;
}

export async function verifyHs256<T>(params: VerifyHs256Params<T>): Promise<T> {
  const {payload} = await jwtVerify(params.token, keyMaterial(params.secret), {
    algorithms: ['HS256'],
    ...(params.audience !== undefined ? {audience: params.audience} : {}),
    ...(params.verificationTime !== undefined ? {currentDate: params.verificationTime} : {}),
  });

  return params.schema.parse(payload);
}
