# @shipfox/node-email

## 0.3.5

### Patch Changes

- 6366319: Uses IBM Plex Sans for transactional emails with Inter, Helvetica, and Arial fallbacks.

## 0.3.4

### Patch Changes

- 56e2c58: Serve `/email-logo.png` from `@shipfox/client-shell`. Transactional emails link the logo at `CLIENT_BASE_URL + /email-logo.png`, but the asset only existed in this repository's own `apps/client/public/`, so any other client composed with the shell answered that path with its SPA fallback and mail clients rendered a broken image. The manifest plugin now owns the asset alongside the favicons, and it ships in the package. An application that keeps its own `public/email-logo.png` must delete it, since the plugin rejects conflicting copies.

## 0.3.3

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.
- Updated dependencies [4b85404]
  - @shipfox/config@1.2.4

## 0.3.2

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [475ce59]
  - @shipfox/config@1.2.3

## 0.3.1

### Patch Changes

- ffc7fc9: Republishes the affected release set after recovering package publication.

## 0.3.0

### Minor Changes

- 4d7c87e: Adds a branded verification-code email with warmer account setup copy.

## 0.2.2

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [bb037af]
  - @shipfox/config@1.2.2

## 0.2.1

### Patch Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.
- Updated dependencies [1b0d344]
  - @shipfox/config@1.2.1

## 0.2.0

### Minor Changes

- cdd8931: Add `@shipfox/node-email`: branded MJML + Handlebars transactional email templates (email verification, password reset, workspace invitation) that render to the `{subject, html, text}` shape `@shipfox/node-mailer` sends. Colors follow the product design tokens, dark mode is forced to light for legibility, and every template ships a plain-text fallback. The auth and workspaces modules now send these branded emails instead of bare links, and the workspace invitation shows the workspace name and inviter. The logo is served from the deployment's own client origin (`CLIENT_BASE_URL` + `/email-logo.png`) rather than a third-party CDN, and user-controlled display names are stripped of control characters before rendering so they cannot break the subject line or inject lines into the plain-text body.

### Patch Changes

- 4798517: Preserves MJML partial rendering when compiling transactional email templates with MJML 5.
  - @shipfox/config@1.2.0
