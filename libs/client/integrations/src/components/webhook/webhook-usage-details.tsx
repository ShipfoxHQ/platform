import {QueryLoadError} from '@shipfox/client-ui';
import {ShipfoxLoader} from '@shipfox/react-ui/loader';
import {Text} from '@shipfox/react-ui/typography';
import {useWebhookConnectionsQuery} from '#hooks/api/webhook-connections.js';
import {CopyableValue} from './copyable-value.js';
import {WebhookPublicEndpointAlert} from './webhook-public-endpoint-alert.js';

interface WebhookUsageDetailsProps {
  workspaceId: string;
  connectionId: string;
}

export function WebhookUsageDetails({workspaceId, connectionId}: WebhookUsageDetailsProps) {
  const connectionsQuery = useWebhookConnectionsQuery(workspaceId);
  const connection = connectionsQuery.data?.find((candidate) => candidate.id === connectionId);

  if (connectionsQuery.isPending) {
    return (
      <div className="flex min-h-80 items-center justify-center">
        <ShipfoxLoader size={32} animation="circular" color="orange" background="light" />
      </div>
    );
  }

  if (connectionsQuery.isError && connectionsQuery.data === undefined) {
    return <QueryLoadError query={connectionsQuery} subject="webhook details" />;
  }

  if (!connection) return null;

  return (
    <div className="flex w-full flex-col gap-group">
      <div className="flex w-full min-w-0 flex-col gap-inline">
        <Text size="sm" bold>
          Inbound URL
        </Text>
        <CopyableValue label="inbound URL" value={connection.inboundUrl} />
        <WebhookPublicEndpointAlert />
      </div>
    </div>
  );
}
