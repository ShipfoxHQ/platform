import {createHmac, randomUUID, timingSafeEqual} from 'node:crypto';
import {config} from '#config.js';
import {GithubInstallStateError} from './errors.js';

const STATE_TTL_SECONDS = 10 * 60;

interface GithubInstallStatePayload {
  workspaceId: string;
  userId: string;
  nonce: string;
  expiresAt: number;
}

export interface GithubInstallStateClaims {
  workspaceId: string;
  userId: string;
}

export function signGithubInstallState(params: {
  workspaceId: string;
  userId: string;
  nonce?: string | undefined;
  now?: Date | undefined;
}): string {
  const now = params.now ?? new Date();
  const payload: GithubInstallStatePayload = {
    workspaceId: params.workspaceId,
    userId: params.userId,
    nonce: params.nonce ?? randomUUID(),
    expiresAt: Math.floor(now.getTime() / 1000) + STATE_TTL_SECONDS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export function verifyGithubInstallState(
  state: string,
  now: Date = new Date(),
): GithubInstallStateClaims {
  const [encodedPayload, signature, extra] = state.split('.');
  if (!encodedPayload || !signature || extra !== undefined) {
    throw new GithubInstallStateError('Invalid GitHub install state');
  }

  if (!constantTimeEqual(signature, sign(encodedPayload))) {
    throw new GithubInstallStateError('Invalid GitHub install state signature');
  }

  const payload = parsePayload(encodedPayload);
  if (payload.expiresAt < Math.floor(now.getTime() / 1000)) {
    throw new GithubInstallStateError('Expired GitHub install state');
  }

  return {workspaceId: payload.workspaceId, userId: payload.userId};
}

function sign(encodedPayload: string): string {
  return createHmac('sha256', config.GITHUB_INSTALL_STATE_SECRET)
    .update(encodedPayload)
    .digest('base64url');
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function parsePayload(encodedPayload: string): GithubInstallStatePayload {
  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if (
      typeof parsed.workspaceId !== 'string' ||
      typeof parsed.userId !== 'string' ||
      typeof parsed.nonce !== 'string' ||
      typeof parsed.expiresAt !== 'number'
    ) {
      throw new Error('Invalid payload shape');
    }
    return parsed;
  } catch (_error) {
    throw new GithubInstallStateError('Invalid GitHub install state payload');
  }
}
