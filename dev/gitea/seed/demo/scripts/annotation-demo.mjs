const [, , scenario] = process.argv;

const scenarioAnnotations = {
  'run-summary': [
    {
      context: 'run-summary',
      style: 'info',
      body: `# Annotation demo

This annotation is written by the first job and appears in the run annotations panel.

- Run panel grouping
- Job annotation summary
- Step-level annotation list`,
    },
    {
      context: 'repository-health',
      style: 'success',
      body: 'The demo repository checkout completed and the annotation writer is reachable.',
    },
  ],
  'style-matrix': [
    {
      context: 'default-note',
      style: 'default',
      body: 'Default annotation body for neutral context.',
    },
    {
      context: 'info-note',
      style: 'info',
      body: 'Informational annotation body with `inline code` and a short paragraph.',
    },
    {
      context: 'success-note',
      style: 'success',
      body: 'Success annotation body for completed checks.',
    },
    {
      context: 'warning-note',
      style: 'warning',
      body: 'Warning annotation body for a non-blocking deployment risk.',
    },
    {
      context: 'error-note',
      style: 'error',
      body: 'Error annotation body for a simulated failure. The step still exits successfully.',
    },
  ],
  'job-rollout': [
    {
      context: 'deploy-plan',
      style: 'info',
      body: `## Deploy plan

1. Build release artifact.
2. Promote to staging.
3. Watch canary metrics for ten minutes.`,
    },
    {
      context: 'canary-warning',
      style: 'warning',
      body: 'Canary latency is elevated but still below the rollback threshold.',
    },
  ],
  'long-body': [
    {
      context: 'long-diagnostics',
      style: 'info',
      body: longDiagnosticsBody(),
    },
  ],
};

if (!scenario || !(scenario in scenarioAnnotations)) {
  console.error(
    `Usage: node scripts/annotation-demo.mjs <${Object.keys(scenarioAnnotations).join('|')}>`,
  );
  process.exit(2);
}

const apiUrl = requiredEnv('SHIPFOX_API_URL').replace(/\/+$/, '');
const leaseToken = requiredEnv('SHIPFOX_JOB_LEASE_TOKEN');
const stepId = requiredEnv('SHIPFOX_STEP_ID');
const attempt = Number.parseInt(requiredEnv('SHIPFOX_STEP_ATTEMPT'), 10);

if (!Number.isInteger(attempt) || attempt < 1) {
  console.error(
    `SHIPFOX_STEP_ATTEMPT must be a positive integer; got ${process.env.SHIPFOX_STEP_ATTEMPT}`,
  );
  process.exit(2);
}

const response = await fetch(`${apiUrl}/runs/jobs/current/annotations`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${leaseToken}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    step_id: stepId,
    attempt,
    annotations: scenarioAnnotations[scenario],
  }),
});

if (!response.ok) {
  const body = await response.text();
  console.error(`Annotation write failed with ${response.status}: ${body.slice(0, 1000)}`);
  process.exit(1);
}

const result = await response.json();
console.log(`Wrote ${result.annotations.length} annotation operation(s) for ${scenario}.`);

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is required to write demo annotations.`);
    process.exit(2);
  }
  return value;
}

function longDiagnosticsBody() {
  const rows = Array.from(
    {length: 28},
    (_, index) => `| shard-${String(index + 1).padStart(2, '0')} | passed | ${120 + index}ms |`,
  ).join('\n');

  return `## Long diagnostics

This annotation is intentionally long so the UI can exercise collapsed and expanded rendering.

| shard | status | duration |
| --- | --- | --- |
${rows}

Final line after the long diagnostic table.`;
}
