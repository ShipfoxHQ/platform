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

/** Finds roots that read one of the configured direct child paths in a CEL expression. */
export function extractCelContextPathRoots(params: {
  source: string;
  pathsByRoot: ReadonlyMap<string, readonly string[]>;
}): string[] {
  const roots = new Set<string>();
  collectContextPathRoots(parseCel(params.source).ast, params.pathsByRoot, roots, new Map());
  return [...roots].sort();
}

function collectContextPathRoots(
  node: ASTNode,
  pathsByRoot: ReadonlyMap<string, readonly string[]>,
  roots: Set<string>,
  aliases: ReadonlyMap<string, string>,
): void {
  if (binaryOperators.has(node.op as BinaryOperator) || node.op === '||' || node.op === '&&') {
    collectBinaryContextPathRoots(node.args as [ASTNode, ASTNode], pathsByRoot, roots, aliases);
    return;
  }

  switch (node.op) {
    case 'id':
    case 'value':
      return;
    case '.':
    case '.?': {
      const [target, field] = node.args as [ASTNode, string];
      collectContextPathRoots(target, pathsByRoot, roots, aliases);
      const root = rootName(target, aliases);
      if (root !== undefined) {
        if (pathsByRoot.get(root)?.includes(field)) roots.add(root);
      } else {
        // A call, collection, or conditional can hide a configured root. Treat
        // that unresolved target as reachable so wrappers cannot bypass checks.
        addUnresolvedTargetRoots(target, pathsByRoot, roots, aliases);
      }
      return;
    }
    case '[]':
    case '[?]': {
      const [target, key] = node.args as [ASTNode, ASTNode];
      collectContextPathRoots(target, pathsByRoot, roots, aliases);
      collectContextPathRoots(key, pathsByRoot, roots, aliases);
      const root = rootName(target, aliases);
      if (root === undefined) {
        // The same conservative fallback applies to bracket access.
        addUnresolvedTargetRoots(target, pathsByRoot, roots, aliases);
        return;
      }
      if (!pathsByRoot.has(root)) return;

      const field = literalFieldName(key);
      if (field !== undefined) {
        if (pathsByRoot.get(root)?.includes(field)) roots.add(root);
        return;
      }

      if (!isAllowedListIndex(target, root, aliases)) roots.add(root);
      return;
    }
    case 'call':
      for (const argument of node.args[1]) {
        collectContextPathRoots(argument, pathsByRoot, roots, aliases);
      }
      return;
    case 'rcall': {
      const [method, receiver, args] = node.args as [string, ASTNode, ASTNode[]];
      collectContextPathRoots(receiver, pathsByRoot, roots, aliases);
      const nextAliases = comprehensionAliases(method, receiver, args, aliases, pathsByRoot);
      for (const argument of args) {
        collectContextPathRoots(argument, pathsByRoot, roots, nextAliases);
      }
      return;
    }
    case 'list':
      for (const element of node.args) {
        collectContextPathRoots(element, pathsByRoot, roots, aliases);
      }
      return;
    case 'map':
      for (const [key, value] of node.args) {
        collectContextPathRoots(key, pathsByRoot, roots, aliases);
        collectContextPathRoots(value, pathsByRoot, roots, aliases);
      }
      return;
    case '?:':
      collectContextPathRoots(node.args[0], pathsByRoot, roots, aliases);
      collectContextPathRoots(node.args[1], pathsByRoot, roots, aliases);
      collectContextPathRoots(node.args[2], pathsByRoot, roots, aliases);
      return;
    case '!_':
    case '-_':
      collectContextPathRoots(node.args, pathsByRoot, roots, aliases);
      return;
  }

  throw new Error(`Unsupported CEL AST operator: ${(node as {op: string}).op}`);
}

