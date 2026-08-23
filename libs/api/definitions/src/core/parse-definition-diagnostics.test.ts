import {agentValidationCatalog} from '#test/agent-validation-catalog.js';
import {parseDefinitionWithDiagnostics} from './parse-definition.js';
import {validateDefinition} from './validate-definition.js';

vi.mock('./validate-definition.js', () => ({
  validateDefinition: vi.fn(),
}));

describe('parseDefinitionWithDiagnostics', () => {
  it('returns diagnostics from successful validation', () => {
    vi.mocked(validateDefinition).mockReturnValue({
      valid: true,
      definition: {document: {}, model: {}} as never,
      diagnostics: [
        {
          code: 'synthetic-warning',
          message: 'A non-fatal validation warning',
          path: 'jobs.build.steps.0.run',
          severity: 'warning',
        },
        {
          code: 'synthetic-error',
          message: 'A trigger-scoped validation error',
          path: 'triggers.on_demand',
          severity: 'error',
        },
      ],
    });

    const parsed = parseDefinitionWithDiagnostics('name: Workflow', {agentValidationCatalog});

    expect(parsed.diagnostics).toEqual([
      {
        code: 'synthetic-warning',
        message: 'A non-fatal validation warning',
        path: 'jobs.build.steps.0.run',
        severity: 'warning',
      },
      {
        code: 'synthetic-error',
        message: 'A trigger-scoped validation error',
        path: 'triggers.on_demand',
        severity: 'error',
      },
    ]);
  });
});
