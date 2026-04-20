import cors from '@fastify/cors';
import type {FastifyInstance} from 'fastify';
import {config} from './config.js';

const ORIGIN_SEPARATOR_RE = /\s*,\s*/;
const TRAILING_SLASH_RE = /\/$/;

function normalizeOrigin(origin: string): string {
  try {
    return new URL(origin).origin;
  } catch {
    return origin.replace(TRAILING_SLASH_RE, '');
  }
}

function allowedOrigins(): Set<string> {
  const origins = config.BROWSER_ALLOWED_ORIGIN ?? config.CLIENT_BASE_URL;
  return new Set(origins.split(ORIGIN_SEPARATOR_RE).filter(Boolean).map(normalizeOrigin));
}

export async function registerCors(app: FastifyInstance): Promise<void> {
  const allowed = allowedOrigins();

  await app.register(cors, {
    credentials: true,
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow: boolean) => void,
    ) => {
      callback(null, !origin || allowed.has(normalizeOrigin(origin)));
    },
  });
}
