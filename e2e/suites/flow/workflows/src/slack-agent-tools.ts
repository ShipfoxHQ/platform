import {stopLocalRunner} from '@shipfox/e2e-driver-runner-process';
import {
  attachLocalRunnerLog,
  collectStepLogAttachmentRequests,
  fetchLogAttachment,
} from '#attachments.js';
import {startSuiteLocalRunner, waitForRunTerminalOrFailedRunner} from '#runner.js';
import {triggerSlackAppMentionAndAwaitRun} from '#slack-events.js';
import type {SuiteContext} from '#suite-context.js';
import {seedProjectWithApiDefinition} from '#workflow-project.js';

const TERMINAL_TIMEOUT_MS = 60_000;

export async function runSlackToolsWorkflow(params: {
  suite: SuiteContext;
  attach: (name: string, options: {body: Buffer | string; contentType: string}) => Promise<void>;
  uniqueId: string;
  connectionSlug: string;
  runnerEnv: Record<string, string>;
  botUserId: string;
  teamId: string;
  channel: string;
  threadTs: string;
}) {
  const token = params.suite.sessionToken;
  const scenario = 'slack-agent-tools';
  const runnerLabel = `e2e-${scenario}-${params.uniqueId}`;
  const repo = `${scenario}-${params.uniqueId}`;
  const localRunner = await startSuiteLocalRunner({
    workspaceId: params.suite.workspaceId,
    userToken: token,
    name: `E2E ${scenario} ${params.uniqueId}`,
    runnerLabel,
    extraEnv: {
      ...params.runnerEnv,
      SHIPFOX_POLL_MAX_DURATION_MS: String(TERMINAL_TIMEOUT_MS),
    },
  });

  try {
    // This scenario proves Slack tooling, not definition sync, so it takes the definition
    // straight from the API rather than waiting on gitea and Temporal to produce one.
    const {project} = await seedProjectWithApiDefinition({
      suite: params.suite,
      token,
      name: scenario,
      repo,
      runnerLabel,
      workflowYaml: slackToolsWorkflowYaml(),
      configPath: `.shipfox/workflows/${scenario}.yml`,
      replacements: {__SLACK_SOURCE__: params.connectionSlug},
    });
    const trigger = await triggerSlackAppMentionAndAwaitRun({
      projectId: project.id,
      token,
      teamId: params.teamId,
      channel: params.channel,
      ts: params.threadTs,
      user: `Uuser${params.uniqueId}`,
      text: `<@${params.botUserId}> read this thread and reply`,
    });
    const terminal = await waitForRunTerminalOrFailedRunner({
      runId: trigger.runId,
      token,
      timeoutMs: TERMINAL_TIMEOUT_MS,
      runner: localRunner.runner,
      selection: {
        jobs: [{jobKey: 'tools', includeDefaultExecution: true, stepKeys: ['slack']}],
      },
    });
    if (terminal.status !== 'succeeded') {
      for (const request of collectStepLogAttachmentRequests(terminal)) {
        const attachment = await fetchLogAttachment(request, token);
        await params.attach(attachment.name, {
          body: attachment.body,
          contentType: attachment.contentType,
        });
      }
    }

    return {terminal, eventId: trigger.eventId};
  } finally {
    await attachLocalRunnerLog(
      (attachment) =>
        params.attach(attachment.name, {
          body: attachment.body,
          contentType: attachment.contentType,
        }),
      localRunner.logFile,
    );
    await stopLocalRunner(localRunner.runner).catch((error: unknown) => {
      process.stderr.write(`${scenario}-e2e: stopLocalRunner failed: ${String(error)}\n`);
    });
  }
}

function slackToolsWorkflowYaml(): string {
  return `
name: Slack agent tools
runner: __RUNNER_LABEL__
triggers:
  on_mention:
    source: __SLACK_SOURCE__
    event: app_mention
jobs:
  tools:
    steps:
      - key: slack
        harness: claude
        thinking: low
        prompt: Read the thread and reply.
        integrations:
          - connection: __SLACK_SOURCE__
            include: [read_thread, send_message]
            allow_write: true
`;
}
