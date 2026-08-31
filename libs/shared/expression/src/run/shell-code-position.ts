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
type ReportReference = (
  reference: ShellVariableReference,
  construct: ShellReevaluatingConstruct,
) => void;
type ReportReferences = (
  words: readonly ShellWord[],
  construct: ShellReevaluatingConstruct,
  kinds?: readonly ShellVariableReference['kind'][],
  includeSingleQuotedLiterals?: boolean,
) => void;

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
  const matches: ShellCodePositionMatch[] = [];

  if (workflowDataNames.size === 0) return {matches: []};

  const tokens = tokenizeShell(params.command);
  let command: ShellWord[] = [];

  const report = (reference: ShellVariableReference, construct: ShellReevaluatingConstruct) => {
    if (!workflowDataNames.has(reference.name)) return;

    matches.push({construct, name: reference.name});
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
    analyzeShellCommand(words, reportReferences, report, workflowDataNames);
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

  return {matches};
}

function analyzeShellCommand(
  words: readonly ShellWord[],
  reportReferences: ReportReferences,
  report: ReportReference,
  workflowDataNames: ReadonlySet<string>,
): void {
  const commandWords = words.filter((word) => !word.isRedirectionTarget);
  const firstWord = commandWords[0];
  if (firstWord !== undefined && shellWordIsStatic(firstWord) && firstWord.value === 'for') return;

  const headIndex = commandHeadIndex(commandWords);
  const head = commandWords[headIndex];
  if (head === undefined || !shellWordIsStatic(head)) return;
  const commandName = shellCommandName(head.value);
  if (commandName === undefined) return;
  const arguments_ = commandWords.slice(headIndex + 1);

  switch (commandName) {
    case 'eval':
      reportReferences(arguments_, 'eval', ['direct'], true);
      return;
    case 'sh':
    case 'bash':
      reportShellProgram(commandName, arguments_, reportReferences);
      return;
    case 'source':
    case '.':
      reportReferences(arguments_.slice(0, 1), 'source');
      return;
    case 'let':
      reportArithmeticCommand('let', arguments_, reportReferences, report, workflowDataNames);
      return;
    case 'declare':
      reportDeclareArithmetic(arguments_, reportReferences, report, workflowDataNames);
      return;
    case 'awk':
    case 'jq':
    case 'sed':
      reportInterpreterProgram(commandName, arguments_, reportReferences);
      return;
    case 'xargs':
      reportXargsShellProgram(arguments_, reportReferences);
      return;
  }
}

function reportShellProgram(
  command: 'sh' | 'bash',
  words: readonly ShellWord[],
  reportReferences: ReportReferences,
): void {
  const program = shellProgramAfterC(words);
  if (program === undefined) return;
  const construct = command === 'sh' ? 'sh-c' : 'bash-c';
  reportReferences([program], construct);
}

function reportArithmeticCommand(
  construct: 'let' | 'declare-i',
  words: readonly ShellWord[],
  reportReferences: ReportReferences,
  report: ReportReference,
  workflowDataNames: ReadonlySet<string>,
): void {
  reportReferences(words, construct);
  reportBareArithmeticReferences(
    words,
    construct,
    report,
    workflowDataNames,
    construct === 'declare-i',
  );
}

function reportDeclareArithmetic(
  words: readonly ShellWord[],
  reportReferences: ReportReferences,
  report: ReportReference,
  workflowDataNames: ReadonlySet<string>,
): void {
  if (!words.some((word) => word.value === '-i')) return;
  reportArithmeticCommand('declare-i', words, reportReferences, report, workflowDataNames);
}

function reportInterpreterProgram(
  command: 'awk' | 'jq' | 'sed',
  words: readonly ShellWord[],
  reportReferences: ReportReferences,
): void {
  const program = interpreterProgramWord(command, words);
  if (program !== undefined) reportReferences([program], command);
}

