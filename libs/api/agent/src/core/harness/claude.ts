import {CLAUDE_HARNESS, CLAUDE_MODEL_LINE} from '@shipfox/api-agent-dto';
import {config} from '#config.js';
import type {HarnessProviderCatalog} from './registry.js';

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const PROBE_MAX_TOKENS = 64;
const PROBE_PROMPT = 'Reply with OK.';

export {CLAUDE_HARNESS, CLAUDE_MODEL_LINE};

export const claudeHarnessCatalog: HarnessProviderCatalog = {
  listModels: () => CLAUDE_MODEL_LINE,
  validateCredentials: probeClaudeCredentials,
};

async function probeClaudeCredentials(params: {
  model: string;
  credentials: Record<string, string>;
  signal?: AbortSignal | undefined;
}): Promise<void> {
  const apiKey = params.credentials.api_key;
  if (apiKey === undefined) throw new Error('Missing Anthropic API key credential.');

  const response = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: 'POST',
    headers: claudeProbeHeaders(apiKey),
    body: JSON.stringify(claudeProbeBody(params.model)),
    redirect: 'error',
    signal: timeoutSignal(params.signal, config.AGENT_PROVIDER_VALIDATION_TIMEOUT_MS),
  });

  try {
    if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}.`);
  } finally {
    await response.body?.cancel();
  }
}

function claudeProbeHeaders(apiKey: string): Headers {
  const headers = new Headers();
  headers.set('content-type', 'application/json');
  headers.set('x-api-key', apiKey);
  headers.set('anthropic-version', ANTHROPIC_VERSION);
  return headers;
}

function claudeProbeBody(model: string): unknown {
  return {
    model,
    max_tokens: PROBE_MAX_TOKENS,
    messages: [{role: 'user', content: PROBE_PROMPT}],
  };
}

function timeoutSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  return signal === undefined
    ? AbortSignal.timeout(timeoutMs)
    : AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
}
