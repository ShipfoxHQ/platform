import {
  clearWorkspaceSetupChecklistDismissal,
  isWorkspaceSetupChecklistDismissed,
} from '@shipfox/client-shell/runtime';
import {ButtonLink} from '@shipfox/react-ui/button';
import {useEffect, useRef, useState} from 'react';

const SETUP_GUIDE_REOPENED_MESSAGE = 'The setup guide will appear on the Projects page.';

export function ShowSetupGuideLink({workspaceId}: {workspaceId: string}) {
  const [dismissed, setDismissed] = useState(() => isWorkspaceSetupChecklistDismissed(workspaceId));
  const [statusMessage, setStatusMessage] = useState<string>();
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const refreshDismissal = () => {
      const nextDismissed = isWorkspaceSetupChecklistDismissed(workspaceId);
      setDismissed(nextDismissed);
      if (nextDismissed) setStatusMessage(undefined);
    };

    refreshDismissal();
    window.addEventListener('focus', refreshDismissal);
    window.addEventListener('storage', refreshDismissal);

    return () => {
      window.removeEventListener('focus', refreshDismissal);
      window.removeEventListener('storage', refreshDismissal);
    };
  }, [workspaceId]);

  useEffect(() => {
    if (statusMessage) statusRef.current?.focus();
  }, [statusMessage]);

  if (!dismissed && !statusMessage) return null;

  return (
    <>
      {dismissed ? (
        <ButtonLink asChild variant="interactive" underline>
          <button
            type="button"
            onClick={() => {
              clearWorkspaceSetupChecklistDismissal(workspaceId);
              setDismissed(false);
              setStatusMessage(SETUP_GUIDE_REOPENED_MESSAGE);
            }}
          >
            Show the setup guide
          </button>
        </ButtonLink>
      ) : null}
      {statusMessage ? (
        <p
          ref={statusRef}
          role="status"
          tabIndex={-1}
          className="text-sm text-foreground-neutral-muted outline-none"
        >
          {statusMessage}
        </p>
      ) : null}
    </>
  );
}
