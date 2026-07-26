# Shipfox Email

Branded transactional email templates for Shipfox Node packages. It renders MJML +
Handlebars templates into the `{subject, html, text}` shape that `@shipfox/node-mailer`
sends.

## What it does

- **`renderEmail(name, data)`**: Renders a template into `{subject, html, text}`. The
  HTML is responsive, branded MJML; the `text` is a hand-written plain-text fallback.
- **`RenderedEmail`**: The `{subject, html, text}` result shape.
- **`EmailTemplateError`**: Thrown (naming the template) when a `.mjml` file or partial
  is missing or invalid.

## Templates

| Name | Data | Sent by |
|------|------|---------|
| `verification-code` | `{verificationCode, expiresInMinutes}` | `@shipfox/api-email-challenges` on signup / resend |
| `verify-email` | `{verifyLink}` | `@shipfox/api-auth` on signup / resend |
| `reset-password` | `{resetLink, expiresInHours}` | `@shipfox/api-auth` on password reset request |
| `workspace-invitation` | `{email, workspaceName, inviterName, inviteLink}` | `@shipfox/api-workspaces` on invite |

## Usage

```ts
import {renderEmail} from '@shipfox/node-email';
import {mailer} from '#config.js';

const email = await renderEmail('verify-email', {
  verifyLink: 'https://app.shipfox.io/auth/verify-email?token=...',
});
await mailer.send({to: user.email, ...email});
```

## Design notes

- The `.mjml` templates live at the package root in `emails/`, sibling to `src/` and
  `dist/`, so the runtime read resolves the same in dev and prod with no asset-copy step.
  The `emails/` directory must ship in any deployment image.
- Shared chrome (fonts, color tokens, the logo partial) lives in `emails/partials/` and
  is pulled in with `mj-include`.
- The Shipfox logo is served from the client app's own origin: `CLIENT_BASE_URL` +
  `/email-logo.png`. `@shipfox/client-shell` ships the asset and its Vite manifest plugin
  serves it, so any client composed with the shell answers that path. The package
  reads `CLIENT_BASE_URL` via `@shipfox/config`, so every deployment embeds its own logo
  URL and no recipient data leaks to a third-party CDN. The asset is a PNG because most
  mail clients do not render SVG.
- Colors come from the product design tokens (see `DESIGN.md`): heading `#0f0f10`, body
  `#52525b`, divider `#d4d4d8`, CTA fill `#1a1a1b`. Orange is reserved for the logo mark.
- Dark mode is forced to light (`color-scheme: light`) so clients do not invert the
  white card into unreadable dark-on-dark.
- All interpolation uses Handlebars `{{var}}` (HTML-escaped). User-controlled values
  (workspace name, inviter, email) must never use `{{{ }}}`. They are also stripped of
  control characters before rendering, so a name cannot fold the subject line or inject
  extra lines (a fake CTA, a phishing link) into the plain-text body.

## Development

```sh
turbo check --filter=@shipfox/node-email
turbo type --filter=@shipfox/node-email
turbo test --filter=@shipfox/node-email
```

## License

MIT
