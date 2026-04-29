import {config} from './config.js';

export interface PreflightOptions {
  requireClient?: boolean;
}

async function requireOk(url: URL): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(
      `E2E preflight could not reach ${url.toString()}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return response;
}

export async function preflightCheck(options: PreflightOptions = {}): Promise<void> {
  const readyUrl = new URL('/readyz', config.API_URL);
  const ready = await requireOk(readyUrl);
  if (!ready.ok) {
    throw new Error(
      `E2E preflight expected API readiness at ${readyUrl.toString()}, got ${ready.status}`,
    );
  }

  if (options.requireClient ?? true) {
    if (!config.CLIENT_URL) throw new Error('CLIENT_URL is required for browser E2E tests');
    const clientUrl = new URL(config.CLIENT_URL);
    const client = await requireOk(clientUrl);
    if (!client.ok) {
      throw new Error(
        `E2E preflight expected client at ${clientUrl.toString()}, got ${client.status}`,
      );
    }
  }
}
