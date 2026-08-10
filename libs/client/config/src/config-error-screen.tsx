import {ButtonLink} from '@shipfox/react-ui/button';
import {Icon} from '@shipfox/react-ui/icon';
import {Panel, PanelBody, PanelHeader, PanelTitle} from '@shipfox/react-ui/panel';
import {Code, Text} from '@shipfox/react-ui/typography';
import type {ConfigKeyError} from './load-config.js';

export interface ConfigErrorScreenProps {
  errors: ConfigKeyError[];
  /** Link to the self-hosting configuration guide. */
  docsUrl?: string;
}

/**
 * Full-screen configuration diagnostic shown instead of the app when required
 * config is missing or invalid. It lists every problem at once with the exact
 * environment variable to set, so a self-hoster fixes the deployment in one pass
 * rather than discovering errors one failed request at a time.
 *
 * Rendered outside the app's auth/router tree but inside `ThemeProvider` (see
 * main.tsx), so it uses the design system directly.
 */
export function ConfigErrorScreen({errors, docsUrl}: ConfigErrorScreenProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background-subtle-base px-frame py-frame">
      <Panel className="w-full max-w-[512px]">
        <PanelHeader variant="plain" className="flex-col items-start gap-inline">
          <div className="flex items-center gap-inline">
            <Icon name="errorWarningLine" className="size-20 text-tag-error-icon" />
            <PanelTitle variant="h2">Configuration error</PanelTitle>
          </div>
          <Text size="sm" className="text-foreground-neutral-muted">
            The Shipfox client could not start because its configuration is missing or invalid. Set
            the environment variables below and restart the container.
          </Text>
        </PanelHeader>

        <PanelBody className="flex flex-col">
          {errors.map((error) => (
            <div
              key={error.key}
              className="flex flex-col gap-tight border-t border-border-neutral-base py-row first:border-t-0 first:pt-0"
            >
              <Code variant="label" bold className="text-foreground-neutral-base">
                {error.key}
              </Code>
              {error.description ? (
                <Text size="sm" className="text-foreground-neutral-muted">
                  {error.description}
                </Text>
              ) : null}
              <Text size="sm" className="text-tag-error-text">
                {error.message}
              </Text>
              <Text size="xs" className="text-foreground-neutral-muted">
                Set{' '}
                <Code as="code" variant="label" className="text-foreground-neutral-subtle">
                  {error.envVars[0]}
                </Code>{' '}
                (self-hosting) or{' '}
                <Code as="code" variant="label" className="text-foreground-neutral-subtle">
                  {error.envVars[1]}
                </Code>{' '}
                (build time).
              </Text>
            </div>
          ))}
        </PanelBody>

        {docsUrl ? (
          <div className="p-panel pt-0">
            <Text size="sm" className="text-foreground-neutral-muted">
              See the{' '}
              <ButtonLink href={docsUrl} variant="interactive" underline>
                self-hosting configuration guide
              </ButtonLink>
              .
            </Text>
          </div>
        ) : null}
      </Panel>
    </main>
  );
}
