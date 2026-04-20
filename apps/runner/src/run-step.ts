import {type ChildProcess, execFileSync, spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {unlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {JobPayloadStepDto} from '@shipfox/api-runners-dto';
import {logger} from '@shipfox/node-opentelemetry';

export interface StepResult {
  success: boolean;
  output: string;
}

const MAX_OUTPUT_BYTES = 1024 * 1024; // 1MB

export function executeRunStep(step: JobPayloadStepDto): Promise<StepResult> {
  if (step.type !== 'run') {
    return Promise.resolve({
      success: false,
      output: `Unsupported step type: ${step.type}`,
    });
  }

  const command = step.config.run as string;
  if (!command) {
    return Promise.resolve({
      success: false,
      output: 'Step config.run is missing or empty',
    });
  }

  return runShellCommand(command);
}

async function runShellCommand(command: string): Promise<StepResult> {
  const scriptPath = join(tmpdir(), `shipfox-runner-${randomUUID()}.sh`);

  try {
    await writeFile(scriptPath, command, {mode: 0o700});

    const result = await spawnAndCapture(scriptPath);
    return result;
  } finally {
    await unlink(scriptPath).catch(() => undefined);
  }
}

/** Active child process, exposed for force-kill on second SIGINT. */
let activeProcess: ChildProcess | null = null;

export function killActiveProcess(): void {
  if (activeProcess) {
    activeProcess.kill('SIGKILL');
    activeProcess = null;
  }
}

function spawnAndCapture(scriptPath: string): Promise<StepResult> {
  return new Promise((resolve) => {
    const shell = findShell();
    const args =
      shell === 'bash'
        ? ['--noprofile', '--norc', '-eo', 'pipefail', scriptPath]
        : ['-e', scriptPath];

    const child = spawn(shell, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    activeProcess = child;

    let output = '';
    let truncated = false;

    const appendOutput = (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;

      if (Buffer.byteLength(output) > MAX_OUTPUT_BYTES) {
        output = output.slice(-MAX_OUTPUT_BYTES);
        truncated = true;
      }
    };

    child.stdout.on('data', (chunk: Buffer) => {
      process.stdout.write(chunk);
      appendOutput(chunk);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk);
      appendOutput(chunk);
    });

    child.on('close', (code) => {
      activeProcess = null;
      const finalOutput = truncated ? `[output truncated]\n${output}` : output;
      resolve({
        success: code === 0,
        output: finalOutput,
      });
    });

    child.on('error', (err) => {
      activeProcess = null;
      logger().error({err}, 'Failed to spawn shell process');
      resolve({
        success: false,
        output: `Failed to spawn process: ${err.message}`,
      });
    });
  });
}

function findShell(): string {
  try {
    execFileSync('bash', ['--version'], {stdio: 'ignore'});
    return 'bash';
  } catch {
    return 'sh';
  }
}
