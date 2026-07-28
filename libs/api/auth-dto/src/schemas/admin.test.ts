import {describe, expect, it} from '@shipfox/vitest/vi';
import {isAdminRole} from '../index.js';

describe('isAdminRole', () => {
  it.each(['admin-observer', 'admin-operator', 'admin-owner'])('accepts %s', (value) => {
    expect(isAdminRole(value)).toBe(true);
  });

  it.each([undefined, null, '', 'admin-custom'])('rejects %s', (value) => {
    expect(isAdminRole(value)).toBe(false);
  });
});
