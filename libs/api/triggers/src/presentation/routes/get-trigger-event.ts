import {requireWorkspaceResourceAccess} from '@shipfox/api-auth-context';
import {triggerEventDetailResponseSchema} from '@shipfox/api-triggers-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {getTriggerEventById, listDecisionsByReceivedEventId} from '#db/index.js';
import {toTriggerDecisionDto, toTriggerEventDto} from '#presentation/dto/trigger-events.js';

export const getTriggerEventRoute = defineRoute({
  method: 'GET',
  path: '/:id',
  description: 'Get a trigger event by ID with its routing decisions.',
  schema: {
    params: z.object({
      id: z.string().uuid(),
    }),
    response: {
      200: triggerEventDetailResponseSchema,
    },
  },
  handler: async (request) => {
    const {id} = request.params;

    const event = await getTriggerEventById(id);
    // Missing events and memberships remain 404 to avoid leaking existence; lifecycle claims
    // propagate their stable access errors.
    if (!event) {
      throw new ClientError('Trigger event not found', 'not-found', {status: 404});
    }
    requireWorkspaceResourceAccess({
      request,
      workspaceId: event.workspaceId,
      notFoundError: new ClientError('Trigger event not found', 'not-found', {status: 404}),
    });

    const decisions = await listDecisionsByReceivedEventId(event.id);

    return {
      ...toTriggerEventDto(event),
      decisions: decisions.map(toTriggerDecisionDto),
    };
  },
});
