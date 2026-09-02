import {
  agentAccessEnvelopeJsonSchema,
  agentAccessEnvelopeSchema,
  agentAccessOutputSchema,
} from './envelope.js';

describe('agent access envelope', () => {
  test('accepts the common success and error wire shapes', () => {
    expect(agentAccessEnvelopeSchema.safeParse({ok: true, result: {projects: []}}).success).toBe(
      true,
    );
    expect(
      agentAccessEnvelopeSchema.safeParse({
        ok: false,
        error: {code: 'rate-limited', retry_after_seconds: 12},
      }).success,
    ).toBe(true);
  });

  test('rejects mixed success and error payloads', () => {
    expect(
      agentAccessEnvelopeSchema.safeParse({ok: true, result: {}, error: {code: 'bad'}}).success,
    ).toBe(false);
    expect(agentAccessEnvelopeSchema.safeParse({ok: false}).success).toBe(false);
  });

  test('declares one object schema for both response outcomes', () => {
    expect(agentAccessEnvelopeJsonSchema.type).toBe('object');
    expect(agentAccessEnvelopeJsonSchema).not.toHaveProperty('oneOf');
    expect(agentAccessOutputSchema({type: 'object'})).toMatchObject({
      type: 'object',
      properties: {result: {type: 'object'}},
      required: ['ok'],
    });
  });
});
