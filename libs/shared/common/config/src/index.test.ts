import {bool, createConfig, num, str} from './index.js';

describe('config', () => {
  afterEach(() => {
    delete process.env.TEST_STRING;
    delete process.env.TEST_NUMBER;
    delete process.env.TEST_BOOL;
    delete process.env.TEST_STRING;
  });

  it('should create config with string validation', () => {
    const schema = {
      TEST_STRING: str(),
    };

    // Set test environment variable
    process.env.TEST_STRING = 'test-value';

    const config = createConfig(schema);

    expect(config.TEST_STRING).toBe('test-value');
  });

  it('should create config with number validation', () => {
    const schema = {
      TEST_NUMBER: num(),
    };

    // Set test environment variable
    process.env.TEST_NUMBER = '42';

    const config = createConfig(schema);

    expect(config.TEST_NUMBER).toBe(42);
  });

  it('should create config with boolean validation', () => {
    const schema = {
      TEST_BOOL: bool(),
    };

    // Set test environment variable
    process.env.TEST_BOOL = 'true';

    const config = createConfig(schema);

    expect(config.TEST_BOOL).toBe(true);
  });

  it('should update config', () => {
    const schema = {
      TEST_STRING: str(),
    };

    process.env.TEST_STRING = 'test-value';

    let config = createConfig(schema);

    config = createConfig(schema, {TEST_STRING: 'test-value2'});

    expect(config.TEST_STRING).toBe('test-value2');
  });
});
