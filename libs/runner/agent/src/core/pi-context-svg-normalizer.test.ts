import {copyFileSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Context, ImageContent} from '@earendil-works/pi-ai';
import {fauxAssistantMessage, fauxProvider} from '@earendil-works/pi-ai/providers/faux';
import type {ContextEvent, ExtensionAPI} from '@earendil-works/pi-coding-agent';
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import {
  closePiSvgRasterizer,
  type SvgRasterizationReason,
  type SvgRasterizationResult,
} from './pi-image-rasterizer.js';
import {
  createPiToolSvgNormalizerExtension,
  PI_IMAGE_OMISSION_PLACEHOLDER,
  type PiToolSvgNormalizerOptions,
} from './pi-tool-svg-normalizer.js';

const HISTORICAL_SVG_DATA =
  'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjx0ZXh0IHg9IjAiIHk9IjEwIj5IaXN0b3JpY2FsIEJhZGdlPC90ZXh0Pjwvc3ZnPg==';
const PNG_DATA = 'cG5n';
const FIXTURE_PATH = new URL('./fixtures/pi-context-image-session.jsonl', import.meta.url);

type PiContextMessage = ContextEvent['messages'][number];
type Rasterizer = NonNullable<PiToolSvgNormalizerOptions['rasterize']>;
type ExtensionHandler = (event: unknown) => unknown;

afterEach(async () => {
  await closePiSvgRasterizer();
});

