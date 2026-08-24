/**
 * Keep the YAML names beside the generator and its drift check.
 *
 * The engine names expression sites as the runtime does. Readers need the YAML
 * key they type, so the check fails when the engine gains an unmapped field.
 */
export const WORKFLOW_FIELD_YAML_KEYS = {
  'trigger.filter': 'triggers.<trigger_id>.filter',
  'listener.on': 'jobs.<job_id>.listening.on[*].filter',
  'listener.until': 'jobs.<job_id>.listening.until[*].filter',
  'job.if': 'jobs.<job_id>.if',
  'step.if': 'jobs.<job_id>.steps[*].if',
  'step.success': 'jobs.<job_id>.steps[*].gate.success',
  'job.success': 'jobs.<job_id>.success',
  run: 'jobs.<job_id>.steps[*].run',
  'env.value': 'env.<name>',
  'agent.prompt': 'jobs.<job_id>.steps[*].prompt',
  'agent.model': 'jobs.<job_id>.steps[*].model',
  'agent.provider': 'jobs.<job_id>.steps[*].provider',
  'agent.thinking': 'jobs.<job_id>.steps[*].thinking',
  'job.runner': 'jobs.<job_id>.runner',
  'job.outputs': 'jobs.<job_id>.outputs.<name>',
  'workflow.run_name': 'run_name',
  'job.execution_name': 'jobs.<job_id>.execution_name',
  'step.name': 'jobs.<job_id>.steps[*].name',
  'step.working_directory': 'jobs.<job_id>.steps[*].working_directory',
  'checkout.project': 'jobs.<job_id>.steps[*].checkout.project',
  'checkout.connection': 'jobs.<job_id>.steps[*].checkout.connection',
  'checkout.repository': 'jobs.<job_id>.steps[*].checkout.repository',
  'checkout.ref': 'jobs.<job_id>.steps[*].checkout.ref',
  'checkout.path': 'jobs.<job_id>.steps[*].checkout.path',
  'step.feedback': 'jobs.<job_id>.steps[*].gate.on_failure.feedback',
  'tool.with': 'jobs.<job_id>.steps[*].with',
  'tool.outputs': 'jobs.<job_id>.steps[*].outputs.<name>',
};

// Keep the shape lookup here so generation and drift checking traverse the same
// typed registry.
export function contextRootShape(root, deps) {
  const {getTypeEnvironment, buildTypedRoots} = deps;
  if (root === 'jobs') {
    return objectFields(buildTypedRoots({jobs: [{key: '<job_key>'}]}).jobs)['<job_key>'];
  }
  if (root === 'steps') {
    return objectFields(buildTypedRoots({steps: [{key: '<step_key>'}]}).steps)['<step_key>'];
  }

  const environment = getTypeEnvironment(root);
  const type = environment?.[root];
  if (type === undefined) return undefined;
  return type.kind === 'list' ? type.element : type;
}

export function contextFieldRows(type, prefix = '', collapse = []) {
  if (typeof type !== 'object' || type.kind !== 'object') return [];

  return Object.entries(type.fields).flatMap(([name, fieldType]) => {
    const path = `${prefix}${name}`;
    const row = {path, type: typeLabel(fieldType)};
    // Keep collapsed paths as leaves because another context root documents
    // their element shape.
    if (collapse.includes(path)) return [row];
    if (typeof fieldType === 'object' && fieldType.kind === 'object') {
      return [row, ...contextFieldRows(fieldType, `${path}.`, collapse)];
    }
    if (
      typeof fieldType === 'object' &&
      fieldType.kind === 'list' &&
      typeof fieldType.element === 'object' &&
      fieldType.element.kind === 'object'
    ) {
      return [row, ...contextFieldRows(fieldType.element, `${path}[*].`, collapse)];
    }
    return [row];
  });
}

export function typeLabel(type) {
  if (typeof type === 'string') return type;
  if (type.kind === 'map') return 'map';
  if (type.kind === 'list') return `list<${typeLabel(type.element)}>`;
  return 'object';
}

function objectFields(type) {
  return typeof type === 'object' && type.kind === 'object' ? type.fields : {};
}
