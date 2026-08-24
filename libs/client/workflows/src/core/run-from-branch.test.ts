import {describe, expect, it} from '@shipfox/vitest/vi';
import {
  runFromBranchDuplicateKeys,
  runFromBranchInputsFromWith,
  runFromBranchInputsToObject,
  runFromBranchInputValue,
  runFromBranchTriggerDefaultEvent,
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

describe('runFromBranchTriggerDefaultEvent', () => {
  it('maps the built-in sources to their dispatch events and integrations to a display fallback', () => {
    expect(runFromBranchTriggerDefaultEvent('manual')).toBe('fire');
    expect(runFromBranchTriggerDefaultEvent('cron')).toBe('tick');
    expect(runFromBranchTriggerDefaultEvent('github_acme')).toBe('any');
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
      {key: 'environment', value: 'staging', valueKind: 'string'},
      {key: 'retries', value: '3', valueKind: 'json'},
      {key: 'canary', value: 'true', valueKind: 'json'},
      {key: 'tags', value: '["a","b"]', valueKind: 'json'},
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

  it('keeps string-kind values as text even when they parse as JSON literals', () => {
    expect(runFromBranchInputValue('1', 'string')).toBe('1');
    expect(runFromBranchInputValue('true', 'string')).toBe('true');
    expect(runFromBranchInputValue('["a"]', 'string')).toBe('["a"]');
  });

  it('round-trips JSON values that were stringified for editing', () => {
    expect(runFromBranchInputValue('3')).toBe(3);
    expect(runFromBranchInputValue('3', 'json')).toBe(3);
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

  it('keeps string-kind values as strings and parses json-kind values', () => {
    expect(
      runFromBranchInputsToObject([
        {key: 'version', value: '1', valueKind: 'string'},
        {key: 'flag', value: 'true', valueKind: 'string'},
        {key: 'retries', value: '3', valueKind: 'json'},
      ]),
    ).toEqual({version: '1', flag: 'true', retries: 3});
  });

  it('round-trips a with block without changing string literal types', () => {
    const withBlock = {version: '1', flag: 'true', retries: 3, region: 'us-east-1'};
    expect(runFromBranchInputsToObject(runFromBranchInputsFromWith(withBlock))).toEqual(withBlock);
  });

  it('stores prototype-named keys as data on a null-prototype object', () => {
    const inputs = runFromBranchInputsToObject([
      {key: '__proto__', value: 'polluted', valueKind: 'string'},
      {key: 'constructor', value: '1', valueKind: 'string'},
    ]);
    expect(Object.getPrototypeOf(inputs)).toBeNull();
    expect(Object.hasOwn(inputs, '__proto__')).toBe(true);
    expect(Object.getOwnPropertyDescriptor(inputs, '__proto__')?.value).toBe('polluted');
    expect(inputs.constructor).toBe('1');
  });

  it('returns an empty object for no rows', () => {
    expect(runFromBranchInputsToObject([])).toEqual({});
  });
});

describe('runFromBranchDuplicateKeys', () => {
  it('lists trimmed keys that repeat and ignores blank keys', () => {
    expect(
      runFromBranchDuplicateKeys([
        {key: 'environment', value: 'staging'},
        {key: 'environment', value: 'production'},
        {key: ' region ', value: 'us-east-1'},
        {key: 'region', value: 'eu-west-1'},
        {key: '', value: 'ignored'},
        {key: '  ', value: 'ignored'},
      ]),
    ).toEqual(['environment', 'region']);
  });

  it('returns no duplicates for unique keys', () => {
    expect(
      runFromBranchDuplicateKeys([
        {key: 'environment', value: 'staging'},
        {key: 'region', value: 'us-east-1'},
      ]),
    ).toEqual([]);
  });
});