function reportXargsShellProgram(
  words: readonly ShellWord[],
  reportReferences: ReportReferences,
): void {
  const nestedShell = xargsShellProgram(words);
  if (nestedShell !== undefined) reportReferences([nestedShell.program], 'xargs-sh-c');
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
    if (advanceCompoundExpansion()) return true;
    if (advanceBracedExpansion(kind, isSingleQuotedLiteral)) return true;
    if (advanceDollarQuote()) return true;

    const name = readShellIdentifier(source, index + 1);
    if (name === undefined) return false;
    addReference(name.value, kind, isSingleQuotedLiteral);
    advance(source.slice(index, name.index));
    return true;
  }

  function advanceCompoundExpansion(): boolean {
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
    return false;
  }

  function advanceBracedExpansion(
    kind: ShellVariableReference['kind'],
    isSingleQuotedLiteral: boolean,
  ): boolean {
    if (source.startsWith('${', index)) {
      markDynamic();
      const firstName = readParameterName(source, index + 2);
      if (source[index + 2] !== '#' && firstName !== undefined) {
        addReference(firstName.value, kind, isSingleQuotedLiteral);
      }
      advance('${');
      return true;
    }
    return false;
  }

  function advanceDollarQuote(): boolean {
    if (source.startsWith("$'", index) || source.startsWith('$"', index)) {
      markDynamic();
      advance(source.slice(index, index + 2));
      return true;
    }
    return false;
  }

  function scanLineComment(character: string): void {
    if (character !== '\n') {
      advance(character);
      return;
    }
    advance('\n');
    flushWord();
    tokens.push({kind: 'control'});
    wordCanStartComment = true;
    redirectionTarget = false;
  }

  function scanUnsafeArithmetic(character: string): boolean {
    if (character === '[') arithmeticBracketDepth += 1;
    if (character === ']' && arithmeticBracketDepth > 0) arithmeticBracketDepth -= 1;
    if (
      arithmeticBracketDepth === 0 &&
      (character === "'" || character === '"' || character === '`')
    ) {
      markArithmeticShellSyntax();
    }
    if (advanceExpansion('arithmetic')) return true;

    const name = readShellIdentifier(source, index);
    if (name === undefined) return false;
    const nextIndex = skipWhitespace(source, name.index);
    if (!isArithmeticAssignment(source, nextIndex)) addReference(name.value, 'arithmetic');
    advance(source.slice(index, name.index));
    return true;
  }

  function scanUnsafeParameter(character: string): boolean {
    if (character === '[') parameterBracketDepth += 1;
    if (character === ']' && parameterBracketDepth > 0) parameterBracketDepth -= 1;
    const referenceKind = arithmeticContext || parameterBracketDepth > 0 ? 'arithmetic' : 'direct';
    return advanceExpansion(referenceKind);
  }

  function scanUnsafeSite(
    character: string,
    site: Extract<ShellSiteContext, {kind: 'unsafe'}>,
  ): void {
    if (site.region === 'line-comment') {
      scanLineComment(character);
      return;
    }
    if (site.region === 'heredoc') {
      advance(character);
      return;
    }
    if (site.region === 'arith' && scanUnsafeArithmetic(character)) return;
    if (site.region === 'param-brace' && scanUnsafeParameter(character)) return;
    if (site.region !== 'arith' && site.region !== 'param-brace') markDynamic();
    advance(scannerChunkAt(source, index, site));
  }

  function scanUnquotedWhitespace(character: string): void {
    flushWord();
    if (character === '\n') tokens.push({kind: 'control'});
    wordCanStartComment = true;
    if (character === '\n') redirectionTarget = false;
    advance(character);
  }

  function scanRedirection(): void {
    flushWord();
    tokens.push({kind: 'redirection'});
    redirectionTarget = true;
    wordCanStartComment = true;
    const length = shellRedirectionLength(source, index);
    advance(source.slice(index, index + length));
  }

  function scanControl(): void {
    flushWord();
    tokens.push({kind: 'control'});
    wordCanStartComment = true;
    redirectionTarget = false;
    advance(source.slice(index, index + shellControlLength(source, index)));
  }

  function scanSafeSyntax(
    character: string,
    site: Exclude<ShellSiteContext, {kind: 'unsafe'}>,
  ): boolean {
    if (character === '\\') {
      advanceEscape();
      return true;
    }
    if (character === '#' && wordCanStartComment) {
      advance('#');
      return true;
    }
    if (character === '$' && advanceExpansion('direct', site.kind === 'single')) return true;
    if (character === '`') {
      markDynamic();
      advance('`');
      return true;
    }
    if (character === "'" || character === '"') {
      ensureWord();
      advance(character);
      return true;
    }
    return false;
  }

  function scanUnquotedSyntax(character: string): boolean {
    if (isShellWhitespace(character)) {
      scanUnquotedWhitespace(character);
      return true;
    }
    if (startsShellRedirection(source, index)) {
      scanRedirection();
      return true;
    }
    if (startsShellArithmetic(source, index)) {
      markDynamic();
      arithmeticContext = true;
      advance('((');
      return true;
    }
    if (startsShellControl(source, index)) {
      scanControl();
      return true;
    }
    return false;
  }

  function scanSafeSite(
    character: string,
    site: Exclude<ShellSiteContext, {kind: 'unsafe'}>,
  ): void {
    if (scanSafeSyntax(character, site)) return;
    if (site.kind === 'unquoted' && scanUnquotedSyntax(character)) return;
    ensureWord().value.push(character);
    advance(character);
  }

  while (index < source.length) {
    const character = source[index];
    if (character === undefined) break;

    const site = classifyShellSite(scanState);
    if (site.kind === 'unsafe') {
      scanUnsafeSite(character, site);
      continue;
    }
    scanSafeSite(character, site);
  }

  flushWord();
  return tokens;
}

