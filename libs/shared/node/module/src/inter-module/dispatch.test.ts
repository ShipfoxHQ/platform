import {
  createInterModuleKnownError,
  defineInterModuleContract,
  defineInterModulePresentation,
  type InterModuleContract,
  type InterModulePresentationHandlers,
  isInterModuleKnownError,
} from '@shipfox/inter-module';
import {isErrorReported} from '@shipfox/node-error-monitoring';
import {SpanKind, SpanStatusCode} from '@shipfox/node-opentelemetry';
import {z} from 'zod';
import {createFakeTracer} from '#test/fake-tracer.js';
import {widgetsContract} from '#test/fixtures.js';
import {InterModuleOpaqueError, InterModuleValidationError} from './errors.js';
import {createInMemoryInterModuleTransport} from './transport.js';

type WidgetsDef = typeof widgetsContract extends InterModuleContract<infer Def> ? Def : never;

const edgeCaseContract = defineInterModuleContract({
  module: 'edge',
  methods: {
    withAsyncInputSchema: {
      input: z.object({id: z.string()}).refine(async () => true),
      output: z.object({ok: z.boolean()}),
    },
    withAsyncOutputSchema: {
      input: z.object({}),
      output: z.object({ok: z.boolean()}).refine(async () => true),
    },
    withNonJsonInputTransform: {
      input: z.object({id: z.string()}).transform((value) => ({...value, when: new Date()})),
      output: z.object({ok: z.boolean()}),
    },
    withNonJsonOutputTransform: {
      input: z.object({}),
      output: z.object({ok: z.boolean()}).transform((value) => ({...value, when: new Date()})),
    },
  },
});

function buildWidgetsHarness(
  handlers: InterModulePresentationHandlers<WidgetsDef>,
  options?: Parameters<typeof createInMemoryInterModuleTransport>[0],
) {
  const transport = createInMemoryInterModuleTransport(options);
  const client = transport.createClient(widgetsContract);
  transport.register(defineInterModulePresentation(widgetsContract, handlers));
  transport.seal();
  return client;
}

describe('inter-module dispatch: success path', () => {
  it('resolves with the handler output', async () => {
    const client = buildWidgetsHarness({getWidget: ({id}) => ({id, name: 'Widget'})});

    await expect(client.getWidget({id: 'w-1'})).resolves.toEqual({id: 'w-1', name: 'Widget'});
  });

  it("never hands the handler the caller's original input object", async () => {
    let seenInput: unknown;
    const client = buildWidgetsHarness({
      getWidget: (input) => {
        seenInput = input;
        return {id: input.id, name: 'Widget'};
      },
    });
    const callerInput = {id: 'w-1'};

    await client.getWidget(callerInput);

    expect(seenInput).toEqual(callerInput);
    expect(seenInput).not.toBe(callerInput);
  });

  it("never hands the caller the handler's original output object", async () => {
    const handlerOutput = {id: 'w-1', name: 'Widget'};
    const client = buildWidgetsHarness({getWidget: () => handlerOutput});

    const result = await client.getWidget({id: 'w-1'});

    expect(result).toEqual(handlerOutput);
    expect(result).not.toBe(handlerOutput);
  });

  it('applies input schema defaults and transforms before the handler runs', async () => {
    const contract = defineInterModuleContract({
      module: 'defaults',
      methods: {
        greet: {
          input: z.object({name: z.string().default('world')}),
          output: z.object({message: z.string()}),
        },
      },
    });
    const transport = createInMemoryInterModuleTransport();
    const client = transport.createClient(contract);
    transport.register(
      defineInterModulePresentation(contract, {
        greet: ({name}) => ({message: `Hello, ${name}`}),
      }),
    );
    transport.seal();

    const result = await client.greet({});

    expect(result).toEqual({message: 'Hello, world'});
  });
});

