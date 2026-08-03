export type CheckoutTargetValidationIssue =
  | {
      kind: 'project-with-connection';
      path: 'connection';
      fields: readonly ['project', 'connection'];
    }
  | {
      kind: 'project-with-repository';
      path: 'repository';
      fields: readonly ['project', 'repository'];
    }
  | {
      kind: 'connection-without-repository';
      path: 'repository';
      fields: readonly ['connection', 'repository'];
    };

export function checkoutTargetValidationIssues(target: {
  readonly project?: unknown;
  readonly connection?: unknown;
  readonly repository?: unknown;
}): readonly CheckoutTargetValidationIssue[] {
  const issues: CheckoutTargetValidationIssue[] = [];

  if (target.project !== undefined && target.connection !== undefined) {
    issues.push({
      kind: 'project-with-connection',
      path: 'connection',
      fields: ['project', 'connection'],
    });
  }
  if (target.project !== undefined && target.repository !== undefined) {
    issues.push({
      kind: 'project-with-repository',
      path: 'repository',
      fields: ['project', 'repository'],
    });
  }
  if (target.connection !== undefined && target.repository === undefined) {
    issues.push({
      kind: 'connection-without-repository',
      path: 'repository',
      fields: ['connection', 'repository'],
    });
  }

  return issues;
}
