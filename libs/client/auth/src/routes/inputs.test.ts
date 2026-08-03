import {validatePasswordResetSearch, validateRedirectSearch} from './inputs.js';

describe('auth route inputs', () => {
  it('keeps only a non-empty redirect', () => {
    expect(validateRedirectSearch({redirect: '/w/acme'})).toEqual({
      redirect: '/w/acme',
    });
    expect(validateRedirectSearch({redirect: ''})).toEqual({});
    expect(validateRedirectSearch({redirect: ['unexpected']})).toEqual({});
  });

  it('keeps only a non-empty password reset token', () => {
    expect(validatePasswordResetSearch({token: 'reset-token'})).toEqual({token: 'reset-token'});
    expect(validatePasswordResetSearch({token: ''})).toEqual({});
    expect(validatePasswordResetSearch({token: {value: 'unexpected'}})).toEqual({});
  });
});
