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
      issues: [],
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

  it('composes the first validation error with its path, reason, and remaining count', () => {
    const errors = [
      {
        message: 'Step gate success must be a valid CEL boolean expression.',
        path: 'jobs.build.steps.0.gate.success',
        reason: 'No such key: attempt',
      },
      {
        message: 'Job success must be a valid CEL boolean expression.',
        path: 'jobs.deploy.success',
      },
    ];
    vi.mocked(validateDefinition).mockReturnValue({valid: false, errors});

    expect(() =>
      parseDefinitionWithDiagnostics('name: Workflow', {agentValidationCatalog}),
    ).toThrow(
      'Step gate success must be a valid CEL boolean expression. at jobs.build.steps.0.gate.success: No such key: attempt (and 1 more issues)',
    );
  });

  it('does not append a remaining-error suffix for a single validation error', () => {
    vi.mocked(validateDefinition).mockReturnValue({
      valid: false,
      errors: [
        {
          message: 'Step gate success must be a valid CEL boolean expression.',
          path: 'jobs.build.steps.0.gate.success',
          reason: 'No such key: attempt',
        },
      ],
    });

    expect(() =>
      parseDefinitionWithDiagnostics('name: Workflow', {agentValidationCatalog}),
    ).toThrow(
      'Step gate success must be a valid CEL boolean expression. at jobs.build.steps.0.gate.success: No such key: attempt',
    );
  });
});
