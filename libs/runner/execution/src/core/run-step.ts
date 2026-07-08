import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {accessSync, constants, statSync} from 'node:fs';
import {open, unlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, delimiter, isAbsolute, join, resolve} from 'node:path';
import {TextDecoder} from 'node:util';
import type {StepDto, StepErrorDto} from '@shipfox/api-workflows-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {redactSecrets, safeRedactionPrefixLength, secretWireForms} from '@shipfox/redact';
import {
  type AnnotationSpool,
  collectAnnotationOperations,
  createAnnotationSpool,
  disposeAnnotationSpool,
} from '#core/annotation-spool.js';
import {MAX_OUTPUT_TOTAL_BYTES, parseStepOutput, StepOutputError} from '#core/step-output.js';
import type {StepResult} from '#core/step-result.js';

/**
 * Receives each captured output chunk with its origin pipe. The runner tees step
 * output to its own stdout/stderr for container observability and, separately,
 * feeds it here for the durable log pipeline. Durability and output caps (per-record,
 * the unacked-backlog cap, and the server budget) are the sink's concern, not the
 * executor's.
 */
export type OutputSink = (chunk: Buffer, source: 'stdout' | 'stderr') => void;

export type CommandStartSink = (metadata: CommandStartMetadata) => void;

export interface CommandStartMetadata {
  readonly command: string;
  readonly shell: CommandShellMetadata;
  readonly cwd?: string;
}

export interface CommandShellMetadata {
  readonly executable: string;
  readonly args: readonly string[];
  readonly display: string;
}

interface RunStepOptions {
  signal?: AbortSignal;
  cwd?: string;
  systemEnv?: Readonly<Record<string, string>>;
  secretEnv?: Readonly<Record<string, string>>;
  secretValues?: readonly string[];
  onOutput?: OutputSink;
  onCommandStart?: CommandStartSink;
}

export function executeRunStep(step: StepDto, options: RunStepOptions = {}): Promise<StepResult> {
  if (step.type !== 'run') {
    return Promise.resolve({
      success: false,
      error: {message: `Unsupported step type: ${step.type}`},
      exit_code: null,
    });
  }

  const command = step.config.run as string;
  if (!command) {
    return Promise.resolve({
      success: false,
      error: {message: 'Step config.run is missing or empty'},
      exit_code: null,
    });
  }

  return runShellCommand(
    {...readStepEnv(step), ...options.secretEnv, ...options.systemEnv},
    command,
    options,
  );
}

async function runShellCommand(
  stepEnv: Readonly<Record<string, string>>,
  command: string,
  options: RunStepOptions,
): Promise<StepResult> {
  const scriptPath = join(tmpdir(), `shipfox-runner-${randomUUID()}.sh`);
  const outputPath = join(tmpdir(), `shipfox-output-${randomUUID()}`);
  const metadata = commandStartMetadata({command, scriptPath, cwd: options.cwd});
  notifyCommandStart(options.onCommandStart, cloneCommandStartMetadata(metadata));
  let annotationSpool: AnnotationSpool | undefined;

  try {
    await writeFile(scriptPath, command, {mode: 0o700});
    await writeFile(outputPath, '', {mode: 0o600});
    try {
      annotationSpool = await createAnnotationSpool();
    } catch (error) {
      logger().warn(
        {err: error},
        'Failed to create annotation spool; running step without annotation collection',
      );
    }

    const result = await spawnAndCapture(metadata, stepEnv, outputPath, annotationSpool, options);
    const outputResult = await finalizeStepOutput(result, outputPath);
    if (!annotationSpool) return outputResult;

    const annotations = await collectAnnotationOperations(annotationSpool);
    if (annotations.length === 0) return outputResult;
    return {...outputResult, annotations};
  } finally {
    if (annotationSpool) await disposeAnnotationSpool(annotationSpool);
    await unlink(scriptPath).catch(() => undefined);
    await unlink(outputPath).catch(() => undefined);
  }
}

