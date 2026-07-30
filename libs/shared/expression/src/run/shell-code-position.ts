import {
  classifyShellSite,
  initialShellScanState,
  type ShellScanState,
  type ShellSiteContext,
  scanShellLiteral,
} from './shell-quoting.js';

const shellIdentifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
const shellIdentifierStartPattern = /[A-Za-z_]/;
const shellIdentifierCharacterPattern = /[A-Za-z0-9_]/;
const shellAssignmentPattern = /^[A-Za-z_][A-Za-z0-9_]*=/;
const shellDigitPattern = /[0-9]/;
const shellRedirectionCharacterPattern = /[<>]/;
const shellSedFlagPattern = /^-[neiErzbsu]+$/;
const shellWhitespacePattern = /\s/;
const shellCompoundArithmeticAssignmentPattern =
  /^[A-Za-z_][A-Za-z0-9_]*\s*(?:\+=|-=|\*=|\/=|%=|<<=|>>=|&=|\|=|\^=)/;

const shellReservedPrefixWords = new Set([
  'case',
  'do',
  'done',
  'elif',
  'else',
  'fi',
  'for',
  'if',
  'in',
  'then',
  'time',
  'until',
  'while',
  '!',
]);

const shellCommandWrapperWords = new Set(['command', 'env', 'nohup', 'sudo']);

export type ShellReevaluatingConstruct =
  | 'eval'
  | 'sh-c'
  | 'bash-c'
  | 'source'
  | 'let'
  | 'declare-i'
  | 'arithmetic'
  | 'awk'
  | 'jq'
  | 'sed'
  | 'xargs-sh-c';

export interface ShellCodePositionMatch {
  readonly construct: ShellReevaluatingConstruct;
  readonly name: string;
}

export interface ShellCodePositionAnalysis {
  readonly matches: readonly ShellCodePositionMatch[];
}

interface ShellVariableReference {
  readonly kind: 'direct' | 'arithmetic';
  readonly isSingleQuotedLiteral: boolean;
  readonly name: string;
}

interface ShellWord {
  readonly dynamic: boolean;
  readonly kind: 'word';
  readonly isRedirectionTarget: boolean;
  readonly references: readonly ShellVariableReference[];
  readonly value: string;
}

interface MutableShellWord {
  readonly isRedirectionTarget: boolean;
  readonly references: ShellVariableReference[];
  readonly value: string[];
  dynamic: boolean;
}

interface ShellControl {
  readonly kind: 'control';
}

interface ShellRedirection {
  readonly kind: 'redirection';
}

type ShellToken = ShellWord | ShellControl | ShellRedirection;

/**
 * Finds workflow-controlled values that are passed to shell constructs which
 * deliberately parse or evaluate their arguments again.
 *
 * The scanner follows direct references in a single shell word only. It does
 * not attempt shell data-flow analysis, and intentionally prefers a missed
 * warning over a false positive.
 */
