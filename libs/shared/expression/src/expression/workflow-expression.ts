export type ValidCelExpression = string & {readonly __validCelExpression: unique symbol};

export interface WorkflowExpression {
  language: 'cel';
  source: ValidCelExpression;
  check: WorkflowExpressionCheck;
  resultType?: ExpressionType;
}

export type WorkflowExpressionCheck = 'syntax' | 'typed';

export type ExpressionScalarType = 'string' | 'int' | 'double' | 'bool' | 'null' | 'timestamp';

export type ExpressionType =
  | ExpressionScalarType
  | {
      kind: 'dyn';
    }
  | {
      kind: 'object';
      fields: Readonly<Record<string, ExpressionType>>;
    }
  | {
      kind: 'map';
    }
  | {
      kind: 'list';
      element: ExpressionType;
    };

export type ExpressionTypeEnvironment = Readonly<Record<string, ExpressionType>>;

export type WorkflowExpressionCheckOptions =
  | {
      mode: 'syntax';
    }
  | {
      mode: 'typed';
      typeEnvironment?: ExpressionTypeEnvironment;
      expectedResultType?: ExpressionScalarType;
    };

export interface CreateWorkflowExpressionParams {
  source: string;
  check: WorkflowExpressionCheckOptions;
}
