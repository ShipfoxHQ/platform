import {agentValidationCatalog} from '#test/agent-validation-catalog.js';
import {parseDefinitionWithWarnings} from './parse-definition.js';
import {validateDefinition} from './validate-definition.js';

vi.mock('./validate-definition.js', () => ({
  validateDefinition: vi.fn(),
}));

describe('parseDefinitionWithWarnings', () => {
  it('returns warnings from successful validation', () => {
    vi.mocked(validateDefinition).mockReturnValue({
      valid: true,
      definition: {document: {}, model: {}} as never,
      warnings: [
        {
          code: 'synthetic-warning',
          message: 'A non-fatal validation warning',
          path: 'jobs.build.steps.0.run',
        },
      ],
    });

    const parsed = parseDefinitionWithWarnings('name: Workflow', {agentValidationCatalog});

    expect(parsed.warnings).toEqual([
      {
        code: 'synthetic-warning',
        message: 'A non-fatal validation warning',
        path: 'jobs.build.steps.0.run',
      },
    ]);
  });
});
