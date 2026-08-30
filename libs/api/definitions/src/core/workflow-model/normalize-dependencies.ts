import type {WorkflowDocumentJob} from '@shipfox/workflow-document';
import type {WorkflowModelDependency} from '../entities/workflow-model.js';
import type {WorkflowModelValidationIssue} from './invalid-workflow-model-error.js';
import {normalizeNeeds} from './normalize-needs.js';
import {issue} from './validation-issue.js';

export function normalizeDependencies(
  jobs: Readonly<Record<string, WorkflowDocumentJob>>,
  jobIdBySourceName: ReadonlyMap<string, string>,
  issues: WorkflowModelValidationIssue[],
): readonly WorkflowModelDependency[] {
  const dependencies: WorkflowModelDependency[] = [];

  for (const [sourceName, job] of Object.entries(jobs)) {
    const to = jobIdBySourceName.get(sourceName);
    if (to === undefined) continue;

    for (const dependencySourceName of normalizeNeeds(job.needs)) {
      if (!jobIdBySourceName.has(dependencySourceName)) {
        issues.push(
          issue({
            code: 'unknown-job-dependency',
            message: `Job "${sourceName}" depends on unknown job "${dependencySourceName}".`,
            path: ['jobs', sourceName, 'needs'],
            details: {job: sourceName, dependency: dependencySourceName},
          }),
        );
        continue;
      }

      if (dependencySourceName === sourceName) {
        issues.push(
          issue({
            code: 'self-job-dependency',
            message: `Job "${sourceName}" depends on itself.`,
            path: ['jobs', sourceName, 'needs'],
            details: {job: sourceName},
          }),
        );
        continue;
      }

      dependencies.push({from: jobIdBySourceName.get(dependencySourceName) as string, to});
    }
  }

  return dependencies;
}

export function validateCycles(
  jobs: Readonly<Record<string, WorkflowDocumentJob>>,
  jobIdBySourceName: ReadonlyMap<string, string>,
  issues: WorkflowModelValidationIssue[],
): void {
  const jobNames = Object.keys(jobs);
  const adjacency = new Map<string, string[]>();

  for (const name of jobNames) {
    adjacency.set(name, []);
  }

  for (const [name, job] of Object.entries(jobs)) {
    for (const dependency of normalizeNeeds(job.needs)) {
      if (!jobIdBySourceName.has(dependency) || dependency === name) continue;

      adjacency.get(dependency)?.push(name);
    }
  }

  const cyclicNames = findCyclicSourceNames(jobNames, adjacency);
  if (cyclicNames.length > 0) {
    issues.push(
      issue({
        code: 'job-dependency-cycle',
        message: `Circular dependency detected among jobs: ${cyclicNames.join(', ')}.`,
        path: ['jobs'],
        details: {
          cycleSourceNames: cyclicNames,
          cycleJobIds: cyclicNames.flatMap((name) => {
            const id = jobIdBySourceName.get(name);
            return id === undefined ? [] : [id];
          }),
        },
      }),
    );
  }
}

function findCyclicSourceNames(
  jobNames: readonly string[],
  adjacency: ReadonlyMap<string, readonly string[]>,
): readonly string[] {
  const state: CyclicSearchState = {
    indexes: new Map(),
    lowLinks: new Map(),
    stack: [],
    onStack: new Set(),
    cyclicNames: new Set(),
    index: 0,
  };

  for (const name of jobNames) {
    if (!state.indexes.has(name)) visitDependencyNode(name, adjacency, state);
  }

  return jobNames.filter((name) => state.cyclicNames.has(name));
}

interface CyclicSearchState {
  indexes: Map<string, number>;
  lowLinks: Map<string, number>;
  stack: string[];
  onStack: Set<string>;
  cyclicNames: Set<string>;
  index: number;
}

function visitDependencyNode(
  node: string,
  adjacency: ReadonlyMap<string, readonly string[]>,
  state: CyclicSearchState,
): void {
  state.indexes.set(node, state.index);
  state.lowLinks.set(node, state.index);
  state.index += 1;
  state.stack.push(node);
  state.onStack.add(node);

  for (const neighbor of adjacency.get(node) ?? []) {
    visitDependencyNeighbor(node, neighbor, adjacency, state);
  }
  if (state.lowLinks.get(node) === state.indexes.get(node)) collectComponent(node, state);
}

function visitDependencyNeighbor(
  node: string,
  neighbor: string,
  adjacency: ReadonlyMap<string, readonly string[]>,
  state: CyclicSearchState,
): void {
  if (!state.indexes.has(neighbor)) {
    visitDependencyNode(neighbor, adjacency, state);
    state.lowLinks.set(
      node,
      Math.min(state.lowLinks.get(node) as number, state.lowLinks.get(neighbor) as number),
    );
    return;
  }
  if (state.onStack.has(neighbor)) {
    state.lowLinks.set(
      node,
      Math.min(state.lowLinks.get(node) as number, state.indexes.get(neighbor) as number),
    );
  }
}

function collectComponent(node: string, state: CyclicSearchState): void {
  const component: string[] = [];
  while (state.stack.length > 0) {
    const member = state.stack.pop() as string;
    state.onStack.delete(member);
    component.push(member);
    if (member === node) break;
  }
  if (component.length > 1) {
    for (const member of component) state.cyclicNames.add(member);
  }
}
