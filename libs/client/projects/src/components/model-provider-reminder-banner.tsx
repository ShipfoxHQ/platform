import {useModelProviderConfigsQuery} from '@shipfox/client-agent';
import {useActiveWorkspace} from '@shipfox/client-auth';
import {createTypedBrowserStorage, sessionStorageOrUndefined} from '@shipfox/client-ui';
import {
  Alert,
  AlertActions,
  AlertClose,
  AlertContent,
  AlertDescription,
  AlertTitle,
} from '@shipfox/react-ui/alert';
import {Button} from '@shipfox/react-ui/button';
import {Link} from '@tanstack/react-router';
import {useState} from 'react';

export function ModelProviderReminderBanner({workspaceId}: {workspaceId: string}) {
  const workspace = useActiveWorkspace();
  const configsQuery = useModelProviderConfigsQuery(workspaceId);
  const [dismissed, setDismissed] = useState(() => isReminderDismissed(workspaceId));
  const configs = configsQuery.data?.configs;
  const unconfigured =
    Array.isArray(configs) && configs.length === 0 && configsQuery.data?.defaultProviderId === null;

  if (!unconfigured || dismissed) return null;

  return (
    <Alert
      variant="info"
      animated={false}
      onOpenChange={(open) => {
        if (!open) {
          dismissReminder(workspaceId);
          setDismissed(true);
        }
      }}
    >
      <AlertContent className="pr-[28px]">
        <AlertTitle>Finish setting up a model provider</AlertTitle>
        <AlertDescription>
          Add workspace credentials, or keep using the instance default.
        </AlertDescription>
        <AlertActions>
          <Button asChild size="sm" variant="secondary">
            <Link to="/w/$workspaceSlug/settings/agents" params={{workspaceSlug: workspace.slug}}>
              Agents
            </Link>
          </Button>
        </AlertActions>
      </AlertContent>
      <AlertClose />
    </Alert>
  );
}

function isReminderDismissed(workspaceId: string): boolean {
  return reminderStorage(workspaceId).read() === true;
}

function dismissReminder(workspaceId: string): void {
  reminderStorage(workspaceId).write(true);
}

function reminderStorage(workspaceId: string) {
  return createTypedBrowserStorage(
    sessionStorageOrUndefined,
    {
      key: 'shipfox.modelProviderReminder.dismissed',
      lifetime: 'session' as const,
      principalScope: 'workspace' as const,
      serialize: (dismissed: boolean) => JSON.stringify(dismissed),
      parse: (raw: string) => raw === 'true',
    },
    {workspaceId},
  );
}
