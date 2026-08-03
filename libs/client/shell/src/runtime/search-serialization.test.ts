import {parseAppSearch, stringifyAppSearch} from './search-serialization.js';

describe('stringifyAppSearch', () => {
  test('repeats the key for each element of an array', () => {
    expect(stringifyAppSearch({status: ['failed', 'running']})).toBe(
      '?status=failed&status=running',
    );
  });

  test('keeps a value containing a comma intact, which comma-joining would split', () => {
    const searchStr = stringifyAppSearch({branch: ['release,v2', 'main']});

    expect(parseAppSearch(searchStr)).toEqual({branch: ['release,v2', 'main']});
  });

  test('omits an empty array so an unset filter leaves no trace in the URL', () => {
    expect(stringifyAppSearch({status: [], search: 'deploy'})).toBe('?search=deploy');
  });

  test('omits undefined values', () => {
    expect(stringifyAppSearch({search: undefined, status: ['failed']})).toBe('?status=failed');
  });

  test('returns an empty string rather than a bare question mark for empty search', () => {
    expect(stringifyAppSearch({})).toBe('');
  });

  test('round-trips a scalar string unchanged', () => {
    expect(parseAppSearch(stringifyAppSearch({search: 'deploy-web'}))).toEqual({
      search: 'deploy-web',
    });
  });

  test('quotes a numeric-looking string so it parses back as a string', () => {
    expect(parseAppSearch(stringifyAppSearch({search: '42'}))).toEqual({search: '42'});
  });

  test('round-trips an object value as JSON, matching the default encoder', () => {
    expect(parseAppSearch(stringifyAppSearch({filter: {status: 'failed'}}))).toEqual({
      filter: {status: 'failed'},
    });
  });

  // Documents the one asymmetry callers must absorb: a single repeated key is
  // indistinguishable from a scalar in a URL, so validators normalize on the way in.
  test('parses a single-element array back as a scalar', () => {
    expect(parseAppSearch(stringifyAppSearch({status: ['failed']}))).toEqual({status: 'failed'});
  });

  // The encoder quotes a JSON-parseable string so it survives the parser. That quoting has to
  // be undone for repeated keys too, or a numeric-looking branch name comes back wearing
  // literal quotes and silently matches nothing.
  test.each([
    ['numeric strings', {actor: ['123', '456']}],
    ['a numeric string beside a plain one', {branch: ['2024', 'main']}],
    ['a boolean-looking string', {branch: ['false', 'main']}],
    ['a null-looking string', {branch: ['null', 'main']}],
  ])('round-trips %s in a multi-value filter', (_case, search) => {
    expect(parseAppSearch(stringifyAppSearch(search))).toEqual(search);
  });

  test('round-trips an array of objects', () => {
    const search = {filter: [{status: 'failed'}, {status: 'running'}]};

    expect(parseAppSearch(stringifyAppSearch(search))).toEqual(search);
  });

  test('leaves a genuinely numeric array as numbers', () => {
    expect(parseAppSearch(stringifyAppSearch({attempt: [1, 2]}))).toEqual({attempt: [1, 2]});
  });
});