describe('inter-module dispatch: input validation', () => {
  it('rejects invalid input without invoking the handler', async () => {
    let called = false;
    const client = buildWidgetsHarness({
      getWidget: ({id}) => {
        called = true;
        return {id, name: 'Widget'};
      },
    });

    // @ts-expect-error id must be a string
    await expect(client.getWidget({id: 42})).rejects.toThrow(InterModuleValidationError);
    expect(called).toBe(false);
  });

  it('rejects raw non-JSON input without invoking the handler', async () => {
    let called = false;
    const client = buildWidgetsHarness({
      getWidget: ({id}) => {
        called = true;
        return {id, name: 'Widget'};
      },
    });

    // @ts-expect-error a Date is not valid JSON input
    await expect(client.getWidget({id: new Date()})).rejects.toThrow(InterModuleValidationError);
    expect(called).toBe(false);
  });

  it('does not attach a cause to the validation rejection', async () => {
    const client = buildWidgetsHarness({getWidget: ({id}) => ({id, name: 'Widget'})});

    // @ts-expect-error id must be a string
    const rejection = await client.getWidget({id: 42}).catch((error: unknown) => error);

    expect((rejection as Error).cause).toBeUndefined();
  });

  it('reports an input-schema defect and returns an opaque error when the schema behaves asynchronously', async () => {
    const reports: Array<{phase: string; module: string; method: string}> = [];
    const transport = createInMemoryInterModuleTransport({
      reportInternalError: (_error, context) => {
        reports.push(context);
      },
    });
    const client = transport.createClient(edgeCaseContract);
    transport.register(
      defineInterModulePresentation(edgeCaseContract, {
        withAsyncInputSchema: () => ({ok: true}),
        withAsyncOutputSchema: () => ({ok: true}),
        withNonJsonInputTransform: () => ({ok: true}),
        withNonJsonOutputTransform: () => ({ok: true}),
      }),
    );
    transport.seal();

    const rejection = await client
      .withAsyncInputSchema({id: 'w-1'})
      .catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(InterModuleOpaqueError);
    expect((rejection as Error).cause).toBeUndefined();
    expect(isErrorReported(rejection)).toBe(true);
    expect(reports).toEqual([
      {phase: 'input-schema', module: 'edge', method: 'withAsyncInputSchema'},
    ]);
  });

  it('reports an input-contract defect when a transform produces a non-JSON value', async () => {
    const reports: Array<{phase: string; module: string; method: string}> = [];
    const transport = createInMemoryInterModuleTransport({
      reportInternalError: (_error, context) => {
        reports.push(context);
      },
    });
    const client = transport.createClient(edgeCaseContract);
    transport.register(
      defineInterModulePresentation(edgeCaseContract, {
        withAsyncInputSchema: () => ({ok: true}),
        withAsyncOutputSchema: () => ({ok: true}),
        withNonJsonInputTransform: () => ({ok: true}),
        withNonJsonOutputTransform: () => ({ok: true}),
      }),
    );
    transport.seal();

    await expect(client.withNonJsonInputTransform({id: 'w-1'})).rejects.toThrow(
      InterModuleOpaqueError,
    );

    expect(reports).toEqual([
      {phase: 'input-contract', module: 'edge', method: 'withNonJsonInputTransform'},
    ]);
  });
});

