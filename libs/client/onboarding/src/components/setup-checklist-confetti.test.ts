import {describe, expect, test} from '@shipfox/vitest/vi';
import {CONFETTI_PARTICLE_COUNT, createConfettiParticles} from './setup-checklist-confetti.js';

describe('createConfettiParticles', () => {
  test('creates a deterministic particle layout within the burst bounds', () => {
    const palette = ['blue', 'purple', 'success', 'warning'];
    const seed = 0x5f3759df;

    const first = createConfettiParticles(480, 88, palette, seed);
    const second = createConfettiParticles(480, 88, palette, seed);
    const xPositions = first.map(({x}) => x);

    expect(first).toEqual(second);
    expect(first).toHaveLength(CONFETTI_PARTICLE_COUNT);
    expect(Math.min(...xPositions)).toBeGreaterThanOrEqual(480 * 0.225);
    expect(Math.max(...xPositions)).toBeLessThanOrEqual(480 * 0.775);
    expect(new Set(xPositions).size).toBeGreaterThan(1);
  });
});
