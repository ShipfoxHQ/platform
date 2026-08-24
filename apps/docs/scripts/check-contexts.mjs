import {
  buildTypedRootsEnvironment,
  contextRootsForField,
  getWorkflowContextTypeEnvironment,
  workflowContextDocs,
  workflowContextNames,
  workflowInterpolationFields,
  workflowPredicateFields,
} from '@shipfox/expression';
import {
  contextFieldRows,
  contextRootShape,
  WORKFLOW_FIELD_YAML_KEYS,
} from './lib/context-reference.mjs';

const failures = [];
const engineFields = [...workflowPredicateFields, ...workflowInterpolationFields];
const mappedFields = Object.keys(WORKFLOW_FIELD_YAML_KEYS);
const documentedRoots = new Set(workflowContextDocs.map((doc) => doc.root));

for (const field of engineFields) {
  if (!mappedFields.includes(field)) {
    failures.push(
      `Expression field "${field}" has no YAML key in scripts/lib/context-reference.mjs. Add it so the availability matrix documents the field.`,
    );
  }

  for (const root of contextRootsForField(field)) {
    if (!documentedRoots.has(root)) {
      failures.push(
        `Expression field "${field}" exposes context root "${root}", which has no entry in workflow-context-docs.ts.`,
      );
    }
  }
}

for (const field of mappedFields) {
  if (!engineFields.includes(field)) {
    failures.push(
      `YAML key mapping names "${field}", which the expression engine no longer defines. Remove it from scripts/lib/context-reference.mjs.`,
    );
  }
}

const deps = {
  getTypeEnvironment: getWorkflowContextTypeEnvironment,
  buildTypedRoots: buildTypedRootsEnvironment,
  contextNames: workflowContextNames,
};

for (const doc of workflowContextDocs) {
  const shape = contextRootShape(doc.root, deps);
  if (shape === undefined && doc.shapeNote === undefined) {
    failures.push(`Context "${doc.root}" has no shape or shape note.`);
  }
  const rendered = new Set(
    shape === undefined
      ? []
      : contextFieldRows(shape, '', doc.collapse ?? []).map((row) => row.path),
  );
  for (const path of Object.keys(doc.fields ?? {})) {
    if (rendered.has(path)) continue;
    failures.push(
      `Context "${doc.root}" describes "${path}", which its type no longer has. Remove the description in libs/shared/expression/src/workflow-context/workflow-context-docs.ts.`,
    );
  }
}

if (failures.length > 0) {
  // biome-ignore lint/suspicious/noConsole: CLI diagnostics
  console.error(`✖ context reference drift\n${failures.map((line) => `  - ${line}`).join('\n')}`);
  process.exit(1);
}

// biome-ignore lint/suspicious/noConsole: CLI diagnostics
console.log(`✓ context reference covers ${engineFields.length} expression fields`);