describe('inter-module dispatch: output validation', () => {
  it('reports an output-schema defect and returns an opaque error for invalid handler output', async () => {
    const reports: Array<{phase: string}> = [];
    const transport = createInMemoryInterModuleTransport({
      reportInternalError: (_error, context) => {
        reports.push({phase: context.phase});
      },
    });
    const client = transport.createClient(widgetsContract);
    transport.register(
      defineInterModulePresentation(widgetsContract, {
        // @ts-expect-error deliberately invalid output for the test
        getWidget: () => ({id: 'w-1'}),
      }),
    );
    transport.seal();

    await expect(client.getWidget({id: 'w-1'})).rejects.toThrow(InterModuleOpaqueError);
    expect(reports).toEqual([{phase: 'output-schema'}]);
  });

  it('reports an output-schema defect when the output schema behaves asynchronously', async () => {
    const reports: Array<{phase: string}> = [];
    const transport = createInMemoryInterModuleTransport({
      reportInternalError: (_error, context) => {
        reports.push({phase: context.phase});
      },
    });
    const client = transport.createClient(edgeCaseContract);
    transport.register(
      defineInterModulePresentation(edgeCaseContract, {
        withAsyncInputSchema: () => ({ok: true}),
        withAsyncOutputSchema: () => ({ok: true}),
        withNonJsonInputTransform: () => ({ok: true}),
        withNonJsonOutputTransform: () => ({ok: true}),
      }),
    );
    transport.seal();

    await expect(client.withAsyncOutputSchema({})).rejects.toThrow(InterModuleOpaqueError);
    expect(reports).toEqual([{phase: 'output-schema'}]);
  });

  it('reports an output-contract defect when a transform produces a non-JSON value', async () => {
    const reports: Array<{phase: string}> = [];
    const transport = createInMemoryInterModuleTransport({
      reportInternalError: (_error, context) => {
        reports.push({phase: context.phase});
      },
    });
    const client = transport.createClient(edgeCaseContract);
    transport.register(
      defineInterModulePresentation(edgeCaseContract, {
        withAsyncInputSchema: () => ({ok: true}),
        withAsyncOutputSchema: () => ({ok: true}),
        withNonJsonInputTransform: () => ({ok: true}),
        withNonJsonOutputTransform: () => ({ok: true}),
      }),
    );
    transport.seal();

    await expect(client.withNonJsonOutputTransform({})).rejects.toThrow(InterModuleOpaqueError);
    expect(reports).toEqual([{phase: 'output-contract'}]);
  });
});

describe('inter-module dispatch: known errors', () => {
  it('lets a handler reject with its own declared known error', async () => {
    const client = buildWidgetsHarness({
      getWidget: ({id}) => {
        throw createInterModuleKnownError(widgetsContract.methods.getWidget, 'not-found', {id});
      },
    });

    const rejection = await client.getWidget({id: 'missing'}).catch((error: unknown) => error);

    expect(isInterModuleKnownError(widgetsContract.methods.getWidget, rejection)).toBe(true);
  });

  it("gives the caller a fresh known-error object, not the handler's own instance", async () => {
    const thrownByHandler = createInterModuleKnownError(
      widgetsContract.methods.getWidget,
      'not-found',
      {
        id: 'missing',
      },
    );
    const client = buildWidgetsHarness({
      getWidget: () => {
        throw thrownByHandler;
      },
    });

    const rejection = await client.getWidget({id: 'missing'}).catch((error: unknown) => error);

    expect(rejection).not.toBe(thrownByHandler);
    expect(isInterModuleKnownError(widgetsContract.methods.getWidget, rejection)).toBe(true);
  });

  it('reports a known-error-contract defect and returns an opaque error for a forged known error', async () => {
    const otherContract = defineInterModuleContract({
      module: 'other',
      methods: {
        fail: {
          input: z.object({}),
          output: z.object({}),
          errors: {oops: z.object({})},
        },
      },
    });
    const reports: Array<{phase: string}> = [];
    const transport = createInMemoryInterModuleTransport({
      reportInternalError: (_error, context) => {
        reports.push({phase: context.phase});
      },
    });
    const client = transport.createClient(widgetsContract);
    transport.register(
      defineInterModulePresentation(widgetsContract, {
        getWidget: () => {
          throw createInterModuleKnownError(otherContract.methods.fail, 'oops', {});
        },
      }),
    );
    transport.seal();

    await expect(client.getWidget({id: 'w-1'})).rejects.toThrow(InterModuleOpaqueError);
    expect(reports).toEqual([{phase: 'known-error-contract'}]);
  });

  it('contains a forged marked error whose code schema behaves asynchronously, never leaking the raw exception', async () => {
    const asyncErrorContract = defineInterModuleContract({
      module: 'widgets',
      methods: {
        getWidget: {
          input: z.object({id: z.string()}),
          output: z.object({id: z.string(), name: z.string()}),
          errors: {'not-found': z.object({id: z.string()}).refine(async () => true)},
        },
      },
    });
    const marker = Symbol.for('@shipfox/inter-module/known-error');
    const forged = Object.assign(new Error('forged'), {
      module: 'widgets',
      method: 'getWidget',
      code: 'not-found',
      details: {id: 'w-1'},
    });
    Object.defineProperty(forged, marker, {value: true, enumerable: false});

    const reports: Array<{phase: string}> = [];
    const transport = createInMemoryInterModuleTransport({
      reportInternalError: (_error, context) => {
        reports.push({phase: context.phase});
      },
    });
    const client = transport.createClient(asyncErrorContract);
    transport.register(
      defineInterModulePresentation(asyncErrorContract, {
        getWidget: () => {
          throw forged;
        },
      }),
    );
    transport.seal();

    const rejection = await client.getWidget({id: 'w-1'}).catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(InterModuleOpaqueError);
    expect(reports).toEqual([{phase: 'known-error-contract'}]);
  });

  it('reports a handler defect and returns an opaque error for an undeclared exception', async () => {
    const reports: Array<{phase: string}> = [];
    const secretMessage = 'super secret internal detail';
    const transport = createInMemoryInterModuleTransport({
      reportInternalError: (_error, context) => {
        reports.push({phase: context.phase});
      },
    });
    const client = transport.createClient(widgetsContract);
    transport.register(
      defineInterModulePresentation(widgetsContract, {
        getWidget: () => {
          throw new Error(secretMessage);
        },
      }),
    );
    transport.seal();

    const rejection = await client.getWidget({id: 'w-1'}).catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(InterModuleOpaqueError);
    expect((rejection as Error).message).not.toContain(secretMessage);
    expect(reports).toEqual([{phase: 'handler'}]);
  });
});

