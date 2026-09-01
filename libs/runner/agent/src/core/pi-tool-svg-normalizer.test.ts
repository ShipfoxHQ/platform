import {once} from 'node:events';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {createServer, type Server as HttpServer} from 'node:http';
import {tmpdir} from 'node:os';
import type {ImageContent} from '@earendil-works/pi-ai';
import type {ContextEvent, ExtensionAPI, ToolResultEvent} from '@earendil-works/pi-coding-agent';
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import {Type} from 'typebox';
import type {SvgRasterizationResult} from './pi-image-rasterizer.js';
import {closePiSvgRasterizer} from './pi-image-rasterizer.js';
import {
  createPiToolSvgNormalizer,
  createPiToolSvgNormalizerExtension,
  PI_IMAGE_OMISSION_PLACEHOLDER,
  type PiImageContent,
  type PiToolSvgNormalizerOptions,
} from './pi-tool-svg-normalizer.js';

const PNG_BYTES = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ONE_PIXEL_BMP =
  'Qk06AAAAAAAAADYAAAAoAAAAAQAAAAEAAAABABgAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAD/AA==';
const ONE_PIXEL_JPEG =
  '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgj/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABykX//Z';
const FIXTURE_PATH = new URL('./fixtures/pi-linear-three-badges.json', import.meta.url);
const LINEAR_BADGE_FIXTURE = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as {
  toolName: string;
  content: PiImageContent[];
};

afterEach(async () => {
  await closePiSvgRasterizer();
});

type Rasterizer = NonNullable<PiToolSvgNormalizerOptions['rasterize']>;
type ExtensionHandler = (event: unknown) => unknown;

