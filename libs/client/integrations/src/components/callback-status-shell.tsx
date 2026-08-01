import {ButtonLink} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {Text} from '@shipfox/react-ui/typography';
import {Link} from '@tanstack/react-router';
import {useEffect, useRef} from 'react';

export function CallbackStatusShell({
  title,
  message,
  startOver,
  switchAccount,
  workspaceId,
  workspaceSlug,
  installPath,
}: {
  title: string;
  message: string;
  startOver?: boolean;
  switchAccount?: boolean;
  workspaceId?: string | undefined;
  workspaceSlug?: string | undefined;
  installPath: '/w/$workspaceSlug/integrations/linear' | '/w/$workspaceSlug/integrations/slack';
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  const recoveryVariant = startOver || switchAccount ? 'muted' : 'base';
  const settings = workspaceSlug ? (
    <ButtonLink asChild variant={recoveryVariant} className="min-h-44 w-full sm:w-fit">
      <Link to="/w/$workspaceSlug/settings/integrations" params={{workspaceSlug}}>
        Back to integrations
      </Link>
    </ButtonLink>
  ) : (
    <ButtonLink asChild variant={recoveryVariant} className="min-h-44 w-full sm:w-fit">
      <Link to="/">Back to Shipfox</Link>
    </ButtonLink>
  );
  const logoutRedirect = workspaceSlug
    ? installPath.replace('$workspaceSlug', workspaceSlug)
    : undefined;

  return (
    <main className="flex min-h-screen bg-background-subtle-base px-16 py-32">
      <div className="mx-auto flex w-full max-w-[480px] flex-col justify-center gap-20">
        <h2 ref={headingRef} tabIndex={-1} className="text-24 font-semibold outline-none">
          {title}
        </h2>
        <Callout role="alert" type="error">
          <Text size="sm">{message}</Text>
        </Callout>
        <div className="flex flex-col gap-8 sm:flex-row sm:items-center">
          {switchAccount ? (
            <ButtonLink asChild className="min-h-44 w-full sm:w-fit">
              <Link
                to="/auth/logout"
                search={workspaceId ? {redirect: logoutRedirect ?? '/'} : undefined}
              >
                Switch account
              </Link>
            </ButtonLink>
          ) : null}
          {startOver && workspaceSlug ? (
            <ButtonLink asChild className="min-h-44 w-full sm:w-fit">
              <Link to={installPath} params={{workspaceSlug}}>
                Start over
              </Link>
            </ButtonLink>
          ) : null}
          {settings}
        </div>
      </div>
    </main>
  );
}