export function classifyShellCodePosition(params: {
  readonly command: string;
  readonly workflowDataNames: Iterable<string>;
}): ShellCodePositionAnalysis {
  const workflowDataNames = new Set(params.workflowDataNames);
  const matches = new Map<string, ShellCodePositionMatch>();

  if (workflowDataNames.size === 0) return {matches: []};

  const tokens = tokenizeShell(params.command);
  let command: ShellWord[] = [];

  const report = (reference: ShellVariableReference, construct: ShellReevaluatingConstruct) => {
    if (!workflowDataNames.has(reference.name)) return;

    const key = `${construct}:${reference.name}`;
    if (!matches.has(key)) matches.set(key, {construct, name: reference.name});
  };

  const reportReferences = (
    words: readonly ShellWord[],
    construct: ShellReevaluatingConstruct,
    kinds: readonly ShellVariableReference['kind'][] = ['direct'],
    includeSingleQuotedLiterals = false,
  ) => {
    for (const word of words) {
      for (const reference of word.references) {
        if (
          kinds.includes(reference.kind) &&
          (includeSingleQuotedLiterals || !reference.isSingleQuotedLiteral)
        ) {
          report(reference, construct);
        }
      }
    }
  };

  const analyzeCommand = (words: readonly ShellWord[]) => {
    const commandWords = words.filter((word) => !word.isRedirectionTarget);
    const firstWord = commandWords[0];
    if (firstWord !== undefined && shellWordIsStatic(firstWord) && firstWord.value === 'for') {
      return;
    }
    const headIndex = commandHeadIndex(commandWords);
    const head = commandWords[headIndex];
    if (head === undefined || !shellWordIsStatic(head)) return;

    const commandName = shellCommandName(head.value);
    if (commandName === undefined) return;

    const argumentWords = commandWords.slice(headIndex + 1);

    if (commandName === 'eval') {
      reportReferences(argumentWords, 'eval', ['direct'], true);
      return;
    }

    if (commandName === 'sh' || commandName === 'bash') {
      const program = shellProgramAfterC(argumentWords);
      if (program !== undefined) {
        reportReferences([program], commandName === 'sh' ? 'sh-c' : 'bash-c');
      }
      return;
    }

    if (commandName === 'source' || commandName === '.') {
      reportReferences(argumentWords.slice(0, 1), 'source');
      return;
    }

    if (commandName === 'let') {
      reportReferences(argumentWords, 'let');
      reportBareArithmeticReferences(argumentWords, 'let', report, workflowDataNames, false);
      return;
    }

    if (commandName === 'declare' && argumentWords.some((word) => word.value === '-i')) {
      reportReferences(argumentWords, 'declare-i');
      reportBareArithmeticReferences(argumentWords, 'declare-i', report, workflowDataNames, true);
      return;
    }

    if (commandName === 'awk' || commandName === 'jq' || commandName === 'sed') {
      const program = interpreterProgramWord(commandName, argumentWords);
      if (program !== undefined) reportReferences([program], commandName);
      return;
    }

    if (commandName === 'xargs') {
      const nestedShell = xargsShellProgram(argumentWords);
      if (nestedShell !== undefined) {
        reportReferences([nestedShell.program], 'xargs-sh-c');
      }
    }
  };

  for (const token of tokens) {
    if (token.kind === 'control') {
      analyzeCommand(command);
      command = [];
      continue;
    }

    if (
      token.kind === 'word' &&
      token.references.some((reference) => reference.kind === 'arithmetic')
    ) {
      reportReferences([token], 'arithmetic', ['arithmetic']);
    }

    if (token.kind === 'word') command.push(token);
  }

  analyzeCommand(command);

  return {matches: [...matches.values()]};
}