function spawnAndCapture(
  metadata: CommandStartMetadata,
  stepEnv: Readonly<Record<string, string>>,
  outputPath: string,
  annotationSpool: AnnotationSpool | undefined,
  options: RunStepOptions,
): Promise<StepResult> {
  return new Promise((resolve) => {
    const {shell} = metadata;
    const teeSecretVariants = buildSecretVariants(options.secretValues ?? []);
    const stdoutTeeRedactor = createTeeRedactor(teeSecretVariants);
    const stderrTeeRedactor = createTeeRedactor(teeSecretVariants);

    // detached:true makes the shell a process-group leader so killGroup() can
    // SIGKILL its grandchildren too (Linux does not propagate signals down the
    // parent chain). We don't unref() — output capture still needs `close`.
    const child = spawn(shell.executable, shell.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      cwd: options.cwd,
      env: {
        ...process.env,
        ...stepEnv,
        SHIPFOX_OUTPUT: outputPath,
        ...(annotationSpool?.env ?? {}),
      },
    });

    // stdout and stderr are two separate pipes, so the sink sees them merged by
    // arrival order, not kernel/wall-clock order; origin is preserved per chunk.
    child.stdout.on('data', (chunk: Buffer) => {
      writeTeeOutput(process.stdout, chunk, stdoutTeeRedactor);
      options.onOutput?.(chunk, 'stdout');
    });
    child.stdout.on('close', () => {
      flushTeeOutput(process.stdout, stdoutTeeRedactor);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      writeTeeOutput(process.stderr, chunk, stderrTeeRedactor);
      options.onOutput?.(chunk, 'stderr');
    });
    child.stderr.on('close', () => {
      flushTeeOutput(process.stderr, stderrTeeRedactor);
    });

    let childExited = false;
    let abortKillSignal: NodeJS.Signals | undefined;

    const killGroup = (): NodeJS.Signals | undefined => {
      if (child.pid !== undefined) {
        try {
          // Negative pid signals the entire process group.
          const signal: NodeJS.Signals = 'SIGKILL';
          process.kill(-child.pid, signal);
          return signal;
        } catch {
          // Process already exited.
        }
      }
      return undefined;
    };

    let onAbort: (() => void) | undefined;
    if (options.signal) {
      if (options.signal.aborted) {
        abortKillSignal = killGroup();
      } else {
        onAbort = () => {
          if (!childExited) {
            abortKillSignal = killGroup();
          }
        };
        options.signal.addEventListener('abort', onAbort, {once: true});
      }
    }

    const cleanupAbortListener = () => {
      if (onAbort && options.signal) {
        options.signal.removeEventListener('abort', onAbort);
        onAbort = undefined;
      }
    };

    child.on('exit', () => {
      childExited = true;
    });

    child.on('close', (code, signal) => {
      cleanupAbortListener();
      if (abortKillSignal && isSignalKillResult(code, abortKillSignal)) {
        const resultSignal = signal ?? abortKillSignal;
        resolve({
          success: false,
          error: {
            message: `Killed by signal ${resultSignal}`,
            exit_code: null,
            signal: resultSignal,
          },
          exit_code: null,
        });
        return;
      }
      if (code === 0) {
        resolve({success: true, error: null, exit_code: 0});
        return;
      }
      // code === null when the child was terminated by a signal (e.g. SIGKILL
      // from killGroup() on abort). Otherwise code is the non-zero exit code.
      const error: StepErrorDto =
        code === null
          ? {
              message: `Killed by signal ${signal ?? 'unknown'}`,
              exit_code: null,
              ...(signal ? {signal} : {}),
            }
          : {message: `Command exited with code ${code}`, exit_code: code};
      resolve({success: false, error, exit_code: code});
    });

    child.on('error', (err) => {
      cleanupAbortListener();
      logger().error({err}, 'Failed to spawn shell process');
      resolve({
        success: false,
        error: {message: `Failed to spawn process: ${err.message}`},
        exit_code: null,
      });
    });
  });
}

async function finalizeStepOutput(result: StepResult, outputPath: string): Promise<StepResult> {
  let raw: string | undefined;
  try {
    raw = await readBoundedStepOutput(outputPath);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return result;
    if (!result.success) return result;
    return {
      success: false,
      error: {message: stepOutputErrorMessage(error)},
      exit_code: null,
    };
  }

  if (raw === undefined || raw === '') return result;

  try {
    const outputs = parseStepOutput(raw);
    if (Object.keys(outputs).length === 0) return result;
    return {...result, outputs};
  } catch (error) {
    if (!result.success) return result;
    return {
      success: false,
      error: {message: stepOutputErrorMessage(error)},
      exit_code: null,
    };
  }
}

async function readBoundedStepOutput(outputPath: string): Promise<string | undefined> {
  const handle = await open(outputPath, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw new StepOutputError('Step output file is not a regular file.');
    }

    const buffer = Buffer.alloc(MAX_OUTPUT_TOTAL_BYTES + 1);
    const {bytesRead} = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead === 0) return undefined;
    if (bytesRead > MAX_OUTPUT_TOTAL_BYTES) {
      throw new StepOutputError(`Step output exceeds ${MAX_OUTPUT_TOTAL_BYTES} bytes.`);
    }
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

