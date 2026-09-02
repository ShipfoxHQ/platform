import {
  type AgentAccessEnvelopeDto,
  agentAccessEnvelopeSchema,
} from '@shipfox/api-agent-access-dto';

export function agentAccessSuccess(result: unknown): AgentAccessEnvelopeDto {
  return {ok: true, result};
}

export function agentAccessError(
  code: string,
  options: {message?: string; retryAfterSeconds?: number} = {},
): AgentAccessEnvelopeDto {
  return {
    ok: false,
    error: {
      code,
      ...(options.message === undefined ? {} : {message: options.message}),
      ...(options.retryAfterSeconds === undefined
        ? {}
        : {retry_after_seconds: options.retryAfterSeconds}),
    },
  };
}

export function parseAgentAccessEnvelope(value: unknown): AgentAccessEnvelopeDto | undefined {
  const parsed = agentAccessEnvelopeSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function serializeAgentAccessEnvelope(envelope: AgentAccessEnvelopeDto): string {
  const serialized = JSON.stringify(envelope);
  if (serialized === undefined) throw new Error('Agent-access envelope is not serializable');
  return serialized;
}
