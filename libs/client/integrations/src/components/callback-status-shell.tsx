import {ButtonLink} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {Text} from '@shipfox/react-ui/typography';
import {Link} from '@tanstack/react-router';
import {useEffect, useRef} from 'react';

export function CallbackStatusShell({
  title,
  message,
  status = 'error',
  startOver,
  switchAccount,
  workspaceSlug,
  installPath,
}: {
  title: string;
  message: string;
  status?: 'error' | 'success';
  startOver?: boolean;
  switchAccount?: boolean;
  workspaceSlug?: string | undefined;
  installPath:
    | '/w/$workspaceSlug/integrations/linear'
    | '/w/$workspaceSlug/integrations/slack'
    | '/w/$workspaceSlug/integrations/jira';
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
    <main className="flex min-h-screen bg-background-subtle-base px-row py-frame">
      <div className="mx-auto flex w-full max-w-[480px] flex-col justify-center gap-section">
        <h2 ref={headingRef} tabIndex={-1} className="text-24 font-semibold outline-none">
          {title}
        </h2>
        <Callout role={status === 'error' ? 'alert' : 'status'} type={status}>
          <Text size="sm">{message}</Text>
        </Callout>
        <div className="flex flex-col gap-inline sm:flex-row sm:items-center">
          {switchAccount ? (
            <ButtonLink asChild className="min-h-44 w-full sm:w-fit">
              <Link
                to="/auth/logout"
                search={logoutRedirect ? {redirect: logoutRedirect} : undefined}
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
