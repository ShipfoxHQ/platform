import {validateOAuthConsentSearch} from './inputs.js';

describe('validateOAuthConsentSearch', () => {
  test('accepts only a non-empty opaque request id', () => {
    expect(validateOAuthConsentSearch({request_id: 'request-123', client_id: 'ignored'})).toEqual({
      requestId: 'request-123',
    });
    expect(validateOAuthConsentSearch({request_id: ''})).toEqual({});
    expect(validateOAuthConsentSearch({request_id: ['request-123']})).toEqual({});
  });
});
