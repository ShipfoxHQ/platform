import {getStepLogsResultJsonSchema, getStepLogsResultSchema} from './log-tools.js';

const runId = '00000000-0000-4000-8000-000000000001';
const stepId = '00000000-0000-4000-8000-000000000002';

describe('log Agent Access schemas', () => {
  test('accepts unavailable aggregate sections in runtime and JSON schemas', () => {
    const result = {
      run_id: runId,
      workflow_run_attempt: 1,
      sections: [
        {
          step_id: stepId,
          attempt: 1,
          content: '',
          unavailable_reason: 'compacted-log-unavailable',
        },
      ],
    };

    expect(getStepLogsResultSchema.safeParse(result).success).toBe(true);
    expect(
      getStepLogsResultJsonSchema.oneOf[1].properties.sections.items.properties.unavailable_reason,
    ).toEqual({const: 'compacted-log-unavailable'});
  });
});
