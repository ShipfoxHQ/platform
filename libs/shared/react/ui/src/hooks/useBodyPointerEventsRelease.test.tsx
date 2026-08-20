import {render, waitFor} from '@testing-library/react';
import {useBodyPointerEventsRelease} from './useBodyPointerEventsRelease.js';

function Probe({open}: {open: boolean}) {
  useBodyPointerEventsRelease(open);
  return null;
}

/** Stands in for the lock Radix's dismissable layer puts on the body. */
function lockBody() {
  document.body.style.pointerEvents = 'none';
}

afterEach(() => {
  document.body.style.removeProperty('pointer-events');
  document.body.replaceChildren();
});

describe('useBodyPointerEventsRelease', () => {
  test('releases a lock left behind after the surface closes', async () => {
    const {rerender} = render(<Probe open />);
    lockBody();

    rerender(<Probe open={false} />);

    await waitFor(() => {
      expect(document.body.style.pointerEvents).toBe('');
    });
  });

  test('releases a lock left behind when the surface unmounts while open', async () => {
    const {unmount} = render(<Probe open />);
    lockBody();

    unmount();

    await waitFor(() => {
      expect(document.body.style.pointerEvents).toBe('');
    });
  });

  test('leaves the lock alone while another layer still owns it', async () => {
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    document.body.append(menu);

    const {rerender} = render(<Probe open />);
    lockBody();

    rerender(<Probe open={false} />);
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(document.body.style.pointerEvents).toBe('none');
  });

  test('does not touch the body when no lock is present', async () => {
    document.body.style.pointerEvents = 'auto';
    const {rerender} = render(<Probe open />);

    rerender(<Probe open={false} />);
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(document.body.style.pointerEvents).toBe('auto');
  });

  test('does nothing when the surface was never opened', async () => {
    lockBody();
    const {rerender} = render(<Probe open={false} />);

    rerender(<Probe open={false} />);
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(document.body.style.pointerEvents).toBe('none');
  });
});