function collectBinaryContextPathRoots(
  [left, right]: [ASTNode, ASTNode],
  pathsByRoot: ReadonlyMap<string, readonly string[]>,
  roots: Set<string>,
  aliases: ReadonlyMap<string, string>,
): void {
  collectContextPathRoots(left, pathsByRoot, roots, aliases);
  collectContextPathRoots(right, pathsByRoot, roots, aliases);
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

function addUnresolvedTargetRoots(
  target: ASTNode,
  pathsByRoot: ReadonlyMap<string, readonly string[]>,
  roots: Set<string>,
  aliases: ReadonlyMap<string, string>,
): void {
  for (const root of configuredRoots(target, pathsByRoot, aliases)) roots.add(root);
}

function configuredRoots(
  node: ASTNode,
  pathsByRoot: ReadonlyMap<string, readonly string[]>,
  aliases: ReadonlyMap<string, string>,
): ReadonlySet<string> {
  const roots = new Set<string>();
  collectConfiguredRoots(node, pathsByRoot, roots, aliases);
  return roots;
}

function collectConfiguredRoots(
  node: ASTNode,
  pathsByRoot: ReadonlyMap<string, readonly string[]>,
  roots: Set<string>,
  aliases: ReadonlyMap<string, string>,
): void {
  if (binaryOperators.has(node.op as BinaryOperator) || node.op === '||' || node.op === '&&') {
    const [left, right] = node.args as [ASTNode, ASTNode];
    collectConfiguredRoots(left, pathsByRoot, roots, aliases);
    collectConfiguredRoots(right, pathsByRoot, roots, aliases);
    return;
  }

  switch (node.op) {
    case 'id': {
      const root = aliases.get(node.args) ?? node.args;
      if (pathsByRoot.has(root)) roots.add(root);
      return;
    }
    case 'value':
      return;
    case '.':
    case '.?':
      collectConfiguredRoots(node.args[0], pathsByRoot, roots, aliases);
      return;
    case '[]':
    case '[?]':
      collectConfiguredRoots(node.args[0], pathsByRoot, roots, aliases);
      collectConfiguredRoots(node.args[1], pathsByRoot, roots, aliases);
      return;
    case 'call':
      for (const argument of node.args[1]) {
        collectConfiguredRoots(argument, pathsByRoot, roots, aliases);
      }
      return;
    case 'rcall': {
      const [method, receiver, args] = node.args as [string, ASTNode, ASTNode[]];
      collectConfiguredRoots(receiver, pathsByRoot, roots, aliases);
      const nextAliases = comprehensionAliases(method, receiver, args, aliases, pathsByRoot);
      for (const argument of args) {
        collectConfiguredRoots(argument, pathsByRoot, roots, nextAliases);
      }
      return;
    }
    case 'list':
      for (const element of node.args) {
        collectConfiguredRoots(element, pathsByRoot, roots, aliases);
      }
      return;
    case 'map':
      for (const [key, value] of node.args) {
        if (key.op !== 'id') collectConfiguredRoots(key, pathsByRoot, roots, aliases);
        collectConfiguredRoots(value, pathsByRoot, roots, aliases);
      }
      return;
    case '?:':
      collectConfiguredRoots(node.args[0], pathsByRoot, roots, aliases);
      collectConfiguredRoots(node.args[1], pathsByRoot, roots, aliases);
      collectConfiguredRoots(node.args[2], pathsByRoot, roots, aliases);
      return;
    case '!_':
    case '-_':
      collectConfiguredRoots(node.args, pathsByRoot, roots, aliases);
      return;
  }

  throw new Error(`Unsupported CEL AST operator: ${(node as {op: string}).op}`);
}

function literalFieldName(node: ASTNode): string | undefined {
  return node.op === 'value' && typeof node.args === 'string' ? node.args : undefined;
}

function isAllowedListIndex(
  target: ASTNode,
  root: string,
  aliases: ReadonlyMap<string, string>,
): boolean {
  return root === 'executions' && target.op === 'id' && aliases.get(target.args) === undefined;
}

function comprehensionAliases(
  method: string,
  receiver: ASTNode,
  args: readonly ASTNode[],
  aliases: ReadonlyMap<string, string>,
  pathsByRoot: ReadonlyMap<string, readonly string[]>,
): ReadonlyMap<string, string> {
  const [alias] = args;
  if (alias?.op !== 'id') return aliases;

  const source = method === 'bind' ? args[1] : receiver;
  if (source === undefined) return aliases;

  if (method !== 'bind' && !comprehensionMethods.has(method)) return aliases;

  const root = configuredRoot(source, pathsByRoot, aliases);
  if (root === undefined) return aliases;

  return new Map([...aliases, [alias.args, root]]);
}

function configuredRoot(
  node: ASTNode,
  pathsByRoot: ReadonlyMap<string, readonly string[]>,
  aliases: ReadonlyMap<string, string>,
): string | undefined {
  const root = rootName(node, aliases);
  if (root !== undefined && pathsByRoot.has(root)) return root;

  const roots = configuredRoots(node, pathsByRoot, aliases);
  return roots.size === 1 ? [...roots][0] : undefined;
}
