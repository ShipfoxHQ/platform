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

export function extractCelUntrustedPathAccesses(params: {
  source: string;
  untrustedPathsByRoot: ReadonlyMap<string, readonly string[]>;
}): string[] {
  const roots = new Set<string>();
  collectUntrustedPathAccesses(
    parseCel(params.source).ast,
    params.untrustedPathsByRoot,
    roots,
    new Map(),
  );
  return [...roots].sort();
}

function collectUntrustedPathAccesses(
  node: ASTNode,
  untrustedPathsByRoot: ReadonlyMap<string, readonly string[]>,
  roots: Set<string>,
  aliases: ReadonlyMap<string, string>,
): void {
  if (binaryOperators.has(node.op as BinaryOperator) || node.op === '||' || node.op === '&&') {
    collectBinaryUntrustedPathAccesses(
      node.args as [ASTNode, ASTNode],
      untrustedPathsByRoot,
      roots,
      aliases,
    );
    return;
  }

  switch (node.op) {
    case 'id':
    case 'value':
      return;
    case '.':
    case '.?': {
      const [target, field] = node.args as [ASTNode, string];
      collectUntrustedPathAccesses(target, untrustedPathsByRoot, roots, aliases);
      const root = rootName(target, aliases);
      if (root && untrustedPathsByRoot.get(root)?.includes(field)) roots.add(root);
      return;
    }
    case '[]':
    case '[?]': {
      const [target, key] = node.args as [ASTNode, ASTNode];
      collectUntrustedPathAccesses(target, untrustedPathsByRoot, roots, aliases);
      collectUntrustedPathAccesses(key, untrustedPathsByRoot, roots, aliases);
      const root = rootName(target, aliases);
      if (!root || !untrustedPathsByRoot.has(root)) return;

      const field = literalFieldName(key);
      if (field !== undefined) {
        if (untrustedPathsByRoot.get(root)?.includes(field)) roots.add(root);
        return;
      }

      if (!isAllowedListIndex(target, root)) roots.add(root);
      return;
    }
    case 'call':
      for (const argument of node.args[1]) {
        collectUntrustedPathAccesses(argument, untrustedPathsByRoot, roots, aliases);
      }
      return;
    case 'rcall': {
      const [method, receiver, args] = node.args as [string, ASTNode, ASTNode[]];
      collectUntrustedPathAccesses(receiver, untrustedPathsByRoot, roots, aliases);
      const nextAliases = comprehensionAliases(
        method,
        receiver,
        args,
        aliases,
        untrustedPathsByRoot,
      );
      for (const argument of args) {
        collectUntrustedPathAccesses(argument, untrustedPathsByRoot, roots, nextAliases);
      }
      return;
    }
    case 'list':
      for (const element of node.args) {
        collectUntrustedPathAccesses(element, untrustedPathsByRoot, roots, aliases);
      }
      return;
    case 'map':
      for (const [key, value] of node.args) {
        collectUntrustedPathAccesses(key, untrustedPathsByRoot, roots, aliases);
        collectUntrustedPathAccesses(value, untrustedPathsByRoot, roots, aliases);
      }
      return;
    case '?:':
      collectUntrustedPathAccesses(node.args[0], untrustedPathsByRoot, roots, aliases);
      collectUntrustedPathAccesses(node.args[1], untrustedPathsByRoot, roots, aliases);
      collectUntrustedPathAccesses(node.args[2], untrustedPathsByRoot, roots, aliases);
      return;
    case '!_':
    case '-_':
      collectUntrustedPathAccesses(node.args, untrustedPathsByRoot, roots, aliases);
      return;
  }

  throw new Error(`Unsupported CEL AST operator: ${(node as {op: string}).op}`);
}

function collectBinaryUntrustedPathAccesses(
  [left, right]: [ASTNode, ASTNode],
  untrustedPathsByRoot: ReadonlyMap<string, readonly string[]>,
  roots: Set<string>,
  aliases: ReadonlyMap<string, string>,
): void {
  collectUntrustedPathAccesses(left, untrustedPathsByRoot, roots, aliases);
  collectUntrustedPathAccesses(right, untrustedPathsByRoot, roots, aliases);
}

function rootName(node: ASTNode, aliases: ReadonlyMap<string, string>): string | undefined {
  switch (node.op) {
    case 'id':
      return aliases.get(node.args) ?? node.args;
    case '.':
    case '.?':
      return rootName(node.args[0], aliases);
    case '[]':
    case '[?]':
      return rootName(node.args[0], aliases);
    case 'rcall':
      return rootName(node.args[1], aliases);
    default:
      return undefined;
  }
}

function literalFieldName(node: ASTNode): string | undefined {
  return node.op === 'value' && typeof node.args === 'string' ? node.args : undefined;
}

function isAllowedListIndex(target: ASTNode, root: string): boolean {
  return root === 'executions' && target.op === 'id';
}

function comprehensionAliases(
  method: string,
  receiver: ASTNode,
  args: readonly ASTNode[],
  aliases: ReadonlyMap<string, string>,
  untrustedPathsByRoot: ReadonlyMap<string, readonly string[]>,
): ReadonlyMap<string, string> {
  if (!['all', 'exists', 'exists_one', 'filter', 'map'].includes(method)) return aliases;

  const [alias] = args;
  if (alias?.op !== 'id') return aliases;

  const root = rootName(receiver, aliases);
  if (root === undefined || !untrustedPathsByRoot.has(root)) return aliases;

  return new Map([...aliases, [alias.args, root]]);
}
