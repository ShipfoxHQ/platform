import {DEFINITION_RESOLVED} from '@shipfox/api-definitions-dto';
import {getSubscribers, resetSubscribers, subscribe} from '@shipfox/node-module';

describe('subscriber registry', () => {
  beforeEach(() => {
    resetSubscribers();
  });

  test('returns empty array for unregistered event type', () => {
    const handlers = getSubscribers(DEFINITION_RESOLVED);

    expect(handlers).toEqual([]);
  });

  test('returns registered handlers for an event type', () => {
    const handler = async () => Promise.resolve();
    subscribe(DEFINITION_RESOLVED, handler);

    const handlers = getSubscribers(DEFINITION_RESOLVED);

    expect(handlers).toHaveLength(1);
  });

  test('returns multiple handlers for the same event type', () => {
    const handler1 = async () => Promise.resolve();
    const handler2 = async () => Promise.resolve();
    subscribe(DEFINITION_RESOLVED, handler1);
    subscribe(DEFINITION_RESOLVED, handler2);

    const handlers = getSubscribers(DEFINITION_RESOLVED);

    expect(handlers).toHaveLength(2);
  });

  test('resetSubscribers clears all handlers', () => {
    subscribe(DEFINITION_RESOLVED, async () => Promise.resolve());

    resetSubscribers();
    const handlers = getSubscribers(DEFINITION_RESOLVED);

    expect(handlers).toEqual([]);
  });
});