describe('Pi historical context SVG normalizer', () => {
  it('normalizes every typed provider-bound content variant without rewriting message fields', async () => {
    const rasterize = vi.fn<Rasterizer>(async () => convertedResult());
    const handlers = extensionHandlers({rasterize});
    const contextHandler = requiredHandler(handlers, 'context');
    const sharedSvg = encodedSvg('shared');
    const nestedImage = image(sharedSvg, 'image/svg+xml');
    const originalMessages = [
      {
        role: 'user',
        content: [
          {type: 'text', text: 'before'},
          image(sharedSvg, 'image/svg+xml; charset=utf-8'),
          image('jpg-data', 'image/jpg; quality=1'),
          image('png-data', 'image/png'),
          image('webp-data', 'image/webp'),
          image('gif-data', 'image/gif'),
          image('bmp-data', 'image/bmp'),
          {type: 'text', text: 'after'},
        ],
        timestamp: 1,
      },
      {
        role: 'assistant',
        content: [{type: 'text', text: 'assistant content'}],
        api: 'faux-context',
        provider: 'context-test',
        model: 'context-model',
        usage: usage(),
        stopReason: 'stop',
        timestamp: 2,
      },
      {
        role: 'custom',
        customType: 'historical-image',
        content: [nestedImage, image('tiff-data', 'image/tiff')],
        details: {nestedImage},
        display: false,
        timestamp: 3,
      },
      {
        role: 'toolResult',
        toolCallId: 'call-1',
        toolName: 'image-tool',
        content: [image(sharedSvg, 'image/svg+xml')],
        details: {nestedImage},
        isError: false,
        timestamp: 4,
      },
      {role: 'branchSummary', summary: sharedSvg, fromId: 'branch', timestamp: 5},
    ] as unknown as PiContextMessage[];
    const originalSnapshot = structuredClone(originalMessages);

    const result = (await contextHandler({
      type: 'context',
      messages: originalMessages,
    } satisfies ContextEvent)) as {messages: PiContextMessage[]};

    const [user, assistant, custom, toolResult, branchSummary] = result.messages;
    expect(user?.role).toBe('user');
    if (user?.role === 'user') {
      expect(user.content).toEqual([
        {type: 'text', text: 'before'},
        image(PNG_DATA, 'image/png'),
        image('jpg-data', 'image/jpeg'),
        image('png-data', 'image/png'),
        image('webp-data', 'image/webp'),
        image('gif-data', 'image/gif'),
        {type: 'text', text: PI_IMAGE_OMISSION_PLACEHOLDER},
        {type: 'text', text: 'after'},
      ]);
    }
    expect(assistant).toEqual(originalMessages[1]);
    expect(custom?.role).toBe('custom');
    if (custom?.role === 'custom') {
      expect(custom.content).toEqual([
        image(PNG_DATA, 'image/png'),
        {type: 'text', text: PI_IMAGE_OMISSION_PLACEHOLDER},
      ]);
      expect(custom.details).toEqual({nestedImage});
    }
    expect(toolResult?.role).toBe('toolResult');
    if (toolResult?.role === 'toolResult') {
      expect(toolResult.content).toEqual([image(PNG_DATA, 'image/png')]);
      expect(toolResult.details).toEqual({nestedImage});
    }
    expect(branchSummary).toBe(originalMessages[4]);
    expect(originalMessages).toEqual(originalSnapshot);
    expect(rasterize).toHaveBeenCalledTimes(1);
  });

  it('omits malformed historical image blocks instead of forwarding them', async () => {
    const handlers = extensionHandlers();
    const contextHandler = requiredHandler(handlers, 'context');
    const malformedSvg = {type: 'image', data: 12345, mimeType: 'image/svg+xml'};
    const malformedMime = {type: 'image', data: encodedSvg('malformed'), mimeType: null};
    const message = {
      role: 'user',
      content: [{type: 'text', text: 'before'}, malformedSvg, malformedMime],
      timestamp: 1,
    } as unknown as PiContextMessage;

    const result = (await contextHandler(contextEvent([message]))) as {
      messages: PiContextMessage[];
    };

    expect(result.messages[0]).toMatchObject({
      role: 'user',
      content: [
        {type: 'text', text: 'before'},
        {type: 'text', text: PI_IMAGE_OMISSION_PLACEHOLDER},
        {type: 'text', text: PI_IMAGE_OMISSION_PLACEHOLDER},
      ],
    });
    expect(message).toMatchObject({
      content: [{type: 'text', text: 'before'}, malformedSvg, malformedMime],
    });
  });

  it('uses the conservative context fallback if the hook fails before rasterization', async () => {
    const warnUnexpectedFailure = vi.fn();
    const now = vi.fn(() => {
      throw new Error('clock failure');
    });
    const handlers = extensionHandlers({now, warnUnexpectedFailure});
    const contextHandler = requiredHandler(handlers, 'context');
    const event = contextEvent([
      {
        role: 'user',
        content: [{type: 'text', text: 'keep me'}, image(encodedSvg('fallback'), 'image/svg+xml')],
        timestamp: 1,
      } as PiContextMessage,
    ]);

    const result = (await contextHandler(event)) as {messages: PiContextMessage[]};

    expect(result.messages[0]).toMatchObject({
      role: 'user',
      content: [
        {type: 'text', text: 'keep me'},
        {type: 'text', text: PI_IMAGE_OMISSION_PLACEHOLDER},
      ],
    });
    expect(warnUnexpectedFailure).toHaveBeenCalledWith('legacy_context', 'render_error');
  });

  it('reuses converted context images and clears the cache at session shutdown', async () => {
    const rasterize = vi.fn<Rasterizer>(async () => convertedResult());
    const recordNormalization = vi.fn();
    const handlers = extensionHandlers({rasterize, recordNormalization});
    const contextHandler = requiredHandler(handlers, 'context');
    const shutdownHandler = requiredHandler(handlers, 'session_shutdown');
    const event = contextEvent([messageWithSvg(encodedSvg('cached'))]);

    await contextHandler(event);
    await contextHandler(event);
    expect(rasterize).toHaveBeenCalledTimes(1);
    expect(recordNormalization).toHaveBeenCalledTimes(1);
    expect(recordNormalization).toHaveBeenCalledWith('converted', 'none', 'legacy_context');

    await shutdownHandler({type: 'session_shutdown', reason: 'quit'});
    await contextHandler(event);

    expect(rasterize).toHaveBeenCalledTimes(2);
    expect(recordNormalization).toHaveBeenCalledTimes(2);
  });

  it('does not retain transient rasterizer outcomes but caches stable omissions', async () => {
    const timeoutSvg = encodedSvg('timeout');
    const unavailableSvg = encodedSvg('unavailable');
    const stableSvg = encodedSvg('stable');
    const rasterize = vi
      .fn<Rasterizer>()
      .mockResolvedValueOnce(omittedResult('render_timeout'))
      .mockResolvedValueOnce(convertedResult())
      .mockResolvedValueOnce(omittedResult('rasterizer_unavailable'))
      .mockResolvedValueOnce(convertedResult())
      .mockResolvedValueOnce(omittedResult('invalid_base64'));
    const handlers = extensionHandlers({rasterize});
    const contextHandler = requiredHandler(handlers, 'context');

    await contextHandler(contextEvent([messageWithSvgs([timeoutSvg, timeoutSvg])]));
    await contextHandler(contextEvent([messageWithSvg(timeoutSvg)]));
    await contextHandler(contextEvent([messageWithSvg(unavailableSvg)]));
    await contextHandler(contextEvent([messageWithSvg(unavailableSvg)]));
    await contextHandler(contextEvent([messageWithSvg(stableSvg)]));
    await contextHandler(contextEvent([messageWithSvg(stableSvg)]));

    expect(rasterize).toHaveBeenCalledTimes(5);
  });

  it('keeps the legacy context budget stable across repeated provider passes', async () => {
    const rasterize = vi.fn<Rasterizer>(async () => convertedResult());
    const handlers = extensionHandlers({rasterize});
    const contextHandler = requiredHandler(handlers, 'context');
    const messages = Array.from({length: 21}, (_, index) =>
      messageWithSvg(encodedSvg(`budget-${index}`)),
    );

    const firstContext = await contextHandler(contextEvent(messages));
    const secondContext = await contextHandler(contextEvent(messages));

    expect(rasterize).toHaveBeenCalledTimes(20);
    expect(firstContext).toEqual(secondContext);
    const lastMessage = firstContext.messages.at(-1);
    expect(lastMessage?.role).toBe('user');
    if (lastMessage?.role === 'user') {
      expect(lastMessage.content).toEqual([{type: 'text', text: PI_IMAGE_OMISSION_PLACEHOLDER}]);
    }
  });

  it('evicts the least recently used historical conversion after 32 entries', async () => {
    const rasterize = vi.fn<Rasterizer>(async () => convertedResult());
    const handlers = extensionHandlers({rasterize});
    const contextHandler = requiredHandler(handlers, 'context');
    const messages = Array.from({length: 32}, (_, index) =>
      messageWithSvg(encodedSvg(`entry-${index}`)),
    );

    for (const message of messages) await contextHandler(contextEvent([message]));
    await contextHandler(contextEvent([messages[0] as PiContextMessage]));
    await contextHandler(contextEvent([messageWithSvg(encodedSvg('entry-32'))]));
    await contextHandler(contextEvent([messages[0] as PiContextMessage]));
    await contextHandler(contextEvent([messages[1] as PiContextMessage]));

    expect(rasterize).toHaveBeenCalledTimes(34);
  });

  it('evicts historical conversions by encoded output bytes', async () => {
    const largePng = new Uint8Array(12 * 1024 * 1024);
    const rasterize = vi.fn<Rasterizer>(async () => ({
      ...convertedResult(),
      png: largePng,
      outputBytes: largePng.byteLength,
    }));
    const handlers = extensionHandlers({rasterize});
    const contextHandler = requiredHandler(handlers, 'context');

    await contextHandler(contextEvent([messageWithSvg(encodedSvg('bytes-0'))]));
    await contextHandler(contextEvent([messageWithSvg(encodedSvg('bytes-1'))]));
    await contextHandler(contextEvent([messageWithSvg(encodedSvg('bytes-2'))]));
    await contextHandler(contextEvent([messageWithSvg(encodedSvg('bytes-0'))]));

    expect(rasterize).toHaveBeenCalledTimes(4);
  });

  it('guards a resumed fixture at provider egress while leaving its session file unchanged', async () => {
    const root = mkdtempSync(join(tmpdir(), 'shipfox-pi-context-'));
    const sessionPath = join(root, 'session.jsonl');
    copyFileSync(FIXTURE_PATH, sessionPath);
    const requests: Context[] = [];
    const faux = fauxProvider({
      provider: 'context-test',
      api: 'faux-context',
      models: [
        {
          id: 'context-model',
          name: 'Context test model',
          input: ['text', 'image'],
          reasoning: false,
          cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0},
          contextWindow: 128_000,
          maxTokens: 2_048,
        },
      ],
    });

    let session: Awaited<ReturnType<typeof createAgentSessionFromServices>>['session'] | undefined;
    try {
      const modelRuntime = await ModelRuntime.create({refreshOnCreate: false});
      modelRuntime.registerNativeProvider(faux.provider);
      const model = modelRuntime.getModel('context-test', 'context-model');
      if (model === undefined) throw new Error('Context test model was not registered');

      const services = await createAgentSessionServices({
        cwd: root,
        agentDir: root,
        modelRuntime,
        settingsManager: SettingsManager.inMemory(),
        resourceLoaderOptions: {
          noContextFiles: true,
          noExtensions: true,
          noPromptTemplates: true,
          noSkills: true,
          noThemes: true,
          extensionFactories: [createPiToolSvgNormalizerExtension()],
        },
      });
      const sessionManager = SessionManager.open(sessionPath, root, root);
      const created = await createAgentSessionFromServices({
        services,
        sessionManager,
        model,
        thinkingLevel: 'off',
        tools: [],
      });
      session = created.session;
      await session.bindExtensions({mode: 'print'});

      const before = readFileSync(sessionPath, 'utf8');
      const firstContext = await session.extensionRunner.emitContext(session.messages);
      const secondContext = await session.extensionRunner.emitContext(session.messages);

      expect(readFileSync(sessionPath, 'utf8')).toBe(before);
      expect(firstContext).toEqual(secondContext);
      expectContextMessagesToContainPng(firstContext);

      faux.setResponses([
        (context) => {
          requests.push(context);
          return fauxAssistantMessage('done');
        },
      ]);
      await session.prompt('Continue from the historical fixture.');

      expect(requests).toHaveLength(1);
      const [request] = requests;
      if (request === undefined) throw new Error('Faux provider request was not captured');
      expectProviderContextToBeImageSafe(request);
      expectContextMessagesToContainPng(request.messages);
      expect(JSON.stringify(request)).not.toContain('12345');
      expect(readFileSync(sessionPath, 'utf8')).toContain(HISTORICAL_SVG_DATA);
    } finally {
      session?.dispose();
      rmSync(root, {recursive: true, force: true});
    }
  }, 15_000);
});

