import {Factory} from 'fishery';

// Raw Sentry issue webhook payload, shaped exactly as Sentry delivers it over
// the wire. Tests serialize the built object to form a signed request body; the
// route parses and validates it with the production Zod schema. Build-only: the
// payload is never persisted, so there is no onCreate handler.
export interface SentryIssueWebhookPayload {
  action: string;
  installation: {uuid: string};
  data: {issue: Record<string, unknown>};
}

export const sentryIssueWebhookFactory = Factory.define<SentryIssueWebhookPayload>(
  ({sequence}) => ({
    action: 'created',
    installation: {uuid: `install-${sequence}`},
    data: {
      issue: {
        id: 'issue-123',
        shortId: 'PROJ-1',
        title: 'TypeError: boom',
        culprit: 'app/main',
        level: 'error',
        status: 'unresolved',
        platform: 'javascript',
        web_url: 'https://sentry.io/organizations/acme/issues/123/',
        url: 'https://sentry.io/api/0/issues/123/',
        project_url: 'https://sentry.io/api/0/projects/acme/web/',
        firstSeen: '2026-06-01T00:00:00Z',
        lastSeen: '2026-06-10T00:00:00Z',
      },
    },
  }),
);
