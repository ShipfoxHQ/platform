import {type ASTNode, type BinaryOperator, parse as parseCel} from '@marcbachmann/cel-js';
import type {WorkflowExpression} from '../expression/workflow-expression.js';
import {workflowContextRootRequiresLiteralKey} from '../workflow-context/workflow-context.js';

const binaryOperators = new Set<BinaryOperator>([
  '!=',
  '==',
  'in',
  '+',
  '-',
  '*',
  '/',
  '%',
  '<',
  '<=',
  '>',
  '>=',
]);

const comprehensionMethods = new Set(['all', 'exists', 'exists_one', 'filter', 'map']);

export interface ContextKeyAccessReference {
  readonly root: 'vars' | 'secrets';
  readonly store?: string;
  readonly key: string;
}

export interface ContextKeyAccessViolation {
  readonly root: string;
  /** First key when a computed access still uses a literal string key. */
  readonly key?: string;
  readonly source: string;
}

export interface ContextKeyAccessAnalysis {
  readonly references: readonly ContextKeyAccessReference[];
  readonly violations: readonly ContextKeyAccessViolation[];
}

export interface ContextRootKeyAccessReference {
  readonly root: string;
  readonly key: string;
}

export interface ContextRootKeyAccessAnalysis {
  readonly references: readonly ContextRootKeyAccessReference[];
  readonly violations: readonly ContextKeyAccessViolation[];
}

interface AccessChain {
  readonly root: string;
  readonly segments: readonly string[];
  readonly computed: boolean;
  readonly rootKeyComputed: boolean;
}

interface ContextAccessVisitor {
  readonly shouldRecord: (chain: AccessChain) => boolean;
  readonly record: (chain: AccessChain, source: string) => void;
}

export function analyzeContextKeyAccess(
  expression: WorkflowExpression | string,
): ContextKeyAccessAnalysis {
  const source = typeof expression === 'string' ? expression : expression.source;
  const references: ContextKeyAccessReference[] = [];
  const violations: ContextKeyAccessViolation[] = [];

  collectContextAccesses(parseCel(source).ast, source, new Set(), {
    shouldRecord: (chain) => workflowContextRootRequiresLiteralKey(chain.root),
    record: (chain, expressionSource) =>
      recordLiteralKeyRootAccess(chain, expressionSource, references, violations),
  });

  return {references, violations};
}

export function analyzeContextRootKeyAccess(
  expression: WorkflowExpression | string,
  roots: readonly string[],
): ContextRootKeyAccessAnalysis {
  const source = typeof expression === 'string' ? expression : expression.source;
  const references: ContextRootKeyAccessReference[] = [];
  const violations: ContextKeyAccessViolation[] = [];
  const selectedRoots = new Set(roots);

  collectContextAccesses(parseCel(source).ast, source, new Set(), {
    shouldRecord: (chain) => selectedRoots.has(chain.root),
    record: (chain, expressionSource) =>
      recordContextRootKeyAccess(chain, expressionSource, references, violations),
  });

  return {references, violations};
}

function collectContextAccesses(
  node: ASTNode,
  source: string,
  scopedIdentifiers: ReadonlySet<string>,
  visitor: ContextAccessVisitor,
): void {
  if (binaryOperators.has(node.op as BinaryOperator) || node.op === '||' || node.op === '&&') {
    collectBinaryContextAccesses(
      node.args as [ASTNode, ASTNode],
      source,
      scopedIdentifiers,
      visitor,
    );
    return;
  }

  const chain = accessChain(node, scopedIdentifiers);
  if (chain && visitor.shouldRecord(chain)) {
    visitor.record(chain, source);
    return;
  }

  switch (node.op) {
    case 'id':
    case 'value':
      return;
    case '.':
    case '.?':
      collectContextAccesses(node.args[0], source, scopedIdentifiers, visitor);
      return;
    case '[]':
    case '[?]':
      collectBinaryContextAccesses(node.args, source, scopedIdentifiers, visitor);
      return;
    case 'call':
      for (const argument of node.args[1]) {
        collectContextAccesses(argument, source, scopedIdentifiers, visitor);
      }
      return;
    case 'rcall': {
      const [method, receiver, args] = node.args as [string, ASTNode, ASTNode[]];
      collectContextAccesses(receiver, source, scopedIdentifiers, visitor);
      const binding = bindComprehensionAlias(method, args, scopedIdentifiers);
      for (const argument of args.slice(binding.skipArgs)) {
        collectContextAccesses(argument, source, binding.scopedIdentifiers, visitor);
      }
      return;
    }
    case 'list':
      for (const element of node.args) {
        collectContextAccesses(element, source, scopedIdentifiers, visitor);
      }
      return;
    case 'map':
      for (const [key, value] of node.args) {
        if (key.op !== 'id') {
          collectContextAccesses(key, source, scopedIdentifiers, visitor);
        }
        collectContextAccesses(value, source, scopedIdentifiers, visitor);
      }
      return;
    case '?:':
      collectContextAccesses(node.args[0], source, scopedIdentifiers, visitor);
      collectContextAccesses(node.args[1], source, scopedIdentifiers, visitor);
      collectContextAccesses(node.args[2], source, scopedIdentifiers, visitor);
      return;
    case '!_':
    case '-_':
      collectContextAccesses(node.args, source, scopedIdentifiers, visitor);
      return;
  }

  throw new Error(`Unsupported CEL AST operator: ${(node as {op: string}).op}`);
}