function tokenizeShell(source: string): readonly ShellToken[] {
  const tokens: ShellToken[] = [];
  let current: MutableShellWord | undefined;
  let index = 0;
  let redirectionTarget = false;
  let wordCanStartComment = true;
  let scanState: ShellScanState = initialShellScanState;
  let arithmeticContext = false;
  let parameterBracketDepth = 0;
  let arithmeticBracketDepth = 0;
  let arithmeticShellSyntax = false;

  function ensureWord(): MutableShellWord {
    if (current !== undefined) return current;
    current = {
      dynamic: false,
      isRedirectionTarget: redirectionTarget,
      references: [],
      value: [],
    };
    redirectionTarget = false;
    wordCanStartComment = false;
    return current;
  }

  function flushWord(): void {
    if (current === undefined) return;
    tokens.push({
      dynamic: current.dynamic,
      kind: 'word',
      isRedirectionTarget: current.isRedirectionTarget,
      references: current.references.filter(
        (reference) => !(arithmeticShellSyntax && reference.kind === 'arithmetic'),
      ),
      value: current.value.join(''),
    });
    current = undefined;
    arithmeticShellSyntax = false;
  }

  function markDynamic(): void {
    ensureWord().dynamic = true;
  }

  function addReference(
    name: string,
    kind: ShellVariableReference['kind'],
    isSingleQuotedLiteral = false,
  ): void {
    if (kind === 'arithmetic' && arithmeticShellSyntax) return;
    ensureWord().references.push({kind, isSingleQuotedLiteral, name});
  }

  function markArithmeticShellSyntax(): void {
    arithmeticShellSyntax = true;
  }

  function advance(text: string): void {
    scanState = scanShellLiteral(text, scanState);
    index += text.length;

    const site = classifyShellSite(scanState);
    if (arithmeticContext && !(site.kind === 'unsafe' && site.region === 'arith')) {
      arithmeticContext = false;
      arithmeticBracketDepth = 0;
    }
  }

  function advanceEscape(): void {
    const nextCharacter = source[index + 1];
    if (nextCharacter === undefined) {
      advance(source[index] ?? '');
      return;
    }

    if (nextCharacter !== '\n') ensureWord().value.push(nextCharacter);
    advance(source.slice(index, index + 2));
  }

  function advanceExpansion(
    kind: ShellVariableReference['kind'],
    isSingleQuotedLiteral = false,
  ): boolean {
    if (source[index] !== '$') return false;

    if (source.startsWith('$((', index)) {
      markDynamic();
      arithmeticContext = true;
      advance('$((');
      return true;
    }

    if (source.startsWith('$[', index)) {
      markDynamic();
      arithmeticContext = true;
      advance('$[');
      return true;
    }

    if (source.startsWith('$(', index)) {
      markDynamic();
      advance('$(');
      return true;
    }

    if (source.startsWith('${', index)) {
      markDynamic();
      const firstName = readParameterName(source, index + 2);
      if (source[index + 2] !== '#' && firstName !== undefined) {
        addReference(firstName.value, kind, isSingleQuotedLiteral);
      }
      advance('${');
      return true;
    }

    if (source.startsWith("$'", index) || source.startsWith('$"', index)) {
      markDynamic();
      advance(source.slice(index, index + 2));
      return true;
    }

    const name = readShellIdentifier(source, index + 1);
    if (name === undefined) return false;

    addReference(name.value, kind, isSingleQuotedLiteral);
    advance(source.slice(index, name.index));
    return true;
  }

  while (index < source.length) {
    const character = source[index];
    if (character === undefined) break;

    const site = classifyShellSite(scanState);
    if (site.kind === 'unsafe') {
      if (site.region === 'line-comment') {
        if (character === '\n') {
          advance('\n');
          flushWord();
          tokens.push({kind: 'control'});
          wordCanStartComment = true;
          redirectionTarget = false;
        } else {
          advance(character);
        }
        continue;
      }

      if (site.region === 'heredoc') {
        advance(character);
        continue;
      }

      if (site.region === 'arith') {
        if (character === '[') arithmeticBracketDepth += 1;
        if (character === ']' && arithmeticBracketDepth > 0) arithmeticBracketDepth -= 1;
        if (
          arithmeticBracketDepth === 0 &&
          (character === "'" || character === '"' || character === '`')
        ) {
          markArithmeticShellSyntax();
        }

        if (advanceExpansion('arithmetic')) continue;

        const name = readShellIdentifier(source, index);
        if (name !== undefined) {
          const nextIndex = skipWhitespace(source, name.index);
          if (!isArithmeticAssignment(source, nextIndex)) addReference(name.value, 'arithmetic');
          advance(source.slice(index, name.index));
          continue;
        }
      } else if (site.region === 'param-brace') {
        if (character === '[') parameterBracketDepth += 1;
        if (character === ']' && parameterBracketDepth > 0) parameterBracketDepth -= 1;

        const referenceKind =
          arithmeticContext || parameterBracketDepth > 0 ? 'arithmetic' : 'direct';
        if (advanceExpansion(referenceKind)) continue;
      } else {
        markDynamic();
      }

      const chunk = scannerChunkAt(source, index, site);
      advance(chunk);
      continue;
    }

    if (character === '\\') {
      advanceEscape();
      continue;
    }

    if (character === '#' && wordCanStartComment) {
      advance('#');
      continue;
    }

    if (character === '$' && advanceExpansion('direct', site.kind === 'single')) continue;

    if (character === '`') {
      markDynamic();
      advance('`');
      continue;
    }

    if (site.kind === 'unquoted' && isShellWhitespace(character)) {
      flushWord();
      if (character === '\n') tokens.push({kind: 'control'});
      wordCanStartComment = true;
      if (character === '\n') redirectionTarget = false;
      advance(character);
      continue;
    }

    if (character === "'" || character === '"') {
      ensureWord();
      advance(character);
      continue;
    }

    if (site.kind === 'unquoted' && startsShellRedirection(source, index)) {
      flushWord();
      tokens.push({kind: 'redirection'});
      redirectionTarget = true;
      wordCanStartComment = true;
      const length = shellRedirectionLength(source, index);
      advance(source.slice(index, index + length));
      continue;
    }

    if (site.kind === 'unquoted' && startsShellArithmetic(source, index)) {
      markDynamic();
      arithmeticContext = true;
      advance('((');
      continue;
    }

    if (site.kind === 'unquoted' && startsShellControl(source, index)) {
      flushWord();
      tokens.push({kind: 'control'});
      wordCanStartComment = true;
      redirectionTarget = false;
      advance(source.slice(index, index + shellControlLength(source, index)));
      continue;
    }

    ensureWord().value.push(character);
    advance(character);
  }

  flushWord();
  return tokens;
}

