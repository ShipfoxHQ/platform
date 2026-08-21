import {act, render} from '@testing-library/react';
import {useBodyPointerEventsRelease} from './useBodyPointerEventsRelease.js';

function Probe({open}: {open: boolean}) {
  useBodyPointerEventsRelease(open);
  return null;
}

/** Stands in for the lock Radix's dismissable layer puts on the body. */
function lockBody() {
  document.body.style.pointerEvents = 'none';
}

/** Runs past every checkpoint the hook schedules. */
function settleCheckpoints() {
  act(() => {
    vi.advanceTimersByTime(2000);
  });
}

function addLayer(state: 'open' | 'closed') {
  const layer = document.createElement('div');
  layer.setAttribute('role', 'menu');
  layer.setAttribute('data-state', state);
  document.body.append(layer);
  return layer;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.style.removeProperty('pointer-events');
  document.body.replaceChildren();
});

describe('useBodyPointerEventsRelease', () => {
  test('releases a lock left behind after the surface closes', () => {
    const {rerender} = render(<Probe open />);
    lockBody();

    rerender(<Probe open={false} />);
    settleCheckpoints();

    expect(document.body.style.pointerEvents).toBe('');
  });

  test('releases a lock left behind when the surface unmounts while open', () => {
    const {unmount} = render(<Probe open />);
    lockBody();

    unmount();
    settleCheckpoints();

    expect(document.body.style.pointerEvents).toBe('');
  });

  test('releases the lock even when a closed layer lingers in the document', () => {
    const {rerender} = render(<Probe open />);
    lockBody();
    addLayer('closed');

    rerender(<Probe open={false} />);
    settleCheckpoints();

    expect(document.body.style.pointerEvents).toBe('');
  });

  test('leaves the lock alone while an open layer still owns it', () => {
    const {rerender} = render(<Probe open />);
    lockBody();
    addLayer('open');

    rerender(<Probe open={false} />);
    settleCheckpoints();

    expect(document.body.style.pointerEvents).toBe('none');
  });

  test('leaves a lock the page already held before the surface opened', () => {
    lockBody();
    const {rerender} = render(<Probe open />);

    rerender(<Probe open={false} />);
    settleCheckpoints();

    expect(document.body.style.pointerEvents).toBe('none');
  });

  test('does not touch the body when no lock is present', () => {
    document.body.style.pointerEvents = 'auto';
    const {rerender} = render(<Probe open />);

    rerender(<Probe open={false} />);
    settleCheckpoints();

    expect(document.body.style.pointerEvents).toBe('auto');
  });

  test('does nothing when the surface was never opened', () => {
    lockBody();
    const {rerender} = render(<Probe open={false} />);

    rerender(<Probe open={false} />);
    settleCheckpoints();

    expect(document.body.style.pointerEvents).toBe('none');
  });
});
