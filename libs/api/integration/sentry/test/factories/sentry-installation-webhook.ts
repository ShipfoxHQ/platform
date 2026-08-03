import {Factory} from 'fishery';

// Raw Sentry installation webhook payload, shaped exactly as Sentry delivers it
// over the wire: the lifecycle data nests under `data.installation` and carries
// the single-use authorization `code`. Tests serialize the built object to form a
// signed request body; the route parses and validates it with the production Zod
// schema. Build-only: the payload is never persisted, so there is no onCreate
// handler.
export interface SentryInstallationWebhookPayload {
  action: string;
  actor?: {type?: string; id?: string | number; name?: string};
  data: {
    installation: {
      uuid: string;
      status?: string;
      code?: string;
      organization?: {slug: string};
    };
  };
}

export const sentryInstallationWebhookFactory = Factory.define<SentryInstallationWebhookPayload>(
  ({sequence}) => ({
    action: 'created',
    actor: {type: 'user', id: sequence, name: 'Installer'},
    data: {
      installation: {
        uuid: `install-${sequence}`,
        status: 'installed',
        code: `grant-code-${sequence}`,
        organization: {slug: 'acme'},
      },
    },
  }),
);