function scannerChunkAt(
  source: string,
  index: number,
  site: Extract<ShellSiteContext, {kind: 'unsafe'}>,
): string {
  if (site.region === 'arith' && source[index] === ')') {
    let closingRunLength = 0;
    while (source[index + closingRunLength] === ')') closingRunLength += 1;
    if (closingRunLength > 2) return ')'.repeat(closingRunLength - 2);
    if (closingRunLength === 2) return '))';
    return ')';
  }
  if (source.startsWith('$((', index)) return '$((';
  if (source.startsWith('((', index)) return '((';
  if (source.startsWith('$[', index)) return '$[';
  if (source.startsWith('$(', index) || source.startsWith('${', index))
    return source.slice(index, index + 2);
  if (source.startsWith('<<-', index)) return '<<-';
  if (source.startsWith('<<', index)) return '<<';
  if (source[index] === '\\' && index + 1 < source.length) return source.slice(index, index + 2);
  return source[index] ?? '';
}

function commandHeadIndex(words: readonly ShellWord[]): number {
  let index = 0;
  while (index < words.length) {
    const word = words[index];
    if (isShellAssignment(word)) {
      index += 1;
      continue;
    }
    if (word !== undefined && shellWordIsStatic(word) && shellReservedPrefixWords.has(word.value)) {
      index += 1;
      continue;
    }
    if (word !== undefined && shellWordIsStatic(word) && shellCommandWrapperWords.has(word.value)) {
      index += 1;
      continue;
    }
    break;
  }
  return index;
}

function shellWordIsStatic(word: ShellWord): boolean {
  return !word.dynamic && word.references.length === 0;
}

function shellCommandName(value: string): string | undefined {
  if (value.length === 0) return undefined;
  const name = value.split('/').at(-1);
  return name === undefined || (!shellIdentifierPattern.test(name) && name !== '.')
    ? undefined
    : name;
}

function shellProgramAfterC(words: readonly ShellWord[]): ShellWord | undefined {
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (word?.value === '-c' || word?.value === '--command') return words[index + 1];
    if (word?.value.startsWith('-') && !word.value.startsWith('--') && word.value.includes('c')) {
      return words[index + 1];
    }
    if (word?.value === '--') return undefined;
  }
  return undefined;
}

function reportBareArithmeticReferences(
  words: readonly ShellWord[],
  construct: 'let' | 'declare-i',
  report: (reference: ShellVariableReference, construct: ShellReevaluatingConstruct) => void,
  workflowDataNames: ReadonlySet<string>,
  skipDeclarationNames: boolean,
): void {
  for (const word of words) {
    if (word.references.length > 0 || word.value.startsWith('-')) continue;
    const expression = skipDeclarationNames ? declarationExpression(word.value) : word.value;
    if (expression === undefined) continue;

    for (const identifier of arithmeticIdentifiers(expression)) {
      if (workflowDataNames.has(identifier)) {
        report({kind: 'arithmetic', name: identifier, isSingleQuotedLiteral: false}, construct);
      }
    }
  }
}

