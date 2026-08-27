import {describe, expect, it} from '@shipfox/vitest/vi';
import {runnerLifecycleCapabilitiesSchema} from './lifecycle-capabilities.js';

describe('runnerLifecycleCapabilitiesSchema', () => {
  it('accepts a unique known capability', () => {
    expect(runnerLifecycleCapabilitiesSchema.parse(['local_execution_fence_v1'])).toEqual([
      'local_execution_fence_v1',
    ]);
  });

  it.each([
    ['an unknown capability', ['future_capability']],
    ['duplicate capabilities', ['local_execution_fence_v1', 'local_execution_fence_v1']],
    ['more than eight capabilities', Array(9).fill('local_execution_fence_v1')],
    ['an empty list', []],
  ])('rejects %s', (_description, capabilities) => {
    expect(runnerLifecycleCapabilitiesSchema.safeParse(capabilities).success).toBe(false);
  });
});
