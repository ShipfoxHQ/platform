import {
  AUTH_LEASED_JOB,
  AUTH_PROVISIONER_TOKEN,
  AUTH_RUNNER_REGISTRATION_TOKEN,
  AUTH_RUNNER_SESSION,
  AUTH_USER,
} from '@shipfox/api-auth-context';
import type {AuthInterModuleClient} from '@shipfox/api-auth-dto/inter-module';
import type {RouteGroup} from '@shipfox/node-fastify';
import type {CreateRunnersModuleOptions} from '#installation-provisioning.js';
import {createAdminProvisionerTokenRoutes} from './admin-provisioner-tokens.js';
import {createAdminRunnerInstancesRoute} from './admin-runner-instances.js';
import {assignRunnerInstancesRoute} from './assign-runner-instances.js';
import {createManualRegistrationTokenRoute} from './create-manual-registration-token.js';
import {createProvisionerTokenRoute} from './create-provisioner-token.js';
import {getProvisionerMeRoute} from './get-provisioner-me.js';
import {createHeartbeatRoute} from './heartbeat.js';
import {listActiveProvisionersRoute} from './list-active-provisioners.js';
import {listActiveRunnersRoute} from './list-active-runners.js';
import {listManualRegistrationTokensRoute} from './list-manual-registration-tokens.js';
import {listProvisionerTokensRoute} from './list-provisioner-tokens.js';
import {createPollDemandRoute, pollDemandRoute} from './poll-demand.js';
import {reconcileRunnerInstancesRoute} from './reconcile-runner-instances.js';
import {createRegisterRoute} from './register.js';
import {reportRunnerInstancesRoute} from './report-runner-instances.js';
import {createRequestJobRoute} from './request-job.js';
import {revokeManualRegistrationTokenRoute} from './revoke-manual-registration-token.js';
import {revokeProvisionerTokenRoute} from './revoke-provisioner-token.js';
import {
  attachRunnerControlProviderIdRoute,
  attachRunnerInstanceProviderIdRoute,
  createRunnerInstancesRoute,
  enrollRunnerRoute,
  exchangeRunnerBootstrapRoute,
  runnerAssignmentPollRoute,
  runnerControlHeartbeatRoute,
} from './runner-enrollment.js';

function createRunnerOnlyRoutes(auth: AuthInterModuleClient): RouteGroup[] {
  return [
    {
      prefix: '/workspaces/:workspaceId/runners/manual-registration-tokens',
      auth: AUTH_USER,
      routes: [
        listManualRegistrationTokensRoute,
        createManualRegistrationTokenRoute,
        revokeManualRegistrationTokenRoute,
      ],
    },
    {
      prefix: '/workspaces/:workspaceId/runners/active',
      auth: AUTH_USER,
      routes: [listActiveRunnersRoute],
    },
    {
      prefix: '/runners',
      auth: AUTH_RUNNER_REGISTRATION_TOKEN,
      routes: [createRegisterRoute(auth)],
    },
    {
      prefix: '/runners/jobs',
      auth: AUTH_RUNNER_SESSION,
      routes: [createRequestJobRoute(auth)],
    },
    {
      prefix: '/runners/jobs',
      auth: AUTH_LEASED_JOB,
      routes: [createHeartbeatRoute(auth)],
    },
    {
      prefix: '/provisioners',
      auth: AUTH_PROVISIONER_TOKEN,
      routes: [
        pollDemandRoute,
        createRunnerInstancesRoute,
        attachRunnerInstanceProviderIdRoute,
        assignRunnerInstancesRoute,
        reportRunnerInstancesRoute,
        reconcileRunnerInstancesRoute,
      ],
    },
    {
      prefix: '/admin/runners/instances',
      auth: AUTH_USER,
      routes: [createAdminRunnerInstancesRoute(auth)],
    },
    createAdminProvisionerTokenRoutes(auth),
  ];
}

const runnerControlRoutes: RouteGroup[] = [
  {prefix: '/runner-enrollment', routes: [exchangeRunnerBootstrapRoute]},
  {
    prefix: '/runner-control',
    routes: [
      enrollRunnerRoute,
      attachRunnerControlProviderIdRoute,
      runnerControlHeartbeatRoute,
      runnerAssignmentPollRoute,
    ],
  },
];

export const provisionerRoutes: RouteGroup[] = [
  {
    prefix: '/workspaces/:workspaceId/provisioners/tokens',
    auth: AUTH_USER,
    routes: [listProvisionerTokensRoute, createProvisionerTokenRoute, revokeProvisionerTokenRoute],
  },
  {
    prefix: '/workspaces/:workspaceId/provisioners/active',
    auth: AUTH_USER,
    routes: [listActiveProvisionersRoute],
  },
  {
    prefix: '/provisioners',
    auth: AUTH_PROVISIONER_TOKEN,
    routes: [getProvisionerMeRoute],
  },
];

export function createRunnerRoutes(
  auth: AuthInterModuleClient,
  options: CreateRunnersModuleOptions = {},
): RouteGroup[] {
  const runnerOnlyRoutes = createRunnerOnlyRoutes(auth);
  return [
    ...runnerOnlyRoutes.map((route) =>
      route.routes.includes(pollDemandRoute)
        ? {
            ...route,
            routes: route.routes.map((r) =>
              r === pollDemandRoute ? createPollDemandRoute(options) : r,
            ),
          }
        : route,
    ),
    ...runnerControlRoutes,
    ...provisionerRoutes,
  ];
}