function declarationExpression(value: string): string | undefined {
  if (shellIdentifierPattern.test(value)) return undefined;
  if (shellCompoundArithmeticAssignmentPattern.test(value)) {
    return value;
  }
  const assignmentIndex = value.indexOf('=');
  if (assignmentIndex < 0) return undefined;
  return value.slice(assignmentIndex + 1);
}

function arithmeticIdentifiers(source: string): readonly string[] {
  const identifiers: string[] = [];
  let index = 0;
  while (index < source.length) {
    const name = readShellIdentifier(source, index);
    if (name === undefined) {
      index += 1;
      continue;
    }

    const nextIndex = skipWhitespace(source, name.index);
    if (!isArithmeticAssignment(source, nextIndex)) identifiers.push(name.value);
    index = name.index;
  }
  return identifiers;
}

function isArithmeticAssignment(source: string, index: number): boolean {
  return source[index] === '=' && source[index + 1] !== '=';
}

function interpreterProgramWord(
  command: 'awk' | 'jq' | 'sed',
  words: readonly ShellWord[],
): ShellWord | undefined {
  let index = 0;
  while (index < words.length) {
    const word = words[index];
    if (word === undefined) return undefined;
    const value = word.value;

    if (value === '--') return words[index + 1];
    if (!value.startsWith('-') || value === '-') return word;

    if (command === 'jq' && jqOptionConsumesArguments(value)) {
      index += 3;
      continue;
    }

    if (command === 'awk' && awkOptionConsumesArgument(value)) {
      index += 2;
      continue;
    }

    if (command === 'awk' && (value === '-e' || value === '--source')) {
      return words[index + 1];
    }

    if (command === 'sed' && (value === '-e' || value === '--expression')) {
      return words[index + 1];
    }

    if (command === 'sed' && sedOptionConsumesArgument(value)) {
      index += 2;
      continue;
    }

    if (command === 'sed' && value.startsWith('--expression=')) return word;
    if (command === 'sed' && value.startsWith('--file=')) {
      index += 1;
      continue;
    }

    if (command === 'jq' && jqFlag(value)) {
      index += 1;
      continue;
    }

    if (command === 'awk' && awkFlag(value)) {
      index += 1;
      continue;
    }

    if (command === 'sed' && sedFlag(value)) {
      index += 1;
      continue;
    }

    return undefined;
  }
  return undefined;
}

function jqOptionConsumesArguments(value: string): boolean {
  return (
    value === '--arg' ||
    value === '--argjson' ||
    value === '--argfile' ||
    value === '--slurpfile' ||
    value === '--rawfile'
  );
}

function awkOptionConsumesArgument(value: string): boolean {
  return (
    value === '-f' ||
    value === '-v' ||
    value === '-F' ||
    value === '--assign' ||
    value === '--field-separator'
  );
}

function sedOptionConsumesArgument(value: string): boolean {
  return value === '-f' || value === '--file';
}

function jqFlag(value: string): boolean {
  return new Set([
    '-c',
    '-e',
    '-j',
    '-M',
    '-n',
    '-r',
    '-s',
    '-S',
    '-C',
    '--ascii-output',
    '--compact-output',
    '--exit-status',
    '--join-output',
    '--monochrome-output',
    '--null-input',
    '--raw-output',
    '--sort-keys',
    '--slurp',
    '--tab',
    '--version',
  ]).has(value);
}

function awkFlag(value: string): boolean {
  return (
    value === '--posix' || value === '--traditional' || value === '--lint' || value === '--sandbox'
  );
}

function sedFlag(value: string): boolean {
  return (
    shellSedFlagPattern.test(value) ||
    value === '--posix' ||
    value === '--regexp-extended' ||
    value === '--in-place'
  );
}

