import {requireWorkspaceAccess} from '@shipfox/api-auth-context';
import {listActiveProvisionersResponseSchema} from '@shipfox/api-runners-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {installationRunnersStatus, listActiveProvisioners} from '#core/index.js';
import {toActiveProvisionerDto} from '#presentation/dto/index.js';

type InstallationRunnersStatusReader = () => ReturnType<typeof installationRunnersStatus>;

export function createListActiveProvisionersRoute(
  readInstallationRunnersStatus: InstallationRunnersStatusReader = installationRunnersStatus,
) {
  return defineRoute({
    method: 'GET',
    path: '/',
    description: 'List active provisioners for a workspace',
    schema: {
      params: z.object({workspaceId: z.string().uuid()}),
      response: {
        200: listActiveProvisionersResponseSchema,
      },
    },
    handler: async (request) => {
      const {workspaceId} = request.params;
      requireWorkspaceAccess({request, workspaceId});

      const [provisioners, installationRunners] = await Promise.all([
        listActiveProvisioners(workspaceId),
        readInstallationRunnersStatus().catch((error: unknown) => {
          request.log.warn({err: error}, 'Could not resolve installation runner status');
          return 'none' as const;
        }),
      ]);
      return {
        provisioners: provisioners.map(toActiveProvisionerDto),
        installation_runners: installationRunners,
      };
    },
  });
}

export const listActiveProvisionersRoute = createListActiveProvisionersRoute();
