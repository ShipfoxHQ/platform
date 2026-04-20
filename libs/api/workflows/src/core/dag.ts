export interface DagNode {
  name: string;
  dependencies: string[];
}

export type CompletionStatus = 'succeeded' | 'failed';

/**
 * Returns nodes whose dependencies have all succeeded and that are not yet completed.
 */
export function findReadyNodes<T extends DagNode>(
  nodes: T[],
  completed: ReadonlyMap<string, CompletionStatus>,
): T[] {
  return nodes.filter(
    (n) =>
      !completed.has(n.name) && n.dependencies.every((dep) => completed.get(dep) === 'succeeded'),
  );
}

/**
 * Returns nodes that will never become ready because at least one dependency failed.
 */
export function findBlockedNodes<T extends DagNode>(
  nodes: T[],
  completed: ReadonlyMap<string, CompletionStatus>,
): T[] {
  return nodes.filter(
    (n) => !completed.has(n.name) && n.dependencies.some((dep) => completed.get(dep) === 'failed'),
  );
}
