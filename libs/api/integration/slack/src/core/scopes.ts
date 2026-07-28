import {SlackAuthorizationScopeMismatchError} from './errors.js';

export const SLACK_BOT_SCOPES = Object.freeze([
  'app_mentions:read',
  'im:history',
  'im:read',
  'mpim:history',
  'mpim:read',
  'chat:write',
  'channels:history',
  'groups:history',
  'channels:read',
  'groups:read',
  'users:read',
  'reactions:read',
  'reactions:write',
  'canvases:write',
  'commands',
]);

export function formatSlackBotScopes(scopes = SLACK_BOT_SCOPES): string {
  return scopes.join(',');
}

export function assertSlackAuthorizationScopes(scopes: string[]): void {
  const grantedScopes = new Set(scopes);
  const missingScopes = SLACK_BOT_SCOPES.filter((scope) => !grantedScopes.has(scope));
  if (missingScopes.length > 0) throw new SlackAuthorizationScopeMismatchError(missingScopes);
}
