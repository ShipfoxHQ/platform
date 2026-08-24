export const CONFETTI_PARTICLE_COUNT = 48;

interface ConfettiParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  size: number;
  color: string;
}

export function createConfettiParticles(
  width: number,
  height: number,
  palette: readonly string[],
  seed?: number,
): ConfettiParticle[] {
  const random = seed === undefined ? Math.random : createSeededRandom(seed);

  return Array.from({length: CONFETTI_PARTICLE_COUNT}, (_, index) => ({
    x: width / 2 + (random() - 0.5) * width * 0.55,
    y: height * (0.4 + random() * 0.15),
    vx: (random() - 0.5) * 2.5,
    vy: -(random() * 0.7 + 0.4),
    rotation: random() * Math.PI,
    size: random() * 5 + 5,
    color: palette[index % palette.length] ?? palette[0] ?? '',
  }));
}

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
}
