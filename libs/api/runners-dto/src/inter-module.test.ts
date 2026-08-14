import {runnersInterModuleContract} from './inter-module.js';

describe('runnersInterModuleContract', () => {
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