describe('Pi tool SVG normalizer', () => {
  it('converts SVG blocks after canonical MIME classification and preserves order', async () => {
    const svg = encodedSvg('first');
    const rasterize = vi.fn<Rasterizer>(async () => convertedResult());
    const normalizer = createPiToolSvgNormalizer({rasterize});
    const original: PiImageContent[] = [
      {type: 'text', text: 'before'},
      {type: 'image', data: svg, mimeType: ' IMAGE/SVG+XML ; charset=utf-8'},
      {type: 'image', data: 'not base64', mimeType: 'image/bmp'},
      {type: 'text', text: 'after'},
    ];

    const result = await normalizer.normalizeToolResult(original);

    expect(result).toEqual([
      {type: 'text', text: 'before'},
      {type: 'image', data: Buffer.from(PNG_BYTES).toString('base64'), mimeType: 'image/png'},
      original[2],
      {type: 'text', text: 'after'},
    ]);
    expect(result).not.toBe(original);
    expect(original[1]).toEqual({
      type: 'image',
      data: svg,
      mimeType: ' IMAGE/SVG+XML ; charset=utf-8',
    });
    expect(rasterize).toHaveBeenCalledWith({base64: svg, deadlineMs: expect.any(Number)});
  });

  it('leaves every non-SVG tool-result image untouched without decoding it', async () => {
    const rasterize = vi.fn<Rasterizer>(async () => convertedResult());
    const normalizer = createPiToolSvgNormalizer({rasterize});
    const content: PiImageContent[] = [
      {type: 'image', data: 'not base64', mimeType: 'image/png'},
      {type: 'image', data: 'also not base64', mimeType: 'image/jpg; quality=1'},
      {type: 'image', data: 'still not base64', mimeType: 'IMAGE/BMP'},
      {type: 'image', data: 'not base64 either', mimeType: 'image/tiff'},
    ];

    const result = await normalizer.normalizeToolResult(content);

    expect(result).toBe(content);
    expect(result).toEqual(content);
    expect(rasterize).not.toHaveBeenCalled();
  });

  it('normalizes legacy context images while preserving unrelated messages', async () => {
    const svg = encodedSvg('legacy');
    const rasterize = vi.fn<Rasterizer>(async () => convertedResult());
    const normalizer = createPiToolSvgNormalizer({rasterize});
    const userMessage = {
      role: 'user',
      content: [
        {type: 'text', text: 'context'},
        {type: 'image', data: svg, mimeType: 'image/svg+xml; charset=utf-8'},
        {type: 'image', data: 'jpg bytes', mimeType: 'IMAGE/JPG; quality=1'},
        {type: 'image', data: 'png bytes', mimeType: 'image/png'},
        {type: 'image', data: 'bmp bytes', mimeType: 'image/bmp'},
      ],
      timestamp: 1,
    } as ContextEvent['messages'][number];
    const assistantMessage = {
      role: 'assistant',
      content: [{type: 'text', text: 'assistant'}],
      timestamp: 2,
    } as unknown as ContextEvent['messages'][number];
    const messages = [userMessage, assistantMessage] as ContextEvent['messages'];

    const result = await normalizer.normalizeContext(messages);

    expect(result).toHaveLength(2);
    expect(result[1]).toBe(assistantMessage);
    expect(result[0]).toMatchObject({role: 'user', timestamp: 1});
    if (result[0]?.role !== 'user' || !Array.isArray(result[0].content)) return;
    expect(result[0].content).toEqual([
      {type: 'text', text: 'context'},
      {type: 'image', data: Buffer.from(PNG_BYTES).toString('base64'), mimeType: 'image/png'},
      {type: 'image', data: 'jpg bytes', mimeType: 'image/jpeg'},
      {type: 'image', data: 'png bytes', mimeType: 'image/png'},
      {type: 'text', text: PI_IMAGE_OMISSION_PLACEHOLDER},
    ]);
    expect(rasterize).toHaveBeenCalledTimes(1);
  });

  it('bounds SVG count and aggregate normalization time for one pass', async () => {
    const rasterize = vi.fn<Rasterizer>(async () => convertedResult());
    const normalizer = createPiToolSvgNormalizer({rasterize});
    const content = Array.from({length: 21}, (_, index) =>
      image(encodedSvg(`badge-${index}`), 'image/svg+xml'),
    );

    const result = await normalizer.normalizeToolResult(content);

    expect(rasterize).toHaveBeenCalledTimes(20);
    expect(result.slice(0, 20).every((block) => block.type === 'image')).toBe(true);
    expect(result[20]).toEqual({type: 'text', text: PI_IMAGE_OMISSION_PLACEHOLDER});

    let now = 0;
    const timedRasterize = vi.fn<Rasterizer>(() => {
      now += 1_000;
      return Promise.resolve(convertedResult());
    });
    const timedNormalizer = createPiToolSvgNormalizer({rasterize: timedRasterize, now: () => now});
    const timedResult = await timedNormalizer.normalizeToolResult(
      Array.from({length: 6}, (_, index) => image(encodedSvg(`timed-${index}`), 'image/svg+xml')),
    );

    expect(timedRasterize).toHaveBeenCalledTimes(5);
    expect(timedResult[5]).toEqual({type: 'text', text: PI_IMAGE_OMISSION_PLACEHOLDER});
  });

  it('caches converted SVGs within the session', async () => {
    const svg = encodedSvg('cached');
    const rasterize = vi.fn<Rasterizer>(async () => convertedResult());
    const normalizer = createPiToolSvgNormalizer({rasterize});

    const first = await normalizer.normalizeToolResult([image(svg, 'image/svg+xml')]);
    const second = await normalizer.normalizeToolResult([image(svg, 'image/svg+xml')]);

    expect(rasterize).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(second[0]).not.toBe(first[0]);
  });

  it('omits malformed SVG data with the exact placeholder', async () => {
    const normalizer = createPiToolSvgNormalizer();

    await expect(
      normalizer.normalizeToolResult([image('not valid base64', 'image/svg+xml')]),
    ).resolves.toEqual([{type: 'text', text: PI_IMAGE_OMISSION_PLACEHOLDER}]);
  });

  it('runs the exact three-badge Linear result through the typed tool-result hook', async () => {
    const handlers = extensionHandlers({rasterize: async () => convertedResult()});
    const handler = requiredHandler(handlers, 'tool_result');
    const event = {
      type: 'tool_result',
      toolName: LINEAR_BADGE_FIXTURE.toolName,
      toolCallId: 'linear-call-1',
      input: {issue: 'ENG-1860'},
      content: LINEAR_BADGE_FIXTURE.content,
      details: {source: 'fixture'},
      isError: false,
      usage: undefined,
    } as unknown as ToolResultEvent;

    const result = (await handler(event)) as {
      content: PiImageContent[];
      details: unknown;
      isError: boolean;
      usage: unknown;
    };

    expect(result.details).toEqual({source: 'fixture'});
    expect(result.isError).toBe(false);
    expect(result.content).toHaveLength(4);
    expect(result.content[0]).toEqual({
      type: 'text',
      text: 'Linear returned three status badges.',
    });
    expect(result.content.slice(1).every(isPngImage)).toBe(true);
    expect(result.content.some(isSvgImage)).toBe(false);
    expect(LINEAR_BADGE_FIXTURE.content.slice(1).every(isSvgImage)).toBe(true);
  }, 10_000);

  it('keeps the three-badge result out of the OpenAI provider request', async () => {
    const root = mkdtempSync(`${tmpdir()}/shipfox-pi-svg-session-`);
    const requests: unknown[] = [];
    const httpServer = createServer(async (request, response) => {
      const body = await readJsonBody(request);
      requests.push(body);
      response.writeHead(200, {
        connection: 'keep-alive',
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
      });
      const id = `chatcmpl-svg-${requests.length}`;
      if (requests.length === 1) {
        writeOpenAiEvent(response, {
          id,
          object: 'chat.completion.chunk',
          created: 0,
          model: 'svg-normalizer-model',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'linear-call-1',
                    type: 'function',
                    function: {name: 'linear__get_issue', arguments: '{}'},
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        });
        writeOpenAiEvent(response, {
          id,
          object: 'chat.completion.chunk',
          created: 0,
          model: 'svg-normalizer-model',
          choices: [{index: 0, delta: {}, finish_reason: 'tool_calls'}],
        });
      } else {
        writeOpenAiEvent(response, {
          id,
          object: 'chat.completion.chunk',
          created: 0,
          model: 'svg-normalizer-model',
          choices: [{index: 0, delta: {content: 'done'}, finish_reason: null}],
        });
        writeOpenAiEvent(response, {
          id,
          object: 'chat.completion.chunk',
          created: 0,
          model: 'svg-normalizer-model',
          choices: [{index: 0, delta: {}, finish_reason: 'stop'}],
        });
      }
      response.write('data: [DONE]\n\n');
      response.end();
    });
    httpServer.listen(0, '127.0.0.1');
    await once(httpServer, 'listening');
    const serverAddress = httpServer.address();
    if (typeof serverAddress !== 'object' || serverAddress === null) {
      throw new Error('OpenAI test server did not bind a TCP address');
    }
    const providerBaseUrl = `http://127.0.0.1:${serverAddress.port}/v1`;
    const modelRuntime = await ModelRuntime.create({refreshOnCreate: false});
    modelRuntime.registerProvider('pi-svg-http-test', {
      name: 'Pi SVG HTTP test',
      baseUrl: providerBaseUrl,
      api: 'openai-completions',
      apiKey: 'test-key',
      models: [
        {
          id: 'svg-normalizer-model',
          name: 'SVG normalizer model',
          input: ['text', 'image'],
          reasoning: false,
          cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0},
          contextWindow: 128_000,
          maxTokens: 2_048,
        },
      ],
    });
    const model = modelRuntime.getModel('pi-svg-http-test', 'svg-normalizer-model');
    if (model === undefined) throw new Error('HTTP SVG model was not registered');

    let session: Awaited<ReturnType<typeof createAgentSessionFromServices>>['session'] | undefined;
    try {
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
      const linearTool = {
        name: 'linear__get_issue',
        label: 'linear__get_issue',
        description: 'Return the fixture badges.',
        parameters: Type.Object({}),
        execute: () =>
          Promise.resolve({
            content: [
              ...LINEAR_BADGE_FIXTURE.content,
              image(ONE_PIXEL_BMP, 'image/bmp'),
              image(ONE_PIXEL_JPEG, 'image/jpg'),
            ],
            details: {source: 'fixture'},
          }),
      };
      const created = await createAgentSessionFromServices({
        services,
        sessionManager: SessionManager.inMemory(root),
        model,
        thinkingLevel: 'off',
        tools: ['linear__get_issue'],
        customTools: [linearTool],
      });
      session = created.session;

      await session.bindExtensions({mode: 'print'});
      await session.prompt('Return the Linear badges.');

      const storedToolResult = session.messages.find((message) => message.role === 'toolResult');
      expect(storedToolResult?.role).toBe('toolResult');
      if (storedToolResult?.role !== 'toolResult') return;
      const storedImages = storedToolResult.content.filter(isImage);
      expect(storedImages.slice(0, 3).every(isPngImage)).toBe(true);
      expect(storedImages[3]).toMatchObject({type: 'image', mimeType: 'image/png'});
      expect(storedImages[3]?.data).not.toBe(ONE_PIXEL_BMP);
      expect(storedImages).toContainEqual(image(ONE_PIXEL_JPEG, 'image/jpg'));
      expect(storedImages.some(isSvgImage)).toBe(false);
      expect(requests).toHaveLength(2);
      const providerPayload = JSON.stringify(requests[1]);
      expect(providerPayload).not.toContain('image/svg+xml');
      for (const block of LINEAR_BADGE_FIXTURE.content) {
        if (block.type === 'image') expect(providerPayload).not.toContain(block.data);
      }
    } finally {
      session?.dispose();
      await closeHttpServer(httpServer);
      rmSync(root, {recursive: true, force: true});
    }
  }, 15_000);

  it('falls back to placeholders for SVGs if the normalizer fails unexpectedly', async () => {
    const handlers = extensionHandlers({
      rasterize: () => Promise.reject(new Error('test failure')),
    });
    const handler = requiredHandler(handlers, 'tool_result');
    const raster = image('keep this payload', 'image/bmp');
    const event = {
      type: 'tool_result',
      toolName: 'linear',
      toolCallId: 'call-1',
      input: {},
      content: [{type: 'text', text: 'before'}, image(encodedSvg('bad'), 'image/svg+xml'), raster],
      details: {structured: true},
      isError: true,
      usage: {input: 1},
    } as unknown as ToolResultEvent;

    const result = (await handler(event)) as {
      content: PiImageContent[];
      details: unknown;
      isError: boolean;
      usage: unknown;
    };

    expect(result.content).toEqual([
      {type: 'text', text: 'before'},
      {type: 'text', text: PI_IMAGE_OMISSION_PLACEHOLDER},
      raster,
    ]);
    expect(result.details).toEqual({structured: true});
    expect(result.isError).toBe(true);
    expect(result.usage).toEqual({input: 1});
  });
});

function convertedResult(): Extract<SvgRasterizationResult, {outcome: 'converted'}> {
  return {
    outcome: 'converted',
    png: PNG_BYTES,
    width: 1,
    height: 1,
    inputBytes: 1,
    outputBytes: PNG_BYTES.byteLength,
    durationMs: 1,
  };
}

function image(data: string, mimeType: string): ImageContent {
  return {type: 'image', data, mimeType};
}

function encodedSvg(label: string): string {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><text x="2" y="20">${label}</text></svg>`,
  ).toString('base64');
}

function isImage(block: PiImageContent): block is ImageContent {
  return block.type === 'image';
}

function isPngImage(block: PiImageContent): block is ImageContent {
  return block.type === 'image' && block.mimeType === 'image/png';
}

function isSvgImage(block: PiImageContent): block is ImageContent {
  return block.type === 'image' && block.mimeType === 'image/svg+xml';
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

async function readJsonBody(request: NodeJS.ReadableStream): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text === '' ? undefined : (JSON.parse(text) as unknown);
}

function writeOpenAiEvent(response: NodeJS.WritableStream, event: unknown): void {
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

function closeHttpServer(server: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
