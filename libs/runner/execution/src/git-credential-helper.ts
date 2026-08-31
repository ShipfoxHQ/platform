import {requestCredentialSocket} from '@shipfox/runner-workspace/credential-socket';

const MAX_INPUT_BYTES = 16 * 1_024;
const MAX_CREDENTIAL_VALUE_LENGTH = 8 * 1_024;
const GIT_FIELD_LINE_RE = /\r?\n/;

export type GitCredentialHelperOperation = 'get' | 'store' | 'erase';

/**
 * Runs the installed Git credential-helper entry point. Git's `store` and `erase` inputs are
 * deliberately reduced to the repository URL before crossing the socket boundary.
 */
export async function runGitCredentialHelper(params?: {
  argv?: readonly string[];
  input?: string | Buffer;
  output?: NodeJS.WritableStream;
}): Promise<void> {
  const argv = params?.argv ?? process.argv.slice(2);
  const socketPath = readSocketPath(argv);
  const operation = readOperation(argv);
  const input = params?.input ?? (await readBoundedStdin());
  const fields = parseGitCredentialInput(input);
  const repositoryUrl = repositoryUrlOf(fields);
  const response = await requestCredentialSocket(socketPath, {operation, repositoryUrl});
  if (!response.ok) throw new Error('Credential helper request was rejected');
  if (operation !== 'get' || response.credential === undefined) return;

  assertCredentialValue(response.credential.username);
  assertCredentialValue(response.credential.token);
  const output = params?.output ?? process.stdout;
  output.write(
    `username=${response.credential.username}\npassword=${response.credential.token}\n\n`,
  );
}

export async function main(): Promise<void> {
  try {
    await runGitCredentialHelper();
  } catch {
    process.exitCode = 1;
  }
}

type GitCredentialFields = Record<string, string>;

function readSocketPath(argv: readonly string[]): string {
  const index = argv.indexOf('--socket');
  const socketPath = index < 0 ? undefined : argv[index + 1];
  if (socketPath === undefined || socketPath.length === 0) {
    throw new Error('Credential helper socket is not configured');
  }
  return socketPath;
}

function readOperation(argv: readonly string[]): GitCredentialHelperOperation {
  const operation = argv.at(-1);
  if (operation === 'get' || operation === 'store' || operation === 'erase') return operation;
  throw new Error('Unknown Git credential operation');
}

function readBoundedStdin(): Promise<Buffer> {
  return readBoundedStream(process.stdin);
}

function readBoundedStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    stream.on('data', (chunk: Buffer | string) => {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += value.length;
      if (size > MAX_INPUT_BYTES) {
        reject(new Error('Git credential input is too large'));
        if ('destroy' in stream && typeof stream.destroy === 'function') stream.destroy();
        return;
      }
      chunks.push(value);
    });
    stream.once('error', reject);
    stream.once('end', () => resolve(Buffer.concat(chunks)));
  });
}

function parseGitCredentialInput(input: string | Buffer): GitCredentialFields {
  const text = Buffer.isBuffer(input) ? input.toString('utf8') : input;
  if (Buffer.byteLength(text, 'utf8') > MAX_INPUT_BYTES) {
    throw new Error('Git credential input is too large');
  }
  const fields: GitCredentialFields = {};
  for (const line of text.split(GIT_FIELD_LINE_RE)) {
    if (line === '') continue;
    const separator = line.indexOf('=');
    if (separator <= 0) throw new Error('Malformed Git credential input');
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (key === 'protocol' || key === 'host' || key === 'path' || key === 'url') {
      fields[key] = value;
    }
  }
  return fields;
}

function repositoryUrlOf(fields: GitCredentialFields): string {
  if (fields.url !== undefined) return validateRepositoryUrl(fields.url);
  if (fields.protocol === undefined || fields.host === undefined) {
    throw new Error('Git credential input has no repository URL');
  }
  let repositoryPath = fields.path ?? '';
  while (repositoryPath.startsWith('/')) repositoryPath = repositoryPath.slice(1);
  const path = repositoryPath === '' ? '' : `/${repositoryPath}`;
  return validateRepositoryUrl(`${fields.protocol}://${fields.host}${path}`);
}

function validateRepositoryUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Git credential input has an invalid repository URL');
  }
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('Git credential input has an unsafe repository URL');
  }
  return url.toString();
}

function assertCredentialValue(value: string): void {
  if (
    value.length === 0 ||
    value.length > MAX_CREDENTIAL_VALUE_LENGTH ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  ) {
    throw new Error('Credential response is not valid for Git');
  }
}