function collectBinaryContextAccesses(
  [left, right]: [ASTNode, ASTNode],
  source: string,
  scopedIdentifiers: ReadonlySet<string>,
  visitor: ContextAccessVisitor,
): void {
  collectContextAccesses(left, source, scopedIdentifiers, visitor);
  collectContextAccesses(right, source, scopedIdentifiers, visitor);
}

function recordLiteralKeyRootAccess(
  chain: AccessChain,
  source: string,
  references: ContextKeyAccessReference[],
  violations: ContextKeyAccessViolation[],
): void {
  if (chain.computed) {
    violations.push({root: chain.root, source});
    return;
  }

  if (chain.root === 'vars' && chain.segments.length === 1) {
    const key = chain.segments[0];
    if (key === undefined) throw new Error('Expected vars key segment');
    references.push({root: chain.root, key});
    return;
  }

  if (chain.root === 'secrets' && chain.segments.length === 1) {
    const key = chain.segments[0];
    if (key === undefined) throw new Error('Expected secret key segment');
    references.push({root: chain.root, key});
    return;
  }

  if (chain.root === 'secrets' && chain.segments.length === 2) {
    const store = chain.segments[0];
    const key = chain.segments[1];
    if (store === undefined || key === undefined) {
      throw new Error('Expected secret store and key segments');
    }
    references.push({root: chain.root, store, key});
    return;
  }

  violations.push({root: chain.root, source});
}

function recordContextRootKeyAccess(
  chain: AccessChain,
  source: string,
  references: ContextRootKeyAccessReference[],
  violations: ContextKeyAccessViolation[],
): void {
  const [key] = chain.segments;
  if (chain.rootKeyComputed || key === undefined) {
    violations.push({root: chain.root, ...(key === undefined ? {} : {key}), source});
    return;
  }

  references.push({root: chain.root, key});
}

function accessChain(
  node: ASTNode,
  scopedIdentifiers: ReadonlySet<string>,
): AccessChain | undefined {
  switch (node.op) {
    case 'id':
      return scopedIdentifiers.has(node.args)
        ? undefined
        : {root: node.args, segments: [], computed: false, rootKeyComputed: false};
    case '.': {
      const target = accessChain(node.args[0], scopedIdentifiers);
      if (target === undefined) return undefined;
      return {...target, segments: [...target.segments, node.args[1]]};
    }
    case '.?': {
      const target = accessChain(node.args[0], scopedIdentifiers);
      if (target === undefined) return undefined;
      return {
        ...target,
        segments: [...target.segments, node.args[1]],
        computed: true,
        rootKeyComputed: target.segments.length === 0 || target.rootKeyComputed,
      };
    }
    case '[]':
    case '[?]': {
      const target = accessChain(node.args[0], scopedIdentifiers);
      if (target === undefined) return undefined;
      const literalSegment = literalStringValue(node.args[1]);
      return {
        ...target,
        segments:
          literalSegment === undefined ? target.segments : [...target.segments, literalSegment],
        computed: true,
        rootKeyComputed: target.segments.length === 0 || target.rootKeyComputed,
      };
    }
    default:
      return undefined;
  }
}

function literalStringValue(node: ASTNode): string | undefined {
  return node.op === 'value' && typeof node.args === 'string' ? node.args : undefined;
}

function bindComprehensionAlias(
  method: string,
  args: readonly ASTNode[],
  scopedIdentifiers: ReadonlySet<string>,
): {readonly scopedIdentifiers: ReadonlySet<string>; readonly skipArgs: number} {
  if (!comprehensionMethods.has(method)) return {scopedIdentifiers, skipArgs: 0};

  const [alias] = args;
  if (alias?.op !== 'id') return {scopedIdentifiers, skipArgs: 0};

  return {
    scopedIdentifiers: new Set([...scopedIdentifiers, alias.args]),
    skipArgs: 1,
  };
}
