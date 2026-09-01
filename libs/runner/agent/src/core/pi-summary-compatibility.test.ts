import {copyFileSync, mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Context} from '@earendil-works/pi-ai';
import {fauxAssistantMessage, fauxProvider} from '@earendil-works/pi-ai/providers/faux';
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  generateSummary,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';

const HISTORICAL_SVG_DATA =
  'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjx0ZXh0IHg9IjAiIHk9IjEwIj5IaXN0b3JpY2FsIEJhZGdlPC90ZXh0Pjwvc3ZnPg==';
const DATA_IMAGE_URL_PATTERN = /data:image\/[^,\s]+(?:;[^,\s]*)?,/i;
const FIXTURE_PATH = new URL('./fixtures/pi-summary-image-session.jsonl', import.meta.url);

type SummaryHarness = {
  faux: ReturnType<typeof fauxProvider>;
  model: NonNullable<ReturnType<ModelRuntime['getModel']>>;
  requests: Context[];
  session: Awaited<ReturnType<typeof createAgentSessionFromServices>>['session'];
  sessionManager: SessionManager;
  cleanup: () => void;
};

async function createSummaryHarness(): Promise<SummaryHarness> {
  const root = mkdtempSync(join(tmpdir(), 'shipfox-pi-summary-'));

  try {
    const sessionPath = join(root, 'session.jsonl');
    const agentDir = join(root, 'agent');
    copyFileSync(FIXTURE_PATH, sessionPath);
    mkdirSync(agentDir);

    const faux = fauxProvider({
      provider: 'summary-test',
      api: 'faux-summary',
      models: [
        {
          id: 'summary-model',
          name: 'Summary test model',
          reasoning: false,
          input: ['text', 'image'],
          cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0},
          contextWindow: 128_000,
          maxTokens: 2_048,
        },
      ],
    });
    const modelRuntime = await ModelRuntime.create({refreshOnCreate: false});
    modelRuntime.registerNativeProvider(faux.provider);
    const model = modelRuntime.getModel('summary-test', 'summary-model');
    if (model === undefined) throw new Error('Faux summary model was not registered');

    const settingsManager = SettingsManager.inMemory({
      compaction: {enabled: true, reserveTokens: 100, keepRecentTokens: 100},
      branchSummary: {reserveTokens: 100},
    });
    const services = await createAgentSessionServices({
      cwd: root,
      agentDir,
      modelRuntime,
      settingsManager,
      resourceLoaderOptions: {
        noContextFiles: true,
        noExtensions: true,
        noPromptTemplates: true,
        noSkills: true,
        noThemes: true,
      },
    });
    const sessionManager = SessionManager.open(sessionPath, root, root);
    const {session} = await createAgentSessionFromServices({
      services,
      sessionManager,
      model,
      thinkingLevel: 'off',
      tools: [],
    });

    return {
      faux,
      model,
      requests: [],
      session,
      sessionManager,
      cleanup: () => rmSync(root, {recursive: true, force: true}),
    };
  } catch (error) {
    rmSync(root, {recursive: true, force: true});
    throw error;
  }
}

async function withSummaryHarness(
  callback: (harness: SummaryHarness) => Promise<void>,
): Promise<void> {
  const harness = await createSummaryHarness();

  try {
    await callback(harness);
  } finally {
    harness.session.dispose();
    harness.cleanup();
  }
}

function queueSummaryResponses(harness: SummaryHarness): void {
  const response = (context: Context) => {
    harness.requests.push(context);
    return fauxAssistantMessage('summary response');
  };

  harness.faux.setResponses([response, response, response, response]);
}

function expectHistoricalSvg(harness: SummaryHarness): void {
  const entry = harness.sessionManager.getEntry('historical-tool-result');
  if (entry?.type !== 'message' || entry.message.role !== 'toolResult') {
    throw new Error('Historical SVG tool result fixture was not loaded');
  }

  expect(entry.message.content).toContainEqual({
    type: 'image',
    data: HISTORICAL_SVG_DATA,
    mimeType: 'image/svg+xml',
  });
}

function expectTextOnlySummaryRequests(requests: readonly Context[]): void {
  expect(requests.length).toBeGreaterThan(0);

  for (const context of requests) {
    expect(context.messages).toHaveLength(1);

    const [message] = context.messages;
    expect(message?.role).toBe('user');
    if (message?.role !== 'user') continue;
    if (!Array.isArray(message.content)) throw new Error('Summary payload was not a content array');

    expect(message.content).toEqual([{type: 'text', text: expect.any(String)}]);

    const [block] = message.content;
    if (block?.type !== 'text') continue;
    expect(block.text).not.toMatch(DATA_IMAGE_URL_PATTERN);
    expect(block.text).not.toContain('image/svg+xml');
    expect(block.text).not.toContain(HISTORICAL_SVG_DATA);
  }
}

describe('Pi summarization payloads', () => {
  it('keeps manual compaction payloads text-only for an SVG-bearing historical session', async () => {
    await withSummaryHarness(async (harness) => {
      queueSummaryResponses(harness);
      expectHistoricalSvg(harness);

      const result = await harness.session.compact();

      expect(result.summary).toBe('summary response');
      expect(harness.requests).toHaveLength(1);
      expectTextOnlySummaryRequests(harness.requests);
    });
  });

  it('keeps the shared automatic-compaction summary seam text-only for SVG-bearing history', async () => {
    await withSummaryHarness(async (harness) => {
      queueSummaryResponses(harness);
      expectHistoricalSvg(harness);

      const messages = harness.sessionManager.buildSessionContext().messages;
      const historicalToolResult = messages.find((message) => message.role === 'toolResult');
      if (historicalToolResult?.role !== 'toolResult') {
        throw new Error('Historical SVG tool result was not included in the summary messages');
      }
      expect(historicalToolResult.content).toContainEqual({
        type: 'image',
        data: HISTORICAL_SVG_DATA,
        mimeType: 'image/svg+xml',
      });

      const streamSummary = harness.faux.provider.streamSimple;
      const summary = await generateSummary(
        messages,
        harness.model,
        2_048,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        streamSummary,
      );

      expect(summary).toBe('summary response');
      expectTextOnlySummaryRequests(harness.requests);
    });
  });

  it('keeps branch summarization payloads text-only when abandoned history contains SVG', async () => {
    await withSummaryHarness(async (harness) => {
      queueSummaryResponses(harness);
      expectHistoricalSvg(harness);

      const result = await harness.session.navigateTree('historical-assistant', {summarize: true});

      expect(result.cancelled).toBe(false);
      expect(result.summaryEntry?.type).toBe('branch_summary');
      expect(harness.requests).toHaveLength(1);
      expectTextOnlySummaryRequests(harness.requests);
    });
  });
});
