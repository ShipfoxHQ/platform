import {runnersInterModuleContract} from './inter-module.js';

describe('runnersInterModuleContract', () => {
  test('carries the claim-time renewable inference snapshot with an active lease', () => {
    const result = runnersInterModuleContract.methods.getLeaseState.output.parse({
      active: true,
      renewableInference: false,
    });

    expect(result).toEqual({active: true, renewableInference: false});
  });

  test('exposes bounded JSON capability results', () => {
    const result =
      runnersInterModuleContract.methods.getEffectiveRunnerToolCapabilities.output.parse({
        capabilities: {harnesses: {pi: {tools: ['read']}}},
        reportFresh: true,
      });

    expect(result).toEqual({
      capabilities: {harnesses: {pi: {tools: ['read']}}},
      reportFresh: true,
    });
  });
});
