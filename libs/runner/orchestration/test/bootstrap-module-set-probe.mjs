import {createServer} from 'node:http';

const server = createServer((request, response) => {
  request.resume();
  response.setHeader('content-type', 'application/json');

  if (request.method === 'POST' && request.url === '/runner-enrollment/exchange') {
    response.end(
      JSON.stringify({
        runner_instance_id: '00000000-0000-4000-8000-000000000001',
        control_session_token: 'control-token',
        expires_at: '2030-01-01T00:00:00.000Z',
      }),
    );
    return;
  }

  if (request.method === 'POST' && request.url === '/runner-control/enrollment') {
    response.end(JSON.stringify({activation_token: 'activation-token'}));
    return;
  }

  if (request.method === 'POST' && request.url === '/runners/register') {
    response.end(
      JSON.stringify({
        session_token: 'session-token',
        session_id: '00000000-0000-4000-8000-000000000002',
        mode: 'activation',
        max_claims: 1,
      }),
    );
    return;
  }

  if (request.method === 'POST' && request.url === '/runners/jobs/request') {
    response.writeHead(409);
    response.end(JSON.stringify({code: 'runner-session-exhausted'}));
    return;
  }

  response.writeHead(404);
  response.end(JSON.stringify({error: 'not found'}));
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});

const address = server.address();
if (address === null || typeof address === 'string') {
  throw new Error('Probe server did not expose a TCP address.');
}

process.env.SHIPFOX_API_URL = `http://127.0.0.1:${address.port}`;
process.env.SHIPFOX_RUNNER_REGISTRATION_TOKEN = '';
process.env.SHIPFOX_RUNNER_BOOTSTRAP_TOKEN = 'sf_rbt_module-set-probe';
process.env.SHIPFOX_RUNNER_PROVIDER_KIND = 'ec2';
process.env.SHIPFOX_RUNNER_PROTOCOL_VERSION = '1';
process.env.SHIPFOX_RUNNER_LABELS = 'local';
process.env.SHIPFOX_RUNNER_WORKSPACE_ROOT = `/tmp/shipfox-module-set-probe-${process.pid}`;

const processEntryUptimeSeconds = process.uptime();

try {
  const {startRunner} = await import('#core/runner.js');
  await startRunner({processEntryUptimeSeconds});
} finally {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
