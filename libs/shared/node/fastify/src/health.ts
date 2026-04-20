import type {FastifyInstance} from 'fastify';
import type {HealthCheck} from './types.js';

interface HealthResponse {
  status: 'ok' | 'error';
  checks: Record<string, 'ok' | 'error'>;
}

async function runChecks(checks: HealthCheck[]): Promise<HealthResponse> {
  if (checks.length === 0) {
    return {status: 'ok', checks: {}};
  }

  const results = await Promise.all(
    checks.map(async (check) => {
      try {
        const ok = await check.check();
        return {name: check.name, ok};
      } catch {
        return {name: check.name, ok: false};
      }
    }),
  );

  const checksMap: Record<string, 'ok' | 'error'> = {};
  let allOk = true;
  for (const result of results) {
    checksMap[result.name] = result.ok ? 'ok' : 'error';
    if (!result.ok) allOk = false;
  }

  return {status: allOk ? 'ok' : 'error', checks: checksMap};
}

export function registerHealthChecks({
  app,
  livenessChecks = [],
  readinessChecks = [],
}: {
  app: FastifyInstance;
  livenessChecks?: HealthCheck[] | undefined;
  readinessChecks?: HealthCheck[] | undefined;
}): void {
  app.get(
    '/healthz',
    {logLevel: 'debug', schema: {description: 'Liveness check'}},
    async (_request, reply) => {
      const response = await runChecks(livenessChecks);
      return reply.code(response.status === 'ok' ? 200 : 503).send(response);
    },
  );

  app.get(
    '/readyz',
    {logLevel: 'debug', schema: {description: 'Readiness check'}},
    async (_request, reply) => {
      const response = await runChecks(readinessChecks);
      return reply.code(response.status === 'ok' ? 200 : 503).send(response);
    },
  );
}
