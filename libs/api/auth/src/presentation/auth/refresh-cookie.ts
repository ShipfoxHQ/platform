import type {FastifyReply, FastifyRequest} from 'fastify';
import {config} from '#config.js';

const REFRESH_COOKIE_PATH = '/auth';

function refreshCookieMaxAgeSeconds(): number {
  return config.AUTH_REFRESH_TOKEN_EXPIRES_IN_DAYS * 24 * 60 * 60;
}

export function getRefreshTokenCookie(request: FastifyRequest): string | undefined {
  return request.cookies[config.AUTH_REFRESH_COOKIE_NAME];
}

export function setRefreshTokenCookie(reply: FastifyReply, refreshToken: string): void {
  reply.setCookie(config.AUTH_REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
    maxAge: refreshCookieMaxAgeSeconds(),
  });
}

export function clearRefreshTokenCookie(reply: FastifyReply): void {
  reply.clearCookie(config.AUTH_REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
  });
}
