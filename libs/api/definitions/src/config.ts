import {createConfig, str} from '@shipfox/config';
import {findInvalidLabels, MAX_RUNNER_LABELS, parseLabelList} from '@shipfox/runner-labels';

export const config = createConfig({
  DEFINITION_DEFAULT_RUNNER_LABEL: str({
    desc: 'Default runner label(s) applied to workflow jobs that do not declare a "runner" at the job or workflow level. Set it to a comma-separated list, for example ubuntu-latest or ubuntu-latest,node-22. Leave it empty to require every workflow job to declare runner labels explicitly; with no value set, a job without a runner fails definition validation.',
    default: '',
  }),
  DEFINITION_WORKFLOW_PATH: str({
    desc: 'Repository-relative path that contains workflow YAML files. Set a different path for each Shipfox instance when staging and production share a repository.',
    default: '.shipfox/workflows/',
  }),
});

export function parseDefinitionDefaultRunnerLabels(value: string): readonly string[] {
  const labels = parseLabelList(value);
  const invalid = findInvalidLabels(labels);

  if (invalid.length > 0) {
    throw new Error(
      `DEFINITION_DEFAULT_RUNNER_LABEL contains invalid runner label(s): ${invalid.join(', ')}`,
    );
  }

  if (labels.length > MAX_RUNNER_LABELS) {
    throw new Error(
      `DEFINITION_DEFAULT_RUNNER_LABEL contains ${labels.length} runner labels; the maximum is ${MAX_RUNNER_LABELS}`,
    );
  }

  return labels;
}

export const definitionDefaultRunnerLabels = parseDefinitionDefaultRunnerLabels(
  config.DEFINITION_DEFAULT_RUNNER_LABEL,
);

export const definitionWorkflowPath = config.DEFINITION_WORKFLOW_PATH;
