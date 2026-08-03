# Docs

This is a Next.js application generated with
[Create Fumadocs](https://github.com/fuma-nama/fumadocs).

Before writing or editing any page under `content/docs/`, read the repo-wide
[WRITING.md](../../WRITING.md) (style, sentences, punctuation, language level)
and then [apps/docs/WRITING.md](WRITING.md) (page types, the concept-page
template, example rules, and schema-documentation rules).

Run development server:

```bash
pnpm dev
```

Open http://localhost:3500 with your browser to see the result.

## Analytics

The production Vercel deployment requires these public browser variables:

```text
NEXT_PUBLIC_POSTHOG_KEY=<project token>
NEXT_PUBLIC_POSTHOG_URL=<HTTPS ingestion URL>
```

Set them only for the Vercel production environment. Local development and
preview deployments omit both variables and do not send analytics. The values
are included in browser code and visible in network requests, so neither value
is a secret.

The docs record every production session. In the PostHog project, keep session
recording at 100% with no URL or event trigger, and keep request and response
bodies, headers, and console logs disabled. Inputs are masked by the client SDK.

## Explore

The project includes:

- `lib/source.ts`: Code for content source adapter, [`loader()`](https://fumadocs.dev/docs/headless/source-api) provides the interface to access your content.
- `app/layout.config.tsx`: Shared options for layouts, optional but preferred to keep.

| Route                     | Description                                            |
| ------------------------- | ------------------------------------------------------ |
| `app/(home)`              | The route group for your landing page and other pages. |
| `app/docs`                | The documentation layout and pages.                    |
| `app/api/search/route.ts` | The Route Handler for search.                          |

### Fumadocs MDX

The repository includes a `source.config.ts` file. Customize options such as
the frontmatter schema.

Read the [Introduction](https://fumadocs.dev/docs/mdx) for further details.

## Learn More

To learn more about Next.js and Fumadocs, take a look at the following
resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js
  features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.
- [Fumadocs](https://fumadocs.vercel.app) - learn about Fumadocs
