import {access, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, isAbsolute, join} from 'node:path';
import type {StepDto} from '@shipfox/api-workflows-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {type CommandStartMetadata, executeRunStep, type OutputSink} from '#core/run-step.js';
import {MAX_OUTPUT_TOTAL_BYTES} from '#core/step-output.js';

const GRANDCHILD_PID_REGEX = /GRANDCHILD_PID=(\d+)/;
const READY_REGEX = /READY/;
const ESRCH_REGEX = /ESRCH/;
const SHELL_EXECUTABLE_REGEX = /(?:^|\/)(bash|sh)$/;
const SCRIPT_PATH_REGEX = /shipfox-runner-.*\.sh$/;
const OUTPUT_PATH_REGEX = /shipfox-output-/;
const SUMMARY_PATH_REGEX = /shipfox-step-summary-/;
const ANNOTATIONS_DIR_REGEX = /shipfox-annotations-/;
const PROCESS_TEST_WAIT_TIMEOUT_MS = 4_000;

function collectOutput(): {sink: OutputSink; text: () => string; sources: () => string[]} {
  const chunks: Buffer[] = [];
  const sources: string[] = [];
  return {
    sink: (chunk, source) => {
      chunks.push(chunk);
      sources.push(source);
    },
    text: () => Buffer.concat(chunks).toString(),
    sources: () => sources,
  };
}

function nodeEnvDumpCommand(keys: readonly string[]): string {
  const script = `const keys = ${JSON.stringify(keys)}; process.stdout.write(JSON.stringify(Object.fromEntries(keys.map((key) => [key, process.env[key] ?? null]))));`;
  return `node -e ${JSON.stringify(script)}`;
}

async function waitForOutputMatch(
  output: Pick<ReturnType<typeof collectOutput>, 'text'>,
  regex: RegExp,
): Promise<RegExpMatchArray> {
  await vi.waitFor(
    () => {
      expect(output.text()).toMatch(regex);
    },
    {timeout: PROCESS_TEST_WAIT_TIMEOUT_MS},
  );

  const match = output.text().match(regex);
  if (!match) throw new Error(`Expected output to match ${regex}`);
  return match;
}

async function waitForProcessExit(pid: number): Promise<void> {
  await vi.waitFor(
    () => {
      expect(() => process.kill(pid, 0)).toThrow(ESRCH_REGEX);
    },
    {timeout: PROCESS_TEST_WAIT_TIMEOUT_MS},
  );
}

async function waitForProcessAlive(pid: number): Promise<void> {
  await vi.waitFor(
    () => {
      expect(() => process.kill(pid, 0)).not.toThrow();
    },
    {timeout: PROCESS_TEST_WAIT_TIMEOUT_MS},
  );
}

