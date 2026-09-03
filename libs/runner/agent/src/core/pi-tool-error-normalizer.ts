import type {InlineExtension} from '@earendil-works/pi-coding-agent';

export const PI_TOOL_ERROR_NORMALIZER_EXTENSION_NAME = 'shipfox-pi-tool-error-normalizer';

/**
 * Pi's tool result event carries the error bit separately from a tool's returned details. Keep
 * MCP adapter compatibility errors and direct gateway errors visible to the agent core.
 */
export function createPiToolErrorNormalizerExtension(): InlineExtension {
  return {
    name: PI_TOOL_ERROR_NORMALIZER_EXTENSION_NAME,
    hidden: true,
    factory: (pi) => {
      pi.on('tool_result', (event) => {
        if (event.isError) return undefined;
        const details = normalizeToolErrorDetails(event.details);
        if (details === undefined) return undefined;
        return {
          isError: true,
          ...(details === event.details ? {} : {details}),
        };
      });
    },
  };
}

function normalizeToolErrorDetails(details: unknown): Record<string, unknown> | undefined {
  if (details === null || typeof details !== 'object') return undefined;
  const record = details as Record<string, unknown>;
  if (
    record.isError === true ||
    record.error === 'tool_error' ||
    record.error === 'call_failed' ||
    record.error === 'tool_not_found'
  ) {
    return record;
  }
  if (record.error === 'tool_not_found_after_reconnect') {
    return {...record, error: 'tool_not_found'};
  }
  return undefined;
}
