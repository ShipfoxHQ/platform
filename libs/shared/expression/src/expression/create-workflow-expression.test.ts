import {
  createWorkflowExpression,
  unsafeWorkflowExpressionFromSource,
} from './create-workflow-expression.js';
import {InvalidWorkflowExpressionError} from './errors.js';
import type {CreateWorkflowExpressionParams, ExpressionScalarType} from './workflow-expression.js';

describe('createWorkflowExpression', () => {
  it('returns a typed CEL workflow expression when the source parses and type-checks', () => {
    const expression = createWorkflowExpression({
      source: 'event.conclusion == "success"',
      check: {
        mode: 'typed',
        typeEnvironment: {
          event: {kind: 'object', fields: {conclusion: 'string'}},
        },
      },
    });

    expect(expression).toEqual({
      language: 'cel',
      source: 'event.conclusion == "success"',
      check: 'typed',
      resultType: 'bool',
    });
  });

  it('returns a syntax CEL workflow expression when unknown fields parse', () => {
    const expression = createWorkflowExpression({
      source: 'event.ref == "refs/heads/main"',
      check: {mode: 'syntax'},
    });

    expect(expression).toEqual({
      language: 'cel',
      source: 'event.ref == "refs/heads/main"',
      check: 'syntax',
    });
  });

  it('type-checks the shared workflow function registry', () => {
    const jsonExpression = createWorkflowExpression({
      source: 'toJson(event)',
      check: {
        mode: 'typed',
        typeEnvironment: {
          event: {kind: 'map'},
        },
      },
    });
    const parsedExpression = createWorkflowExpression({
      source: 'fromJson(event.payload).ready',
      check: {
        mode: 'typed',
        typeEnvironment: {
          event: {kind: 'object', fields: {payload: 'string'}},
        },
      },
    });
    const parsedPredicateExpression = createWorkflowExpression({
      source: 'fromJson(event.payload).ready',
      check: {
        mode: 'typed',
        typeEnvironment: {
          event: {kind: 'object', fields: {payload: 'string'}},
        },
        expectedResultType: 'bool',
      },
    });
    const dynamicJsonExpression = createWorkflowExpression({
      source: 'fromJson(event.payload).items',
      check: {
        mode: 'typed',
        typeEnvironment: {
          event: {kind: 'object', fields: {payload: 'string'}},
        },
      },
    });
    const rangeExpression = createWorkflowExpression({
      source: 'range(1, 3, 1).size() == 3',
      check: {mode: 'typed'},
    });
    const firstExpression = createWorkflowExpression({
      source: 'event.values.first()',
      check: {
        mode: 'typed',
        typeEnvironment: {
          event: {
            kind: 'object',
            fields: {values: {kind: 'list', element: 'string'}},
          },
        },
      },
    });
    const lastExpression = createWorkflowExpression({
      source: 'event.values.last()',
      check: {
        mode: 'typed',
        typeEnvironment: {
          event: {
            kind: 'object',
            fields: {values: {kind: 'list', element: 'string'}},
          },
        },
      },
    });

    expect(jsonExpression.resultType).toBe('string');
    expect(parsedExpression.check).toBe('typed');
    expect(parsedPredicateExpression.check).toBe('typed');
    expect(dynamicJsonExpression.resultType).toBeUndefined();
    expect(rangeExpression.resultType).toBe('bool');
    expect(firstExpression.resultType).toBe('string');
    expect(lastExpression.resultType).toBe('string');
  });

  it.each(['first', 'last'] as const)('preserves typed object fields through list %s', (method) => {
    const expression = createWorkflowExpression({
      source: `event.values.${method}().label`,
      check: {
        mode: 'typed',
        typeEnvironment: {
          event: {
            kind: 'object',
            fields: {
              values: {
                kind: 'list',
                element: {kind: 'object', fields: {label: 'string'}},
              },
            },
          },
        },
      },
    });

    expect(expression.resultType).toBe('string');
  });

  it('uses collision-safe names for list object schemas', () => {
    const typeEnvironment = {
      foo_bar: {
        kind: 'object',
        fields: {
          items: {
            kind: 'list',
            element: {kind: 'object', fields: {left: 'string'}},
          },
        },
      },
      foo: {
        kind: 'object',
        fields: {
          bar_items: {
            kind: 'list',
            element: {kind: 'object', fields: {right: 'int'}},
          },
        },
      },
    } as const;

    for (const source of ['foo_bar.items[0].left', 'foo.bar_items[0].right']) {
      expect(() =>
        createWorkflowExpression({
          source,
          check: {mode: 'typed', typeEnvironment},
        }),
      ).not.toThrow();
    }
  });

  it.each(['first', 'last'] as const)('rejects %s on a non-list receiver', (method) => {
    const act = () =>
      createWorkflowExpression({
        source: `event.value.${method}()`,
        check: {
          mode: 'typed',
          typeEnvironment: {
            event: {kind: 'object', fields: {value: 'string'}},
          },
        },
      });

    expect(act).toThrow(InvalidWorkflowExpressionError);
  });

  it('accepts a bare dynamic result for an expected predicate type', () => {
    const expression = createWorkflowExpression({
      source: 'event.value',
      check: {
        mode: 'typed',
        typeEnvironment: {event: {kind: 'map'}},
        expectedResultType: 'bool',
      },
    });

    expect(expression).toEqual({
      language: 'cel',
      source: 'event.value',
      check: 'typed',
      resultType: 'string',
    });
  });

  it('rejects a bare dynamic result for a non-predicate expected type', () => {
    let error: unknown;
    try {
      createWorkflowExpression({
        source: 'event.value',
        check: {
          mode: 'typed',
          typeEnvironment: {event: {kind: 'map'}},
          expectedResultType: 'string',
        },
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(InvalidWorkflowExpressionError);
    expect((error as InvalidWorkflowExpressionError).reason).toContain(
      'must return string; got dyn',
    );
  });

  it('does not treat fromJson text in a dynamic expression as a function call', () => {
    const expression = createWorkflowExpression({
      source: 'event["fromJson("]',
      check: {
        mode: 'typed',
        typeEnvironment: {event: {kind: 'map'}},
      },
    });

    expect(expression.resultType).toBe('string');
  });

  it('rejects misspelled fields from the typed environment', () => {
    const act = () =>
      createWorkflowExpression({
        source: 'event.conclsion == "success"',
        check: {
          mode: 'typed',
          typeEnvironment: {
            event: {kind: 'object', fields: {conclusion: 'string'}},
          },
        },
      });

    expect(act).toThrow(InvalidWorkflowExpressionError);
    expect(act).toThrow('Invalid workflow expression');
  });

  it('rejects unknown variables from an empty typed environment', () => {
    const act = () =>
      createWorkflowExpression({
        source: 'event.ref == "refs/heads/main"',
        check: {mode: 'typed'},
      });

    expect(act).toThrow(InvalidWorkflowExpressionError);
  });

  it('rejects typed expressions with an unexpected result type', () => {
    let error: unknown;
    try {
      createWorkflowExpression({
        source: 'event.value + 1',
        check: {
          mode: 'typed',
          typeEnvironment: {
            event: {kind: 'object', fields: {value: 'int'}},
          },
          expectedResultType: 'bool',
        },
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(InvalidWorkflowExpressionError);
    expect((error as InvalidWorkflowExpressionError).reason).toContain('must return bool; got int');
  });

  it('rejects misspelled fields on typed list object elements', () => {
    let error: unknown;
    try {
      createWorkflowExpression({
        source: 'executions.all(e, e.statsu == "succeeded")',
        check: {
          mode: 'typed',
          typeEnvironment: {
            executions: {
              kind: 'list',
              element: {
                kind: 'object',
                fields: {
                  index: 'int',
                  status: 'string',
                },
              },
            },
          },
        },
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(InvalidWorkflowExpressionError);
    expect((error as InvalidWorkflowExpressionError).reason).toContain('statsu');
  });

  it('exposes the source and type-check reason on invalid expression errors', () => {
    let error: unknown;
    try {
      createWorkflowExpression({
        source: 'event.conclsion == "success"',
        check: {
          mode: 'typed',
          typeEnvironment: {
            event: {kind: 'object', fields: {conclusion: 'string'}},
          },
        },
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(InvalidWorkflowExpressionError);
    expect(error).toMatchObject({
      code: 'invalid-workflow-expression',
      name: 'InvalidWorkflowExpressionError',
      source: 'event.conclsion == "success"',
    });
    expect((error as InvalidWorkflowExpressionError).reason).toContain('conclsion');
  });

  it.each([
    ['string', 'event.value == "success"'],
    ['int', 'event.value >= 1'],
    ['double', 'event.value >= 1.5'],
    ['bool', 'event.value == true'],
    ['null', 'event.value == null'],
    ['timestamp', 'event.value < timestamp("2026-01-01T00:00:00Z")'],
  ] satisfies readonly [
    ExpressionScalarType,
    string,
  ][])('type-checks %s fields', (scalarType, source) => {
    const expression = createWorkflowExpression({
      source,
      check: {
        mode: 'typed',
        typeEnvironment: {
          event: {kind: 'object', fields: {value: scalarType}},
        },
      },
    });

    expect(expression).toEqual({
      language: 'cel',
      source,
      check: 'typed',
      resultType: 'bool',
    });
  });

  it.each([
    ['event.value == 1', 'double'],
    ['1 == event.value', 'double'],
    ['event.value != 1', 'double'],
    ['event.value == 1.0', 'int'],
  ] satisfies readonly [
    string,
    ExpressionScalarType,
  ][])('type-checks cross-type numeric equality in %s', (source, scalarType) => {
    const expression = createWorkflowExpression({
      source,
      check: {
        mode: 'typed',
        typeEnvironment: {
          event: {kind: 'object', fields: {value: scalarType}},
        },
        expectedResultType: 'bool',
      },
    });

    expect(expression).toEqual({
      language: 'cel',
      source,
      check: 'typed',
      resultType: 'bool',
    });
  });

  it.each([
    'event.value == "1"',
    'event.value + 1 == 2',
  ])('keeps non-numeric and arithmetic double operations strict in %s', (source) => {
    const act = () =>
      createWorkflowExpression({
        source,
        check: {
          mode: 'typed',
          typeEnvironment: {
            event: {kind: 'object', fields: {value: 'double'}},
          },
          expectedResultType: 'bool',
        },
      });

    expect(act).toThrow(InvalidWorkflowExpressionError);
  });

  it('rejects timestamp fields compared with non-timestamp values', () => {
    const act = () =>
      createWorkflowExpression({
        source: 'event.value < 1',
        check: {
          mode: 'typed',
          typeEnvironment: {
            event: {kind: 'object', fields: {value: 'timestamp'}},
          },
        },
      });

    expect(act).toThrow(InvalidWorkflowExpressionError);
  });

  it('type-checks nested object fields registered through schemas', () => {
    const expression = createWorkflowExpression({
      source: 'event.pull_request.title == "ready"',
      check: {
        mode: 'typed',
        typeEnvironment: {
          event: {
            kind: 'object',
            fields: {
              pull_request: {
                kind: 'object',
                fields: {
                  title: 'string',
                },
              },
            },
          },
        },
      },
    });

    expect(expression).toEqual({
      language: 'cel',
      source: 'event.pull_request.title == "ready"',
      check: 'typed',
      resultType: 'bool',
    });
  });

  it('preserves known direct path result types for structured fields', () => {
    const expression = createWorkflowExpression({
      source: 'event.findings',
      check: {
        mode: 'typed',
        typeEnvironment: {
          event: {
            kind: 'object',
            fields: {
              findings: {
                kind: 'list',
                element: {
                  kind: 'object',
                  fields: {severity: 'string'},
                },
              },
            },
          },
        },
      },
    });

    expect(expression.resultType).toEqual({
      kind: 'list',
      element: {
        kind: 'object',
        fields: {severity: 'string'},
      },
    });
  });

  it('preserves known direct root result types for structured values', () => {
    const expression = createWorkflowExpression({
      source: 'event',
      check: {
        mode: 'typed',
        typeEnvironment: {
          event: {
            kind: 'list',
            element: {
              kind: 'object',
              fields: {severity: 'string'},
            },
          },
        },
      },
    });

    expect(expression.resultType).toEqual({
      kind: 'list',
      element: {
        kind: 'object',
        fields: {severity: 'string'},
      },
    });
  });

  it('type-checks open map fields and rejects the same path on empty object schemas', () => {
    const expression = createWorkflowExpression({
      source: 'step.outputs.pass == true',
      check: {
        mode: 'typed',
        typeEnvironment: {
          step: {
            kind: 'object',
            fields: {
              outputs: {kind: 'map'},
            },
          },
        },
      },
    });
    const act = () =>
      createWorkflowExpression({
        source: 'step.outputs.pass == true',
        check: {
          mode: 'typed',
          typeEnvironment: {
            step: {
              kind: 'object',
              fields: {
                outputs: {kind: 'object', fields: {}},
              },
            },
          },
        },
      });

    expect(expression).toEqual({
      language: 'cel',
      source: 'step.outputs.pass == true',
      check: 'typed',
      resultType: 'bool',
    });
    expect(act).toThrow(InvalidWorkflowExpressionError);
  });

  it('treats dynamic open-map expression results as a scalar fallback', () => {
    const expression = createWorkflowExpression({
      source: 'step.outputs.pass',
      check: {
        mode: 'typed',
        typeEnvironment: {
          step: {
            kind: 'object',
            fields: {
              outputs: {kind: 'map'},
            },
          },
        },
      },
    });

    expect(expression).toEqual({
      language: 'cel',
      source: 'step.outputs.pass',
      check: 'typed',
      resultType: 'string',
    });
  });

  it('rejects parse errors before type checking', () => {
    const act = () =>
      createWorkflowExpression({
        source: 'event.conclusion ==',
        check: {
          mode: 'typed',
          typeEnvironment: {
            event: {kind: 'object', fields: {conclusion: 'string'}},
          },
        },
      });

    expect(act).toThrow(InvalidWorkflowExpressionError);
  });

  it('rejects parse errors in syntax mode', () => {
    const act = () =>
      createWorkflowExpression({
        source: 'event.conclusion ==',
        check: {mode: 'syntax'},
      });

    expect(act).toThrow(InvalidWorkflowExpressionError);
  });

  it('rejects blank sources in syntax mode', () => {
    const act = () => createWorkflowExpression({source: '   ', check: {mode: 'syntax'}});

    expect(act).toThrow(InvalidWorkflowExpressionError);
  });

  it('trims accepted syntax sources before storing them', () => {
    const expression = createWorkflowExpression({
      source: '  event.ref == "refs/heads/main"  ',
      check: {mode: 'syntax'},
    });

    expect(expression.source).toBe('event.ref == "refs/heads/main"');
    expect(expression.check).toBe('syntax');
  });

  it('trims accepted typed sources before storing them', () => {
    const expression = createWorkflowExpression({
      source: '  event.conclusion == "success"  ',
      check: {
        mode: 'typed',
        typeEnvironment: {
          event: {kind: 'object', fields: {conclusion: 'string'}},
        },
      },
    });

    expect(expression.source).toBe('event.conclusion == "success"');
    expect(expression.check).toBe('typed');
  });

  it('does not expose vendor ASTs', () => {
    const expression = createWorkflowExpression({
      source: 'event.conclusion == "success"',
      check: {
        mode: 'typed',
        typeEnvironment: {
          event: {kind: 'object', fields: {conclusion: 'string'}},
        },
      },
    });

    expect(Object.keys(expression)).toEqual(['language', 'source', 'check', 'resultType']);
    expect(expression.resultType).toBe('bool');
  });

  it('requires typed environments to be attached to typed checks', () => {
    const params = {
      source: 'event.conclusion == "success"',
      check: {
        mode: 'syntax',
        // @ts-expect-error typeEnvironment is only valid for typed checks.
        typeEnvironment: {
          event: {kind: 'object', fields: {conclusion: 'string'}},
        },
      },
    } satisfies CreateWorkflowExpressionParams;

    expect(params.check.mode).toBe('syntax');
  });

  it('rehydrates already-validated sources with their persisted check level', () => {
    const expression = unsafeWorkflowExpressionFromSource({
      source: 'event.conclusion == "success"',
      check: 'typed',
    });

    expect(expression).toEqual({
      language: 'cel',
      source: 'event.conclusion == "success"',
      check: 'typed',
    });
  });
});
