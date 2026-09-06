import {type ASTNode, type BinaryOperator, parse as parseCel} from '@marcbachmann/cel-js';
import type {WorkflowExpression} from '../expression/workflow-expression.js';

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

/** A literal object key, array index, or comprehension element in a context path. */
export type ContextPathSegment = string | number | '*';

export interface ContextPathReference {
  readonly root: string;
  readonly segments: readonly ContextPathSegment[];
  readonly source: string;
  readonly wholeElement?: true;
}

export interface ContextPathAccessUnknown {
  readonly root: string;
  readonly source: string;
  readonly reason: 'dynamic';
}

export interface ContextPathAccessAnalysis {
  readonly references: readonly ContextPathReference[];
  readonly unknown: readonly ContextPathAccessUnknown[];
}

interface PathChain {
  readonly root: string;
  readonly segments: readonly ContextPathSegment[];
  readonly unknown?: 'dynamic';
}

type ScopedPaths = ReadonlyMap<string, PathChain | null>;

interface RecordPathOptions {
  readonly wholeElement?: boolean;
}

export function analyzeContextPathAccess(
  expression: WorkflowExpression | string,
  roots?: readonly string[],
): ContextPathAccessAnalysis {
  const source = typeof expression === 'string' ? expression : expression.source;
  const references: ContextPathReference[] = [];
  const unknown: ContextPathAccessUnknown[] = [];
  const selectedRoots = roots === undefined ? undefined : new Set(roots);

  collectContextPaths(parseCel(source).ast, source, new Map(), selectedRoots, references, unknown);

  return {references, unknown};
}

function collectContextPaths(
  node: ASTNode,
  source: string,
  scopedPaths: ScopedPaths,
  selectedRoots: ReadonlySet<string> | undefined,
  references: ContextPathReference[],
  unknown: ContextPathAccessUnknown[],
  allowComprehensionResultUnknown = false,
): void {
  if (binaryOperators.has(node.op as BinaryOperator) || node.op === '||' || node.op === '&&') {
    collectBinaryContextPaths(
      node.args as [ASTNode, ASTNode],
      source,
      scopedPaths,
      selectedRoots,
      references,
      unknown,
    );
    return;
  }

  const chain = accessChain(node, scopedPaths);
  if (chain !== undefined) {
    recordPath(chain, sourceForNode(node, source), selectedRoots, references, unknown, {
      wholeElement: node.op === 'id' && scopedPaths.has(node.args) && chain.segments.at(-1) === '*',
    });
    if (chain.unknown !== undefined) {
      collectDynamicDependencies(node, source, scopedPaths, selectedRoots, references, unknown);
    }
    return;
  }

  const base = accessBase(node);
  if (base !== undefined) {
    const baseRoots = collectUnresolvedAccessDependencies(
      base,
      source,
      scopedPaths,
      selectedRoots,
      references,
      unknown,
    );
    for (const root of baseRoots) {
      unknown.push({root, source: sourceForNode(node, source), reason: 'dynamic'});
    }
    return;
  }

  collectContextPathChildren(
    node,
    source,
    scopedPaths,
    selectedRoots,
    references,
    unknown,
    allowComprehensionResultUnknown,
  );
}

