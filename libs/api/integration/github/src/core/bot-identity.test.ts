import {configuredGithubAppBotLogin, githubAppBotLogin, githubBotLogin} from './bot-identity.js';

describe('GitHub App bot identity', () => {
  it.each([
    ['shipfox-ai', 'shipfox-ai[bot]'],
    ['shipfox-ai[bot]', 'shipfox-ai[bot]'],
    ['Shipfox-AI[Bot]', 'Shipfox-AI[Bot]'],
  ])('normalizes %s to %s', (username, expected) => {
    expect(githubBotLogin(username)).toBe(expected);
  });

  it('uses the configured username for commit attribution', () => {
    expect(configuredGithubAppBotLogin()).toBe('shipfox-test[bot]');
  });

  it('uses the configured username for App review identity', () => {
    expect(githubAppBotLogin()).toBe('shipfox-test[bot]');
  });
});
