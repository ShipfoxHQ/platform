# Shipfox Resilient Loop

Node helpers for Shipfox loops that need retry waits and a clean stop path.

## What it does

- **`nextBackoffInterval(currentMs, options)`**: Grows a retry wait and caps it at `maxMs`.
- **`withJitter(ms, options)`**: Returns a random wait inside a factor range for the current wait.
- **`interruptibleSleep(ms, signal)`**: Sleeps until the timer ends or the abort signal fires.
- **`createGracefulShutdownController(options)`**: Adds process signal handlers and exposes one abort signal for loop sleeps.

## Installation and setup

This is private workspace code. Add it where it is used with `workspace:*`:

```json
{
  "dependencies": {
    "@shipfox/node-resilient-loop": "workspace:*"
  }
}
```

## Usage

Use it when a Node process runs in a loop and must wait between tries.
The same signal can wake the sleep and tell the loop to stop.
Keep one controller for the life of the loop.

```ts
import {
  createGracefulShutdownController,
  interruptibleSleep,
  nextBackoffInterval,
  withJitter,
} from '@shipfox/node-resilient-loop';

let running = true;
const shutdown = createGracefulShutdownController({
  onFirstSignal: () => {
    running = false;
  },
  onSecondSignal: () => {
    process.exit(1);
  },
});

shutdown.start();
shutdown.reset();

let intervalMs = 1000;

while (running) {
  try {
    await runOneIteration({signal: shutdown.signal});
    intervalMs = 1000;
  } catch {
    intervalMs = nextBackoffInterval(intervalMs, {maxMs: 5000});
  }

  await interruptibleSleep(withJitter(intervalMs, {minFactor: 0.5}), shutdown.signal);
}
```

## Behavior notes

- `createGracefulShutdownController()` listens for `SIGINT` and `SIGTERM` by default.
- `start()` is safe to call more than once, so repeated loop starts do not add duplicate signal handlers.
- `reset()` clears shutdown state and creates a fresh abort signal after a previous stop.
- `interruptibleSleep()` resolves when its signal aborts. It rethrows timer errors that are not caused by that signal.

## Development

```sh
turbo check --filter=@shipfox/node-resilient-loop
turbo type --filter=@shipfox/node-resilient-loop
turbo test --filter=@shipfox/node-resilient-loop
```

## License

MIT
