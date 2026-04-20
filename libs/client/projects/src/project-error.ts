import {ApiError} from '@shipfox/client-api';

export interface ProjectErrorCopy {
  title: string;
  message: string;
  existingProjectId?: string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function apiDetails(error: ApiError): Record<string, unknown> {
  if (!isRecord(error.details)) return {};
  const details = error.details.details;
  return isRecord(details) ? details : {};
}

function stringDetail(error: ApiError, key: string): string | undefined {
  const value = apiDetails(error)[key];
  return typeof value === 'string' ? value : undefined;
}

function numberDetail(error: ApiError, key: string): number | undefined {
  const value = apiDetails(error)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function projectErrorCopy(error: unknown): ProjectErrorCopy {
  if (!(error instanceof ApiError)) {
    return {
      title: 'Something went wrong',
      message: 'Try again in a moment.',
    };
  }

  if (error.code === 'network-error') {
    return {
      title: 'Network problem',
      message: 'We could not reach the API. Check your connection and try again.',
    };
  }
  if (error.code === 'repository-not-found') {
    return {
      title: 'Repository not found',
      message: 'Check the repository id and try again.',
    };
  }
  if (error.code === 'access-denied') {
    return {
      title: 'Repository access denied',
      message: 'The selected connection cannot access this repository.',
    };
  }
  if (error.code === 'rate-limited') {
    const retryAfter = numberDetail(error, 'retry_after_seconds');
    return {
      title: 'Provider rate limited',
      message: retryAfter
        ? `Try again in about ${retryAfter} seconds.`
        : 'The provider is asking us to slow down. Try again shortly.',
    };
  }
  if (error.code === 'timeout') {
    return {
      title: 'Provider timed out',
      message: 'The provider did not respond in time. Try again.',
    };
  }
  if (error.code === 'provider-unavailable') {
    return {
      title: 'Provider unavailable',
      message: 'The provider is unavailable right now. Try again shortly.',
    };
  }
  if (error.code === 'malformed-provider-response') {
    return {
      title: 'Provider response changed',
      message: 'The provider returned data Shipfox could not understand.',
    };
  }
  if (error.code === 'test-provider-disabled') {
    return {
      title: 'Test provider disabled',
      message: 'Local test project creation is disabled for this environment.',
    };
  }
  if (error.code === 'project-already-exists') {
    return {
      title: 'Project already exists',
      message: 'This repository is already connected to a Shipfox project.',
      existingProjectId: stringDetail(error, 'existing_project_id'),
    };
  }

  return {
    title: 'Project request failed',
    message: error.message || 'Try again in a moment.',
  };
}
