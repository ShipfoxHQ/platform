import {Card, CardTitle} from '@shipfox/react-ui/card';
import {Code, Header, Text} from '@shipfox/react-ui/typography';
import {useEffect, useState} from 'react';
import {storybookLinks} from '../preview-manifest.js';

type PreviewIdentity = {
  commitSha: string;
  pullRequest: {number: number; url: string | null} | null;
};

type PreviewIdentityState =
  | {status: 'loading'}
  | {status: 'available'; identity: PreviewIdentity}
  | {status: 'unavailable'};

export function parsePreviewIdentity(value: unknown): PreviewIdentity | null {
  if (typeof value !== 'object' || value === null) return null;

  const candidate = value as {
    commitSha?: unknown;
    pullRequest?: unknown;
  };
  if (typeof candidate.commitSha !== 'string' || candidate.commitSha.length === 0) return null;
  if (candidate.pullRequest === null || candidate.pullRequest === undefined) {
    return {commitSha: candidate.commitSha, pullRequest: null};
  }
  if (typeof candidate.pullRequest !== 'object' || candidate.pullRequest === null) return null;

  const pullRequest = candidate.pullRequest as {number?: unknown; url?: unknown};
  if (!Number.isInteger(pullRequest.number) || (pullRequest.number as number) <= 0) return null;

  return {
    commitSha: candidate.commitSha,
    pullRequest: {
      number: pullRequest.number as number,
      url: typeof pullRequest.url === 'string' ? pullRequest.url : null,
    },
  };
}

export function IntroductionPage() {
  const [previewIdentity, setPreviewIdentity] = useState<PreviewIdentityState>({
    status: 'loading',
  });

  useEffect(() => {
    let active = true;

    void fetch('/preview-metadata.json')
      .then(async (response) => (response.ok ? parsePreviewIdentity(await response.json()) : null))
      .then((identity) => {
        if (!active) return;
        setPreviewIdentity(
          identity === null ? {status: 'unavailable'} : {status: 'available', identity},
        );
      })
      .catch(() => {
        if (active) setPreviewIdentity({status: 'unavailable'});
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="min-h-dvh bg-background-neutral-background px-24 py-48">
      <div className="mx-auto flex max-w-[960px] flex-col gap-32">
        <header className="max-w-[720px]">
          <Code variant="label" bold className="text-foreground-neutral-muted">
            Shipfox component library
          </Code>
          <Header variant="h1" className="mt-12">
            Browse the components behind Shipfox.
          </Header>
          <Text size="lg" className="mt-12 text-foreground-neutral-subtle">
            Choose a package to explore its components, states, and interaction patterns. Use the
            theme control above to review every surface in light or dark mode.
          </Text>
        </header>

        <section
          aria-labelledby="preview-identity"
          className="rounded-8 bg-background-subtle-base p-20"
        >
          <Code variant="label" bold id="preview-identity">
            Preview identity
          </Code>
          {previewIdentity.status === 'loading' ? (
            <Text size="sm" className="mt-8 text-foreground-neutral-subtle">
              Loading build metadata…
            </Text>
          ) : previewIdentity.status === 'unavailable' ? (
            <Text size="sm" className="mt-8 text-foreground-neutral-subtle">
              Build metadata is unavailable on this surface.
            </Text>
          ) : (
            <dl className="mt-12 grid gap-8 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-16">
              <dt className="text-foreground-neutral-subtle">Source</dt>
              <dd>
                {previewIdentity.identity.pullRequest === null ? (
                  'main'
                ) : previewIdentity.identity.pullRequest.url === null ? (
                  `Pull request #${previewIdentity.identity.pullRequest.number}`
                ) : (
                  <a
                    className="underline underline-offset-4"
                    href={previewIdentity.identity.pullRequest.url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Pull request #{previewIdentity.identity.pullRequest.number}
                  </a>
                )}
              </dd>
              <dt className="text-foreground-neutral-subtle">Commit</dt>
              <dd className="break-all font-code">{previewIdentity.identity.commitSha}</dd>
            </dl>
          )}
        </section>

        <section aria-labelledby="storybook-packages">
          <Header variant="h2" id="storybook-packages">
            Choose a package
          </Header>
          <div className="mt-16 grid grid-cols-1 gap-12 sm:grid-cols-2 lg:grid-cols-3">
            {storybookLinks.map((storybook) => (
              <a
                className="sb-unstyled block h-full rounded-8 outline-none focus-visible:shadow-button-neutral-focus"
                href={storybook.url}
                key={storybook.id}
              >
                <Card className="h-full">
                  <CardTitle>{storybook.title}</CardTitle>
                </Card>
              </a>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
