import {getWorkflowContextDefinition, workflowContextNames} from './workflow-context.js';
import {type WorkflowContextDoc, workflowContextDocs} from './workflow-context-docs.js';

describe('workflowContextDocs', () => {
  it('documents every context root exactly once', () => {
    expect(workflowContextDocs.map((doc) => doc.root)).toEqual([...workflowContextNames]);
  });

  it('gives every root a summary', () => {
    const missing = workflowContextDocs.filter((doc) => doc.summary.trim() === '');

    expect(missing).toEqual([]);
  });

  it('explains the shape of every open root and lists fields for every typed root', () => {
    for (const doc of workflowContextDocs as readonly WorkflowContextDoc[]) {
      const definition = getWorkflowContextDefinition(doc.root);
      if (definition.shape === 'open') {
        expect(doc.shapeNote, `${doc.root} needs a shape note`).toBeDefined();
        continue;
      }
      expect(doc.fields, `${doc.root} needs field descriptions`).toBeDefined();
    }
  });
});
