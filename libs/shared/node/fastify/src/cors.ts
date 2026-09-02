import cors from '@fastify/cors';
import type {FastifyInstance} from 'fastify';
import {getPublicSuffix} from 'tldts';
import {config} from './config.js';

const ORIGIN_SEPARATOR_RE = /\s*,\s*/;
const TRAILING_SLASH_RE = /\/$/;

type AllowedOrigin =
  | {kind: 'exact'; origin: string}
  | {kind: 'subdomain'; hostname: string; port: string; protocol: string};

function normalizeOrigin(origin: string): string {
  try {
    return new URL(origin).origin;
  } catch {
    return origin.replace(TRAILING_SLASH_RE, '');
  }
}

function allowedOrigins(): AllowedOrigin[] {
  const origins = config.BROWSER_ALLOWED_ORIGIN ?? config.CLIENT_BASE_URL;
  return origins.split(ORIGIN_SEPARATOR_RE).filter(Boolean).map(parseAllowedOrigin);
}

function parseAllowedOrigin(origin: string): AllowedOrigin {
  const normalized = normalizeOrigin(origin);
  let parsed: URL;

  try {
    parsed = new URL(origin);
  } catch {
    return {kind: 'exact', origin: normalized};
  }

  if (!origin.includes('*')) return {kind: 'exact', origin: normalized};

  if (!parsed.hostname.includes('*')) {
    throw new Error(`BROWSER_ALLOWED_ORIGIN wildcard '${origin}' must appear in the hostname.`);
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname.startsWith('*.') || hostname.slice(2).includes('*')) {
    throw new Error(
      `BROWSER_ALLOWED_ORIGIN wildcard '${origin}' must appear only in the leftmost hostname label.`,
    );
  }

  const parentHostname = hostname.slice(2);
  if (
    !parentHostname ||
    parentHostname.startsWith('.') ||
    parentHostname.endsWith('.') ||
    parentHostname.includes('..')
  ) {
    throw new Error(
      `BROWSER_ALLOWED_ORIGIN wildcard '${origin}' must name a well-formed parent host.`,
    );
  }
  if (getPublicSuffix(parentHostname, {allowPrivateDomains: true}) === parentHostname) {
    throw new Error(
      `BROWSER_ALLOWED_ORIGIN wildcard '${origin}' must name a specific parent host; '${parentHostname}' is a public suffix.`,
    );
  }

  return {
    kind: 'subdomain',
    hostname: parentHostname,
    port: parsed.port,
    protocol: parsed.protocol,
  };
}

function matchesAllowedOrigin(origin: string | undefined, allowed: AllowedOrigin[]): boolean {
  if (!origin) return true;

  const normalized = normalizeOrigin(origin);
  for (const entry of allowed) {
    if (entry.kind === 'exact' && entry.origin === normalized) return true;
    if (entry.kind !== 'subdomain') continue;

    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      continue;
    }

    if (
      parsed.protocol === entry.protocol &&
      parsed.port === entry.port &&
      parsed.hostname !== entry.hostname &&
      parsed.hostname.endsWith(`.${entry.hostname}`)
    ) {
      return true;
    }
  }

  return false;
}

/** Creates the same origin predicate used by the application's CORS policy. */
export function createAllowedOriginMatcher(): (origin: string | undefined) => boolean {
  const allowed = allowedOrigins();
  return (origin) => matchesAllowedOrigin(origin, allowed);
}

export async function registerCors(app: FastifyInstance): Promise<void> {
  const isAllowedOrigin = createAllowedOriginMatcher();

  await app.register(cors, {
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow: boolean) => void,
    ) => {
      callback(null, isAllowedOrigin(origin));
    },
  });
}