describe('inter-module dispatch: reporter behavior', () => {
  it('does not fail the call when a synchronous reporter throws', async () => {
    const transport = createInMemoryInterModuleTransport({
      reportInternalError: () => {
        throw new Error('reporter exploded');
      },
    });
    const client = transport.createClient(widgetsContract);
    transport.register(
      defineInterModulePresentation(widgetsContract, {
        getWidget: () => {
          throw new Error('boom');
        },
      }),
    );
    transport.seal();

    await expect(client.getWidget({id: 'w-1'})).rejects.toThrow(InterModuleOpaqueError);
  });

  it('does not fail the call when an async reporter rejects', async () => {
    const transport = createInMemoryInterModuleTransport({
      reportInternalError: () => Promise.reject(new Error('reporter exploded asynchronously')),
    });
    const client = transport.createClient(widgetsContract);
    transport.register(
      defineInterModulePresentation(widgetsContract, {
        getWidget: () => {
          throw new Error('boom');
        },
      }),
    );
    transport.seal();

    await expect(client.getWidget({id: 'w-1'})).rejects.toThrow(InterModuleOpaqueError);
  });

  it('does not hang the call when the reporter returns a promise that never settles', async () => {
    const neverSettles = new Promise<void>(() => {
      // Intentionally never resolves or rejects.
    });
    const transport = createInMemoryInterModuleTransport({
      reportInternalError: () => neverSettles,
    });
    const client = transport.createClient(widgetsContract);
    transport.register(
      defineInterModulePresentation(widgetsContract, {
        getWidget: () => {
          throw new Error('boom');
        },
      }),
    );
    transport.seal();

    await expect(client.getWidget({id: 'w-1'})).rejects.toThrow(InterModuleOpaqueError);
  });

  it('defaults to a no-op reporter', async () => {
    const client = buildWidgetsHarness({
      getWidget: () => {
        throw new Error('boom');
      },
    });

    await expect(client.getWidget({id: 'w-1'})).rejects.toThrow(InterModuleOpaqueError);
  });
});

