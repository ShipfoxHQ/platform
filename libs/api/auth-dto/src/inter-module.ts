import {defineInterModuleContract, type InterModuleClient} from '@shipfox/inter-module';
import {z} from 'zod';
import {adminRoleSchema} from './schemas/admin.js';
import {jobLeaseTokenClaimsSchema} from './schemas/job-lease-token.js';
import {runnerSessionTokenClaimsSchema} from './schemas/runner-session-token.js';

const runnerSessionClaimsSchema = runnerSessionTokenClaimsSchema.omit({
  aud: true,
  iat: true,
  exp: true,
});
const jobLeaseClaimsSchema = jobLeaseTokenClaimsSchema.omit({aud: true, iat: true, exp: true});

export const authInterModuleContract = defineInterModuleContract({
  module: 'auth',
  methods: {
    mintRunnerSessionToken: {
      input: runnerSessionClaimsSchema,
      output: z.object({token: z.string().min(1)}),
    },
    mintJobLeaseToken: {
      input: jobLeaseClaimsSchema,
      output: z.object({token: z.string().min(1)}),
    },
    getCurrentAdminRole: {
      input: z.object({userId: z.string().uuid()}),
      output: z.object({role: adminRoleSchema.nullable()}),
    },
    requireAdminRole: {
      input: z.object({
        userId: z.string().uuid(),
        minimumRole: adminRoleSchema,
      }),
      output: z.object({role: adminRoleSchema}),
      errors: {
        'admin-role-required': z.object({requiredRole: adminRoleSchema}),
      },
    },
  },
});

export type AuthInterModuleClient = InterModuleClient<typeof authInterModuleContract>;
