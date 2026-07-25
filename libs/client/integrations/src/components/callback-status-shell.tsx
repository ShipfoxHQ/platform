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
  installPath,
}: {
  title: string;
  message: string;
  startOver?: boolean;
  switchAccount?: boolean;
  workspaceId?: string | undefined;
  installPath: '/workspaces/$wid/integrations/linear' | '/workspaces/$wid/integrations/slack';
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  const recoveryVariant = startOver || switchAccount ? 'muted' : 'base';
  const settings = workspaceId ? (
    <ButtonLink asChild variant={recoveryVariant} className="min-h-44 w-full sm:w-fit">
      <Link to="/workspaces/$wid/settings/integrations" params={{wid: workspaceId}}>
        Back to integrations
      </Link>
    </ButtonLink>
  ) : (
    <ButtonLink asChild variant={recoveryVariant} className="min-h-44 w-full sm:w-fit">
      <Link to="/">Back to Shipfox</Link>
    </ButtonLink>
  );
  const logoutRedirect = workspaceId ? installPath.replace('$wid', workspaceId) : undefined;

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
          {startOver && workspaceId ? (
            <ButtonLink asChild className="min-h-44 w-full sm:w-fit">
              <Link to={installPath} params={{wid: workspaceId}}>
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