function collectContextPathChildren(
  node: ASTNode,
  source: string,
  scopedPaths: ScopedPaths,
  selectedRoots: ReadonlySet<string> | undefined,
  references: ContextPathReference[],
  unknown: ContextPathAccessUnknown[],
  allowComprehensionResultUnknown = false,
): void {
  switch (node.op) {
    case 'id':
    case 'value':
      return;
    case '.':
    case '.?':
      collectContextPaths(node.args[0], source, scopedPaths, selectedRoots, references, unknown);
      return;
    case '[]':
    case '[?]':
      collectBinaryContextPaths(node.args, source, scopedPaths, selectedRoots, references, unknown);
      return;
    case 'call':
      collectContextPathArguments(
        node.args[1],
        source,
        scopedPaths,
        selectedRoots,
        references,
        unknown,
        true,
      );
      return;
    case 'rcall':
      collectRelativeCallContextPaths(
        node,
        source,
        scopedPaths,
        selectedRoots,
        references,
        unknown,
        allowComprehensionResultUnknown,
      );
      return;
    case 'list':
      collectContextPathArguments(
        node.args,
        source,
        scopedPaths,
        selectedRoots,
        references,
        unknown,
        true,
      );
      return;
    case 'map':
      collectMapContextPaths(node.args, source, scopedPaths, selectedRoots, references, unknown);
      return;
    case '?:':
      collectContextPathArguments(
        node.args,
        source,
        scopedPaths,
        selectedRoots,
        references,
        unknown,
        true,
      );
      return;
    case '!_':
    case '-_':
      collectContextPaths(node.args, source, scopedPaths, selectedRoots, references, unknown, true);
      return;
  }

  throw new Error(`Unsupported CEL AST operator: ${(node as {op: string}).op}`);
}

function collectContextPathArguments(
  arguments_: readonly ASTNode[],
  source: string,
  scopedPaths: ScopedPaths,
  selectedRoots: ReadonlySet<string> | undefined,
  references: ContextPathReference[],
  unknown: ContextPathAccessUnknown[],
  allowComprehensionResultUnknown: boolean,
): void {
  for (const argument of arguments_) {
    collectContextPaths(
      argument,
      source,
      scopedPaths,
      selectedRoots,
      references,
      unknown,
      allowComprehensionResultUnknown,
    );
  }
}

function collectMapContextPaths(
  entries: readonly (readonly [ASTNode, ASTNode])[],
  source: string,
  scopedPaths: ScopedPaths,
  selectedRoots: ReadonlySet<string> | undefined,
  references: ContextPathReference[],
  unknown: ContextPathAccessUnknown[],
): void {
  for (const [key, value] of entries) {
    if (key.op !== 'id') {
      collectContextPaths(key, source, scopedPaths, selectedRoots, references, unknown, true);
    }
    collectContextPaths(value, source, scopedPaths, selectedRoots, references, unknown, true);
  }
}

function collectRelativeCallContextPaths(
  node: ASTNode,
  source: string,
  scopedPaths: ScopedPaths,
  selectedRoots: ReadonlySet<string> | undefined,
  references: ContextPathReference[],
  unknown: ContextPathAccessUnknown[],
  allowComprehensionResultUnknown: boolean,
): void {
  const [method, receiver, args] = node.args as [string, ASTNode, ASTNode[]];
  if (comprehensionMethods.has(method) && args[0]?.op === 'id') {
    collectComprehensionReceiverPath(
      receiver,
      source,
      scopedPaths,
      selectedRoots,
      references,
      unknown,
    );
  } else {
    collectContextPaths(receiver, source, scopedPaths, selectedRoots, references, unknown, true);
  }

  const binding = bindComprehensionAlias(method, args, scopedPaths, receiver);
  collectContextPathArguments(
    args.slice(binding.skipArgs),
    source,
    binding.scopedPaths,
    selectedRoots,
    references,
    unknown,
    !comprehensionMethods.has(method),
  );
  if (allowComprehensionResultUnknown && (method === 'filter' || method === 'map')) {
    collectComprehensionResultUnknown(node, receiver, source, scopedPaths, selectedRoots, unknown);
  }
}

function collectComprehensionResultUnknown(
  node: ASTNode,
  receiver: ASTNode,
  source: string,
  scopedPaths: ScopedPaths,
  selectedRoots: ReadonlySet<string> | undefined,
  unknown: ContextPathAccessUnknown[],
): void {
  const receiverReferences: ContextPathReference[] = [];
  const receiverUnknown: ContextPathAccessUnknown[] = [];
  collectContextPaths(
    receiver,
    source,
    scopedPaths,
    selectedRoots,
    receiverReferences,
    receiverUnknown,
    false,
  );
  const receiverRoots = new Set([
    ...receiverReferences.map((reference) => reference.root),
    ...receiverUnknown.map((access) => access.root),
  ]);
  for (const root of receiverRoots) {
    unknown.push({root, source: sourceForNode(node, source), reason: 'dynamic'});
  }
}

