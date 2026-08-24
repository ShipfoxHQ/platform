import {
  contextRootsForField,
  getWorkflowContextDefinition,
  type WorkflowContextName,
  workflowContextNames,
  workflowInterpolationFields,
  workflowPredicateFields,
} from './workflow-context.js';
import {type WorkflowContextDoc, workflowContextDocs} from './workflow-context-docs.js';

describe('workflowContextDocs', () => {
  it('documents every context root exactly once', () => {
    expect(workflowContextDocs.map((doc) => doc.root)).toEqual([...workflowContextNames, 'result']);
  });

  it('documents every root exposed by an expression field', () => {
    const documentedRoots = new Set<string>(workflowContextDocs.map((doc) => doc.root));
    const fields = [...workflowPredicateFields, ...workflowInterpolationFields];

    for (const field of fields) {
      for (const root of contextRootsForField(field)) {
        expect(documentedRoots, `${field} exposes undocumented root ${root}`).toContain(root);
      }
    }
  });

  it('gives every root a summary', () => {
    const missing = workflowContextDocs.filter((doc) => doc.summary.trim() === '');

    expect(missing).toEqual([]);
  });

  it('explains the shape of every open root and lists fields for every typed root', () => {
    for (const doc of workflowContextDocs as readonly WorkflowContextDoc[]) {
      if (!(workflowContextNames as readonly string[]).includes(doc.root)) {
        expect(doc.shapeNote, `${doc.root} needs a shape note`).toBeDefined();
        continue;
      }
      const definition = getWorkflowContextDefinition(doc.root as WorkflowContextName);
      if (definition.shape === 'open') {
        expect(doc.shapeNote, `${doc.root} needs a shape note`).toBeDefined();
        continue;
      }
      expect(doc.fields, `${doc.root} needs field descriptions`).toBeDefined();
    }
  });
});
