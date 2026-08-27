import type {AuthInterModuleClient} from '@shipfox/api-auth-dto/inter-module';
import type {
  RunnerLifecycleCapabilitiesDto,
  RunnerToolCapabilitiesDto,
} from '@shipfox/api-runners-dto';
import {canonicalizeLabels} from '@shipfox/runner-labels';
import {
  createRunnerSession,
  createRunnerSessionConsumingActivationToken,
} from '#db/runner-sessions.js';
import type {RunnerSession} from './entities/runner-session.js';
import {EmptyRunnerLabelsError} from './errors.js';
import {sanitizeRunnerLabelsOrThrow} from './runner-labels.js';

export interface RegisterRunnerSessionResult {
  session: RunnerSession;
  sessionToken: string;
  mode: 'manual' | 'activation';
  maxClaims: number | null;
}

export type RunnerRegistrationCredential =
  | {
      kind: 'manual';
      registrationTokenId: string;
      workspaceId: string;
    }
  | {kind: 'activation'; activationTokenId: string; workspaceId: string};

export async function registerRunnerSession(params: {
  auth: AuthInterModuleClient;
  credential: RunnerRegistrationCredential;
  labels: string[];
  toolCapabilities?: RunnerToolCapabilitiesDto | null;
  lifecycleCapabilities?: RunnerLifecycleCapabilitiesDto | null;
}): Promise<RegisterRunnerSessionResult> {
  const labels =
    params.credential.kind === 'manual'
      ? sanitizeRunnerLabelsOrThrow(params.labels, {
          scope: 'manual',
          source: 'manual runner registration',
        })
      : [...canonicalizeLabels(params.labels)];
  if (labels.length === 0) throw new EmptyRunnerLabelsError();

  const mode = params.credential.kind;
  const maxClaims = params.credential.kind === 'manual' ? null : 1;
  const session =
    params.credential.kind === 'manual'
      ? await createRunnerSession({
          workspaceId: params.credential.workspaceId,
          scope: 'workspace',
          registrationTokenId: params.credential.registrationTokenId,
          labels,
          toolCapabilities: params.toolCapabilities ?? null,
          lifecycleCapabilities: params.lifecycleCapabilities ?? null,
        })
      : await createRunnerSessionConsumingActivationToken({
          activationTokenId: params.credential.activationTokenId,
          labels,
          toolCapabilities: params.toolCapabilities ?? null,
          lifecycleCapabilities: params.lifecycleCapabilities ?? null,
        });
  const {token: sessionToken} = await params.auth.mintRunnerSessionToken({
    runnerSessionId: session.id,
    workspaceId: session.workspaceId,
    scope: session.scope,
    labels: session.labels,
    maxClaims,
    ...(session.lifecycleCapabilities !== null
      ? {lifecycleCapabilities: session.lifecycleCapabilities}
      : {}),
  });

  return {session, sessionToken, mode, maxClaims};
}
