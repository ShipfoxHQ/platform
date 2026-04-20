import type {Job} from './entities/definition.js';

export class DagValidationError extends Error {
  constructor(
    message: string,
    public cycle?: string[],
  ) {
    super(message);
    this.name = 'DagValidationError';
  }
}

// Kahn's algorithm for topological sort:
//   1. Build adjacency list from needs + implicit workspace deps
//   2. Validate all referenced job names exist
//   3. Compute in-degree for each node
//   4. Queue all nodes with in-degree 0
//   5. While queue not empty:
//      a. Dequeue node, add to sorted list
//      b. For each neighbor: decrement in-degree
//      c. If in-degree becomes 0, enqueue
//   6. If sorted.length < total nodes -> cycle exists
//   7. Return topologically sorted job names

export function validateDag(jobs: Record<string, Job>): string[] {
  const jobNames = new Set(Object.keys(jobs));

  if (jobNames.size === 0) {
    return [];
  }

  const adjacency = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const name of jobNames) {
    adjacency.set(name, []);
    inDegree.set(name, 0);
  }

  for (const [name, job] of Object.entries(jobs)) {
    const deps = resolveNeeds(job);

    for (const dep of deps) {
      if (!jobNames.has(dep)) {
        throw new DagValidationError(`Job "${name}" depends on unknown job "${dep}"`);
      }

      if (dep === name) {
        throw new DagValidationError(`Job "${name}" depends on itself`, [name, name]);
      }

      const neighbors = adjacency.get(dep);
      if (neighbors) neighbors.push(name);

      const current = inDegree.get(name) ?? 0;
      inDegree.set(name, current + 1);
    }
  }

  const queue: string[] = [];
  for (const [name, degree] of inDegree) {
    if (degree === 0) {
      queue.push(name);
    }
  }

  const sorted: string[] = [];

  while (queue.length > 0) {
    const node = queue.shift() as string;
    sorted.push(node);

    const nodeNeighbors = adjacency.get(node) ?? [];
    for (const neighbor of nodeNeighbors) {
      const newDegree = (inDegree.get(neighbor) ?? 0) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  if (sorted.length < jobNames.size) {
    const cycleNodes = [...jobNames].filter((name) => !sorted.includes(name));
    throw new DagValidationError(
      `Circular dependency detected among jobs: ${cycleNodes.join(', ')}`,
      cycleNodes,
    );
  }

  return sorted;
}

function resolveNeeds(job: Job): string[] {
  return normalizeToArray(job.needs);
}

function normalizeToArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? [...value] : [value];
}
