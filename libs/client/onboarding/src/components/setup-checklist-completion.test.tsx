// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {afterEach, describe, expect, test, vi} from '@shipfox/vitest/vi';
import {act, render} from '@testing-library/react';
import {SetupChecklistCompletion} from './setup-checklist-completion.js';

const CONFETTI_START_TIME = 1000;
const CONFETTI_DURATION_MS = 2000;
const CANVAS_WIDTH = 480;
const CANVAS_HEIGHT = 88;

interface CanvasContextSpies {
  clearRect: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
}

function setupCanvas(reducedMotion: boolean): CanvasContextSpies {
  vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0');
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query) =>
      ({
        addEventListener: vi.fn(),
        addListener: vi.fn(),
        dispatchEvent: vi.fn(() => false),
        matches: reducedMotion,
        media: query,
        onchange: null,
        removeEventListener: vi.fn(),
        removeListener: vi.fn(),
      }) as MediaQueryList,
  );

  const clearRect = vi.fn();
  const fillRect = vi.fn();
  const context = {
    clearRect,
    fillRect,
    fillStyle: '',
    globalAlpha: 1,
    restore: vi.fn(),
    rotate: vi.fn(),
    save: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
  } as unknown as CanvasRenderingContext2D;

  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    bottom: CANVAS_HEIGHT,
    height: CANVAS_HEIGHT,
    left: 0,
    right: CANVAS_WIDTH,
    top: 0,
    width: CANVAS_WIDTH,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    getPropertyValue: () => '#22c55e',
  } as unknown as CSSStyleDeclaration);
  vi.spyOn(performance, 'now').mockReturnValue(CONFETTI_START_TIME);

  return {clearRect, fillRect};
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SetupChecklistCompletion burst', () => {
  test('keeps a reduced-motion frame after the host consumes the burst', () => {
    const context = setupCanvas(true);
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame');
    const onBurstComplete = vi.fn();
    const {rerender} = render(
      <SetupChecklistCompletion showBurst onBurstComplete={onBurstComplete} />,
    );

    expect(onBurstComplete).toHaveBeenCalledTimes(1);
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(context.fillRect).toHaveBeenCalledTimes(48);

    const clearCallsAfterDraw = context.clearRect.mock.calls.length;
    rerender(<SetupChecklistCompletion showBurst={false} onBurstComplete={onBurstComplete} />);

    expect(context.clearRect).toHaveBeenCalledTimes(clearCallsAfterDraw);
    expect(context.fillRect).toHaveBeenCalledTimes(48);
  });

  test('animates and completes the burst when motion is allowed', () => {
    const context = setupCanvas(false);
    let frameCallback: FrameRequestCallback | undefined;
    const requestAnimationFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frameCallback = callback;
        return 1;
      });
    const cancelAnimationFrame = vi.spyOn(window, 'cancelAnimationFrame');
    const onBurstComplete = vi.fn();

    render(<SetupChecklistCompletion showBurst onBurstComplete={onBurstComplete} />);

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(context.fillRect).not.toHaveBeenCalled();

    act(() => {
      frameCallback?.(CONFETTI_START_TIME + 16);
    });

    expect(context.fillRect).toHaveBeenCalledTimes(48);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
    expect(onBurstComplete).not.toHaveBeenCalled();

    act(() => {
      frameCallback?.(CONFETTI_START_TIME + CONFETTI_DURATION_MS);
    });

    expect(onBurstComplete).toHaveBeenCalledTimes(1);
    expect(cancelAnimationFrame).not.toHaveBeenCalled();
  });
});