function scannerChunkAt(
  source: string,
  index: number,
  site: Extract<ShellSiteContext, {kind: 'unsafe'}>,
): string {
  if (site.region === 'arith' && source[index] === ')')
    return arithmeticClosingChunk(source, index);
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

function arithmeticClosingChunk(source: string, index: number): string {
  let closingRunLength = 0;
  while (source[index + closingRunLength] === ')') closingRunLength += 1;
  if (closingRunLength > 2) return ')'.repeat(closingRunLength - 2);
  if (closingRunLength === 2) return '))';
  return ')';
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
    const action = interpreterOptionAction(command, value);
    if (action === undefined) return undefined;
    if (action.kind === 'program-current') return word;
    if (action.kind === 'program-next') return words[index + 1];
    index += action.count;
  }
  return undefined;
}

type InterpreterOptionAction =
  | {readonly kind: 'program-current'}
  | {readonly kind: 'program-next'}
  | {readonly kind: 'skip'; readonly count: number};

function interpreterOptionAction(
  command: 'awk' | 'jq' | 'sed',
  value: string,
): InterpreterOptionAction | undefined {
  switch (command) {
    case 'jq':
      return jqOptionAction(value);
    case 'awk':
      return awkOptionAction(value);
    case 'sed':
      return sedOptionAction(value);
  }
}

function jqOptionAction(value: string): InterpreterOptionAction | undefined {
  if (jqOptionConsumesArguments(value)) return {kind: 'skip', count: 3};
  if (jqFlag(value)) return {kind: 'skip', count: 1};
  return undefined;
}

function awkOptionAction(value: string): InterpreterOptionAction | undefined {
  if (awkOptionConsumesArgument(value)) return {kind: 'skip', count: 2};
  if (value === '-e' || value === '--source') return {kind: 'program-next'};
  if (awkFlag(value)) return {kind: 'skip', count: 1};
  return undefined;
}

function sedOptionAction(value: string): InterpreterOptionAction | undefined {
  if (value === '-e' || value === '--expression') return {kind: 'program-next'};
  if (sedOptionConsumesArgument(value)) return {kind: 'skip', count: 2};
  if (value.startsWith('--expression=')) return {kind: 'program-current'};
  if (value.startsWith('--file=') || sedFlag(value)) return {kind: 'skip', count: 1};
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
  const index = xargsCommandIndex(words);
  const shell = words[index];
  if (!isSupportedXargsShell(shell)) return undefined;

  const program = shellProgramAfterC(words.slice(index + 1));
  return program === undefined ? undefined : {program};
}

function xargsCommandIndex(words: readonly ShellWord[]): number {
  let index = 0;
  while (index < words.length) {
    const value = words[index]?.value;
    if (value === undefined) return index;
    if (value === '--') return index + 1;
    if (!value.startsWith('-') || value === '-') return index;
    index += xargsOptionConsumesArgument(value) ? 2 : 1;
  }
  return index;
}

function isSupportedXargsShell(shell: ShellWord | undefined): shell is ShellWord {
  if (shell === undefined || !shellWordIsStatic(shell)) return false;
  const shellName = shellCommandName(shell.value);
  return shellName === 'sh' || shellName === 'bash';
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
