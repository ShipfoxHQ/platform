import type {CodeBlockHighlightedLineRange} from '@shipfox/react-ui/code-block';

const YAML_SAFE_PLAIN_SCALAR_RE = /^[A-Za-z][A-Za-z0-9._/-]*$/;
const YAML_AMBIGUOUS_PLAIN_SCALAR_RE = /^(?:false|n|no|null|off|on|true|y|yes)$/i;

export interface AgentWorkflowExample {
  code: string;
  highlightedLineRange: CodeBlockHighlightedLineRange;
}

export function buildAgentWorkflowExample({
  harness,
  providerId,
  model,
}: {
  harness: string;
  providerId: string;
  model: string;
}): AgentWorkflowExample {
  const lines = [
    'name: Agent',
    'triggers:',
    '  on_demand:',
    '    source: manual',
    'jobs:',
    '  agent:',
    '    runner: ubuntu-latest',
    '    steps:',
    '      - name: implement',
    `        harness: ${formatYamlPlainOrSingleQuotedScalar(harness)}`,
    `        provider: ${formatYamlPlainOrSingleQuotedScalar(providerId)}`,
    `        model: ${formatYamlPlainOrSingleQuotedScalar(model)}`,
    '        prompt: Describe the change you want the agent to make.',
  ];
  const harnessLineIndex = lines.findIndex((line) => line.trimStart().startsWith('harness:'));
  const modelLineIndex = lines.findIndex((line) => line.trimStart().startsWith('model:'));

  return {
    code: lines.join('\n'),
    highlightedLineRange: {
      startLine: harnessLineIndex + 1,
      endLine: modelLineIndex + 1,
    },
  };
}

function formatYamlPlainOrSingleQuotedScalar(value: string): string {
  if (!requiresYamlSingleQuotes(value)) return value;
  return `'${value.replaceAll("'", "''")}'`;
}

function requiresYamlSingleQuotes(value: string): boolean {
  return !YAML_SAFE_PLAIN_SCALAR_RE.test(value) || YAML_AMBIGUOUS_PLAIN_SCALAR_RE.test(value);
}
