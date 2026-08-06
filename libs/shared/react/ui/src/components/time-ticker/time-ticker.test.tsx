import {act, render, screen} from '@testing-library/react';
import {TimeTickerProvider, useTimeTick} from './time-ticker.js';

function TickValue() {
  const tick = useTimeTick();
  return <span>{tick}</span>;
}

function setMatchMedia(reduced: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: query.includes('reduce') ? reduced : query.includes('min-width'),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {configurable: true, value: state});
}

describe('TimeTickerProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setMatchMedia(false);
    setVisibility('visible');
  });

  afterEach(() => {
    vi.useRealTimers();
    setMatchMedia(false);
    setVisibility('visible');
  });

  test('ticks at the configured interval', () => {
    render(
      <TimeTickerProvider intervalMs={1000}>
        <TickValue />
      </TimeTickerProvider>,
    );

    expect(screen.getByText('0')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByText('1')).toBeTruthy();
  });

  test('uses the reduced motion interval when requested', () => {
    setMatchMedia(true);

    render(
      <TimeTickerProvider intervalMs={1000} reducedMotionIntervalMs={10_000}>
        <TickValue />
      </TimeTickerProvider>,
    );

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByText('0')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(9000);
    });

    expect(screen.getByText('1')).toBeTruthy();
  });

  test('shares the fastest interval with nested providers', () => {
    render(
      <TimeTickerProvider intervalMs={1000}>
        <TimeTickerProvider intervalMs={100}>
          <TickValue />
        </TimeTickerProvider>
      </TimeTickerProvider>,
    );

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByText('1')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(screen.getByText('10')).toBeTruthy();
  });

  test('does not tick while the tab is hidden', () => {
    setVisibility('hidden');

    render(
      <TimeTickerProvider intervalMs={1000}>
        <TickValue />
      </TimeTickerProvider>,
    );

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.getByText('0')).toBeTruthy();
  });

  test('ticks immediately when the tab becomes visible', () => {
    setVisibility('hidden');

    render(
      <TimeTickerProvider intervalMs={1000}>
        <TickValue />
      </TimeTickerProvider>,
    );

    setVisibility('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(screen.getByText('1')).toBeTruthy();
  });
});
