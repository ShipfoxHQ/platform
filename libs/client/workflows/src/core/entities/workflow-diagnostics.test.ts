import {workflowPayloadFieldLabel} from './workflow-diagnostics.js';

describe('workflow payload field labels', () => {
  it.each(['toString', '__proto__'])('falls back for the inherited key %s', (field) => {
    expect(workflowPayloadFieldLabel(field)).toBe('Workflow value');
  });
});
