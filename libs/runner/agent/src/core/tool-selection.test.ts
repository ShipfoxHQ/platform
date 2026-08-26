import {toolSelectionOption} from '#core/tool-selection.js';

describe('toolSelectionOption', () => {
  it('leaves harness defaults untouched when tools are not configured', () => {
    const result = toolSelectionOption(undefined, ['set_output', 'managed_review']);

    expect(result).toEqual({});
  });

  it('appends every required managed tool to an explicit selection', () => {
    const configuredTools = ['read'];

    const result = toolSelectionOption(configuredTools, ['set_output', 'managed_review']);

    expect(result).toEqual({tools: ['read', 'set_output', 'managed_review']});
    expect(configuredTools).toEqual(['read']);
  });

  it('does not duplicate required tools already selected or repeated by the caller', () => {
    const result = toolSelectionOption(
      ['read', 'set_output'],
      ['set_output', 'managed_review', 'managed_review'],
    );

    expect(result).toEqual({tools: ['read', 'set_output', 'managed_review']});
  });
});
