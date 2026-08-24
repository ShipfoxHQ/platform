import {afterEach, describe, expect, test, vi} from '@shipfox/vitest/vi';
import {createConfettiParticles} from './setup-checklist-completion.js';

describe('createConfettiParticles', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('creates the same particle layout for every visual capture', () => {
    const random = vi.spyOn(Math, 'random');
    const palette = ['blue', 'purple', 'success', 'warning'];

    const first = createConfettiParticles(480, 88, palette);
    const second = createConfettiParticles(480, 88, palette);

    expect(first).toEqual(second);
    expect(first).toHaveLength(48);
    expect(random).not.toHaveBeenCalled();
  });
});
