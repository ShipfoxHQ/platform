import {ApiError} from '@shipfox/client-api';

export interface ErrorCopy {
  title: string;
  message: string;
}

export interface LoadErrorCopyOptions {
  /** Lowercase noun for the resource being loaded, e.g. "integrations". */
  subject: string;
}

// Only the codes that actually reach a plain list/load GET. The API client
// synthesizes `network-error` (transport failure) and `request-failed` (server
// error body with no code); the server adds `server-error`, `unauthorized`, and
// `forbidden`. Provider codes (timeout, rate-limited, provider-unavailable, ...)
// belong to setup flows and stay in projectErrorCopy: mapping them here would be
// dead code on these surfaces.
const messageByCode: Record<string, string> = {
  'network-error': "We couldn't reach the server. Check your connection and try again.",
  'request-failed': 'Something went wrong on our side. Try again in a moment.',
  'server-error': 'Something went wrong on our side. Try again in a moment.',
  unauthorized: 'Your session may have expired. Try signing in again.',
  forbidden: "You don't have access to this. Try signing in again.",
};

const GENERIC_MESSAGE = 'Something went wrong. Check your connection and try again.';

/**
 * Friendly, leak-free copy for a failed data load. The title is always
 * `Couldn't load {subject}`; the message is keyed off the `ApiError` code, and the
 * fallback NEVER returns `error.message` (which can carry the raw request URL).
 */
export function loadErrorCopy(error: unknown, {subject}: LoadErrorCopyOptions): ErrorCopy {
  const message =
    error instanceof ApiError ? (messageByCode[error.code] ?? GENERIC_MESSAGE) : GENERIC_MESSAGE;

  return {
    title: `Couldn't load ${subject}`,
    message,
  };
}