describe('inter-module dispatch: cancellation', () => {
  it('rejects a pre-aborted call with the signal reason and never invokes the handler', async () => {
    let called = false;
    const client = buildWidgetsHarness({
      getWidget: ({id}) => {
        called = true;
        return {id, name: 'Widget'};
      },
    });
    const controller = new AbortController();
    const reason = new Error('already aborted');
    controller.abort(reason);

    await expect(client.getWidget({id: 'w-1'}, {signal: controller.signal})).rejects.toBe(reason);
    expect(called).toBe(false);
  });

  it('rejects with the signal reason even when the input is also invalid: cancellation wins', async () => {
    let called = false;
    const client = buildWidgetsHarness({
      getWidget: ({id}) => {
        called = true;
        return {id, name: 'Widget'};
      },
    });
    const controller = new AbortController();
    const reason = new Error('already aborted');
    controller.abort(reason);

    // @ts-expect-error id must be a string: deliberately invalid, to prove cancellation still wins
    await expect(client.getWidget({id: 42}, {signal: controller.signal})).rejects.toBe(reason);
    expect(called).toBe(false);
  });

  it('does not hang when the handler synchronously aborts its own signal before returning', async () => {
    const controller = new AbortController();
    const client = buildWidgetsHarness({
      getWidget: () => {
        controller.abort(new Error('reentrant abort'));
        return new Promise(() => {
          // Never settles on its own: only the abort race can resolve this call.
        });
      },
    });

    const result = await client
      .getWidget({id: 'w-1'}, {signal: controller.signal})
      .catch((error: unknown) => error);

    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe('reentrant abort');
  });

  it('rejects promptly when the signal aborts while the handler is in flight', async () => {
    let releaseHandler: (() => void) | undefined;
    const handlerGate = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });
    const client = buildWidgetsHarness({
      getWidget: async ({id}) => {
        await handlerGate;
        return {id, name: 'Widget'};
      },
    });
    const controller = new AbortController();
    const reason = new Error('aborted mid-flight');

    const callPromise = client.getWidget({id: 'w-1'}, {signal: controller.signal});
    controller.abort(reason);

    await expect(callPromise).rejects.toBe(reason);
    releaseHandler?.();
  });

  it('honors the handler settling first, even if the signal aborts moments later', async () => {
    let releaseHandler: (() => void) | undefined;
    const handlerGate = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });
    const client = buildWidgetsHarness({
      getWidget: async ({id}) => {
        await handlerGate;
        return {id, name: 'Widget'};
      },
    });
    const controller = new AbortController();

    const callPromise = client.getWidget({id: 'w-1'}, {signal: controller.signal});
    releaseHandler?.();
    const result = await callPromise;
    controller.abort(new Error('too late'));

    expect(result).toEqual({id: 'w-1', name: 'Widget'});
  });

  it('passes the same signal through to the handler context', async () => {
    let seenSignal: AbortSignal | undefined;
    const client = buildWidgetsHarness({
      getWidget: ({id}, context) => {
        seenSignal = context.signal;
        return {id, name: 'Widget'};
      },
    });
    const controller = new AbortController();

    await client.getWidget({id: 'w-1'}, {signal: controller.signal});

    expect(seenSignal).toBe(controller.signal);
  });

  it('gives the handler a non-aborted signal when the caller passes none', async () => {
    let seenSignal: AbortSignal | undefined;
    const client = buildWidgetsHarness({
      getWidget: ({id}, context) => {
        seenSignal = context.signal;
        return {id, name: 'Widget'};
      },
    });

    await client.getWidget({id: 'w-1'});

    expect(seenSignal?.aborted).toBe(false);
  });
});

