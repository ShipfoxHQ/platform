import {describe, expect, it} from '@shipfox/vitest/vi';
import {
  runFromBranchInputsFromWith,
  runFromBranchInputsToObject,
  runFromBranchInputValue,
  runFromBranchTriggerKind,
  runFromBranchTriggerSourceLabel,
} from './run-from-branch';

describe('runFromBranchTriggerKind', () => {
  it('classifies the built-in sources and any other source as integration', () => {
    expect(runFromBranchTriggerKind('manual')).toBe('manual');
    expect(runFromBranchTriggerKind('cron')).toBe('cron');
    expect(runFromBranchTriggerKind('github_acme')).toBe('integration');
    expect(runFromBranchTriggerKind('')).toBe('integration');
  });
});

describe('runFromBranchTriggerSourceLabel', () => {
  it('labels the built-in sources and keeps connection slugs verbatim', () => {
    expect(runFromBranchTriggerSourceLabel('manual')).toBe('Manual');
    expect(runFromBranchTriggerSourceLabel('cron')).toBe('Cron');
    expect(runFromBranchTriggerSourceLabel('github_acme')).toBe('github_acme');
  });
});

describe('runFromBranchInputsFromWith', () => {
  it('prefills rows from the with block, stringifying non-string values', () => {
    expect(
      runFromBranchInputsFromWith({
        environment: 'staging',
        retries: 3,
        canary: true,
        tags: ['a', 'b'],
      }),
    ).toEqual([
      {key: 'environment', value: 'staging'},
      {key: 'retries', value: '3'},
      {key: 'canary', value: 'true'},
      {key: 'tags', value: '["a","b"]'},
    ]);
  });

  it('returns no rows for a missing or empty with block', () => {
    expect(runFromBranchInputsFromWith(undefined)).toEqual([]);
    expect(runFromBranchInputsFromWith({})).toEqual([]);
  });
});

describe('runFromBranchInputValue', () => {
  it('keeps plain text and empty values as strings', () => {
    expect(runFromBranchInputValue('')).toBe('');
    expect(runFromBranchInputValue('staging')).toBe('staging');
    expect(runFromBranchInputValue('0123')).toBe('0123');
  });

  it('round-trips JSON values that were stringified for editing', () => {
    expect(runFromBranchInputValue('3')).toBe(3);
    expect(runFromBranchInputValue('true')).toBe(true);
    expect(runFromBranchInputValue('["a","b"]')).toEqual(['a', 'b']);
    expect(runFromBranchInputValue('{"region":"us-east-1"}')).toEqual({region: 'us-east-1'});
  });
});

describe('runFromBranchInputsToObject', () => {
  it('builds the request inputs object, dropping blank keys', () => {
    expect(
      runFromBranchInputsToObject([
        {key: 'environment', value: 'production'},
        {key: 'retries', value: '3'},
        {key: '  ', value: 'dropped'},
        {key: '', value: 'also dropped'},
      ]),
    ).toEqual({environment: 'production', retries: 3});
  });

  it('returns an empty object for no rows', () => {
    expect(runFromBranchInputsToObject([])).toEqual({});
  });
});
