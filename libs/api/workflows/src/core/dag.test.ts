import type {CompletionStatus, DagNode} from './dag.js';
import {findBlockedNodes, findReadyNodes} from './dag.js';

function node(name: string, dependencies: string[] = []): DagNode {
  return {name, dependencies};
}

function completed(entries: Record<string, CompletionStatus>): Map<string, CompletionStatus> {
  return new Map(Object.entries(entries));
}

describe('findReadyNodes', () => {
  test('returns empty for empty nodes', () => {
    const ready = findReadyNodes([], completed({}));

    expect(ready).toEqual([]);
  });

  test('returns root nodes when nothing is completed', () => {
    const nodes = [node('a'), node('b', ['a']), node('c', ['a'])];

    const ready = findReadyNodes(nodes, completed({}));

    expect(ready.map((n) => n.name)).toEqual(['a']);
  });

  test('returns nodes whose dependencies have all succeeded', () => {
    const nodes = [node('a'), node('b', ['a']), node('c', ['a', 'b'])];

    const ready = findReadyNodes(nodes, completed({a: 'succeeded'}));

    expect(ready.map((n) => n.name)).toEqual(['b']);
  });

  test('does not return nodes whose dependencies failed', () => {
    const nodes = [node('a'), node('b', ['a'])];

    const ready = findReadyNodes(nodes, completed({a: 'failed'}));

    expect(ready).toEqual([]);
  });

  test('does not return already-completed nodes', () => {
    const nodes = [node('a'), node('b')];

    const ready = findReadyNodes(nodes, completed({a: 'succeeded', b: 'succeeded'}));

    expect(ready).toEqual([]);
  });

  test('returns multiple independent nodes in parallel', () => {
    const nodes = [node('a'), node('b'), node('c', ['a', 'b'])];

    const ready = findReadyNodes(nodes, completed({}));

    expect(ready.map((n) => n.name)).toEqual(['a', 'b']);
  });

  test('handles diamond dependency', () => {
    const nodes = [node('a'), node('b', ['a']), node('c', ['a']), node('d', ['b', 'c'])];

    const ready = findReadyNodes(nodes, completed({a: 'succeeded', b: 'succeeded'}));

    expect(ready.map((n) => n.name)).toEqual(['c']);
  });
});

describe('findBlockedNodes', () => {
  test('returns empty for empty nodes', () => {
    const blocked = findBlockedNodes([], completed({}));

    expect(blocked).toEqual([]);
  });

  test('returns empty when no dependencies have failed', () => {
    const nodes = [node('a'), node('b', ['a'])];

    const blocked = findBlockedNodes(nodes, completed({}));

    expect(blocked).toEqual([]);
  });

  test('returns nodes with a failed dependency', () => {
    const nodes = [node('a'), node('b', ['a']), node('c', ['a'])];

    const blocked = findBlockedNodes(nodes, completed({a: 'failed'}));

    expect(blocked.map((n) => n.name)).toEqual(['b', 'c']);
  });

  test('does not return already-completed nodes', () => {
    const nodes = [node('a'), node('b', ['a'])];

    const blocked = findBlockedNodes(nodes, completed({a: 'failed', b: 'failed'}));

    expect(blocked).toEqual([]);
  });

  test('returns transitively blocked nodes once their immediate dep is marked failed', () => {
    const nodes = [node('a'), node('b', ['a']), node('c', ['b'])];

    const blocked = findBlockedNodes(nodes, completed({a: 'failed', b: 'failed'}));

    expect(blocked.map((n) => n.name)).toEqual(['c']);
  });

  test('blocks node when any dependency failed even if others succeeded', () => {
    const nodes = [node('a'), node('b'), node('c', ['a', 'b'])];

    const blocked = findBlockedNodes(nodes, completed({a: 'succeeded', b: 'failed'}));

    expect(blocked.map((n) => n.name)).toEqual(['c']);
  });
});