describe('inter-module dispatch: tracing', () => {
  it('starts an INTERNAL client span and an INTERNAL presentation span, both ended with a success outcome', async () => {
    const {tracer, spans} = createFakeTracer();
    const client = buildWidgetsHarness({getWidget: ({id}) => ({id, name: 'Widget'})}, {tracer});

    await client.getWidget({id: 'w-1'});

    expect(spans).toHaveLength(2);
    expect(spans.map((span) => span.name)).toEqual([
      'inter_module.client',
      'inter_module.presentation',
    ]);
    for (const span of spans) {
      expect(span.kind).toBe(SpanKind.INTERNAL);
      expect(span.ended).toBe(true);
      expect(span.attributes['inter_module.module']).toBe('widgets');
      expect(span.attributes['inter_module.method']).toBe('getWidget');
      expect(span.attributes['inter_module.outcome']).toBe('success');
      expect(span.status?.code).toBe(SpanStatusCode.OK);
    }
  });

  it('activates the client span so the presentation span nests as its real child, not a sibling', async () => {
    const {tracer, spans} = createFakeTracer();
    const client = buildWidgetsHarness({getWidget: ({id}) => ({id, name: 'Widget'})}, {tracer});

    await client.getWidget({id: 'w-1'});

    const clientSpan = spans.find((span) => span.name === 'inter_module.client');
    const presentationSpan = spans.find((span) => span.name === 'inter_module.presentation');
    expect(presentationSpan?.parent).toBe(clientSpan);
  });

  it('only starts the client span for a call rejected at input validation', async () => {
    const {tracer, spans} = createFakeTracer();
    const client = buildWidgetsHarness({getWidget: ({id}) => ({id, name: 'Widget'})}, {tracer});

    // @ts-expect-error id must be a string
    await client.getWidget({id: 42}).catch(() => undefined);

    expect(spans).toHaveLength(1);
    expect(spans[0]?.name).toBe('inter_module.client');
    expect(spans[0]?.ended).toBe(true);
    expect(spans[0]?.attributes['inter_module.outcome']).toBe('validation-error');
  });

  it('marks both spans with an ERROR status for an opaque outcome', async () => {
    const {tracer, spans} = createFakeTracer();
    const client = buildWidgetsHarness(
      {
        getWidget: () => {
          throw new Error('boom');
        },
      },
      {tracer},
    );

    await client.getWidget({id: 'w-1'}).catch(() => undefined);

    for (const span of spans) {
      expect(span.attributes['inter_module.outcome']).toBe('opaque-error');
      expect(span.status?.code).toBe(SpanStatusCode.ERROR);
    }
  });

  it('records the known-error code as a bounded attribute', async () => {
    const {tracer, spans} = createFakeTracer();
    const client = buildWidgetsHarness(
      {
        getWidget: ({id}) => {
          throw createInterModuleKnownError(widgetsContract.methods.getWidget, 'not-found', {id});
        },
      },
      {tracer},
    );

    await client.getWidget({id: 'w-1'}).catch(() => undefined);

    for (const span of spans) {
      expect(span.attributes['inter_module.outcome']).toBe('known-error');
      expect(span.attributes['inter_module.known_error_code']).toBe('not-found');
    }
  });

  it('marks both spans cancelled when the abort signal wins', async () => {
    const {tracer, spans} = createFakeTracer();
    let releaseHandler: (() => void) | undefined;
    const handlerGate = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });
    const client = buildWidgetsHarness(
      {
        getWidget: async ({id}) => {
          await handlerGate;
          return {id, name: 'Widget'};
        },
      },
      {tracer},
    );
    const controller = new AbortController();

    const callPromise = client.getWidget({id: 'w-1'}, {signal: controller.signal});
    controller.abort(new Error('cancel'));
    await callPromise.catch(() => undefined);

    for (const span of spans) {
      expect(span.attributes['inter_module.outcome']).toBe('cancelled');
    }

    releaseHandler?.();
  });

  it('never attaches payload, message, or stack attributes to a span', async () => {
    const {tracer, spans} = createFakeTracer();
    const client = buildWidgetsHarness(
      {
        getWidget: () => {
          throw new Error('super secret stack-bearing message');
        },
      },
      {tracer},
    );

    await client.getWidget({id: 'w-1'}).catch(() => undefined);

    for (const span of spans) {
      const values = Object.values(span.attributes);
      expect(values.some((value) => typeof value === 'string' && value.includes('secret'))).toBe(
        false,
      );
      expect(Object.keys(span.attributes).sort()).toEqual(
        [
          'inter_module.method',
          'inter_module.module',
          'inter_module.outcome',
          'inter_module.transport',
        ].sort(),
      );
    }
  });
});
