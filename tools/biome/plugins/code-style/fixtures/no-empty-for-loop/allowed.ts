export function runUntilStopped(shouldStop: () => boolean, step: () => void): void {
  while (!shouldStop()) {
    step();
  }
}

export function runForever(): never {
  while (true) {
    throw new Error('Stopped');
  }
}

export function retryThreeTimes(step: () => void): void {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    step();
  }
}
