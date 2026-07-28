import {requireWorkspaceAccess} from '@shipfox/api-auth-context';
import {
  triggerEventListQuerySchema,
  triggerEventListResponseSchema,
} from '@shipfox/api-triggers-dto';
import {decodeTimestampIdCursor, encodeTimestampIdCursor} from '@shipfox/node-drizzle';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {listTriggerEvents} from '#db/index.js';
import {toTriggerEventListItemDto} from '#presentation/dto/trigger-events.js';

export const listTriggerEventsRoute = defineRoute({
  method: 'GET',
  path: '/',
  description: 'List trigger events for a workspace, newest first.',
  schema: {
    querystring: triggerEventListQuerySchema,
    response: {
      200: triggerEventListResponseSchema,
    },
  },
  handler: async (request) => {
    const {
      workspace_id: workspaceId,
      source,
      event,
      outcome: outcomes,
      from,
      to,
      limit,
      cursor,
    } = request.query;

    requireWorkspaceAccess({request, workspaceId});

    const decodedCursor = decodeTimestampIdCursor(cursor);
    if (cursor && !decodedCursor) {
      throw new ClientError('Invalid cursor', 'invalid-cursor', {status: 400});
    }

    const result = await listTriggerEvents({
      workspaceId,
      limit,
      cursor: decodedCursor
        ? {receivedAt: decodedCursor.createdAt, id: decodedCursor.id}
        : undefined,
      filters: {
        source,
        event,
        outcomes,
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
      },
    });

    return {
      trigger_events: result.events.map(toTriggerEventListItemDto),
      next_cursor: result.nextCursor
        ? encodeTimestampIdCursor({
            createdAt: result.nextCursor.receivedAt,
            id: result.nextCursor.id,
          })
        : null,
    };
  },
});