function stepOutputErrorMessage(error: unknown): string {
  if (error instanceof StepOutputError) return error.message;
  return 'Step output file could not be read.';
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

function writeTeeOutput(
  stream: NodeJS.WriteStream,
  chunk: Buffer,
  redactor: TeeRedactor | undefined,
): void {
  if (!redactor) {
    stream.write(chunk);
    return;
  }
  const output = redactor.push(chunk);
  if (output.length > 0) stream.write(output);
}

function flushTeeOutput(stream: NodeJS.WriteStream, redactor: TeeRedactor | undefined): void {
  if (!redactor) return;
  const output = redactor.flush();
  if (output.length > 0) stream.write(output);
}

function createTeeRedactor(secretVariants: readonly string[]): TeeRedactor | undefined {
  if (secretVariants.length === 0) return undefined;
  return new TeeRedactor(secretVariants);
}

class TeeRedactor {
  private readonly decoder = new TextDecoder('utf-8', {ignoreBOM: true, fatal: false});
  private readonly variants: string[];
  private buffer = '';

  constructor(variants: readonly string[]) {
    this.variants = [...variants];
  }

  push(chunk: Buffer): string {
    this.buffer += this.decoder.decode(chunk, {stream: true});
    return this.drain(false);
  }

  flush(): string {
    this.buffer += this.decoder.decode();
    return this.drain(true);
  }

  private drain(final: boolean): string {
    let output = '';
    let newline = this.buffer.indexOf('\n');
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline + 1);
      this.buffer = this.buffer.slice(newline + 1);
      output += redactSecrets(line, this.variants);
      newline = this.buffer.indexOf('\n');
    }

    if (this.buffer.length === 0) return output;
    if (final) {
      output += redactSecrets(this.buffer, this.variants);
      this.buffer = '';
      return output;
    }

    const cut = safeRedactionPrefixLength(this.buffer, this.variants);
    if (cut > 0) {
      output += redactSecrets(this.buffer.slice(0, cut), this.variants);
      this.buffer = this.buffer.slice(cut);
    }
    return output;
  }
}

function buildSecretVariants(secrets: readonly string[]): string[] {
  const variants = new Set<string>();
  for (const secret of secrets) {
    for (const form of secretWireForms(secret)) variants.add(form);
  }
  return [...variants].sort((a, b) => b.length - a.length);
}

function isSignalKillResult(code: number | null, signal: NodeJS.Signals): boolean {
  return code === null || code === signalExitCode(signal);
}

function signalExitCode(signal: NodeJS.Signals): number | undefined {
  if (signal === 'SIGKILL') return 137;
  return undefined;
}

function readStepEnv(step: StepDto): Readonly<Record<string, string>> {
  const rawEnv = step.config.env;
  if (
    rawEnv === undefined ||
    rawEnv === null ||
    typeof rawEnv !== 'object' ||
    Array.isArray(rawEnv)
  ) {
    return {};
  }

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawEnv)) {
    if (typeof value === 'string') {
      env[key] = value;
      continue;
    }

    logger().warn(
      {stepId: step.id, key, valueType: value === null ? 'null' : typeof value},
      'Skipping non-string step env value',
    );
  }
  return env;
}

function findShell(): string {
  return findExecutable('bash') ?? findExecutable('sh') ?? '/bin/sh';
}

function findExecutable(name: 'bash' | 'sh'): string | undefined {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (!directory) continue;

    const candidate = isAbsolute(directory)
      ? join(directory, name)
      : resolve(process.cwd(), directory, name);
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) {
      return false;
    }
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function commandStartMetadata(args: {
  command: string;
  scriptPath: string;
  cwd: string | undefined;
}): CommandStartMetadata {
  const executable = findShell();
  const shellArgs =
    basename(executable) === 'bash'
      ? ['--noprofile', '--norc', '-eo', 'pipefail', args.scriptPath]
      : ['-e', args.scriptPath];
  const displayArgs = shellArgs.map((arg) => (arg === args.scriptPath ? '{0}' : arg));

  return {
    command: args.command,
    shell: {
      executable,
      args: shellArgs,
      display: [executable, ...displayArgs].join(' '),
    },
    ...(args.cwd !== undefined ? {cwd: args.cwd} : {}),
  };
}

function notifyCommandStart(
  onCommandStart: CommandStartSink | undefined,
  metadata: CommandStartMetadata,
): void {
  try {
    onCommandStart?.(metadata);
  } catch (err) {
    logger().error({err}, 'Failed to emit command metadata; continuing command execution');
  }
}

function cloneCommandStartMetadata(metadata: CommandStartMetadata): CommandStartMetadata {
  return {
    command: metadata.command,
    shell: {
      executable: metadata.shell.executable,
      args: [...metadata.shell.args],
      display: metadata.shell.display,
    },
    ...(metadata.cwd !== undefined ? {cwd: metadata.cwd} : {}),
  };
}