function collectComprehensionReceiverPath(
  receiver: ASTNode,
  source: string,
  scopedPaths: ScopedPaths,
  selectedRoots: ReadonlySet<string> | undefined,
  references: ContextPathReference[],
  unknown: ContextPathAccessUnknown[],
): void {
  const chain = accessChain(receiver, scopedPaths);
  if (chain === undefined) {
    collectContextPaths(receiver, source, scopedPaths, selectedRoots, references, unknown, false);
    return;
  }

  recordPath(
    {...chain, segments: [...chain.segments, '*']},
    sourceForNode(receiver, source),
    selectedRoots,
    references,
    unknown,
  );
  if (chain.unknown !== undefined) {
    collectDynamicDependencies(receiver, source, scopedPaths, selectedRoots, references, unknown);
  }
}

function collectBinaryContextPaths(
  [left, right]: [ASTNode, ASTNode],
  source: string,
  scopedPaths: ScopedPaths,
  selectedRoots: ReadonlySet<string> | undefined,
  references: ContextPathReference[],
  unknown: ContextPathAccessUnknown[],
): void {
  collectContextPaths(left, source, scopedPaths, selectedRoots, references, unknown, true);
  collectContextPaths(right, source, scopedPaths, selectedRoots, references, unknown, true);
}

function collectDynamicDependencies(
  node: ASTNode,
  source: string,
  scopedPaths: ScopedPaths,
  selectedRoots: ReadonlySet<string> | undefined,
  references: ContextPathReference[],
  unknown: ContextPathAccessUnknown[],
): void {
  switch (node.op) {
    case '.':
    case '.?':
      collectDynamicDependencies(
        node.args[0],
        source,
        scopedPaths,
        selectedRoots,
        references,
        unknown,
      );
      return;
    case '[]':
    case '[?]':
      collectDynamicDependencies(
        node.args[0],
        source,
        scopedPaths,
        selectedRoots,
        references,
        unknown,
      );
      collectContextPaths(
        node.args[1],
        source,
        scopedPaths,
        selectedRoots,
        references,
        unknown,
        true,
      );
      return;
    default:
      return;
  }
}

function recordPath(
  chain: PathChain,
  expressionSource: string,
  selectedRoots: ReadonlySet<string> | undefined,
  references: ContextPathReference[],
  unknown: ContextPathAccessUnknown[],
  options: RecordPathOptions = {},
): void {
  if (selectedRoots !== undefined && !selectedRoots.has(chain.root)) return;

  if (chain.unknown !== undefined) {
    unknown.push({root: chain.root, source: expressionSource, reason: chain.unknown});
    return;
  }

  references.push({
    root: chain.root,
    segments: chain.segments,
    source: expressionSource,
    ...(options.wholeElement === true ? {wholeElement: true} : {}),
  });
}

function collectUnresolvedAccessDependencies(
  node: ASTNode,
  source: string,
  scopedPaths: ScopedPaths,
  selectedRoots: ReadonlySet<string> | undefined,
  references: ContextPathReference[],
  unknown: ContextPathAccessUnknown[],
): Set<string> {
  const base = accessBase(node);
  if (base === undefined) {
    const baseReferences: ContextPathReference[] = [];
    const baseUnknown: ContextPathAccessUnknown[] = [];
    collectContextPaths(
      node,
      source,
      scopedPaths,
      selectedRoots,
      baseReferences,
      baseUnknown,
      false,
    );
    references.push(...baseReferences);
    unknown.push(...baseUnknown);
    return new Set([
      ...baseReferences.map((reference) => reference.root),
      ...baseUnknown.map((access) => access.root),
    ]);
  }

  const roots = collectUnresolvedAccessDependencies(
    base,
    source,
    scopedPaths,
    selectedRoots,
    references,
    unknown,
  );
  if (node.op === '[]' || node.op === '[?]') {
    collectContextPaths(node.args[1], source, scopedPaths, selectedRoots, references, unknown);
  }
  return roots;
}

