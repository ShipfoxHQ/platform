import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {
  type LocalRunnerExit,
  type LocalRunnerHandle,
  localRunnerLogTail,
  mintManualRegistrationToken,
  startLocalRunner,
  waitForLocalRunnerExit,
} from '@shipfox/e2e-driver-runner-process';
import {waitForRunTerminal} from '@shipfox/e2e-observe-workflows';
import {suiteRunDir} from './suite-context.js';

function isFailedRunnerExit(exit: LocalRunnerExit): boolean {
  return exit.code !== 0 || exit.signal !== null;
}

export async function startSuiteLocalRunner(params: {
  workspaceId: string;
  userToken: string;
  name: string;
  runnerLabel: string;
  runnerInstanceId?: string | undefined;
  extraEnv?: Record<string, string> | undefined;
  renewableGit?: boolean | undefined;
}): Promise<{runner: LocalRunnerHandle; logFile: string}> {
  const registrationToken = await mintManualRegistrationToken({
    workspaceId: params.workspaceId,
    userToken: params.userToken,
    name: params.name,
    ttlSeconds: 3600,
  });
  const runDir = suiteRunDir();
  const runnerLogDir = join(runDir, 'runners');
  const logFile = join(
    runnerLogDir,
    `${params.runnerLabel}${params.runnerInstanceId === undefined ? '' : `-${params.runnerInstanceId}`}.log`,
  );
  await mkdir(runnerLogDir, {recursive: true});
  return {
    runner: startLocalRunner({
      workspaceId: params.workspaceId,
      registrationToken: registrationToken.raw_token,
      labels: [params.runnerLabel],
      logFile,
      workspaceRoot: join(runDir, 'runner-workspaces', params.runnerLabel),
      extraEnv: {
        ...(params.extraEnv ?? {}),
        ...(params.renewableGit === true ? {SHIPFOX_RUNNER_ENABLE_RENEWABLE_GIT: 'true'} : {}),
      },
    }),
    logFile,
  };
}

export async function waitForRunTerminalOrFailedRunner(params: {
  runId: string;
  token: string;
  timeoutMs: number;
  runner: LocalRunnerHandle;
}): ReturnType<typeof waitForRunTerminal> {
  const runTerminal = waitForRunTerminal({
    runId: params.runId,
    token: params.token,
    timeoutMs: params.timeoutMs,
  });
  const runnerExit = waitForLocalRunnerExit(params.runner);

  const first = await Promise.race([
    runTerminal.then((runDetail) => ({kind: 'run' as const, runDetail})),
    runnerExit.then((exit) => ({kind: 'runner' as const, exit})),
  ]);

  if (first.kind === 'run') return first.runDetail;
  if (!isFailedRunnerExit(first.exit)) return await runTerminal;

  throw new Error(
    `Local runner exited before workflow reached a terminal state (code ${first.exit.code}, signal ${first.exit.signal})${localRunnerLogTail(params.runner.logFile)}`,
  );
}
