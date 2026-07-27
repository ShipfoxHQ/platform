import Docker from 'dockerode';
import {SHIPFOX_LABELS} from '#container-identity.js';

const LEADING_SLASH = /^\//;
const DOCKER_EXIT_STATUS = /^Exited \((-?\d+)\)/;

export type DockerEngineErrorReason =
  | 'daemon-unreachable'
  | 'image-not-found'
  | 'name-conflict'
  | 'create-failed'
  | 'start-failed'
  | 'not-found'
  | 'unknown';

export class DockerEngineError extends Error {
  constructor(
    public readonly reason: DockerEngineErrorReason,
    message: string,
    options?: {cause?: unknown},
  ) {
    super(message, options);
    this.name = 'DockerEngineError';
  }
}

export type DockerContainerState =
  | 'created'
  | 'running'
  | 'exited'
  | 'dead'
  | 'removing'
  | 'paused'
  | 'restarting'
  | 'unknown';

export interface DockerContainerView {
  readonly id: string;
  readonly name: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly state: DockerContainerState;
  readonly exitCode?: number;
  readonly oomKilled?: boolean;
  readonly image?: string;
  readonly loggingDriver?: string;
  readonly createdAt: Date;
  readonly startedAt?: Date;
  readonly finishedAt?: Date;
  readonly terminalInspectFailed?: boolean;
}

export interface DockerEngineInfo {
  readonly loggingDriver: string;
}

export interface DockerEngine {
  getInfo(): Promise<DockerEngineInfo>;
  ensureImage(image: string): Promise<void>;
  createAndStart(args: {
    name: string;
    image: string;
    env: Readonly<Record<string, string>>;
    labels: Readonly<Record<string, string>>;
    nanoCpus: number;
    memoryBytes: number;
  }): Promise<void>;
  listManaged(provisionerId: string): Promise<DockerContainerView[]>;
  remove(name: string): Promise<void>;
  killAndRemove(name: string): Promise<void>;
}

export interface CreateDockerEngineOptions {
  readonly host?: string;
  readonly network?: string;
  readonly extraHosts?: readonly string[];
  readonly loggingDriver?: string;
  readonly loggingOptions?: Readonly<Record<string, string>>;
  readonly docker?: Docker;
}