function xargsShellProgram(words: readonly ShellWord[]): {readonly program: ShellWord} | undefined {
  let index = 0;
  while (index < words.length) {
    const word = words[index];
    if (word === undefined) return undefined;
    const value = word.value;
    if (value === '--') {
      index += 1;
      break;
    }
    if (!value.startsWith('-') || value === '-') break;
    if (xargsOptionConsumesArgument(value)) index += 2;
    else index += 1;
  }

  const shell = words[index];
  if (shell === undefined || !shellWordIsStatic(shell)) return undefined;
  const shellName = shellCommandName(shell.value);
  if (shellName !== 'sh' && shellName !== 'bash') return undefined;

  const program = shellProgramAfterC(words.slice(index + 1));
  return program === undefined ? undefined : {program};
}

function xargsOptionConsumesArgument(value: string): boolean {
  return (
    value === '-d' ||
    value === '-E' ||
    value === '-I' ||
    value === '-J' ||
    value === '-L' ||
    value === '-n' ||
    value === '-P' ||
    value === '-s' ||
    value === '--delimiter' ||
    value === '--eof' ||
    value === '--max-args' ||
    value === '--max-lines' ||
    value === '--max-procs' ||
    value === '--max-chars' ||
    value === '--replace'
  );
}

function isShellAssignment(word: ShellWord | undefined): boolean {
  return word !== undefined && shellAssignmentPattern.test(word.value);
}

function readParameterName(
  source: string,
  start: number,
): {readonly index: number; readonly value: string} | undefined {
  const prefix = source[start];
  return readShellIdentifier(source, prefix === '!' || prefix === '#' ? start + 1 : start);
}

function readShellIdentifier(
  source: string,
  start: number,
): {readonly index: number; readonly value: string} | undefined {
  if (!shellIdentifierStartPattern.test(source[start] ?? '')) return undefined;
  let index = start + 1;
  while (shellIdentifierCharacterPattern.test(source[index] ?? '')) index += 1;
  return {index, value: source.slice(start, index)};
}

function skipWhitespace(source: string, start: number): number {
  let index = start;
  while (shellWhitespacePattern.test(source[index] ?? '')) index += 1;
  return index;
}

function isShellWhitespace(character: string): boolean {
  return character === ' ' || character === '\t' || character === '\r' || character === '\n';
}

function startsShellRedirection(source: string, index: number): boolean {
  if (source[index] === '>' || source[index] === '<') return true;
  return (
    shellDigitPattern.test(source[index] ?? '') &&
    shellRedirectionCharacterPattern.test(source[index + 1] ?? '')
  );
}

function shellRedirectionLength(source: string, index: number): number {
  let nextIndex = index;
  while (shellDigitPattern.test(source[nextIndex] ?? '')) nextIndex += 1;
  if (source.startsWith('<<<', nextIndex)) return nextIndex - index + 3;
  if (source.startsWith('<<-', nextIndex)) return nextIndex - index + 3;
  if (source.startsWith('<<', nextIndex)) return nextIndex - index + 2;
  if (
    source.startsWith('>>', nextIndex) ||
    source.startsWith('<>', nextIndex) ||
    source.startsWith('>&', nextIndex) ||
    source.startsWith('<&', nextIndex) ||
    source.startsWith('>|', nextIndex)
  ) {
    return nextIndex - index + 2;
  }
  return nextIndex - index + 1;
}

function startsShellArithmetic(source: string, index: number): boolean {
  return source.startsWith('((', index);
}

function startsShellControl(source: string, index: number): boolean {
  return (
    source[index] === ';' ||
    source[index] === '&' ||
    source[index] === '|' ||
    source[index] === '(' ||
    source[index] === ')' ||
    source[index] === '{' ||
    source[index] === '}'
  );
}

function shellControlLength(source: string, index: number): number {
  if (
    source.startsWith('&&', index) ||
    source.startsWith('||', index) ||
    source.startsWith(';;', index) ||
    source.startsWith(';&', index) ||
    source.startsWith(';;&', index) ||
    source.startsWith('|&', index)
  ) {
    return source.startsWith(';;&', index) ? 3 : 2;
  }
  return 1;
}