describe('executeRunStep', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('succeeds with exit code 0', async () => {
    const step = buildStep({config: {run: 'echo hello'}});
    const output = collectOutput();

    const result = await executeRunStep(step, {onOutput: output.sink});

    expect(result.success).toBe(true);
    expect(output.text()).toContain('hello');
    expect(result.exit_code).toBe(0);
  });

  it('captures outputs from the output file', async () => {
    const step = buildStep({
      config: {
        run: 'echo "image_sha=sha-123" >> "$SHIPFOX_OUTPUT"\necho "tag=release=latest" >> "$SHIPFOX_OUTPUT"',
      },
    });

    const result = await executeRunStep(step);

    expect(result.outputs).toEqual({
      image_sha: 'sha-123',
      tag: 'release=latest',
    });
  });

  it('passes step env to the spawned process with precedence over inherited env', async () => {
    const previous = process.env.SHIPFOX_ENV_TEST_EXISTING;
    process.env.SHIPFOX_ENV_TEST_EXISTING = 'inherited';
    try {
      const step = buildStep({
        config: {
          run: nodeEnvDumpCommand(['SHIPFOX_ENV_TEST_CUSTOM', 'SHIPFOX_ENV_TEST_EXISTING']),
          env: {
            SHIPFOX_ENV_TEST_CUSTOM: 'custom',
            SHIPFOX_ENV_TEST_EXISTING: 'step',
          },
        },
      });
      const output = collectOutput();

      const result = await executeRunStep(step, {onOutput: output.sink});

      expect(result.success).toBe(true);
      expect(JSON.parse(output.text())).toEqual({
        SHIPFOX_ENV_TEST_CUSTOM: 'custom',
        SHIPFOX_ENV_TEST_EXISTING: 'step',
      });
    } finally {
      if (previous === undefined) {
        delete process.env.SHIPFOX_ENV_TEST_EXISTING;
      } else {
        process.env.SHIPFOX_ENV_TEST_EXISTING = previous;
      }
    }
  });

  it('merges secret env over step env without mutating process.env', async () => {
    const previous = process.env.SHIPFOX_ENV_TEST_SECRET;
    delete process.env.SHIPFOX_ENV_TEST_SECRET;
    try {
      const step = buildStep({
        config: {
          run: nodeEnvDumpCommand(['SHIPFOX_ENV_TEST_SECRET']),
          env: {SHIPFOX_ENV_TEST_SECRET: 'stored-step-value'},
        },
      });
      const output = collectOutput();

      const result = await executeRunStep(step, {
        secretEnv: {SHIPFOX_ENV_TEST_SECRET: 'runtime-secret-value'},
        onOutput: output.sink,
      });

      expect(result.success).toBe(true);
      expect(JSON.parse(output.text())).toEqual({
        SHIPFOX_ENV_TEST_SECRET: 'runtime-secret-value',
      });
      expect(process.env.SHIPFOX_ENV_TEST_SECRET).toBeUndefined();
    } finally {
      if (previous !== undefined) process.env.SHIPFOX_ENV_TEST_SECRET = previous;
    }
  });

  it('merges system env over step and secret env without mutating process.env', async () => {
    const previous = process.env.SHIPFOX_ENV_TEST_SYSTEM;
    delete process.env.SHIPFOX_ENV_TEST_SYSTEM;
    try {
      const step = buildStep({
        config: {
          run: nodeEnvDumpCommand(['SHIPFOX_ENV_TEST_SYSTEM']),
          env: {SHIPFOX_ENV_TEST_SYSTEM: 'stored-step-value'},
        },
      });
      const output = collectOutput();

      const result = await executeRunStep(step, {
        secretEnv: {SHIPFOX_ENV_TEST_SYSTEM: 'secret-value'},
        systemEnv: {SHIPFOX_ENV_TEST_SYSTEM: 'system-value'},
        onOutput: output.sink,
      });

      expect(result.success).toBe(true);
      expect(JSON.parse(output.text())).toEqual({
        SHIPFOX_ENV_TEST_SYSTEM: 'system-value',
      });
      expect(process.env.SHIPFOX_ENV_TEST_SYSTEM).toBeUndefined();
    } finally {
      if (previous !== undefined) process.env.SHIPFOX_ENV_TEST_SYSTEM = previous;
    }
  });

  it('populates outputs from SHIPFOX_OUTPUT on success', async () => {
    const step = buildStep({
      config: {run: 'echo "sha=abc123" >> "$SHIPFOX_OUTPUT"'},
    });

    const result = await executeRunStep(step);

    expect(result.success).toBe(true);
    expect(result.outputs).toEqual({sha: 'abc123'});
  });

  it('exposes SHIPFOX_OUTPUT to the child and overrides user env', async () => {
    const step = buildStep({
      config: {
        run: 'echo "path=$SHIPFOX_OUTPUT" >> "$SHIPFOX_OUTPUT"',
        env: {SHIPFOX_OUTPUT: '/tmp/user-output'},
      },
    });

    const result = await executeRunStep(step);

    expect(result.success).toBe(true);
    expect(result.outputs?.path).toMatch(OUTPUT_PATH_REGEX);
    expect(result.outputs?.path).not.toBe('/tmp/user-output');
  });

  it('collects SHIPFOX_STEP_SUMMARY as a default annotation', async () => {
    const step = buildStep({
      config: {run: 'echo "### Summary" >> "$SHIPFOX_STEP_SUMMARY"'},
    });

    const result = await executeRunStep(step);

    expect(result.success).toBe(true);
    expect(result.annotations).toEqual([
      {context: 'default', style: 'default', op: 'replace', body: '### Summary\n'},
    ]);
  });

  it('collects JSON operation files from SHIPFOX_ANNOTATIONS_DIR', async () => {
    const operation = JSON.stringify({
      context: 'deploy',
      style: 'success',
      op: 'replace',
      body: 'deployed',
    });
    const step = buildStep({
      config: {
        run: `printf '%s' ${JSON.stringify(operation)} > "$SHIPFOX_ANNOTATIONS_DIR/001-op.json"`,
      },
    });

    const result = await executeRunStep(step);

    expect(result.success).toBe(true);
    expect(result.annotations).toEqual([
      {context: 'deploy', style: 'success', op: 'replace', body: 'deployed'},
    ]);
  });

  it('exposes annotation env to the child and overrides user env', async () => {
    const step = buildStep({
      config: {
        run: [
          'echo "summary=$SHIPFOX_STEP_SUMMARY" >> "$SHIPFOX_OUTPUT"',
          'echo "dir=$SHIPFOX_ANNOTATIONS_DIR" >> "$SHIPFOX_OUTPUT"',
        ].join('\n'),
        env: {
          SHIPFOX_STEP_SUMMARY: '/tmp/user-summary',
          SHIPFOX_ANNOTATIONS_DIR: '/tmp/user-annotations',
        },
      },
    });

    const result = await executeRunStep(step);

    expect(result.success).toBe(true);
    expect(result.outputs?.summary).toMatch(SUMMARY_PATH_REGEX);
    expect(result.outputs?.dir).toMatch(ANNOTATIONS_DIR_REGEX);
    expect(result.outputs?.summary).not.toBe('/tmp/user-summary');
    expect(result.outputs?.dir).not.toBe('/tmp/user-annotations');
  });

  it('does not fail a passing step when the annotation spool is malformed', async () => {
    const step = buildStep({
      config: {run: 'echo "{" > "$SHIPFOX_ANNOTATIONS_DIR/001-bad.json"'},
    });

    const result = await executeRunStep(step);

    expect(result.success).toBe(true);
    expect(result.annotations).toBeUndefined();
  });

  it('removes annotation spool files after collection', async () => {
    const step = buildStep({
      config: {
        run: [
          'echo "summary=$SHIPFOX_STEP_SUMMARY" >> "$SHIPFOX_OUTPUT"',
          'echo "dir=$SHIPFOX_ANNOTATIONS_DIR" >> "$SHIPFOX_OUTPUT"',
          'echo "body" >> "$SHIPFOX_STEP_SUMMARY"',
        ].join('\n'),
      },
    });

    const result = await executeRunStep(step);

    expect(result.success).toBe(true);
    expect(result.outputs?.summary).toMatch(SUMMARY_PATH_REGEX);
    expect(result.outputs?.dir).toMatch(ANNOTATIONS_DIR_REGEX);
    expect(result.outputs).toBeDefined();
    if (!result.outputs) throw new Error('Expected annotation spool output paths');
    const {summary, dir} = result.outputs;
    if (!summary || !dir) throw new Error('Expected annotation spool output paths');
    await expect(access(summary)).rejects.toThrow();
    await expect(access(dir)).rejects.toThrow();
  });

  it('fails a succeeded step when emitted output exceeds the total byte cap', async () => {
    const script = `require('node:fs').writeFileSync(process.env.SHIPFOX_OUTPUT, 'x'.repeat(${MAX_OUTPUT_TOTAL_BYTES + 1}))`;
    const step = buildStep({config: {run: `node -e ${JSON.stringify(script)}`}});

    const result = await executeRunStep(step);

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('Step output exceeds');
    expect(result.exit_code).toBeNull();
  });

  it('attaches valid outputs when the process exits non-zero', async () => {
    const step = buildStep({
      config: {run: 'echo "sha=abc123" >> "$SHIPFOX_OUTPUT"; exit 5'},
    });

    const result = await executeRunStep(step);

    expect(result.success).toBe(false);
    expect(result.error).toEqual({message: 'Command exited with code 5', exit_code: 5});
    expect(result.exit_code).toBe(5);
    expect(result.outputs).toEqual({sha: 'abc123'});
  });

  it('keeps the original failure when a failed process writes invalid output', async () => {
    const step = buildStep({
      config: {run: 'echo "bad key=value" >> "$SHIPFOX_OUTPUT"; exit 7'},
    });

    const result = await executeRunStep(step);

    expect(result.success).toBe(false);
    expect(result.error).toEqual({message: 'Command exited with code 7', exit_code: 7});
    expect(result.exit_code).toBe(7);
    expect(result.outputs).toBeUndefined();
  });

  it('fails a succeeded step that writes invalid output without echoing content', async () => {
    const step = buildStep({
      config: {run: 'echo "bad key=secret-value" >> "$SHIPFOX_OUTPUT"'},
    });

    const result = await executeRunStep(step);

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('invalid key');
    expect(result.error?.message).not.toContain('secret-value');
    expect(result.exit_code).toBeNull();
  });

  it('leaves outputs unset when there is no emission', async () => {
    const step = buildStep({config: {run: 'true'}});

    const result = await executeRunStep(step);

    expect(result.success).toBe(true);
    expect(result.outputs).toBeUndefined();
  });

  it('treats a deleted output file as no output', async () => {
    const step = buildStep({config: {run: 'rm "$SHIPFOX_OUTPUT"'}});

    const result = await executeRunStep(step);

    expect(result.success).toBe(true);
    expect(result.outputs).toBeUndefined();
  });

  it('fails a succeeded step when the output file cannot be read', async () => {
    const step = buildStep({config: {run: 'chmod 000 "$SHIPFOX_OUTPUT"'}});

    const result = await executeRunStep(step);

    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('Step output file could not be read.');
    expect(result.exit_code).toBeNull();
  });

  it('fails a succeeded step when the output file is replaced by a non-regular file', async () => {
    const step = buildStep({config: {run: 'rm "$SHIPFOX_OUTPUT"; mkfifo "$SHIPFOX_OUTPUT"'}});

    const result = await executeRunStep(step);

    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('Step output file is not a regular file.');
    expect(result.exit_code).toBeNull();
  });

  it('does not resolve the shell executable through step env PATH', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'shipfox-shell-path-test-'));
    try {
      await writeFile(join(dir, 'bash'), '#!/bin/sh\necho fake-bash\nexit 42\n', {mode: 0o700});
      const step = buildStep({
        config: {
          run: 'printf "%s" "$PATH"',
          env: {PATH: dir},
        },
      });
      const output = collectOutput();
      let metadata: CommandStartMetadata | undefined;

      const result = await executeRunStep(step, {
        onCommandStart: (value) => {
          metadata = value;
        },
        onOutput: output.sink,
      });

      expect(result.success).toBe(true);
      expect(output.text()).toBe(dir);
      expect(metadata).toBeDefined();
      if (!metadata) throw new Error('expected command metadata');
      expect(isAbsolute(metadata.shell.executable)).toBe(true);
      expect(metadata.shell.executable).not.toBe(join(dir, 'bash'));
    } finally {
      await rm(dir, {recursive: true, force: true});
    }
  });

  it('inherits process env when step env is absent', async () => {
    const previous = process.env.SHIPFOX_ENV_TEST_INHERITED;
    process.env.SHIPFOX_ENV_TEST_INHERITED = 'inherited';
    try {
      const step = buildStep({
        config: {run: nodeEnvDumpCommand(['SHIPFOX_ENV_TEST_INHERITED'])},
      });
      const output = collectOutput();

      const result = await executeRunStep(step, {onOutput: output.sink});

      expect(result.success).toBe(true);
      expect(JSON.parse(output.text())).toEqual({SHIPFOX_ENV_TEST_INHERITED: 'inherited'});
    } finally {
      if (previous === undefined) {
        delete process.env.SHIPFOX_ENV_TEST_INHERITED;
      } else {
        process.env.SHIPFOX_ENV_TEST_INHERITED = previous;
      }
    }
  });

  it('skips non-string step env values and warns without failing the step', async () => {
    const warn = vi.spyOn(logger(), 'warn').mockImplementation(() => undefined);
    const step = buildStep({
      config: {
        run: nodeEnvDumpCommand(['SHIPFOX_ENV_TEST_GOOD', 'SHIPFOX_ENV_TEST_BAD']),
        env: {
          SHIPFOX_ENV_TEST_GOOD: 'good',
          SHIPFOX_ENV_TEST_BAD: 123,
        },
      },
    });
    const output = collectOutput();

    const result = await executeRunStep(step, {onOutput: output.sink});

    expect(result.success).toBe(true);
    expect(JSON.parse(output.text())).toEqual({
      SHIPFOX_ENV_TEST_GOOD: 'good',
      SHIPFOX_ENV_TEST_BAD: null,
    });
    expect(warn).toHaveBeenCalledWith(
      {
        stepId: step.id,
        key: 'SHIPFOX_ENV_TEST_BAD',
        valueType: 'number',
      },
      'Skipping non-string step env value',
    );
  });

  it('fails with non-zero exit code and reports it on result.error', async () => {
    const step = buildStep({config: {run: 'exit 1'}});

    const result = await executeRunStep(step);

    expect(result.success).toBe(false);
    expect(result.error).toEqual({message: 'Command exited with code 1', exit_code: 1});
    expect(result.exit_code).toBe(1);
  });

  it('captures both stdout and stderr with their origin', async () => {
    const step = buildStep({config: {run: 'echo out && echo err >&2'}});
    const output = collectOutput();

    const result = await executeRunStep(step, {onOutput: output.sink});

    expect(result.success).toBe(true);
    expect(output.text()).toContain('out');
    expect(output.text()).toContain('err');
    expect(output.sources()).toContain('stdout');
    expect(output.sources()).toContain('stderr');
  });

  it('redacts secret wire forms from the runner stdout and stderr tee', async () => {
    const secret = 'runtime-secret-value';
    const hex = Buffer.from(secret).toString('hex');
    const step = buildStep({config: {run: `echo "${secret}"; echo "${hex}" >&2`}});
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true as never);
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as never);

    const result = await executeRunStep(step, {secretValues: [secret]});

    const stdout = stdoutWrite.mock.calls.map((call) => String(call[0])).join('');
    const stderr = stderrWrite.mock.calls.map((call) => String(call[0])).join('');
    expect(result.success).toBe(true);
    expect(stdout).toContain('***');
    expect(stderr).toContain('***');
    expect(stdout).not.toContain(secret);
    expect(stderr).not.toContain(hex);
  });

  it('redacts env and command secret output from the runner stdout tee', async () => {
    const secret = 'runtime-secret-e2e';
    const step = buildStep({
      config: {
        run: `echo "secret from env=$FROM_ENV_SECRET"; echo "secret from command=${secret}"`,
      },
    });
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true as never);

    const result = await executeRunStep(step, {
      secretEnv: {FROM_ENV_SECRET: secret},
      secretValues: [secret],
    });

    const stdout = stdoutWrite.mock.calls.map((call) => String(call[0])).join('');
    expect(result.success).toBe(true);
    expect(stdout).toContain('secret from env=***');
    expect(stdout).toContain('secret from command=***');
    expect(stdout).not.toContain(secret);
  });

  it('redacts a secret split across runner stdout tee chunks', async () => {
    const secret = 'sf_mrt_SPLITTEE_SECRET_12345';
    const firstFragment = secret.slice(0, 14);
    const secondFragment = secret.slice(14);
    const script = [
      `process.stdout.write(${JSON.stringify(firstFragment)});`,
      `setTimeout(() => process.stdout.end(${JSON.stringify(`${secondFragment}\n`)}), 20);`,
    ].join('');
    const step = buildStep({config: {run: `node -e ${JSON.stringify(script)}`}});
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true as never);

    const result = await executeRunStep(step, {secretValues: [secret]});

    const stdout = stdoutWrite.mock.calls.map((call) => String(call[0])).join('');
    expect(result.success).toBe(true);
    expect(stdout).toContain('***');
    expect(stdout).not.toContain(secret);
    expect(stdout).not.toContain(firstFragment);
    expect(stdout).not.toContain(secondFragment);
  });

  it('redacts a secret split across runner stderr tee chunks', async () => {
    const secret = 'sf_mrt_SPLITTEE_SECRET_67890';
    const firstFragment = secret.slice(0, 14);
    const secondFragment = secret.slice(14);
    const script = [
      `process.stderr.write(${JSON.stringify(firstFragment)});`,
      `setTimeout(() => process.stderr.end(${JSON.stringify(`${secondFragment}\n`)}), 20);`,
    ].join('');
    const step = buildStep({config: {run: `node -e ${JSON.stringify(script)}`}});
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as never);

    const result = await executeRunStep(step, {secretValues: [secret]});

    const stderr = stderrWrite.mock.calls.map((call) => String(call[0])).join('');
    expect(result.success).toBe(true);
    expect(stderr).toContain('***');
    expect(stderr).not.toContain(secret);
    expect(stderr).not.toContain(firstFragment);
    expect(stderr).not.toContain(secondFragment);
  });

  it('returns failure for unsupported step type with the reason on error.message', async () => {
    const step = buildStep({type: 'docker', config: {image: 'node:20'}});
    const output = collectOutput();

    const result = await executeRunStep(step, {onOutput: output.sink});

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('Unsupported step type: docker');
    expect(result.error?.exit_code).toBeUndefined();
    expect(output.text()).toBe('');
  });

  it('returns failure when config.run is missing with the reason on error.message', async () => {
    const step = buildStep({config: {}});

    const result = await executeRunStep(step);

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('missing or empty');
    expect(result.error?.exit_code).toBeUndefined();
  });

  it('reports signal kill on result.error when aborted', async () => {
    const step = buildStep({config: {run: 'echo READY; sleep 30'}});
    const output = collectOutput();
    const ac = new AbortController();
    const promise = executeRunStep(step, {signal: ac.signal, onOutput: output.sink});

    await waitForOutputMatch(output, READY_REGEX);
    ac.abort();

    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.error?.exit_code).toBeNull();
    expect(result.error?.signal).toBe('SIGKILL');
    expect(result.error?.message).toContain('SIGKILL');
  });

  it('runs the step in the provided cwd', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'shipfox-cwd-test-'));
    try {
      const step = buildStep({config: {run: 'pwd'}});
      const output = collectOutput();

      const result = await executeRunStep(step, {cwd: dir, onOutput: output.sink});

      expect(result.success).toBe(true);
      // macOS resolves tmpdir() through a /private symlink, so match the unique
      // mkdtemp suffix rather than the full path.
      expect(output.text()).toContain(basename(dir));
    } finally {
      await rm(dir, {recursive: true, force: true});
    }
  });

  it('emits resolved command metadata before stdout or stderr', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'shipfox-command-metadata-test-'));
    try {
      const step = buildStep({config: {run: 'echo hello'}});
      const events: string[] = [];
      let metadata: CommandStartMetadata | undefined;

      const result = await executeRunStep(step, {
        cwd: dir,
        onCommandStart: (value) => {
          events.push('metadata');
          metadata = value;
        },
        onOutput: () => {
          events.push('output');
        },
      });

      expect(result.success).toBe(true);
      expect(events[0]).toBe('metadata');
      expect(events).toContain('output');
      expect(metadata).toBeDefined();
      if (!metadata) throw new Error('expected command metadata');
      expect(metadata).toMatchObject({
        command: 'echo hello',
        cwd: dir,
      });
      expect(isAbsolute(metadata.shell.executable)).toBe(true);
      expect(metadata.shell.executable).toMatch(SHELL_EXECUTABLE_REGEX);
      expect(metadata.shell.args.at(-1)).toMatch(SCRIPT_PATH_REGEX);
      expect(metadata.shell.display).toContain('{0}');
      expect(metadata.shell.display).not.toContain(metadata.shell.args.at(-1) ?? '');
    } finally {
      await rm(dir, {recursive: true, force: true});
    }
  });

  it('continues running the command when command metadata emission throws', async () => {
    const step = buildStep({config: {run: 'echo still-runs'}});
    const output = collectOutput();

    const result = await executeRunStep(step, {
      onCommandStart: () => {
        throw new Error('capture unavailable');
      },
      onOutput: output.sink,
    });

    expect(result.success).toBe(true);
    expect(output.text()).toContain('still-runs');
  });

  it('isolates command metadata mutation from the spawned shell', async () => {
    const step = buildStep({config: {run: 'echo safe-spawn'}});
    const output = collectOutput();

    const result = await executeRunStep(step, {
      onCommandStart: (metadata) => {
        const shell = metadata.shell as unknown as {executable: string; args: string[]};
        shell.executable = 'shipfox-missing-shell';
        shell.args.splice(0, shell.args.length, '-c', 'exit 42');
      },
      onOutput: output.sink,
    });

    expect(result.success).toBe(true);
    expect(output.text()).toContain('safe-spawn');
  });

  it('handles multi-line scripts', async () => {
    const step = buildStep({
      config: {run: 'echo first\necho second'},
    });
    const output = collectOutput();

    const result = await executeRunStep(step, {onOutput: output.sink});

    expect(result.success).toBe(true);
    expect(output.text()).toContain('first');
    expect(output.text()).toContain('second');
  });

  it('fails on first error with pipefail', async () => {
    const step = buildStep({
      config: {run: 'false | echo piped'},
    });

    const result = await executeRunStep(step);

    // With -eo pipefail, the false in the pipe causes failure
    expect(result.success).toBe(false);
  });

  it('kills the running script when the AbortSignal fires', async () => {
    const step = buildStep({config: {run: 'echo READY; sleep 30'}});
    const output = collectOutput();
    const ac = new AbortController();
    const promise = executeRunStep(step, {signal: ac.signal, onOutput: output.sink});

    await waitForOutputMatch(output, READY_REGEX);
    ac.abort();

    const result = await promise;
    expect(result.success).toBe(false);
  });

  it('kills the entire process group on abort, including grandchildren', async () => {
    const step = buildStep({
      config: {
        run: 'sleep 30 & grandchild_pid=$!; echo "GRANDCHILD_PID=$grandchild_pid"; wait "$grandchild_pid"',
      },
    });
    const output = collectOutput();
    const ac = new AbortController();
    const promise = executeRunStep(step, {signal: ac.signal, onOutput: output.sink});

    const match = await waitForOutputMatch(output, GRANDCHILD_PID_REGEX);
    const grandchildPid = Number(match[1]);
    await waitForProcessAlive(grandchildPid);

    ac.abort();

    const result = await promise;
    expect(result.success).toBe(false);

    await waitForProcessExit(grandchildPid);
  });
});

function buildStep(
  overrides: Partial<{type: string; name: string | null; config: Record<string, unknown>}> = {},
): StepDto {
  const name = overrides.name ?? 'test-step';
  return {
    id: '00000000-0000-0000-0000-000000000001',
    job_execution_id: '00000000-0000-0000-0000-000000000003',
    key: name,
    name,
    source_location: null,
    status: 'running',
    type: overrides.type ?? 'run',
    config: overrides.config ?? {run: 'echo test'},
    error: null,
    position: 0,
    current_attempt: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}
