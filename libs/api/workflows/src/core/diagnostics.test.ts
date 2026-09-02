import {diagnosticValueByteLength} from './diagnostics.js';

describe('diagnosticValueByteLength', () => {
  test('matches PostgreSQL JSONB text spacing for structured values', () => {
    const value = {message: 'comma, colon:', nested: [true, 'é']};

    expect(diagnosticValueByteLength(value)).toBe(
      Buffer.byteLength('{"message": "comma, colon:", "nested": [true, "é"]}', 'utf8'),
    );
  });

  test('does not count punctuation inside JSON strings as separators', () => {
    expect(diagnosticValueByteLength({value: 'a,b:c'})).toBe(
      Buffer.byteLength('{"value": "a,b:c"}', 'utf8'),
    );
  });

  test('expands exponent-form numbers like PostgreSQL JSONB text', () => {
    expect(diagnosticValueByteLength({small: 1e-7, large: 1e21})).toBe(
      Buffer.byteLength('{"small": 0.0000001, "large": 1000000000000000000000}', 'utf8'),
    );
  });
});
