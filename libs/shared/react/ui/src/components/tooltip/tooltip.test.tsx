import {act, fireEvent, render, screen} from '@testing-library/react';
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from './tooltip.js';

function TooltipPair() {
  return (
    <TooltipProvider disableHoverableContent>
      <Tooltip>
        <TooltipTrigger>First trigger</TooltipTrigger>
        <TooltipContent>First tooltip</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger>Second trigger</TooltipTrigger>
        <TooltipContent>Second tooltip</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function movePointerOver(element: HTMLElement) {
  fireEvent.pointerMove(element, {pointerType: 'mouse'});
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Tooltip timing', () => {
  test('waits before opening a standalone tooltip', () => {
    render(
      <Tooltip>
        <TooltipTrigger>Trigger</TooltipTrigger>
        <TooltipContent>Tooltip content</TooltipContent>
      </Tooltip>,
    );

    movePointerOver(screen.getByRole('button', {name: 'Trigger'}));
    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('tooltip').textContent).toBe('Tooltip content');
    expect(
      document.querySelector('[data-slot="tooltip-content"]')?.getAttribute('data-state'),
    ).toBe('delayed-open');
  });

  test('cancels a pending tooltip when the pointer only crosses its trigger', () => {
    render(
      <Tooltip>
        <TooltipTrigger>Trigger</TooltipTrigger>
        <TooltipContent>Tooltip content</TooltipContent>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', {name: 'Trigger'});

    movePointerOver(trigger);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.pointerLeave(trigger);
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  test('opens adjacent tooltips immediately during the shared warm window', () => {
    render(<TooltipPair />);
    const firstTrigger = screen.getByRole('button', {name: 'First trigger'});
    const secondTrigger = screen.getByRole('button', {name: 'Second trigger'});

    movePointerOver(firstTrigger);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByRole('tooltip').textContent).toBe('First tooltip');

    fireEvent.pointerLeave(firstTrigger);
    movePointerOver(secondTrigger);
    expect(screen.getByRole('tooltip').textContent).toBe('Second tooltip');
  });

  test('restores the opening delay after the warm window expires', () => {
    render(<TooltipPair />);
    const firstTrigger = screen.getByRole('button', {name: 'First trigger'});
    const secondTrigger = screen.getByRole('button', {name: 'Second trigger'});

    movePointerOver(firstTrigger);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.pointerLeave(firstTrigger);
    act(() => {
      vi.advanceTimersByTime(300);
    });

    movePointerOver(secondTrigger);
    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('tooltip').textContent).toBe('Second tooltip');
  });

  test('opens immediately for keyboard focus', () => {
    render(
      <Tooltip>
        <TooltipTrigger>Trigger</TooltipTrigger>
        <TooltipContent>Tooltip content</TooltipContent>
      </Tooltip>,
    );

    fireEvent.focus(screen.getByRole('button', {name: 'Trigger'}));

    expect(screen.getByRole('tooltip').textContent).toBe('Tooltip content');
    expect(
      document.querySelector('[data-slot="tooltip-content"]')?.getAttribute('data-state'),
    ).toBe('instant-open');
  });
});
