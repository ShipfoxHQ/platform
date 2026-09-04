import {message, startFakeOpenAiModelProvider, toolCall} from '@shipfox/e2e-driver-model-provider';
import {createAnthropicFakeModelProviderConfig} from '@shipfox/e2e-setup-agent';
import {createSlackConnection} from '@shipfox/e2e-setup-integrations';
import {runSlackToolsWorkflow} from '#slack-agent-tools.js';
import {SLACK_REPLIES_MARKER, startSlackApiMock} from '#slack-api.js';
import {expect, test} from './fixtures.js';

const CLAUDE_AGENT_MODEL = 'deterministic-slack-tools-agent';
const SLACK_BOT_TOKEN = 'xoxb-e2e-slack-bot-token';

test.describe.configure({mode: 'serial'});

test('starts a run from a signed Slack mention and calls Slack agent tools', async ({
  suite,
}, testInfo) => {
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const teamId = `T${uniqueId}`;
  const channel = `C${uniqueId}`;
  const threadTs = '1721300000.000001';
  const replyText = 'I read the Slack thread.';
  const slackApi = await startSlackApiMock();
  let fakeModelProvider: Awaited<ReturnType<typeof startFakeOpenAiModelProvider>> | undefined;

  try {
    const scriptId = `${suite.runId}-slack-agent-tools-${uniqueId}`;
    fakeModelProvider = await startFakeOpenAiModelProvider({runId: scriptId});
    const connection = await createSlackConnection({
      workspaceId: suite.workspaceId,
      teamId,
      teamName: `E2E Slack ${uniqueId}`,
      appId: `A${uniqueId}`,
      botUserId: `Ubot${uniqueId}`,
      botToken: SLACK_BOT_TOKEN,
      scopes: ['app_mentions:read', 'channels:history', 'chat:write'],
    });
    const repliesTool = `mcp__shipfox_integration_tools__${connection.slug}__read_thread`;
    const postMessageTool = `mcp__shipfox_integration_tools__${connection.slug}__send_message`;
    const fakeAnthropic = await createAnthropicFakeModelProviderConfig({
      workspaceId: suite.workspaceId,
      fakeModelProvider,
      scriptId,
      model: CLAUDE_AGENT_MODEL,
      responses: [
        toolCall(repliesTool, {channel_id: channel, message_ts: threadTs}),
        toolCall(postMessageTool, {channel_id: channel, thread_ts: threadTs, message: replyText}),
        message('done'),
      ],
      assertions: [
        {kind: 'model', equals: CLAUDE_AGENT_MODEL},
        {kind: 'tool_present', name: repliesTool},
        {kind: 'tool_present', name: postMessageTool},
        {
          kind: 'message_content_includes',
          value: SLACK_REPLIES_MARKER,
          minRequestIndex: 1,
        },
      ],
      setAsDefault: true,
    });

    const {terminal} = await runSlackToolsWorkflow({
      suite,
      attach: (name, options) => testInfo.attach(name, options),
      uniqueId,
      connectionSlug: connection.slug,
      runnerEnv: fakeAnthropic.runnerEnv,
      botUserId: `Ubot${uniqueId}`,
      teamId,
      channel,
      threadTs,
    });

    expect(terminal.status).toBe('succeeded');
    expect(terminal.jobs.find((job) => job.key === 'tools')?.status).toBe('succeeded');
    expect(slackApi.endpoint.toString()).toBe(
      new URL(process.env.SLACK_API_BASE_URL ?? 'http://invalid.local').toString(),
    );
    expect(slackApi.calls).toEqual([
      {
        kind: 'conversations.replies',
        authorization: `Bearer ${SLACK_BOT_TOKEN}`,
        channel,
        ts: threadTs,
      },
      {
        kind: 'chat.postMessage',
        authorization: `Bearer ${SLACK_BOT_TOKEN}`,
        channel,
        threadTs,
        text: replyText,
      },
    ]);
    const providerRequests = await fakeModelProvider.getRequests(scriptId);
    expect(providerRequests.some((request) => request.tools.includes(repliesTool))).toBe(true);
    expect(providerRequests.some((request) => request.tools.includes(postMessageTool))).toBe(true);
    expect(providerRequests.every((request) => request.assertion_failures.length === 0)).toBe(true);
  } finally {
    await Promise.all([
      fakeModelProvider?.stop()?.catch((error: unknown) => {
        process.stderr.write(
          `slack-agent-tools-e2e: stopFakeOpenAiModelProvider failed: ${String(error)}\n`,
        );
      }) ?? Promise.resolve(),
      slackApi.stop().catch((error: unknown) => {
        process.stderr.write(`slack-agent-tools-e2e: stopSlackApiMock failed: ${String(error)}\n`);
      }),
    ]);
  }
});
