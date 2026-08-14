// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {render, screen} from '@testing-library/react';
import {FocusedFrame} from './focused-frame.js';

describe('FocusedFrame', () => {
  test('provides the shared focused width and centering contract', () => {
    render(
      <FocusedFrame>
        <span>Focused content</span>
      </FocusedFrame>,
    );

    expect(screen.getByText('Focused content').parentElement).toHaveClass(
      'mx-auto',
      'w-full',
      'max-w-[640px]',
    );
  });
});