function convertedResult(): Extract<SvgRasterizationResult, {outcome: 'converted'}> {
  return {
    outcome: 'converted',
    png: Buffer.from(PNG_DATA, 'base64'),
    width: 1,
    height: 1,
    inputBytes: 1,
    outputBytes: 3,
    durationMs: 1,
  };
}

function omittedResult(
  reason: SvgRasterizationReason,
): Extract<SvgRasterizationResult, {outcome: 'omitted'}> {
  return {outcome: 'omitted', reason, durationMs: 1};
}

function encodedSvg(label: string): string {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><text x="2" y="20">${label}</text></svg>`,
  ).toString('base64');
}

function image(data: string, mimeType: string): ImageContent {
  return {type: 'image', data, mimeType};
}

function usage(): Record<string, unknown> {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
  };
}

function messageWithSvg(svg: string): PiContextMessage {
  return messageWithSvgs([svg]);
}

function messageWithSvgs(svgs: readonly string[]): PiContextMessage {
  return {
    role: 'user',
    content: svgs.map((svg) => image(svg, 'image/svg+xml')),
    timestamp: 1,
  } as PiContextMessage;
}

function contextEvent(messages: PiContextMessage[]): ContextEvent {
  return {type: 'context', messages};
}

function expectProviderContextToBeImageSafe(context: Context): void {
  for (const message of context.messages) {
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block.type !== 'image') continue;
      expect(block.mimeType).not.toBe('image/svg+xml');
      expect(block.data).not.toBe(HISTORICAL_SVG_DATA);
    }
  }
}

function expectContextMessagesToContainPng(messages: readonly PiContextMessage[]): void {
  const hasPng = messages.some(
    (message) =>
      Array.isArray(message.content) &&
      message.content.some((block) => block.type === 'image' && block.mimeType === 'image/png'),
  );
  expect(hasPng).toBe(true);
}

function extensionHandlers(
  options: PiToolSvgNormalizerOptions = {},
): Map<string, ExtensionHandler> {
  const handlers = new Map<string, ExtensionHandler>();
  const api = {
    on: (event: string, handler: ExtensionHandler) => handlers.set(event, handler),
  } as unknown as ExtensionAPI;
  const extension = createPiToolSvgNormalizerExtension(options);
  if (typeof extension === 'function') throw new Error('Expected an inline extension object');
  extension.factory(api);
  return handlers;
}

function requiredHandler(handlers: Map<string, ExtensionHandler>, name: string): ExtensionHandler {
  const handler = handlers.get(name);
  if (handler === undefined) throw new Error(`Missing ${name} extension handler`);
  return handler;
}
