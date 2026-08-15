import eventsSettingsRoute from './events-settings.js';

describe('events settings route', () => {
  test('uses the content frame', () => {
    expect(eventsSettingsRoute.options.staticData.frame).toBe('content');
  });
});
