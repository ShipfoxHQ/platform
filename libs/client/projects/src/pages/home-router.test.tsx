// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {configureApiClient} from '@shipfox/client-api';
import {screen} from '@testing-library/react';
import {jsonResponse, PROJECT_TEST_WSLUG, renderProjectPage} from '#test/pages.js';
import {HomeRouter} from './home-router.js';

describe('HomeRouter', () => {
  test('renders the completed-workspace project landing', async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes('/projects?')) {
        return Promise.resolve(jsonResponse({projects: [], next_cursor: null}));
      }
      return Promise.resolve(jsonResponse({}, {status: 404}));
    });
    configureApiClient({fetchImpl});

    renderProjectPage(`/w/${PROJECT_TEST_WSLUG}`, <HomeRouter />);

    expect(await screen.findByRole('heading', {name: 'Projects'})).toBeInTheDocument();
    const calledUrls = fetchImpl.mock.calls.map(([input]) =>
      input instanceof Request ? input.url : String(input),
    );
    expect(calledUrls.some((url) => url.includes('/integration-connections?'))).toBe(false);
  });
});