function accessBase(node: ASTNode): ASTNode | undefined {
  switch (node.op) {
    case '.':
    case '.?':
    case '[]':
    case '[?]':
      return node.args[0];
    default:
      return undefined;
  }
}

function accessChain(node: ASTNode, scopedPaths: ScopedPaths): PathChain | undefined {
  switch (node.op) {
    case 'id':
      if (scopedPaths.has(node.args)) return scopedPaths.get(node.args) ?? undefined;
      return {root: node.args, segments: []};
    case '.': {
      const target = accessChain(node.args[0], scopedPaths);
      if (target === undefined) return undefined;
      return {...target, segments: [...target.segments, node.args[1]]};
    }
    case '.?': {
      const target = accessChain(node.args[0], scopedPaths);
      if (target === undefined) return undefined;
      return {...target, segments: [...target.segments, node.args[1]]};
    }
    case '[]':
    case '[?]': {
      const target = accessChain(node.args[0], scopedPaths);
      if (target === undefined) return undefined;
      const literalSegment = node.op === '[]' ? literalPathSegment(node.args[1]) : undefined;
      return literalSegment === undefined
        ? {...target, unknown: 'dynamic'}
        : {...target, segments: [...target.segments, literalSegment]};
    }
    default:
      return undefined;
  }
}

function literalPathSegment(node: ASTNode): ContextPathSegment | undefined {
  if (node.op !== 'value') return undefined;
  if (typeof node.args === 'string') return node.args;
  if (typeof node.args === 'number' && Number.isSafeInteger(node.args)) return node.args;
  if (
    typeof node.args === 'bigint' &&
    node.args <= BigInt(Number.MAX_SAFE_INTEGER) &&
    node.args >= BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    return Number(node.args);
  }
  return undefined;
}

function bindComprehensionAlias(
  method: string,
  args: readonly ASTNode[],
  scopedPaths: ScopedPaths,
  receiver: ASTNode,
): {readonly scopedPaths: ScopedPaths; readonly skipArgs: number} {
  if (!comprehensionMethods.has(method)) return {scopedPaths, skipArgs: 0};

  const [alias] = args;
  if (alias?.op !== 'id') return {scopedPaths, skipArgs: 0};

  const receiverPath = comprehensionElementPath(receiver, scopedPaths);
  const aliasPath = receiverPath === undefined ? null : receiverPath;
  const nextScopedPaths = new Map(scopedPaths);
  nextScopedPaths.set(alias.args, aliasPath);

  return {scopedPaths: nextScopedPaths, skipArgs: 1};
}

function comprehensionElementPath(
  receiver: ASTNode,
  scopedPaths: ScopedPaths,
): PathChain | undefined {
  const chain = accessChain(receiver, scopedPaths);
  if (chain !== undefined) return {...chain, segments: [...chain.segments, '*']};

  if (receiver.op !== 'rcall') return undefined;
  const [method, nestedReceiver, args] = receiver.args as [string, ASTNode, ASTNode[]];
  if (!comprehensionMethods.has(method) || args[0]?.op !== 'id') return undefined;

  const nestedPath = comprehensionElementPath(nestedReceiver, scopedPaths);
  return method === 'filter' || nestedPath === undefined
    ? nestedPath
    : {...nestedPath, unknown: 'dynamic'};
}

function sourceForNode(node: ASTNode, source: string): string {
  return source.slice(node.start, node.end);
}