export function createDockerEngine(options: CreateDockerEngineOptions = {}): DockerEngine {
  const docker = options.docker ?? new Docker(dockerOptionsForHost(options.host));
  let effectiveLoggingDriver: string | undefined;

  return {
    async getInfo() {
      try {
        const info = await docker.info();
        const loggingDriver =
          typeof info?.LoggingDriver === 'string' && info.LoggingDriver.length > 0
            ? info.LoggingDriver
            : undefined;
        if (!loggingDriver) {
          throw new Error('Docker system information did not include LoggingDriver.');
        }
        effectiveLoggingDriver = loggingDriver;
        return {loggingDriver};
      } catch (error) {
        throw mapError(error, 'unknown', 'Cannot inspect Docker system information.');
      }
    },

    async ensureImage(image) {
      try {
        await docker.getImage(image).inspect();
        return;
      } catch (error) {
        if (!isNotFound(error))
          throw mapError(error, 'image-not-found', `Cannot inspect image ${image}.`);
      }

      try {
        const stream = await docker.pull(image);
        await followProgress(docker, stream);
      } catch (error) {
        throw mapError(error, 'image-not-found', `Cannot pull image ${image}.`);
      }

      try {
        await docker.getImage(image).inspect();
      } catch (error) {
        if (isNotFound(error)) {
          throw new DockerEngineError(
            'image-not-found',
            `Image ${image} is not available after pull.`,
            {
              cause: error,
            },
          );
        }
        throw mapError(error, 'image-not-found', `Image ${image} is not available after pull.`);
      }
    },

    async createAndStart(args) {
      try {
        await this.ensureImage(args.image);
      } catch (error) {
        throw addLoggingDriverContext(error, selectedLoggingDriver());
      }
      let container: Docker.Container | undefined;

      try {
        container = await docker.createContainer({
          Image: args.image,
          name: args.name,
          Labels: {...args.labels},
          Env: Object.entries(args.env).map(([key, value]) => `${key}=${value}`),
          HostConfig: {
            NanoCpus: args.nanoCpus,
            Memory: args.memoryBytes,
            RestartPolicy: {Name: 'no'},
            ...(options.network ? {NetworkMode: options.network} : {}),
            ...(options.extraHosts ? {ExtraHosts: [...options.extraHosts]} : {}),
            ...(options.loggingDriver
              ? {
                  LogConfig: {
                    Type: options.loggingDriver,
                    Config: {...(options.loggingOptions ?? {})},
                  },
                }
              : {}),
          },
        });
      } catch (error) {
        const selectedDriver = options.loggingDriver ?? effectiveLoggingDriver;
        throw addLoggingDriverContext(
          mapError(
            error,
            isConflict(error) ? 'name-conflict' : 'create-failed',
            selectedDriver
              ? `Cannot create runner container with logging driver ${selectedDriver}.`
              : 'Cannot create runner container with the Docker daemon logging driver.',
          ),
          selectedDriver,
        );
      }

      try {
        await container.start();
      } catch (error) {
        await removeContainer(container).catch(() => undefined);
        const selectedDriver = selectedLoggingDriver();
        throw addLoggingDriverContext(
          mapError(
            error,
            'start-failed',
            selectedDriver
              ? `Cannot start runner container with logging driver ${selectedDriver}.`
              : 'Cannot start runner container with the Docker daemon logging driver.',
          ),
          selectedDriver,
        );
      }
    },

    async listManaged(provisionerId) {
      try {
        const containers = await docker.listContainers({
          all: true,
          filters: {label: [`${SHIPFOX_LABELS.provisionerId}=${provisionerId}`]},
        });

        return Promise.all(
          containers.map(async (container) => {
            const state = normalizeState(container.State);
            const inspectTerminalState = state === 'exited' || state === 'dead';
            let inspected: Docker.ContainerInspectInfo | undefined;
            let terminalInspectFailed = false;
            if (inspectTerminalState) {
              try {
                inspected = await inspectContainer(container.Id);
                terminalInspectFailed = !inspected;
              } catch {
                // Keep one transient or racing inspect from failing the entire observation pass.
                inspected = undefined;
                terminalInspectFailed = true;
              }
            }
            const startedAt = parseDockerDate(inspected?.State?.StartedAt);
            const finishedAt = parseDockerDate(inspected?.State?.FinishedAt);
            const loggingDriver =
              inspected?.HostConfig?.LogConfig?.Type ??
              options.loggingDriver ??
              effectiveLoggingDriver;
            const createdAt = new Date(container.Created * 1000);
            const exitCode =
              inspected?.State?.ExitCode ??
              parseDockerExitCode((container as {Status?: string}).Status);
            return {
              id: container.Id,
              name: container.Names?.[0]?.replace(LEADING_SLASH, '') ?? container.Id,
              labels: container.Labels ?? {},
              state,
              ...(exitCode !== undefined ? {exitCode} : {}),
              ...(inspected?.State?.OOMKilled !== undefined
                ? {oomKilled: inspected.State.OOMKilled}
                : {}),
              ...(container.Image || inspected?.Config?.Image
                ? {image: inspected?.Config?.Image ?? container.Image}
                : {}),
              ...(loggingDriver ? {loggingDriver} : {}),
              createdAt: Number.isNaN(createdAt.getTime()) ? new Date() : createdAt,
              ...(startedAt ? {startedAt} : {}),
              ...(finishedAt ? {finishedAt} : {}),
              ...(terminalInspectFailed ? {terminalInspectFailed: true} : {}),
            };
          }),
        );
      } catch (error) {
        throw mapError(error, 'unknown', 'Cannot list managed Docker containers.');
      }
    },

    async remove(name) {
      try {
        await docker.getContainer(name).remove({force: true});
      } catch (error) {
        if (isNotFound(error)) return;
        throw mapError(error, 'unknown', `Cannot remove Docker container ${name}.`);
      }
    },

    async killAndRemove(name) {
      const container = docker.getContainer(name);
      try {
        await container.kill();
      } catch (error) {
        if (!isNotFound(error) && !isConflict(error)) {
          throw mapError(error, 'unknown', `Cannot kill Docker container ${name}.`);
        }
      }

      try {
        await container.remove({force: true});
      } catch (error) {
        if (isNotFound(error)) return;
        throw mapError(error, 'unknown', `Cannot remove Docker container ${name}.`);
      }
    },
  };

  function selectedLoggingDriver(): string | undefined {
    return options.loggingDriver ?? effectiveLoggingDriver;
  }

  async function inspectContainer(id: string): Promise<Docker.ContainerInspectInfo | undefined> {
    try {
      return await docker.getContainer(id).inspect();
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }
}

async function followProgress(docker: Docker, stream: NodeJS.ReadableStream): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    docker.modem.followProgress(stream, (error: Error | null) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function removeContainer(container: Docker.Container): Promise<void> {
  await container.remove({force: true});
}

function normalizeState(state: string | undefined): DockerContainerState {
  switch (state) {
    case 'created':
    case 'running':
    case 'exited':
    case 'dead':
    case 'removing':
    case 'paused':
    case 'restarting':
      return state;
    default:
      return 'unknown';
  }
}

function parseDockerExitCode(status: string | undefined): number | undefined {
  const match = status?.match(DOCKER_EXIT_STATUS);
  if (!match) return undefined;
  const exitCode = Number(match[1]);
  return Number.isInteger(exitCode) ? exitCode : undefined;
}
function parseDockerDate(value: string | undefined): Date | undefined {
  if (!value || value.startsWith('0001-01-01T00:00:00Z')) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function mapError(
  error: unknown,
  fallback: DockerEngineErrorReason,
  message: string,
): DockerEngineError {
  if (error instanceof DockerEngineError) return error;
  if (isConnectionError(error))
    return new DockerEngineError('daemon-unreachable', message, {cause: error});
  if (isNotFound(error))
    return new DockerEngineError(fallback === 'image-not-found' ? fallback : 'not-found', message, {
      cause: error,
    });
  if (isConflict(error)) return new DockerEngineError('name-conflict', message, {cause: error});
  return new DockerEngineError(fallback, message, {cause: error});
}

function addLoggingDriverContext(error: unknown, driver: string | undefined): DockerEngineError {
  if (!driver) {
    if (error instanceof DockerEngineError) return error;
    return mapError(error, 'unknown', 'Docker runner launch failed.');
  }
  if (error instanceof DockerEngineError) {
    if (error.message.includes('logging driver')) return error;
    return new DockerEngineError(
      error.reason,
      `${error.message} Logging driver selected: ${driver}.`,
      {cause: error},
    );
  }
  return mapError(error, 'unknown', `Docker runner launch failed with logging driver ${driver}.`);
}

export function dockerOptionsForHost(host: string | undefined): Docker.DockerOptions {
  if (!host) return {};
  if (host.startsWith('unix://')) return {socketPath: new URL(host).pathname};

  try {
    const url = new URL(host);
    if (url.protocol === 'tcp:' || url.protocol === 'http:' || url.protocol === 'https:') {
      return {
        protocol: url.protocol === 'https:' ? 'https' : 'http',
        host: url.hostname,
        ...(url.port ? {port: Number(url.port)} : {}),
      };
    }
    if (url.protocol === 'ssh:') {
      return {
        protocol: 'ssh',
        host: url.hostname,
        ...(url.port ? {port: Number(url.port)} : {}),
      };
    }
  } catch {
    return {host};
  }

  return {host};
}

function isConnectionError(error: unknown): boolean {
  return (
    isNodeError(error) &&
    ['ECONNREFUSED', 'ENOENT', 'EACCES', 'EPIPE', 'ECONNRESET'].includes(String(error.code))
  );
}

function isNotFound(error: unknown): boolean {
  return hasStatusCode(error, 404);
}

function isConflict(error: unknown): boolean {
  return hasStatusCode(error, 409);
}

function hasStatusCode(error: unknown, statusCode: number): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    (error as {statusCode?: unknown}).statusCode === statusCode
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
