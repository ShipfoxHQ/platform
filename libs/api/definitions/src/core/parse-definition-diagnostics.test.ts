import {DEFINITION_SYNC_LAST_ERROR_MESSAGE_MAX_LENGTH} from '@shipfox/api-definitions-dto';
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
      'Step gate success must be a valid CEL boolean expression. at jobs.build.steps.0.gate.success: No such key: attempt (and 1 more issue)',
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

  it('uses plural copy when more than one validation error remains', () => {
    vi.mocked(validateDefinition).mockReturnValue({
      valid: false,
      errors: [
        {message: 'First error', path: 'jobs.build.success'},
        {message: 'Second error', path: 'jobs.deploy.success'},
        {message: 'Third error', path: 'jobs.release.success'},
      ],
    });

    expect(() =>
      parseDefinitionWithDiagnostics('name: Workflow', {agentValidationCatalog}),
    ).toThrow('First error at jobs.build.success (and 2 more issues)');
  });

  it('bounds the formatted validation message', () => {
    vi.mocked(validateDefinition).mockReturnValue({
      valid: false,
      errors: [
        {
          message: 'Invalid expression',
          path: 'jobs.build.success',
          reason: 'r'.repeat(DEFINITION_SYNC_LAST_ERROR_MESSAGE_MAX_LENGTH + 100),
        },
      ],
    });

    try {
      parseDefinitionWithDiagnostics('name: Workflow', {agentValidationCatalog});
      expect.fail('Expected DefinitionParseError');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toHaveLength(DEFINITION_SYNC_LAST_ERROR_MESSAGE_MAX_LENGTH);
      expect((error as Error).message.endsWith('…')).toBe(true);
    }
  });
});
