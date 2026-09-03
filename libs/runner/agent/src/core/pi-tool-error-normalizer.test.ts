import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
import {
  createPiToolErrorNormalizerExtension,
  PI_TOOL_ERROR_NORMALIZER_EXTENSION_NAME,
} from '#core/pi-tool-error-normalizer.js';

describe('createPiToolErrorNormalizerExtension', () => {
  it('marks stable MCP and direct gateway errors as Pi tool errors', () => {
    const on = vi.fn();
    const extension = createPiToolErrorNormalizerExtension();

    expect(extension.name).toBe(PI_TOOL_ERROR_NORMALIZER_EXTENSION_NAME);
    if (typeof extension === 'function') throw new Error('Expected an inline extension object');
    extension.factory({on} as unknown as ExtensionAPI);

    const handler = on.mock.calls[0]?.[1];
    expect(handler).toBeDefined();
    if (handler === undefined) return;

    expect(handler({isError: false, details: {error: 'tool_not_found'}})).toEqual({
      isError: true,
    });
    expect(
      handler({
        isError: false,
        details: {mode: 'call', error: 'tool_not_found_after_reconnect', requestedTool: 'missing'},
      }),
    ).toEqual({
      isError: true,
      details: {mode: 'call', error: 'tool_not_found', requestedTool: 'missing'},
    });
    expect(handler({isError: false, details: {isError: true}})).toEqual({
      isError: true,
    });
    expect(handler({isError: false, details: {error: 'validation_failed'}})).toBe(undefined);
    expect(handler({isError: true, details: {error: 'tool_not_found'}})).toBe(undefined);
  });
});
