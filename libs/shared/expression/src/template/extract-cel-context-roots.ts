import {type ASTNode, type BinaryOperator, parse as parseCel} from '@marcbachmann/cel-js';

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

export function extractCelContextRoots(source: string): string[] {
  const contextRoots = new Set<string>();
  collectContextRoots(parseCel(source).ast, contextRoots, new Set());
  return [...contextRoots].sort();
}

function collectContextRoots(
  node: ASTNode,
  contextRoots: Set<string>,
  scopedIdentifiers: ReadonlySet<string>,
): void {
  if (binaryOperators.has(node.op as BinaryOperator) || node.op === '||' || node.op === '&&') {
    collectBinaryContextRoots(node.args as [ASTNode, ASTNode], contextRoots, scopedIdentifiers);
    return;
  }

  switch (node.op) {
    case 'id':
      if (!scopedIdentifiers.has(node.args)) contextRoots.add(node.args);
      return;
    case 'value':
      return;
    case '.':
    case '.?':
      collectContextRoots(node.args[0], contextRoots, scopedIdentifiers);
      return;
    case '[]':
    case '[?]':
      collectBinaryContextRoots(node.args, contextRoots, scopedIdentifiers);
      return;
    case 'call':
      for (const argument of node.args[1]) {
        collectContextRoots(argument, contextRoots, scopedIdentifiers);
      }
      return;
    case 'rcall': {
      const [method, receiver, args] = node.args as [string, ASTNode, ASTNode[]];
      collectContextRoots(receiver, contextRoots, scopedIdentifiers);
      const binding = bindComprehensionAlias(method, args, scopedIdentifiers);
      for (const argument of args.slice(binding.skipArgs)) {
        collectContextRoots(argument, contextRoots, binding.scopedIdentifiers);
      }
      return;
    }
    case 'list':
      for (const element of node.args) {
        collectContextRoots(element, contextRoots, scopedIdentifiers);
      }
      return;
    case 'map':
      collectMapContextRoots(node.args, contextRoots, scopedIdentifiers);
      return;
    case '?:':
      collectContextRoots(node.args[0], contextRoots, scopedIdentifiers);
      collectContextRoots(node.args[1], contextRoots, scopedIdentifiers);
      collectContextRoots(node.args[2], contextRoots, scopedIdentifiers);
      return;
    case '!_':
    case '-_':
      collectContextRoots(node.args, contextRoots, scopedIdentifiers);
      return;
  }

  throw new Error(`Unsupported CEL AST operator: ${(node as {op: string}).op}`);
}

function collectMapContextRoots(
  entries: Array<[ASTNode, ASTNode]>,
  contextRoots: Set<string>,
  scopedIdentifiers: ReadonlySet<string>,
): void {
  for (const [key, value] of entries) {
    if (key.op !== 'id') collectContextRoots(key, contextRoots, scopedIdentifiers);
    collectContextRoots(value, contextRoots, scopedIdentifiers);
  }
}

function collectBinaryContextRoots(
  [left, right]: [ASTNode, ASTNode],
  contextRoots: Set<string>,
  scopedIdentifiers: ReadonlySet<string>,
): void {
  collectContextRoots(left, contextRoots, scopedIdentifiers);
  collectContextRoots(right, contextRoots, scopedIdentifiers);
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
