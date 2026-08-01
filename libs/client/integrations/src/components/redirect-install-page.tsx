import {ApiError} from '@shipfox/client-api';
import {useActiveWorkspace} from '@shipfox/client-auth';
import {ButtonLink} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {FullPageLoader} from '@shipfox/react-ui/loader';
import {Text} from '@shipfox/react-ui/typography';
import {Link} from '@tanstack/react-router';
import {useEffect, useRef, useState} from 'react';
import type {InstallRedirect} from '#core/models.js';

interface RedirectInstallPageProps {
  installRequest: (body: {workspace_id: string}) => Promise<InstallRedirect>;
  errorFallbackMessage: string;
  loadingLabel?: string;
  /**
   * Runs before leaving the app (e.g. to persist the workspace id for a
   * state-less provider callback. It must not throw. A failed side effect
   * should never block the redirect.
   */
  beforeRedirect?: (workspaceId: string) => void;
  /** Injectable for tests: jsdom's window.location cannot be stubbed. */
  assignLocation?: (url: string) => void;
}

export function RedirectInstallPage({
  installRequest,
  errorFallbackMessage,
  loadingLabel = 'Starting installation',
  beforeRedirect,
  assignLocation = (url) => window.location.assign(url),
}: RedirectInstallPageProps) {
  const workspace = useActiveWorkspace();
  const startedRef = useRef(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    // The side effect is best-effort persistence; a throw here must never
    // block the install redirect, so swallow it and continue.
    try {
      beforeRedirect?.(workspace.id);
    } catch {
      // ignore
    }
    installRequest({workspace_id: workspace.id})
      .then((response) => {
        assignLocation(response.installUrl);
      })
      .catch((error: unknown) => {
        setErrorMessage(error instanceof ApiError ? error.message : errorFallbackMessage);
      });
  }, [workspace, installRequest, beforeRedirect, errorFallbackMessage, assignLocation]);

  if (errorMessage) {
    return (
      <div className="mx-auto flex w-full max-w-[480px] flex-col gap-16">
        <Callout role="alert" type="error">
          <Text size="sm">{errorMessage}</Text>
        </Callout>
        <ButtonLink asChild variant="muted" className="w-fit">
          <Link to="/workspaces/$wid/integrations" params={{wid: workspace.id}}>
            Back to integrations
          </Link>
        </ButtonLink>
      </div>
    );
  }

  return <FullPageLoader aria-label={loadingLabel} />;
}
